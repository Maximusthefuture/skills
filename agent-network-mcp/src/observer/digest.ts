import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionCost, taskStats, type Prices } from "../stats.js";
import { FileStore } from "../storage/fileStore.js";
import { EventStore } from "../stores/eventStore.js";
import { MessageStore } from "../stores/messageStore.js";
import { SessionStore, type SessionRecord } from "../stores/sessionStore.js";
import { SyncStore } from "../stores/syncStore.js";
import { TaskStore } from "../stores/taskStore.js";
import { Journal } from "../supervisor/journal.js";
import type { Task } from "../types.js";

/** One closed task in short: what the observer reads to find the system's problems across tasks (no model needed). */
export interface TaskDigest {
  taskId: string;
  title: string;
  status: Task["status"];
  kind: "code" | "openspec" | "propose";
  finishedAt: string;
  elapsedMin: number | null;
  phases: Record<string, number>;
  fixRounds: { used: number; max: number };
  costUsd: number | null;
  agents: { id: string; model: string | null; sessions: number; failed: number; turnLimit: number; costUsd: number | null; spawned?: true }[];
  /** Why the task stopped on the way, in order. */
  blocks: { kind: string; reason: string }[];
  findings: { ERROR: number; WARNING: number; INFO: number };
  questions: { asked: number; answered: number; answerMinAvg: number | null; withChoices: number };
  /** Refused tool calls: code -> count (from the agents' error logs). */
  protocolErrors: Record<string, number>;
  builds: { runs: number; red: number };
  supervisor: { incidents: Record<string, number>; needsYou: number };
  /** Own-folder sessions plus ones credited via another task's alsoFinished: lets collectDigests notice a later one and rebuild. */
  countedSessions: number;
  /**
   * How it ended up, not just how it went: merged into the project (squash / merge) and reverted after; the operator's
   * comments on the diff and the lead's answers; follow-up tasks; delegated jobs; why its sessions ended.
   */
  outcome: {
    merged: "squash" | "merge" | "already" | null;
    reverted: boolean;
    reviewComments: { total: number; fixed: number; declined: number; open: number; texts: string[] };
    followUps: number;
    jobs: number;
    sessionsEndedBy: Record<string, number>;
  };
}

/** What changes after a task closed (a merge, a revert, comments): a digest whose key differs is written again. */
const outcomeKey = (task: Task, comments: number): string => `${task.merged?.commit ?? ""}|${task.merged?.reverted?.commit ?? ""}|${comments}`;

const minutes = (ms: number) => Math.round(ms / 6000) / 10;

/** Refused calls of the task's agents: <network>/observer/errors/<agent>.jsonl lines for this task. */
async function protocolErrors(root: string, taskId: string): Promise<Record<string, number>> {
  const dir = join(root, "observer", "errors");
  const out: Record<string, number> = {};
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const text = await readFile(join(dir, f), "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as { taskId?: string; code: string; tool: string };
        if (e.taskId === taskId) out[`${e.tool}:${e.code}`] = (out[`${e.tool}:${e.code}`] ?? 0) + 1;
      } catch {
        // a torn line
      }
    }
  }
  return out;
}

/** This task's own sessions plus ones from other tasks' folders whose alsoFinished names it (the agent kept going past it without a pause). */
async function creditedSessions(fs: FileStore, taskId: string): Promise<{ sessions: SessionRecord[]; countedIn: string[] }> {
  const store = new SessionStore(fs);
  const own = await store.list(taskId);
  const countedIn: string[] = [];
  const credited: SessionRecord[] = [];
  for (const other of await new TaskStore(fs).list()) {
    if (other.id === taskId) continue;
    const theirs = (await store.list(other.id)).filter((s) => s.alsoFinished?.includes(taskId));
    if (theirs.length) {
      countedIn.push(other.id);
      credited.push(...theirs);
    }
  }
  return { sessions: [...own, ...credited], countedIn };
}

