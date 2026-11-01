import { expect, it } from "vitest";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
it("attaches once across concurrent requests and refuses detaching open tasks", async () => {
  const fs = await FileStore.open(await tmpDir());
  const store = new ProjectStore(fs);
  const exists = async () => {};
  await Promise.all([store.attach("task-001", "op1", exists), new ProjectStore(fs).attach("task-001", "op2", exists)]);
  expect((await store.read()).tasks).toHaveLength(1);
  await expect(store.attach("task-002", "op1", exists)).rejects.toThrow("another task");
  await expect(store.attach("task-003", "op3", async () => { throw new Error("Task not found"); })).rejects.toThrow("not found");
  for (const status of ["ACTIVE", "BLOCKED"]) await expect(store.detach("task-001", async () => status)).rejects.toThrow("cannot be detached");
  await store.detach("task-001", async () => "COMPLETED");
  expect((await store.read()).tasks).toEqual([]);
});
