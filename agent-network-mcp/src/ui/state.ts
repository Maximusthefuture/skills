import { dirname } from "node:path";
import { isAppError } from "../errors.js";
import { changePath, hasChange, readChange } from "../openspec.js";
import { planBrief, readPlanState, reviewsPages } from "../plan.js";
import { defaultIsProcessAlive } from "../stores/agentStore.js";
import { queueStates } from "./runs.js";
import { AgentStore } from "../stores/agentStore.js";
import { GrantStore } from "../stores/grantStore.js";
import { AgreementStore } from "../stores/agreementStore.js";
import { ImplementationStore } from "../stores/implementationStore.js";
import { IntegrationStore } from "../stores/integrationStore.js";
import { PhaseManager } from "../phase/phaseManager.js";
import { collectStats, type Prices } from "../stats.js";
import { MessageStore } from "../stores/messageStore.js";
import { SubtaskStore } from "../stores/subtaskStore.js";
import { SyncStore } from "../stores/syncStore.js";
import { TaskStore } from "../stores/taskStore.js";
import type { FileStore } from "../storage/fileStore.js";
import type { Agent, Agreement, Implementation, Message, NetworkEvent, ReviewComment, Task } from "../types.js";

/** Messages and events per task the page gets: the newest ones (it scrolls them in their own boxes). */
const TAIL = 50;
const phases = new PhaseManager();

export type EffectiveStatus = Agent["status"] | "DEAD";

type CachedView = { updatedAt: string; sessions: number; at: number; view: unknown };
/** Views of finished tasks built lately, per network (see buildUiState). */
const viewCache = new Map<string, Map<string, CachedView>>();

