import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllAgents, createTaskViaCli, SERVER_ENTRY, spawnAgent } from "../helpers/agentProcess.js";
import { tmpDir } from "../helpers/tmp.js";

afterEach(closeAllAgents);

async function network() {
  const root = await tmpDir("agent-network-test-");
  return join(root, ".agent-network");
}

const assignments = [
  { agentId: "backend", responsibility: "REST controller and service" },
  { agentId: "reviewer", responsibility: "validation, review of backend" },
];

describe("five-tool surface", () => {
  it("exposes exactly swarm_context, create_task, send_message, propose, complete, wait", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend", networkDir });
    expect(await backend.listTools()).toEqual(["complete", "create_task", "propose", "send_message", "swarm_context", "wait"]);
  });

  it("registers the agent at startup, so the other agent sees it without any tool call", async () => {
    const networkDir = await network();
    await spawnAgent({ id: "backend", networkDir, type: "qwen", role: "backend" });
    expect(readdirSync(join(networkDir, "agents"))).toEqual(["backend.json"]);
  });

  it("one shared config with AGENT_ID=\"backend,reviewer\": each process claims a different free name", async () => {
    const networkDir = await network();
    const first = await spawnAgent({ id: "backend,reviewer", networkDir, type: "qwen" });
    const second = await spawnAgent({ id: "backend,reviewer", networkDir, type: "qwen" });
    expect((await first.call("swarm_context")).agent.id).toBe("backend");
    expect((await second.call("swarm_context")).agent.id).toBe("reviewer");
    await expect(spawnAgent({ id: "backend,reviewer", networkDir })).rejects.toThrow(); // pool exhausted
    expect(readdirSync(join(networkDir, "agents")).sort()).toEqual(["backend.json", "reviewer.json"]);
  });

  it("carries instructions for the model", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend", networkDir });
    expect(await backend.instructions()).toContain("Always call swarm_context");
  });

  it("ignores identity fields in tool arguments", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("send_message", { to: "reviewer", message: "hi", from: "reviewer", agentId: "reviewer" });
    expect((await reviewer.call("swarm_context")).pendingMessages).toEqual([expect.objectContaining({ from: "backend" })]);
  });
});

describe("tool schemas", () => {
  it("declare the arguments every call needs as required, so models fill them in", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend", networkDir });
    const tools = await backend.listToolSchemas();
    expect(tools.send_message.required).toEqual(["to", "message"]);
    expect(tools.create_task.required).toEqual(["title", "description", "agents"]);
    expect(tools.propose.required).toEqual(["summary", "assignments"]);
    expect(tools.complete.required ?? []).toEqual([]);
    for (const [name, schema] of Object.entries(tools)) {
      for (const [field, def] of Object.entries<any>(schema.properties ?? {})) expect(def.description, `${name}.${field}`).toBeTruthy();
    }
  });

  it("an empty call is rejected by the schema with a message naming the missing fields", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    const backend = await spawnAgent({ id: "backend", networkDir });
    const err = await backend.callError("send_message", {});
    expect(err.message).toMatch(/to/);
    expect(err.message).toMatch(/message/);
    expect((await backend.call("swarm_context")).task.phase).toBe("DISCUSS");
  });
});

describe("agent-created task (no operator)", () => {
  it("one agent creates the task from the user's request and both finish the DISCUSS phase", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend,reviewer", networkDir, type: "claude" });
    const reviewer = await spawnAgent({ id: "backend,reviewer", networkDir, type: "qwen" });
    expect((await backend.call("swarm_context")).allowedActions).toEqual(["create_task", "wait"]);

    const waiting = reviewer.call("wait", { timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 400));
    const created = await backend.call("create_task", {
      title: "Fix missing amount",
      description: "POST /orders without amount must return 400 instead of 500. backend fixes src/main, reviewer writes the test.",
      agents: ["reviewer"],
    });
    expect(created).toMatchObject({ action: "TASK_CREATED", task: { id: "task-001", agents: ["backend", "reviewer"] }, nextAction: "propose" });
    expect(await waiting).toMatchObject({ status: "UPDATED", task: { id: "task-001" } });

    await backend.call("propose", { summary: "fix + test", assignments: [{ agentId: "backend", responsibility: "fix" }, { agentId: "reviewer", responsibility: "test" }] });
    await reviewer.call("swarm_context");
    await reviewer.call("complete");
    expect(await backend.call("complete")).toMatchObject({ phaseChanged: { to: "IMPLEMENT" } });
    expect(await backend.callError("create_task", { title: "t", description: "x".repeat(60), agents: ["reviewer"] })).toMatchObject({ code: "HAS_ACTIVE_TASK" });
  });
});

