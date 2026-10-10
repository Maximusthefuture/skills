import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";

const assignments = [
  { agentId: "backend", responsibility: "REST API", files: ["src/main/**"] },
  { agentId: "reviewer", responsibility: "validation", files: ["src/test/**"] },
];
const CONCRETE = "Validate the currency code in PUT /orders: reject anything but ISO 4217 with 400 INVALID_CURRENCY; backend: OrderController, reviewer: tests.";

async function setup(maxFollowUps = 0) {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const services: Record<string, NetworkService> = {};
  const swarms: Record<string, Swarm> = {};
  for (const id of ["backend", "reviewer"]) {
    services[id] = await NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
    swarms[id] = new Swarm(services[id]!);
  }
  const s = swarms as Record<string, Swarm> & { backend: Swarm; reviewer: Swarm };
  const root = await operator.createTaskAsOperator({ title: "Orders", description: "d", agents: ["backend", "reviewer"], maxFollowUps });
  return { dir, operator, s, services, root };
}

async function failure(swarm: Swarm, p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return swarm.errorBody(e);
  }
  throw new Error("expected the call to fail");
}

async function toImplement(s: Awaited<ReturnType<typeof setup>>["s"]) {
  await s.backend.context();
  await s.backend.propose({ summary: "split", assignments });
  await s.reviewer.context();
  await s.reviewer.complete({});
  await s.backend.complete({});
}

/** IMPLEMENT -> INTEGRATE; the reviewer leaves a WARNING note that is a candidate for a follow-up. */
async function toIntegrate(s: Awaited<ReturnType<typeof setup>>["s"]) {
  await toImplement(s);
  await s.backend.complete({ result: "api" });
  await s.reviewer.complete({ result: "tests" });
  await s.backend.complete({ status: "PASS" });
  await s.reviewer.complete({ status: "PASS", findings: [{ severity: "WARNING", description: "PUT /orders accepts any currency string", relatedAgent: "backend" }] });
}

