import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const root = join(await tmpDir(), ".agent-network");
  return { root, store: new MessageStore(await FileStore.open(root)) };
}
const base = { taskId: "task-001", from: "backend", to: "reviewer", type: "QUESTION" as const, content: "hi" };

describe("MessageStore", () => {
  it("stores one file per message with sequential ids", async () => {
    const { store } = await setup();
    const m1 = await store.create(base);
    const m2 = await store.create({ ...base, content: "second" });
    expect([m1.id, m2.id]).toEqual(["msg-001", "msg-002"]);
    expect((await store.get("task-001", "msg-002")).content).toBe("second");
  });

  it("concurrent creation from several processes loses nothing", async () => {
    const { root } = await setup();
    const stores = await Promise.all(Array.from({ length: 4 }, async () => new MessageStore(await FileStore.open(root))));
    await Promise.all(Array.from({ length: 40 }, (_, i) => stores[i % 4]!.create({ ...base, content: `m${i}` })));
    const all = await stores[0]!.list("task-001");
    expect(all).toHaveLength(40);
    expect(new Set(all.map((m) => m.id)).size).toBe(40);
    expect(new Set(all.map((m) => m.content)).size).toBe(40);
  });

  it("markRead sets readAt once", async () => {
    const { store } = await setup();
    const m = await store.create(base);
    const read = await store.markRead(m);
    expect(read.readAt).toBeDefined();
    expect((await store.markRead(read)).readAt).toBe(read.readAt);
    expect(await store.list("task-001", { unreadOnly: true })).toHaveLength(0);
  });

  it("filters by recipient / sender / unread", async () => {
    const { store } = await setup();
    await store.create(base);
    await store.create({ ...base, from: "reviewer", to: "backend" });
    expect(await store.list("task-001", { to: "reviewer" })).toHaveLength(1);
    expect(await store.list("task-001", { from: "reviewer" })).toHaveLength(1);
    expect(await store.list("task-001", { unreadOnly: true })).toHaveLength(2);
  });

  it("MESSAGE_NOT_FOUND and id validation", async () => {
    const { store } = await setup();
    await expect(store.get("task-001", "msg-404")).rejects.toMatchObject({ code: "MESSAGE_NOT_FOUND" });
    await expect(store.get("task-001", "../agreement")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(store.get("../x", "msg-001")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
