import { expect, it } from "vitest";
import { pickTask } from "../../src/pick.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";
it("skips pending project input without blocking other tasks", async () => {
  const service = await NetworkService.create(await tmpDir(), { id: "operator", type: "ui" });
  try {
    const input = { title: "Task", description: "Goal", agents: ["a", "b"] };
    const first = await service.createTaskAsOperator(input);
    const second = await service.createTaskAsOperator(input);
    const pending = { ...first, projectInput: { state: "pending" as const, expected: ["input.md"] } };
    expect(pickTask([pending, second], "a")?.id).toBe(second.id);
    expect(pickTask([{ ...pending, projectInput: { ...pending.projectInput, state: "ready", inputSnapshotHash: "hash" } }, second], "a")?.id).toBe(first.id);
  } finally { service.close(); }
});
