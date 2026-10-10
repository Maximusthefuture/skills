import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { AppError, isAppError } from "../errors.js";
import { assertChangeName, changePath, hasChange, listChanges, type Exec } from "../openspec.js";
import { NetworkService } from "../service.js";
import { FileStore } from "../storage/fileStore.js";
import { PAGE_HTML } from "./page.js";
import type { RunnerPool } from "./runners.js";
import { buildUiState } from "./state.js";

export interface UiServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export interface UiOptions {
  port?: number;
  host?: string;
  /** Control mode: the page may create tasks and start/stop these runners. Without it the UI is read-only. */
  runners?: RunnerPool;
  /** Runs the openspec CLI for "archive" (tests replace it). */
  openspecExec?: Exec;
}

const MAX_BODY = 64 * 1024;

type Reply = { status: number; type: string; body: string };
const json = (status: number, value: unknown): Reply => ({ status, type: "application/json", body: JSON.stringify(value) });
const text = (status: number, body: string): Reply => ({ status, type: "text/plain; charset=utf-8", body });

/**
 * GET / (page), GET /api/state (JSON), GET /api/openspec/changes. With `runners` also: POST /api/tasks,
 * POST /api/runners/<id>/start|stop|instructions|model, POST /api/questions/answer, POST /api/openspec/archive,
 * GET /api/runners/<id>/log. Bound to loopback; foreign Host headers are refused, and state-changing requests must be
 * same-origin JSON (a page on another site cannot create tasks for the agents).
 */
export async function startUiServer(networkDir: string, opts: UiOptions = {}): Promise<UiServer> {
  const fs = await FileStore.open(networkDir);
  const host = opts.host ?? "127.0.0.1";
  const pool = opts.runners;
  const operator = pool ? await NetworkService.create(networkDir, { id: "operator", type: "ui" }) : undefined;
  const projectDir = dirname(resolve(networkDir));

  /** Agents in their own worktree see only committed work: the change must be in each runner's folder already. */
  async function checkAgentFolders(change: string, agents: string[]): Promise<void> {
    const missing: string[] = [];
    for (const r of pool?.list() ?? []) {
      if (!agents.includes(r.id) || !r.cwd || resolve(r.cwd) === projectDir) continue;
      if (!(await hasChange(r.cwd, change))) missing.push(`${r.id} (${r.cwd})`);
    }
    if (missing.length) {
      throw new AppError(
        "OPENSPEC_NOT_FOUND",
        `${changePath(change)} is not in the folder of ${missing.join(", ")}: commit the change and merge it into those agents' branches (an agent in its own worktree sees only committed work).`,
      );
    }
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
    const path = (req.url ?? "/").split("?")[0]!;
    const method = req.method ?? "";

    if (method === "GET") {
      if (path === "/") return { status: 200, type: "text/html; charset=utf-8", body: PAGE_HTML };
      if (path === "/api/openspec/changes") return json(200, { projectDir, changes: await listChanges(projectDir) });
      if (path === "/api/state") return json(200, { ...(await buildUiState(fs)), control: pool ? { runners: await pool.details() } : null });
      const log = /^\/api\/runners\/([^/]+)\/log$/.exec(path);
      if (log && pool) return json(200, { id: log[1], lines: pool.log(decodeURIComponent(log[1]!)) });
      return text(404, "not found");
    }
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
      if (openspec) await checkAgentFolders(openspec, agents);
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
        operator?.close();
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