/** Read-only snapshot of the network for the UI. Everything comes from the filesystem. */
export async function buildUiState(fs: FileStore, isAlive: (pid: number) => boolean = defaultIsProcessAlive, pricing: { prices?: Prices; error?: string } = {}) {
  const agentStore = new AgentStore(fs);
  const taskStore = new TaskStore(fs);
  const agreements = new AgreementStore(fs);
  const implementations = new ImplementationStore(fs);
  const syncs = new SyncStore(fs);
  const grants = new GrantStore(fs);
  const integrations = new IntegrationStore(fs);
  const subtasks = new SubtaskStore(fs);
  const messageStore = new MessageStore(fs);

  const [agents, tasks] = await Promise.all([agentStore.list(), taskStore.list()]);
  // a finished task's view hardly changes: the page refreshes every 2 s, so it is built again only when its task.json
  // changed (a merge, a revert) or once a minute
  const cache = viewCache.get(fs.root) ?? new Map<string, CachedView>();
  viewCache.set(fs.root, cache);
  const now = Date.now();
  // the last sessions of a task are recorded a few seconds after it finished: their number is part of what must not change
  const sessionCount = new Map(await Promise.all(tasks.map(async (t) => [t.id, (await fs.listNumbered(["tasks", t.id, "sessions"], "session")).length] as const)));
  const reuse = (t: Task): CachedView | undefined => {
    const c = cache.get(t.id);
    return (t.status === "COMPLETED" || t.status === "CANCELLED") && c && c.updatedAt === t.updatedAt && c.sessions === sessionCount.get(t.id) && now - c.at < 60_000 ? c : undefined;
  };
  const stats = await collectStats(fs, tasks, new Date(), pricing.prices, new Set(tasks.filter((t) => !reuse(t)).map((t) => t.id)));
  const queue = queueStates(tasks);

  const taskViews = await Promise.all(
    tasks.map(async (task) => {
      const kept = reuse(task);
      if (kept) {
        return {
          ...(kept.view as Awaited<ReturnType<typeof buildView>>), queue: queue.get(task.id) ?? "queued", followUps: tasks.filter((t) => t.parentTaskId === task.id).map((t) => t.id),
          // the change reaches the project folder by a merge outside the task: looked at every time (one stat)
          proposedReady: task.proposes && task.status === "COMPLETED" ? await hasChange(dirname(fs.root), task.proposes.change) : false,
        };
      }
      const view = await buildView(task);
      if (task.status === "COMPLETED" || task.status === "CANCELLED") cache.set(task.id, { updatedAt: task.updatedAt, sessions: sessionCount.get(task.id) ?? 0, at: now, view });
      else cache.delete(task.id);
      return view;
    }),
  );

  async function buildView(task: Task) {
    {
      const [agreement, impls, reports, integrationReports] = await Promise.all([
        agreements.find(task.id),
        implementations.list(task.id),
        syncs.list(task.id),
        integrations.list(task.id),
      ]);
      const current = reports.filter((r) => r.round === task.syncRound);
      // a task with planReview, still in DISCUSS: where the lead's plan stands (waiting on the operator or the lead); a
      // change-writing task with analysts' input: its pages (the input in DISCUSS, the change in IMPLEMENT)
      const plan = reviewsPages(task) ? planBrief(await readPlanState(fs, task.id)) : null;
      const pageOpen = task.planReview ? task.phase === "DISCUSS" && !agreement : plan?.stage === "change" ? task.phase === "IMPLEMENT" : task.phase === "DISCUSS" && !agreement;
      const planWait = plan && task.status === "ACTIVE" && pageOpen && plan.status !== "approved" ? [plan.status === "awaiting" ? "operator" : task.agents[0]!] : null;
      const [msgs, evs] = await Promise.all([tail<Message>(fs, ["tasks", task.id, "messages"], "msg"), tail<NetworkEvent>(fs, ["tasks", task.id, "events"], "event")]);
      return {
        ...pickTask(task),
        /** running / queued / blocked / done / cancelled: whether one of its agents works on it now. */
        queue: queue.get(task.id) ?? "queued",
        stats: stats.get(task.id) ?? null,
        agreement,
        implementations: impls,
        syncReports: reports,
        integrations: integrationReports,
        grants: await grants.list(task.id),
        plan,
        waitingOn: planWait ?? waitingOn(task, agreement?.assignments.map((a) => a.agentId) ?? [], agreement?.approvedBy ?? [], impls, current.map((r) => r.agentId), !!agreement),
        messages: msgs.items,
        messagesTotal: msgs.total,
        events: evs.items,
        eventsTotal: evs.total,
        subtasks: Object.fromEntries((await Promise.all(task.agents.map((a) => subtasks.get(task.id, a)))).map((l) => [l.agentId, l.items])),
        followUps: tasks.filter((t) => t.parentTaskId === task.id).map((t) => t.id),
        /** The operator's review comments on the diff, with the lead's answers. */
        review: (await fs.readJson<ReviewComment[]>(["tasks", task.id, "review.json"]).catch(() => null)) ?? [],
        /** The latest run of the build tool per agent (agentId -> {ok, durationMs, tests?, at, logPath}). */
        builds: Object.fromEntries((await Promise.all(task.agents.map((a) => fs.readJson<{ agentId: string }>(["tasks", task.id, "builds", `${a}.json`]).catch(() => null)))).filter((b) => b !== null).map((b) => [b!.agentId, b])),
        ...(await (async () => {
          const all = await messageStore.list(task.id);
          return { questions: operatorQuestions(all), notes: operatorNotes(all) };
        })()),
        /** Unread messages the agents' hooks have already shown them (Claude Code): delivered, though not acted on yet. */
        delivered: (await Promise.all(task.agents.map((a) => fs.readJson<{ notified?: string[] }>(["hooks", `${a}.json`]).catch(() => null))))
          .flatMap((h) => h?.notified ?? [])
          .filter((k) => k.startsWith(`${task.id}/`))
          .map((k) => k.slice(task.id.length + 1)),
        openspec: task.openspec ? await openspecView(dirname(fs.root), task, agreement, impls) : null,
        /** A change-writing task after DONE: the change is in the project folder (merged), ready to be implemented. */
        proposedReady: task.proposes && task.status === "COMPLETED" ? await hasChange(dirname(fs.root), task.proposes.change) : false,
      };
    }
  }

  const agentViews = agents.map((a) => {
    const alive = a.pid === undefined ? true : isAlive(a.pid);
    const effectiveStatus: EffectiveStatus = a.status !== "OFFLINE" && !alive ? "DEAD" : a.status;
    const working = taskViews.filter((t) => (t.status === "ACTIVE" || t.status === "BLOCKED") && t.agents.includes(a.id)).map((t) => t.id);
    return { id: a.id, type: a.type, role: a.role ?? null, status: a.status, effectiveStatus, lastSeenAt: a.lastSeenAt, registeredAt: a.registeredAt, pid: a.pid ?? null, tasks: working };
  });

  // tasks may name agents that have not started yet
  const known = new Set(agents.map((a) => a.id));
  const missing = [...new Set(taskViews.flatMap((t) => t.agents))].filter((id) => !known.has(id));

  return {
    generatedAt: new Date().toISOString(),
    /** The operator's prices (runners.json "prices"): the models they cover, or why the file's prices cannot be read. */
    prices: { models: Object.keys(pricing.prices ?? {}), error: pricing.error ?? null },
    networkDir: fs.root,
    agents: agentViews,
    notStarted: missing,
    openQuestions: taskViews.flatMap((t) => t.questions.filter((q) => !q.answered).map((q) => ({ taskId: t.id, taskTitle: t.title, ...q }))),
    /** What agents sent the operator for information (fyi): no answer expected, shown until the operator has seen it. */
    operatorNotes: taskViews.flatMap((t) => t.notes.filter((n) => !n.seen).map((n) => ({ taskId: t.id, taskTitle: t.title, ...n }))),
    tasks: taskViews.sort((a, b) => Number(a.status !== "ACTIVE") - Number(b.status === "COMPLETED") || a.id.localeCompare(b.id)),
  };
}

