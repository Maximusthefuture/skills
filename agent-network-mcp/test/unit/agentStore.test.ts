import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { AgentStore } from "../../src/stores/agentStore.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const fs = await FileStore.open(join(await tmpDir(), ".agent-network"));
  return new AgentStore(fs);
}

describe("AgentStore", () => {
  it("registers an agent as ONLINE", async () => {
    const store = await setup();
    const { agent, created } = await store.register({ id: "backend", type: "qwen", role: "backend" }, { pid: 100 });
    expect(created).toBe(true);
    expect(agent).toMatchObject({ id: "backend", type: "qwen", role: "backend", status: "ONLINE" });
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects a duplicate id owned by another live process", async () => {
    const store = await setup();
    await store.register({ id: "backend", type: "qwen" }, { pid: 100 });
    await expect(store.register({ id: "backend", type: "qwen" }, { pid: 200, isProcessAlive: () => true })).rejects.toMatchObject({
      code: "AGENT_ALREADY_REGISTERED",
    });
  });

  it("allows re-registration after restart (same pid, dead owner, or OFFLINE) and keeps registeredAt", async () => {
    const store = await setup();
    const first = (await store.register({ id: "backend", type: "qwen" }, { pid: 100 })).agent;
    const same = await store.register({ id: "backend", type: "qwen" }, { pid: 100 });
    expect(same.created).toBe(false);
    await store.register({ id: "backend", type: "qwen" }, { pid: 200, isProcessAlive: () => false });
    await store.setStatus("backend", "OFFLINE");
    const back = await store.register({ id: "backend", type: "qwen" }, { pid: 300, isProcessAlive: () => true });
    expect(back.agent.registeredAt).toBe(first.registeredAt);
    expect(back.agent.status).toBe("ONLINE");
  });

  it("heartbeat updates lastSeenAt and status", async () => {
    const store = await setup();
    await store.register({ id: "backend", type: "qwen" }, { now: () => new Date("2026-01-01T00:00:00Z"), pid: 1 });
    const hb = await store.heartbeat("backend", "WORKING", () => new Date("2026-01-01T00:05:00Z"));
    expect(hb.lastSeenAt).toBe("2026-01-01T00:05:00.000Z");
    expect(hb.status).toBe("WORKING");
  });

  it("requires registration", async () => {
    const store = await setup();
    await expect(store.require("ghost")).rejects.toMatchObject({ code: "AGENT_NOT_REGISTERED" });
    await expect(store.heartbeat("ghost")).rejects.toMatchObject({ code: "AGENT_NOT_REGISTERED" });
  });

  it("rejects ids that could escape the directory", async () => {
    const store = await setup();
    for (const id of ["../x", "a/b", "", "/etc/passwd", "a b"]) {
      await expect(store.register({ id, type: "qwen" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("never deletes offline agents", async () => {
    const store = await setup();
    await store.register({ id: "backend", type: "qwen" }, { pid: 1 });
    await store.setStatus("backend", "OFFLINE");
    expect((await store.list())[0]?.status).toBe("OFFLINE");
  });
});

describe("AgentStore.claim (identity pool)", () => {
  const live = { isProcessAlive: () => true };

  it("takes the first free identity, skipping ones held by live processes", async () => {
    const store = await setup();
    expect((await store.claim(["backend", "reviewer"], { type: "qwen" }, { pid: 100, ...live })).agent.id).toBe("backend");
    expect((await store.claim(["backend", "reviewer"], { type: "qwen" }, { pid: 200, ...live })).agent.id).toBe("reviewer");
    await expect(store.claim(["backend", "reviewer"], { type: "qwen" }, { pid: 300, ...live })).rejects.toMatchObject({ code: "AGENT_ALREADY_REGISTERED" });
  });

  it("takes over an identity whose process died or went OFFLINE", async () => {
    const store = await setup();
    await store.claim(["backend", "reviewer"], { type: "qwen" }, { pid: 100, ...live });
    expect((await store.claim(["backend", "reviewer"], { type: "qwen" }, { pid: 200, isProcessAlive: () => false })).agent.id).toBe("backend");
    await store.setStatus("backend", "OFFLINE");
    expect((await store.claim(["backend", "reviewer"], { type: "qwen" }, { pid: 300, ...live })).agent.id).toBe("backend");
  });

  it("simultaneous claims from several processes get distinct identities", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const stores = await Promise.all(Array.from({ length: 4 }, async () => new AgentStore(await FileStore.open(dir))));
    const results = await Promise.allSettled(stores.map((s, i) => s.claim(["a", "b", "c"], { type: "qwen" }, { pid: 1000 + i, ...live })));
    const ids = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ agent: { id: string } }>).value.agent.id);
    expect(ids.sort()).toEqual(["a", "b", "c"]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects malformed identities", async () => {
    const store = await setup();
    await expect(store.claim(["ok", "../x"], { type: "qwen" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
