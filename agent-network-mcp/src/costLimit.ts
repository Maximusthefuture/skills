import { NetworkService } from "./service.js";
import { sessionCost, type Prices } from "./stats.js";
import { FileStore } from "./storage/fileStore.js";
import { SessionStore } from "./stores/sessionStore.js";

/** What a task's recorded sessions cost so far (agents and the supervisor): known part, and how many sessions had no cost. */
export async function taskSpent(fs: FileStore, taskId: string, prices: Prices | undefined): Promise<{ usd: number; unknown: number }> {
  let usd = 0;
  let unknown = 0;
  for (const s of await new SessionStore(fs).list(taskId)) {
    const c = sessionCost(s, prices);
    if (c.usd === undefined) unknown++;
    else usd += c.usd;
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
  return async (agentId: string, taskId: string): Promise<void> => {
    const { fs, operator } = await ready;
    const task = await operator.tasks.find(taskId);
    if (!task || task.status !== "ACTIVE" || task.maxCostUsd === undefined) return;
    const spent = await taskSpent(fs, taskId, (await opts.prices?.())?.prices);
    if (spent.unknown && !warned.has(taskId)) {
      warned.add(taskId);
      opts.log?.(`[cost] ${taskId}: ${spent.unknown} session(s) without a cost (no price for the model in "prices"): the limit $${task.maxCostUsd} counts only the rest`);
    }
    const blocked = await operator.blockForCost(taskId, spent.usd);
    if (blocked) opts.log?.(`[cost] ${taskId}: BLOCKED after ${agentId}'s session: $${spent.usd.toFixed(2)} spent, limit $${task.maxCostUsd}`);
  };
}
