import type { FileStore } from "../storage/fileStore.js";
import type { Implementation } from "../types.js";
import { assertAgentId, assertTaskId } from "../validation.js";

export class ImplementationStore {
  constructor(private readonly fs: FileStore) {}

  private dir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "implementations"];
  }

  async find(taskId: string, agentId: string): Promise<Implementation | null> {
    return this.fs.readJson<Implementation>([...this.dir(taskId), `${assertAgentId(agentId)}.json`]);
  }

  async save(impl: Implementation): Promise<void> {
    await this.fs.writeJson([...this.dir(impl.taskId), `${assertAgentId(impl.agentId)}.json`], impl);
  }

  async list(taskId: string): Promise<Implementation[]> {
    const names = await this.fs.listJsonNames(this.dir(taskId));
    const all = await Promise.all(names.map((n) => this.find(taskId, n)));
    return all.filter((i): i is Implementation => i !== null);
  }
}
