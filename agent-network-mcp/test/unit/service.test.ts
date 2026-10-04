import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";

async function network(ids = ["backend", "reviewer"]) {
  const dir = join(await tmpDir(), ".agent-network");
  const services: Record<string, NetworkService> = {};
  for (const id of ids) {
    services[id] = await NetworkService.create(dir, { id, type: "test", role: id }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
    await services[id]!.registerAgent();
  }
  return { dir, s: services as Record<string, NetworkService> & { backend: NetworkService; reviewer: NetworkService } };
}

async function toImplement(s: Awaited<ReturnType<typeof network>>["s"]) {
  const task = await s.backend.createTask({ title: "Auth", description: "JWT", agents: ["backend", "reviewer"] });
  await s.backend.proposeAgreement({
    taskId: task.id,
    summary: "split",
    assignments: [{ agentId: "backend", responsibility: "api" }, { agentId: "reviewer", responsibility: "tests" }],
    interfaces: ["POST /users"],
  });
  await s.backend.approveAgreement({ taskId: task.id });
  await s.reviewer.approveAgreement({ taskId: task.id });
  return task;
}

async function toSync(s: Awaited<ReturnType<typeof network>>["s"]) {
  const task = await toImplement(s);
  for (const a of [s.backend, s.reviewer]) {
    await a.startImplementation(task.id);
    await a.completeImplementation({ taskId: task.id, summary: "done", filesChanged: ["src/a.ts"], commits: ["abc123"] });
  }
  return task;
}

describe("protocol happy path and fix loop", () => {
  it("DISCUSS -> IMPLEMENT -> SYNC -> (NEEDS_FIX) -> IMPLEMENT -> SYNC -> DONE", async () => {
    const { s } = await network();
    const task = await toImplement(s);
    expect((await s.backend.getPhase(task.id)).phase).toBe("IMPLEMENT");

    await s.backend.startImplementation(task.id);
    const r1 = await s.backend.completeImplementation({ taskId: task.id, summary: "api", filesChanged: ["src/Api.java"], commits: ["abc123"] });
    expect(r1.phase).toBe("IMPLEMENT");
    await s.reviewer.startImplementation(task.id);
    const r2 = await s.reviewer.completeImplementation({ taskId: task.id, summary: "tests" });
    expect(r2.phase).toBe("SYNC");

    expect((await s.backend.submitSync({ taskId: task.id, status: "PASS" })).phase).toBe("SYNC");
    const fix = await s.reviewer.submitSync({
      taskId: task.id,
      status: "NEEDS_FIX",
      findings: [{ severity: "ERROR", description: "Long vs UUID", relatedAgent: "reviewer", files: ["src/Api.java"] }],
    });
    expect(fix.phase).toBe("IMPLEMENT");

    const impls = await s.backend.listImplementations(task.id);
    expect(impls.find((i) => i.agentId === "reviewer")?.status).toBe("IN_PROGRESS");
    expect(impls.find((i) => i.agentId === "backend")?.status).toBe("READY_FOR_SYNC");

    const again = await s.reviewer.completeImplementation({ taskId: task.id, summary: "fixed" });
    expect(again.phase).toBe("SYNC");
    expect((await s.backend.getTask(task.id)).syncRound).toBe(2);

    // round 2 reviews only the reviewer's fix, so only backend reviews
    expect(await s.backend.getTask(task.id)).toMatchObject({ reviewScope: ["reviewer"] });
    await expect(s.reviewer.submitSync({ taskId: task.id, status: "PASS" })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    expect((await s.backend.submitSync({ taskId: task.id, status: "PASS" })).phase).toBe("INTEGRATE");

    // the lead integrates
    await expect(s.reviewer.submitIntegration({ taskId: task.id, status: "PASS", result: "merged" })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    const done = await s.backend.submitIntegration({ taskId: task.id, status: "PASS", result: "merged into main, mvn verify green" });
    expect(done.phase).toBe("DONE");
    expect(await s.backend.getTask(task.id)).toMatchObject({ phase: "DONE", status: "COMPLETED" });
    expect(await s.backend.listSyncReports({ taskId: task.id })).toHaveLength(3);
    expect(await s.backend.listSyncReports({ taskId: task.id, round: 2 })).toHaveLength(1);
  });

  it("concurrent approvals from two processes both land and trigger the transition", async () => {
    const { dir, s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await s.backend.proposeAgreement({ taskId: task.id, summary: "s", assignments: [{ agentId: "backend", responsibility: "a" }, { agentId: "reviewer", responsibility: "b" }] });
    const other = await NetworkService.create(dir, { id: "reviewer", type: "test" });
    await Promise.all([s.backend.approveAgreement({ taskId: task.id }), other.approveAgreement({ taskId: task.id })]);
    expect((await s.backend.getAgreement(task.id)).approvedBy.sort()).toEqual(["backend", "reviewer"]);
    expect((await s.backend.getPhase(task.id)).phase).toBe("IMPLEMENT");
  });

  it("re-proposing resets approvals and a stale version cannot be approved", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    const assignments = [{ agentId: "backend", responsibility: "a" }, { agentId: "reviewer", responsibility: "b" }];
    await s.backend.proposeAgreement({ taskId: task.id, summary: "v1", assignments });
    await s.backend.approveAgreement({ taskId: task.id });
    const v2 = await s.reviewer.proposeAgreement({ taskId: task.id, summary: "v2", assignments });
    expect(v2.agreement).toMatchObject({ version: 2, approvedBy: [], proposedBy: "reviewer" });
    await expect(s.backend.approveAgreement({ taskId: task.id, version: 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("protocol errors", () => {
  it("rejects unregistered agents", async () => {
    const { dir } = await network();
    const ghost = await NetworkService.create(dir, { id: "ghost", type: "test" });
    await expect(ghost.listAgents()).rejects.toMatchObject({ code: "AGENT_NOT_REGISTERED" });
    await expect(ghost.createTask({ title: "t", description: "d", agents: ["ghost", "backend"] })).rejects.toMatchObject({ code: "AGENT_NOT_REGISTERED" });
  });

  it("validates task creation", async () => {
    const { s } = await network();
    await expect(s.backend.createTask({ title: "t", description: "d", agents: ["backend", "nobody"] })).rejects.toMatchObject({ code: "AGENT_NOT_REGISTERED" });
    await expect(s.backend.createTask({ title: "t", description: "d", agents: ["reviewer", "reviewer"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.createTask({ title: "t", description: "d", agents: ["reviewer", "backend2"] })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    await expect(s.backend.getTask("task-001")).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("enforces phases", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await expect(s.backend.startImplementation(task.id)).rejects.toMatchObject({ code: "INVALID_PHASE" });
    await expect(s.backend.submitSync({ taskId: task.id, status: "PASS" })).rejects.toMatchObject({ code: "INVALID_PHASE" });
    await expect(s.backend.approveAgreement({ taskId: task.id })).rejects.toMatchObject({ code: "AGREEMENT_NOT_READY" });
    await expect(s.backend.getAgreement(task.id)).rejects.toMatchObject({ code: "AGREEMENT_NOT_READY" });
  });

  it("requires every task agent to be assigned in the agreement, and only task agents", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await expect(s.backend.proposeAgreement({ taskId: task.id, summary: "s", assignments: [{ agentId: "backend", responsibility: "a" }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      s.backend.proposeAgreement({ taskId: task.id, summary: "s", assignments: [{ agentId: "backend", responsibility: "a" }, { agentId: "reviewer", responsibility: "b" }, { agentId: "backend", responsibility: "c" }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("outsiders cannot touch a task", async () => {
    const { dir, s } = await network();
    const outsider = await NetworkService.create(dir, { id: "outsider", type: "test" });
    await outsider.registerAgent();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await expect(outsider.getTask(task.id)).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    await expect(outsider.sendMessage({ taskId: task.id, to: "backend", type: "INFORMATION", content: "x" })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    await expect(outsider.approveAgreement({ taskId: task.id })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    await expect(outsider.waitForEvent({ taskId: task.id, timeoutMs: 0 })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
  });

  it("rejects double completion, completion without start, and duplicate sync / approval", async () => {
    const { s } = await network();
    const task = await toImplement(s);
    await expect(s.backend.completeImplementation({ taskId: task.id, summary: "x" })).rejects.toMatchObject({ code: "NOT_STARTED" });
    await expect(s.backend.approveAgreement({ taskId: task.id })).rejects.toMatchObject({ code: "INVALID_PHASE" });
    await s.backend.startImplementation(task.id);
    expect((await s.backend.startImplementation(task.id)).alreadyStarted).toBe(true);
    await s.backend.completeImplementation({ taskId: task.id, summary: "x" });
    await expect(s.backend.completeImplementation({ taskId: task.id, summary: "x" })).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
    await expect(s.backend.startImplementation(task.id)).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
  });

  it("rejects duplicate approve and duplicate sync report", async () => {
    const { s } = await network();
    const t = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await s.backend.proposeAgreement({ taskId: t.id, summary: "s", assignments: [{ agentId: "backend", responsibility: "a" }, { agentId: "reviewer", responsibility: "b" }] });
    await s.backend.approveAgreement({ taskId: t.id });
    await expect(s.backend.approveAgreement({ taskId: t.id })).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });

    const { s: s2 } = await network();
    const task = await toSync(s2);
    await s2.backend.submitSync({ taskId: task.id, status: "PASS" });
    await expect(s2.backend.submitSync({ taskId: task.id, status: "PASS" })).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
  });

  it("NEEDS_FIX needs an ERROR finding, PASS cannot carry one; unsafe paths and unknown related agents are rejected", async () => {
    const { s } = await network();
    const task = await toSync(s);
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: [{ severity: "WARNING", description: "naming" }] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("ERROR") });
    await expect(s.backend.submitSync({ taskId: task.id, status: "PASS", findings: [{ severity: "ERROR", description: "broken" }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "x", files: ["../../etc/passwd"] }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "x", relatedAgent: "stranger" }] })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    expect((await s.backend.getPhase(task.id)).phase).toBe("SYNC");
    // WARNING / INFO notes travel with PASS
    expect((await s.backend.submitSync({ taskId: task.id, status: "PASS", findings: [{ severity: "WARNING", description: "naming" }] })).phase).toBe("SYNC");
  });

  it("rejects unsafe filesChanged and commit values", async () => {
    const { s } = await network();
    const task = await toImplement(s);
    await s.backend.startImplementation(task.id);
    for (const filesChanged of [["../x"], ["/etc/passwd"]]) {
      await expect(s.backend.completeImplementation({ taskId: task.id, summary: "x", filesChanged })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(s.backend.completeImplementation({ taskId: task.id, summary: "x", commits: ["--evil"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("messages", () => {
  it("sender is always the calling process identity and recipients read their own mail", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    const m = await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "QUESTION", content: "UUID?" });
    expect(m.from).toBe("backend");
    expect(await s.reviewer.listMessages({ taskId: task.id, unreadOnly: true })).toHaveLength(1);
    expect(await s.backend.listMessages({ taskId: task.id })).toHaveLength(0);
    expect(await s.backend.listMessages({ taskId: task.id, direction: "sent" })).toHaveLength(1);
    const read = await s.reviewer.readMessage({ taskId: task.id, messageId: m.id });
    expect(read.readAt).toBeDefined();
    expect(await s.reviewer.listMessages({ taskId: task.id, unreadOnly: true })).toHaveLength(0);
    const reply = await s.reviewer.sendMessage({ taskId: task.id, to: "backend", type: "INFORMATION", content: "yes", replyTo: m.id });
    expect(reply.replyTo).toBe(m.id);
    await expect(s.reviewer.sendMessage({ taskId: task.id, to: "backend", type: "INFORMATION", content: "x", replyTo: "msg-999" })).rejects.toMatchObject({ code: "MESSAGE_NOT_FOUND" });
    await expect(s.backend.sendMessage({ taskId: task.id, to: "backend", type: "INFORMATION", content: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.readMessage({ taskId: task.id, messageId: "msg-404" })).rejects.toMatchObject({ code: "MESSAGE_NOT_FOUND" });
  });

  it("a third agent cannot read someone else's message", async () => {
    const { s } = await network(["backend", "reviewer", "qa"]);
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer", "qa"] });
    const m = await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "INFORMATION", content: "secret" });
    await expect(s.qa!.readMessage({ taskId: task.id, messageId: m.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("wait_for_event", () => {
  it("delivers MESSAGE_CREATED only to the addressee", async () => {
    const { s } = await network(["backend", "reviewer", "qa"]);
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer", "qa"] });
    await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "QUESTION", content: "q" });

    const reviewer = await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 0 });
    // TASK_CREATED is a broadcast, so it comes first, then the addressed message
    expect(reviewer).toMatchObject({ status: "EVENT", event: { type: "TASK_CREATED" } });
    const next = await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 0 });
    expect(next).toMatchObject({ status: "EVENT", event: { type: "MESSAGE_CREATED", targetAgent: "reviewer", payload: { messageId: "msg-001" } } });

    await s.qa!.waitForEvent({ taskId: task.id, timeoutMs: 0 }); // TASK_CREATED broadcast
    expect(await s.qa!.waitForEvent({ taskId: task.id, timeoutMs: 0 })).toEqual({ status: "TIMEOUT" });
  });

  it("does not wake an agent for its own events and consumes each event once", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "INFORMATION", content: "x" });
    expect(await s.backend.waitForEvent({ taskId: task.id, timeoutMs: 0 })).toEqual({ status: "TIMEOUT" });
    await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 0 });
    await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 0 });
    expect(await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 0 })).toEqual({ status: "TIMEOUT" });
  });

  it("blocks until an event arrives (wake-up) and returns TIMEOUT otherwise", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 0 }); // drain TASK_CREATED

    const waiting = s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    expect((await s.reviewer.agents.get("reviewer"))?.status).toBe("WAITING");
    await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "QUESTION", content: "ping" });
    expect(await waiting).toMatchObject({ status: "EVENT", event: { type: "MESSAGE_CREATED" } });

    expect(await s.reviewer.waitForEvent({ taskId: task.id, timeoutMs: 100 })).toEqual({ status: "TIMEOUT" });
  });

  it("without taskId it covers every task of the agent plus agent-wide events", async () => {
    const { dir, s } = await network();
    const late = await NetworkService.create(dir, { id: "late", type: "test" });
    await late.registerAgent();
    // backend sees AGENT_REGISTERED of reviewer? reviewer registered before backend's first poll -> yes
    const first = await s.backend.waitForEvent({ timeoutMs: 0 });
    expect(first).toMatchObject({ status: "EVENT", event: { type: "AGENT_REGISTERED" } });
    const task = await s.reviewer.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    const types: string[] = [];
    for (;;) {
      const r = await s.backend.waitForEvent({ timeoutMs: 0 });
      if (r.status === "TIMEOUT") break;
      types.push(r.event.type);
      if (r.event.type === "TASK_CREATED") expect(r.event.taskId).toBe(task.id);
    }
    expect(types).toContain("TASK_CREATED");
  });

  it("finds events written while the agent was away and after a process restart (cursor persisted)", async () => {
    const { dir, s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "QUESTION", content: "q1" });
    await s.backend.sendMessage({ taskId: task.id, to: "reviewer", type: "QUESTION", content: "q2" });

    const restarted = await NetworkService.create(dir, { id: "reviewer", type: "test" });
    await restarted.registerAgent();
    const e1 = await restarted.waitForEvent({ taskId: task.id, timeoutMs: 0 });
    expect(e1).toMatchObject({ event: { type: "TASK_CREATED" } });
    const e2 = await restarted.waitForEvent({ taskId: task.id, timeoutMs: 0 });
    expect(e2).toMatchObject({ event: { payload: { messageId: "msg-001" } } });

    const restartedAgain = await NetworkService.create(dir, { id: "reviewer", type: "test" });
    expect(await restartedAgain.waitForEvent({ taskId: task.id, timeoutMs: 0 })).toMatchObject({ event: { payload: { messageId: "msg-002" } } });
    expect(await restartedAgain.waitForEvent({ taskId: task.id, timeoutMs: 0 })).toEqual({ status: "TIMEOUT" });
  });

  it("phase changes are broadcast to everyone, including the agent that triggered them", async () => {
    const { s } = await network();
    const task = await toImplement(s);
    const seen = async (svc: NetworkService) => {
      const types: string[] = [];
      for (;;) {
        const r = await svc.waitForEvent({ taskId: task.id, timeoutMs: 0 });
        if (r.status === "TIMEOUT") return types;
        types.push(r.event.type);
      }
    };
    expect(await seen(s.backend)).toEqual(["AGREEMENT_APPROVED", "PHASE_CHANGED"]);
    expect(await seen(s.reviewer)).toEqual(["TASK_CREATED", "AGREEMENT_UPDATED", "AGREEMENT_APPROVED", "PHASE_CHANGED"]);
  });

  it("emits SYNC_REQUIRED and TASK_COMPLETED", async () => {
    const { s } = await network();
    const task = await toSync(s);
    await s.backend.submitSync({ taskId: task.id, status: "PASS" });
    await s.reviewer.submitSync({ taskId: task.id, status: "PASS" });
    await s.backend.submitIntegration({ taskId: task.id, status: "PASS", result: "merged" });
    const types = (await s.backend.events.list(task.id)).map((e) => e.event.type);
    expect(types).toEqual(expect.arrayContaining(["IMPLEMENTATION_STARTED", "IMPLEMENTATION_COMPLETED", "SYNC_REQUIRED", "SYNC_REPORT_CREATED", "INTEGRATION_REQUIRED", "INTEGRATION_REPORT_CREATED", "TASK_COMPLETED"]));
  });
});

describe("task context", () => {
  it("records git context (null outside a repository)", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    expect(task.git).toBeNull(); // tmp dir is not a git repo
  });
});

describe("sync round collects every review", () => {
  it("a NEEDS_FIX does not cut off a review still in progress; the fixer gets all findings", async () => {
    const { s } = await network(["backend", "frontend", "qa"]);
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "frontend", "qa"] });
    await s.backend.proposeAgreement({ taskId: task.id, summary: "s", assignments: ["backend", "frontend", "qa"].map((agentId) => ({ agentId, responsibility: agentId })) });
    for (const a of ["backend", "frontend", "qa"]) await s[a]!.approveAgreement({ taskId: task.id });
    for (const a of ["backend", "frontend", "qa"]) {
      await s[a]!.startImplementation(task.id);
      await s[a]!.completeImplementation({ taskId: task.id, summary: a });
    }
    const err = (d: string, relatedAgent: string) => [{ severity: "ERROR" as const, description: d, relatedAgent }];
    expect((await s.qa!.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: err("400 missing", "frontend") })).phase).toBe("SYNC");
    expect((await s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: err("wrong field name", "frontend") })).phase).toBe("SYNC");
    expect((await s.frontend!.submitSync({ taskId: task.id, status: "PASS" })).phase).toBe("IMPLEMENT");
    const impls = await s.backend.listImplementations(task.id);
    expect(impls.filter((i) => i.status === "IN_PROGRESS").map((i) => i.agentId)).toEqual(["frontend"]);
  });
});

describe("fix-round limit", () => {
  async function failingRound(s: Awaited<ReturnType<typeof network>>["s"], taskId: string) {
    await s.backend.submitSync({ taskId, status: "PASS" }).catch(() => undefined); // not a reviewer after round 1
    return s.reviewer.submitSync({ taskId, status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "still broken", relatedAgent: "backend" }] });
  }

  it("blocks the task when reviews still fail after maxFixRounds; the operator unblocks or cancels it", async () => {
    const { s, dir } = await network();
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], maxFixRounds: 1 });
    await s.backend.proposeAgreement({ taskId: task.id, summary: "s", assignments: [{ agentId: "backend", responsibility: "a" }, { agentId: "reviewer", responsibility: "b" }] });
    await s.backend.approveAgreement({ taskId: task.id });
    await s.reviewer.approveAgreement({ taskId: task.id });
    for (const a of [s.backend, s.reviewer]) {
      await a.startImplementation(task.id);
      await a.completeImplementation({ taskId: task.id, summary: "x" });
    }
    expect((await failingRound(s, task.id)).phase).toBe("IMPLEMENT"); // fix round 1 of 1
    await s.backend.completeImplementation({ taskId: task.id, summary: "fixed" });
    expect((await failingRound(s, task.id)).phase).toBe("SYNC"); // round 2 fails again: no rounds left

    const blocked = await s.backend.getTask(task.id);
    expect(blocked).toMatchObject({ status: "BLOCKED", phase: "SYNC", blockedReason: expect.stringContaining("limit of 1") });
    expect((await s.backend.getPhase(task.id)).waitingOn).toEqual(["operator"]);
    await expect(s.backend.submitSync({ taskId: task.id, status: "PASS" })).rejects.toMatchObject({ code: "TASK_BLOCKED" });
    expect((await s.backend.events.list(task.id)).map((e) => e.event.type)).toContain("TASK_BLOCKED");

    // unblock: one more round, and the held-back fix starts right away
    await expect(operator.unblockTask("task-999")).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    const resumed = await operator.unblockTask(task.id);
    expect(resumed).toMatchObject({ status: "ACTIVE", phase: "IMPLEMENT", maxFixRounds: 2, reviewScope: ["backend"] });
    expect(resumed.blockedReason).toBeUndefined();
    await expect(operator.unblockTask(task.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    // blocked again, then cancelled
    await s.backend.completeImplementation({ taskId: task.id, summary: "fixed again" });
    await failingRound(s, task.id);
    expect((await s.backend.getTask(task.id)).status).toBe("BLOCKED");
    expect((await operator.cancelTask(task.id, "give up")).status).toBe("CANCELLED");
  });

  it("validates maxFixRounds", async () => {
    const { s } = await network();
    await expect(s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"], maxFixRounds: -1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] })).maxFixRounds).toBe(3);
  });
});

describe("integration step", () => {
  async function toIntegrate(s: Awaited<ReturnType<typeof network>>["s"]) {
    const task = await toSync(s);
    await s.backend.submitSync({ taskId: task.id, status: "PASS" });
    await s.reviewer.submitSync({ taskId: task.id, status: "PASS" });
    return task;
  }

  it("NEEDS_FIX from the integrator sends the named agents back, then the fix is reviewed and integrated again", async () => {
    const { s } = await network();
    const task = await toIntegrate(s);
    expect((await s.backend.getPhase(task.id))).toMatchObject({ phase: "INTEGRATE", waitingOn: ["backend"] });
    await expect(s.backend.submitIntegration({ taskId: task.id, status: "NEEDS_FIX", result: "tests fail", findings: [{ severity: "WARNING", description: "x" }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.submitIntegration({ taskId: task.id, status: "PASS", result: " " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const failed = await s.backend.submitIntegration({ taskId: task.id, status: "NEEDS_FIX", result: "UserIT fails after merge", findings: [{ severity: "ERROR", description: "UserIT expects 201", relatedAgent: "reviewer" }] });
    expect(failed.phase).toBe("IMPLEMENT");
    expect(await s.backend.getTask(task.id)).toMatchObject({ reviewScope: ["reviewer"], syncRound: 1 });
    await s.reviewer.completeImplementation({ taskId: task.id, summary: "fixed UserIT" });
    expect((await s.backend.submitSync({ taskId: task.id, status: "PASS" })).phase).toBe("INTEGRATE");
    expect((await s.backend.submitIntegration({ taskId: task.id, status: "PASS", result: "green" })).phase).toBe("DONE");
    expect(await s.backend.integrations.list(task.id)).toHaveLength(2);
  });

  it("integration is only possible during INTEGRATE", async () => {
    const { s } = await network();
    const early = await toSync(s);
    await expect(s.backend.submitIntegration({ taskId: early.id, status: "PASS", result: "x" })).rejects.toMatchObject({ code: "INVALID_PHASE" });
    await s.backend.submitSync({ taskId: early.id, status: "PASS" });
    await s.reviewer.submitSync({ taskId: early.id, status: "PASS" });
    await s.backend.submitIntegration({ taskId: early.id, status: "PASS", result: "x" });
    await expect(s.backend.submitIntegration({ taskId: early.id, status: "PASS", result: "x" })).rejects.toMatchObject({ code: "INVALID_PHASE" });
  });
});

describe("commits in a git repository", () => {
  /** The network lives inside a git repository, as in a real project; returns a git runner for it. */
  async function repoNetwork(opts: { requireCommits?: boolean } = {}) {
    const repo = await tmpDir();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "README.md"), "# demo\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    const before = git("rev-parse", "HEAD");
    const dir = join(repo, ".agent-network");
    const s: Record<string, NetworkService> = {};
    for (const id of ["backend", "reviewer"]) {
      s[id] = await NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
      await s[id]!.registerAgent();
    }
    const commit = (file: string, body = "x") => {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), body);
      git("add", file);
      git("commit", "-q", "-m", file);
      return git("rev-parse", "HEAD");
    };
    const task = await s.backend!.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"], ...opts });
    await s.backend!.proposeAgreement({
      taskId: task.id,
      summary: "s",
      assignments: [{ agentId: "backend", responsibility: "api", files: ["src/main/**"] }, { agentId: "reviewer", responsibility: "tests", files: ["src/test/**"] }],
    });
    await s.backend!.approveAgreement({ taskId: task.id });
    await s.reviewer!.approveAgreement({ taskId: task.id });
    await s.backend!.startImplementation(task.id);
    await s.reviewer!.startImplementation(task.id);
    return { s: s as Record<string, NetworkService> & { backend: NetworkService; reviewer: NetworkService }, task, commit, before };
  }

  it("requires commits, verifies them and takes the changed files from git", async () => {
    const { s, task, commit, before } = await repoNetwork();
    expect(task).toMatchObject({ requireCommits: true, git: { commit: before } });
    await expect(s.backend.completeImplementation({ taskId: task.id, summary: "api", filesChanged: ["src/main/Api.java"] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("Commit your changes") });
    await expect(s.backend.completeImplementation({ taskId: task.id, summary: "api", commits: ["deadbeef"] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("does not exist") });
    await expect(s.backend.completeImplementation({ taskId: task.id, summary: "api", commits: [before] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("base commit") });

    const sha = commit("src/main/Api.java");
    const done = await s.backend.completeImplementation({ taskId: task.id, summary: "api", filesChanged: ["src/main/Api.java", "src/main/Forgotten.java"], commits: [sha.slice(0, 10)] });
    expect(done.implementation).toMatchObject({ commits: [sha], filesChanged: ["src/main/Api.java", "src/main/Forgotten.java"] });
    expect(done.warnings).toEqual([expect.stringContaining("Not in your commits")]);
  });

  it("a committed file of another agent is refused even when it is not reported", async () => {
    const { s, task, commit } = await repoNetwork();
    commit("src/test/ApiTest.java");
    const sneaky = commit("src/main/Api.java", "reviewer edits backend code");
    await expect(s.reviewer.completeImplementation({ taskId: task.id, summary: "tests", filesChanged: ["src/test/ApiTest.java"], commits: [sneaky] })).rejects.toMatchObject({ code: "FILE_NOT_OWNED" });
  });

  it("commits are optional with requireCommits: false, and the integration must name the merged result", async () => {
    const { s, task } = await repoNetwork({ requireCommits: false });
    expect(task.requireCommits).toBe(false);
    await s.backend.completeImplementation({ taskId: task.id, summary: "api" });
    await s.reviewer.completeImplementation({ taskId: task.id, summary: "tests" });

    const { s: s2, task: t2, commit: commit2 } = await repoNetwork();
    await s2.backend.completeImplementation({ taskId: t2.id, summary: "api", commits: [commit2("src/main/A.java")] });
    await s2.reviewer.completeImplementation({ taskId: t2.id, summary: "tests", commits: [commit2("src/test/ATest.java")] });
    await s2.backend.submitSync({ taskId: t2.id, status: "PASS" });
    await s2.reviewer.submitSync({ taskId: t2.id, status: "PASS" });
    await expect(s2.backend.submitIntegration({ taskId: t2.id, status: "PASS", result: "merged" })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("merged result") });
    const head = commit2("MERGED.md");
    expect((await s2.backend.submitIntegration({ taskId: t2.id, status: "PASS", result: "merged", commits: [head] })).phase).toBe("DONE");
  });
});
