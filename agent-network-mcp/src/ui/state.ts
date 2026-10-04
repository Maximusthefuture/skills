import { defaultIsProcessAlive } from "../stores/agentStore.js";
import { AgentStore } from "../stores/agentStore.js";
import { AgreementStore } from "../stores/agreementStore.js";
import { ImplementationStore } from "../stores/implementationStore.js";
import { SyncStore } from "../stores/syncStore.js";
import { TaskStore } from "../stores/taskStore.js";
import type { FileStore } from "../storage/fileStore.js";
import type { Agent, Message, NetworkEvent, Task } from "../types.js";

const TAIL = 30;

export type EffectiveStatus = Agent["status"] | "DEAD";

/** Read-only snapshot of the network for the UI. Everything comes from the filesystem. */
export async function buildUiState(fs: FileStore, isAlive: (pid: number) => boolean = defaultIsProcessAlive) {
  const agentStore = new AgentStore(fs);
  const taskStore = new TaskStore(fs);
  const agreements = new AgreementStore(fs);
  const implementations = new ImplementationStore(fs);
  const syncs = new SyncStore(fs);

  const [agents, tasks] = await Promise.all([agentStore.list(), taskStore.list()]);

  const taskViews = await Promise.all(
    tasks.map(async (task) => {
      const [agreement, impls, reports] = await Promise.all([
        agreements.find(task.id),
        implementations.list(task.id),
        syncs.list(task.id),
      ]);
      const current = reports.filter((r) => r.round === task.syncRound);
      return {
        ...pickTask(task),
        agreement,
        implementations: impls,
        syncReports: reports,
        waitingOn: waitingOn(task, agreement?.assignments.map((a) => a.agentId) ?? [], agreement?.approvedBy ?? [], impls, current.map((r) => r.agentId), !!agreement),
        messages: await tail<Message>(fs, ["tasks", task.id, "messages"], "msg"),
        events: await tail<NetworkEvent>(fs, ["tasks", task.id, "events"], "event"),
      };
    }),
  );

  const agentViews = agents.map((a) => {
    const alive = a.pid === undefined ? true : isAlive(a.pid);
    const effectiveStatus: EffectiveStatus = a.status !== "OFFLINE" && !alive ? "DEAD" : a.status;
    const working = taskViews.filter((t) => t.status === "ACTIVE" && t.agents.includes(a.id)).map((t) => t.id);
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
    tasks: taskViews.sort((a, b) => Number(a.status !== "ACTIVE") - Number(b.status === "COMPLETED") || a.id.localeCompare(b.id)),
  };
}

function pickTask(t: Task) {
  const { id, title, description, phase, status, agents, syncRound, createdAt, updatedAt, createdBy, git } = t;
  return { id, title, description, phase, status, agents, syncRound, createdAt, updatedAt, createdBy, git };
}

/** Who the task is currently waiting on, mirroring the protocol's prerequisites per phase. */
export function waitingOn(task: Task, assigned: string[], approvedBy: string[], impls: { agentId: string; status: string }[], reported: string[], hasAgreement: boolean): string[] {
  switch (task.phase) {
    case "DISCUSS":
      return hasAgreement ? assigned.filter((id) => !approvedBy.includes(id)) : [...task.agents];
    case "IMPLEMENT":
      return task.agents.filter((id) => !impls.some((i) => i.agentId === id && i.status === "READY_FOR_SYNC"));
    case "SYNC":
      return task.agents.filter((id) => !reported.includes(id));
    case "DONE":
      return [];
  }
}

async function tail<T>(fs: FileStore, dir: string[], prefix: string): Promise<T[]> {
  const entries = (await fs.listNumbered(dir, prefix)).slice(-TAIL);
  const docs = await Promise.all(entries.map((e) => fs.readJson<T>([...dir, e.name])));
  return docs.filter((d) => d !== null) as T[];
}
