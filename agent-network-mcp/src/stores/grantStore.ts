import type { FileStore } from "../storage/fileStore.js";
import type { Grant } from "../types.js";
import { assertTaskId } from "../validation.js";

/** An owner lets another agent change some of its files: tasks/<task>/grants/grant-NNN.json. */
export class GrantStore {
  constructor(private readonly fs: FileStore) {}

  private dir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "grants"];
  }

  async create(input: { taskId: string; from: string; to: string; files: string[] }): Promise<Grant> {
    return this.fs.createNumbered(this.dir(input.taskId), "grant", (id) => ({ id, ...input, createdAt: new Date().toISOString() }));
  }

  async list(taskId: string): Promise<Grant[]> {
    const entries = await this.fs.listNumbered(this.dir(taskId), "grant");
    const all = await Promise.all(entries.map((e) => this.fs.readJson<Grant>([...this.dir(taskId), e.name])));
    return all.filter((g): g is Grant => g !== null);
  }
}
