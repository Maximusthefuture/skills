import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { isHandedOver } from "../../src/handoff.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";

const assignments = [
  { agentId: "backend", responsibility: "REST API", files: ["src/main/**"] },
  { agentId: "reviewer", responsibility: "validation", files: ["src/test/**"] },
];

async function setup(ids = ["backend", "reviewer"]) {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const swarms: Record<string, Swarm> = {};
  const services: Record<string, NetworkService> = {};
  for (const id of ids) {
    services[id] = await NetworkService.create(dir, { id, type: "test", role: id }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
    swarms[id] = new Swarm(services[id]!);
  }
  const s = swarms as Record<string, Swarm> & { backend: Swarm; reviewer: Swarm };
  const task = (agents = ids, title = "Registration") => operator.createTaskAsOperator({ title, description: "d", agents });
  return { dir, operator, s, services, task };
}

/** Run an action that must fail; return the LLM-facing error body. */
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
  await s.backend.propose({ summary: "split", assignments, interfaces: ["POST /users"] });
  await s.reviewer.context(); // reviews it
  await s.reviewer.complete({});
  await s.backend.complete({});
}

async function toSync(s: Awaited<ReturnType<typeof setup>>["s"]) {
  await toImplement(s);
  await s.backend.complete({ result: "api", filesChanged: ["src/Api.java"], commits: ["abc123"] });
  await s.reviewer.complete({ result: "validation", filesChanged: ["src/Validator.java"] });
}

/** From SYNC to DONE: both reviews pass, the lead integrates. */
async function toDone(s: Awaited<ReturnType<typeof setup>>["s"]) {
  await s.backend.complete({ status: "PASS" });
  await s.reviewer.complete({ status: "PASS" });
  return s.backend.complete({ status: "PASS", result: "merged, build green" });
}

