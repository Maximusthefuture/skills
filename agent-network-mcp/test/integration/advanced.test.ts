import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllAgents, spawnAgent as spawnPlain, type SpawnOptions } from "../helpers/agentProcess.js";

const spawnAgent = (o: SpawnOptions) => spawnPlain({ advanced: true, ...o });
import { tmpDir } from "../helpers/tmp.js";

afterEach(closeAllAgents);

/** Temporary git repository with one commit, as the project the agents work on. */
async function project() {
  const repo = await tmpDir("agent-network-test-");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "README.md"), "# demo\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return { repo, networkDir: join(repo, ".agent-network"), head: git("rev-parse", "HEAD") };
}

const assignments = [
  { agentId: "backend", responsibility: "REST API" },
  { agentId: "reviewer", responsibility: "integration tests" },
];

describe("advanced tools", () => {
  it("with AGENT_NETWORK_ADVANCED=1 exposes the five swarm tools plus the fine-grained set, never phase_transition", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir });
    expect(await backend.listTools()).toEqual(
      [
        "swarm_context", "create_task", "send_message", "propose", "complete", "wait",
        "agent_register", "agent_list", "agent_heartbeat",
        "task_create", "task_get",
        "agreement_propose", "agreement_approve", "agreement_get",
        "message_send", "message_list", "message_read",
        "wait_for_event",
        "implementation_start", "implementation_complete", "implementation_list",
        "sync_submit", "sync_list",
        "phase_get",
      ].sort(),
    );
  });

  it("refuses to start without AGENT_ID / with a relative NETWORK_DIR", async () => {
    await expect(spawnAgent({ id: "", networkDir: "/tmp/x" })).rejects.toThrow();
    await expect(spawnAgent({ id: "backend", networkDir: "relative/dir" })).rejects.toThrow();
  });

  it("two live processes cannot claim the same AGENT_ID", async () => {
    const { networkDir } = await project();
    await spawnAgent({ id: "backend", networkDir });
    await expect(spawnAgent({ id: "backend", networkDir })).rejects.toThrow(); // startup registration refuses a live duplicate
  });

  it("the sender is always the process identity, even if the caller tries to spoof it", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const task = await backend.call("task_create", { title: "t", description: "d", agents: ["backend", "reviewer"] });
    const msg = await backend.call("message_send", { taskId: task.id, to: "reviewer", type: "INFORMATION", content: "hi", from: "reviewer", agentId: "reviewer" });
    expect(msg.from).toBe("backend");
  });

  it("returns clean errors without stack traces", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir });
    const err = await backend.callError("task_get", { taskId: "task-001" });
    expect(err.code).toBe("TASK_NOT_FOUND");
    expect(err.raw).not.toMatch(/\bat .*\.(ts|js):\d+/);
    const traversal = await backend.callError("task_get", { taskId: "../../etc/passwd" });
    expect(traversal.code).toBe("INVALID_INPUT");
  });

  it("stores git context (repository, branch, commit) in the task", async () => {
    const { repo, networkDir, head } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir, cwd: repo });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir, cwd: repo });
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const task = await backend.call("task_create", { title: "t", description: "d", agents: ["backend", "reviewer"] });
    expect(task.git).toEqual({ repositoryRoot: expect.stringContaining("agent-network-test-"), branch: "main", commit: head });
  });
});

