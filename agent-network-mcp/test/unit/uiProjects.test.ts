import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import type { RunnerOptions } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { SessionStore } from "../../src/stores/sessionStore.js";
import type { Task } from "../../src/types.js";
import { listRuns, queueStates } from "../../src/ui/runs.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

/** A project folder <root>/<name> with its network in <root>/<name>/.agent-network. */
async function project(name: string) {
  const projectDir = join(await tmpDir(), name);
  mkdirSync(projectDir, { recursive: true });
  const networkDir = join(projectDir, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  return { projectDir, networkDir, operator, sessions: new SessionStore(await FileStore.open(networkDir)) };
}

const usage = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheCreation: 0, total: input + output });
const task = (id: string, status: Task["status"], agents: string[]): Task =>
  ({ id, title: id, description: "", phase: "DISCUSS", status, agents, createdAt: "", updatedAt: "", createdBy: "operator", git: null, syncRound: 0 }) as Task;

describe("queue and runs", () => {
  it("a task runs when it is the oldest unfinished task of one of its agents, and waits in the queue otherwise", () => {
    const tasks = [task("task-001", "ACTIVE", ["a", "b"]), task("task-002", "ACTIVE", ["a", "b"]), task("task-003", "ACTIVE", ["a", "c"]), task("task-004", "BLOCKED", ["d", "e"]), task("task-005", "COMPLETED", ["a", "b"]), task("task-006", "CANCELLED", ["a", "b"])];
    expect(Object.fromEntries(queueStates(tasks))).toEqual({
      "task-001": "running",
      "task-002": "queued", // a and b are busy with task-001
      "task-003": "running", // c is free and starts it
      "task-004": "blocked",
      "task-005": "done",
      "task-006": "cancelled",
    });
  });

  it("lists the recorded sessions newest first, with status and cost", async () => {
    const p = await project("shop");
    const t = await p.operator.createTaskAsOperator({ title: "t", description: "d", agents: ["a", "b"] });
    const base = { taskId: t.id, attempt: 1, durationMs: 1000 };
    await p.sessions.create({ ...base, agentId: "a", startedAt: "2026-10-10T10:00:00Z", endedAt: "2026-10-10T10:01:00Z", exitCode: 0, model: "m", usage: usage(1_000_000, 0) });
    await p.sessions.create({ ...base, agentId: "b", startedAt: "2026-10-10T11:00:00Z", endedAt: "2026-10-10T11:01:00Z", exitCode: 128 });
    await p.sessions.create({ ...base, agentId: "a", startedAt: "2026-10-10T12:00:00Z", endedAt: "2026-10-10T12:01:00Z", exitCode: 1, costUsd: 0.2, usage: usage(10, 1) });
    const runs = await listRuns(await FileStore.open(p.networkDir), [await p.operator.tasks.get(t.id)], { m: { input: 0.5, output: 1 } });
    expect(runs.map((r) => [r.seq, r.agentId, r.status, r.exitCode, r.costUsd, r.costEstimated])).toEqual([
      [3, "a", "failed", 1, 0.2, false],
      [2, "b", "stopped", 128, null, false],
      [1, "a", "ok", 0, 0.5, true],
    ]);
    expect(runs[2]).toMatchObject({ taskState: "DISCUSS", alsoFinished: [], numTurns: null, recordPath: `tasks/${t.id}/sessions/session-001.json` });

    // numbered in the order the sessions ended, across tasks; a session can finish another task on the way
    const t2 = await p.operator.createTaskAsOperator({ title: "follow-up", description: "d", agents: ["a", "b"] });
    await p.sessions.create({ ...base, taskId: t2.id, agentId: "b", startedAt: "2026-10-10T09:00:00Z", endedAt: "2026-10-10T13:00:00Z", exitCode: 0, numTurns: 9 });
    await p.sessions.create({ ...base, agentId: "a", startedAt: "2026-10-10T12:30:00Z", endedAt: "2026-10-10T12:40:00Z", exitCode: 0, alsoFinished: [t2.id] });
    const all = await listRuns(await FileStore.open(p.networkDir), await p.operator.tasks.list());
    const seqOf = (taskId: string, id: string) => all.find((r) => r.taskId === taskId && r.id === id)!.seq;
    expect([seqOf(t.id, "session-001"), seqOf(t.id, "session-002"), seqOf(t.id, "session-003"), seqOf(t.id, "session-004"), seqOf(t2.id, "session-001")]).toEqual([1, 2, 3, 4, 5]); // t2's started first, ended last
    expect(all.map((r) => r.seq)).toEqual([4, 3, 2, 1, 5]); // the list itself: newest start first
    expect(all.find((r) => r.seq === 4)).toMatchObject({ alsoFinished: [{ id: t2.id, title: "follow-up", status: "ACTIVE" }] });
    expect(all.find((r) => r.seq === 5)).toMatchObject({ numTurns: 9 });
  });
});

