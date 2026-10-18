import { NetworkService } from "./service.js";
import { attachedCost, sessionCost, type Prices } from "./stats.js";
import { FileStore } from "./storage/fileStore.js";
import { SessionStore } from "./stores/sessionStore.js";
import { TaskStore } from "./stores/taskStore.js";

/**
 * What a task cost so far: its recorded sessions (agents and the supervisor), the jobs its lead delegated and the plan
 * critic; the known part, and how many sessions had no cost.
 */
export async function taskSpent(fs: FileStore, taskId: string, prices: Prices | undefined): Promise<{ usd: number; unknown: number }> {
  let usd = 0;
  let unknown = 0;
  for (const s of await new SessionStore(fs).list(taskId)) {
    const c = sessionCost(s, prices);
    if (c.usd === undefined) unknown++;
    else usd += c.usd;
  }
  const tasks = new TaskStore(fs);
  const task = await tasks.find(taskId);
  if (task) {
    const extra = await attachedCost(fs, task, await tasks.list(), prices);
    usd += extra.jobsUsd + extra.criticUsd;
    unknown += extra.unknown;
  }
  return { usd, unknown };
}

/**
 * The page's check after every agent session: a task with maxCostUsd whose sessions cost that much or more is BLOCKED
 * (the operator raises the limit or cancels). Cost is known when a session ends, so a limit can be passed by the sessions
 * running at that moment, never by a new one.
 */
export function costGuard(opts: { networkDir: string; prices?: () => Promise<{ prices?: Prices }>; log?: (line: string) => void }) {
  const ready = (async () => {
    const fs = await FileStore.open(opts.networkDir);
    return { fs, operator: await NetworkService.create(opts.networkDir, { id: "operator", type: "ui" }) };
  })();
  const warned = new Set<string>();
  const guard = async (agentId: string, taskId: string): Promise<void> => {
    const { fs, operator } = await ready;
    const task = await operator.tasks.find(taskId);
    if (!task) return;
    // a delegated job spends its lead's task's money: the lead's task is checked with it in, and the job stops with it
    if (task.jobOf) {
      await guard(agentId, task.jobOf.taskId);
      if (task.status === "ACTIVE" && task.maxCostUsd !== undefined) {
        const parent = await taskSpent(fs, task.jobOf.taskId, (await opts.prices?.())?.prices);
        if (await operator.blockForCost(taskId, parent.usd)) opts.log?.(`[cost] ${taskId}: BLOCKED: its lead's task ${task.jobOf.taskId} spent $${parent.usd.toFixed(2)}, limit $${task.maxCostUsd}`);
      }
      return;
    }
    if (task.status !== "ACTIVE" || task.maxCostUsd === undefined) return;
    const spent = await taskSpent(fs, taskId, (await opts.prices?.())?.prices);
    if (spent.unknown && !warned.has(taskId)) {
      warned.add(taskId);
      opts.log?.(`[cost] ${taskId}: ${spent.unknown} session(s) without a cost (no price for the model in "prices"): the limit $${task.maxCostUsd} counts only the rest`);
    }
    const blocked = await operator.blockForCost(taskId, spent.usd);
    if (blocked) opts.log?.(`[cost] ${taskId}: BLOCKED after ${agentId}'s session: $${spent.usd.toFixed(2)} spent, limit $${task.maxCostUsd}`);
  };
  return guard;
}
