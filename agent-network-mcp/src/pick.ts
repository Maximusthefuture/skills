import type { Task } from "./types.js";

const seq = (t: Task): number => Number(t.id.slice(t.id.lastIndexOf("-") + 1));
const open = (t: Task | undefined): boolean => !!t && (t.status === "ACTIVE" || t.status === "BLOCKED");

/**
 * The task an agent works on now, the same for its runner and the server: the oldest unfinished (ACTIVE or BLOCKED) task
 * of the agent — but a task put aside for another one (setAside) is skipped while that one is still open: the agent
 * finishes what it took first, then comes back.
 */
export function pickTask(tasks: Task[], agent: string): Task | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [...tasks].sort((a, b) => seq(a) - seq(b)).find((t) => {
    if (!t.agents.includes(agent) || !open(t)) return false;
    const next = t.setAside?.next[agent];
    return !(next && open(byId.get(next)));
  }) ?? null;
}
