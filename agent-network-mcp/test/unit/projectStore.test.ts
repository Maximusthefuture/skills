import { describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { ProjectStore } from "../../src/project/store.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const fs = await FileStore.open(await tmpDir());
  return { fs, store: new ProjectStore(fs) };
}

describe("Project durable queue", () => {
  it("retains identity and deduplicates concurrent deliveries across store instances", async () => {
    const { fs, store } = await setup();
    const other = new ProjectStore(fs);
    const [a, b] = await Promise.all([store.enqueue("m1", "hello"), other.enqueue("m1", "hello")]);
    expect(a.runId).toBe(b.runId);
    expect((await store.read()).projectId).toBe((await other.read()).projectId);
    expect((await store.read()).messages).toHaveLength(1);
    await expect(other.enqueue("m1", "changed")).rejects.toThrow("different text");
  });

  it("allows only one claimant and waits for exit after cancellation", async () => {
    const { fs, store } = await setup();
    const first = await store.enqueue("m1", "one");
    await store.enqueue("m2", "two");
    const claims = await Promise.all([store.claim("a"), new ProjectStore(fs).claim("b")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims.find(Boolean)!.ownerToken!;
    await store.cancel(first.runId);
    expect((await store.read()).runs[0]!.state).toBe("running");
    await store.setPaused(false);
    expect(await store.claim("c")).toBeNull();
    await store.finish(first.runId, owner, { result: "late output" });
    expect((await store.read()).runs[0]).toMatchObject({ state: "cancelled" });
    expect((await store.read()).runs[0]!.result).toBeUndefined();
    expect((await store.claim("c"))!.messageId).toBe("m2");
  });

  it("recovers orphaned runs without losing the persisted pause or queued messages", async () => {
    const { fs, store } = await setup();
    await store.enqueue("m1", "one");
    await store.enqueue("m2", "two");
    await store.claim("dead");
    await store.setPaused(true);
    const reopened = new ProjectStore(fs);
    await reopened.recoverInterrupted();
    expect((await reopened.read()).runs.map(r => r.state)).toEqual(["failed", "queued"]);
    expect((await reopened.read()).runs[0]!.error).toBe("interrupted");
    expect(await reopened.claim("new")).toBeNull();
    await reopened.setPaused(false);
    expect((await reopened.claim("new"))!.messageId).toBe("m2");
  });

  it("replaces queued messages atomically and rejects replacement after claiming", async () => {
    const { store } = await setup();
    const original = await store.enqueue("m1", "one");
    const replacement = await store.replaceQueued(original.runId, "m2", "two");
    expect((await store.replaceQueued(original.runId, "m2", "two")).runId).toBe(replacement.runId);
    expect((await store.read()).messages[1]!.replacesMessageId).toBe("m1");
    await store.claim("owner");
    await expect(store.replaceQueued(replacement.runId, "m3", "three")).rejects.toThrow("refresh");
    expect((await store.read()).messages).toHaveLength(2);
    await expect(store.finish(replacement.runId, "wrong-owner", {})).rejects.toThrow("owned");
  });
});
