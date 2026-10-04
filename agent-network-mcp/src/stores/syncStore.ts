import type { FileStore } from "../storage/fileStore.js";
import type { SyncReport } from "../types.js";
import { assertTaskId } from "../validation.js";

export interface NewSyncReport extends Omit<SyncReport, "id" | "createdAt"> {}

export class SyncStore {
  constructor(private readonly fs: FileStore) {}

  private dir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "sync"];
  }

  async create(input: NewSyncReport): Promise<SyncReport> {
    return this.fs.createNumbered(this.dir(input.taskId), "sync", (id) => ({
      id,
      ...input,
      createdAt: new Date().toISOString(),
    }));
  }

  async list(taskId: string, round?: number): Promise<SyncReport[]> {
    const entries = await this.fs.listNumbered(this.dir(taskId), "sync");
    const all = await Promise.all(entries.map((e) => this.fs.readJson<SyncReport>([...this.dir(taskId), e.name])));
    return all.filter((r): r is SyncReport => r !== null && (round === undefined || r.round === round));
  }
}
