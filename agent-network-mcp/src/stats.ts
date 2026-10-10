import type { TokenUsage } from "./sessionOutput.js";
import type { FileStore } from "./storage/fileStore.js";
import { SessionStore, type SessionRecord } from "./stores/sessionStore.js";
import type { Phase, Task } from "./types.js";

/** The operator's price of a model in USD per 1M tokens; cacheRead / cacheWrite default to input. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Model name (as the session reports it, e.g. "qwen/qwen3.5-9b") -> price. From "prices" in runners.json. */
export type Prices = Record<string, ModelPrice>;

export function priceFor(model: string | undefined, prices: Prices | undefined): ModelPrice | undefined {
  if (!model || !prices) return undefined;
  if (Object.hasOwn(prices, model)) return prices[model];
  const key = Object.keys(prices).find((k) => k.toLowerCase() === model.toLowerCase());
  return key ? prices[key] : undefined;
}

/** input counts every token the model read (cached ones included, see normalizeUsage); cached ones get their own price. */
export function costOf(usage: TokenUsage, p: ModelPrice): number {
  const fresh = Math.max(0, usage.input - usage.cacheRead - usage.cacheCreation);
  return (fresh * p.input + usage.cacheRead * (p.cacheRead ?? p.input) + usage.cacheCreation * (p.cacheWrite ?? p.input) + usage.output * p.output) / 1e6;
}

/** A session's cost: what the CLI reported, else its tokens at the operator's price; undefined when neither is known. */
export function sessionCost(s: SessionRecord, prices: Prices | undefined): { usd?: number; estimated: boolean } {
  if (s.costUsd !== undefined) return { usd: s.costUsd, estimated: false };
  const price = s.usage ? priceFor(s.model, prices) : undefined;
  return price && s.usage ? { usd: costOf(s.usage, price), estimated: true } : { estimated: false };
}

/**
 * Time and tokens per task. Time comes from task.phaseHistory (tasks created before it existed have no statistics);
 * tokens and cost come from the sessions the runners recorded, so tasks worked on outside a runner, or by a CLI
 * without JSON output, have time but no tokens. Cost is what the CLI reported (Claude does); a session without it (Qwen,
 * a local model) is priced with the operator's prices, and the result says so.
 */
export interface TaskStats {
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  /** Time per phase, summed when a phase repeats (fix rounds); DONE is not counted. */
  phases: { phase: Phase; ms: number }[];
  sessions: number;
  sessionsWithoutUsage: number;
  usage: TokenUsage | null;
  costUsd: number | null;
  /** Some of the cost comes from the operator's prices, not from the CLI. */
  costEstimated: boolean;
  /** Models of sessions that have tokens but no cost and no price: add them to "prices". */
  unpricedModels: string[];
  /** models: what the sessions reported (the runner's choice may differ from what the CLI actually used). */
  agents: { agentId: string; models: string[]; sessions: number; ms: number; usage: TokenUsage | null; costUsd: number | null; costEstimated: boolean }[];
  /** Tasks whose sessions also finished this one: its tokens are counted there. */
  countedIn: string[];
}

const ZERO: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

function add(a: TokenUsage | null, b: TokenUsage | undefined): TokenUsage | null {
  if (!b) return a;
  const base = a ?? ZERO;
  return { input: base.input + b.input, output: base.output + b.output, cacheRead: base.cacheRead + b.cacheRead, cacheCreation: base.cacheCreation + b.cacheCreation, total: base.total + b.total };
}

export function taskStats(task: Task, sessions: SessionRecord[], countedIn: string[], now = new Date(), prices?: Prices): TaskStats | null {
  const history = task.phaseHistory;
  if (!history?.length) return null;
  const done = history.find((h) => h.phase === "DONE");
  const finishedAt = done?.at ?? (task.status === "CANCELLED" || task.status === "COMPLETED" ? task.updatedAt : null);
  const end = new Date(finishedAt ?? now).getTime();
  const phases: TaskStats["phases"] = [];
  history.forEach((h, i) => {
    if (h.phase === "DONE") return;
    const until = i + 1 < history.length ? new Date(history[i + 1]!.at).getTime() : end;
    const ms = Math.max(0, until - new Date(h.at).getTime());
    const row = phases.find((p) => p.phase === h.phase);
    if (row) row.ms += ms;
    else phases.push({ phase: h.phase, ms });
  });

  let usage: TokenUsage | null = null;
  let costUsd: number | null = null;
  let costEstimated = false;
  const unpriced = new Set<string>();
  const agents = new Map<string, TaskStats["agents"][number]>();
  for (const s of sessions) {
    usage = add(usage, s.usage);
    const { usd: cost, estimated } = sessionCost(s, prices);
    if (s.usage && cost === undefined) unpriced.add(s.model ?? "unknown model");
    if (cost !== undefined) costUsd = (costUsd ?? 0) + cost;
    if (estimated) costEstimated = true;
    const a = agents.get(s.agentId) ?? { agentId: s.agentId, models: [], sessions: 0, ms: 0, usage: null, costUsd: null, costEstimated: false };
    if (s.model && !a.models.includes(s.model)) a.models.push(s.model);
    a.sessions += 1;
    a.ms += s.durationMs;
    a.usage = add(a.usage, s.usage);
    if (cost !== undefined) a.costUsd = (a.costUsd ?? 0) + cost;
    if (estimated) a.costEstimated = true;
    agents.set(s.agentId, a);
  }
  return {
    startedAt: history[0]!.at,
    finishedAt,
    elapsedMs: Math.max(0, end - new Date(history[0]!.at).getTime()),
    phases,
    sessions: sessions.length,
    sessionsWithoutUsage: sessions.filter((s) => !s.usage).length,
    usage,
    costUsd,
    costEstimated,
    unpricedModels: [...unpriced],
    agents: [...agents.values()].sort((x, y) => x.agentId.localeCompare(y.agentId)),
    countedIn,
  };
}

/** Statistics of every task of the network (null for tasks without phaseHistory). */
export async function collectStats(fs: FileStore, tasks: Task[], now = new Date(), prices?: Prices): Promise<Map<string, TaskStats | null>> {
  const store = new SessionStore(fs);
  const sessions = new Map(await Promise.all(tasks.map(async (t) => [t.id, await store.list(t.id)] as const)));
  const countedIn = new Map<string, string[]>();
  for (const [taskId, list] of sessions) {
    for (const s of list) for (const other of s.alsoFinished ?? []) countedIn.set(other, [...new Set([...(countedIn.get(other) ?? []), taskId])]);
  }
  return new Map(tasks.map((t) => [t.id, taskStats(t, sessions.get(t.id) ?? [], countedIn.get(t.id) ?? [], now, prices)]));
}