describe("full protocol cycle with two MCP processes", () => {
  it("DISCUSS -> IMPLEMENT -> SYNC -> NEEDS_FIX -> IMPLEMENT -> SYNC -> DONE", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir, type: "qwen", role: "backend" });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir, type: "qwen", role: "reviewer" });

    // 1-2. register
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const agents = (await backend.call("agent_list")).agents;
    expect(agents.map((a: any) => a.id).sort()).toEqual(["backend", "reviewer"]);
    expect(agents.every((a: any) => a.status === "ONLINE")).toBe(true);

    // 3. backend creates a task
    const task = await backend.call("task_create", { title: "Implement authentication", description: "Add JWT authentication", agents: ["backend", "reviewer"] });
    expect(task).toMatchObject({ id: "task-001", phase: "DISCUSS", status: "ACTIVE" });

    // 4-6. reviewer blocks in wait_for_event; backend's message wakes it up
    const drained = await reviewer.call("wait_for_event", { taskId: task.id, timeoutMs: 5000 });
    expect(drained.event.type).toBe("TASK_CREATED");
    const waiting = reviewer.call("wait_for_event", { taskId: task.id, timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 400));
    const sentAt = Date.now();
    const msg = await backend.call("message_send", { taskId: task.id, to: "reviewer", type: "QUESTION", content: "Should the API return UUID?" });
    const woke = await waiting;
    expect(Date.now() - sentAt).toBeLessThan(5000);
    expect(woke).toMatchObject({ status: "EVENT", event: { type: "MESSAGE_CREATED", targetAgent: "reviewer", taskId: task.id, payload: { messageId: msg.id } } });
    const read = await reviewer.call("message_read", { taskId: task.id, messageId: msg.id });
    expect(read).toMatchObject({ from: "backend", content: "Should the API return UUID?" });
    expect(read.readAt).toBeDefined();
    // the sender is not woken by its own message
    expect(await backend.call("wait_for_event", { taskId: task.id, timeoutMs: 300 })).toEqual({ status: "TIMEOUT" });

    // 7-10. agreement
    await reviewer.call("message_send", { taskId: task.id, to: "backend", type: "INFORMATION", content: "UUID, POST /users", replyTo: msg.id });
    await backend.call("agreement_propose", { taskId: task.id, summary: "REST API + integration tests", assignments, decisions: ["IDs are UUID"], interfaces: ["POST /users"] });
    expect((await backend.call("agreement_approve", { taskId: task.id })).phase).toBe("DISCUSS");
    expect((await reviewer.call("agreement_approve", { taskId: task.id })).phase).toBe("IMPLEMENT");
    expect((await backend.call("phase_get", { taskId: task.id })).phase).toBe("IMPLEMENT");
    expect((await reviewer.call("agreement_get", { taskId: task.id })).approvedBy.sort()).toEqual(["backend", "reviewer"]);

    // 11-13. implementation
    await backend.call("implementation_start", { taskId: task.id });
    expect((await backend.call("implementation_complete", { taskId: task.id, summary: "Implemented authentication API", filesChanged: ["src/auth/AuthController.java", "src/auth/AuthService.java"], commits: ["abc123"] })).phase).toBe("IMPLEMENT");
    await reviewer.call("implementation_start", { taskId: task.id });
    expect((await reviewer.call("implementation_complete", { taskId: task.id, summary: "Integration tests", filesChanged: ["src/test/AuthIT.java"] })).phase).toBe("SYNC");
    expect((await reviewer.call("implementation_list", { taskId: task.id })).implementations.map((i: any) => i.status)).toEqual(["READY_FOR_SYNC", "READY_FOR_SYNC"]);

    // 14-16. backend PASS, reviewer NEEDS_FIX -> back to IMPLEMENT
    expect((await backend.call("sync_submit", { taskId: task.id, status: "PASS" })).phase).toBe("SYNC");
    const needsFix = await reviewer.call("sync_submit", {
      taskId: task.id,
      status: "NEEDS_FIX",
      findings: [{ severity: "ERROR", description: "API returns Long but database uses UUID", relatedAgent: "reviewer", files: ["src/test/AuthIT.java"] }],
    });
    expect(needsFix.phase).toBe("IMPLEMENT");
    expect((await backend.call("phase_get", { taskId: task.id })).waitingOn).toEqual(["reviewer"]);

    // 17-19. reviewer fixes -> SYNC again
    expect((await reviewer.call("implementation_complete", { taskId: task.id, summary: "Switched ids to UUID", filesChanged: ["src/test/AuthIT.java"], commits: ["def456"] })).phase).toBe("SYNC");

    // 20-22. both PASS -> DONE
    expect((await backend.call("sync_submit", { taskId: task.id, status: "PASS" })).phase).toBe("SYNC");
    expect((await reviewer.call("sync_submit", { taskId: task.id, status: "PASS" })).phase).toBe("DONE");
    expect(await backend.call("task_get", { taskId: task.id })).toMatchObject({ phase: "DONE", status: "COMPLETED", syncRound: 2 });
    expect((await backend.call("sync_list", { taskId: task.id })).reports).toHaveLength(4);

    // every important action left an event on disk
    const eventTypes = new Set(readdirSync(join(networkDir, "tasks", task.id, "events")).map((f) => JSON.parse(readFileSync(join(networkDir, "tasks", task.id, "events", f), "utf8")).type));
    for (const t of ["TASK_CREATED", "MESSAGE_CREATED", "AGREEMENT_UPDATED", "AGREEMENT_APPROVED", "PHASE_CHANGED", "IMPLEMENTATION_STARTED", "IMPLEMENTATION_COMPLETED", "SYNC_REQUIRED", "SYNC_REPORT_CREATED", "TASK_COMPLETED"]) {
      expect(eventTypes, t).toContain(t);
    }
    expect(readdirSync(join(networkDir, "events"))).toHaveLength(2); // AGENT_REGISTERED x2
    expect(readdirSync(join(networkDir, "tasks", task.id)).sort()).toEqual(["agreement.json", "events", "implementations", "messages", "sync", "task.json"]);
    expect(readdirSync(join(networkDir, "tasks", task.id, "implementations")).sort()).toEqual(["backend.json", "reviewer.json"]);
    expect(readdirSync(join(networkDir, "agents")).sort()).toEqual(["backend.json", "reviewer.json"]);
  });

  it("rejects protocol violations over MCP", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const task = await backend.call("task_create", { title: "t", description: "d", agents: ["backend", "reviewer"] });
    expect((await backend.callError("implementation_start", { taskId: task.id })).code).toBe("INVALID_PHASE");
    expect((await backend.callError("sync_submit", { taskId: task.id, status: "PASS" })).code).toBe("INVALID_PHASE");
    expect((await backend.callError("agreement_approve", { taskId: task.id })).code).toBe("AGREEMENT_NOT_READY");
    expect((await backend.callError("message_read", { taskId: task.id, messageId: "msg-001" })).code).toBe("MESSAGE_NOT_FOUND");
  });
});

