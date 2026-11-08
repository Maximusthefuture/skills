import { AppError } from "./errors.js";
import type { FileStore } from "./storage/fileStore.js";
import type { Message } from "./types.js";
import { assertTaskId } from "./validation.js";

export interface DiscussionMetadata {
  requirementId?: string; status?: "open" | "closed"; summary?: string; closedBy?: string; closedAt?: string;
  history?: { status: "open" | "closed"; at: string; by: string; summary?: string }[];
}
export interface Discussion extends DiscussionMetadata {
  id: string; taskId: string; question: string; from: string; to: string; createdAt: string;
  status: "open" | "closed"; answeredBy: string[]; participants: string[]; messages: Message[];
}
export function checkRequirementId(value: string): string {
  if (typeof value !== "string" || /[\r\n]/.test(value) || value.trim().length > 120) throw new AppError("INVALID_INPUT", "requirementId must be a single line of at most 120 characters");
  return value.trim();
}
export class DiscussionStore {
  constructor(private readonly fs: FileStore) {}
  async read(taskId: string): Promise<Record<string, DiscussionMetadata>> {
    return await this.fs.readJson<Record<string, DiscussionMetadata>>(["tasks", assertTaskId(taskId), "discussions.json"]) ?? {};
  }
  async save(taskId: string, metadata: Record<string, DiscussionMetadata>): Promise<void> {
    await this.fs.writeJson(["tasks", assertTaskId(taskId), "discussions.json"], metadata);
  }
}
/** Follow ancestry only within the task; malformed/cyclic legacy records never hide a question. */
export function listDiscussions(messages: Message[], metadata: Record<string, DiscussionMetadata> = {}): Discussion[] {
  const byId = new Map(messages.map(m => [`${m.taskId}:${m.id}`, m]));
  function rootOf(message: Message): Message | undefined {
    const seen = new Set<string>(); let current: Message | undefined = message; let root: Message | undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.type === "QUESTION" && !current.summary) root = current;
      current = current.replyTo ? byId.get(`${message.taskId}:${current.replyTo}`) : undefined;
    }
    // Cycles get a stable canonical question root, independent of starting point.
    if (current) root = [...seen].map(id => byId.get(`${message.taskId}:${id}`)!).filter(m => m.type === "QUESTION" && !m.summary).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] ?? root;
    return root;
  }
  const groups = new Map<string, { root: Message; messages: Message[] }>();
  for (const message of messages) {
    const root = rootOf(message); if (!root) continue;
    const key = `${root.taskId}:${root.id}`; const group = groups.get(key) ?? { root, messages: [] };
    group.messages.push(message); groups.set(key, group);
  }
  return [...groups.values()].map(({root, messages: chain}) => {
    chain.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const meta = metadata[root.id] ?? {};
    return { id: root.id, taskId: root.taskId, question: root.content, from: root.from, to: root.to, createdAt: root.createdAt,
      ...(root.requirementId ? { requirementId: root.requirementId } : {}), ...meta, status: meta.status ?? "open",
      answeredBy: [...new Set(chain.filter(m => m.id !== root.id && m.from !== root.from && m.type !== "QUESTION" && !m.quiet && !m.type.startsWith("FILE_")).map(m => m.from))],
      participants: [...new Set(chain.flatMap(m => [m.from,m.to]))], messages: chain };
  }).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
