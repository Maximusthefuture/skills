import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { TaskStore } from "../../src/stores/taskStore.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const fs = await FileStore.open(join(await tmpDir(), ".agent-network"));
  return { fs, store: new TaskStore(fs) };
}
const input = { title: "T", description: "D", agents: ["a", "b"], createdBy: "a", git: null };

describe("TaskStore", () => {
  it("creates tasks in DISCUSS/ACTIVE with sequential ids", async () => {
    const { store } = await setup();
    const t1 = await store.create(input);
    const t2 = await store.create(input);
    expect([t1.id, t2.id]).toEqual(["task-001", "task-002"]);
    expect(t1).toMatchObject({ phase: "DISCUSS", status: "ACTIVE", syncRound: 0 });
    expect(await store.get("task-001")).toEqual(t1);
  });

  it("allocates unique ids for concurrent creates", async () => {
    const { store } = await setup();
    const tasks = await Promise.all(Array.from({ length: 15 }, () => store.create(input)));
    expect(new Set(tasks.map((t) => t.id)).size).toBe(15);
  });

  it("TASK_NOT_FOUND for unknown id; INVALID_INPUT for malformed id", async () => {
    const { store } = await setup();
    await expect(store.get("task-999")).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    for (const id of ["../task-001", "task-1/../..", "task-001/x", "TASK-001", ""]) {
      await expect(store.get(id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("skips a task directory that has no task.json yet", async () => {
    const { fs, store } = await setup();
    await store.create(input);
    await mkdir(fs.resolve(["tasks", "task-002"]));
    expect((await store.list()).map((t) => t.id)).toEqual(["task-001"]);
  });

  it("filters tasks by agent", async () => {
    const { store } = await setup();
    await store.create(input);
    await store.create({ ...input, agents: ["x", "y"] });
    expect((await store.listForAgent("a")).map((t) => t.id)).toEqual(["task-001"]);
  });

  it("save bumps updatedAt", async () => {
    const { store } = await setup();
    const t = await store.create(input);
    await new Promise((r) => setTimeout(r, 5));
    const saved = await store.save({ ...t, phase: "IMPLEMENT" });
    expect(saved.updatedAt > t.updatedAt).toBe(true);
    expect((await store.get(t.id)).phase).toBe("IMPLEMENT");
  });
});
