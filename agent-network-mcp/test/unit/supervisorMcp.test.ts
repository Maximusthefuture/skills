import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { DEFAULT_RULES } from "../../src/supervisor/detect.js";
import { createSupervisorServer, type SupervisorServerOptions } from "../../src/supervisor/mcp.js";
import { Supervisor } from "../../src/supervisor/supervisor.js";
import { parseCustomTool } from "../../src/supervisor/tools.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
const children: ChildProcess[] = [];
afterEach(async () => {
  await ui?.close();
  ui = undefined;
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

/** A page with one project (runners + supervisor) and the supervisor's MCP tools connected to it in-process. */
async function setup(over: Partial<SupervisorServerOptions> = {}) {
  const projectDir = join(await tmpDir(), "shop");
  const backendDir = join(projectDir, "..", "shop-backend");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(backendDir, { recursive: true });
  writeFileSync(join(backendDir, "pom.xml"), "<project/>");
  writeFileSync(join(projectDir, "sup.md"), "supervise");
  const networkDir = join(projectDir, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const task = await operator.createTaskAsOperator({ title: "Multi-currency", description: "Prices in EUR and USD", agents: ["backend", "reviewer"] });
  const pool = new RunnerPool(networkDir, [
    { id: "backend", command: ["x", "{prompt}"], cwd: backendDir },
    { id: "reviewer", command: ["x", "{prompt}"] },
  ] as never);
  const supervisor = new Supervisor({
    networkDir,
    pool,
    config: { command: ["claude", "-p", "{prompt}"], promptFile: join(projectDir, "sup.md"), rules: { ...DEFAULT_RULES }, maxSessionsPerHour: 6, autostart: false, tools: [], disabledTools: [] },
  });
  ui = await startUiServer([{ networkDir, runners: pool, supervisor }], { port: 0 });
  const folders = [{ agentId: "backend", cwd: backendDir }];
  const server = createSupervisorServer({ uiUrl: ui.url, project: ui.projects[0]!.id, folders, networkDir, ...over });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test-supervisor", version: "0.0.0" });
  await client.connect(b);
  const raw = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0]!.text;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text }; // arguments refused by the tool's schema
    }
    return { isError: Boolean(res.isError), json };
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await raw(name, args);
    if (r.isError) throw new Error(JSON.stringify(r.json));
    return r.json;
  };
  const fs = await FileStore.open(networkDir);
  const state = async () => (await (await fetch(`${ui!.url}/api/state`)).json()) as any;
  const journal = async () => ((await (await fetch(`${ui!.url}/api/supervisor`)).json()) as any).journal as any[];
  return { task, client, call, raw, fs, state, journal, backendDir, networkDir, pool };
}