describe("subtasks", () => {
  it("an agent plans its part, works step by step, and the others see the progress", async () => {
    const { s } = await setup();
    await toImplement(s);
    const before = await s.backend.context();
    expect(before.hint).toContain("subtasks({add:");
    expect(before.allowedActions).toContain("subtasks");

    let r = await s.backend.subtasks({ add: ["Add currency column", "Validate currency", "Controller test"] });
    expect(r).toMatchObject({ ok: true, action: "SUBTASKS_UPDATED", progress: "0/3 done", nextAction: "implement" });
    expect((r.subtasks as { id: string }[]).map((i) => i.id)).toEqual(["s1", "s2", "s3"]);

    await s.backend.subtasks({ start: "s1" });
    r = await s.backend.subtasks({ done: ["s1"], start: "s2" });
    expect(r.progress).toBe("1/3 done, s2 in progress");
    r = await s.backend.subtasks({ start: "s3" }); // only one step is in progress
    expect((r.subtasks as { id: string; status: string }[]).filter((i) => i.status === "DOING").map((i) => i.id)).toEqual(["s3"]);

    const other = await s.reviewer.context();
    expect(other.otherAgents).toEqual([expect.objectContaining({ id: "backend", subtasks: "1/3 done, s3 in progress" })]);
    expect((await s.backend.context()).hint).toContain("Open subtasks: s2, s3 (doing)");
  });

  it("complete() is refused while subtasks are open; done or dropped (with a reason) closes them", async () => {
    const { s } = await setup();
    await toImplement(s);
    await s.backend.subtasks({ add: ["API", "Docs"] });
    const err = await failure(s.backend, s.backend.complete({ result: "api" }));
    expect(err).toMatchObject({ error: "OPEN_SUBTASKS", nextAction: "implement" });
    expect(err.message).toContain('s1 "API"');

    expect(await failure(s.backend, s.backend.subtasks({ drop: [{ id: "s2", reason: " " }] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.subtasks({ done: ["s9"] }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("Yours: s1, s2") });
    await s.backend.subtasks({ done: ["s1"], drop: [{ id: "s2", reason: "README already covers it" }] });
    expect((await s.backend.complete({ result: "api" })).action).toBe("IMPLEMENTATION_COMPLETED");

    await s.reviewer.complete({ result: "tests" });
    const review = await s.reviewer.context(); // SYNC: the reviewer sees the plan next to the work
    expect(review.teamImplementations).toEqual([expect.objectContaining({ agentId: "backend", subtasks: ["s1 [DONE] API", "s2 [DROPPED] Docs (README already covers it)"] })]);
  });

  it("the list lives on the server: a restarted session sees what is done", async () => {
    const { s, services } = await setup();
    await toImplement(s);
    await s.backend.subtasks({ add: ["A", "B"], done: [] });
    await s.backend.subtasks({ done: ["s1"] });
    const restarted = new Swarm(services.backend!);
    const ctx = await restarted.context();
    expect(ctx.subtasks).toEqual([
      { id: "s1", title: "A", status: "DONE" },
      { id: "s2", title: "B", status: "TODO" },
    ]);
  });
});

describe("follow-up tasks", () => {
  it("are refused when the operator did not enable them; the integration still works without", async () => {
    const { s } = await setup(0);
    await toIntegrate(s);
    const ctx = await s.backend.context();
    expect(ctx.followUps).toMatchObject({ max: 0, remaining: 0 });
    expect(ctx.hint).not.toContain("followUps:");
    const err = await failure(s.backend, s.backend.complete({ status: "PASS", result: "merged", followUps: [{ title: "Currency", description: CONCRETE }] }));
    expect(err).toMatchObject({ error: "FOLLOW_UP_LIMIT", currentPhase: "INTEGRATE" });
    expect((await s.backend.complete({ status: "PASS", result: "merged" })).task).toMatchObject({ phase: "DONE" });
  });

  it("the lead turns notes into a follow-up; the agents move on to it; the chain budget is shared", async () => {
    const { s, operator, root } = await setup(2);
    await toIntegrate(s);
    const ctx = await s.backend.context();
    expect(ctx.followUps).toMatchObject({ max: 2, used: 0, remaining: 2, notes: [expect.objectContaining({ severity: "WARNING", reportedBy: "reviewer" })] });
    expect(ctx.hint).toContain("up to 2 follow-up task(s)");
    expect((await s.reviewer.context()).followUps).toBeUndefined(); // only the lead decides

    const waiting = s.reviewer.wait({ timeoutMs: 5000 });
    const res = await s.backend.complete({ status: "PASS", result: "merged", followUps: [{ title: "Currency validation", description: CONCRETE }] });
    expect(res.followUpsCreated).toEqual([{ id: "task-002", title: "Currency validation", agents: ["backend", "reviewer"] }]);
    expect((await operator.tasks.get(root.id))).toMatchObject({ status: "COMPLETED", phase: "DONE", followUpsUsed: 1 });
    expect((await operator.tasks.get(root.id)).phaseHistory!.map((h) => h.phase)).toEqual(["DISCUSS", "IMPLEMENT", "SYNC", "INTEGRATE", "DONE"]);
    expect(await operator.tasks.get("task-002")).toMatchObject({ status: "ACTIVE", phase: "DISCUSS", parentTaskId: root.id, rootTaskId: root.id, createdBy: "backend" });

    const woke = await waiting; // the reviewer is already on the next task
    expect(woke.task).toMatchObject({ id: "task-002", parentTaskId: root.id });
    expect((await s.backend.context()).task).toMatchObject({ id: "task-002" });

    // the follow-up's own integration sees the rest of the chain budget
    await toIntegrate(s);
    expect((await s.backend.context()).followUps).toMatchObject({ max: 2, used: 1, remaining: 1 });
    const tooMany = await failure(s.backend, s.backend.complete({ status: "PASS", result: "m", followUps: [{ title: "a", description: CONCRETE }, { title: "b", description: CONCRETE }] }));
    expect(tooMany).toMatchObject({ error: "FOLLOW_UP_LIMIT", maxFollowUps: 2, followUpsUsed: 1 });
    expect((await operator.tasks.get("task-002")).phase).toBe("INTEGRATE"); // nothing was written
  });

  it("only with PASS, only in INTEGRATE, concrete, for registered agents", async () => {
    const { s } = await setup(3);
    await toImplement(s);
    expect(await failure(s.backend, s.backend.complete({ result: "x", followUps: [{ title: "t", description: CONCRETE }] }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("followUps") });
    await s.backend.complete({ result: "api" });
    await s.reviewer.complete({ result: "tests" });
    await s.backend.complete({ status: "PASS" });
    await s.reviewer.complete({ status: "PASS" });
    const needsFix = s.backend.complete({ status: "NEEDS_FIX", result: "conflict", findings: [{ severity: "ERROR", description: "merge conflict", relatedAgent: "reviewer" }], followUps: [{ title: "t", description: CONCRETE }] });
    expect(await failure(s.backend, needsFix)).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("only with status PASS") });
    expect(await failure(s.backend, s.backend.complete({ status: "PASS", result: "m", followUps: [{ title: "t", description: "fix stuff" }] }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("concretely") });
    expect(await failure(s.backend, s.backend.complete({ status: "PASS", result: "m", followUps: [{ title: "t", description: CONCRETE, agents: ["backend"] }] }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("two distinct agents") });
    expect(await failure(s.backend, s.backend.complete({ status: "PASS", result: "m", followUps: [{ title: "t", description: CONCRETE, agents: ["backend", "ghost"] }] }))).toMatchObject({ error: "AGENT_NOT_REGISTERED" });
    const ok = await s.backend.complete({ status: "PASS", result: "m", followUps: [{ title: "t", description: CONCRETE, agents: ["reviewer", "backend"] }] });
    expect(ok.followUpsCreated).toEqual([{ id: "task-002", title: "t", agents: ["reviewer", "backend"] }]); // reviewer leads it
  });
});

describe("follow-ups in a git repository", () => {
  it("carry the merged HEAD as baseCommit; commits are not checked against it", async () => {
    const repo = await tmpDir();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "README.md"), "# demo\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    const before = git("rev-parse", "HEAD");
    const commit = (file: string) => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), file);
      git("add", file);
      git("commit", "-q", "-m", file);
      return git("rev-parse", "HEAD");
    };
    const dir = join(repo, ".agent-network");
    const s: Record<string, NetworkService> = {};
    for (const id of ["backend", "reviewer"]) {
      s[id] = await NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
      await s[id]!.registerAgent();
    }
    const backend = s.backend!;
    const reviewer = s.reviewer!;
    const agreeAndStart = async (taskId: string) => {
      await backend.proposeAgreement({ taskId, summary: "s", assignments });
      await backend.approveAgreement({ taskId });
      await reviewer.approveAgreement({ taskId });
      await backend.startImplementation(taskId);
      await reviewer.startImplementation(taskId);
    };

    const root = await backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"], maxFollowUps: 1 });
    await agreeAndStart(root.id);
    await backend.completeImplementation({ taskId: root.id, summary: "api", commits: [commit("src/main/Api.java")] });
    await reviewer.completeImplementation({ taskId: root.id, summary: "tests", commits: [commit("src/test/ApiTest.java")] });
    await backend.submitSync({ taskId: root.id, status: "PASS" });
    await reviewer.submitSync({ taskId: root.id, status: "PASS" });
    const merged = git("rev-parse", "HEAD");
    const { followUps } = await backend.submitIntegration({ taskId: root.id, status: "PASS", result: "merged", commits: [merged], followUps: [{ title: "Currency", description: CONCRETE }] });
    expect(followUps[0]).toMatchObject({ baseCommit: merged, git: { commit: merged }, parentTaskId: root.id });

    const child = followUps[0]!.id;
    await agreeAndStart(child);
    git("checkout", "-q", before); // a branch without the merged result is accepted: commits are only recorded
    const stale = commit("src/main/Currency.java");
    git("checkout", "-q", "main");
    expect((await backend.completeImplementation({ taskId: child, summary: "currency", commits: [stale] })).implementation.commits).toEqual([stale]);
  });
});