/**
 * OpenSpec task: the change's progress in the project folder (what "archive" needs: every task ticked there) and who
 * took which tasks.md numbers and reported which done.
 */
async function openspecView(projectDir: string, task: Task, agreement: Agreement | null, impls: Implementation[]) {
  const { change, archivedAt } = task.openspec!;
  let progress: { done: number; total: number } | null = null;
  let error: string | null = null;
  if (!archivedAt) {
    try {
      const tasks = (await readChange(projectDir, change)).tasks;
      progress = { done: tasks.filter((t) => t.done).length, total: tasks.length };
    } catch (e) {
      error = isAppError(e) ? e.message : String(e);
    }
  }
  return {
    change,
    path: changePath(change),
    archivedAt: archivedAt ?? null,
    progress,
    error,
    assigned: (agreement?.assignments ?? []).filter((a) => a.tasks).map((a) => ({ agentId: a.agentId, tasks: a.tasks!, done: impls.find((i) => i.agentId === a.agentId)?.tasksDone ?? [] })),
  };
}

/** Questions agents asked the operator, with the operator's answers. */
/** What agents told the operator for information (send_message with fyi): no answer expected. */
function operatorNotes(messages: Message[]) {
  return messages
    .filter((m) => m.to === "operator" && m.type !== "QUESTION")
    .map((m) => ({ messageId: m.id, from: m.from, text: m.content, at: m.createdAt, seen: !!m.readAt }));
}

function operatorQuestions(messages: Message[]) {
  return messages
    .filter((m) => m.to === "operator" && m.type === "QUESTION")
    .map((q) => ({
      messageId: q.id,
      from: q.from,
      question: q.content,
      /** Choices the agent offered (buttons on the page), with the one it recommends. */
      choices: q.choices ?? null,
      askedAt: q.createdAt,
      answered: !!q.readAt,
      answers: messages.filter((a) => a.from === "operator" && a.replyTo === q.id).map((a) => ({ answer: a.content, answeredAt: a.createdAt })),
    }));
}

