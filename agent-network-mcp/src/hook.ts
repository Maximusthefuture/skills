import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isHandedOver } from "./handoff.js";
import { openFileRequests } from "./mcp/swarm.js";
import { pickNetworkDir } from "./networkDir.js";
import { FileStore } from "./storage/fileStore.js";
import { AgentStore, defaultIsProcessAlive } from "./stores/agentStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type { Agent, Message, Task } from "./types.js";

/**
 * Claude Code hooks: bring swarm messages to an agent that is busy with other tools (PostToolUse) and keep it
 * from leaving the swarm loop while its task is active (Stop). The hook only reads the network; messages are
 * marked read by the server when the agent calls swarm_context or wait. Any failure means "say nothing":
 * a hook must never break the agent's session.
 */

export type HookMode = "post-tool" | "stop";

/** The part of the Claude Code hook input we use. */
export interface HookInput {
  tool_name?: string;
  stop_hook_active?: boolean;
}

/** pid -> parent pid */
export type ProcessTable = Map<number, number>;

export interface HookDeps {
  selfPid: number;
  processTable: () => ProcessTable;
  isProcessAlive: (pid: number) => boolean;
  now: () => Date;
}

const SWARM_TOOL_PREFIX = "mcp__agent-network__";
/** The hook command runs under sh (and maybe one wrapper) below the claude process. */
const MAX_HOOK_DEPTH = 3;
const PREVIEW_CHARS = 120;
const URGENT: ReadonlySet<string> = new Set(["FILE_REQUEST", "BLOCKER", "FIX_REQUEST"]);
/** A read but unanswered FILE_REQUEST is repeated at most this often, not after every tool call. */
const REMIND_MS = 60_000;

/** [pid, parent, grandparent, ...] up to (not including) pid 1. */
export function ancestors(table: ProcessTable, pid: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let cur: number | undefined = pid;
  while (cur !== undefined && cur > 1 && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = table.get(cur);
  }
  return chain;
}

/**
 * The agent whose MCP server runs in the same Claude Code process as this hook: the server's direct parent (the
 * claude process) is a close ancestor of the hook. Only the direct parent counts: a grandparent may be the terminal
 * shared with another session. A server started through a wrapper (npx, sh) is not found; pass --agent then.
 * Two candidates at the same distance, or none, give null.
 */
export function resolveAgentByProcess(table: ProcessTable, selfPid: number, agents: Agent[], isAlive: (pid: number) => boolean): string | null {
  const selfDepth = new Map(ancestors(table, selfPid).map((p, i) => [p, i] as const));
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const a of agents) {
    if (a.status === "OFFLINE" || a.pid === undefined || !isAlive(a.pid)) continue;
    const parent = table.get(a.pid);
    const score = parent === undefined ? undefined : selfDepth.get(parent);
    if (score === undefined || score > MAX_HOOK_DEPTH) continue;
    if (!best || score < best.score) {
      best = { id: a.id, score };
      tie = false;
    } else if (score === best.score && best.id !== a.id) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}

export function readProcessTable(): ProcessTable {
  const table: ProcessTable = new Map();
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 2000 });
    for (const line of out.split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid && ppid !== undefined && !Number.isNaN(ppid)) table.set(pid, ppid);
    }
  } catch {
    // no ps (Windows): identity must come from --agent
  }
  return table;
}

export const defaultHookDeps: HookDeps = {
  selfPid: process.pid,
  processTable: readProcessTable,
  isProcessAlive: defaultIsProcessAlive,
  now: () => new Date(),
};

interface HookState {
  /** "<taskId>/<messageId>" of unread messages the agent was already told about. */
  notified: string[];
  /** "<taskId>/<messageId>" of open FILE_REQUESTs to this agent -> when the hook last reminded about it. */
  reminded?: Record<string, string>;
}

const key = (m: Message): string => `${m.taskId}/${m.id}`;

function preview(m: Message): string {
  const text = m.content.replace(/\s+/g, " ").trim();
  const short = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
  const files = m.files?.length ? ` files: ${m.files.join(", ")}` : "";
  const urgent = URGENT.has(m.type) ? ` (${m.from} is waiting for you)` : "";
  return `- ${m.from} [${m.type}]${urgent}: "${short}"${files}`;
}

function ago(m: Message, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(m.createdAt)) / 1000));
  return s < 120 ? `${s}s` : `${Math.round(s / 60)} min`;
}

function postToolContext(agentId: string, fresh: Message[], stillOpen: Message[], now: Date): string {
  const lines = fresh.length ? [`agent-network: ${fresh.length} new message(s) for ${agentId}:`, ...fresh.map(preview)] : [`agent-network: ${agentId}, other agents are blocked on you.`];
  if (stillOpen.length) {
    lines.push(
      "Still unanswered file requests (reading is not an answer):",
      ...stillOpen.map((m) => `- ${m.from} asked ${ago(m, now)} ago to change: ${(m.files ?? []).join(", ") || "(no files listed)"}`),
      "Answer each now: send_message({to: <requester>, message: <conditions>, grantFiles: [<files>]}) to allow, or a reply with the reason to refuse.",
    );
  }
  if (fresh.length) lines.push("Call swarm_context (agent-network) to read them in full and answer, then continue your work. A FILE_REQUEST, BLOCKER or FIX_REQUEST first: another agent is blocked on it.");
  return lines.join("\n");
}

