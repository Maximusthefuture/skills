import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError, isAppError } from "../errors.js";
import { defineTool, errorResult } from "../mcp/toolkit.js";
import { dirname } from "node:path";
import { dbActivity, dbTerminate, execTool, foldersFromEnv, killTest, listProcesses, threadDump, type Exec, type Folder } from "./system.js";
import { buildCall, needsAgent, runCommand, type CustomTool, type RunCommand } from "./tools.js";

/**
 * The supervisor's MCP server (`agent-network-mcp supervisor-mcp`), started by its CLI session. Every change goes
 * through the page's own HTTP API (the same checks as your buttons, and the page's journal records it as the
 * supervisor's); the machine is looked at only through system.ts. It cannot cancel a task, change code or merge.
 */
export interface SupervisorServerOptions {
  uiUrl: string;
  project: string;
  folders: Folder[];
  /** The network's folder; its parent is the project folder (the default cwd of the operator's own commands). */
  networkDir?: string;
  /** The operator's own commands (runners.json "supervisor.tools"). */
  tools?: CustomTool[];
  /** Tools switched off, built-in or own. */
  disabled?: string[];
  exec?: Exec;
  run?: RunCommand;
  fetch?: typeof fetch;
}

export const SUPERVISOR_INSTRUCTIONS =
  "You are the supervisor of an agent-network swarm: the operator's deputy. Start with overview, then look into the incidents of your task. " +
  "Fix what is mechanical yourself (answer process questions, free a hung test, explain a refused command, give a stuck fix one more round or to the lead) and tell the task's lead what you did with message_lead: the lead passes it on to the agents it concerns. " +
  "What only the human can decide (requirements, scope, design, cancelling, anything irreversible) goes to escalate with your recommendation. Record every finding with note.";

export function supervisorOptionsFromEnv(env: NodeJS.ProcessEnv): SupervisorServerOptions {
  const uiUrl = env.AGENT_NETWORK_UI_URL;
  if (!uiUrl) throw new AppError("INVALID_CONFIG", "AGENT_NETWORK_UI_URL is not set: the supervisor's tools are started by the supervisor (ui --runners with a \"supervisor\" section)");
  let own: { tools?: CustomTool[]; disabled?: string[] } = {};
  try {
    own = JSON.parse(env.AGENT_NETWORK_SUPERVISOR_TOOLS ?? "{}") as typeof own;
  } catch {
    // no own tools
  }
  return { uiUrl, project: env.AGENT_NETWORK_PROJECT ?? "", folders: foldersFromEnv(env), ...(env.NETWORK_DIR ? { networkDir: env.NETWORK_DIR } : {}), tools: own.tools ?? [], disabled: own.disabled ?? [] };
}

type Json = Record<string, any>;

