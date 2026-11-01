import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { ProjectStore } from "../../src/project/store.js";
import { ProjectCommandService } from "../../src/project/commands.js";
import { tmpDir } from "../helpers/tmp.js";
it("delivers only to linked open tasks and deduplicates exact confirmed text", async () => {
  const dir = await tmpDir(); const fs = await FileStore.open(dir);
  const operator = await NetworkService.create(dir, { id: "operator", type: "ui" });
  try {
    const task = await operator.createTaskAsOperator({ title: "Task", description: "Goal", agents: ["a", "b"] });
    const commands = new ProjectCommandService(fs, operator);
    const input = { taskId: task.id, content: "Please check", operationId: "op1" };
    await expect(commands.sendToTask(input)).rejects.toThrow("not linked");
    await new ProjectStore(fs).attach(task.id, "attach", async () => {});
    const sent = await commands.sendToTask(input);
    expect((await commands.sendToTask(input)).id).toBe(sent.id);
    expect(await operator.messages.list(task.id)).toHaveLength(1);
    await expect(commands.sendToTask({ ...input, content: "different" })).rejects.toThrow("different parameters");
    await operator.tasks.save({ ...task, status: "COMPLETED" });
    await expect(commands.sendToTask({ ...input, operationId: "op2" })).rejects.toThrow("Closed tasks");
  } finally { operator.close(); }
});
