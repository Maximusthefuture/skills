import { AppError } from "../errors.js";
import type { FileStore } from "../storage/fileStore.js";
import type { Message, MessageType } from "../types.js";
import { assertMessageId, assertTaskId } from "../validation.js";

export interface NewMessage {
  taskId: string;
  from: string;
  to: string;
  type: MessageType;
  content: string;
  replyTo?: string;
}

export interface MessageFilter {
  to?: string;
  from?: string;
  unreadOnly?: boolean;
}

export class MessageStore {
  constructor(private readonly fs: FileStore) {}

  private dir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId), "messages"];
  }

  async create(input: NewMessage): Promise<Message> {
    return this.fs.createNumbered(this.dir(input.taskId), "msg", (id) => ({
      id,
      taskId: input.taskId,
      from: input.from,
      to: input.to,
      type: input.type,
      content: input.content,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      createdAt: new Date().toISOString(),
    }));
  }

  async find(taskId: string, messageId: string): Promise<Message | null> {
    return this.fs.readJson<Message>([...this.dir(taskId), `${assertMessageId(messageId)}.json`]);
  }

  async get(taskId: string, messageId: string): Promise<Message> {
    const m = await this.find(taskId, messageId);
    if (!m) throw new AppError("MESSAGE_NOT_FOUND", `Message '${messageId}' not found in ${taskId}`);
    return m;
  }

  async list(taskId: string, filter: MessageFilter = {}): Promise<Message[]> {
    const entries = await this.fs.listNumbered(this.dir(taskId), "msg");
    const all = await Promise.all(entries.map((e) => this.find(taskId, e.id)));
    return all.filter((m): m is Message => {
      if (!m) return false;
      if (filter.to && m.to !== filter.to) return false;
      if (filter.from && m.from !== filter.from) return false;
      if (filter.unreadOnly && m.readAt) return false;
      return true;
    });
  }

  /** One message has one recipient, so a plain readAt is enough (no distributed locking). */
  async markRead(message: Message): Promise<Message> {
    if (message.readAt) return message;
    const updated: Message = { ...message, readAt: new Date().toISOString() };
    await this.fs.writeJson([...this.dir(message.taskId), `${message.id}.json`], updated);
    return updated;
  }
}
