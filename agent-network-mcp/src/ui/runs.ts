import { pickTask } from "../runner.js";
import type { TokenUsage } from "../sessionOutput.js";
import { sessionCost, type Prices } from "../stats.js";
import type { FileStore } from "../storage/fileStore.js";
import { SessionStore } from "../stores/sessionStore.js";
import type { Task } from "../types.js";

/** One agent session (one CLI run started by a runner) for the "Runs" page: running ones and the recorded ones, newest first. */
export interface RunView {
  /** The record's id within its task (session-003); "" while the session runs. */
  id: string;
  /** Project-wide number in the order the sessions ended (stable: a new session always ends last); null while it runs. */
  seq: number | null;
  taskId: string;
  taskTitle: string;
  /** Phase and status of the task the session was started for. */
  taskState: string;
  /** Other tasks the same session finished (e.g. a follow-up it went on to). */
  alsoFinished: { id: string; title: string; status: string }[];
  numTurns: number | null;
  /** tasks/<task>/sessions/<id>.json inside the network directory; null while the session runs. */
  recordPath: string | null;
  agentId: string;
  attempt: number;
  model: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  /** running: open right now; ok: exit 0; stopped: ended by a signal (Stop button, Ctrl+C); failed: any other exit code. */
  status: "running" | "ok" | "failed" | "stopped";
  exitCode: number | null;
  usage: TokenUsage | null;
  costUsd: number | null;
  costEstimated: boolean;
}

const SIGNAL_EXIT = 128; // the runner records a session killed by a signal with this code

export const taskState = (t: Task | undefined): string => (!t ? "" : t.status === "ACTIVE" ? t.phase : t.status);

export async function listRuns(fs: FileStore, tasks: Task[], prices?: Prices): Promise<RunView[]> {
  const store = new SessionStore(fs);
  const runs = (await Promise.all(tasks.map(async (t) => (await store.list(t.id)).map((s) => ({ s, t }))))).flat();
  const byEnd = [...runs].sort((a, b) => a.s.endedAt.localeCompare(b.s.endedAt) || a.t.id.localeCompare(b.t.id) || a.s.id.localeCompare(b.s.id));
  const seq = new Map(byEnd.map((r, i) => [r, i + 1]));
  return runs
    .map((r) => {
      const { s, t } = r;
      const cost = sessionCost(s, prices);
      return {
        id: s.id,
        seq: seq.get(r)!,
        taskId: t.id,
        taskTitle: t.title,
        taskState: taskState(t),
        alsoFinished: (s.alsoFinished ?? []).map((id) => {
          const other = tasks.find((x) => x.id === id);
          return { id, title: other?.title ?? "", status: other?.status ?? "" };
        }),
        numTurns: s.numTurns ?? null,
        recordPath: `tasks/${t.id}/sessions/${s.id}.json`,
        agentId: s.agentId,
        attempt: s.attempt,
        model: s.model ?? null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMs: s.durationMs,
        status: s.exitCode === 0 ? "ok" : s.exitCode === SIGNAL_EXIT ? "stopped" : "failed",
        exitCode: s.exitCode,
        usage: s.usage ?? null,
        costUsd: cost.usd ?? null,
        costEstimated: cost.estimated,
      } satisfies RunView;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export type QueueState = "running" | "queued" | "blocked" | "done" | "cancelled";

/**
 * Where each task stands for the operator. An agent works on its oldest unfinished task (the same choice as the runner),
 * so an ACTIVE task is running when it is that task for at least one of its agents, and queued otherwise.
 */
export function queueStates(tasks: Task[]): Map<string, QueueState> {
  const current = new Set([...new Set(tasks.flatMap((t) => t.agents))].map((a) => pickTask(tasks, a)?.id).filter((id): id is string => !!id));
  return new Map(
    tasks.map((t) => [
      t.id,
      t.status === "COMPLETED" ? "done" : t.status === "CANCELLED" ? "cancelled" : t.status === "BLOCKED" ? "blocked" : current.has(t.id) ? "running" : "queued",
    ]),
  );
}
