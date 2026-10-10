import { dirname } from "node:path";
import { isAppError } from "../errors.js";
import { changePath, readChange } from "../openspec.js";
import { defaultIsProcessAlive } from "../stores/agentStore.js";
import { AgentStore } from "../stores/agentStore.js";
import { GrantStore } from "../stores/grantStore.js";
import { AgreementStore } from "../stores/agreementStore.js";
import { ImplementationStore } from "../stores/implementationStore.js";
import { IntegrationStore } from "../stores/integrationStore.js";
import { PhaseManager } from "../phase/phaseManager.js";
import { collectStats } from "../stats.js";
import { MessageStore } from "../stores/messageStore.js";
import { SubtaskStore } from "../stores/subtaskStore.js";
import { SyncStore } from "../stores/syncStore.js";
import { TaskStore } from "../stores/taskStore.js";
import type { FileStore } from "../storage/fileStore.js";
import type { Agent, Agreement, Implementation, Message, NetworkEvent, Task } from "../types.js";

const TAIL = 30;
const phases = new PhaseManager();

export type EffectiveStatus = Agent["status"] | "DEAD";

/** Read-only snapshot of the network for the UI. Everything comes from the filesystem. */
export async function buildUiState(fs: FileStore, isAlive: (pid: number) => boolean = defaultIsProcessAlive) {
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
  const stats = await collectStats(fs, tasks);

  const taskViews = await Promise.all(
    tasks.map(async (task) => {
      const [agreement, impls, reports, integrationReports] = await Promise.all([
        agreements.find(task.id),
        implementations.list(task.id),
        syncs.list(task.id),
        integrations.list(task.id),
      ]);
      const current = reports.filter((r) => r.round === task.syncRound);
      return {
        ...pickTask(task),
        stats: stats.get(task.id) ?? null,
        agreement,
        implementations: impls,
        syncReports: reports,
        integrations: integrationReports,
        grants: await grants.list(task.id),
        waitingOn: waitingOn(task, agreement?.assignments.map((a) => a.agentId) ?? [], agreement?.approvedBy ?? [], impls, current.map((r) => r.agentId), !!agreement),
        messages: await tail<Message>(fs, ["tasks", task.id, "messages"], "msg"),
        events: await tail<NetworkEvent>(fs, ["tasks", task.id, "events"], "event"),
        subtasks: Object.fromEntries((await Promise.all(task.agents.map((a) => subtasks.get(task.id, a)))).map((l) => [l.agentId, l.items])),
        followUps: tasks.filter((t) => t.parentTaskId === task.id).map((t) => t.id),
        questions: operatorQuestions(await messageStore.list(task.id)),
        openspec: task.openspec ? await openspecView(dirname(fs.root), task, agreement, impls) : null,
      };
    }),
  );

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
    networkDir: fs.root,
    agents: agentViews,
    notStarted: missing,
    openQuestions: taskViews.flatMap((t) => t.questions.filter((q) => !q.answered).map((q) => ({ taskId: t.id, taskTitle: t.title, ...q }))),
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
function operatorQuestions(messages: Message[]) {
  return messages
    .filter((m) => m.to === "operator")
    .map((q) => ({
      messageId: q.id,
      from: q.from,
      question: q.content,
      askedAt: q.createdAt,
      answered: !!q.readAt,
      answers: messages.filter((a) => a.from === "operator" && a.replyTo === q.id).map((a) => ({ answer: a.content, answeredAt: a.createdAt })),
    }));
}

function pickTask(t: Task) {
  const { id, title, description, phase, status, agents, syncRound, createdAt, updatedAt, createdBy, git, blockedReason, verifyCommand, parentTaskId, baseCommit, maxFollowUps, followUpsUsed } = t;
  return {
    id, title, description, phase, status, agents, syncRound, maxFixRounds: phases.maxFixRounds(t), createdAt, updatedAt, createdBy, git,
    blockedReason: blockedReason ?? null, verifyCommand: verifyCommand ?? null,
    parentTaskId: parentTaskId ?? null, baseCommit: baseCommit ?? null,
    followUpBudget: maxFollowUps ? { max: maxFollowUps, used: followUpsUsed ?? 0 } : null,
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

async function tail<T>(fs: FileStore, dir: string[], prefix: string): Promise<T[]> {
  const entries = (await fs.listNumbered(dir, prefix)).slice(-TAIL);
  const docs = await Promise.all(entries.map((e) => fs.readJson<T>([...dir, e.name])));
  return docs.filter((d) => d !== null) as T[];
}