export function createSupervisorServer(o: SupervisorServerOptions): McpServer {
  const server = new McpServer({ name: "agent-network-supervisor", version: "0.1.0" }, { instructions: SUPERVISOR_INSTRUCTIONS });
  const exec = o.exec ?? execTool;
  const http = o.fetch ?? fetch;
  const onError = (e: unknown) => errorResult({ error: isAppError(e) ? e.code : "INTERNAL_ERROR", message: e instanceof Error ? e.message : String(e) });
  const api = async (method: "GET" | "POST", path: string, body?: unknown): Promise<Json> => {
    const sep = path.includes("?") ? "&" : "?";
    const res = await http(`${o.uiUrl}${path}${o.project ? `${sep}project=${encodeURIComponent(o.project)}` : ""}`, {
      method,
      headers: { "content-type": "application/json", "x-agent-network-actor": "supervisor" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : method === "POST" ? { body: "{}" } : {}),
    });
    const text = await res.text();
    let json: Json;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = { message: text };
    }
    if (!res.ok) throw new AppError(json.error ?? "INVALID_INPUT", json.message ?? `${method} ${path}: ${res.status}`);
    return json;
  };
  const note = (kind: "note" | "action" | "needs-you", text: string, taskId?: string, messageId?: string) => api("POST", "/api/supervisor/note", { kind, text, ...(taskId ? { taskId } : {}), ...(messageId ? { messageId } : {}) });
  const state = () => api("GET", "/api/state");
  const task = async (taskId: string) => {
    const t = ((await state()).tasks as Json[]).find((x) => x.id === taskId);
    if (!t) throw new AppError("TASK_NOT_FOUND", `No task ${taskId} in this project`);
    return t;
  };
  const off = new Set(o.disabled ?? []);
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) => {
    if (!off.has(name)) defineTool(server, onError, name, description, shape, handler); // switched off by the operator
  };
  const short = (s: unknown, n: number) => (typeof s === "string" && s.length > n ? `${s.slice(0, n)}…` : s);

  tool("overview", "The whole project at a glance: open tasks (phase, status, who they wait on, subtask progress, blocked reason, handover), open questions to the operator, the agents' runners and sessions, your journal's latest entries.", {}, async () => {
    const s = await state();
    const journal = await api("GET", "/api/supervisor").catch(() => ({ journal: [] as Json[] }));
    return {
      tasks: (s.tasks as Json[]).filter((t) => t.status === "ACTIVE" || t.status === "BLOCKED").map((t) => ({
        id: t.id, title: t.title, phase: t.phase, status: t.status, syncRound: t.syncRound, maxFixRounds: t.maxFixRounds, waitingOn: t.waitingOn,
        ...(t.blockedReason ? { blockedReason: t.blockedReason } : {}), ...(t.handover ? { handover: t.handover } : {}), ...(t.takeover ? { takeover: t.takeover } : {}),
        agents: t.agents.map((a: string) => {
          const steps = (t.subtasks?.[a] ?? []) as Json[];
          const impl = (t.implementations as Json[]).find((i) => i.agentId === a);
          return { id: a, subtasks: `${steps.filter((x) => x.status === "DONE").length}/${steps.length}`, implementation: impl?.status ?? null };
        }),
        lastMessages: (t.messages as Json[]).slice(-3).map((m) => ({ from: m.from, to: m.to, content: short(m.content, 200) })),
      })),
      openQuestions: (s.openQuestions as Json[]).map((q) => ({ taskId: q.taskId, messageId: q.messageId, from: q.from, question: q.question, ...(q.choices ? { choices: q.choices } : {}), askedAt: q.askedAt })),
      runners: ((s.control?.runners ?? []) as Json[]).map((r) => ({ id: r.id, running: r.running, model: r.model, session: r.session, cwd: r.cwd })),
      journal: ((journal.journal ?? []) as Json[]).slice(-15).map((e) => ({ at: e.at, kind: e.kind, by: e.by, taskId: e.taskId, text: short(e.text, 300) })),
    };
  });

  tool("task_detail", "One task in depth: agreement (assignments, interfaces), implementations, this round's review findings, subtasks per agent, the latest 15 messages.", { taskId: z.string().describe("e.g. task-001") }, async ({ taskId }) => {
    const t = await task(taskId);
    const a = t.agreement as Json | null;
    return {
      id: t.id, title: t.title, description: short(t.description, 1500), phase: t.phase, status: t.status, syncRound: t.syncRound,
      agreement: a ? { summary: a.summary, decisions: a.decisions, interfaces: a.interfaces, assignments: (a.assignments as Json[]).map((x) => ({ agentId: x.agentId, responsibility: short(x.responsibility, 400), files: (x.files ?? []).slice(0, 12), ...(x.tasks ? { tasks: x.tasks } : {}), ...(x.dependsOn ? { dependsOn: x.dependsOn } : {}) })) } : null,
      implementations: (t.implementations as Json[]).map((i) => ({ agentId: i.agentId, status: i.status, summary: short(i.summary, 400), commits: i.commits, filesChanged: (i.filesChanged ?? []).length })),
      reviews: (t.syncReports as Json[]).filter((r) => r.round === t.syncRound).map((r) => ({ agentId: r.agentId, status: r.status, findings: r.findings })),
      subtasks: Object.fromEntries(Object.entries((t.subtasks ?? {}) as Record<string, Json[]>).map(([k, v]) => [k, v.map((x) => `${x.id} [${x.status}] ${x.title}`)])),
      messages: (t.messages as Json[]).slice(-15).map((m) => ({ id: m.id, from: m.from, to: m.to, type: m.type, at: m.createdAt, content: short(m.content, 600) })),
    };
  });

  tool("agent_log", "What an agent did lately, oldest first: its tool calls with their arguments, the results (ok or error, how long), its text and the runner's own lines.", { agentId: z.string(), events: z.number().int().min(10).max(300).optional().describe("default 60") }, async ({ agentId, events }) => {
    const feed = (await api("GET", `/api/activity?agent=${encodeURIComponent(agentId)}&limit=${events ?? 60}`)).events as Json[];
    if (!feed.length) return { agentId, lines: ((await api("GET", `/api/runners/${encodeURIComponent(agentId)}/log`)).lines as string[]).slice(-(events ?? 60)) };
    return {
      agentId,
      events: feed
        .filter((e) => e.kind !== "thinking")
        .map((e) => `${String(e.at).slice(11, 19)} ${e.kind}${e.tool ? ` ${e.tool}` : ""}${e.kind === "tool_result" ? (e.isError ? " ERROR" : " ok") : ""}${e.durationMs !== undefined ? ` ${Math.round(e.durationMs / 1000)}s` : ""}: ${short(e.summary, 300)}`),
    };
  });

  tool("answer_question", "Answer a question an agent asked the operator, when it is a process or technical question you can answer. Requirements and scope go to escalate. A question with choices: answer 'Chosen: \"<label>\"' and why.", { taskId: z.string(), messageId: z.string(), answer: z.string() }, async (a) => (await api("POST", "/api/questions/answer", a)).answer);

  tool("message_lead", "Tell the lead of a task what you found and what to do; the lead acts on it and passes on to the agents it concerns (it gets it as a message from the operator, also while busy). Name the agent it is about in the text.", { taskId: z.string(), text: z.string() }, async ({ taskId, text }) => (await api("POST", `/api/tasks/${encodeURIComponent(taskId)}/message`, { text })).message);

  tool("unblock", "Give a BLOCKED task more fix rounds (1..3) when another try is likely to work. Not for a task blocked by its cost limit (blockedReason \"cost limit ...\"): money is the operator's call, escalate it.", { taskId: z.string(), rounds: z.number().int().min(1).max(3).optional() }, async ({ taskId, rounds }) => {
    const t = (await api("POST", `/api/tasks/${encodeURIComponent(taskId)}/unblock`, { rounds: rounds ?? 1 })).task as Json;
    return { id: t.id, phase: t.phase, status: t.status, maxFixRounds: t.maxFixRounds };
  });

  tool("hand_over", "Give a BLOCKED task's stuck fix to its lead for one round now (only when the task offers a handover).", { taskId: z.string() }, async ({ taskId }) => {
    const t = (await api("POST", `/api/tasks/${encodeURIComponent(taskId)}/handover`)).task as Json;
    return { id: t.id, phase: t.phase, status: t.status, takeover: t.takeover };
  });

  tool("note", "Record what you found or decided in your journal on the page (short, concrete).", { text: z.string(), taskId: z.string().optional() }, async ({ text, taskId }) => (await note("note", text, taskId)).entry);

  tool(
    "escalate",
    "Hand a decision only the human can take to the operator, with your recommendation; it stays on the page until they look. When it is about an agent's question to the operator, give its messageId: marking the decision done closes that question too.",
    { taskId: z.string(), question: z.string(), recommendation: z.string(), messageId: z.string().optional().describe("the agent's question (msg-NNN) this decision answers, if any") },
    async ({ taskId, question, recommendation, messageId }) => (await note("needs-you", `${question}\nRecommendation: ${recommendation}`, taskId, messageId)).entry,
  );

  tool("processes", "Test JVMs (surefire, maven) running in the agents' folders, with how long they run.", {}, async () => (await listProcesses(o.folders, exec)).map((p) => ({ pid: p.pid, agentId: p.agentId, minutes: Math.round(p.elapsedSec / 60), command: short(p.command, 300) })));

  tool("thread_dump", "jstack of one test JVM from processes, cut to the main thread and the threads in project or test code: shows where a test hangs.", { pid: z.number().int() }, async ({ pid }) => threadDump(pid, o.folders, exec));

  tool("kill_test", "End a hung test JVM from processes (SIGTERM, then SIGKILL): the agent's test run fails instead of hanging. Tell the lead which agent's test it was and why with message_lead.", { pid: z.number().int(), reason: z.string() }, async ({ pid, reason }) => {
    const res = await killTest(pid, o.folders, exec);
    await note("action", `killed test process ${pid} of ${res.agentId} (${res.killed}): ${reason}`);
    return res;
  });

  tool("db_activity", "pg_stat_activity of the PostgreSQL containers started by Testcontainers: who waits on a lock, which transaction sits idle.", {}, async () => dbActivity(exec));

  tool("db_terminate", "End one connection (backend pid) in a Testcontainers PostgreSQL, e.g. an 'idle in transaction' that holds the lock a migration waits for.", { container: z.string(), pid: z.number().int(), reason: z.string() }, async ({ container, pid, reason }) => {
    const out = await dbTerminate(container, pid, exec);
    await note("action", `${out}: ${reason}`);
    return out;
  });

  // the operator's own commands: argv without a shell, every parameter checked (tools.ts)
  const projectDir = o.networkDir ? dirname(o.networkDir) : process.cwd();
  const run = o.run ?? runCommand;
  for (const t of o.tools ?? []) {
    const shape: Record<string, z.ZodType> = {};
    if (needsAgent(t)) shape.agentId = o.folders.length ? z.enum(o.folders.map((f) => f.agentId) as [string, ...string[]]).describe("the agent whose folder it uses") : z.string();
    for (const [p, def] of Object.entries(t.params ?? {})) {
      const base = def.type === "integer" ? z.number().int() : def.enum ? z.enum(def.enum as [string, ...string[]]) : z.string();
      shape[p] = def.description ? base.describe(def.description) : base;
    }
    tool(t.name, `${t.description}${t.action ? " (changes something: recorded in the journal)" : ""}`, shape as z.ZodRawShape, async (args) => {
      const call = buildCall(t, args as Record<string, unknown>, { projectDir, networkDir: o.networkDir ?? "", folders: o.folders });
      const res = await run(call.argv, call.cwd, (t.timeoutSec ?? 60) * 1000);
      if (t.action) await note("action", `ran ${t.name}: ${call.argv.join(" ")} (exit ${res.exitCode})`);
      return { command: call.argv.join(" "), cwd: call.cwd, ...res };
    });
  }
  return server;
}
