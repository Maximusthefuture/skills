import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllAgents, createTaskViaCli, SERVER_ENTRY, spawnAgent } from "../helpers/agentProcess.js";
import { tmpDir } from "../helpers/tmp.js";

afterEach(closeAllAgents);

async function network() {
  const root = await tmpDir("agent-network-test-");
  return join(root, ".agent-network");
}

const assignments = [
  { agentId: "backend", responsibility: "REST controller and service", files: ["src/main/**"] },
  { agentId: "reviewer", responsibility: "validation, review of backend", files: ["src/test/**"] },
];

describe("swarm tool surface", () => {
  it("exposes exactly swarm_context, create_task, send_message, propose, subtasks, complete, wait", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend", networkDir });
    expect(await backend.listTools()).toEqual(["complete", "create_task", "propose", "send_message", "subtasks", "swarm_context", "wait"]);
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

    await backend.call("propose", { summary: "fix + test", assignments: [{ agentId: "backend", responsibility: "fix", files: ["src/main/**"] }, { agentId: "reviewer", responsibility: "test", files: ["src/test/**"] }] });
    await reviewer.call("swarm_context");
    await reviewer.call("complete");
    expect(await backend.call("complete")).toMatchObject({ phaseChanged: { to: "IMPLEMENT" } });
    expect(await backend.callError("create_task", { title: "t", description: "x".repeat(60), agents: ["reviewer"] })).toMatchObject({ code: "HAS_ACTIVE_TASK" });
  });
});

