import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { correlatedRecord } from "../../src/project/correlation.js";
import { tmpDir } from "../helpers/tmp.js";
it("persists creation correlation in the original task record and recovers by exact marker", async () => {
  const service = await NetworkService.create(await tmpDir(), { id: "operator", type: "ui" });
  try {
    const input = { title: "Same title", description: "Same description", agents: ["a", "b"] };
    await service.createTaskAsOperator(input);
    const marker = { projectId: "project-one", operationId: "operation-one" };
    const created = await service.createTaskAsOperator(input, marker);
    const tasks = await service.tasks.list();
    expect(correlatedRecord(tasks, marker.projectId, marker.operationId)?.id).toBe(created.id);
    expect(correlatedRecord(tasks, "other-project", marker.operationId)).toBeNull();
    expect(() => correlatedRecord([created, created], marker.projectId, marker.operationId)).toThrow("Ambiguous");
    expect((await service.tasks.get(created.id)).projectOrigin).toEqual(marker);
  } finally { service.close(); }
});
