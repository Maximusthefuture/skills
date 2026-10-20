import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { costGuard, taskSpent } from "../../src/costLimit.js";
import type { RunnerOptions } from "../../src/runner.js";
import { Scheduler } from "../../src/schedule/scheduler.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { SessionStore } from "../../src/stores/sessionStore.js";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const networkDir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const fs = await FileStore.open(networkDir);
  const sessions = new SessionStore(fs);
  const session = (taskId: string, agentId: string, extra: { costUsd?: number; model?: string; tokens?: number }) =>
    sessions.create({
      taskId, agentId, attempt: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1000, exitCode: 0,
      ...(extra.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
      ...(extra.model ? { model: extra.model } : {}),
      ...(extra.tokens ? { usage: { input: extra.tokens, output: extra.tokens, cacheRead: 0, cacheCreation: 0, total: 2 * extra.tokens } } : {}),
    });
  return { networkDir, operator, fs, session };
}

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("what a task costs beyond its own sessions", () => {
  it("its delegated jobs and the plan critic count for it: in the limit, and a job stops with its lead's task", async () => {
    const { networkDir, operator, fs, session } = await setup();
    const { writeSpawnFile } = await import("../../src/spawner.js");
    const { Swarm } = await import("../../src/mcp/swarm.js");
    const { collectStats } = await import("../../src/stats.js");
    await writeSpawnFile(networkDir, { templates: [{ name: "tester", description: "tests", config: { id: "tester", command: ["x", "{prompt}"] } }], maxPerTask: 2 });
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxCostUsd: 1 });
    const swarm = async (id: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }));
    const backend = await swarm("backend");
    const reviewer = await swarm("reviewer");
    await backend.propose({ summary: "s", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "reviewer", responsibility: "review", files: [] }] });
    await reviewer.context();
    await reviewer.complete({});
    const sent = await backend.delegate({ template: "tester", job: "Benchmark the order query with 10k rows" });

    // a critique of the plan, as the critic writes it
    await fs.writeJson(["tasks", task.id, "plan", "state.json"], { versions: [{ n: 1, at: "" }], feedback: [] });
    await fs.writeJson(["tasks", task.id, "plan", "critique-v1.json"], { version: 1, risks: [], costUsd: 0.1 });
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), planReview: true });

    await session(task.id, "backend", { costUsd: 0.4 });
    await session(sent.job as string, "tester-job1", { costUsd: 0.3 });
    expect((await taskSpent(fs, task.id, undefined)).usd).toBeCloseTo(0.8);
    const stats = (await collectStats(fs, await operator.tasks.list())).get(task.id)!;
    expect(stats).toMatchObject({ jobsCostUsd: 0.3, criticCostUsd: 0.1 });
    expect(stats.costUsd).toBeCloseTo(0.8);

    // the job's next session passes the lead's limit: both stop for the operator
    const guard = costGuard({ networkDir });
    await session(sent.job as string, "tester-job1", { costUsd: 0.25 });
    await guard("tester-job1", sent.job as string);
    expect((await operator.tasks.get(task.id)).status).toBe("BLOCKED");
    expect((await operator.tasks.get(sent.job as string)).status).toBe("BLOCKED");
  });
});