function pickTask(t: Task) {
  const { id, title, description, phase, status, agents, syncRound, createdAt, updatedAt, createdBy, git, blockedReason, verifyCommand, parentTaskId, baseCommit, maxFollowUps, followUpsUsed, handover, takeover, maxCostUsd, blockedBy, merged, proposes, spawned, clarify, planReview, grill, jobOf, allowSpawn, acceptance, contract, setAside } = t;
  return {
    id, title, description, phase, status, agents, syncRound, maxFixRounds: phases.maxFixRounds(t), createdAt, updatedAt, createdBy, git,
    blockedReason: blockedReason ?? null, verifyCommand: verifyCommand ?? null,
    /** Cost limit in USD (null = none); blockedBy "cost": BLOCKED by it, unblocking raises it. */
    maxCostUsd: maxCostUsd ?? null, blockedBy: blockedBy ?? null,
    /** The lead's branch merged into the project after DONE. */
    merged: merged ?? null,
    /** The operator's verdict on the acceptance page after DONE. */
    acceptance: acceptance ?? null,
    /** The task changes the API contract too: its repository, worktree, coordinates, merge. */
    contract: contract ?? null,
    /** The task writes this OpenSpec change (instead of implementing one). */
    proposes: proposes ?? null,
    /** Agents the lead added from templates (spawn_agent), with why. */
    spawned: spawned ?? [],
    /** The operator let the lead add agents (spawn_agent). */
    allowSpawn: !!allowSpawn,
    /** The lead checks the task with the operator before it proposes. */
    clarify: !!clarify,
    /** The clarify is a grilling: rounds of questions, then the operator confirms the lead's summary. */
    grill: !!grill,
    /** A job the lead of another task delegated (delegate): one agent, no review, its result goes back to that lead. */
    jobOf: jobOf ?? null,
    /** The lead writes an HTML plan that the operator approves before the agreement. */
    planReview: !!planReview,
    parentTaskId: parentTaskId ?? null, baseCommit: baseCommit ?? null,
    followUpBudget: maxFollowUps ? { max: maxFollowUps, used: followUpsUsed ?? 0 } : null,
    /** BLOCKED: unless the operator decides by dueAt, the lead takes over the stuck fix. */
    handover: status === "BLOCKED" ? (handover ?? null) : null,
    /** BLOCKED and put aside: its agents work on their next task meanwhile (per agent), and come back once it is closed. */
    setAside: setAside ?? null,
    /** The lead took over the fix of these agents (from that round on, a failure is final). */
    takeover: takeover ?? null,
    /** When the task entered its current phase. */
    phaseSince: t.phaseHistory?.at(-1)?.at ?? t.updatedAt,
  };
}

/** Who the task is currently waiting on, mirroring the protocol's prerequisites per phase. */
export function waitingOn(task: Task, assigned: string[], approvedBy: string[], impls: { agentId: string; status: string }[], reported: string[], hasAgreement: boolean): string[] {
  if (task.status === "BLOCKED") return ["operator"];
  switch (task.phase) {
    case "DISCUSS":
      return hasAgreement ? assigned.filter((id) => !approvedBy.includes(id)) : [...task.agents];
    case "IMPLEMENT":
      return task.agents.filter((id) => !impls.some((i) => i.agentId === id && i.status === "READY_FOR_SYNC"));
    case "SYNC":
      return phases.reviewers(task).filter((id) => !reported.includes(id));
    case "INTEGRATE":
      return [phases.integrator(task)];
    case "DONE":
      return [];
  }
}

/** The newest TAIL documents and how many there are in all. */
async function tail<T>(fs: FileStore, dir: string[], prefix: string): Promise<{ items: T[]; total: number }> {
  const all = await fs.listNumbered(dir, prefix);
  const docs = await Promise.all(all.slice(-TAIL).map((e) => fs.readJson<T>([...dir, e.name])));
  return { items: docs.filter((d) => d !== null) as T[], total: all.length };
}
