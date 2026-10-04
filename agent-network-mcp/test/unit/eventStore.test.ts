import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { EventStore, GLOBAL_SCOPE } from "../../src/stores/eventStore.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const root = join(await tmpDir(), ".agent-network");
  return { root, store: new EventStore(await FileStore.open(root)) };
}

describe("EventStore", () => {
  it("writes per-event files under the task and lists after a sequence number", async () => {
    const { store } = await setup();
    const e1 = await store.create({ type: "MESSAGE_CREATED", taskId: "task-001", targetAgent: "reviewer", payload: { messageId: "msg-001" } });
    await store.create({ type: "PHASE_CHANGED", taskId: "task-001" });
    expect(e1).toMatchObject({ id: "event-001", targetAgent: "reviewer" });
    expect((await store.list("task-001")).map((e) => e.event.id)).toEqual(["event-001", "event-002"]);
    expect((await store.list("task-001", 1)).map((e) => e.event.id)).toEqual(["event-002"]);
  });

  it("stores broadcast as targetAgent null and keeps agent-wide events in a global scope", async () => {
    const { store } = await setup();
    const e = await store.create({ type: "AGENT_REGISTERED", payload: { agentId: "a" } });
    expect(e.targetAgent).toBeNull();
    expect((await store.list(GLOBAL_SCOPE)).map((x) => x.event.id)).toEqual(["event-001"]);
  });

  it("concurrent event creation keeps every event", async () => {
    const { root } = await setup();
    const stores = await Promise.all(Array.from({ length: 3 }, async () => new EventStore(await FileStore.open(root))));
    await Promise.all(Array.from({ length: 30 }, (_, i) => stores[i % 3]!.create({ type: "MESSAGE_CREATED", taskId: "task-001", payload: { i } })));
    const all = await stores[0]!.list("task-001");
    expect(all.map((e) => e.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("keeps cursors per agent and only moves them forward", async () => {
    const { store } = await setup();
    await store.setCursor("backend", "task-001", 5);
    await store.setCursor("backend", "task-001", 3);
    await store.setCursor("backend", GLOBAL_SCOPE, 2);
    expect(await store.getCursors("backend")).toEqual({ "task-001": 5, [GLOBAL_SCOPE]: 2 });
    expect(await store.getCursors("reviewer")).toEqual({});
  });
});
