import type { FileStore } from "../storage/fileStore.js";
import type { SubtaskList } from "../types.js";
import { assertAgentId, assertTaskId } from "../validation.js";

/** tasks/<task>/subtasks/<agent>.json: one checklist per agent, written only by that agent's process. */
export class SubtaskStore {
  constructor(private readonly fs: FileStore) {}

  private path(taskId: string, agentId: string): string[] {
    return ["tasks", assertTaskId(taskId), "subtasks", `${assertAgentId(agentId)}.json`];
  }

  async get(taskId: string, agentId: string): Promise<SubtaskList> {
    return (await this.fs.readJson<SubtaskList>(this.path(taskId, agentId))) ?? { taskId, agentId, items: [], nextSeq: 1 };
  }

  async save(list: SubtaskList): Promise<SubtaskList> {
    await this.fs.writeJson(this.path(list.taskId, list.agentId), list);
    return list;
  }
}