describe("several projects on one page", () => {
  it("lists the projects and serves each one by ?project=, read-only ones without runners", async () => {
    const shop = await project("shop");
    const blog = await project("Blog Site");
    const t = await shop.operator.createTaskAsOperator({ title: "Cancel", description: "d", agents: ["backend", "reviewer"] });
    await blog.operator.createTaskAsOperator({ title: "Post", description: "d", agents: ["writer", "editor"] });
    await shop.sessions.create({ taskId: t.id, agentId: "backend", attempt: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1, exitCode: 0, model: "m", usage: usage(2_000_000, 0) });

    let started: RunnerOptions | undefined;
    const pool = new RunnerPool(shop.networkDir, [{ id: "backend", command: ["x"] }, { id: "reviewer", command: ["x"] }], {
      run: (o) => {
        started = o;
        o.onSession?.({ taskId: t.id, attempt: 2, startedAt: new Date(Date.now() - 5000).toISOString(), model: "m" });
        return new Promise((r) => o.signal!.addEventListener("abort", () => r(0)));
      },
    });
    ui = await startUiServer([{ networkDir: shop.networkDir, runners: pool, prices: async () => ({ prices: { m: { input: 0.1, output: 1 } } }) }, { networkDir: blog.networkDir }], { port: 0 });
    const get = async (path: string) => (await fetch(`${ui!.url}${path}`)).json() as Promise<any>;

    const { projects } = await get("/api/projects");
    expect(projects.map((p: any) => [p.id, p.name, p.control, p.tasks.running, p.runners])).toEqual([
      ["shop", "shop", true, 1, { running: 0, working: 0, total: 2 }],
      ["blog-site", "Blog Site", false, 1, null],
    ]);
    expect(projects[0].spend24h).toEqual({ usd: expect.closeTo(0.2), estimated: true, unpriced: 0 });

    expect((await get("/api/state")).project).toMatchObject({ id: "shop", count: 2 }); // the first one by default
    const blogState = await get("/api/state?project=blog-site");
    expect(blogState.project.id).toBe("blog-site");
    expect(blogState.control).toBeNull();
    expect(blogState.tasks.map((x: any) => [x.title, x.queue])).toEqual([["Post", "running"]]);
    expect((await fetch(`${ui.url}/api/state?project=nope`)).status).toBe(404);

    const post = (path: string, body: unknown) => fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("/api/tasks?project=blog-site", { title: "x", description: "d", agents: ["writer", "editor"] })).status).toBe(405);
    expect((await post("/api/tasks?project=shop", { title: "Refund", description: "d", agents: ["backend", "reviewer"] })).status).toBe(201);
    expect((await get("/api/state?project=shop")).tasks.map((x: any) => [x.title, x.queue])).toEqual([["Cancel", "running"], ["Refund", "queued"]]);

    pool.start("backend");
    expect(started).toBeDefined();
    const { runs } = await get("/api/runs?project=shop");
    expect(runs.map((r: any) => [r.status, r.agentId, r.attempt, r.endedAt])).toEqual([["running", "backend", 2, null], ["ok", "backend", 1, expect.any(String)]]);
    expect(runs[0].durationMs).toBeGreaterThanOrEqual(4000);
    expect((await get("/api/state?project=shop")).control.runners[0].session).toMatchObject({ taskId: t.id, attempt: 2 });
    await pool.stopAll();
    expect((await get("/api/state?project=shop")).control.runners[0].session).toBeNull();
  });

  it("ui takes one runners config per project; each names its own network", async () => {
    const dir = await tmpDir();
    const cfg = (name: string, extra: object) => {
      const f = join(dir, `${name}.json`);
      writeFileSync(f, JSON.stringify({ defaults: { command: ["x"], autostart: false }, agents: [{ id: "a" }], ...extra }));
      return f;
    };
    const a = cfg("a", { networkDir: join(dir, "a", ".agent-network") });
    const b = cfg("b", {});
    const out: string[] = [];
    expect(await runCli(["ui", "--runners", a, "--runners", b, "--network-dir", "/x"], {}, (l) => out.push(l), dir)).toBe(2);
    expect(out.at(-1)).toContain("every config names its own");
    expect(await runCli(["ui", "--runners", a, "--runners", b], {}, (l) => out.push(l), dir)).toBe(2); // b: no networkDir, dir is not a repository
    expect(out.at(-1)).toContain(`${b}: set "networkDir"`);
  });

  it("gives the page the newest 50 messages of a task and how many there are", async () => {
    const shop = await project("shop");
    const a = await NetworkService.create(shop.networkDir, { id: "a", type: "test" });
    await a.registerAgent();
    const t = await shop.operator.createTaskAsOperator({ title: "t", description: "d", agents: ["a", "b"] });
    for (let i = 1; i <= 55; i++) await a.sendMessage({ taskId: t.id, to: "b", type: "INFORMATION", content: `m${i}` });
    ui = await startUiServer(shop.networkDir, { port: 0 });
    const task = ((await (await fetch(`${ui.url}/api/state`)).json()) as any).tasks[0];
    expect([task.messages.length, task.messagesTotal, task.messages[0].content, task.messages.at(-1).content]).toEqual([50, 55, "m6", "m55"]);
    expect(task.eventsTotal).toBeGreaterThan(task.events.length - 1);
  });

  it("refuses two projects with the same network", async () => {
    const shop = await project("shop");
    await expect(startUiServer([{ networkDir: shop.networkDir }, { networkDir: shop.networkDir }], { port: 0 })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });
});