describe("operator CLI", () => {
  it("creates a task outside the LLM and lists it", async () => {
    const networkDir = await network();
    const task = createTaskViaCli(networkDir, ["backend", "reviewer"], "User registration");
    expect(task).toMatchObject({ id: "task-001", phase: "DISCUSS", status: "ACTIVE", agents: ["backend", "reviewer"], createdBy: "operator" });
    const list = JSON.parse(execFileSync(process.execPath, [SERVER_ENTRY, "task", "list"], { env: { ...process.env, NETWORK_DIR: networkDir } }).toString());
    expect(list).toEqual([expect.objectContaining({ id: "task-001", title: "User registration", phase: "DISCUSS" })]);
  });

  it("lists registered agents", async () => {
    const networkDir = await network();
    await spawnAgent({ id: "backend", networkDir, type: "qwen", role: "backend" });
    const out = JSON.parse(execFileSync(process.execPath, [SERVER_ENTRY, "agent", "list"], { env: { ...process.env, NETWORK_DIR: networkDir } }).toString());
    expect(out).toEqual([expect.objectContaining({ id: "backend", type: "qwen", role: "backend", status: "ONLINE" })]);
  });

  it("cancels a task", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [SERVER_ENTRY, ...args], { env: { ...process.env, NETWORK_DIR: networkDir } }).toString());
    expect(run("task", "cancel", "--id", "task-001", "--reason", "empty description")).toMatchObject({ id: "task-001", status: "CANCELLED" });
    expect(run("task", "list")).toEqual([expect.objectContaining({ id: "task-001", status: "CANCELLED" })]);
    const backend = await spawnAgent({ id: "backend", networkDir });
    expect((await backend.call("swarm_context")).task).toBeNull();
  });

  it("fails with a clear message on bad input", async () => {
    const networkDir = await network();
    const run = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [SERVER_ENTRY, ...args], { env: { ...process.env, NETWORK_DIR: networkDir }, stdio: "pipe" });
        return { code: 0, out: "" };
      } catch (e: any) {
        return { code: e.status as number, out: String(e.stdout) };
      }
    };
    expect(run("task", "create", "--title", "t", "--agents", "solo")).toMatchObject({ code: 1, out: expect.stringContaining("at least two") });
    expect(run("task", "create", "--agents", "a,b")).toMatchObject({ code: 2 });
    expect(run("task", "create", "--title", "t", "--agents", "../x,b")).toMatchObject({ code: 1, out: expect.stringContaining("INVALID_INPUT") });
    expect(run("bogus")).toMatchObject({ code: 2 });
  });
});