describe("task cost limit", () => {
  it("is checked on creation and copied as given", async () => {
    const { operator } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxCostUsd: 2.5 });
    expect(task.maxCostUsd).toBe(2.5);
    for (const bad of [0, -1, Number.NaN, "abc" as unknown as number]) {
      await expect(operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxCostUsd: bad })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect((await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] })).maxCostUsd).toBeUndefined();
  });

  it("blocks the task once its sessions cost the limit; more money brings it back, fix rounds stay as they are", async () => {
    const { networkDir, operator, session } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxCostUsd: 1 });
    const backend = await NetworkService.create(networkDir, { id: "backend", type: "test" });
    await backend.registerAgent();
    await expect(backend.blockForCost(task.id, 5)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const lines: string[] = [];
    const guard = costGuard({ networkDir, log: (l) => lines.push(l) });
    await session(task.id, "backend", { costUsd: 0.6 });
    await guard("backend", task.id);
    expect((await operator.tasks.get(task.id)).status).toBe("ACTIVE");

    await session(task.id, "reviewer", { costUsd: 0.45 });
    await guard("reviewer", task.id);
    const blocked = await operator.tasks.get(task.id);
    expect(blocked).toMatchObject({ status: "BLOCKED", blockedBy: "cost", blockedReason: expect.stringContaining("cost limit $1 reached ($1.05 spent)") });
    expect(lines).toEqual([expect.stringContaining(`${task.id}: BLOCKED after reviewer's session: $1.05 spent, limit $1`)]);
    const events = (await operator.events.list(task.id)).map((e) => e.event);
    expect(events.find((e) => e.type === "TASK_BLOCKED")!.payload).toMatchObject({ kind: "cost", maxCostUsd: 1, spentUsd: 1.05 });
    await guard("backend", task.id); // already blocked: nothing more
    expect(events.filter((e) => e.type === "TASK_BLOCKED")).toHaveLength(1);

    await expect(operator.unblockTask(task.id, 1)).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("raise it with usd") });
    const back = await operator.unblockTask(task.id, 1, 2);
    expect(back).toMatchObject({ status: "ACTIVE", maxCostUsd: 3, maxFixRounds: 3 });
    expect(back.blockedBy).toBeUndefined();
    expect(back.blockedReason).toBeUndefined();
  });

  it("prices sessions without a CLI cost with the config's prices, and says when some have none", async () => {
    const { networkDir, operator, fs, session } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxCostUsd: 0.5 });
    await session(task.id, "backend", { model: "qwen", tokens: 200_000 }); // 200k in at $1/M + 200k out at $2/M = $0.6
    await session(task.id, "reviewer", { model: "other", tokens: 1000 });
    const prices = { qwen: { input: 1, output: 2 } };
    expect(await taskSpent(fs, task.id, prices)).toEqual({ usd: expect.closeTo(0.6, 5), unknown: 1 });
    const lines: string[] = [];
    await costGuard({ networkDir, prices: async () => ({ prices }), log: (l) => lines.push(l) })("backend", task.id);
    expect((await operator.tasks.get(task.id)).status).toBe("BLOCKED");
    expect(lines[0]).toContain("1 session(s) without a cost");
  });

  it("a block by fix rounds takes rounds, not money", async () => {
    const { operator } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxCostUsd: 1 });
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "BLOCKED", blockedReason: "fix-round limit reached" });
    await expect(operator.unblockTask(task.id, 1, 5)).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("not by money") });
  });

  it("the runner pool calls the check after every session", async () => {
    const { networkDir } = await setup();
    const calls: string[] = [];
    let seen: RunnerOptions | undefined;
    const pool = new RunnerPool(networkDir, [{ id: "backend", command: ["x", "{prompt}"], autostart: false }], {
      run: async (o) => {
        seen = o;
        await o.onSessionEnd?.("task-001");
        return 0;
      },
      onSessionEnd: async (agent, taskId) => {
        calls.push(`${agent}/${taskId}`);
      },
    });
    pool.start("backend");
    await new Promise((d) => setTimeout(d, 50));
    expect(seen?.onSessionEnd).toBeTypeOf("function");
    expect(calls).toEqual(["backend/task-001"]);
  });
});

