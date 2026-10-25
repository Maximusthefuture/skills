import { execFile } from "node:child_process";
import { AppError } from "../errors.js";

/**
 * The supervisor's tools: the built-in ones (mcp.ts) and the operator's own commands from runners.json
 * ("supervisor.tools"). Any of them can be switched off ("supervisor.disabledTools", or on the page). A command is an
 * argv run without a shell; {param} placeholders take the tool's parameters, checked against their type, enum or
 * pattern, so a value cannot smuggle in a flag or a second command.
 */

export const BUILTIN_TOOLS = [
  "overview",
  "task_detail",
  "agent_log",
  "answer_question",
  "message_lead",
  "unblock",
  "hand_over",
  "set_aside",
  "note",
  "escalate",
  "processes",
  "thread_dump",
  "kill_test",
  "db_activity",
  "db_terminate",
] as const;

/** For the page: what each built-in tool does. */
export const BUILTIN_DESCRIPTIONS: Record<(typeof BUILTIN_TOOLS)[number], string> = {
  overview: "all open tasks, questions, runners, the journal",
  task_detail: "one task: agreement, reports, findings, subtasks, messages",
  agent_log: "an agent's latest tool calls, results and text",
  answer_question: "answer an agent's question to the operator",
  message_lead: "write to the task's lead, who passes it on",
  unblock: "more fix rounds for a BLOCKED task",
  hand_over: "a BLOCKED task's stuck fix to the lead",
  set_aside: "put a BLOCKED task aside: its agents take their next task meanwhile",
  note: "a note in the journal",
  escalate: "a decision for the human, with a recommendation",
  processes: "test JVMs in the agents' folders",
  thread_dump: "jstack of a test JVM",
  kill_test: "end a hung test JVM",
  db_activity: "pg_stat_activity of the Testcontainers databases",
  db_terminate: "end one connection in a Testcontainers database",
};

export interface ToolParam {
  type: "string" | "integer";
  description?: string;
  /** Only these values. */
  enum?: string[];
  /** A string must match it (default: a word, a path or a host:port; no spaces, not starting with "-"). */
  pattern?: string;
}

export interface CustomTool {
  name: string;
  description: string;
  /** argv; placeholders {param}, {agentCwd} (with an agentId parameter), {projectDir}, {networkDir}. */
  command: string[];
  params?: Record<string, ToolParam>;
  /** Where it runs: default {projectDir}; "{agentCwd}" = the folder of the agent named by agentId. */
  cwd?: string;
  /** Default 60, at most 600. */
  timeoutSec?: number;
  /** It changes something: every run goes into the journal as the supervisor's action. */
  action?: boolean;
}

export const SAFE_VALUE = /^[A-Za-z0-9_./:@%+=,][A-Za-z0-9_./:@%+=,-]{0,199}$/;
const NAME = /^[a-z][a-z0-9_]{1,40}$/;
const PLACEHOLDER = /\{(\w+)\}/g;
const CONTEXT = ["agentCwd", "projectDir", "networkDir"];