describe("full cycle through the five tools (two processes)", () => {
  it("DISCUSS -> IMPLEMENT -> SYNC -> NEEDS_FIX -> IMPLEMENT -> SYNC -> DONE", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend", networkDir, type: "qwen", role: "backend" });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir, type: "qwen", role: "reviewer" });

    // reviewer is already waiting when the operator creates the task
    const waitingForTask = reviewer.call("wait", { timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 400));
    createTaskViaCli(networkDir, ["backend", "reviewer"], "Implement a REST endpoint for user registration");
    expect(await waitingForTask).toMatchObject({ status: "UPDATED", task: { id: "task-001", phase: "DISCUSS" }, nextAction: "wait" });

    // DISCUSS: backend leads
    const ctx = await backend.call("swarm_context");
    expect(ctx).toMatchObject({ nextAction: "propose", task: { phase: "DISCUSS" }, otherAgents: [{ id: "reviewer", role: "reviewer", status: expect.any(String) }] });
    await backend.call("send_message", { to: "reviewer", message: "I take controller+service, you take validation. POST /users returns UUID. OK?" });

    const woke = await reviewer.call("wait", { timeoutMs: 20_000 });
    expect(woke).toMatchObject({ status: "MESSAGES", pendingMessages: [expect.objectContaining({ from: "backend" })] });
    await reviewer.call("send_message", { to: "backend", message: "Agreed." });

    const proposed = await backend.call("propose", { summary: "Registration endpoint", assignments, decisions: ["IDs are UUID"], interfaces: ["POST /users -> 201 {id: uuid}"] });
    expect(proposed).toMatchObject({ action: "AGREEMENT_PROPOSED", nextAction: "approve" });

    // reviewer wakes with the agreement, approves; backend approves -> IMPLEMENT automatically
    const reviewing = await reviewer.call("wait", { timeoutMs: 20_000 });
    expect(reviewing.agreement).toMatchObject({ summary: "Registration endpoint", approvedBy: [] });
    expect(await reviewer.call("complete")).toMatchObject({ action: "AGREEMENT_APPROVED", nextAction: "wait" });
    expect(await backend.call("complete")).toMatchObject({ phaseChanged: { from: "DISCUSS", to: "IMPLEMENT" }, nextAction: "implement", assignment: { responsibility: assignments[0]!.responsibility } });

    // IMPLEMENT
    expect(await backend.call("complete", { result: "Controller and service", filesChanged: ["src/UserController.java", "src/UserService.java"], commits: ["abc123"] })).toMatchObject({ nextAction: "wait", waitingOn: ["reviewer"] });
    const inImpl = await reviewer.call("swarm_context");
    expect(inImpl).toMatchObject({ nextAction: "implement", teamImplementations: [expect.objectContaining({ agentId: "backend", status: "READY_FOR_SYNC" })] });
    expect(await reviewer.call("complete", { result: "Validation rules", filesChanged: ["src/UserValidator.java"] })).toMatchObject({ phaseChanged: { to: "SYNC" }, nextAction: "sync" });

    // SYNC: backend wakes up, reviews, PASS; reviewer finds an incompatibility
    expect(await backend.call("wait", { timeoutMs: 20_000 })).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "sync" });
    expect(await backend.call("complete", { status: "PASS" })).toMatchObject({ action: "SYNC_PASS", nextAction: "wait" });
    const fix = await reviewer.call("complete", { status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "Controller returns Long, agreed UUID", relatedAgent: "backend", files: ["src/UserController.java"] }] });
    expect(fix).toMatchObject({ phaseChanged: { from: "SYNC", to: "IMPLEMENT" }, nextAction: "wait" });

    // backend (waiting) is told to fix; fixes; back to SYNC; both PASS -> DONE
    const toFix = await backend.call("wait", { timeoutMs: 20_000 });
    expect(toFix).toMatchObject({ nextAction: "fix", fixRequests: [expect.objectContaining({ forYou: true, reportedBy: "reviewer" })] });
    expect(await backend.call("complete", { result: "Switched to UUID", commits: ["def456"] })).toMatchObject({ phaseChanged: { to: "SYNC" }, nextAction: "sync" });
    expect(await reviewer.call("complete", { status: "PASS" })).toMatchObject({ nextAction: "wait" });
    const done = await backend.call("complete", { status: "PASS" });
    expect(done).toMatchObject({ task: { phase: "DONE", status: "COMPLETED", syncRound: 2 }, nextAction: "done", allowedActions: [] });
    expect(await reviewer.call("wait", { timeoutMs: 5_000 })).toMatchObject({ status: "DONE" });
  });
});

