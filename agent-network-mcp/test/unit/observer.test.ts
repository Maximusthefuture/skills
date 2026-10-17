import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { collectDigests, readDigests } from "../../src/observer/digest.js";
import { createObserverServer } from "../../src/observer/mcp.js";
import { Observer } from "../../src/observer/observer.js";
import { ObserverStore } from "../../src/observer/store.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { SessionStore } from "../../src/stores/sessionStore.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

/** A network with one closed task that had a refused call, a question, a block and a failed session. */
async function closedTask() {
  const root = await tmpDir();
  const networkDir = join(root, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const backend = new Swarm(await NetworkService.create(networkDir, { id: "backend", type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }));
  const task = await operator.createTaskAsOperator({ title: "Refunds", description: "partial refunds", agents: ["backend", "reviewer"], clarify: true });
  // a refused call as the MCP layer records it
  await backend.propose({ summary: "s", assignments: [{ agentId: "backend", responsibility: "r", files: ["src/**"] }, { agentId: "reviewer", responsibility: "r", files: [] }] }).catch((e) => backend.errorBody(e, "propose"));
  const asked = await backend.sendMessage({ to: "operator", message: "Partial or full?", options: [{ label: "Partial" }, { label: "Full" }] });
  await operator.answerQuestion({ taskId: task.id, messageId: asked.messageId as string, answer: 'Chosen: "Partial"' });
  await operator.blockForRunner(task.id, "reviewer", "4 sessions ended before its part was done (last exit 1)");
  const sessions = new SessionStore(await FileStore.open(networkDir));
  for (const [agentId, exitCode, costUsd] of [["backend", 0, 0.2], ["reviewer", 1, 0.05]] as const) {
    await sessions.create({ taskId: task.id, agentId, attempt: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1000, exitCode, costUsd, model: "haiku" });
  }
  await operator.cancelTask(task.id, "given up");
  return { root, networkDir, operator, task };
}

const run = (networkDir: string) => ({
  title: "Tasks 001",
  markdown: "## Итог\nОдин отказ CLARIFY_FIRST.",
  covers: ["task-001"],
  issues: [{ title: "Leads propose before clarifying", status: "open" as const, seenIn: ["task-001"], note: "CLARIFY_FIRST once" }],
  proposals: [{ title: "Say clarify first in the lead's first hint", problem: "p", evidence: "task-001: propose:CLARIFY_FIRST", impact: "one wasted turn", fix: "src/mcp/swarm.ts: ...", target: "project" as const, priority: "low" as const }],
  networkDir,
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("digests of closed tasks", () => {
  it("say in short what happened, without a model, once per task", async () => {
    const { networkDir, task } = await closedTask();
    expect(await collectDigests(networkDir)).toEqual([task.id]);
    expect(await collectDigests(networkDir)).toEqual([]); // once
    const [d] = await readDigests(networkDir);
    expect(d).toMatchObject({
      taskId: task.id, status: "CANCELLED", kind: "code", costUsd: 0.25,
      agents: [{ id: "backend", sessions: 1, failed: 0, costUsd: 0.2 }, { id: "reviewer", sessions: 1, failed: 1, costUsd: 0.05 }],
      blocks: [{ kind: "runner", reason: expect.stringContaining("reviewer's runner gave up") }],
      questions: { asked: 1, answered: 1, withChoices: 1 },
      protocolErrors: { "propose:CLARIFY_FIRST": 1 },
    });
  });

  it("counts a session's cost/sessions in a task it only finished via alsoFinished, even with no sessions of its own", async () => {
    const root = await tmpDir();
    const networkDir = join(root, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const taskA = await operator.createTaskAsOperator({ title: "A", description: "a", agents: ["backend", "reviewer"] });
    const taskB = await operator.createTaskAsOperator({ title: "B", description: "b", agents: ["backend", "reviewer"] });
    const sessions = new SessionStore(await FileStore.open(networkDir));
    // the agent kept going past taskA without a pause and also finished taskB within the same session
    await sessions.create({
      taskId: taskA.id, agentId: "backend", attempt: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      durationMs: 1000, exitCode: 0, costUsd: 0.53, model: "haiku", alsoFinished: [taskB.id],
    });
    await operator.cancelTask(taskA.id, "done");
    await operator.cancelTask(taskB.id, "done");
    await collectDigests(networkDir);
    const digests = await readDigests(networkDir);
    const dA = digests.find((d) => d.taskId === taskA.id);
    const dB = digests.find((d) => d.taskId === taskB.id);
    expect(dA?.agents.find((a) => a.id === "backend")).toMatchObject({ sessions: 1, costUsd: 0.53 });
    // taskB has no session file of its own: its real cost lives only in taskA's folder, credited via alsoFinished
    expect(dB?.agents.find((a) => a.id === "backend")).toMatchObject({ sessions: 1, costUsd: 0.53 });
    expect(dB?.costUsd).toBe(0.53);
  });

  it("rebuilds a digest once a new session appears crediting it via alsoFinished, after it was already written", async () => {
    const root = await tmpDir();
    const networkDir = join(root, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const taskA = await operator.createTaskAsOperator({ title: "A", description: "a", agents: ["backend", "reviewer"] });
    const taskB = await operator.createTaskAsOperator({ title: "B", description: "b", agents: ["backend", "reviewer"] });
    await operator.cancelTask(taskA.id, "done");
    await operator.cancelTask(taskB.id, "done");
    expect(await collectDigests(networkDir)).toEqual(expect.arrayContaining([taskA.id, taskB.id]));
    expect(await collectDigests(networkDir)).toEqual([]); // nothing new: both digests stay as they are

    // a session recorded late, after both digests were already written, that also finished taskB
    const sessions = new SessionStore(await FileStore.open(networkDir));
    await sessions.create({
      taskId: taskA.id, agentId: "backend", attempt: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
      durationMs: 1000, exitCode: 0, costUsd: 0.53, model: "haiku", alsoFinished: [taskB.id],
    });

    expect(await collectDigests(networkDir)).toEqual(expect.arrayContaining([taskA.id, taskB.id]));
    const digests = await readDigests(networkDir);
    expect(digests.find((d) => d.taskId === taskA.id)?.agents.find((a) => a.id === "backend")).toMatchObject({ sessions: 1, costUsd: 0.53 });
    expect(digests.find((d) => d.taskId === taskB.id)?.agents.find((a) => a.id === "backend")).toMatchObject({ sessions: 1, costUsd: 0.53 });
  });
});

describe("the observer's store and tools", () => {
  it("keeps reports, tracks issues across runs and remembers the operator's decisions", async () => {
    const { networkDir } = await closedTask();
    await collectDigests(networkDir);
    const server = createObserverServer(networkDir);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test-observer", version: "0.0.0" });
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(((await client.callTool({ name, arguments: args })).content as { text: string }[])[0]!.text);

    expect(await call("digests")).toMatchObject({ newSinceLastReport: 1, digests: [{ taskId: "task-001" }] });
    const { networkDir: _n, ...first } = run(networkDir);
    expect(await call("save_report", first)).toEqual({ report: "report-001", proposals: ["prop-001"], issues: 1 });
    expect(await call("digests")).toMatchObject({ newSinceLastReport: 0, digests: [] });

    const store = await ObserverStore.open(networkDir);
    await store.decide("prop-001", { status: "rejected", rejectReason: "not worth a task" });
    // the next run updates the known issue and sees the decision
    await call("save_report", { ...first, title: "again", covers: [], proposals: [], issues: [{ id: "issue-001", title: "Leads propose before clarifying", status: "watching", seenIn: ["task-002"], note: "n" }] });
    const history = await call("history");
    expect(history.issues).toEqual([expect.objectContaining({ id: "issue-001", status: "watching", seenIn: ["task-001", "task-002"] })]);
    expect(history.proposals).toEqual([expect.objectContaining({ id: "prop-001", status: "rejected", rejectReason: "not worth a task" })]);
    await expect(store.decide("prop-001", { status: "accepted" })).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
  });
});

describe("the observer's runs", () => {
  it("a run starts its CLI with the network, records what it saved; one at a time", async () => {
    const { networkDir } = await closedTask();
    const prompt = join(networkDir, "..", "observer-prompt.md");
    writeFileSync(prompt, "Look back.");
    const seen: { argv: string[]; env: NodeJS.ProcessEnv }[] = [];
    const observer = new Observer({
      networkDir,
      config: { command: ["claude", "-p", "{prompt}", "--model", "{model}", "--add-dir", "{networkDir}"], model: "sonnet", promptFile: prompt },
      run: async (argv, env) => {
        seen.push({ argv, env });
        const { networkDir: _n, ...r } = run(networkDir);
        await (await ObserverStore.open(networkDir)).saveRun(r); // what its MCP tool does
        return { code: 0, result: { costUsd: 0.31 } as never };
      },
    });
    const started = await observer.runNow("button");
    await expect(observer.runNow("button")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await observer.idle();
    expect(started.by).toBe("button");
    expect(seen[0]!.argv).toEqual(["claude", "-p", expect.stringContaining('"newClosedTasks": 1'), "--model", "sonnet", "--add-dir", networkDir]);
    expect(seen[0]!.argv[2]).toContain("Look back.");
    expect(seen[0]!.env.NETWORK_DIR).toBe(networkDir);
    const status = await observer.status();
    expect(status).toMatchObject({ running: null, model: "sonnet", digests: { total: 1, uncovered: 0 }, runs: [{ by: "button", exitCode: 0, costUsd: 0.31, reportId: "report-001" }] });
  });

  it("cron: runs when due and there are new closed tasks", async () => {
    const { networkDir } = await closedTask();
    const prompt = join(networkDir, "..", "p.md");
    writeFileSync(prompt, "x");
    let now = new Date(2026, 9, 19, 8, 0).getTime(); // Monday 08:00
    let runs = 0;
    const observer = new Observer({ networkDir, config: { command: ["x", "{prompt}"], promptFile: prompt, cron: "0 9 * * 1" }, now: () => now, run: async () => (runs++, { code: 0 }) });
    await observer.tick();
    expect(runs).toBe(0);
    now = new Date(2026, 9, 19, 9, 0).getTime();
    await observer.tick();
    await observer.idle();
    expect(runs).toBe(1);
  });
});

describe("the observer on the page", () => {
  it("shows reports and proposals; accepting makes a swarm task, rejecting needs a reason", async () => {
    const { root, networkDir } = await closedTask();
    const store = await ObserverStore.open(networkDir);
    const { networkDir: _n, ...r } = run(networkDir);
    await store.saveRun({ ...r, proposals: [r.proposals[0]!, { ...r.proposals[0]!, title: "Fix the hint", target: "agent-network" }, { ...r.proposals[0]!, title: "Nope" }] });
    const prompt = join(root, "p.md");
    writeFileSync(prompt, "x");
    const observer = new Observer({ networkDir, config: { command: ["x", "{prompt}"], promptFile: prompt } });
    const pool = new RunnerPool(networkDir, [{ id: "backend", command: ["x"], autostart: false }, { id: "reviewer", command: ["x"], autostart: false }]);
    const agentNetworkDir = join(root, "an", ".agent-network");
    ui = await startUiServer([{ networkDir, runners: pool, observer }], { port: 0, agentNetworkDir });
    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    const state = (await (await fetch(`${ui.url}/api/observer`)).json()) as any;
    expect(state.reports).toEqual([expect.objectContaining({ id: "report-001", title: "Tasks 001" })]);
    expect(state.proposals.map((p: any) => p.id)).toEqual(["prop-003", "prop-002", "prop-001"]);
    expect(((await (await fetch(`${ui.url}/api/observer/reports/report-001`)).json()) as any).report.markdown).toContain("CLARIFY_FIRST");

    const here = await post("/api/observer/proposals/prop-001/accept", { agents: ["backend", "reviewer"] });
    expect(here).toMatchObject({ status: 201, body: { proposal: { status: "accepted", taskId: "task-002" }, task: { id: "task-002", here: true } } });
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    expect(await operator.tasks.get("task-002")).toMatchObject({ title: "Say clarify first in the lead's first hint", clarify: true, description: expect.stringContaining("Fix: src/mcp/swarm.ts") });

    const there = await post("/api/observer/proposals/prop-002/accept", { agents: ["backend", "reviewer"] });
    expect(there.body.task).toMatchObject({ id: "task-001", here: false });
    expect(await (await NetworkService.create(agentNetworkDir, { id: "operator", type: "cli" })).tasks.get("task-001")).toMatchObject({ title: "Fix the hint", description: expect.stringContaining("agent-network-mcp repository itself") });

    expect(await post("/api/observer/proposals/prop-003/reject", { reason: " " })).toMatchObject({ status: 400 });
    expect(await post("/api/observer/proposals/prop-003/reject", { reason: "duplicate" })).toMatchObject({ status: 200, body: { proposal: { status: "rejected", rejectReason: "duplicate" } } });
  });
});
