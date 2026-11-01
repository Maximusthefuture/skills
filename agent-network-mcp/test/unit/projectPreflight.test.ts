import { expect, it } from "vitest";
import { projectPreflight, type PreflightDependencies } from "../../src/project/preflight.js";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";
it("counts BLOCKED linked tasks and checks OpenSpec folders before validation", async () => {
  const dir = await tmpDir(), fs = await FileStore.open(dir);
  const service = await NetworkService.create(dir, { id: "operator", type: "ui" });
  try {
    const task = await service.createTaskAsOperator({ title: "Old", description: "Goal", agents: ["a", "b"] });
    const store = new ProjectStore(fs);
    await store.attach(task.id, "attach", async () => {});
    const state = await store.read(); state.maxOpenTasks = 1;
    const visited: string[] = [];
    const deps: PreflightDependencies = { tasks: [{ ...task, status: "BLOCKED" }], availableAgents: ["a", "b"],
      checkAgentFolders: async () => { visited.push("folders"); }, verifyParentBase: async () => {},
      checkSharedFolder: async () => {}, validateTask: async () => { visited.push("validate"); } };
    const payload = { title: "New", description: "Goal", agents: ["a", "b"], openspec: "existing" };
    await expect(projectPreflight(state, payload, deps)).rejects.toThrow("maxOpenTasks");
    state.maxOpenTasks = 2;
    await projectPreflight(state, payload, deps);
    expect(visited).toEqual(["folders", "validate"]);
    await expect(projectPreflight(state, { ...payload, agents: ["a", "unknown"] }, deps)).rejects.toThrow("unavailable");
    await expect(projectPreflight(state, { ...payload, parentTaskId: task.id }, deps)).rejects.toThrow("still open");
  } finally { service.close(); }
});