describe("concurrency across processes", () => {
  it("40 messages written simultaneously by two processes are all stored intact", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const task = await backend.call("task_create", { title: "t", description: "d", agents: ["backend", "reviewer"] });

    await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const [from, to] = i % 2 ? [backend, "reviewer"] : [reviewer, "backend"];
        return (from as typeof backend).call("message_send", { taskId: task.id, to, type: "INFORMATION", content: `m${i}` });
      }),
    );
    const files = readdirSync(join(networkDir, "tasks", task.id, "messages"));
    expect(files).toHaveLength(40);
    const contents = files.map((f) => JSON.parse(readFileSync(join(networkDir, "tasks", task.id, "messages", f), "utf8")).content);
    expect(new Set(contents).size).toBe(40);
    expect(readdirSync(join(networkDir, "tasks", task.id, "messages")).every((f) => /^msg-\d+\.json$/.test(f))).toBe(true);
    const inboxes = (await backend.call("message_list", { taskId: task.id })).messages.length + (await reviewer.call("message_list", { taskId: task.id })).messages.length;
    expect(inboxes).toBe(40);
  });
});

describe("crash recovery", () => {
  it("state, messages and pending events survive a SIGKILL and restart", async () => {
    const { networkDir } = await project();
    let backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const task = await backend.call("task_create", { title: "t", description: "d", agents: ["backend", "reviewer"] });
    await backend.call("agreement_propose", { taskId: task.id, summary: "s", assignments });
    await backend.call("agreement_approve", { taskId: task.id });
    const msg = await backend.call("message_send", { taskId: task.id, to: "reviewer", type: "QUESTION", content: "survive me" });

    await backend.kill(); // crash right after sending

    backend = await spawnAgent({ id: "backend", networkDir });
    expect((await backend.call("agent_register")).created).toBe(false); // known agent, dead pid -> re-register ok
    expect(await backend.call("task_get", { taskId: task.id })).toMatchObject({ id: task.id, phase: "DISCUSS" });
    expect((await backend.call("message_list", { taskId: task.id, direction: "sent" })).messages.map((m: any) => m.id)).toEqual([msg.id]);
    expect((await backend.call("agreement_get", { taskId: task.id })).approvedBy).toEqual(["backend"]);

    // the receiver still gets the event that was written before the crash...
    const events: string[] = [];
    for (;;) {
      const r = await reviewer.call("wait_for_event", { taskId: task.id, timeoutMs: 300 });
      if (r.status === "TIMEOUT") break;
      events.push(r.event.type);
    }
    expect(events).toEqual(["TASK_CREATED", "AGREEMENT_UPDATED", "AGREEMENT_APPROVED", "MESSAGE_CREATED"]);

    // ...and after the *receiver* restarts too, wait_for_event works against the persisted filesystem
    await reviewer.kill();
    const reviewer2 = await spawnAgent({ id: "reviewer", networkDir });
    await reviewer2.call("agent_register");
    expect(await reviewer2.call("wait_for_event", { taskId: task.id, timeoutMs: 300 })).toEqual({ status: "TIMEOUT" }); // cursor persisted: nothing replayed
    const waiting = reviewer2.call("wait_for_event", { taskId: task.id, timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 300));
    await backend.call("message_send", { taskId: task.id, to: "reviewer", type: "INFORMATION", content: "after restart" });
    expect(await waiting).toMatchObject({ status: "EVENT", event: { type: "MESSAGE_CREATED", payload: { messageId: "msg-002" } } });
    expect((await reviewer2.call("message_read", { taskId: task.id, messageId: msg.id })).content).toBe("survive me");

    // protocol continues across restarts
    expect((await reviewer2.call("agreement_approve", { taskId: task.id })).phase).toBe("IMPLEMENT");
  });

  it("a restarted agent receives events that were created while it was down", async () => {
    const { networkDir } = await project();
    const backend = await spawnAgent({ id: "backend", networkDir });
    let reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("agent_register");
    await reviewer.call("agent_register");
    const task = await backend.call("task_create", { title: "t", description: "d", agents: ["backend", "reviewer"] });
    await reviewer.kill();
    await backend.call("message_send", { taskId: task.id, to: "reviewer", type: "BLOCKER", content: "while you were away" });

    reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await reviewer.call("agent_register");
    const first = await reviewer.call("wait_for_event", { taskId: task.id, timeoutMs: 1000 });
    const second = await reviewer.call("wait_for_event", { taskId: task.id, timeoutMs: 1000 });
    expect([first.event.type, second.event.type]).toEqual(["TASK_CREATED", "MESSAGE_CREATED"]);
  });
});