describe("file negotiation over MCP", () => {
  it("overlap is refused, then request/grant lets backend change a reviewer file", async () => {
    const networkDir = await network();
    createTaskViaCli(networkDir, ["backend", "reviewer"]);
    const backend = await spawnAgent({ id: "backend", networkDir });
    const reviewer = await spawnAgent({ id: "reviewer", networkDir });

    const overlap = await backend.callError("propose", { summary: "s", assignments: [{ agentId: "backend", responsibility: "a", files: ["src/**"] }, { agentId: "reviewer", responsibility: "b", files: ["src/test/**"] }] });
    expect(overlap).toMatchObject({ code: "FILE_OVERLAP", nextAction: "propose" });
    await backend.call("propose", { summary: "s", assignments });
    await reviewer.call("swarm_context");
    await reviewer.call("complete");
    await backend.call("complete");

    expect(await backend.callError("complete", { result: "x", filesChanged: ["src/test/Helper.java"] })).toMatchObject({ code: "FILE_NOT_OWNED", nextAction: "implement" });
    await backend.call("send_message", { to: "reviewer", message: "need the helper", requestFiles: ["src/test/Helper.java"] });
    const woke = await reviewer.call("wait", { timeoutMs: 10_000 });
    expect(woke).toMatchObject({ status: "MESSAGES", pendingMessages: [expect.objectContaining({ type: "FILE_REQUEST", files: ["src/test/Helper.java"] })] });
    await reviewer.call("send_message", { to: "backend", message: "granted", grantFiles: ["src/test/Helper.java"] });
    expect(await backend.call("complete", { result: "x", filesChanged: ["src/main/A.java", "src/test/Helper.java"] })).toMatchObject({ action: "IMPLEMENTATION_COMPLETED" });
  });

  it("schemas ask for files in assignments and expose requestFiles / grantFiles", async () => {
    const networkDir = await network();
    const backend = await spawnAgent({ id: "backend", networkDir });
    const tools = await backend.listToolSchemas();
    expect(tools.propose.properties.assignments.items.required).toEqual(expect.arrayContaining(["agentId", "responsibility", "files"]));
    expect(Object.keys(tools.send_message.properties)).toEqual(expect.arrayContaining(["requestFiles", "grantFiles"]));
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

  it("creates a task with options and refuses to unblock a task that is not blocked", async () => {
    const networkDir = await network();
    const task = createTaskViaCli(networkDir, ["backend", "reviewer"], "Options", ["--max-fix-rounds", "1", "--verify", "mvn -q verify", "--no-commits"]);
    expect(task).toMatchObject({ maxFixRounds: 1, verifyCommand: "mvn -q verify" }); // --no-commits is obsolete and ignored
    expect(task.requireCommits).toBeUndefined();
    const list = JSON.parse(execFileSync(process.execPath, [SERVER_ENTRY, "task", "list"], { env: { ...process.env, NETWORK_DIR: networkDir } }).toString());
    expect(list).toEqual([expect.objectContaining({ id: "task-001", maxFixRounds: 1 })]);
    let out = "";
    try {
      execFileSync(process.execPath, [SERVER_ENTRY, "task", "unblock", "--id", "task-001"], { env: { ...process.env, NETWORK_DIR: networkDir }, stdio: "pipe" });
    } catch (e: any) {
      out = String(e.stdout);
    }
    expect(out).toContain("not BLOCKED");
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
  it("DISCUSS -> IMPLEMENT -> SYNC -> NEEDS_FIX -> IMPLEMENT -> SYNC -> INTEGRATE -> DONE", async () => {
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
    // round 2 reviews only backend's fix: the reviewer reviews, backend waits
    expect(await backend.call("complete", { result: "Switched to UUID", commits: ["def456"] })).toMatchObject({ phaseChanged: { to: "SYNC" }, nextAction: "wait", waitingOn: ["reviewer"] });
    expect(await reviewer.call("wait", { timeoutMs: 20_000 })).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "sync", reviewTargets: ["backend"] });
    expect(await reviewer.call("complete", { status: "PASS" })).toMatchObject({ phaseChanged: { to: "INTEGRATE" }, nextAction: "wait" });

    // INTEGRATE: the lead merges and runs the tests
    expect(await backend.call("wait", { timeoutMs: 20_000 })).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "integrate" });
    const done = await backend.call("complete", { status: "PASS", result: "All work is in one branch; build and tests are green" });
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

describe("three agents in three git worktrees", () => {
  /** One repository (the lead's checkout) plus a worktree and a branch per other agent, like scripts/qwen-demo.sh. */
  async function workspace(ids: string[]) {
    const root = await tmpDir("agent-network-test-");
    const repo = join(root, "main");
    mkdirSync(repo);
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, ".gitignore"), ".agent-network/\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");
    const trees: Record<string, string> = {};
    for (const id of ids) {
      trees[id] = join(root, id);
      git(repo, "worktree", "add", "-q", trees[id]!, "-b", id);
    }
    /** Commit a file in an agent's worktree; returns the commit hash. */
    const commit = (id: string, file: string, body: string) => {
      mkdirSync(dirname(join(trees[id]!, file)), { recursive: true });
      writeFileSync(join(trees[id]!, file), body);
      git(trees[id]!, "add", file);
      git(trees[id]!, "commit", "-q", "-m", `${id}: ${file}`);
      return git(trees[id]!, "rev-parse", "HEAD");
    };
    return { repo, trees, git, commit, networkDir: join(repo, ".agent-network") };
  }

  it("divide files in one directory, implement in parallel, collect all reviews, re-review only the fix, integrate", async () => {
    const ids = ["backend", "frontend", "qa"];
    const ws = await workspace(ids);
    const agents = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await spawnAgent({ id, networkDir: ws.networkDir, cwd: ws.trees[id], role: id })] as const)));
    const { backend, frontend, qa } = agents as Record<string, Awaited<ReturnType<typeof spawnAgent>>> & { backend: any; frontend: any; qa: any };

    createTaskViaCli(ws.networkDir, ids, "User list page with REST endpoint", ["--verify", "npm test", "--max-fix-rounds", "2"]);

    // DISCUSS: globs in the same directory that only differ by suffix are not an overlap any more
    expect(await backend.call("swarm_context")).toMatchObject({ nextAction: "propose", task: { verifyCommand: "npm test", maxFixRounds: 2, lead: "backend" } });
    await backend.call("send_message", { to: "frontend", message: "I take src/*Service.ts, you take src/*View.ts, qa takes test/**" });
    await backend.call("send_message", { to: "qa", message: "I take src/*Service.ts, frontend src/*View.ts, you test/**" });
    const proposed = await backend.call("propose", {
      summary: "GET /users and the page that shows them",
      assignments: [
        { agentId: "backend", responsibility: "UserService + GET /users", files: ["src/*Service.ts"] },
        { agentId: "frontend", responsibility: "UserView renders the list", files: ["src/*View.ts"] },
        { agentId: "qa", responsibility: "tests for both", files: ["test/**"] },
      ],
      interfaces: ["GET /users -> 200 [{id, name}]"],
    });
    expect(proposed).toMatchObject({ action: "AGREEMENT_PROPOSED", nextAction: "approve" });
    for (const a of [frontend, qa]) {
      expect(await a.call("wait", { timeoutMs: 20_000 })).toMatchObject({ status: "MESSAGES" });
      await a.call("swarm_context"); // shows the agreement
      expect(await a.call("complete")).toMatchObject({ action: "AGREEMENT_APPROVED" });
    }
    expect(await backend.call("complete")).toMatchObject({ phaseChanged: { to: "IMPLEMENT" }, nextAction: "implement" });

    // IMPLEMENT in parallel, each in its own worktree; commits are optional and recorded as given (the lead merges from them)
    const shaB = ws.commit("backend", "src/UserService.ts", "export const users = () => [{ id: 1, name: 'a' }];\n");
    const shaF = ws.commit("frontend", "src/UserView.ts", "export const view = (u) => u.map((x) => x.nam).join();\n");
    const shaQ = ws.commit("qa", "test/users.test.ts", "// GET /users and UserView\n");
    expect(await backend.call("complete", { result: "UserService", filesChanged: ["src/UserService.ts"], commits: [shaB] })).toMatchObject({ implementation: { filesChanged: ["src/UserService.ts"], commits: [shaB] }, nextAction: "wait" });
    expect(await frontend.call("complete", { result: "UserView", filesChanged: ["src/UserView.ts"], commits: [shaF] })).toMatchObject({ nextAction: "wait" });
    expect(await qa.call("complete", { result: "tests", filesChanged: ["test/users.test.ts"], commits: [shaQ] })).toMatchObject({ phaseChanged: { to: "SYNC" }, nextAction: "sync", reviewTargets: ["backend", "frontend"] });

    // SYNC round 1: qa's NEEDS_FIX does not cut off the other reviews; the task moves once all three reported
    expect(await qa.call("complete", { status: "NEEDS_FIX", findings: [{ severity: "ERROR", description: "UserView reads x.nam, the field is name", relatedAgent: "frontend", files: ["src/UserView.ts"] }] })).toMatchObject({ task: { phase: "SYNC" }, waitingOn: ["backend", "frontend"] });
    expect(await backend.call("wait", { timeoutMs: 20_000 })).toMatchObject({ nextAction: "sync" });
    expect(await backend.call("complete", { status: "PASS", findings: [{ severity: "WARNING", description: "UserView could be typed" }] })).toMatchObject({ task: { phase: "SYNC" } });
    expect(await frontend.call("complete", { status: "PASS" })).toMatchObject({ phaseChanged: { from: "SYNC", to: "IMPLEMENT" }, nextAction: "fix", fixRequests: [expect.objectContaining({ reportedBy: "qa", forYou: true })] });

    // only frontend fixes; round 2 reviews only that fix, by backend and qa
    const fixSha = ws.commit("frontend", "src/UserView.ts", "export const view = (u) => u.map((x) => x.name).join();\n");
    expect(await frontend.call("complete", { result: "x.nam -> x.name", filesChanged: ["src/UserView.ts"], commits: [fixSha] })).toMatchObject({ phaseChanged: { to: "SYNC" }, task: { syncRound: 2 }, nextAction: "wait", waitingOn: ["backend", "qa"] });
    for (const a of [backend, qa]) {
      expect(await a.call("wait", { timeoutMs: 20_000 })).toMatchObject({ nextAction: "sync", reviewTargets: ["frontend"] });
    }
    await qa.call("complete", { status: "PASS" });
    expect(await backend.call("complete", { status: "PASS" })).toMatchObject({ phaseChanged: { to: "INTEGRATE" }, nextAction: "integrate", hint: expect.stringContaining("npm test") });

    // INTEGRATE: the lead merges the three branches in the main checkout and reports the merged HEAD
    ws.git(ws.repo, "merge", "-q", "--no-edit", "backend", "frontend", "qa");
    const merged = ws.git(ws.repo, "rev-parse", "HEAD");
    expect(readdirSync(join(ws.repo, "src")).sort()).toEqual(["UserService.ts", "UserView.ts"]);
    const done = await backend.call("complete", { status: "PASS", result: "main: backend+frontend+qa merged, npm test green", commits: [merged] });
    expect(done).toMatchObject({ task: { phase: "DONE", status: "COMPLETED" }, integration: { status: "PASS", commits: [merged] } });
    for (const a of [frontend, qa]) expect(await a.call("wait", { timeoutMs: 5_000 })).toMatchObject({ status: "DONE" });
  });
});
