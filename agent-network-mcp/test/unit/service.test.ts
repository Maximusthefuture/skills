import { join } from "node:path";
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

    await s.backend.submitSync({ taskId: task.id, status: "PASS" });
    const done = await s.reviewer.submitSync({ taskId: task.id, status: "PASS" });
    expect(done.phase).toBe("DONE");
    expect(await s.backend.getTask(task.id)).toMatchObject({ phase: "DONE", status: "COMPLETED" });
    expect(await s.backend.listSyncReports({ taskId: task.id })).toHaveLength(4);
    expect(await s.backend.listSyncReports({ taskId: task.id, round: 2 })).toHaveLength(2);
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

  it("NEEDS_FIX needs findings; unsafe paths and unknown related agents are rejected", async () => {
    const { s } = await network();
    const task = await toSync(s);
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "x", files: ["../../etc/passwd"] }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.backend.submitSync({ taskId: task.id, status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "x", relatedAgent: "stranger" }] })).rejects.toMatchObject({ code: "NOT_ASSIGNED" });
    expect((await s.backend.getPhase(task.id)).phase).toBe("SYNC");
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
    const types = (await s.backend.events.list(task.id)).map((e) => e.event.type);
    expect(types).toEqual(expect.arrayContaining(["IMPLEMENTATION_STARTED", "IMPLEMENTATION_COMPLETED", "SYNC_REQUIRED", "SYNC_REPORT_CREATED", "TASK_COMPLETED"]));
  });
});

describe("task context", () => {
  it("records git context (null outside a repository)", async () => {
    const { s } = await network();
    const task = await s.backend.createTask({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    expect(task.git).toBeNull(); // tmp dir is not a git repo
  });
});