describe("misuse over MCP", () => {
  it("returns actionable errors and leaves state intact", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    const before = await backend.call("swarm_context");

    const cases: [Promise<any>, Record<string, unknown>][] = [
      [reviewer.callError("complete"), { code: "AGREEMENT_NOT_READY", nextAction: "wait" }],
      [backend.callError("complete", { status: "PASS" }), { code: "INVALID_INPUT", currentPhase: "DISCUSS" }],
      [backend.callError("send_message", { to: "ghost", message: "x" }), { code: "NOT_ASSIGNED", validRecipients: ["reviewer"] }],
      [backend.callError("send_message", { to: "reviewer", message: "" }), { code: "INVALID_INPUT" }],
      [backend.callError("propose", { summary: "s", assignments: [] }), { code: "INVALID_INPUT", taskAgents: ["backend", "reviewer"] }],
    ];
    for (const [pending, expected] of cases) {
      const err = await pending;
      expect(err).toMatchObject({ message: expect.any(String), allowedActions: expect.any(Array), ...expected });
      expect(err.raw).not.toMatch(/\bat .*\.(ts|js):\d+/);
    }
    // phase-inappropriate propose
    await backend.call("propose", { summary: "s", assignments });
    await reviewer.call("swarm_context");
    await reviewer.call("complete");
    await backend.call("complete");
    expect(await backend.callError("propose", { summary: "again", assignments })).toMatchObject({ code: "INVALID_PHASE", currentPhase: "IMPLEMENT", nextAction: "implement" });
    expect(await backend.callError("complete", {})).toMatchObject({ code: "INVALID_INPUT", nextAction: "implement" });

    expect(before).toMatchObject({ task: { phase: "DISCUSS" } });
    expect(await backend.call("swarm_context")).toMatchObject({ task: { phase: "IMPLEMENT" }, nextAction: "implement" });
  });

  it("a blind approve is refused until the agreement has been shown", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });
    await backend.call("propose", { summary: "s", assignments });
    const err = await reviewer.callError("complete");
    expect(err).toMatchObject({ code: "AGREEMENT_NOT_REVIEWED", nextAction: "approve", agreement: { summary: "s" } });
    expect(await reviewer.call("complete")).toMatchObject({ action: "AGREEMENT_APPROVED" });
  });
});

describe("crash recovery through swarm_context", () => {
  it("a restarted process reconstructs identical state; wait works after restart", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    let backend = await spawnAgent({ id: "backend", networkDir });
    let reviewer = await spawnAgent({ id: "reviewer", networkDir });

    await backend.call("send_message", { to: "reviewer", message: "survive me" });
    await backend.call("propose", { summary: "s", assignments });
    await reviewer.call("swarm_context");
    await reviewer.call("complete"); // approved by reviewer only; phase still DISCUSS
    await backend.call("send_message", { to: "reviewer", message: "unread when the crash happens" });

    const normalize = (c: any) => {
      const { agent, otherAgents, ...rest } = c; // statuses/heartbeat timestamps legitimately differ
      return rest;
    };
    const beforeBackend = normalize(await backend.call("swarm_context"));
    const beforeReviewer = normalize(await reviewer.call("swarm_context"));
    expect(beforeReviewer.pendingMessages).toEqual([expect.objectContaining({ content: "unread when the crash happens" })]);

    await backend.kill();
    await reviewer.kill();
    backend = await spawnAgent({ id: "backend", networkDir });
    reviewer = await spawnAgent({ id: "reviewer", networkDir });

    expect(normalize(await backend.call("swarm_context"))).toEqual(beforeBackend);
    expect(normalize(await reviewer.call("swarm_context"))).toEqual(beforeReviewer); // unread message survived too

    // protocol continues across the restart
    expect(await backend.call("complete")).toMatchObject({ phaseChanged: { to: "IMPLEMENT" } });
    const waiting = reviewer.call("wait", { timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, 300));
    await backend.call("complete", { result: "api" });
    const res = await reviewer.call("wait", { timeoutMs: 5_000 }); // already actionable (implement) -> immediate
    expect(await waiting).toMatchObject({ nextAction: "implement" });
    expect(res).toMatchObject({ nextAction: "implement" });
  });
});
