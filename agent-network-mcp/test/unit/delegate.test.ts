import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { Spawner, writeSpawnFile } from "../../src/spawner.js";
import { RunnerPool, type SpawnConfig } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

const SPAWN: SpawnConfig = {
  templates: [{ name: "tester", description: "cross-cutting tests", config: { id: "tester", command: ["x", "{prompt}"] } }],
  maxPerTask: 2,
};

/** A task in IMPLEMENT: backend leads, reviewer reviews; the network has a "tester" template to delegate to. */
async function setup() {
  const root = await tmpDir();
  const networkDir = join(root, "shop", ".agent-network");
  mkdirSync(networkDir, { recursive: true });
  await writeSpawnFile(networkDir, SPAWN);
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const swarm = async (id: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }));
  const backend = await swarm("backend");
  const reviewer = await swarm("reviewer");
  const task = await operator.createTaskAsOperator({ title: "Orders", description: "POST /orders", agents: ["backend", "reviewer"], maxCostUsd: 2 });
  await backend.propose({ summary: "orders", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/main/**"] }, { agentId: "reviewer", responsibility: "review", files: [] }] });
  await backend.context();
  await backend.complete({});
  await reviewer.context(); // an agent approves the version it has seen
  await reviewer.complete({});
  return { networkDir, operator, swarm, backend, reviewer, task };
}

async function failure(swarm: Swarm, p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return swarm.errorBody(e);
  }
  throw new Error("expected the call to fail");
}

describe("the lead delegates a job to a new runner", () => {
  it("a task of one agent in IMPLEMENT, the lead's open subtask; its complete() ends it and the result goes back to the lead", async () => {
    const { networkDir, operator, swarm, backend, reviewer, task } = await setup();
    const ctx = await backend.context();
    expect(ctx).toMatchObject({ nextAction: "implement", delegable: { templates: [{ name: "tester" }], left: 2 } });
    expect(ctx.allowedActions).toContain("delegate");
    expect(String(ctx.hint)).toContain("delegate({template, job, files})");
    expect((await reviewer.context()).allowedActions).not.toContain("delegate");
    expect(await failure(reviewer, reviewer.delegate({ template: "tester", job: "Load test POST /orders with 50 requests" }))).toMatchObject({ error: "FORBIDDEN" });
    expect(await failure(backend, backend.delegate({ template: "tester", job: "too short" }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(backend, backend.delegate({ template: "nope", job: "Load test POST /orders with 50 requests" }))).toMatchObject({ error: "INVALID_INPUT" });

    const sent = await backend.delegate({ template: "tester", job: "Load test POST /orders with 50 parallel requests; report p95 and errors", files: ["src/test/java/load/**"] });
    expect(sent).toMatchObject({ ok: true, action: "JOB_DELEGATED", agentId: "tester-job1", subtask: "s1" });
    const job = await operator.tasks.get(sent.job as string);
    expect(job).toMatchObject({
      phase: "IMPLEMENT", status: "ACTIVE", agents: ["tester-job1"], parentTaskId: task.id, maxCostUsd: 2,
      jobOf: { taskId: task.id, by: "backend", subtask: "s1" }, spawned: [{ id: "tester-job1", template: "tester", by: "backend" }],
    });
    expect(job.description).toContain("You do this job alone");
    expect(await operator.agreements.find(job.id)).toMatchObject({ approvedBy: ["tester-job1"], assignments: [{ agentId: "tester-job1", files: ["src/test/java/load/**"] }] });
    expect((await backend.context()).jobs).toEqual([{ task: job.id, agent: "tester-job1", status: "running", job: "Load test POST /orders with 50 parallel requests; report p95 and errors", subtask: "s1" }]);

    // the page starts its runner like any spawned agent
    const pool = new RunnerPool(networkDir, []);
    await new Spawner({ networkDir, spawn: SPAWN, pool }).tick();
    expect(pool.ids()).toContain("tester-job1");
    await pool.stopAll();

    // the lead cannot hand its part in while the job runs
    expect(await failure(backend, backend.complete({ result: "api done", filesChanged: ["src/main/A.java"] }))).toMatchObject({ error: "OPEN_SUBTASKS" });

    // the job agent works it alone and completes: DONE, no SYNC
    const tester = await swarm("tester-job1");
    const jc = await tester.context();
    expect(jc).toMatchObject({ nextAction: "implement" });
    expect(String(jc.hint)).toContain("A job backend (the lead of");
    await tester.complete({ result: "p95 120 ms at 50 rps, 0 errors", filesChanged: ["src/test/java/load/OrdersLoadTest.java"] });
    expect(await operator.tasks.get(job.id)).toMatchObject({ phase: "DONE", status: "COMPLETED" });

    // back to the lead: its subtask ticked, the result in its messages
    const woke = await backend.wait({ timeoutMs: 3000 });
    expect(woke.status).toBe("MESSAGES");
    const note = (woke.pendingMessages as { from: string; content: string }[]).find((m) => m.from === "tester-job1")!;
    expect(note.content).toContain("Your delegated job");
    expect(note.content).toContain("p95 120 ms at 50 rps");
    expect((await operator.subtasks.get(task.id, "backend")).items).toMatchObject([{ id: "s1", status: "DONE", note: "p95 120 ms at 50 rps, 0 errors" }]);
    expect((await backend.context()).jobs).toMatchObject([{ status: "done" }]);
    await backend.complete({ result: "api done", filesChanged: ["src/main/A.java"] });
  });

  it("a cancelled job drops the lead's subtask and says so; the limit counts jobs and spawned agents together", async () => {
    const { operator, backend, task } = await setup();
    const first = await backend.delegate({ template: "tester", job: "Find why OrderServiceTest fails on CI only" });
    await backend.delegate({ template: "tester", job: "Benchmark the order query with 10k rows" });
    expect(await failure(backend, backend.delegate({ template: "tester", job: "One more job beyond the limit here" }))).toMatchObject({ error: "INVALID_INPUT" });
    await operator.cancelTask(first.job as string, "not needed after all");
    expect((await operator.subtasks.get(task.id, "backend")).items[0]).toMatchObject({ status: "DROPPED", note: "cancelled: not needed after all" });
    const msgs = await operator.messages.list(task.id);
    expect(msgs.at(-1)).toMatchObject({ to: "backend", content: expect.stringContaining("was cancelled: not needed after all") });
    // a job does not delegate further
    const tester = new Swarm(await NetworkService.create(operator.networkDir, { id: "tester-job2", type: "test" }));
    expect(await failure(tester, tester.delegate({ template: "tester", job: "Delegate my own job further please" }))).toMatchObject({ error: "FORBIDDEN" });
  });
});
