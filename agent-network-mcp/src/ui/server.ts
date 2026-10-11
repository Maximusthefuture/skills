import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { AppError, isAppError } from "../errors.js";
import { readGitContext } from "../git.js";
import { assertChangeName, changePath, hasChange, listChanges, type Exec } from "../openspec.js";
import { NetworkService } from "../service.js";
import type { Prices } from "../stats.js";
import { FileStore } from "../storage/fileStore.js";
import { MessageStore } from "../stores/messageStore.js";
import { TaskStore } from "../stores/taskStore.js";
import type { GitContext } from "../types.js";
import { PAGE_HTML } from "./page.js";
import { listRuns, queueStates, taskState, type RunView } from "./runs.js";
import type { RunnerPool } from "./runners.js";
import { Journal } from "../supervisor/journal.js";
import { formatSessionLog, readSessionLog } from "../supervisor/sessionLog.js";
import type { Supervisor } from "../supervisor/supervisor.js";
import type { Scheduler } from "../schedule/scheduler.js";
import { buildUiState } from "./state.js";
import { nextRun, parseCron } from "../schedule/cron.js";
import { branchDiff, fileDiff, mergeProjectInto, removeWorktrees, type MergeResult } from "../worktrees.js";

export interface UiServer {
  server: Server;
  url: string;
  /** Each project's id on the page (?project=<id>). */
  projects: { id: string; networkDir: string }[];
  close(): Promise<void>;
}

/** One project on the page: a network (<project>/.agent-network) and, in control mode, its runners. */
export interface UiProject {
  networkDir: string;
  /** Control mode: the page may create tasks and start/stop these runners. Without it the project is read-only. */
  runners?: RunnerPool;
  /** The project's token prices (runners.json "prices"), read on every refresh: sessions without a CLI cost are priced with them. */
  prices?: () => Promise<{ prices?: Prices; error?: string }>;
  /** The agent that looks after the others when something goes wrong (runners.json "supervisor"). */
  supervisor?: Supervisor;
  /** Tasks created on a cron (runners.json "schedules"). */
  scheduler?: Scheduler;
  /** Cost limit (USD) of a task created on the page without one (runners.json "maxTaskCostUsd"). */
  maxTaskCostUsd?: number;
}

export interface UiOptions {
  port?: number;
  host?: string;
  /** Single project (startUiServer(networkDir, ...)): its runners. */
  runners?: RunnerPool;
  /** Single project: its token prices. */
  prices?: UiProject["prices"];
  /** Runs the openspec CLI for "archive" (tests replace it). */
  openspecExec?: Exec;
  /** Tests: the git merge of "Влить в проект". */
  merge?: (project: string, branch: string, message: string) => Promise<MergeResult>;
}

interface Project {
  id: string;
  name: string;
  networkDir: string;
  projectDir: string;
  fs: FileStore;
  journal: Journal;
  pool?: RunnerPool;
  supervisor?: Supervisor;
  scheduler?: Scheduler;
  operator?: NetworkService;
  prices?: UiProject["prices"];
  maxTaskCostUsd?: number;
  git?: { at: number; value: Promise<GitContext | null> };
}

const MAX_BODY = 64 * 1024;
const GIT_TTL_MS = 15_000;
const DAY_MS = 24 * 3600 * 1000;

type Reply = { status: number; type: string; body: string };
const json = (status: number, value: unknown): Reply => ({ status, type: "application/json", body: JSON.stringify(value) });
const text = (status: number, body: string): Reply => ({ status, type: "text/plain; charset=utf-8", body });

/** The lead's own branch of a task: its auto worktree's, else the branch checked out in its own folder. */
async function leadBranch(p: { pool?: RunnerPool; projectDir: string }, task: { agents: string[] }): Promise<{ project: string; branch: string }> {
  const lead = task.agents[0]!;
  const folder = p.pool?.agentFolder(lead);
  const project = folder?.worktree?.project ?? p.projectDir;
  const branch = folder?.worktree?.branch ?? (folder?.cwd && resolve(folder.cwd) !== p.projectDir ? (await readGitContext(folder.cwd))?.branch : undefined);
  if (!branch || branch === "HEAD") {
    throw new AppError("INVALID_INPUT", `${lead} (the lead) has no branch of its own: it works in the project folder${folder?.cwd ? ` or on no branch in ${folder.cwd}` : ""}, so its commits are there already`);
  }
  return { project, branch };
}

