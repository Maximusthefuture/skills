import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { projectTaskContextPage } from "../../src/project/taskContext.js";
import { tmpDir } from "../helpers/tmp.js";

it("returns bounded, paginated task context with the operator's answer", async () => {
  const dir = await tmpDir(), fs = await FileStore.open(dir);
  const service = await NetworkService.create(dir, { id: "operator", type: "ui" });
  try {
    const task = await service.createTaskAsOperator({ title: "Task", description: "Goal", agents: ["a", "b"] });
    const messages = new MessageStore(fs);
    const question = await messages.create({ taskId: task.id, from: "a", to: "operator", type: "QUESTION", content: "What should happen?" });
    await messages.create({ taskId: task.id, from: "operator", to: "a", type: "INFORMATION", content: "Use the existing behavior.", replyTo: question.id });
    for (let n = 0; n < 25; n++) await messages.create({ taskId: task.id, from: "a", to: "operator", type: "QUESTION", content: `Question ${n}` });

    const first = await projectTaskContextPage(fs, task.id, 0);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(16384);
    expect(first.items[0]).toMatchObject({ kind: "question", question: "What should happen?", answer: "Use the existing behavior." });
    expect(first.nextCursor).toBe(20);
    const second = await projectTaskContextPage(fs, task.id, first.nextCursor!);
    expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThanOrEqual(16384);
    expect(second.items.length).toBe(6);
    expect(second.nextCursor).toBeNull();
    await expect(projectTaskContextPage(fs, task.id, -1)).rejects.toThrow("cursor");
  } finally { service.close(); }
});
