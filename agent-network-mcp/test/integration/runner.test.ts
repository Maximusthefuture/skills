import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { runRunner, type RunnerOptions } from "../../src/runner.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { AgentStore } from "../../src/stores/agentStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { SessionStore } from "../../src/stores/sessionStore.js";
import { TaskStore } from "../../src/stores/taskStore.js";
import { tmpDir } from "../helpers/tmp.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "..", "helpers", "fakeAgent.mjs");

interface Launch {
  agent: string;
  networkDir: string;
  taskId: string;
  attempt: number;
  fresh: string | null;
  args: string[];
}

async function setup() {
  const dir = await tmpDir();
  const networkDir = join(dir, ".agent-network");
  const fs = await FileStore.open(networkDir);
  const log = join(dir, "launches.jsonl");
  const launches = (): Launch[] => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Launch) : []);
  const tasks = new TaskStore(fs);
  const newTask = (title: string) => tasks.create({ title, description: "d", agents: ["backend", "reviewer"], createdBy: "operator", git: null });
  return { networkDir, log, launches, tasks, newTask, agents: new AgentStore(fs), messages: new MessageStore(fs) };
}

async function until(cond: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(networkDir: string, command: string[], extra: Partial<RunnerOptions> = {}) {
  const controller = new AbortController();
  const lines: string[] = [];
  const done = runRunner({ agent: "backend", networkDir, command, pollMs: 15, restartDelayMs: 10, stdio: "ignore", signal: controller.signal, log: (l) => lines.push(l), ...extra });
  return { lines, done, stop: async () => (controller.abort(), done) };
}

describe("agent runner", () => {
  it("starts a fresh session for every task and waits in between", async () => {
    const s = await setup();
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "1", "{prompt}"]);
    await pause(60);
    expect(s.launches()).toHaveLength(0); // no task, no LLM

    const t1 = await s.newTask("Cancel orders");
    await until(async () => (await s.tasks.get(t1.id)).status === "COMPLETED", "task-001 done");
    const t2 = await s.newTask("Archive orders");
    await until(async () => (await s.tasks.get(t2.id)).status === "COMPLETED", "task-002 done");
    await pause(60);
    expect(await r.stop()).toBe(0);

    const runs = s.launches();
    expect(runs.map((l) => [l.taskId, l.attempt])).toEqual([[t1.id, 1], [t2.id, 1]]);
    expect(runs[0]!.agent).toBe("backend");
    expect(runs[0]!.networkDir).toBe(s.networkDir);
    expect(runs[1]!.args[0]).toContain(`Task ${t2.id} ("Archive orders") is assigned to you`);
    expect(runs[1]!.args[0]).not.toContain("previous one ended");
  });

  it("a handoff at a fresh phase starts the fresh session at once and is not a failed attempt", async () => {
    const s = await setup();
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "handoff:2", "{prompt}"], { maxRestarts: 0, freshPhases: ["SYNC"], restartDelayMs: 60_000 });
    const t = await s.newTask("Review with fresh eyes");
    await until(async () => (await s.tasks.get(t.id)).status === "COMPLETED", "task done");
    expect(await r.stop()).toBe(0);
    const runs = s.launches();
    expect(runs.map((l) => [l.attempt, l.fresh])).toEqual([[1, "SYNC"], [2, "SYNC"]]);
    expect(runs[1]!.args[0]).toContain("This is a fresh session for phase SYNC");
    expect(runs[1]!.args[0]).not.toContain("previous one ended");
    expect(r.lines).toContain(`${t.id}: handoff to a fresh session for SYNC (session exit 0)`);
  });

  it("an early exit after a handoff still counts; without freshPhases the same exit is a plain failure", async () => {
    const s = await setup();
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "handoff:0"], { maxRestarts: 0, freshPhases: ["SYNC"] });
    await s.newTask("The fresh session crashes");
    await until(() => r.lines.some((l) => l.includes("giving up until the task changes")), "give up");
    await pause(80);
    expect(s.launches().map((l) => l.attempt)).toEqual([1, 2]);
    await r.stop();

    const plain = await setup();
    const p = start(plain.networkDir, [process.execPath, FAKE, plain.log, "handoff:0"], { maxRestarts: 0 });
    await plain.newTask("No fresh phases");
    await until(() => p.lines.some((l) => l.includes("giving up until the task changes")), "give up");
    expect(plain.launches().map((l) => [l.attempt, l.fresh])).toEqual([[1, null]]);
    await p.stop();
  });

  it("restarts an unfinished task with a resume note, gives up after the limit and retries when the task changes", async () => {
    const s = await setup();
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "0"], { maxRestarts: 1 });
    const t = await s.newTask("Never finishes");
    await until(() => r.lines.some((l) => l.includes("giving up until the task changes")), "give up");
    await pause(80);
    expect(s.launches().map((l) => l.attempt)).toEqual([1, 2]); // first session + one restart, then quiet
    expect(s.launches()[1]!.args[0]).toContain("This is session 2 for this task");

    await s.messages.create({ taskId: t.id, from: "reviewer", to: "backend", type: "QUESTION", content: "still there?" });
    await until(() => s.launches().length === 3, "retry after a new message");
    expect(s.launches()[2]!.attempt).toBe(1);
    await r.stop();
  });

  it("waits while the task is BLOCKED or another live process holds the agent id", async () => {
    const s = await setup();
    const t = await s.newTask("Blocked");
    await s.tasks.save({ ...t, status: "BLOCKED", blockedReason: "fix-round limit" });
    await s.agents.register({ id: "backend", type: "claude" }, { pid: process.pid }); // e.g. an interactive session
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "1"]);
    await pause(80);
    expect(r.lines.some((l) => l.includes("is BLOCKED"))).toBe(true);

    await s.tasks.save({ ...(await s.tasks.get(t.id)), status: "ACTIVE" }); // operator: task unblock
    await pause(80);
    expect(r.lines.some((l) => l.includes(`held by a live process (pid ${process.pid})`))).toBe(true);
    expect(s.launches()).toHaveLength(0);

    await s.agents.setStatus("backend", "OFFLINE"); // the session ended
    await until(() => s.launches().length === 1, "session after the id is free");
    await r.stop();
  });

  it("names the tasks a session finished on its own (e.g. a follow-up) and starts no session for them", async () => {
    const s = await setup();
    const t1 = await s.newTask("Parent");
    const t2 = await s.newTask("Follow-up");
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "all"]);
    await until(() => r.lines.some((l) => l.includes(`${t1.id}: COMPLETED`)), "parent done");
    await pause(60);
    await r.stop();
    expect(r.lines).toContain(`${t1.id}: COMPLETED; in the same session also ${t2.id} COMPLETED (session exit 0)`);
    expect(s.launches().map((l) => l.taskId)).toEqual([t1.id]);
  });

  it("appends the agent's instructions file to the prompt and reads it again before every session", async () => {
    const s = await setup();
    const file = join(dirname(s.log), "backend.md");
    writeFileSync(file, "You are the backend. Work on {taskId} in src/main only.");
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "2", "{prompt}"], { instructionsFile: file, restartDelayMs: 300 });
    const t = await s.newTask("Instructions");
    await until(() => s.launches().length === 1, "first session");
    writeFileSync(file, "Second version: tests first.");
    await until(async () => (await s.tasks.get(t.id)).status === "COMPLETED", "done on the second session");
    await r.stop();
    const [first, second] = s.launches().map((l) => l.args[0]!);
    expect(first).toContain(`Instructions from the operator for you (backend):\nYou are the backend. Work on ${t.id} in src/main only.`);
    expect(first).toContain("call swarm_context first"); // the standard prompt stays
    expect(second).toContain("Second version: tests first.");
  });

  it("puts the system prompt file where the command has {systemPrompt}, with the placeholders filled", async () => {
    const s = await setup();
    const file = join(dirname(s.log), "system.md");
    writeFileSync(file, "You are {agent}, a headless swarm agent.");
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "1", "{prompt}", "--system-prompt", "{systemPrompt}"], { systemPromptFile: file });
    await s.newTask("System prompt");
    await until(() => s.launches().length === 1, "session");
    await r.stop();
    expect(s.launches()[0]!.args.slice(1)).toEqual(["--system-prompt", "You are backend, a headless swarm agent."]);
  });

  it("puts the model where the command has {model} and asks for it before every session", async () => {
    const s = await setup();
    let model = "small/model";
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "2", "{prompt}", "-m", "{model}"], { model: () => model, restartDelayMs: 300 });
    const t = await s.newTask("Model");
    await until(() => s.launches().length === 1, "first session");
    model = "big/model"; // chosen on the page while the first session runs
    await until(async () => (await s.tasks.get(t.id)).status === "COMPLETED", "done on the second session");
    await r.stop();
    expect(s.launches().map((l) => l.args.slice(1))).toEqual([["-m", "small/model"], ["-m", "big/model"]]);
    expect(r.lines).toContain(`${t.id}: starting session 1 (phase DISCUSS, model small/model)`);
    expect((await new SessionStore(await FileStore.open(s.networkDir)).list(t.id)).map((x) => x.model)).toEqual(["small/model", "big/model"]);
  });

  it("does not start a session while the command has {model} and no model is set", async () => {
    const s = await setup();
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "1", "{prompt}", "-m", "{model}"], { model: () => undefined });
    await s.newTask("No model");
    await until(() => r.lines.some((l) => l.includes("no model is set")), "the runner says why it waits");
    await r.stop();
    expect(s.launches()).toHaveLength(0);
  });

  it("goes on without an unreadable instructions file and says so", async () => {
    const s = await setup();
    const r = start(s.networkDir, [process.execPath, FAKE, s.log, "1", "{prompt}"], { instructionsFile: join(dirname(s.log), "missing.md") });
    await s.newTask("No file");
    await until(() => s.launches().length === 1, "session without instructions");
    await r.stop();
    expect(r.lines.some((l) => l.includes("cannot read the instructions file") && l.includes("ENOENT"))).toBe(true);
    expect(s.launches()[0]!.args[0]).not.toContain("Instructions from the operator");
  });

  it("records every session with its tokens and shows the stream as a readable log", async () => {
    const s = await setup();
    const out: string[] = [];
    const r = start(s.networkDir, [process.execPath, join(dirname(FAKE), "streamAgent.mjs")], { output: (t) => out.push(t) });
    const t = await s.newTask("Tokens");
    await until(async () => (await s.tasks.get(t.id)).status === "COMPLETED", "done");
    await until(() => r.lines.some((l) => l.includes("120 tokens")), "the session line");
    await r.stop();
    expect(out.join("")).toBe(`[session] model fake-model\nWorking on ${t.id}\n[result] done · tokens 120 (in 100, out 20)\n`);
    const sessions = await new SessionStore(await FileStore.open(s.networkDir)).list(t.id);
    expect(sessions).toEqual([expect.objectContaining({ agentId: "backend", attempt: 1, exitCode: 0, costUsd: 0.5, numTurns: 2, model: "fake-model", usage: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0, total: 120 } })]);
    expect(sessions[0]!.durationMs).toBeGreaterThanOrEqual(0);

    const lines: string[] = [];
    expect(await runCli(["task", "stats", "--network-dir", s.networkDir, "--id", t.id], {}, (l) => lines.push(l))).toBe(0);
    const [stat] = JSON.parse(lines[0]!);
    expect(stat).toMatchObject({ id: t.id, stats: { sessions: 1, usage: { total: 120 }, costUsd: 0.5, agents: [expect.objectContaining({ agentId: "backend", sessions: 1 })] } });
    expect(stat.stats.phases[0].phase).toBe("DISCUSS");
  });

  it("stops the running session on abort", async () => {
    const s = await setup();
    await s.newTask("Long");
    const r = start(s.networkDir, [process.execPath, "-e", "setTimeout(() => {}, 60000)"]);
    await until(() => r.lines.some((l) => l.includes("starting session 1")), "session start");
    const t0 = Date.now();
    expect(await r.stop()).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("CLI run --once finishes one task and exits; bad arguments are rejected", async () => {
    const s = await setup();
    const t = await s.newTask("Once");
    const out: string[] = [];
    const code = await runCli(["run", "--agent", "backend", "--network-dir", s.networkDir, "--once", "--poll-ms", "15", "--", process.execPath, FAKE, s.log, "1", "{prompt}"], {}, (l) => out.push(l));
    expect(code).toBe(0);
    expect((await s.tasks.get(t.id)).status).toBe("COMPLETED");
    expect(s.launches()).toHaveLength(1);

    expect(await runCli(["run", "--agent", "backend", "--network-dir", s.networkDir], {}, (l) => out.push(l))).toBe(2);
    expect(await runCli(["run", "--network-dir", s.networkDir, "--", "x"], {}, (l) => out.push(l))).toBe(2);
    expect(await runCli(["run", "--agent", "b", "--network-dir", s.networkDir, "--poll-ms", "1", "--", "x"], {}, (l) => out.push(l))).toBe(1);
  });
});
