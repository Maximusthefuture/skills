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
import { buildUiState } from "./state.js";

export interface UiServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

/** One project on the page: a network (<project>/.agent-network) and, in control mode, its runners. */
export interface UiProject {
  networkDir: string;
  /** Control mode: the page may create tasks and start/stop these runners. Without it the project is read-only. */
  runners?: RunnerPool;
  /** The project's token prices (runners.json "prices"), read on every refresh: sessions without a CLI cost are priced with them. */
  prices?: () => Promise<{ prices?: Prices; error?: string }>;
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
}

interface Project {
  id: string;
  name: string;
  networkDir: string;
  projectDir: string;
  fs: FileStore;
  pool?: RunnerPool;
  operator?: NetworkService;
  prices?: UiProject["prices"];
  git?: { at: number; value: Promise<GitContext | null> };
}

const MAX_BODY = 64 * 1024;
const GIT_TTL_MS = 15_000;
const DAY_MS = 24 * 3600 * 1000;

type Reply = { status: number; type: string; body: string };
const json = (status: number, value: unknown): Reply => ({ status, type: "application/json", body: JSON.stringify(value) });
const text = (status: number, body: string): Reply => ({ status, type: "text/plain; charset=utf-8", body });

/** A path for the page: the home folder as "~". */
const tilde = (path: string): string => {
  const home = homedir();
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
};

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/**
 * GET / (page), GET /api/projects, and per project (?project=<id>, default: the first one): GET /api/state, /api/runs,
 * /api/openspec/changes, /api/runners/<id>/log; with runners also POST /api/tasks, /api/runners/<id>/start|stop|instructions|model,
 * /api/questions/answer, /api/openspec/archive. Bound to loopback; foreign Host headers are refused, and state-changing
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
      ...(spec.runners ? { pool: spec.runners, operator: await NetworkService.create(networkDir, { id: "operator", type: "ui" }) } : {}),
      ...(spec.prices ? { prices: spec.prices } : {}),
    });
  }
  const host = opts.host ?? "127.0.0.1";

  /** Agents in their own worktree see only committed work: the change must be in each runner's folder already. */
  async function checkAgentFolders(p: Project, change: string, agents: string[]): Promise<void> {
    const missing: string[] = [];
    for (const r of p.pool?.list() ?? []) {
      if (!agents.includes(r.id) || !r.cwd || resolve(r.cwd) === p.projectDir) continue;
      if (!(await hasChange(r.cwd, change))) missing.push(`${r.id} (${r.cwd})`);
    }
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
    const questions = (await Promise.all(open.map((t) => messages.list(t.id)))).flat().filter((m) => m.to === "operator" && !m.readAt).length;
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
      if (path === "/api/openspec/changes") return json(200, { projectDir: p.projectDir, changes: await listChanges(p.projectDir) });
      if (path === "/api/state") {
        const pricing = (await p.prices?.()) ?? {};
        return json(200, {
          ...(await buildUiState(p.fs, undefined, pricing)),
          project: { id: p.id, name: p.name, projectDir: tilde(p.projectDir), networkDir: tilde(p.networkDir), count: projects.length },
          control: p.pool ? { runners: await p.pool.details() } : null,
        });
      }
      if (path === "/api/runs") {
        const pricing = (await p.prices?.()) ?? {};
        return json(200, { runs: await runsOf(p, pricing), pricesError: pricing.error ?? null });
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
      const b = body as { title?: unknown; description?: unknown; agents?: unknown; verifyCommand?: unknown; maxFollowUps?: unknown; maxFixRounds?: unknown; openspec?: unknown };
      const agents = Array.isArray(b.agents) ? b.agents.map(String) : [];
      const openspec = typeof b.openspec === "string" && b.openspec.trim() ? assertChangeName(b.openspec.trim()) : undefined;
      if (openspec) await checkAgentFolders(p, openspec, agents);
      const task = await operator.createTaskAsOperator({
        title: String(b.title ?? ""),
        description: String(b.description ?? ""),
        agents,
        ...(openspec ? { openspec } : {}),
        ...(typeof b.verifyCommand === "string" && b.verifyCommand.trim() ? { verifyCommand: b.verifyCommand } : {}),
        ...(b.maxFollowUps !== undefined && b.maxFollowUps !== "" ? { maxFollowUps: Number(b.maxFollowUps) } : {}),
        ...(b.maxFixRounds !== undefined && b.maxFixRounds !== "" ? { maxFixRounds: Number(b.maxFixRounds) } : {}),
      });
      return json(201, { task });
    }
    if (path === "/api/openspec/archive") {
      return json(200, await operator.archiveOpenspec({ taskId: String((body as { taskId?: unknown }).taskId ?? "") }, opts.openspecExec));
    }
    if (path === "/api/questions/answer") {
      const b = body as { taskId?: unknown; messageId?: unknown; answer?: unknown };
      return json(201, { answer: await operator.answerQuestion({ taskId: String(b.taskId ?? ""), messageId: String(b.messageId ?? ""), answer: String(b.answer ?? "") }) });
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
