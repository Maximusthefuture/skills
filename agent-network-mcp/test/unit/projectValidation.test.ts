import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";
it("validates through the creation rules without creating a task", async () => {
  const service = await NetworkService.create(await tmpDir(), { id: "operator", type: "ui" });
  try {
    const input = { title: "Task", description: "Goal", agents: ["a", "b"] };
    await service.validateTaskAsOperator(input);
    expect(await service.tasks.list()).toEqual([]);
    for (const invalid of [{ ...input, maxFixRounds: 21 }, { ...input, agents: ["a"] }, { ...input, from: ["input.md"] }]) {
      await expect(service.validateTaskAsOperator(invalid)).rejects.toThrow();
      await expect(service.createTaskAsOperator(invalid)).rejects.toThrow();
    }
    expect(await service.tasks.list()).toEqual([]);
  } finally { service.close(); }
});
