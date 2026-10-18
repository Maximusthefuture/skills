import type { FileStore } from "../storage/fileStore.js";
import type { SubtaskList } from "../types.js";
import { assertAgentId, assertTaskId } from "../validation.js";

/**
 * tasks/<task>/subtasks/<agent>.json: one checklist per agent. Its own process writes it, and so do others for a lead
 * (a delegated job adds and ticks its step): every change goes through update(), under the list's own lock.
 */
export class SubtaskStore {
  constructor(private readonly fs: FileStore) {}

  private path(taskId: string, agentId: string): string[] {
    return ["tasks", assertTaskId(taskId), "subtasks", `${assertAgentId(agentId)}.json`];
  }

  async get(taskId: string, agentId: string): Promise<SubtaskList> {
    return (await this.fs.readJson<SubtaskList>(this.path(taskId, agentId))) ?? { taskId, agentId, items: [], nextSeq: 1 };
  }

  /** Read, change and write the list under its lock: no write of another process in between is lost. */
  async update(taskId: string, agentId: string, change: (list: SubtaskList) => SubtaskList | Promise<SubtaskList>): Promise<SubtaskList> {
    return this.fs.withLock(["tasks", assertTaskId(taskId), "subtasks", `.${assertAgentId(agentId)}.lock`], async () => this.save(await change(await this.get(taskId, agentId))));
  }

  async save(list: SubtaskList): Promise<SubtaskList> {
    await this.fs.writeJson(this.path(list.taskId, list.agentId), list);
    return list;
  }
}
