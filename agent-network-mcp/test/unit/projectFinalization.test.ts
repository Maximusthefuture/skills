import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { pickTask } from "../../src/pick.js";
import { tmpDir } from "../helpers/tmp.js";
it("recovers a correlated pending input without changing the fixed source set", async () => {
  const dir = await tmpDir();
  const network = join(dir, ".agent-network");
  const operator = await NetworkService.create(network, { id: "operator", type: "ui" });
  const fs = await FileStore.open(network);
  try {
    const source = join(dir, "analysis.md"); await writeFile(source, "Original analysis");
    const origin = { projectId: "p1", operationId: "op1" };
    const task = await operator.tasks.create({ title: "Task", description: "Goal", agents: ["a", "b"], createdBy: "operator", git: null,
      projectOrigin: origin, proposes: "change", proposesInput: ["analysis.md"], projectInput: { state: "pending", expected: ["analysis.md"] } });
    expect(pickTask([task], "a")).toBeNull();
    await expect(operator.finalizeProjectTask(task.id, { ...origin, projectId: "other" }, [source])).rejects.toThrow("mismatch");
    const finalized = await operator.finalizeProjectTask(task.id, origin, [source]);
    expect(finalized.projectInput?.state).toBe("ready");
    expect(finalized.projectInput?.inputSnapshotHash).toHaveLength(64);
    expect(pickTask([finalized], "a")?.id).toBe(task.id);
    await writeFile(source, "Edited later");
    expect((await operator.finalizeProjectTask(task.id, origin, [source])).projectInput).toEqual(finalized.projectInput);
    expect(await fs.readJson(["tasks", task.id, "input-manifest.json"])).toBeTruthy();
  } finally { operator.close(); }
});
