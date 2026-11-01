import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProjectMemory } from "../../src/project/memory.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
describe("Project memory approval", () => {
  it("deduplicates memory proposals by durable operation ID", async () => {
    const fs = await FileStore.open(await tmpDir());
    const memory = new ProjectMemory(fs, "p1");
    const results = await Promise.all([memory.propose("Agreement", hash(""), "op1"), new ProjectMemory(fs, "p1").propose("Agreement", hash(""), "op1")]);
    expect(results[0]!.changeId).toBe(results[1]!.changeId);
    expect((await memory.read()).changes).toHaveLength(1);
    await expect(memory.propose("Changed agreement", hash(""), "op1")).rejects.toThrow("different parameters");
  });
  it("serializes approvals against the same base and retains pending changes", async () => {
    const fs = await FileStore.open(await tmpDir());
    const memory = new ProjectMemory(fs, "p1");
    const a = await memory.propose("first", hash(""));
    const b = await memory.propose("second", hash(""));
    expect((await memory.read()).content).toBe("");
    const results = await Promise.allSettled([memory.decide(a.changeId, true), new ProjectMemory(fs, "p1").decide(b.changeId, true)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const state = await memory.read();
    expect(state.changes.filter(c => c.status === "pending")).toHaveLength(1);
    expect(state.baseHash).toBe(hash(state.content));
  });
  it("recovers a persisted approval intent and deduplicates its confirmation", async () => {
    const fs = await FileStore.open(await tmpDir());
    await fs.writeJson(["project", "p1", "changes.json"], [{ changeId: "c1", content: "approved", baseHash: hash(""), status: "applying" }]);
    const memory = new ProjectMemory(fs, "p1");
    expect((await memory.read()).content).toBe("approved");
    expect((await memory.decide("c1", true)).status).toBe("approved");
    await expect(memory.decide("c1", false)).rejects.toThrow("already decided");
    expect((await new ProjectMemory(fs, "p2").read()).content).toBe("");
    expect(() => memory.propose("x".repeat(16385), hash(""))).toThrow("16 KiB");
  });
});
