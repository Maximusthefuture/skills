import type { FileStore } from "../storage/fileStore.js";
import type { IntegrationReport } from "../types.js";
import { assertTaskId } from "../validation.js";

export interface NewIntegrationReport extends Omit<IntegrationReport, "id" | "createdAt"> {}

/** INTEGRATE results, one file per attempt: tasks/<task>/integration/integration-NNN.json. */
export class IntegrationStore {
  constructor(private readonly fs: FileStore) {}

  private dir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "integration"];
  }

  async create(input: NewIntegrationReport): Promise<IntegrationReport> {
    return this.fs.createNumbered(this.dir(input.taskId), "integration", (id) => ({ id, ...input, createdAt: new Date().toISOString() }));
  }

  async list(taskId: string, round?: number): Promise<IntegrationReport[]> {
    const entries = await this.fs.listNumbered(this.dir(taskId), "integration");
    const all = await Promise.all(entries.map((e) => this.fs.readJson<IntegrationReport>([...this.dir(taskId), e.name])));
    return all.filter((r): r is IntegrationReport => r !== null && (round === undefined || r.round === round));
  }
}
