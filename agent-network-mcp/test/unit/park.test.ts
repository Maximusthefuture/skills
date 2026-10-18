import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { isParked, writeParkMarker } from "../../src/park.js";
import { runRunner } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { TaskStore } from "../../src/stores/taskStore.js";
import { tmpDir } from "../helpers/tmp.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "..", "helpers", "fakeAgent.mjs");

/** A task in IMPLEMENT: backend builds, reviewer only reviews (files: []). */
async function implementing(opts: { underRunner: boolean; operatorTimeoutMs?: number }) {
  const networkDir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const swarm = async (id: string, o: { underRunner?: boolean; operatorTimeoutMs?: number } = {}) =>
    new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }), undefined, o);
  const backend = await swarm("backend");
  const reviewer = await swarm("reviewer", opts);
  const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] });
  await backend.propose({ summary: "s", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "reviewer", responsibility: "review", files: [] }] });
  await backend.context();
  await backend.complete({});
  await reviewer.context();
  await reviewer.complete({});
  await reviewer.complete({ result: "review only: nothing to change" }); // its part is ready: it waits for the backend
  return { networkDir, operator, backend, reviewer, task, fs: await FileStore.open(networkDir) };
}

describe("parking a runner's waiting session", () => {
  it("a session with nothing to do but wait ends instead of calling wait(); the marker holds until something changes for it", async () => {
    const { reviewer, backend, task, fs, operator } = await implementing({ underRunner: true });
    const ctx = await reviewer.context();
    expect(ctx).toMatchObject({ nextAction: "done", parked: true, waitingOn: ["backend"], allowedActions: [] });
    expect(String(ctx.hint)).toContain("waits without a model");
    // the same from wait(), where a session usually is when it has nothing to do
    expect(await reviewer.wait({ timeoutMs: 1000 })).toMatchObject({ status: "DONE", nextAction: "done", parked: true });
    expect(await isParked(fs, "reviewer", await operator.tasks.get(task.id))).toBe(true);
    // the backend's own builds or steps change nothing for the reviewer... its report and the phase change do
    await backend.complete({ result: "api", filesChanged: ["src/A.java"] });
    expect((await operator.tasks.get(task.id)).phase).toBe("SYNC");
    expect(await isParked(fs, "reviewer", await operator.tasks.get(task.id))).toBe(false);
    expect((await reviewer.context()).nextAction).toBe("sync");
  });

  it("not outside a runner, not with an unread message, not while its own question to the operator runs against the clock", async () => {
    const free = await implementing({ underRunner: false });
    expect((await free.reviewer.context()).nextAction).toBe("wait");

    const asking = await implementing({ underRunner: true });
    await asking.reviewer.sendMessage({ to: "operator", message: "Should the review cover the migration?", options: [{ label: "Yes" }, { label: "No" }], recommended: "Yes" });
    expect((await asking.reviewer.context()).nextAction).toBe("wait");

    const told = await implementing({ underRunner: true });
    await told.backend.sendMessage({ to: "reviewer", message: "heads-up: the endpoint moved to /v2" });
    expect((await told.reviewer.context()).nextAction).not.toBe("done");
  });
});

describe("the runner and a parked agent", () => {
  it("starts no session while the agent is parked; the first change for it starts a fresh one", async () => {
    const dir = await tmpDir();
    const networkDir = join(dir, ".agent-network");
    const fs = await FileStore.open(networkDir);
    const tasks = new TaskStore(fs);
    const task = await tasks.create({ title: "t", description: "d", agents: ["backend", "reviewer"], createdBy: "operator", git: null });
    await writeParkMarker(fs, "backend", task);
    const log = join(dir, "launches.jsonl");
    const launches = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0);
    const controller = new AbortController();
    const lines: string[] = [];
    const done = runRunner({ agent: "backend", networkDir, command: [process.execPath, FAKE, log, "1", "{prompt}"], pollMs: 15, restartDelayMs: 10, stdio: "ignore", signal: controller.signal, log: (l) => lines.push(l), cwd: dir });
    await new Promise((r) => setTimeout(r, 300));
    expect(launches()).toBe(0);
    expect(lines.some((l) => l.includes("parked in DISCUSS, waiting without a model"))).toBe(true);
    // a block and its unblock change nothing for it: still parked
    await tasks.save({ ...task, status: "BLOCKED" });
    await tasks.save({ ...(await tasks.get(task.id)), status: "ACTIVE" });
    expect(await isParked(fs, "backend", await tasks.get(task.id))).toBe(true);
    // a message to it does
    await new MessageStore(fs).create({ taskId: task.id, from: "reviewer", to: "backend", type: "INFORMATION", content: "the endpoint moved" });
    const end = Date.now() + 5000;
    while (launches() === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(launches()).toBe(1);
    controller.abort();
    await done;
  });
});