describe("supervisor tools", () => {
  it("acts through the page: answers, messages and notes land like the operator's and are journaled as the supervisor's", async () => {
    const { task, call, fs, state, journal } = await setup();
    const messages = new MessageStore(fs);
    const q = await messages.create({ taskId: task.id, from: "backend", to: "operator", type: "QUESTION", content: "Why does the lead not approve?" });

    const ov = await call("overview");
    expect(ov.tasks).toEqual([expect.objectContaining({ id: task.id, phase: "DISCUSS", status: "ACTIVE", agents: [expect.objectContaining({ id: "backend" }), expect.objectContaining({ id: "reviewer" })] })]);
    expect(ov.openQuestions).toEqual([expect.objectContaining({ taskId: task.id, messageId: q.id, from: "backend" })]);
    expect(ov.runners.map((r: any) => r.id)).toEqual(["backend", "reviewer"]);

    await call("answer_question", { taskId: task.id, messageId: q.id, answer: "It waits for the reviewer to approve first." });
    await call("message_agent", { taskId: task.id, to: "reviewer", text: "Please approve or object: backend waits on you." });
    await call("note", { taskId: task.id, text: "The lead waited on reviewer; nudged it." });

    const all = await messages.list(task.id);
    expect(all.find((m) => m.id === q.id)!.readAt).toBeTruthy();
    expect(all.filter((m) => m.from === "operator").map((m) => [m.to, m.content])).toEqual([
      ["backend", "It waits for the reviewer to approve first."],
      ["reviewer", "Please approve or object: backend waits on you."],
    ]);
    expect((await journal()).map((e) => [e.kind, e.by, e.text.slice(0, 22)])).toEqual([
      ["action", "supervisor", "answered backend's que"],
      ["action", "supervisor", "message to reviewer: P"],
      ["note", "supervisor", "The lead waited on rev"],
    ]);
    expect((await state()).supervisor.recent).toHaveLength(3);
  });

  it("escalate puts a decision on the page until the operator marks it done", async () => {
    const { task, call, state } = await setup();
    const entry = await call("escalate", { taskId: task.id, question: "Drop USD from scope?", recommendation: "Keep it: the tests are nearly done." });
    expect(entry).toMatchObject({ kind: "needs-you", by: "supervisor", text: "Drop USD from scope?\nRecommendation: Keep it: the tests are nearly done." });
    expect((await state()).supervisor).toMatchObject({ available: true, enabled: false, needsYou: [expect.objectContaining({ id: entry.id })] });

    const post = (path: string, body: unknown) => fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("/api/supervisor/resolve", { id: "entry-999" })).status).toBe(400);
    const done = (await (await post("/api/supervisor/resolve", { id: entry.id })).json()) as any;
    expect(done.entry.resolvedAt).toBeTruthy();
    expect((await state()).supervisor.needsYou).toEqual([]);
  });

  it("agent_log reads the activity feed: tool calls, results with ok/ERROR and duration; the raw log while there is none", async () => {
    const { call, pool } = await setup();
    expect(await call("agent_log", { agentId: "backend" })).toEqual({ agentId: "backend", lines: [] });
    pool.recordActivity("backend", { kind: "tool_use", tool: "Bash", summary: "kill -9 4242" });
    pool.recordActivity("backend", { kind: "tool_result", tool: "Bash", isError: true, durationMs: 1200, summary: "Permission to use Bash has been denied" });
    pool.recordActivity("backend", { kind: "thinking", summary: "maybe again" });
    pool.recordActivity("reviewer", { kind: "text", summary: "not backend" });
    const res = await call("agent_log", { agentId: "backend" });
    expect(res.events.map((l: string) => l.slice(9))).toEqual(["tool_use Bash: kill -9 4242", "tool_result Bash ERROR 1s: Permission to use Bash has been denied"]);
  });

  it("sees test JVMs in the agents' folders only, and ends a hung one", async () => {
    const { call, raw, backendDir } = await setup();
    const bin = join(await tmpDir(), "bin");
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, "java")); // a "java" that hangs with the worktree in its command line
    const child = spawn(join(bin, "java"), ["-e", "setInterval(() => {}, 1e9)", join(backendDir, "target", "surefire")], { stdio: "ignore" });
    children.push(child);
    await vi.waitFor(async () => expect((await call("processes")).map((p: any) => p.pid)).toContain(child.pid));
    const listed = (await call("processes")).find((p: any) => p.pid === child.pid);
    expect(listed).toMatchObject({ agentId: "backend", command: expect.stringContaining(backendDir) });

    const foreign = await raw("kill_test", { pid: process.pid, reason: "test" });
    expect(foreign).toMatchObject({ isError: true, json: { error: "FORBIDDEN" } });

    const exited = new Promise((r) => child.once("exit", r));
    expect(await call("kill_test", { pid: child.pid, reason: "hung for 20 min on a lock" })).toMatchObject({ pid: child.pid, agentId: "backend", killed: "TERM" });
    await exited;
  });

  it("the operator's own commands: argv without a shell, the agent's folder, every value checked; switched-off tools are gone", async () => {
    const tools = [
      parseCustomTool({ name: "list_files", description: "files of an agent's folder", command: ["ls"], cwd: "{agentCwd}" }, "t"),
      parseCustomTool({ name: "say", description: "echo a word", command: ["echo", "{word}"], params: { word: { type: "string" } }, action: true }, "t"),
    ];
    const { client, call, raw, journal } = await setup({ tools, disabled: ["kill_test", "db_terminate"] });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["overview", "message_agent", "list_files", "say"]));
    expect(names).not.toContain("kill_test");
    expect(names).not.toContain("db_terminate");
    expect(names).not.toContain("cancel");

    expect(await call("list_files", { agentId: "backend" })).toMatchObject({ command: "ls", exitCode: 0, stdout: expect.stringContaining("pom.xml") });
    expect(await raw("list_files", { agentId: "reviewer" })).toMatchObject({ isError: true, json: { message: expect.stringContaining("backend") } }); // no folder of its own
    expect(await raw("say", { word: "-rf" })).toMatchObject({ isError: true }); // a value cannot smuggle in a flag
    expect(await call("say", { word: "hello" })).toMatchObject({ command: "echo hello", stdout: "hello\n" });
    expect((await journal()).map((e) => e.text)).toEqual(["ran say: echo hello (exit 0)"]);
  });
});
