import { expect, it } from "vitest";
import { projectSnapshot } from "../../src/project/snapshot.js";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";

it("bounds escaped Unicode context, keeps source messages, and excludes unrelated tasks", async () => {
  const store = new ProjectStore(await FileStore.open(await tmpDir()));
  const large = "😀\n\"\\".repeat(20000);
  await store.enqueue("long-message", large);
  const state = await store.read();
  state.tasks.push({ taskId: "linked", operationId: "attach", origin: "attached" });
  const snapshot = projectSnapshot(state, {
    goal: large, memory: large,
    tasks: ["linked", "unrelated"].map(taskId => ({ taskId, title: "Task", status: "ACTIVE", waitingForUser: true, href: "#/tasks/" + taskId })),
    proposals: Array.from({ length: 30 }, (_, i) => ({ proposalId: String(i), status: "pending", summary: large })),
  });
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(65536);
  expect(Buffer.byteLength(JSON.stringify(snapshot.messages))).toBeLessThanOrEqual(8192);
  expect(snapshot.tasks.map(t => t.taskId)).toEqual(["linked"]);
  expect(snapshot.truncated).toMatchObject({ goal: true, memory: true, messages: true, proposals: true });
  expect(snapshot.messages[0]!.content).not.toContain("\ufffd");
  expect((await store.read()).messages[0]!.content).toBe(large);
});
