import { describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { ProjectStore } from "../../src/project/store.js";
import { ProjectCoordinator } from "../../src/project/coordinator.js";
import { tmpDir } from "../helpers/tmp.js";

describe("Project Coordinator ownership and execution", () => {
  it("has a single owner, does not invoke the model in idle, and recovers orphaned work", async () => {
    const fs = await FileStore.open(await tmpDir());
    const store = new ProjectStore(fs);
    const orphan = await store.enqueue("old", "interrupted request");
    await store.claim("orphan");
    await store.enqueue("new", "new request");
    await store.setPaused(true);
    let calls = 0;
    const first = new ProjectCoordinator(fs, async () => { calls++; return "answer"; }, 5);
    const second = new ProjectCoordinator(fs, async () => { throw new Error("second owner ran"); }, 5);
    try {
      expect(await first.start()).toBe(true);
      expect(await second.start()).toBe(false);
      expect(calls).toBe(0);
      expect((await store.read()).runs.find(r => r.runId === orphan.runId)).toMatchObject({ state: "failed", error: "interrupted" });
      await store.setPaused(false);
      await expect.poll(async () => (await store.read()).runs[1]?.state).toBe("succeeded");
      expect(calls).toBe(1);
      await first.stop();
      expect(await second.start()).toBe(true);
    } finally { await first.stop(); await second.stop(); }
  });

  it("keeps cancelled work running until executor exit and discards late output", async () => {
    const fs = await FileStore.open(await tmpDir());
    const store = new ProjectStore(fs);
    const run = await store.enqueue("one", "first");
    await store.enqueue("two", "second");
    let exit!: () => void;
    let aborted = false;
    const coordinator = new ProjectCoordinator(fs, async ({ signal }) => {
      signal.addEventListener("abort", () => { aborted = true; });
      await new Promise<void>(resolve => { exit = resolve; });
      return "late answer";
    }, 5);
    try {
      await coordinator.start();
      await expect.poll(() => typeof exit).toBe("function");
      await store.cancel(run.runId);
      await expect.poll(() => aborted).toBe(true);
      expect((await store.read()).runs.map(r => r.state)).toEqual(["running", "queued"]);
      exit();
      await expect.poll(async () => (await store.read()).runs[0]?.state).toBe("cancelled");
      const state = await store.read();
      expect(state.paused).toBe(true);
      expect(state.runs[0]!.result).toBeUndefined();
      expect(state.runs[1]!.state).toBe("queued");
    } finally { exit?.(); await coordinator.stop(); }
  });

  it("reconciles a failed run and passes its saved state into a retry without a model process", async () => {
    const fs = await FileStore.open(await tmpDir());
    const store = new ProjectStore(fs);
    const original = await store.enqueue("retry-message", "original request");
    await store.claim("first-owner");
    await store.finish(original.runId, "first-owner", { error: "interrupted after saving a proposal" });
    const retry = await store.retry(original.runId, "retry-run");
    let reconciled = "";
    let received: unknown;
    const coordinator = new ProjectCoordinator(fs, async input => { received = input.retryContext; return "recovered"; }, 5, async id => {
      reconciled = id;
      return { proposals: [{ proposalId: "saved-proposal" }] };
    });
    try {
      expect(await coordinator.start()).toBe(true);
      await expect.poll(async () => (await store.read()).runs.find(run => run.runId === retry.runId)?.state).toBe("succeeded");
      expect(reconciled).toBe(original.runId);
      expect(received).toEqual({ proposals: [{ proposalId: "saved-proposal" }] });
    } finally { await coordinator.stop(); }
  });
});