/** Checks one tool from the config; returns it normalized. */
export function parseCustomTool(raw: unknown, where: string): CustomTool {
  const bad = (what: string): never => {
    throw new AppError("INVALID_CONFIG", `${where}: ${what}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("a tool must be an object {name, description, command, params?}");
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== "string" || !NAME.test(t.name)) bad(`tool name ${JSON.stringify(t.name)}: lowercase letters, digits and _ (2..41 chars)`);
  const name = t.name as string;
  if ((BUILTIN_TOOLS as readonly string[]).includes(name)) bad(`tool "${name}" is a built-in tool: choose another name (to switch the built-in off, list it in "disabledTools")`);
  if (typeof t.description !== "string" || !t.description.trim()) bad(`tool "${name}" needs a "description": the supervisor chooses tools by it`);
  if (!Array.isArray(t.command) || !t.command.length || !t.command.every((c) => typeof c === "string" && c.length)) bad(`tool "${name}" needs "command": an argv array, e.g. ["docker", "ps"]`);
  const params: Record<string, ToolParam> = {};
  if (t.params !== undefined) {
    if (!t.params || typeof t.params !== "object" || Array.isArray(t.params)) bad(`tool "${name}" "params" must be an object {"<param>": {"type": "string"|"integer", ...}}`);
    for (const [p, def] of Object.entries(t.params as Record<string, unknown>)) {
      if (!/^\w{1,40}$/.test(p) || CONTEXT.includes(p)) bad(`tool "${name}" param "${p}": a word, not one of ${CONTEXT.join(", ")}`);
      const d = def as Record<string, unknown>;
      if (!d || (d.type !== "string" && d.type !== "integer")) bad(`tool "${name}" param "${p}": "type" must be "string" or "integer"`);
      if (d.enum !== undefined && (!Array.isArray(d.enum) || !d.enum.length || !d.enum.every((v) => typeof v === "string"))) bad(`tool "${name}" param "${p}": "enum" must be a list of strings`);
      if (d.pattern !== undefined) {
        if (typeof d.pattern !== "string") bad(`tool "${name}" param "${p}": "pattern" must be a regular expression string`);
        try {
          new RegExp(d.pattern as string);
        } catch {
          bad(`tool "${name}" param "${p}": "pattern" is not a valid regular expression`);
        }
      }
      params[p] = { type: d.type as ToolParam["type"], ...(typeof d.description === "string" ? { description: d.description } : {}), ...(d.enum ? { enum: d.enum as string[] } : {}), ...(d.pattern ? { pattern: d.pattern as string } : {}) };
    }
  }
  const cwd = typeof t.cwd === "string" && t.cwd ? t.cwd : undefined;
  for (const part of [...(t.command as string[]), ...(cwd ? [cwd] : [])]) {
    for (const m of part.matchAll(PLACEHOLDER)) if (!(m[1]! in params) && !CONTEXT.includes(m[1]!)) bad(`tool "${name}": {${m[1]}} is neither a param nor one of {agentCwd}, {projectDir}, {networkDir}`);
  }
  const timeout = t.timeoutSec === undefined ? 60 : t.timeoutSec;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 600) bad(`tool "${name}" timeoutSec must be an integer 1..600`);
  return { name, description: (t.description as string).trim(), command: t.command as string[], ...(Object.keys(params).length ? { params } : {}), ...(cwd ? { cwd } : {}), timeoutSec: timeout as number, ...(t.action === true ? { action: true } : {}) };
}

/** A tool that names {agentCwd} gets an agentId parameter: the agent whose folder it uses. */
export const needsAgent = (t: CustomTool): boolean => [...t.command, t.cwd ?? ""].some((p) => p.includes("{agentCwd}"));

export interface ToolContext {
  projectDir: string;
  networkDir: string;
  folders: { agentId: string; cwd: string }[];
}

/** argv and cwd of one call, with every value checked. */
export function buildCall(t: CustomTool, args: Record<string, unknown>, ctx: ToolContext): { argv: string[]; cwd: string } {
  const values: Record<string, string> = { projectDir: ctx.projectDir, networkDir: ctx.networkDir };
  if (needsAgent(t)) {
    const folder = ctx.folders.find((f) => f.agentId === args.agentId);
    if (!folder) throw new AppError("INVALID_INPUT", `agentId must be one of: ${ctx.folders.map((f) => f.agentId).join(", ") || "(no agent folders)"}`);
    values.agentCwd = folder.cwd;
  }
  for (const [p, def] of Object.entries(t.params ?? {})) {
    const v = args[p];
    if (v === undefined) throw new AppError("INVALID_INPUT", `${t.name}: "${p}" is required`);
    if (def.type === "integer") {
      if (typeof v !== "number" || !Number.isInteger(v)) throw new AppError("INVALID_INPUT", `${t.name}: "${p}" must be an integer`);
      values[p] = String(v);
      continue;
    }
    if (typeof v !== "string") throw new AppError("INVALID_INPUT", `${t.name}: "${p}" must be a string`);
    const ok = def.enum ? def.enum.includes(v) : new RegExp(def.pattern ?? SAFE_VALUE.source).test(v);
    if (!ok) throw new AppError("INVALID_INPUT", `${t.name}: "${p}" ${def.enum ? `must be one of ${def.enum.join(", ")}` : `does not match ${def.pattern ?? "a plain word or path (no spaces, not starting with -)"}`}`);
    values[p] = v;
  }
  const fill = (s: string) => s.replace(PLACEHOLDER, (_, k: string) => values[k] ?? "");
  return { argv: t.command.map(fill), cwd: fill(t.cwd ?? "{projectDir}") };
}

export interface CallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (argv: string[], cwd: string, timeoutMs: number) => Promise<CallResult>;

/** Runs without a shell; a non-zero exit is a result, not an error. Output is cut to its last part. */
export const runCommand: RunCommand = (argv, cwd, timeoutMs) =>
  new Promise((done) =>
    execFile(argv[0]!, argv.slice(1), { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);
      done({ exitCode: code, stdout: tail(String(stdout), 12_000), stderr: tail(String(stderr || (err && !stdout && !stderr ? err.message : "")), 4000) });
    }),
  );
