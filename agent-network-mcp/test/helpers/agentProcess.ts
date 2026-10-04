import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SERVER_ENTRY = join(ROOT, "dist", "index.js");

export interface AgentProcess {
  id: string;
  pid: number;
  /** Call a tool; throws if the tool reports an error. */
  call<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Call a tool expecting {error:{code,message}}. */
  callError(name: string, args?: Record<string, unknown>): Promise<{ code: string; message: string; raw: string; [k: string]: any }>;
  listTools(): Promise<string[]>;
  instructions(): Promise<string | undefined>;
  listToolSchemas(): Promise<Record<string, any>>;
  close(): Promise<void>;
  /** SIGKILL, simulating a crash. */
  kill(): Promise<void>;
}

export interface SpawnOptions {
  id: string;
  networkDir: string;
  type?: string;
  role?: string;
  cwd?: string;
  /** Also expose the fine-grained tools (AGENT_NETWORK_ADVANCED=1). */
  advanced?: boolean;
}

const open: AgentProcess[] = [];

export async function spawnAgent(opts: SpawnOptions): Promise<AgentProcess> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    cwd: opts.cwd ?? ROOT,
    env: {
      AGENT_ID: opts.id,
      AGENT_TYPE: opts.type ?? "test",
      AGENT_ROLE: opts.role ?? opts.id,
      NETWORK_DIR: opts.networkDir,
      ...(opts.advanced ? { AGENT_NETWORK_ADVANCED: "1" } : {}),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: `test-${opts.id}`, version: "0.0.0" });
  await client.connect(transport);
  const pid = transport.pid!;

  const raw = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    return { isError: Boolean(res.isError), text };
  };

  const agent: AgentProcess = {
    id: opts.id,
    pid,
    async call(name, args = {}) {
      const { isError, text } = await raw(name, args);
      if (isError) throw new Error(`${name} failed: ${text}`);
      return JSON.parse(text);
    },
    async callError(name, args) {
      const { isError, text } = await raw(name, args);
      if (!isError) throw new Error(`${name} unexpectedly succeeded: ${text}`);
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        return { code: "INVALID_ARGUMENTS", message: text, raw: text }; // rejected by the MCP SDK's schema validation
      }
      // advanced tools: {error:{code,message}}; swarm tools: {error:"CODE", message, nextAction, ...}
      const flat = typeof body.error === "string" ? { code: body.error, ...body } : { ...body.error };
      return { ...flat, raw: text };
    },
    async listTools() {
      return (await client.listTools()).tools.map((t) => t.name).sort();
    },
    async listToolSchemas() {
      return Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.inputSchema]));
    },
    async instructions() {
      return client.getInstructions();
    },
    async close() {
      await client.close().catch(() => undefined);
    },
    async kill() {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      await client.close().catch(() => undefined);
    },
  };
  open.push(agent);
  return agent;
}

export async function closeAllAgents(): Promise<void> {
  await Promise.all(open.splice(0).map((a) => a.close()));
}

/** Create a task from outside the LLM, exactly like an operator would. */
export function createTaskViaCli(networkDir: string, agents: string[], title = "Demo task", extra: string[] = []): any {
  const out = execFileSync(process.execPath, [SERVER_ENTRY, "task", "create", "--title", title, "--description", `${title} description`, "--agents", agents.join(","), ...extra], {
    env: { ...process.env, NETWORK_DIR: networkDir },
  });
  return JSON.parse(out.toString());
}
