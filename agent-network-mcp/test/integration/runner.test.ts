import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { runRunner, type RunnerOptions } from "../../src/runner.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { AgentStore } from "../../src/stores/agentStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { TaskStore } from "../../src/stores/taskStore.js";
import { tmpDir } from "../helpers/tmp.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "..", "helpers", "fakeAgent.mjs");

interface Launch {
  agent: string;
  networkDir: string;
  taskId: string;
  attempt: number;
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