describe("review-only agents (files: [])", () => {
  it("an agent with no files of its own reviews the others: no invented file, ready right away", async () => {
    const { s } = await setup();
    await s.backend.context();
    expect((await s.backend.context()).hint).toContain("files: []");
    const missing = await failure(s.backend, s.backend.propose({ summary: "x", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "reviewer", responsibility: "review" } as never] }));
    expect(missing).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("'files: []' for an agent that changes nothing") });
    const nobody = await failure(s.backend, s.backend.propose({ summary: "x", assignments: [{ agentId: "backend", responsibility: "a", files: [] }, { agentId: "reviewer", responsibility: "b", files: [] }] }));
    expect(nobody).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("At least one agent must own files") });

    await s.backend.propose({ summary: "README", assignments: [{ agentId: "backend", responsibility: "write README.md", files: ["README.md"] }, { agentId: "reviewer", responsibility: "check README.md", files: [] }] });
    await s.reviewer.context();
    await s.reviewer.complete({});
    await s.backend.complete({});

    const review = await s.reviewer.context();
    expect(review).toMatchObject({ nextAction: "implement", ownership: { yourFiles: [], reviewOnly: true } });
    expect(review.hint).toContain("Your assignment has no files");
    expect(review.ownership).toEqual({ yourFiles: [], reviewOnly: true, othersFiles: [{ agentId: "backend", files: ["README.md"] }] });
    expect((await s.reviewer.complete({ result: "review only: nothing to change" })).action).toBe("IMPLEMENTATION_COMPLETED");
    const done = await s.backend.complete({ result: "README", filesChanged: ["README.md", "docs/extra.md"] }); // an undeclared file is a warning, not a refusal
    expect(done).toMatchObject({ action: "IMPLEMENTATION_COMPLETED", phaseChanged: { to: "SYNC" }, warnings: [expect.stringContaining("docs/extra.md")] });
  });
});
