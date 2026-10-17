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
  const toMe = (await new MessageStore(fs).list(task.id, { to: agentId })).at(-1)?.id ?? "";
  // events for this agent from someone else (an agreement proposed, a part reported, a review); its own builds do not count
  const events = (await new EventStore(fs).list(task.id)).filter(({ event: e }) => e.sourceAgent !== agentId && (e.targetAgent == null || e.targetAgent === agentId) && e.type !== "BUILD_RAN");
  return `${task.updatedAt}|${toMe}|${events.at(-1)?.seq ?? 0}`;
}

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
  return !!marker && marker.taskId === task.id && task.status === "ACTIVE" && marker.mark === (await parkMark(fs, task, agentId));
}