/** A path for the page: the home folder as "~". */
const tilde = (path: string): string => {
  const home = homedir();
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
};

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/**
 * GET / (page), GET /api/projects, and per project (?project=<id>, default: the first one): GET /api/state, /api/runs,
 * /api/openspec/changes, /api/runners/<id>/log; with runners also POST /api/tasks, /api/runners/<id>/start|stop|instructions|model,
 * /api/questions/answer, /api/openspec/archive, /api/tasks/<id>/unblock|handover|cancel|message|merge, /api/worktrees/clean, /api/supervisor/start|stop|model|tools|note|resolve
 * (GET /api/supervisor, /api/activity). Bound to loopback; foreign Host headers are refused, and state-changing
 * requests must be same-origin JSON (a page on another site cannot create tasks for the agents).
 */
export async function startUiServer(target: string | UiProject[], opts: UiOptions = {}): Promise<UiServer> {
  const specs: UiProject[] =
    typeof target === "string" ? [{ networkDir: target, ...(opts.runners ? { runners: opts.runners } : {}), ...(opts.prices ? { prices: opts.prices } : {}) }] : target;
  if (!specs.length) throw new AppError("INVALID_CONFIG", "No project to show");
  const projects: Project[] = [];
  for (const spec of specs) {
    const networkDir = resolve(spec.networkDir);
    if (projects.some((p) => p.networkDir === networkDir)) throw new AppError("INVALID_CONFIG", `Two projects use the same network ${networkDir}`);
    const projectDir = dirname(networkDir);
    const base = slug(basename(projectDir));
    let id = base;
    for (let n = 2; projects.some((p) => p.id === id); n++) id = `${base}-${n}`;
    projects.push({
      id,
      name: basename(projectDir),
      networkDir,
      projectDir,
      fs: await FileStore.open(networkDir),
      journal: new Journal(await FileStore.open(networkDir)),
      ...(spec.runners ? { pool: spec.runners, operator: await NetworkService.create(networkDir, { id: "operator", type: "ui" }) } : {}),
      ...(spec.prices ? { prices: spec.prices } : {}),
      ...(spec.runners && spec.supervisor ? { supervisor: spec.supervisor } : {}),
      ...(spec.runners && spec.scheduler ? { scheduler: spec.scheduler } : {}),
      ...(spec.maxTaskCostUsd !== undefined ? { maxTaskCostUsd: spec.maxTaskCostUsd } : {}),
    });
  }
  const host = opts.host ?? "127.0.0.1";

  /** Agents in their own worktree see only committed work: the change must be in each runner's folder already. */
  /** The agents (of `agents`) whose folder lacks the change; an auto worktree not created yet will get it from HEAD. */
  async function foldersWithoutChange(p: Project, change: string, agents: string[]): Promise<{ id: string; cwd: string }[]> {
    const missing: { id: string; cwd: string }[] = [];
    for (const r of p.pool?.list() ?? []) {
      if (!agents.includes(r.id) || !r.cwd || resolve(r.cwd) === p.projectDir) continue;
      if (!existsSync(r.cwd) && p.pool?.agentFolder(r.id)?.worktree) continue;
      if (!(await hasChange(r.cwd, change))) missing.push({ id: r.id, cwd: r.cwd });
    }
    return missing;
  }

  async function checkAgentFolders(p: Project, change: string, agents: string[]): Promise<void> {
    const missing = (await foldersWithoutChange(p, change, agents)).map((m) => `${m.id} (${m.cwd})`);
    if (missing.length) {
      throw new AppError(
        "OPENSPEC_NOT_FOUND",
        `${changePath(change)} is not in the folder of ${missing.join(", ")}: commit the change and merge it into those agents' branches (an agent in its own worktree sees only committed work).`,
      );
    }
  }

  function gitOf(p: Project): Promise<GitContext | null> {
    if (!p.git || Date.now() - p.git.at > GIT_TTL_MS) p.git = { at: Date.now(), value: readGitContext(p.projectDir).catch(() => null) };
    return p.git.value;
  }

  /** Sessions open right now (from the runners) followed by the recorded ones, newest first. */
  async function runsOf(p: Project, pricing: { prices?: Prices }): Promise<RunView[]> {
    const tasks = await new TaskStore(p.fs).list();
    const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? "";
    const now = Date.now();
    const live: RunView[] = (p.pool?.list() ?? [])
      .filter((r) => r.session)
      .map((r) => ({
        id: "",
        seq: null,
        taskId: r.session!.taskId,
        taskTitle: title(r.session!.taskId),
        taskState: taskState(tasks.find((t) => t.id === r.session!.taskId)),
        alsoFinished: [],
        numTurns: null,
        recordPath: null,
        agentId: r.id,
        attempt: r.session!.attempt,
        model: r.session!.model ?? r.model,
        startedAt: r.session!.startedAt,
        endedAt: null,
        durationMs: Math.max(0, now - Date.parse(r.session!.startedAt)),
        status: "running",
        exitCode: null,
        usage: null,
        costUsd: null,
        costEstimated: false,
      }));
    return [...live, ...(await listRuns(p.fs, tasks, pricing.prices))];
  }

  /** One row of the Projects page. */
  async function summary(p: Project) {
    const tasks = await new TaskStore(p.fs).list();
    const queue = [...queueStates(tasks).values()];
    const count = (s: string) => queue.filter((q) => q === s).length;
    const pricing = (await p.prices?.()) ?? {};
    const runs = await runsOf(p, pricing);
    const recent = runs.filter((r) => r.endedAt && Date.now() - Date.parse(r.endedAt) <= DAY_MS);
    const priced = recent.filter((r) => r.costUsd !== null);
    const messages = new MessageStore(p.fs);
    const open = tasks.filter((t) => t.status === "ACTIVE" || t.status === "BLOCKED");
    const questions = (await Promise.all(open.map((t) => messages.list(t.id)))).flat().filter((m) => m.to === "operator" && m.type === "QUESTION" && !m.readAt).length;
    const runners = p.pool?.list() ?? null;
    const git = await gitOf(p);
    const times = [...tasks.map((t) => t.updatedAt), ...runs.map((r) => r.endedAt ?? r.startedAt)].sort();
    return {
      id: p.id,
      name: p.name,
      projectDir: tilde(p.projectDir),
      networkDir: tilde(p.networkDir),
      control: !!p.pool,
      git: git ? { branch: git.branch, head: git.commit.slice(0, 7) } : null,
      tasks: { running: count("running"), queued: count("queued"), blocked: count("blocked"), done: count("done"), cancelled: count("cancelled"), total: tasks.length },
      runners: runners ? { running: runners.filter((r) => r.running).length, working: runners.filter((r) => r.session).length, total: runners.length } : null,
      openspec: (await listChanges(p.projectDir)).length,
      openQuestions: questions,
      spend24h: {
        usd: priced.length ? priced.reduce((sum, r) => sum + r.costUsd!, 0) : null,
        estimated: priced.some((r) => r.costEstimated),
        unpriced: recent.filter((r) => r.usage && r.costUsd === null).length,
      },
      lastActivity: times.at(-1) ?? null,
      pricesError: pricing.error ?? null,
    };
  }

  /** For every refresh of the page: is the supervisor on, busy, held; the decisions waiting for you; its latest entries (pop-ups). */
  async function supervisorBrief(p: Project) {
    if (!p.supervisor && !p.pool) return null;
    const journal = await p.journal.list(60);
    // a decision about a question that has been answered (on the page, from the terminal) no longer waits for you
    for (const e of journal) {
      const asked = (e.data as { messageId?: unknown } | undefined)?.messageId;
      if (e.kind !== "needs-you" || e.resolvedAt || !e.taskId || typeof asked !== "string") continue;
      const q = await new MessageStore(p.fs).get(e.taskId, asked).catch(() => null);
      if (q?.readAt) Object.assign(e, await p.journal.resolve(e.id));
    }
    const st = p.supervisor ? await p.supervisor.status() : null;
    return {
      available: !!st,
      enabled: st?.enabled ?? false,
      working: !!st?.session,
      held: st?.held ?? null,
      queued: st?.queued ?? 0,
      model: st?.model ?? null,
      needsYou: journal.filter((e) => e.kind === "needs-you" && !e.resolvedAt),
      recent: journal.slice(-20),
    };
  }

  const server = createServer((req, res) => {
    void handle(req).then(
      ({ status, type, body }) => {
        res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
        res.end(body);
      },
      (e: unknown) => {
        const known = isAppError(e);
        res.writeHead(known ? 400 : 500, { "content-type": "application/json" });
        res.end(JSON.stringify(known ? { error: e.code, message: e.message } : { error: "INTERNAL_ERROR", message: "internal error" }));
      },
    );
  });

  async function handle(req: IncomingMessage): Promise<Reply> {
    const hostHeader = req.headers.host ?? "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hostHeader)) return text(403, "forbidden host");
    const url = new URL(req.url ?? "/", "http://ui.local");
    const path = url.pathname;
    const method = req.method ?? "";
    const wanted = url.searchParams.get("project");
    const p = wanted ? projects.find((x) => x.id === wanted) : projects[0]!;
    if (!p) return json(404, { error: "PROJECT_NOT_FOUND", message: `No project '${wanted}' on this page`, projects: projects.map((x) => x.id) });

    if (method === "GET") {
      if (path === "/") return { status: 200, type: "text/html; charset=utf-8", body: PAGE_HTML };
      if (path === "/api/projects") return json(200, { projects: await Promise.all(projects.map(summary)) });
      if (path === "/api/openspec/folders") {
        // before a task implements a change: which of its agents do not have it in their folder yet
        const change = assertChangeName(url.searchParams.get("change") ?? "");
        const agents = (url.searchParams.get("agents") ?? "").split(",").filter(Boolean);
        return json(200, { change, inProject: await hasChange(p.projectDir, change), missing: await foldersWithoutChange(p, change, agents) });
      }
      if (path === "/api/openspec/changes") return json(200, { projectDir: p.projectDir, changes: await listChanges(p.projectDir) });
      if (path === "/api/state") {
        // the page is open: a BLOCKED task whose deadline passed goes to its lead even with no runner around
        if (p.operator) for (const t of await p.operator.tasks.list()) if (t.status === "BLOCKED" && t.handover) await p.operator.escalateIfDue(t.id).catch(() => null);
        const pricing = (await p.prices?.()) ?? {};
        return json(200, {
          ...(await buildUiState(p.fs, undefined, pricing)),
          project: { id: p.id, name: p.name, projectDir: tilde(p.projectDir), networkDir: tilde(p.networkDir), count: projects.length },
          control: p.pool
            ? {
                runners: await p.pool.details(), maxTaskCostUsd: p.maxTaskCostUsd ?? null,
                /** Agents in auto worktrees: the DONE task card offers to merge the lead's branch and remove the worktrees. */
                worktrees: p.pool.ids().filter((id) => p.pool!.agentFolder(id)?.worktree),
              }
            : null,
          supervisor: await supervisorBrief(p),
          schedules: p.scheduler ? await p.scheduler.status() : null,
        });
      }
      const diffOf = /^\/api\/tasks\/([^/]+)\/diff$/.exec(path);
      if (diffOf && p.pool) {
        // what "Влить в проект" brings: the lead's branch since it left the project's branch (after the merge: the merge itself)
        // the list first (commits, files with +/-); one file's diff with ?file=<path>, when the page opens it
        const task = await new TaskStore(p.fs).get(decodeURIComponent(diffOf[1]!));
        const lead = task.merged && !task.merged.already ? null : await leadBranch(p, task);
        const range: { project: string; base: string; head: string; mode: "two-dot" | "three-dot"; branch: string; merged: boolean } = lead
          ? { project: lead.project, base: "HEAD", head: lead.branch, mode: "three-dot", branch: lead.branch, merged: false }
          : { project: p.projectDir, base: `${task.merged!.commit}^1`, head: task.merged!.commit, mode: "two-dot", branch: task.merged!.branch, merged: true };
        const head = range.head;
        const file = url.searchParams.get("file");
        if (file !== null) return json(200, await fileDiff(range.project, range.base, head, range.mode, file));
        return json(200, { ...(await branchDiff(range.project, range.base, head, range.mode)), branch: range.branch, merged: range.merged });
      }
      if (path === "/api/schedules/preview") {
        // the form shows when a cron would run before it is saved
        try {
          const cron = parseCron(url.searchParams.get("cron") ?? "");
          const next: string[] = [];
          let at: Date | null = new Date();
          while (next.length < 3 && (at = nextRun(cron, at))) next.push(at.toISOString());
          return json(200, { next });
        } catch (e) {
          return json(400, { error: "INVALID_INPUT", message: (e as Error).message });
        }
      }
      if (path === "/api/runs") {
        const pricing = (await p.prices?.()) ?? {};
        return json(200, { runs: await runsOf(p, pricing), pricesError: pricing.error ?? null });
      }
      if (path === "/api/activity") {
        // the agents' tool calls, results and text as they come; ?after=<seq> returns only what is new
        const after = Number(url.searchParams.get("after") ?? 0) || 0;
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 1000) || 1000, 1), 3000);
        const agent = url.searchParams.get("agent");
        const events = p.pool?.activity(after, limit, agent ?? undefined) ?? [];
        return json(200, { events, lastSeq: events.at(-1)?.seq ?? after });
      }
      if (path === "/api/supervisor") {
        // ?all=1: the whole journal, for looking back; by default the latest 100
        const all = url.searchParams.get("all") === "1";
        return json(200, { status: p.supervisor ? await p.supervisor.status() : null, journal: await p.journal.list(all ? Number.MAX_SAFE_INTEGER : 100), journalTotal: await p.journal.count() });
      }
      const supSession = /^\/api\/supervisor\/sessions\/(session-\d+|\d+|latest)$/.exec(path);
      if (supSession) {
        const log = await readSessionLog(p.networkDir, supSession[1]!);
        return json(200, { id: log.id, file: tilde(log.file), text: formatSessionLog(log.lines), lines: log.lines });
      }
      const log = /^\/api\/runners\/([^/]+)\/log$/.exec(path);
      if (log && p.pool) return json(200, { id: log[1], lines: p.pool.log(decodeURIComponent(log[1]!)) });
      return text(404, "not found");
    }
    const pool = p.pool;
    const operator = p.operator;
    if (method !== "POST" || !pool || !operator) return text(405, pool ? "method not allowed" : "read-only (start the UI with --runners to control agents)");

    // a cross-site page can send a "simple" POST to localhost; require same-origin JSON
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if ((origin && origin !== `http://${hostHeader}`) || (site && site !== "same-origin" && site !== "none")) return text(403, "cross-origin request refused");
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return text(415, "application/json expected");
    const body = await readJson(req);

    if (path === "/api/tasks") {
      const b = body as { title?: unknown; description?: unknown; agents?: unknown; verifyCommand?: unknown; maxFollowUps?: unknown; maxFixRounds?: unknown; openspec?: unknown; maxCostUsd?: unknown; proposes?: unknown };
      // the page sends "" for "no limit"; a field it leaves out gets the config's maxTaskCostUsd
      const maxCostUsd = b.maxCostUsd === undefined ? p.maxTaskCostUsd : b.maxCostUsd === "" || b.maxCostUsd === null ? undefined : Number(b.maxCostUsd);
      const agents = Array.isArray(b.agents) ? b.agents.map(String) : [];
      const openspec = typeof b.openspec === "string" && b.openspec.trim() ? assertChangeName(b.openspec.trim()) : undefined;
      if (openspec) await checkAgentFolders(p, openspec, agents);
      const task = await operator.createTaskAsOperator({
        title: String(b.title ?? ""),
        description: String(b.description ?? ""),
        agents,
        ...(openspec ? { openspec } : {}),
        ...(typeof b.proposes === "string" && b.proposes.trim() ? { proposes: b.proposes.trim() } : {}),
        ...(typeof b.verifyCommand === "string" && b.verifyCommand.trim() ? { verifyCommand: b.verifyCommand } : {}),
        ...(b.maxFollowUps !== undefined && b.maxFollowUps !== "" ? { maxFollowUps: Number(b.maxFollowUps) } : {}),
        ...(b.maxFixRounds !== undefined && b.maxFixRounds !== "" ? { maxFixRounds: Number(b.maxFixRounds) } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      });
      return json(201, { task });
    }
    // the supervisor acts through the same routes as the page; what it does goes into its journal
    const bySupervisor = req.headers["x-agent-network-actor"] === "supervisor";
    const acted = async (taskId: string, text: string) => {
      if (bySupervisor) await p.journal.add({ kind: "action", by: "supervisor", taskId, text });
    };
    const taskAction = /^\/api\/tasks\/([^/]+)\/(unblock|handover|cancel|message|merge)$/.exec(path);
    if (taskAction) {
      const id = decodeURIComponent(taskAction[1]!);
      if (taskAction[2] === "merge") {
        const { project, branch } = await leadBranch(p, await operator.tasks.get(id));
        const merged = await operator.mergeTask({ taskId: id, project, branch }, opts.merge);
        await acted(id, `merged ${branch} into ${merged.merged!.into}`);
        return json(200, { task: merged });
      }
      if (taskAction[2] === "message") {
        // always to the task's lead, who passes it on: the operator does not give the agents orders past the lead
        const b = body as { text?: unknown; urgent?: unknown };
        const message = await operator.messageLead({ taskId: id, content: String(b.text ?? ""), urgent: b.urgent === true });
        await acted(id, `message to the lead ${message.to}: ${String(b.text ?? "").trim()}`);
        // urgent: stop the lead's session (after the tool call in flight) and start a fresh one with the message first
        const known = pool.list().some((r) => r.id === message.to);
        const interrupted = b.urgent === true ? (known ? pool.interrupt(message.to, String(b.text ?? "").trim()) : "not-running") : null;
        if (interrupted && bySupervisor) await acted(id, `interrupted ${message.to}'s session (${interrupted})`);
        return json(201, { message, ...(interrupted ? { interrupted } : {}) });
      }
      if (taskAction[2] === "handover") {
        const task = await operator.handOverToLead(id);
        await acted(id, `handed the stuck fix to the lead`);
        return json(200, { task });
      }
      if (taskAction[2] === "cancel") {
        const reason = (body as { reason?: unknown }).reason;
        const task = await operator.cancelTask(id, typeof reason === "string" && reason.trim() ? reason : "cancelled on the page");
        await acted(id, `cancelled the task`);
        return json(200, { task });
      }
      const { rounds, usd } = body as { rounds?: unknown; usd?: unknown };
      // money is the operator's call: the supervisor never raises a cost limit
      if (bySupervisor && (usd !== undefined || (await operator.tasks.find(id))?.blockedBy === "cost")) {
        return json(403, { error: "FORBIDDEN", message: "A task blocked by its cost limit is the operator's decision: escalate it with a recommendation" });
      }
      const task = await operator.unblockTask(id, rounds === undefined ? 1 : Number(rounds), usd === undefined ? undefined : Number(usd));
      await acted(id, `unblocked with ${task.maxFixRounds} fix rounds in all`);
      return json(200, { task });
    }
    if (path === "/api/worktrees/clean") {
      // remove the agents' auto worktrees and merged branches: only while none of them works on anything
      const ids = pool.ids().filter((id) => pool.agentFolder(id)?.worktree);
      if (!ids.length) throw new AppError("INVALID_INPUT", 'No agent of this project works in an auto worktree ("worktree": true in runners.json defaults)');
      const busy = pool.list().filter((r) => ids.includes(r.id) && r.session).map((r) => r.id);
      if (busy.length) throw new AppError("INVALID_INPUT", `${busy.join(", ")} ${busy.length > 1 ? "are" : "is"} in a session now: remove the worktrees when no task is open`);
      const open = (await operator.tasks.list()).filter((t) => (t.status === "ACTIVE" || t.status === "BLOCKED") && t.agents.some((a) => ids.includes(a)));
      if (open.length) throw new AppError("INVALID_INPUT", `Open tasks still need the worktrees: ${open.map((t) => `${t.id} (${t.status})`).join(", ")}`);
      return json(200, { result: await removeWorktrees(ids.map((id) => ({ id, ...pool.agentFolder(id)! }))) });
    }
    if (path === "/api/openspec/sync") {
      // bring the project's branch (with the merged change) into the agents' branches that lack it
      const b = body as { change?: unknown; agents?: unknown };
      const change = assertChangeName(String(b.change ?? ""));
      if (!(await hasChange(p.projectDir, change))) throw new AppError("OPENSPEC_NOT_FOUND", `${changePath(change)} is not in the project folder yet: merge the branch that has it first`);
      const missing = await foldersWithoutChange(p, change, Array.isArray(b.agents) ? b.agents.map(String) : pool.ids());
      const busy = pool.list().filter((r) => r.session && missing.some((m) => m.id === r.id)).map((r) => r.id);
      if (busy.length) throw new AppError("INVALID_INPUT", `${busy.join(", ")} ${busy.length > 1 ? "are" : "is"} in a session now: try again when the session ends`);
      const result: { id: string; ok: boolean; text: string }[] = [];
      for (const m of missing) {
        try {
          const r = await mergeProjectInto(p.projectDir, m.cwd);
          result.push({ id: m.id, ok: true, text: `${r.from} → ${r.into}: ${r.result}` });
        } catch (e) {
          result.push({ id: m.id, ok: false, text: (e as Error).message });
        }
      }
      return json(200, { result, missing: await foldersWithoutChange(p, change, missing.map((m) => m.id)) });
    }
    if (path === "/api/openspec/archive") {
      return json(200, await operator.archiveOpenspec({ taskId: String((body as { taskId?: unknown }).taskId ?? "") }, opts.openspecExec));
    }
    if (path === "/api/questions/answer") {
      const b = body as { taskId?: unknown; messageId?: unknown; answer?: unknown };
      const answer = await operator.answerQuestion({ taskId: String(b.taskId ?? ""), messageId: String(b.messageId ?? ""), answer: String(b.answer ?? "") });
      await acted(answer.taskId, `answered ${answer.to}'s question ${answer.replyTo}: ${answer.content}`);
      return json(201, { answer });
    }
    if (path === "/api/schedules") {
      if (!p.scheduler) return text(404, "no scheduler: start the page with a runners config");
      return json(201, { schedules: await p.scheduler.save({ schedule: (body as { schedule?: Record<string, unknown> }).schedule ?? {} }, pool.ids()) });
    }
    const sched = /^\/api\/schedules\/([^/]+)\/(run|enabled|update|delete)$/.exec(path);
    if (sched) {
      if (!p.scheduler) return text(404, 'no schedules: add a "schedules" section to runners.json');
      const id = decodeURIComponent(sched[1]!);
      if (sched[2] === "update") return json(200, { schedules: await p.scheduler.save({ schedule: (body as { schedule?: Record<string, unknown> }).schedule ?? {}, previousId: id }, pool.ids()) });
      if (sched[2] === "delete") return json(200, { schedules: await p.scheduler.save({ removeId: id }, pool.ids()) });
      if (sched[2] === "run") return json(200, { run: await p.scheduler.runNow(id), schedules: await p.scheduler.status() });
      return json(200, { schedules: await p.scheduler.setEnabled(id, (body as { enabled?: unknown }).enabled !== false) });
    }
    if (path === "/api/questions/dismiss") {
      const b = body as { taskId?: unknown; messageId?: unknown };
      const question = await operator.dismissQuestion({ taskId: String(b.taskId ?? ""), messageId: String(b.messageId ?? "") });
      await acted(question.taskId, `closed ${question.from}'s question ${question.id} without an answer`);
      return json(200, { question });
    }
    const sup = /^\/api\/supervisor\/(start|stop|model|note|tools|resolve|rules|limits)$/.exec(path);
    if (sup) {
      if (sup[1] === "resolve") {
        // the operator's decision: with "answer" it goes to the agent (the answer to the question the decision is about,
        // else a message to the task's lead); without, the decision is just closed. Either way the question no longer waits.
        const b = body as { id?: unknown; answer?: unknown };
        const id = String(b.id ?? "");
        const open = (await p.journal.list(Number.MAX_SAFE_INTEGER)).find((e) => e.id === id);
        const asked = (open?.data as { messageId?: unknown } | undefined)?.messageId;
        let sent: Awaited<ReturnType<typeof operator.messageLead>> | undefined;
        if (typeof b.answer === "string") {
          if (open?.resolvedAt) throw new AppError("INVALID_INPUT", `${id} is decided already (${open.resolvedAt}): nothing is sent twice`);
          if (!open?.taskId) throw new AppError("INVALID_INPUT", `${id} names no task: there is nobody to send the answer to`);
          const question = typeof asked === "string" ? await operator.messages.get(open.taskId, asked).catch(() => null) : null;
          sent = question && !question.readAt ? await operator.answerQuestion({ taskId: open.taskId, messageId: question.id, answer: b.answer }) : await operator.messageLead({ taskId: open.taskId, content: b.answer });
        }
        const entry = await p.journal.resolve(id);
        if (entry.taskId && typeof asked === "string") await operator.dismissQuestion({ taskId: entry.taskId, messageId: asked }).catch(() => null);
        return json(200, { entry, ...(sent ? { sent } : {}) });
      }
      if (sup[1] === "note") {
        const b = body as { kind?: unknown; text?: unknown; taskId?: unknown; messageId?: unknown };
        const kind = b.kind === "action" || b.kind === "needs-you" ? b.kind : "note";
        if (typeof b.text !== "string" || !b.text.trim()) throw new AppError("INVALID_INPUT", "text must not be empty");
        const asked = typeof b.messageId === "string" && /^msg-\d+$/.test(b.messageId) ? b.messageId : undefined; // the agent's question this is about
        if (asked && kind === "needs-you" && typeof b.taskId === "string") {
          // answered while the supervisor was looking: there is nothing left to decide
          const q = await operator.messages.get(b.taskId, asked).catch(() => null);
          if (q?.readAt) throw new AppError("INVALID_INPUT", `${asked} is answered already (${q.readAt}): nothing to escalate; check overview again`);
        }
        const entry = await p.journal.add({ kind, by: bySupervisor ? "supervisor" : "operator", ...(typeof b.taskId === "string" && b.taskId ? { taskId: b.taskId } : {}), text: b.text.trim().slice(0, 4000), ...(asked ? { data: { messageId: asked } } : {}) });
        return json(201, { entry });
      }
      if (!p.supervisor) return text(404, 'no supervisor: add a "supervisor" section to runners.json');
      if (sup[1] === "start") return json(200, p.supervisor.start());
      if (sup[1] === "stop") return json(200, await p.supervisor.stop());
      if (sup[1] === "model") return json(200, await p.supervisor.setModel(String((body as { model?: unknown }).model ?? "")));
      if (sup[1] === "rules") return json(200, await p.supervisor.setRules((body as { rules?: unknown }).rules));
      if (sup[1] === "limits") {
        const b = body as { maxSessionsPerHour?: unknown; budgetUsd?: unknown };
        return json(200, await p.supervisor.setLimits({ ...(b.maxSessionsPerHour !== undefined ? { maxSessionsPerHour: b.maxSessionsPerHour } : {}), ...(b.budgetUsd !== undefined ? { budgetUsd: b.budgetUsd } : {}) }));
      }
      const b = body as { name?: unknown; enabled?: unknown };
      return json(200, await p.supervisor.setToolEnabled(String(b.name ?? ""), b.enabled !== false));
    }
    const inst = /^\/api\/runners\/([^/]+)\/instructions$/.exec(path);
    if (inst) {
      const file = (body as { file?: unknown }).file;
      return json(200, await pool.setInstructionsFile(decodeURIComponent(inst[1]!), typeof file === "string" ? file : null));
    }
    const mdl = /^\/api\/runners\/([^/]+)\/model$/.exec(path);
    if (mdl) return json(200, await pool.setModel(decodeURIComponent(mdl[1]!), String((body as { model?: unknown }).model ?? "")));
    const act = /^\/api\/runners\/([^/]+)\/(start|stop)$/.exec(path);
    if (act) {
      const id = decodeURIComponent(act[1]!);
      return json(200, act[2] === "start" ? pool.start(id) : await pool.stop(id));
    }
    return text(404, "not found");
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 4777, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://${host === "::1" ? "[::1]" : host}:${port}`,
    projects: projects.map((p) => ({ id: p.id, networkDir: p.networkDir })),
    close: () =>
      new Promise((resolve) => {
        for (const p of projects) p.operator?.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new AppError("INVALID_INPUT", "request body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
