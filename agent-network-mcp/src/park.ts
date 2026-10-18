import type { FileStore } from "./storage/fileStore.js";
import { EventStore } from "./stores/eventStore.js";
import { MessageStore } from "./stores/messageStore.js";
import type { Task } from "./types.js";

/**
 * Parking: a runner's session with nothing to do but wait for the other agents ends instead of calling wait() again and
 * again (every wait() that returns is a model turn over the whole context). The runner then waits without a model until
 * something changes for the agent — the task (a phase change), a message to it, an event for it — and starts a fresh
 * session. The mark is that state; the marker in hooks/<agent>.park.json says which state the session parked on.
 */
export async function parkMark(fs: FileStore, task: Task, agentId: string): Promise<string> {
  const seen = await seenOf(fs, task.id);
  // a quiet note (no answer needed) is no reason to start a session
  const toMe = seen.messages.filter((m) => m.to === agentId && !m.quiet).at(-1)?.id ?? "";
  // only what can give this agent something to do: a block and its unblock, a build, an agent added... wake nobody
  const events = seen.wakes.filter((e) => e.source !== agentId && (e.target == null || e.target === agentId));
  const state = [task.phase, task.syncRound, JSON.stringify(task.reviewScope ?? null), JSON.stringify(task.takeover ?? null)].join(":");
  return `${state}|${toMe}|${events.at(-1)?.seq ?? 0}`;
}

/**
 * What the mark needs of a task's messages and events, read incrementally: a parked runner checks it every few seconds,
 * and reading every event and message of a long task each time grows with its history. Messages and events are never
 * rewritten in what the mark uses (a message's recipient and quietness, an event's type and agents).
 */
interface Seen {
  eventSeq: number;
  wakes: { seq: number; source?: string; target?: string | null }[];
  messageSeq: number;
  messages: { id: string; to: string; quiet?: boolean }[];
}
const seenCache = new Map<string, Seen>();

async function seenOf(fs: FileStore, taskId: string): Promise<Seen> {
  const key = `${fs.root}|${taskId}`;
  const seen = seenCache.get(key) ?? { eventSeq: 0, wakes: [], messageSeq: 0, messages: [] };
  for (const { event: e, seq } of await new EventStore(fs).list(taskId, seen.eventSeq)) {
    seen.eventSeq = Math.max(seen.eventSeq, seq);
    if (WAKES.has(e.type)) seen.wakes.push({ seq, ...(e.sourceAgent ? { source: e.sourceAgent } : {}), target: e.targetAgent ?? null });
  }
  const messages = new MessageStore(fs);
  for (const entry of (await fs.listNumbered(["tasks", taskId, "messages"], "msg")).filter((x) => x.seq > seen.messageSeq).sort((a, b) => a.seq - b.seq)) {
    const m = await messages.find(taskId, entry.id);
    if (!m) break; // being written: read it next time
    seen.messageSeq = entry.seq;
    seen.messages.push({ id: m.id, to: m.to, ...(m.quiet ? { quiet: true } : {}) });
  }
  if (seenCache.size > 500) seenCache.clear();
  seenCache.set(key, seen);
  return seen;
}

/** Events that may need a parked agent: a new agreement to approve, a part reported (a dependency), comments on the diff. */
export const WAKES = new Set(["AGREEMENT_UPDATED", "IMPLEMENTATION_COMPLETED", "REVIEW_COMMENTS", "TASK_HANDED_OVER", "PHASE_CHANGED"]);

/** A parked agent looks again after this long anyway (a short session): a missed reason to wake costs minutes, not a task. */
export const PARK_MAX_MS = 15 * 60_000;

interface ParkMarker {
  taskId: string;
  mark: string;
  at: string;
}

const markerPath = (agentId: string): string[] => ["hooks", `${agentId}.park.json`];

export async function writeParkMarker(fs: FileStore, agentId: string, task: Task): Promise<void> {
  await fs.writeJson(markerPath(agentId), { taskId: task.id, mark: await parkMark(fs, task, agentId), at: new Date().toISOString() } satisfies ParkMarker);
}

/** The agent parked on this task and nothing has changed for it since. */
export async function isParked(fs: FileStore, agentId: string, task: Task): Promise<boolean> {
  const marker = await fs.readJson<ParkMarker>(markerPath(agentId));
  if (!marker || marker.taskId !== task.id || task.status !== "ACTIVE") return false;
  if (Date.now() - Date.parse(marker.at) > PARK_MAX_MS) return false;
  return marker.mark === (await parkMark(fs, task, agentId));
}

/** When the agent last parked, and on which task (null: never). */
export async function lastPark(fs: FileStore, agentId: string): Promise<{ taskId: string; at: string } | null> {
  const marker = await fs.readJson<ParkMarker>(markerPath(agentId));
  return marker ? { taskId: marker.taskId, at: marker.at } : null;
}