describe("swarm_context", () => {
  it("without a task says to wait and names the network, so a wrong NETWORK_DIR is visible", async () => {
    const { s, dir } = await setup();
    const ctx = await s.backend.context();
    expect(ctx).toMatchObject({ task: null, nextAction: "wait", allowedActions: ["create_task", "wait"], agent: { id: "backend" }, networkDir: expect.stringContaining(".agent-network") });
    expect(ctx.hint).toContain("backend");
    const err = await failure(s.backend, s.backend.propose({}));
    expect(err).toMatchObject({ error: "NO_ACTIVE_TASK", agentId: "backend", networkDir: ctx.networkDir, nextAction: "wait" });
    expect(err.message).toContain("Do NOT call propose");
    expect(dir.length).toBeGreaterThan(0);
  });

  it("DISCUSS: the lead is told to propose, the others to wait; registration is automatic", async () => {
    const { s, task, services } = await setup();
    await task();
    const lead = await s.backend.context();
    expect(lead).toMatchObject({
      task: { id: "task-001", phase: "DISCUSS", status: "ACTIVE", agents: ["backend", "reviewer"] },
      nextAction: "propose",
      allowedActions: ["send_message", "propose", "wait"],
    });
    expect(lead.agreement).toBeUndefined(); // compact: empty fields are left out
    expect(lead.assignment).toBeUndefined();
    expect(lead.otherAgents).toEqual([{ id: "reviewer", status: "NOT_REGISTERED" }]);
    expect(await services.backend!.agents.get("backend")).toMatchObject({ status: "ONLINE" });
    const other = await s.reviewer.context();
    expect(other).toMatchObject({ nextAction: "wait", allowedActions: ["send_message", "propose", "wait"] });
    expect((other.otherAgents as any[])[0]).toEqual({ id: "backend", status: "ONLINE" }); // role = id is left out
    expect(((await s.reviewer.context({ full: true })).otherAgents as any[])[0]).toMatchObject({ id: "backend", role: "backend" });
  });

  it("walks every phase with the right nextAction / allowedActions / assignment", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    const proposed = await s.backend.propose({ summary: "split", assignments, decisions: ["UUID ids"], interfaces: ["POST /users"] });
    expect(proposed).toMatchObject({ ok: true, action: "AGREEMENT_PROPOSED", nextAction: "approve", allowedActions: ["send_message", "propose", "complete", "wait"] });
    expect(proposed.agreement).toMatchObject({ summary: "split", decisions: ["UUID ids"], approvedBy: [] });

    await s.reviewer.context();
    expect(await s.reviewer.complete({})).toMatchObject({ action: "AGREEMENT_APPROVED", nextAction: "wait", waitingOn: ["backend"] });
    const toImpl = await s.backend.complete({});
    expect(toImpl).toMatchObject({ task: { phase: "IMPLEMENT" }, phaseChanged: { from: "DISCUSS", to: "IMPLEMENT" }, nextAction: "implement", assignment: { responsibility: "REST API" } });

    const impl = await s.backend.complete({ result: "api", filesChanged: ["src/Api.java"], commits: ["abc123"] });
    expect(impl).toMatchObject({ action: "IMPLEMENTATION_COMPLETED", nextAction: "wait", implementation: { status: "READY_FOR_SYNC" }, waitingOn: ["reviewer"] });
    expect((await s.backend.context({ full: true })).implementation).toMatchObject({ status: "READY_FOR_SYNC", filesChanged: ["src/Api.java"], commits: ["abc123"] });
    const sync = await s.reviewer.complete({ result: "validation" });
    expect(sync).toMatchObject({ phaseChanged: { from: "IMPLEMENT", to: "SYNC" }, nextAction: "sync", allowedActions: ["send_message", "complete", "wait"] });
    expect(sync.teamImplementations).toEqual([expect.objectContaining({ agentId: "backend", filesChanged: ["src/Api.java"], commits: ["abc123"] })]);

    expect(sync.reviewTargets).toEqual(["backend"]);

    expect(await s.backend.complete({ status: "PASS" })).toMatchObject({ action: "SYNC_PASS", nextAction: "wait" });
    const integrate = await s.reviewer.complete({ status: "PASS", findings: [{ severity: "WARNING", description: "rename dto" }] });
    expect(integrate).toMatchObject({ phaseChanged: { from: "SYNC", to: "INTEGRATE" }, nextAction: "wait", waitingOn: ["backend"] });
    const lead = await s.backend.context();
    expect(lead).toMatchObject({ nextAction: "integrate", allowedActions: ["send_message", "complete", "wait"], task: { lead: "backend", maxFixRounds: 3 } });
    expect(lead.hint).toContain('complete({status: "PASS", result})');
    expect(await failure(s.backend, s.backend.complete({ status: "PASS" }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("'result'") });
    expect(await failure(s.backend, s.backend.complete({ status: "PASS", result: "x", filesChanged: ["a"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.reviewer, s.reviewer.complete({ status: "PASS", result: "x" }))).toMatchObject({ error: "NOT_ASSIGNED" });

    const done = await s.backend.complete({ status: "PASS", result: "merged into main, tests green", commits: ["abc999"] });
    expect(done).toMatchObject({ action: "INTEGRATION_PASS", task: { phase: "DONE", status: "COMPLETED" }, nextAction: "done", allowedActions: [] });
    expect((await s.backend.context({ full: true })).integration).toMatchObject({ status: "PASS", commits: ["abc999"] });
    expect(await s.reviewer.context()).toMatchObject({ nextAction: "done" });
  });

  it("gives a ready-to-copy exampleCall with the real agent ids", async () => {
    const { s, task } = await setup();
    await task();
    const lead = await s.backend.context();
    expect(lead.exampleCall).toMatchObject({ tool: "propose", args: { assignments: [{ agentId: "backend" }, { agentId: "reviewer" }] } });
    expect((await s.reviewer.context()).exampleCall).toBeUndefined(); // simple calls are spelled out in the hint
    await s.backend.propose({ summary: "s", assignments });
    expect((await s.reviewer.context()).exampleCall).toBeUndefined();
  });

  it("is idempotent: pending messages stay until the agent acts, then count as read", async () => {
    const { s, task } = await setup();
    await task();
    await s.reviewer.context();
    await s.backend.sendMessage({ to: "reviewer", message: "UUID or Long?" });
    const first = await s.reviewer.context();
    expect(first.pendingMessages).toEqual([expect.objectContaining({ from: "backend", content: "UUID or Long?" })]);
    expect((await s.reviewer.context()).pendingMessages).toHaveLength(1);
    await s.reviewer.sendMessage({ to: "backend", message: "UUID" }); // acting acknowledges what was shown
    expect((await s.reviewer.context()).pendingMessages).toHaveLength(0);
    expect((await s.backend.context()).pendingMessages).toEqual([expect.objectContaining({ from: "reviewer", content: "UUID" })]);
  });

  it("messages not yet shown are not acknowledged by an action", async () => {
    const { s, task } = await setup();
    await task();
    await s.reviewer.context();
    await s.backend.sendMessage({ to: "reviewer", message: "m1" });
    await s.reviewer.sendMessage({ to: "backend", message: "hi" }); // m1 never shown to reviewer
    expect((await s.reviewer.context()).pendingMessages).toHaveLength(1);
  });

  it("serves the oldest active task first and moves on after it is done", async () => {
    const { s, task } = await setup();
    await task(["backend", "reviewer"], "first");
    await task(["backend", "reviewer"], "second");
    expect((await s.backend.context()).task).toMatchObject({ id: "task-001", title: "first" });
    await toSync(s);
    await toDone(s);
    expect((await s.backend.context()).task).toMatchObject({ id: "task-002", title: "second", phase: "DISCUSS" });
  });
});

describe("NEEDS_FIX loop", () => {
  it("only the agent named in relatedAgent has to fix; fixRequests explain what", async () => {
    const { s, task } = await setup();
    await task();
    await toSync(s);
    await s.backend.complete({ status: "PASS" });
    const res = await s.reviewer.complete({ status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "API returns Long, DB uses UUID", relatedAgent: "backend", files: ["src/Api.java"] }] });
    expect(res).toMatchObject({ phaseChanged: { from: "SYNC", to: "IMPLEMENT" }, nextAction: "wait", waitingOn: ["backend"] });

    const backend = await s.backend.context();
    expect(backend).toMatchObject({ nextAction: "fix", implementation: { status: "IN_PROGRESS" } });
    expect(backend.fixRequests).toEqual([expect.objectContaining({ reportedBy: "reviewer", forYou: true, description: "API returns Long, DB uses UUID" })]);

    // round 2 reviews only backend's fix: reviewer reviews, backend has nothing to review
    expect(await s.backend.complete({ result: "switched to UUID", commits: ["def456"] })).toMatchObject({ phaseChanged: { to: "SYNC" }, task: { syncRound: 2 }, nextAction: "wait", waitingOn: ["reviewer"] });
    expect(await s.reviewer.context()).toMatchObject({ nextAction: "sync", reviewTargets: ["backend"] });
    expect(await failure(s.backend, s.backend.complete({ status: "PASS" }))).toMatchObject({ error: "NOT_ASSIGNED", nextAction: "wait" });
    expect(await s.reviewer.complete({ status: "PASS" })).toMatchObject({ phaseChanged: { to: "INTEGRATE" } });
    expect(await s.backend.complete({ status: "PASS", result: "merged" })).toMatchObject({ task: { phase: "DONE" } });
  });

  it("NEEDS_FIX needs an ERROR finding; WARNING-only findings go with PASS", async () => {
    const { s, task } = await setup();
    await task();
    await toSync(s);
    expect(await failure(s.backend, s.backend.complete({ status: "NEEDS_FIX", findings: [{ severity: "WARNING", description: "style" }] }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("ERROR"), nextAction: "sync" });
    expect(await s.backend.complete({ status: "PASS", findings: [{ severity: "WARNING", description: "style" }] })).toMatchObject({ action: "SYNC_PASS" });
  });

  it("integration failure sends the named agent back with fixRequests", async () => {
    const { s, task } = await setup();
    await task();
    await toSync(s);
    await s.backend.complete({ status: "PASS" });
    await s.reviewer.complete({ status: "PASS" });
    const res = await s.backend.complete({ status: "NEEDS_FIX", result: "merge conflict-free, ValidatorTest fails", findings: [{ severity: "ERROR", description: "ValidatorTest expects 422", relatedAgent: "reviewer" }] });
    expect(res).toMatchObject({ action: "INTEGRATION_NEEDS_FIX", phaseChanged: { from: "INTEGRATE", to: "IMPLEMENT" }, nextAction: "wait" });
    const reviewer = await s.reviewer.context();
    expect(reviewer).toMatchObject({ nextAction: "fix" });
    expect(reviewer.fixRequests).toEqual([expect.objectContaining({ reportedBy: "backend", forYou: true, description: "ValidatorTest expects 422" })]);
  });

  it("a BLOCKED task tells everyone to wait and wakes waiting agents", async () => {
    const { s, operator } = await setup();
    await operator.createTaskAsOperator({ title: "limited", description: "d", agents: ["backend", "reviewer"], maxFixRounds: 0 });
    await toSync(s);
    await s.backend.complete({ status: "PASS" });
    const waiting = s.backend.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 150));
    await s.reviewer.complete({ status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "broken", relatedAgent: "backend" }] });
    const woke = await waiting;
    expect(woke).toMatchObject({ status: "UPDATED", nextAction: "wait", task: { status: "BLOCKED", blockedReason: expect.stringContaining("limit of 0") }, waitingOn: ["operator"] });
    expect(woke.hint).toContain("operator");
    // a blocked task stays the current one: no new task may be created by an agent meanwhile
    expect(await failure(s.backend, s.backend.createTask({ title: "x", description: "y".repeat(50), agents: ["reviewer"] }))).toMatchObject({ error: "HAS_ACTIVE_TASK" });
    await operator.unblockTask("task-001");
    expect(await s.backend.context()).toMatchObject({ nextAction: "fix", task: { status: "ACTIVE", maxFixRounds: 1 } });
  });
});

