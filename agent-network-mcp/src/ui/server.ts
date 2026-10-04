import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { FileStore } from "../storage/fileStore.js";
import { PAGE_HTML } from "./page.js";
import { buildUiState } from "./state.js";

export interface UiServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

/** Read-only viewer: GET / (page) and GET /api/state (JSON). Bound to loopback; foreign Host headers are refused. */
export async function startUiServer(networkDir: string, opts: { port?: number; host?: string } = {}): Promise<UiServer> {
  const fs = await FileStore.open(networkDir);
  const host = opts.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    void handle(req.method ?? "", req.url ?? "/", req.headers.host ?? "").then(
      ({ status, type, body }) => {
        res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
        res.end(body);
      },
      () => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("internal error");
      },
    );
  });

  async function handle(method: string, rawUrl: string, hostHeader: string) {
    const text = (status: number, body: string) => ({ status, type: "text/plain; charset=utf-8", body });
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hostHeader)) return text(403, "forbidden host");
    if (method !== "GET") return text(405, "read-only");
    const path = rawUrl.split("?")[0];
    if (path === "/") return { status: 200, type: "text/html; charset=utf-8", body: PAGE_HTML };
    if (path === "/api/state") return { status: 200, type: "application/json", body: JSON.stringify(await buildUiState(fs)) };
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
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
