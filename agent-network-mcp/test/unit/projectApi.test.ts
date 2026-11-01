import { afterEach, describe, expect, it } from "vitest";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";
import type { ProjectState } from "../../src/project/store.js";

let ui: UiServer | undefined;
afterEach(async () => { await ui?.close(); ui = undefined; });
describe("Project conversation API", () => {
  it("processes queued messages through the configured executor and stops it on close", async () => {
    const dir = await tmpDir();
    let calls = 0;
    ui = await startUiServer([{ networkDir: dir, coordinator: async ({ message }) => { calls++; return "Answer: " + message.content; } }], { port: 0 });
    await fetch(ui.url + "/api/project/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: "m1", content: "hello" }) });
    await expect.poll(async () => {
      const state = await (await fetch(ui!.url + "/api/project")).json() as ProjectState;
      return state.runs[0]?.result;
    }).toBe("Answer: hello");
    expect(calls).toBe(1);
    await ui.close();
    ui = await startUiServer([{ networkDir: dir, coordinator: async () => { calls++; return "duplicate"; } }], { port: 0 });
    const state = await (await fetch(ui.url + "/api/project")).json() as ProjectState;
    expect(state.runs[0]!.result).toBe("Answer: hello");
    expect(calls).toBe(1);
  });
  it("persists a conversation without runners and does not create tasks", async () => {
    const dir = await tmpDir();
    ui = await startUiServer(dir, { port: 0 });
    const post = (path: string, body: unknown) => fetch(ui!.url + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const first = await (await fetch(ui.url + "/api/project")).json() as ProjectState;
    expect((await post("/api/project/messages", { messageId: "m1", content: "Discuss only" })).status).toBe(200);
    expect((await post("/api/project/messages", { messageId: "m1", content: "Discuss only" })).status).toBe(200);
    expect((await post("/api/project/pause", { paused: "false" })).status).toBe(400);
    await post("/api/project/pause", { paused: true });
    await ui.close();
    ui = await startUiServer(dir, { port: 0 });
    const state = await (await fetch(ui.url + "/api/project")).json() as ProjectState;
    expect(state.projectId).toBe(first.projectId);
    expect(state.messages).toHaveLength(1);
    expect(state.paused).toBe(true);
    expect(state.runs[0]!.state).toBe("queued");
    expect(state.tasks).toEqual([]);
    expect((await (await fetch(ui.url + "/api/state")).json() as { tasks: unknown[] }).tasks).toEqual([]);
  });

  it("rejects cross-origin and supervisor mutations", async () => {
    ui = await startUiServer(await tmpDir(), { port: 0 });
    const variants: Record<string, string>[] = [{ origin: "https://example.com" }, { "x-agent-network-actor": "supervisor" }];
    for (const extra of variants) {
      const response = await fetch(ui.url + "/api/project/messages", {
        method: "POST", headers: { "content-type": "application/json", ...extra } as Record<string, string>,
        body: JSON.stringify({ messageId: "m1", content: "untrusted" }),
      });
      expect(response.status).toBe(403);
    }
    expect((await (await fetch(ui.url + "/api/project")).json() as ProjectState).messages).toEqual([]);
  });
});
