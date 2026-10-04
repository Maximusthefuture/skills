import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ancestors, resolveAgentByProcess, runHook, runHookCli, type HookDeps, type ProcessTable } from "../../src/hook.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { AgentStore } from "../../src/stores/agentStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { TaskStore } from "../../src/stores/taskStore.js";
import type { Agent } from "../../src/types.js";
import { tmpDir } from "../helpers/tmp.js";

// Two Claude Code sessions in two terminals:
// terminal 100 ─ claude 200 ─ mcp 201 (backend), hook sh 210 ─ hook node 211
//              └ claude 300 ─ mcp 301 (reviewer), hook sh 310 ─ hook node 311
//              └ claude 400 (no agent-network), hook sh 410 ─ hook node 411
const table: ProcessTable = new Map([
  [100, 1],
  [200, 100],
  [201, 200],
  [210, 200],
  [211, 210],
  [300, 100],
  [301, 300],
  [310, 300],
  [311, 310],
  [400, 100],
  [410, 400],
  [411, 410],
]);
const alive = () => true;
const agent = (id: string, pid: number, status: Agent["status"] = "ONLINE"): Agent => ({ id, type: "claude", status, registeredAt: "", lastSeenAt: "", pid });

describe("process tree identity", () => {
  it("walks up to, not including, pid 1 and survives cycles", () => {
    expect(ancestors(table, 211)).toEqual([211, 210, 200, 100]);
    expect(ancestors(new Map([[5, 6], [6, 5]]), 5)).toEqual([5, 6]);
  });

  it("picks the agent whose MCP server runs in the hook's claude process", () => {
    const agents = [agent("backend", 201), agent("reviewer", 301)];
    expect(resolveAgentByProcess(table, 211, agents, alive)).toBe("backend");
    expect(resolveAgentByProcess(table, 311, agents, alive)).toBe("reviewer");
    expect(resolveAgentByProcess(table, 411, agents, alive)).toBeNull(); // a session without the swarm shares only the terminal
  });

  it("ignores offline and dead agents and refuses ambiguity", () => {
    expect(resolveAgentByProcess(table, 211, [agent("backend", 201, "OFFLINE")], alive)).toBeNull();
    expect(resolveAgentByProcess(table, 211, [agent("backend", 201)], () => false)).toBeNull();
    const twin = new Map(table).set(202, 200);
    expect(resolveAgentByProcess(twin, 211, [agent("backend", 201), agent("other", 202)], alive)).toBeNull();
    const npx = new Map(table).set(250, 200).set(251, 250); // claude 200 ─ npx 250 ─ mcp 251
    expect(resolveAgentByProcess(npx, 211, [agent("wrapped", 251)], alive)).toBeNull(); // needs --agent
  });
});

async function setup() {
  const networkDir = join(await tmpDir(), ".agent-network");
  const fs = await FileStore.open(networkDir);
  const agents = new AgentStore(fs);
  await agents.register({ id: "backend", type: "claude" }, { pid: 201, isProcessAlive: alive });
  await agents.register({ id: "reviewer", type: "claude" }, { pid: 301, isProcessAlive: alive });
  const tasks = new TaskStore(fs);
  const task = await tasks.create({ title: "t", description: "d", agents: ["backend", "reviewer"], createdBy: "operator", git: null });
  const messages = new MessageStore(fs);
  const clock = { t: Date.now() };
  const deps: HookDeps = { selfPid: 211, processTable: () => table, isProcessAlive: alive, now: () => new Date(clock.t) };
  return { networkDir, tasks, task, messages, deps, clock };
}

describe("runHook post-tool", () => {
  it("tells the agent about a new message once", async () => {
    const { networkDir, task, messages, deps } = await setup();
    await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "FILE_REQUEST", content: "need pom.xml for the kafka dependency", files: ["pom.xml"] });

    const first = (await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(first.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(first.hookSpecificOutput.additionalContext).toContain('reviewer [FILE_REQUEST] (reviewer is waiting for you): "need pom.xml');
    expect(first.hookSpecificOutput.additionalContext).toContain("files: pom.xml");

    expect(await runHook("post-tool", { tool_name: "Bash" }, { networkDir }, deps)).toBeNull();

    await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "QUESTION", content: "and the DTO?" });
    const second = (await runHook("post-tool", { tool_name: "Bash" }, { networkDir }, deps)) as { hookSpecificOutput: { additionalContext: string } };
    expect(second.hookSpecificOutput.additionalContext).toContain("1 new message(s)");
    expect(second.hookSpecificOutput.additionalContext).toContain("and the DTO?");
  });

  it("stays silent for read messages, other recipients, swarm tools and finished tasks", async () => {
    const { networkDir, tasks, task, messages, deps } = await setup();
    const read = await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "QUESTION", content: "read" });
    await messages.markRead(read);
    await messages.create({ taskId: task.id, from: "backend", to: "reviewer", type: "QUESTION", content: "not mine" });
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).toBeNull();

    await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "QUESTION", content: "new" });
    expect(await runHook("post-tool", { tool_name: "mcp__agent-network__send_message" }, { networkDir }, deps)).toBeNull();

    await tasks.save({ ...task, status: "COMPLETED", phase: "DONE" });
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).toBeNull();
  });

  it("uses an explicit --agent and does nothing without a network dir or an identity", async () => {
    const { networkDir, task, messages, deps } = await setup();
    await messages.create({ taskId: task.id, from: "backend", to: "reviewer", type: "QUESTION", content: "for reviewer" });
    expect(await runHook("post-tool", {}, { networkDir, agent: "reviewer" }, deps)).not.toBeNull();
    expect(await runHook("post-tool", {}, { networkDir: join(networkDir, "missing") }, deps)).toBeNull();
    expect(await runHook("post-tool", {}, { networkDir }, { ...deps, selfPid: 999 })).toBeNull();
  });
});

