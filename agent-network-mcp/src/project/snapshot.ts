import type { ProjectState } from "./store.js";

const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
/** Bound the JSON representation, including escape expansion, without splitting Unicode. */
export function boundedText(text: string, bytes: number): string {
  if (size(text) <= bytes) return text;
  const chars = Array.from(text);
  let low = 0, high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (size(chars.slice(0, mid).join("") + "…") <= bytes) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("") + "…";
}

export interface ProjectTaskStatus {
  taskId: string;
  title: string;
  status: string;
  waitingForUser: boolean;
  href: string;
}
export interface ProposalSummary { proposalId: string; status: "pending" | "failed"; summary: string }

function boundedList<T>(items: T[], maxItems: number, bytes: number): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (result.length === maxItems) break;
    if (size([...result, item]) <= bytes) result.push(item);
  }
  return result;
}

/** Task statuses come from the server, never from model output or project memory. */
export function projectSnapshot(state: ProjectState, input: {
  goal: string; memory: string; tasks: ProjectTaskStatus[]; proposals: ProposalSummary[];
}) {
  const messages = boundedList(state.messages.slice(-50).reverse().map(m => ({
    messageId: m.messageId, content: boundedText(m.content, 2048), createdAt: m.createdAt,
    truncated: size(m.content) > 2048,
  })), 50, 8192).reverse();
  const taskIds = new Set(state.tasks.map(t => t.taskId));
  const linked = input.tasks.filter(t => taskIds.has(t.taskId));
  linked.sort((a, b) => Number(b.waitingForUser || ["ACTIVE", "BLOCKED"].includes(b.status)) - Number(a.waitingForUser || ["ACTIVE", "BLOCKED"].includes(a.status)));
  const tasks = boundedList(linked.map(t => ({ ...t, title: boundedText(t.title, 512) })), 50, 4096);
  const proposals = boundedList(input.proposals.slice(-20).reverse().map(p => ({
    proposalId: p.proposalId, status: p.status, summary: boundedText(p.summary, 768),
  })).filter(p => size(p) <= 1024), 20, 20480);
  const snapshot = {
    projectId: state.projectId, asOf: new Date().toISOString(),
    goal: boundedText(input.goal, 4096), memory: boundedText(input.memory, 16384),
    messages, tasks, proposals,
    truncated: {
      goal: size(input.goal) > 4096, memory: size(input.memory) > 16384,
      messages: messages.length < state.messages.length || messages.some(m => m.truncated),
      tasks: tasks.length < linked.length, proposals: proposals.length < input.proposals.length,
    },
    memoryIsEvidenceOfCode: false,
  };
  if (size(snapshot) > 65536) throw new Error("Project snapshot exceeds 64 KiB");
  return snapshot;
}
