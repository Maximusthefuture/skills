import type { TokenUsage } from "../sessionOutput.js";
import type { FileStore } from "../storage/fileStore.js";
import { assertTaskId } from "../validation.js";

/** One agent CLI session a runner ran for a task: when, how long, and what it cost (if the CLI reported it). */
export interface SessionRecord {
  id: string;
  taskId: string;
  agentId: string;
  attempt: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number;
  usage?: TokenUsage;
  costUsd?: number;
  numTurns?: number;
  model?: string;
  /** Other tasks the same session finished (e.g. a follow-up it went on to): their tokens are counted here. */
  alsoFinished?: string[];
}

/** tasks/<task>/sessions/session-NNN.json, written by the runners. */
export class SessionStore {
  constructor(private readonly fs: FileStore) {}

  private dir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "sessions"];
  }

  async create(record: Omit<SessionRecord, "id">): Promise<SessionRecord> {
    return this.fs.createNumbered(this.dir(record.taskId), "session", (id) => ({ id, ...record }));
  }

  async list(taskId: string): Promise<SessionRecord[]> {
    const entries = await this.fs.listNumbered(this.dir(taskId), "session");
    const docs = await Promise.all(entries.map((e) => this.fs.readJson<SessionRecord>([...this.dir(taskId), e.name])));
    return docs.filter((d): d is SessionRecord => d !== null);
  }
}