describe("runHook open file requests", () => {
  type Out = { hookSpecificOutput: { additionalContext: string } } | null;

  it("repeats a read but unanswered FILE_REQUEST once a minute until the owner answers", async () => {
    const { networkDir, task, messages, deps, clock } = await setup();
    const req = await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "FILE_REQUEST", content: "need pom.xml", files: ["pom.xml"] });
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).not.toBeNull(); // new message
    await messages.markRead(req); // the agent read it in swarm_context but did not answer

    clock.t += 30_000;
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).toBeNull(); // not every tool call

    clock.t += 31_000;
    const reminder = (await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)) as Out;
    expect(reminder!.hookSpecificOutput.additionalContext).toContain("Still unanswered file requests");
    expect(reminder!.hookSpecificOutput.additionalContext).toMatch(/- reviewer asked 6[12]s ago to change: pom.xml/);
    expect(reminder!.hookSpecificOutput.additionalContext).toContain("grantFiles");
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).toBeNull();

    await messages.create({ taskId: task.id, from: "backend", to: "reviewer", type: "FILE_GRANT", content: "ok", files: ["pom.xml"] });
    clock.t += 120_000;
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).toBeNull(); // answered: closed
  });

  it("does not remind about other agents' requests or requests the agent made itself", async () => {
    const { networkDir, task, messages, deps, clock } = await setup();
    const mine = await messages.create({ taskId: task.id, from: "backend", to: "reviewer", type: "FILE_REQUEST", content: "need DTO", files: ["Dto.java"] });
    await messages.markRead(mine);
    clock.t += 300_000;
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir }, deps)).toBeNull();
    expect(await runHook("post-tool", { tool_name: "Edit" }, { networkDir, agent: "reviewer" }, deps)).not.toBeNull(); // the owner is reminded
  });
});

describe("runHook stop", () => {
  it("blocks the stop once while the task is active", async () => {
    const { networkDir, task, messages, deps } = await setup();
    await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "BLOCKER", content: "wait" });
    const out = (await runHook("stop", {}, { networkDir }, deps)) as { decision: string; reason: string };
    expect(out.decision).toBe("block");
    expect(out.reason).toContain(`${task.id} (phase DISCUSS)`);
    expect(out.reason).toContain("1 unread message(s): reviewer");
    await messages.create({ taskId: task.id, from: "reviewer", to: "backend", type: "FILE_REQUEST", content: "pom", files: ["pom.xml"] });
    const withRequest = (await runHook("stop", {}, { networkDir }, deps)) as { reason: string };
    expect(withRequest.reason).toContain("reviewer wait(s) for your answer to a file request");
    expect(await runHook("stop", { stop_hook_active: true }, { networkDir }, deps)).toBeNull();
  });

  it("lets the agent stop when it has no active task", async () => {
    const { networkDir, tasks, task, deps } = await setup();
    await tasks.save({ ...task, status: "BLOCKED" });
    expect(await runHook("stop", {}, { networkDir }, deps)).toBeNull();
  });
});

describe("runHookCli", () => {
  it("prints the hook JSON and always exits 0", async () => {
    const { networkDir, task, messages } = await setup();
    await messages.create({ taskId: task.id, from: "backend", to: "reviewer", type: "QUESTION", content: "q" });
    const lines: string[] = [];
    const code = await runHookCli("post-tool", ["--network-dir", networkDir, "--agent", "reviewer"], {}, (s) => lines.push(s), async () => '{"tool_name":"Edit"}');
    expect(code).toBe(0);
    expect(JSON.parse(lines[0]!).hookSpecificOutput.additionalContext).toContain("backend [QUESTION]");

    expect(await runHookCli("stop", ["--network-dir", networkDir, "--agent", "reviewer"], {}, () => undefined, async () => "not json")).toBe(0);
    expect(await runHookCli("stop", [], {}, () => undefined, async () => "")).toBe(0);
    expect(await runHookCli("nope", [], {}, () => undefined)).toBe(2);
  });
});