export async function buildDigest(fs: FileStore, task: Task, prices?: Prices): Promise<TaskDigest> {
  const { sessions, countedIn } = await creditedSessions(fs, task.id);
  const stats = taskStats(task, sessions, countedIn, new Date(), prices);
  const events = (await new EventStore(fs).list(task.id)).map((e) => e.event);
  const messages = await new MessageStore(fs).list(task.id);
  const reports = await new SyncStore(fs).list(task.id);
  const journal = (await new Journal(fs).list(1000)).filter((j) => j.taskId === task.id);
  const review = (await fs.readJson<{ file: string; line?: number; text: string; status: string }[]>(["tasks", task.id, "review.json"])) ?? [];
  const allTasks = await new TaskStore(fs).list();

  const agents = task.agents.map((id) => {
    const mine = sessions.filter((s) => s.agentId === id);
    const cost = mine.map((s) => sessionCost(s, prices).usd).filter((x): x is number => x !== undefined);
    return {
      id,
      model: mine.at(-1)?.model ?? null,
      sessions: mine.length,
      failed: mine.filter((s) => s.exitCode !== 0 && !s.turnLimit).length,
      turnLimit: mine.filter((s) => s.turnLimit).length,
      costUsd: cost.length ? Math.round(cost.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
      ...(task.spawned?.some((s) => s.id === id) ? { spawned: true as const } : {}),
    };
  });
  const questions = messages.filter((m) => m.to === "operator" && m.type === "QUESTION");
  const latencies = questions.flatMap((q) => {
    const a = messages.find((m) => m.from === "operator" && m.replyTo === q.id);
    return a ? [Date.parse(a.createdAt) - Date.parse(q.createdAt)] : [];
  });
  const findings = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const r of reports) for (const f of r.findings) findings[f.severity] += 1;
  const builds = events.filter((e) => e.type === "BUILD_RAN").map((e) => e.payload as { ok: boolean });
  const incidents: Record<string, number> = {};
  for (const j of journal.filter((j) => j.kind === "incident")) {
    const kind = (j.data as { kind?: string } | undefined)?.kind ?? "incident";
    incidents[kind] = (incidents[kind] ?? 0) + 1;
  }
  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    kind: task.proposes ? "propose" : task.openspec ? "openspec" : "code",
    finishedAt: task.updatedAt,
    elapsedMin: stats ? minutes(stats.elapsedMs) : null,
    phases: Object.fromEntries((stats?.phases ?? []).map((p) => [p.phase, minutes(p.ms)])),
    fixRounds: { used: task.syncRound > 0 ? task.syncRound - 1 : 0, max: task.maxFixRounds ?? 3 },
    costUsd: stats?.costUsd !== null && stats?.costUsd !== undefined ? Math.round(stats.costUsd * 1000) / 1000 : null,
    agents,
    blocks: events.filter((e) => e.type === "TASK_BLOCKED").map((e) => {
      const p = e.payload as { kind?: string; reason?: string };
      return { kind: p.kind ?? "fix-rounds", reason: String(p.reason ?? "").slice(0, 200) };
    }),
    findings,
    questions: {
      asked: questions.length,
      answered: latencies.length,
      answerMinAvg: latencies.length ? minutes(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      withChoices: questions.filter((q) => q.choices).length,
    },
    protocolErrors: await protocolErrors(fs.root, task.id),
    builds: { runs: builds.length, red: builds.filter((b) => !b.ok).length },
    supervisor: { incidents, needsYou: journal.filter((j) => j.kind === "needs-you").length },
    countedSessions: sessions.length,
    outcome: {
      merged: task.merged ? (task.merged.already ? "already" : (task.merged.strategy ?? "merge")) : null,
      reverted: !!task.merged?.reverted,
      reviewComments: {
        total: review.length,
        fixed: review.filter((c) => c.status === "fixed").length,
        declined: review.filter((c) => c.status === "declined").length,
        open: review.filter((c) => c.status === "open").length,
        // the words, short: repeated comments across tasks are what a role should learn
        texts: review.slice(0, 20).map((c) => `${c.file}${c.line ? `:${c.line}` : ""}: ${c.text}`.slice(0, 200)),
      },
      followUps: allTasks.filter((t) => t.parentTaskId === task.id && !t.jobOf).length,
      jobs: allTasks.filter((t) => t.jobOf?.taskId === task.id).length,
      sessionsEndedBy: sessions.reduce<Record<string, number>>((acc, s) => ((acc[s.endedBy ?? "unknown"] = (acc[s.endedBy ?? "unknown"] ?? 0) + 1), acc), {}),
    },
    outcomeKey: outcomeKey(task, review.length),
  } as TaskDigest;
}

/** Digests of closed tasks: <network>/observer/digests/<task>.json, written once each task is COMPLETED or CANCELLED. */
export async function collectDigests(networkDir: string, prices?: Prices): Promise<string[]> {
  const fs = await FileStore.open(networkDir);
  const tasks = await new TaskStore(fs).list();
  // one pass over every task's own sessions: cheap in-memory lookup below for whether a task gained a new
  // own or alsoFinished-credited session since its digest (if any) was last written
  const sessionsByTask = new Map(await Promise.all(tasks.map(async (t) => [t.id, await new SessionStore(fs).list(t.id)] as const)));
  const relevantCount = (taskId: string): number => {
    let n = (sessionsByTask.get(taskId) ?? []).length;
    for (const list of sessionsByTask.values()) n += list.filter((s) => s.alsoFinished?.includes(taskId)).length;
    return n;
  };
  const written: string[] = [];
  for (const task of tasks) {
    if (task.status !== "COMPLETED" && task.status !== "CANCELLED") continue;
    const path = ["observer", "digests", `${task.id}.json`];
    const existing = await fs.readJson<TaskDigest>(path);
    const comments = ((await fs.readJson<unknown[]>(["tasks", task.id, "review.json"])) ?? []).length;
    // written again on a later session (alsoFinished) or once the task was merged, reverted or commented on after it closed
    if (existing && relevantCount(task.id) <= (existing.countedSessions ?? 0) && (existing as TaskDigest & { outcomeKey?: string }).outcomeKey === outcomeKey(task, comments)) continue;
    await fs.writeJson(path, await buildDigest(fs, task, prices));
    written.push(task.id);
  }
  return written;
}

/** All digests, oldest first. */
export async function readDigests(networkDir: string): Promise<TaskDigest[]> {
  const dir = join(networkDir, "observer", "digests");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  const out: TaskDigest[] = [];
  for (const f of files) out.push(JSON.parse(await readFile(join(dir, f), "utf8")) as TaskDigest);
  return out.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
}