describe("tool misuse (state is never corrupted, errors are actionable)", () => {
  const SHAPE = { error: expect.any(String), message: expect.any(String), nextAction: expect.any(String) };

  it("complete during DISCUSS without agreement", async () => {
    const { s, task } = await setup();
    await task();
    const err = await failure(s.reviewer, s.reviewer.complete({}));
    expect(err).toMatchObject({ ...SHAPE, error: "AGREEMENT_NOT_READY", currentPhase: "DISCUSS", nextAction: "wait", allowedActions: ["send_message", "propose", "wait"], pending: ["backend", "reviewer"] });
    expect((await s.reviewer.context()).task).toMatchObject({ phase: "DISCUSS" });
  });

  it("propose during IMPLEMENT and SYNC", async () => {
    const { s, task } = await setup();
    await task();
    await toImplement(s);
    expect(await failure(s.backend, s.backend.propose({ summary: "x", assignments }))).toMatchObject({ error: "INVALID_PHASE", currentPhase: "IMPLEMENT", nextAction: "implement", allowedActions: ["send_message", "subtasks", "complete", "wait"] });
    await s.backend.complete({ result: "a" });
    await s.reviewer.complete({ result: "b" });
    expect(await failure(s.backend, s.backend.propose({ summary: "x", assignments }))).toMatchObject({ error: "INVALID_PHASE", currentPhase: "SYNC", nextAction: "sync" });
  });

  it("propose needs a summary and one assignment per agent", async () => {
    const { s, task } = await setup();
    await task();
    expect(await failure(s.backend, s.backend.propose({}))).toMatchObject({ error: "INVALID_INPUT", taskAgents: ["backend", "reviewer"] });
    expect(await failure(s.backend, s.backend.propose({ summary: "s" }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("backend, reviewer") });
    expect(await failure(s.backend, s.backend.propose({ summary: "s", assignments: [assignments[0]!] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.propose({ summary: "s", assignments: [...assignments, { agentId: "stranger", responsibility: "x", files: ["x/**"] }] }))).toMatchObject({ error: "NOT_ASSIGNED" });
  });

  it("actions with no task", async () => {
    const { s } = await setup();
    for (const p of [() => s.backend.complete({}), () => s.backend.propose({ summary: "s", assignments }), () => s.backend.sendMessage({ to: "reviewer", message: "x" })]) {
      expect(await failure(s.backend, p())).toMatchObject({ error: "NO_ACTIVE_TASK", nextAction: "wait", allowedActions: ["create_task", "wait"] });
    }
  });

  it("send_message to a nonexistent agent, to self, empty, or to an agent of another task", async () => {
    const { s, task } = await setup(["backend", "reviewer", "outsider"]);
    await task(["backend", "reviewer"]);
    expect(await failure(s.backend, s.backend.sendMessage({ to: "ghost", message: "x" }))).toMatchObject({ error: "NOT_ASSIGNED", validRecipients: ["reviewer", "operator"] });
    expect(await failure(s.backend, s.backend.sendMessage({ to: "outsider", message: "x" }))).toMatchObject({ error: "NOT_ASSIGNED", validRecipients: ["reviewer", "operator"] });
    expect(await failure(s.backend, s.backend.sendMessage({ to: "backend", message: "x" }))).toMatchObject({ error: "NOT_ASSIGNED" });
    expect(await failure(s.backend, s.backend.sendMessage({ to: "reviewer", message: "   " }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.sendMessage({ message: "x" }))).toMatchObject({ error: "INVALID_INPUT", validRecipients: ["reviewer", "operator"] });
    expect(await failure(s.outsider!, s.outsider!.sendMessage({ to: "backend", message: "x" }))).toMatchObject({ error: "NO_ACTIVE_TASK" });
    expect((await s.reviewer.context()).pendingMessages).toEqual([]);
  });

  it("complete with arguments that do not belong to the phase", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    await s.backend.propose({ summary: "s", assignments });
    expect(await failure(s.reviewer, s.reviewer.complete({ result: "done already" }))).toMatchObject({ error: "INVALID_INPUT", currentPhase: "DISCUSS" });

    await s.reviewer.context();
    await s.reviewer.complete({});
    await s.backend.complete({});
    expect(await failure(s.backend, s.backend.complete({}))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("requires 'result'"), nextAction: "implement" });
    expect(await failure(s.backend, s.backend.complete({ result: "x", status: "PASS" }))).toMatchObject({ error: "INVALID_INPUT" });
    await s.backend.complete({ result: "x" });
    expect(await failure(s.backend, s.backend.complete({ result: "again" }))).toMatchObject({ error: "ALREADY_COMPLETED", nextAction: "wait" });
    await s.reviewer.complete({ result: "y" });

    expect(await failure(s.backend, s.backend.complete({}))).toMatchObject({ error: "INVALID_INPUT", currentPhase: "SYNC", nextAction: "sync" });
    expect(await failure(s.backend, s.backend.complete({ status: "MAYBE" }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.complete({ status: "NEEDS_FIX" }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("finding") });
    expect(await failure(s.backend, s.backend.complete({ status: "PASS", result: "x" }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.complete({ status: "NEEDS_FIX", findings: [{ severity: "HUGE", description: "x" }] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.complete({ status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "x", files: ["../../etc/passwd"] }] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect((await s.backend.context()).task).toMatchObject({ phase: "SYNC" });
  });

  it("rejects unsafe paths and commits on IMPLEMENT completion without changing state", async () => {
    const { s, task } = await setup();
    await task();
    await toImplement(s);
    expect(await failure(s.backend, s.backend.complete({ result: "x", filesChanged: ["/etc/passwd"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.complete({ result: "x", commits: ["--evil"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect((await s.backend.context()).implementation).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("complete after DONE", async () => {
    const { s, task } = await setup();
    await task();
    await toSync(s);
    await toDone(s);
    expect(await failure(s.backend, s.backend.complete({ status: "PASS" }))).toMatchObject({ error: "INVALID_PHASE", currentPhase: "DONE", nextAction: "done" });
  });

  it("the agent can always recover with swarm_context after any error", async () => {
    const { s, task } = await setup();
    await task();
    await failure(s.reviewer, s.reviewer.complete({ result: "x" }));
    expect(await s.reviewer.context()).toMatchObject({ nextAction: "wait", task: { phase: "DISCUSS" } });
  });

  it("a blind complete() cannot approve an agreement the agent has not seen", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    await s.backend.propose({ summary: "v1", assignments });
    const err = await failure(s.reviewer, s.reviewer.complete({}));
    expect(err).toMatchObject({ error: "AGREEMENT_NOT_REVIEWED", nextAction: "approve", agreement: { summary: "v1", version: 1 } });
    expect((await s.reviewer.context()).agreement).toMatchObject({ approvedBy: [] });
    // seeing it (via the error body or swarm_context) is enough
    await s.reviewer.complete({});
    expect((await s.reviewer.context()).agreement).toMatchObject({ approvedBy: ["reviewer"] });
  });

  it("a replaced agreement has to be reviewed again", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    await s.backend.propose({ summary: "v1", assignments });
    await s.reviewer.context();
    await s.backend.propose({ summary: "v2", assignments }); // replaces v1 before the reviewer approves
    expect(await failure(s.reviewer, s.reviewer.complete({}))).toMatchObject({ error: "AGREEMENT_NOT_REVIEWED", agreement: { version: 2 } });
  });
});

describe("wait", () => {
  it("returns immediately when action is required (never blocks an agent that has work)", async () => {
    const { s, task } = await setup();
    await task();
    const started = Date.now();
    const res = await s.backend.wait({ timeoutMs: 10_000 });
    expect(res).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "propose" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("returns pending messages immediately, and only once after the agent acts", async () => {
    const { s, task } = await setup();
    await task();
    await s.reviewer.context();
    await s.backend.sendMessage({ to: "reviewer", message: "ping" });
    const res = await s.reviewer.wait({ timeoutMs: 10_000 });
    expect(res).toMatchObject({ status: "MESSAGES", pendingMessages: [expect.objectContaining({ content: "ping" })] });
    // waiting again acknowledges what was shown; nothing else to do -> times out with a short answer
    const timeout = await s.reviewer.wait({ timeoutMs: 150 });
    expect(timeout).toMatchObject({ status: "TIMEOUT", pendingMessages: [], nextAction: "wait", task: { id: "task-001", phase: "DISCUSS" } });
    expect(Object.keys(timeout).sort()).toEqual(["allowedActions", "hint", "nextAction", "pendingMessages", "status", "task", "waitingOn"]);
  });

  it("uses the configured default timeout when the agent passes none", async () => {
    const { services } = await setup();
    const quick = new Swarm(services.reviewer!, undefined, { defaultWaitMs: 100 });
    expect(quick.defaultWaitMs).toBe(100);
    const started = Date.now();
    expect(await quick.wait({})).toMatchObject({ status: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("blocks until another agent produces work, then wakes with ACTION_REQUIRED", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    const waiting = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 150));
    await s.backend.propose({ summary: "s", assignments });
    expect(await waiting).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "approve", agreement: { summary: "s" } });
  });

  it("wakes when a task is created after the agent started waiting", async () => {
    const { s, task } = await setup();
    const waiting = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 150));
    await task();
    expect(await waiting).toMatchObject({ status: "UPDATED", task: { id: "task-001", phase: "DISCUSS" }, nextAction: "wait" });
  });

  it("skips events that do not matter and keeps waiting until the deadline", async () => {
    const { s, task } = await setup(["backend", "reviewer", "qa"]);
    await task(["backend", "reviewer", "qa"]);
    await s.backend.context();
    await s.backend.propose({ summary: "s", assignments: [...assignments, { agentId: "qa", responsibility: "qa", files: ["qa/**"] }] });
    await s.reviewer.context();
    await s.reviewer.complete({}); // approved; now waits for backend and qa
    const started = Date.now();
    const waiting = s.reviewer.wait({ timeoutMs: 600 });
    await new Promise((r) => setTimeout(r, 100));
    await s.backend.context();
    await s.backend.complete({}); // AGREEMENT_APPROVED event wakes the reviewer's hub, but nothing is actionable
    const res = await waiting;
    expect(res).toMatchObject({ status: "TIMEOUT", nextAction: "wait" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
  });

  it("reports DONE", async () => {
    const { s, task } = await setup();
    await task();
    await toSync(s);
    await toDone(s);
    expect(await s.reviewer.wait({ timeoutMs: 5_000 })).toMatchObject({ status: "DONE", nextAction: "done" });
  });

  it("wakes up on a phase change caused by the other agent", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    await s.backend.propose({ summary: "s", assignments });
    await s.reviewer.context();
    await s.reviewer.complete({});
    const waiting = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 150));
    await s.backend.complete({});
    expect(await waiting).toMatchObject({ status: "ACTION_REQUIRED", task: { phase: "IMPLEMENT" }, nextAction: "implement" });
  });
});

describe("create_task by an agent", () => {
  const spec = "POST /orders without amount must return 400 instead of 500. backend fixes src/main, reviewer writes the test.";

  it("creator becomes lead, the other agent wakes up and the protocol continues", async () => {
    const { s } = await setup();
    await s.reviewer.context(); // both registered
    const waiting = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    const created = await s.backend.createTask({ title: "Fix 500", description: spec, agents: ["reviewer"] });
    expect(created).toMatchObject({ ok: true, action: "TASK_CREATED", taskId: "task-001", task: { phase: "DISCUSS", agents: ["backend", "reviewer"] }, nextAction: "propose" });
    expect(await waiting).toMatchObject({ status: "UPDATED", task: { id: "task-001", title: "Fix 500", description: spec }, nextAction: "wait" });
    // creator may be any agent: reviewer creating makes reviewer the lead
    const { s: s2 } = await setup();
    await s2.backend.context();
    const c2 = await s2.reviewer.createTask({ title: "t", description: spec, agents: ["backend", "reviewer"] });
    expect(c2).toMatchObject({ task: { agents: ["reviewer", "backend"] }, nextAction: "propose" });
  });

  it("offers create_task only when there is no active task, and lists registered agents", async () => {
    const { s } = await setup();
    await s.reviewer.context();
    expect(await s.backend.context()).toMatchObject({ registeredAgents: ["reviewer"], allowedActions: ["create_task", "wait"] });
    await s.backend.createTask({ title: "t", description: spec, agents: ["reviewer"] });
    expect((await s.backend.context()).allowedActions).not.toContain("create_task");
  });

  it("refuses a second task while one is active", async () => {
    const { s } = await setup();
    await s.reviewer.context();
    await s.backend.createTask({ title: "t", description: spec, agents: ["reviewer"] });
    expect(await failure(s.backend, s.backend.createTask({ title: "t2", description: spec, agents: ["reviewer"] }))).toMatchObject({ error: "HAS_ACTIVE_TASK", taskId: "task-001", nextAction: "propose" });
    expect(await failure(s.reviewer, s.reviewer.createTask({ title: "t2", description: spec, agents: ["backend"] }))).toMatchObject({ error: "HAS_ACTIVE_TASK" });
  });

  it("rejects placeholder descriptions, unknown agents, missing partners", async () => {
    const { s } = await setup();
    await s.reviewer.context();
    expect(await failure(s.backend, s.backend.createTask({ title: "t", description: "implement ... in src/main", agents: ["reviewer"] }))).toMatchObject({ error: "INVALID_INPUT", registeredAgents: ["reviewer"] });
    expect(await failure(s.backend, s.backend.createTask({ description: spec, agents: ["reviewer"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.createTask({ title: "t", description: spec, agents: [] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.createTask({ title: "t", description: spec, agents: ["backend"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.backend, s.backend.createTask({ title: "t", description: spec, agents: ["reviewr"] }))).toMatchObject({ error: "AGENT_NOT_REGISTERED", registeredAgents: ["reviewer"] });
    expect((await s.backend.context()).task).toBeNull();
  });

  it("a cancelled task no longer blocks creating a new one", async () => {
    const { s, operator } = await setup();
    await s.reviewer.context();
    await s.backend.createTask({ title: "t", description: spec, agents: ["reviewer"] });
    await operator.cancelTask("task-001");
    expect(await s.backend.createTask({ title: "t2", description: spec, agents: ["reviewer"] })).toMatchObject({ taskId: "task-002" });
  });
});

describe("operator cancel", () => {
  it("a cancelled task is skipped: agents move to the next task, or to wait", async () => {
    const { s, task, operator } = await setup();
    await task(["backend", "reviewer"], "bad");
    await task(["backend", "reviewer"], "good");
    await s.backend.context();
    expect((await s.backend.context()).task).toMatchObject({ id: "task-001" });
    await operator.cancelTask("task-001", "empty description");
    expect((await s.backend.context()).task).toMatchObject({ id: "task-002", title: "good", phase: "DISCUSS" });
    await operator.cancelTask("task-002");
    expect(await s.backend.context()).toMatchObject({ task: null, nextAction: "wait" });
    expect(await failure(s.backend, s.backend.propose({ summary: "s", assignments }))).toMatchObject({ error: "NO_ACTIVE_TASK" });
  });

  it("cancels a task already in IMPLEMENT, refuses double cancel, and wakes a waiting agent", async () => {
    const { s, task, operator } = await setup();
    await task();
    await toImplement(s);
    const waiting = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    await s.reviewer.complete({ result: "x" }).catch(() => undefined); // reviewer is now waiting for backend
    const w2 = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    await operator.cancelTask("task-001");
    expect(await w2).toMatchObject({ status: "UPDATED", task: null });
    await waiting.catch(() => undefined);
    await expect(operator.cancelTask("task-001")).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
  });
});

describe("file ownership and negotiation", () => {
  async function inImplement() {
    const net = await setup();
    await net.task();
    await toImplement(net.s);
    return net;
  }

  it("propose requires files per agent and rejects overlapping claims", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    expect(await failure(s.backend, s.backend.propose({ summary: "s", assignments: [{ agentId: "backend", responsibility: "a" }, { agentId: "reviewer", responsibility: "b" }] }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("backend, reviewer") });
    const err = await failure(
      s.backend,
      s.backend.propose({
        summary: "s",
        assignments: [
          { agentId: "backend", responsibility: "a", files: ["src/main/**"] },
          { agentId: "reviewer", responsibility: "b", files: ["src/main/A.java", "src/test/**"] },
        ],
      }),
    );
    expect(err).toMatchObject({ error: "FILE_OVERLAP", overlaps: [{ agents: ["backend", "reviewer"], files: ["src/main/**", "src/main/A.java"] }] });
    expect(err.message).toContain("ONE owner");
    expect((await s.backend.context()).agreement).toBeUndefined(); // nothing was stored
  });

  it("swarm_context shows who owns what", async () => {
    const { s } = await inImplement();
    expect((await s.backend.context()).ownership).toEqual({ yourFiles: ["src/main/**"], othersFiles: [{ agentId: "reviewer", files: ["src/test/**"] }] });
  });

  it("complete is refused for another agent's file; unowned files only warn", async () => {
    const { s } = await inImplement();
    const err = await failure(s.backend, s.backend.complete({ result: "x", filesChanged: ["src/main/A.java", "src/test/ATest.java"] }));
    expect(err).toMatchObject({ error: "FILE_NOT_OWNED", nextAction: "implement", notYours: [{ file: "src/test/ATest.java", owners: ["reviewer"] }], yourFiles: ["src/main/**"] });
    expect(err.message).toContain("requestFiles");
    expect((await s.backend.context()).implementation).toMatchObject({ status: "IN_PROGRESS" });

    const ok = await s.backend.complete({ result: "x", filesChanged: ["src/main/A.java", "pom.xml"] });
    expect(ok).toMatchObject({ action: "IMPLEMENTATION_COMPLETED", warnings: [expect.stringContaining("pom.xml")] });
  });

  it("request -> grant -> complete: the owner lets the other agent change its file", async () => {
    const { s } = await inImplement();
    const req = await s.backend.sendMessage({ to: "reviewer", message: "I need to adjust the test helper for my change", requestFiles: ["src/test/Helper.java"] });
    expect(req).toMatchObject({ action: "FILES_REQUESTED", requested: ["src/test/Helper.java"] });

    const seen = await s.reviewer.context();
    expect(seen.pendingMessages).toEqual([expect.objectContaining({ from: "backend", type: "FILE_REQUEST", files: ["src/test/Helper.java"] })]);
    expect(await s.reviewer.context()).toMatchObject({ pendingMessages: [expect.objectContaining({ type: "FILE_REQUEST" })] }); // idempotent

    const granted = await s.reviewer.sendMessage({ to: "backend", message: "ok, only that helper", grantFiles: ["src/test/Helper.java"] });
    expect(granted).toMatchObject({ action: "FILES_GRANTED", granted: ["src/test/Helper.java"], ownership: { grantedByYou: [{ to: "backend", files: ["src/test/Helper.java"] }] } });

    const backend = await s.backend.context();
    expect(backend.pendingMessages).toEqual([expect.objectContaining({ type: "FILE_GRANT", files: ["src/test/Helper.java"] })]);
    expect(backend.ownership).toMatchObject({ grantedToYou: [{ file: "src/test/Helper.java", from: "reviewer" }] });

    expect(await s.backend.complete({ result: "x", filesChanged: ["src/main/A.java", "src/test/Helper.java"] })).toMatchObject({ action: "IMPLEMENTATION_COMPLETED" });
    // the grant does not extend to other files of the owner
    const { s: s2 } = await inImplement();
    await s2.reviewer.sendMessage({ to: "backend", message: "take it", grantFiles: ["src/test/Helper.java"] });
    expect(await failure(s2.backend, s2.backend.complete({ result: "x", filesChanged: ["src/test/Other.java"] }))).toMatchObject({ error: "FILE_NOT_OWNED" });
  });

  it("only owners can grant, and requests go to the actual owner", async () => {
    const { s } = await inImplement();
    expect(await failure(s.reviewer, s.reviewer.sendMessage({ to: "backend", message: "m", grantFiles: ["src/main/A.java"] }))).toMatchObject({ error: "FILE_NOT_OWNED", notYours: ["src/main/A.java"], yourFiles: ["src/test/**"] });
    expect(await failure(s.backend, s.backend.sendMessage({ to: "reviewer", message: "m", requestFiles: ["src/main/A.java"] }))).toMatchObject({ error: "INVALID_INPUT", owners: { "src/main/A.java": ["backend"] } });
    expect(await failure(s.backend, s.backend.sendMessage({ to: "reviewer", message: "m", requestFiles: ["a"], grantFiles: ["b"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(s.reviewer, s.reviewer.sendMessage({ to: "backend", message: "m", grantFiles: ["../../etc/passwd"] }))).toMatchObject({ error: "INVALID_INPUT" });
  });

  it("requests need an agreement with files", async () => {
    const { s, task } = await setup();
    await task();
    await s.reviewer.context();
    expect(await failure(s.backend, s.backend.sendMessage({ to: "reviewer", message: "m", requestFiles: ["src/A.java"] }))).toMatchObject({ error: "AGREEMENT_NOT_READY" });
  });

  it("a glob grant covered by the owner's glob is accepted", async () => {
    const { s } = await inImplement();
    await s.reviewer.sendMessage({ to: "backend", message: "whole fixtures dir", grantFiles: ["src/test/fixtures/**"] });
    expect(await s.backend.complete({ result: "x", filesChanged: ["src/test/fixtures/a.json"] })).toMatchObject({ action: "IMPLEMENTATION_COMPLETED" });
  });
});

describe("open file requests (the requester is blocked until the owner answers)", () => {
  async function requested() {
    const net = await setup();
    await net.task();
    await toImplement(net.s);
    await net.s.reviewer.sendMessage({ to: "backend", message: "need to tweak the controller", requestFiles: ["src/main/Controller.java"] });
    return net;
  }

  it("the owner gets nextAction 'respond' with the request and a ready grant call", async () => {
    const { s } = await requested();
    const ctx = await s.backend.context();
    expect(ctx).toMatchObject({
      nextAction: "respond",
      openFileRequests: [{ from: "reviewer", files: ["src/main/Controller.java"], reason: "need to tweak the controller" }],
      exampleCall: { tool: "send_message", args: { to: "reviewer", grantFiles: ["src/main/Controller.java"] } },
    });
    expect(ctx.allowedActions).toEqual(expect.arrayContaining(["send_message", "complete", "wait"]));
    expect(ctx.hint).toContain("reviewer waits for your answer");
    expect(ctx.hint).toContain("grantFiles");
  });

  it("reading the request does not close it: the busy owner is reminded on every call, and wait returns at once", async () => {
    const { s } = await requested();
    await s.backend.context(); // shown
    await s.backend.complete({ result: "half done", filesChanged: ["src/main/A.java"] }).catch(() => undefined);
    const again = await s.backend.context(); // message is read now, request still open
    expect(again.pendingMessages).toEqual([]);
    expect(again).toMatchObject({ nextAction: "respond", openFileRequests: [{ from: "reviewer" }] });
    const started = Date.now();
    expect(await s.backend.wait({ timeoutMs: 10_000 })).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "respond" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("the requester sees its open request and continues with its own work", async () => {
    const { s } = await requested();
    const ctx = await s.reviewer.context();
    expect(ctx).toMatchObject({ nextAction: "implement", yourOpenRequests: [{ to: "backend", files: ["src/main/Controller.java"] }] });
    expect(ctx.openFileRequests).toBeUndefined();
  });

  it("a refusal (any reply to the requester) closes the request and wakes the requester", async () => {
    const { s } = await requested();
    await s.reviewer.complete({ result: "tests", filesChanged: ["src/test/T.java"] }); // own part done: now it only waits
    const waiting = s.reviewer.wait({ timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    await s.backend.context();
    const answered = await s.backend.sendMessage({ to: "reviewer", message: "no: I am rewriting it, tell me what to change" });
    expect(answered).toMatchObject({ nextAction: "implement" });
    expect(answered.openFileRequests).toBeUndefined();
    expect(await waiting).toMatchObject({ status: "MESSAGES", pendingMessages: [expect.objectContaining({ from: "backend" })] });
    expect((await s.reviewer.context()).yourOpenRequests).toBeUndefined();
  });

  it("a grant closes the request", async () => {
    const { s } = await requested();
    await s.backend.context();
    await s.backend.sendMessage({ to: "reviewer", message: "ok", grantFiles: ["src/main/Controller.java"] });
    expect((await s.backend.context()).nextAction).toBe("implement");
  });

  it("a message the owner wrote BEFORE the request does not count as an answer", async () => {
    const { s, task } = await setup();
    await task();
    await toImplement(s);
    await s.backend.sendMessage({ to: "reviewer", message: "fyi" });
    await s.reviewer.sendMessage({ to: "backend", message: "need it", requestFiles: ["src/main/X.java"] });
    await s.reviewer.sendMessage({ to: "backend", message: "please answer" }); // requester's own follow-up does not close it
    expect((await s.backend.context()).nextAction).toBe("respond");
  });

  it("the requester is told that reading needs no permission", async () => {
    const { s, task } = await setup();
    await task();
    await toImplement(s);
    const res = await s.reviewer.sendMessage({ to: "backend", message: "need it", requestFiles: ["src/main/X.java"] });
    expect(res.note).toContain("reading needs no permission");
    expect((await s.reviewer.context()).hint).toMatch(/reading any file needs no permission/i);
  });
});

describe("fresh sessions at phase changes (freshPhases)", () => {
  const fresh = (service: NetworkService) => new Swarm(service, undefined, { freshPhases: ["SYNC"] });

  it("a session that saw the discussion hands the task over at SYNC; a new session does the review", async () => {
    const { s, services, task, dir } = await setup();
    const t = await task();
    s.reviewer = fresh(services.reviewer!);
    await s.backend.context();
    await toSync(s);
    await s.backend.sendMessage({ to: "reviewer", message: "look at the DTO first" });
    const old = await s.reviewer.context();
    expect(old).toMatchObject({ nextAction: "done", allowedActions: [], handoff: { phase: "SYNC" }, pendingMessages: [] });
    expect((await s.reviewer.wait({ timeoutMs: 1000 })).status).toBe("DONE");
    expect((await s.backend.context()).nextAction).toBe("sync"); // a session without freshPhases goes on as before
    expect(await isHandedOver(await FileStore.open(dir), "reviewer", (await services.reviewer!.tasks.find(t.id))!)).toBe(true);

    const next = await fresh(services.reviewer!).context(); // first sees the task in SYNC: it is the fresh session
    expect(next).toMatchObject({ nextAction: "sync", reviewTargets: ["backend"] });
    expect(next.handoff).toBeUndefined();
    expect(next.pendingMessages).toEqual([expect.objectContaining({ from: "backend", content: "look at the DTO first" })]); // left unread for it
  });

  it("after a fix round the re-review goes to a fresh session again, with the findings the fixes answer", async () => {
    const { s, services, task } = await setup();
    await task();
    await toSync(s);
    const round1 = fresh(services.reviewer!);
    expect((await round1.context()).nextAction).toBe("sync");
    await s.backend.complete({ status: "PASS" });
    await round1.complete({ status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "email is not validated", relatedAgent: "backend", files: ["src/Api.java"] }] });
    await s.backend.context();
    expect(await s.backend.complete({ result: "validated", filesChanged: ["src/Api.java"] })).toMatchObject({ task: { phase: "SYNC", syncRound: 2 } });

    expect(await round1.context()).toMatchObject({ nextAction: "done", handoff: { phase: "SYNC" } });
    const round2 = await fresh(services.reviewer!).context();
    expect(round2).toMatchObject({ nextAction: "sync", reviewTargets: ["backend"] });
    expect(round2.fixedFindings).toEqual([expect.objectContaining({ description: "email is not validated", relatedAgent: "backend", reportedBy: "reviewer" })]);
    expect(round2.hint).toContain("fixedFindings");
  });

  it("SYNC shows the agreed decisions but not the authors' summaries; INTEGRATE keeps them", async () => {
    const { s, task } = await setup();
    await task();
    await s.backend.context();
    await s.backend.propose({ summary: "split", assignments, decisions: ["emails are unique per tenant"], interfaces: ["POST /users"] });
    await s.reviewer.context();
    await s.reviewer.complete({});
    await s.backend.complete({});
    await s.backend.complete({ result: "api done, trust me", filesChanged: ["src/Api.java"], commits: ["abc123"] });
    const review = await s.reviewer.complete({ result: "validation", filesChanged: ["src/Validator.java"] });
    expect(review.agreement).toMatchObject({ decisions: ["emails are unique per tenant"], interfaces: ["POST /users"] });
    const [shown] = review.teamImplementations as Record<string, unknown>[];
    expect(shown).toMatchObject({ agentId: "backend", filesChanged: ["src/Api.java"], commits: ["abc123"] });
    expect(shown).not.toHaveProperty("summary");
    const [full] = (await s.reviewer.context({ full: true })).teamImplementations as Record<string, unknown>[];
    expect(full).not.toHaveProperty("summary"); // not even when the reviewer asks for everything
    expect(review.hint).toContain("not what its authors say");

    await s.backend.complete({ status: "PASS" });
    await s.reviewer.complete({ status: "PASS" });
    const integrate = await s.backend.context();
    expect(integrate.teamImplementations).toEqual([expect.objectContaining({ agentId: "reviewer", summary: "validation" })]);
  });
});

describe("commits on an own branch", () => {
  it("tells an agent in its own worktree to commit before complete(); an agent in the task's checkout is not told", async () => {
    const repo = await tmpDir();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "README.md"), "demo");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    const worktree = `${repo}-backend`;
    git("worktree", "add", "-q", worktree, "-b", "swarm-backend");
    const dir = join(repo, ".agent-network");
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const service = (id: string) => NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
    const s = {
      backend: new Swarm(await service("backend"), undefined, { workdir: worktree }),
      reviewer: new Swarm(await service("reviewer"), undefined, { workdir: repo }),
    };
    await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await toImplement(s);
    const backend = await s.backend.context();
    expect(backend.nextAction).toBe("implement");
    expect(backend.hint).toContain("You work on your own branch swarm-backend: commit your files before complete()");
    const reviewer = await s.reviewer.context();
    expect(reviewer.nextAction).toBe("implement");
    expect(reviewer.hint).not.toContain("own branch");
  });
});