function stopReason(agentId: string, tasks: Task[], unread: Message[], open: Message[]): string {
  const where = tasks.map((t) => `${t.id} (phase ${t.phase})`).join(", ");
  const inbox = unread.length ? ` You have ${unread.length} unread message(s): ${[...new Set(unread.map((m) => m.from))].join(", ")}.` : "";
  const blocked = open.length ? ` ${[...new Set(open.map((m) => m.from))].join(", ")} wait(s) for your answer to a file request: answer it first (grantFiles or a refusal).` : "";
  return (
    `agent-network: you are ${agentId} in the active swarm task ${where}.${inbox}${blocked} ` +
    "Do not end the turn: call wait() (or swarm_context) of agent-network and continue the loop until nextAction is done. " +
    "If you are deliberately waiting for the user's answer, say so in one line and stop again."
  );
}

export interface HookOptions {
  networkDir: string;
  agent?: string;
}

/** Returns the JSON object to print on stdout, or null to print nothing. */
export async function runHook(mode: HookMode, input: HookInput, opts: HookOptions, deps: HookDeps = defaultHookDeps): Promise<object | null> {
  if (mode === "post-tool" && input.tool_name?.startsWith(SWARM_TOOL_PREFIX)) return null; // the tool response already carries the messages
  if (mode === "stop" && input.stop_hook_active) return null; // remind once per stop, never trap the agent
  if (!isAbsolute(opts.networkDir) || !existsSync(opts.networkDir)) return null;

  const fs = await FileStore.open(resolve(opts.networkDir));
  const agentId = opts.agent ?? resolveAgentByProcess(deps.processTable(), deps.selfPid, await new AgentStore(fs).list(), deps.isProcessAlive);
  if (!agentId) return null;

  const tasks = (await new TaskStore(fs).listForAgent(agentId)).filter((t) => t.status === "ACTIVE" && t.phase !== "DONE");
  if (!tasks.length) return null;
  const messages = new MessageStore(fs);
  const perTask = await Promise.all(tasks.map((t) => messages.list(t.id)));
  const unread = perTask.flat().filter((m) => m.to === agentId && !m.readAt);
  // same rule as the server's nextAction "respond": open until the owner writes back to the requester
  const open = perTask.flatMap((all) => openFileRequests(all)).filter((m) => m.to === agentId);

  if (mode === "stop") {
    // the server told this session to end at a phase change: a fresh session takes the task over
    for (const t of tasks) if (await isHandedOver(fs, agentId, t)) return null;
    return { decision: "block", reason: stopReason(agentId, tasks, unread, open) };
  }

  const now = deps.now();
  const statePath = ["hooks", `${agentId}.json`];
  const state = (await fs.readJson<HookState>(statePath)) ?? { notified: [] };
  const told = new Set(state.notified);
  const fresh = unread.filter((m) => !told.has(key(m)));
  const freshKeys = new Set(fresh.map(key));
  const reminded = state.reminded ?? {};
  const stillOpen = open.filter((m) => !freshKeys.has(key(m)) && now.getTime() - Date.parse(reminded[key(m)] ?? "1970-01-01T00:00:00Z") >= REMIND_MS);
  if (!fresh.length && !stillOpen.length) return null;

  const nextReminded: Record<string, string> = {};
  for (const m of open) {
    const k = key(m);
    const last = freshKeys.has(k) || stillOpen.includes(m) ? now.toISOString() : reminded[k];
    if (last) nextReminded[k] = last;
  }
  // answered requests and read messages drop out, the file stays small
  await fs.writeJson(statePath, { notified: unread.map(key), reminded: nextReminded } satisfies HookState);
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: postToolContext(agentId, fresh, stillOpen, now) } };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** `agent-network-mcp hook <post-tool|stop> [--network-dir <abs>] [--agent <id>]`; always exits 0. */
export async function runHookCli(mode: string | undefined, args: string[], env: NodeJS.ProcessEnv, out: (s: string) => void, stdin: () => Promise<string> = readStdin, cwd: string = process.cwd()): Promise<number> {
  if (mode !== "post-tool" && mode !== "stop") {
    out("Usage: agent-network-mcp hook <post-tool|stop> [--network-dir <abs path>] [--agent <id>]");
    return 2;
  }
  try {
    const { values } = parseArgs({ args, options: { "network-dir": { type: "string" }, agent: { type: "string" } } });
    // without a path: the network of the session's git repository; runHook does nothing when it does not exist
    const networkDir = pickNetworkDir(values["network-dir"], env, cwd).dir;
    if (!networkDir) return 0;
    let input: HookInput = {};
    try {
      input = JSON.parse((await stdin()) || "{}") as HookInput;
    } catch {
      // unreadable input: act as if there were no extra flags
    }
    const result = await runHook(mode, input, { networkDir, ...(values.agent ? { agent: values.agent } : {}) });
    if (result) out(JSON.stringify(result));
  } catch {
    // never break the agent's session
  }
  return 0;
}
