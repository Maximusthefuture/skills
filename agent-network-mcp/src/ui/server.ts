import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AppError, isAppError } from "../errors.js";
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
}

const MAX_BODY = 64 * 1024;

type Reply = { status: number; type: string; body: string };
const json = (status: number, value: unknown): Reply => ({ status, type: "application/json", body: JSON.stringify(value) });
const text = (status: number, body: string): Reply => ({ status, type: "text/plain; charset=utf-8", body });

/**
 * GET / (page), GET /api/state (JSON). With `runners` also: POST /api/tasks, POST /api/runners/<id>/start|stop,
 * GET /api/runners/<id>/log. Bound to loopback; foreign Host headers are refused, and state-changing requests must be
 * same-origin JSON (a page on another site cannot create tasks for the agents).
 */
export async function startUiServer(networkDir: string, opts: UiOptions = {}): Promise<UiServer> {
  const fs = await FileStore.open(networkDir);
  const host = opts.host ?? "127.0.0.1";
  const pool = opts.runners;
  const operator = pool ? await NetworkService.create(networkDir, { id: "operator", type: "ui" }) : undefined;

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
      if (path === "/api/state") return json(200, { ...(await buildUiState(fs)), control: pool ? { runners: pool.list() } : null });
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
      const b = body as { title?: unknown; description?: unknown; agents?: unknown; verifyCommand?: unknown; maxFollowUps?: unknown; maxFixRounds?: unknown };
      const task = await operator.createTaskAsOperator({
        title: String(b.title ?? ""),
        description: String(b.description ?? ""),
        agents: Array.isArray(b.agents) ? b.agents.map(String) : [],
        ...(typeof b.verifyCommand === "string" && b.verifyCommand.trim() ? { verifyCommand: b.verifyCommand } : {}),
        ...(b.maxFollowUps !== undefined && b.maxFollowUps !== "" ? { maxFollowUps: Number(b.maxFollowUps) } : {}),
        ...(b.maxFixRounds !== undefined && b.maxFixRounds !== "" ? { maxFixRounds: Number(b.maxFixRounds) } : {}),
      });
      return json(201, { task });
    }
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
