import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { buildUiState } from "../../src/ui/state.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

async function network() {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const mk = async (id: string) => {
    const svc = await NetworkService.create(dir, { id, type: "test", role: id });
    return { svc, swarm: new Swarm(svc) };
  };
  return { dir, operator, mk };
}

describe("buildUiState", () => {
  it("shows a BLOCKED task as waiting on the operator, and integration reports", async () => {
    const { dir, operator, mk } = await network();
    const backend = await mk("backend");
    const reviewer = await mk("reviewer");
    await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxFixRounds: 0, verifyCommand: "npm test" });
    await backend.swarm.propose({ summary: "s", assignments: [{ agentId: "backend", responsibility: "a", files: ["a/**"] }, { agentId: "reviewer", responsibility: "b", files: ["b/**"] }] });
    await reviewer.swarm.context();
    await reviewer.swarm.complete({});
    await backend.swarm.complete({});
    await backend.swarm.complete({ result: "a" });
    await reviewer.swarm.complete({ result: "b" });
    await backend.swarm.complete({ status: "PASS" });
    await reviewer.swarm.complete({ status: "PASS" });
    await backend.swarm.complete({ status: "NEEDS_FIX", result: "tests fail", findings: [{ severity: "ERROR", description: "b breaks a", relatedAgent: "reviewer" }] });

    const state = await buildUiState(await FileStore.open(dir));
    expect(state.tasks[0]).toMatchObject({ phase: "INTEGRATE", status: "BLOCKED", waitingOn: ["operator"], maxFixRounds: 0, verifyCommand: "npm test", blockedReason: expect.stringContaining("limit") });
    expect(state.tasks[0]!.integrations).toEqual([expect.objectContaining({ status: "NEEDS_FIX", result: "tests fail" })]);
  });

  it("shows agents, tasks, phase, waiting-on, assignments, messages and events", async () => {
    const { dir, operator, mk } = await network();
    const backend = await mk("backend");
    await operator.createTaskAsOperator({ title: "Reg", description: "d", agents: ["backend", "reviewer"] });
    await backend.swarm.sendMessage({ to: "reviewer", message: "hello" });
    await backend.swarm.propose({ summary: "plan", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/main/**"] }, { agentId: "reviewer", responsibility: "tests", files: ["src/test/**"] }] });

    const state = await buildUiState(await FileStore.open(dir));
    expect(state.agents).toEqual([expect.objectContaining({ id: "backend", effectiveStatus: "ONLINE", tasks: ["task-001"] })]);
    expect(state.notStarted).toEqual(["reviewer"]);
    expect(state.tasks[0]).toMatchObject({
      id: "task-001",
      phase: "DISCUSS",
      waitingOn: ["backend", "reviewer"],
      agreement: { summary: "plan", approvedBy: [] },
      messages: [expect.objectContaining({ content: "hello", from: "backend" })],
    });
    expect(state.tasks[0]!.events.map((e) => e.type)).toEqual(["TASK_CREATED", "MESSAGE_CREATED", "AGREEMENT_UPDATED"]);
  });

  it("marks an agent DEAD when its process is gone but it never went OFFLINE", async () => {
    const { dir, mk } = await network();
    await mk("backend").then((a) => a.svc.registerAgent());
    const fs = await FileStore.open(dir);
    expect((await buildUiState(fs, () => false)).agents[0]).toMatchObject({ status: "ONLINE", effectiveStatus: "DEAD" });
    expect((await buildUiState(fs, () => true)).agents[0]).toMatchObject({ effectiveStatus: "ONLINE" });
  });

  it("lists active tasks (oldest first) before completed ones", async () => {
    const { dir, operator } = await network();
    await operator.createTaskAsOperator({ title: "a", description: "d", agents: ["x", "y"] });
    await operator.createTaskAsOperator({ title: "b", description: "d", agents: ["x", "y"] });
    const fs = await FileStore.open(dir);
    const t = await operator.tasks.get("task-001");
    await operator.tasks.save({ ...t, status: "COMPLETED", phase: "DONE" });
    expect((await buildUiState(fs)).tasks.map((x) => x.id)).toEqual(["task-002", "task-001"]);
  });

  it("works on an empty network", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    expect(await buildUiState(await FileStore.open(dir))).toMatchObject({ agents: [], tasks: [], notStarted: [] });
  });
});

describe("ui server", () => {
  it("serves the page and JSON state, read-only, loopback only", async () => {
    const { dir, operator } = await network();
    await operator.createTaskAsOperator({ title: "Reg", description: "d", agents: ["a", "b"] });
    ui = await startUiServer(dir, { port: 0 });
    expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const page = await fetch(ui.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Agent Network");

    const state: any = await (await fetch(`${ui.url}/api/state`)).json();
    expect(state.tasks).toEqual([expect.objectContaining({ id: "task-001", phase: "DISCUSS" })]);

    expect((await fetch(`${ui.url}/api/state`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${ui.url}/nope`)).status).toBe(404);
    // fetch() cannot override Host, so use a raw request (DNS-rebinding style)
    const status = await new Promise<number>((resolve, reject) => {
      const { port } = new URL(ui!.url);
      request({ host: "127.0.0.1", port, path: "/api/state", headers: { host: "evil.example.com" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject).end();
    });
    expect(status).toBe(403);
  });
});