describe("cost limit on the page, in runners.json and in schedules", () => {
  it("a new task gets the config's limit unless the form says otherwise; +$ unblocks; the supervisor may not", async () => {
    const { networkDir, operator, session } = await setup();
    const pool = new RunnerPool(networkDir, [{ id: "backend", command: ["x"], autostart: false }, { id: "reviewer", command: ["x"], autostart: false }]);
    ui = await startUiServer([{ networkDir, runners: pool, maxTaskCostUsd: 3 }], { port: 0 });
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const base = { title: "t", description: "d", agents: ["backend", "reviewer"] };
    const a = (await (await post("/api/tasks", base)).json()) as any;
    const b = (await (await post("/api/tasks", { ...base, maxCostUsd: "" })).json()) as any;
    const c = (await (await post("/api/tasks", { ...base, maxCostUsd: "7.5", allowSpawn: true })).json()) as any;
    expect([a.task.maxCostUsd, b.task.maxCostUsd, c.task.maxCostUsd]).toEqual([3, undefined, 7.5]);
    expect([a.task.allowSpawn, c.task.allowSpawn]).toEqual([undefined, true]); // the lead adds agents only when ticked
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.control.maxTaskCostUsd).toBe(3);
    expect(state.tasks.find((t: any) => t.id === a.task.id)).toMatchObject({ maxCostUsd: 3, blockedBy: null });

    await session(a.task.id, "backend", { costUsd: 3.2 });
    await operator.blockForCost(a.task.id, 3.2);
    const refused = await post(`/api/tasks/${a.task.id}/unblock`, { rounds: 1 }, { "x-agent-network-actor": "supervisor" });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).message).toContain("operator's decision");
    const ok = (await (await post(`/api/tasks/${a.task.id}/unblock`, { usd: 5 })).json()) as any;
    expect(ok.task).toMatchObject({ status: "ACTIVE", maxCostUsd: 8 });
  });

  it("runners.json: maxTaskCostUsd and a schedule's own maxCostUsd; the scheduler uses the default", async () => {
    const dir = await tmpDir();
    const networkDir = join(dir, ".agent-network");
    const path = join(dir, "runners.json");
    const write = (extra: Record<string, unknown>, schedule: Record<string, unknown> = {}) =>
      writeFile(path, JSON.stringify({ networkDir, defaults: { command: ["x", "{prompt}"] }, agents: [{ id: "backend" }, { id: "reviewer" }], schedules: [{ id: "nightly", cron: "@daily", title: "n", agents: ["backend", "reviewer"], ...schedule }], ...extra }));
    await write({ maxTaskCostUsd: 4 });
    const config = await loadRunnersConfig(path);
    expect(config.maxTaskCostUsd).toBe(4);
    await write({ maxTaskCostUsd: 0 });
    await expect(loadRunnersConfig(path)).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining('"maxTaskCostUsd" must be a positive amount') });
    await write({}, { maxCostUsd: "lots" });
    await expect(loadRunnersConfig(path)).rejects.toMatchObject({ message: expect.stringContaining('"maxCostUsd" must be a positive amount') });

    await write({ maxTaskCostUsd: 4 });
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const scheduler = new Scheduler({ networkDir, schedules: config.schedules!, configPath: path, maxTaskCostUsd: 4 });
    expect((await scheduler.runNow("nightly")).taskId).toBe("task-001");
    await write({ maxTaskCostUsd: 4 }, { maxCostUsd: 1.5 });
    await operator.cancelTask("task-001");
    await scheduler.tick(); // reads the file again
    expect((await scheduler.runNow("nightly")).taskId).toBe("task-002");
    expect((await operator.tasks.list()).map((t) => t.maxCostUsd)).toEqual([4, 1.5]);
  });
});

describe("a task's extra directories", () => {
  it("only the operator adds them: checked and made absolute against the project", async () => {
    const { networkDir, operator } = await setup();
    const { mkdir } = await import("node:fs/promises");
    const project = join(networkDir, "..");
    await mkdir(join(project, "..", "shared"), { recursive: true });
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], directories: ["../shared", " ", "../shared"] });
    expect(task.directories).toEqual([join(project, "..", "shared")]);
    await expect(operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], directories: ["../missing"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], directories: ["../a,b"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const backend = await NetworkService.create(networkDir, { id: "backend", type: "test" });
    await backend.registerAgent();
    await (await NetworkService.create(networkDir, { id: "reviewer", type: "test" })).registerAgent();
    await expect(backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"], directories: ["../shared"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] })).directories).toBeUndefined();
  });
});
