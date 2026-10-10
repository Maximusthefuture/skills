import { AppError } from "./errors.js";
import type { FileStore } from "./storage/fileStore.js";
import type { Phase, Task } from "./types.js";

/**
 * Fresh sessions at phase changes, after the "goldfish" of Dave Rensin's Elephant-Goldfish model: a runner session that
 * has seen a task since an earlier phase hands it over when the task enters one of these phases, so that phase (the SYNC
 * review above all) is done by a session that knows only the task, the agreement and the code, not the discussion.
 */
export const FRESH_PHASES: readonly Phase[] = ["IMPLEMENT", "SYNC", "INTEGRATE"];

/** "SYNC" / "IMPLEMENT,SYNC" / ["SYNC"] -> phases; empty input -> []. */
export function parseFreshPhases(value: string | readonly unknown[] | undefined, what: string): Phase[] {
  if (value === undefined) return [];
  const items = typeof value === "string" ? value.split(",").map((p) => p.trim()).filter(Boolean) : [...value];
  const bad = items.filter((p) => typeof p !== "string" || !FRESH_PHASES.includes(p as Phase));
  if (bad.length) throw new AppError("INVALID_CONFIG", `${what}: ${bad.map((p) => JSON.stringify(p)).join(", ")} is not a phase with fresh sessions (${FRESH_PHASES.join(", ")})`);
  return [...new Set(items as Phase[])];
}

/** How many phases the task has entered; a session remembers it to tell later phases from the one it started in. */
export const phaseEpoch = (task: Task): number | undefined => task.phaseHistory?.length;

/** Written by the server when it tells a session to hand over, read by the Stop hook so it lets that session end. */
export interface HandoffMarker {
  taskId: string;
  epoch: number;
  at: string;
}

const markerPath = (agentId: string): string[] => ["hooks", `${agentId}.handoff.json`];

export async function writeHandoffMarker(fs: FileStore, agentId: string, taskId: string, epoch: number): Promise<void> {
  await fs.writeJson(markerPath(agentId), { taskId, epoch, at: new Date().toISOString() } satisfies HandoffMarker);
}

/** The agent was told to hand this task over in its current phase; a marker from an earlier phase does not count. */
export async function isHandedOver(fs: FileStore, agentId: string, task: Task): Promise<boolean> {
  const marker = await fs.readJson<HandoffMarker>(markerPath(agentId));
  return !!marker && marker.taskId === task.id && marker.epoch === phaseEpoch(task);
}
