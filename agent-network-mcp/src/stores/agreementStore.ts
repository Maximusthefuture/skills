import type { FileStore } from "../storage/fileStore.js";
import type { Agreement } from "../types.js";
import { assertTaskId } from "../validation.js";

export class AgreementStore {
  constructor(private readonly fs: FileStore) {}

  private path(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "agreement.json"];
  }

  async find(taskId: string): Promise<Agreement | null> {
    return this.fs.readJson<Agreement>(this.path(taskId));
  }

  async save(agreement: Agreement): Promise<void> {
    await this.fs.writeJson(this.path(agreement.taskId), agreement);
  }
}
