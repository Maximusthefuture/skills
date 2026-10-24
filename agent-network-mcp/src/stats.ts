import type { TokenUsage } from "./sessionOutput.js";
import type { FileStore } from "./storage/fileStore.js";
import { SessionStore, type SessionRecord } from "./stores/sessionStore.js";
import { readPlanState, reviewsPages } from "./plan.js";
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

/** Relative price of the tokens a model reads (fresh input 1), the same proportions across the Claude models. */
const READ_WEIGHTS = { cacheRead: 0.1, cacheCreation: 1.25 };
/** The tokens a session read, weighted by price. Output is left out: a stopped session's count of it is not reliable. */
const readWeight = (u: TokenUsage): number => Math.max(0, u.input - u.cacheRead - u.cacheCreation) + READ_WEIGHTS.cacheRead * u.cacheRead + READ_WEIGHTS.cacheCreation * u.cacheCreation;

/**
 * What each model cost per weighted token it read, learned from the sessions whose CLI reported their cost (the output
 * they wrote is inside that price): model -> USD per token. Prices a session stopped before its CLI reported the cost.
 */
export type ModelRates = Map<string, number>;
export function learnRates(sessions: SessionRecord[]): ModelRates {
  const sum = new Map<string, { usd: number; w: number }>();
  for (const s of sessions) {
    if (s.costUsd === undefined || !s.usage || s.usagePartial || !s.model) continue;
    const r = sum.get(s.model) ?? { usd: 0, w: 0 };
    r.usd += s.costUsd;
    r.w += readWeight(s.usage);
    sum.set(s.model, r);
  }
  return new Map([...sum].filter(([, r]) => r.w > 0 && r.usd > 0).map(([m, r]) => [m, r.usd / r.w]));
}

/** The learned rate of a model; a CLI may name it a little differently (an alias, several models joined). */
function rateFor(model: string | undefined, rates: ModelRates | undefined): number | undefined {
  if (!model || !rates?.size) return undefined;
  if (rates.has(model)) return rates.get(model);
  const key = [...rates.keys()].find((k) => k.includes(model) || model.includes(k));
  return key ? rates.get(key) : undefined;
}

/**
 * A session's cost: what the CLI reported; else, for a session stopped before it (usagePartial), its tokens at the rate
 * the same model cost in the sessions that reported it; else its tokens at the operator's price; undefined when nothing
 * is known. The two estimates say so.
 */
export function sessionCost(s: SessionRecord, prices: Prices | undefined, rates?: ModelRates): { usd?: number; estimated: boolean } {
  if (s.costUsd !== undefined) return { usd: s.costUsd, estimated: false };
  if (!s.usage) return { estimated: false };
  const rate = s.usagePartial ? rateFor(s.model, rates) : undefined;
  if (rate !== undefined) return { usd: Math.round(readWeight(s.usage) * rate * 10_000) / 10_000, estimated: true };
  const price = priceFor(s.model, prices);
  return price ? { usd: costOf(s.usage, price), estimated: true } : { estimated: false };
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
  /** Time per phase, summed when a phase repeats (fix rounds); visits = each stay in it, in order. DONE is not counted. */
  phases: { phase: Phase; ms: number; visits: number[] }[];
  sessions: number;
  sessionsWithoutUsage: number;
  usage: TokenUsage | null;
  costUsd: number | null;
  /** Some of the cost comes from the operator's prices, not from the CLI. */
  costEstimated: boolean;
  /** Models of sessions that have tokens but no cost and no price: add them to "prices". */
  unpricedModels: string[];
  /** models: what the sessions reported (the runner's choice may differ from what the CLI actually used). */
  agents: { agentId: string; models: string[]; sessions: number; ms: number; usage: TokenUsage | null; costUsd: number | null; costEstimated: boolean; skills: string[] }[];
  /** Tasks whose sessions also finished this one: its tokens are counted there. */
  countedIn: string[];
  /** Part of costUsd: the jobs the lead delegated (their own tasks) and the plan critic's runs. */
  jobsCostUsd?: number;
  criticCostUsd?: number;
}

const ZERO: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

function add(a: TokenUsage | null, b: TokenUsage | undefined): TokenUsage | null {
  if (!b) return a;
  const base = a ?? ZERO;
  return { input: base.input + b.input, output: base.output + b.output, cacheRead: base.cacheRead + b.cacheRead, cacheCreation: base.cacheCreation + b.cacheCreation, total: base.total + b.total };
}

export function taskStats(task: Task, sessions: SessionRecord[], countedIn: string[], now = new Date(), prices?: Prices, rates: ModelRates = learnRates(sessions)): TaskStats | null {
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
    if (row) {
      row.ms += ms;
      row.visits.push(ms);
    } else phases.push({ phase: h.phase, ms, visits: [ms] });
  });

  let usage: TokenUsage | null = null;
  let costUsd: number | null = null;
  let costEstimated = false;
  const unpriced = new Set<string>();
  const agents = new Map<string, TaskStats["agents"][number]>();
  for (const s of sessions) {
    usage = add(usage, s.usage);
    const { usd: cost, estimated } = sessionCost(s, prices, rates);
    if (s.usage && cost === undefined) unpriced.add(s.model ?? "unknown model");
    if (cost !== undefined) costUsd = (costUsd ?? 0) + cost;
    if (estimated) costEstimated = true;
    const a = agents.get(s.agentId) ?? { agentId: s.agentId, models: [], sessions: 0, ms: 0, usage: null, costUsd: null, costEstimated: false, skills: [] };
    if (s.model && !a.models.includes(s.model)) a.models.push(s.model);
    for (const k of s.skills ?? []) if (!a.skills.includes(k)) a.skills.push(k);
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

/**
 * What a task spent outside its own sessions: the jobs its lead delegated (tasks of their own, whose sessions are not the
 * task's) and the plan critic's runs. Both are part of the task's price and of its cost limit.
 */
export async function attachedCost(fs: FileStore, task: Task, tasks: Task[], prices?: Prices, rates?: ModelRates): Promise<{ jobsUsd: number; criticUsd: number; unknown: number }> {
  let jobsUsd = 0;
  let unknown = 0;
  const store = new SessionStore(fs);
  for (const job of tasks.filter((t) => t.jobOf?.taskId === task.id)) {
    for (const s of await store.list(job.id)) {
      const c = sessionCost(s, prices, rates);
      if (c.usd === undefined) unknown++;
      else jobsUsd += c.usd;
    }
  }
  let criticUsd = 0;
  if (reviewsPages(task)) {
    for (const v of (await readPlanState(fs, task.id)).versions) {
      const c = await fs.readJson<{ costUsd?: number }>(["tasks", task.id, "plan", `critique-v${v.n}.json`]);
      criticUsd += c?.costUsd ?? 0;
    }
  }
  return { jobsUsd, criticUsd, unknown };
}

/** Statistics of every task of the network (null for tasks without phaseHistory). */
export async function collectStats(fs: FileStore, tasks: Task[], now = new Date(), prices?: Prices, only?: Set<string>): Promise<Map<string, TaskStats | null>> {
  const store = new SessionStore(fs);
  // only: the tasks to count (the page keeps finished ones it counted before); the others still find their jobs in tasks
  const counted = only ? tasks.filter((t) => only.has(t.id)) : tasks;
  const sessions = new Map(await Promise.all(counted.map(async (t) => [t.id, await store.list(t.id)] as const)));
  // what each model costs, from every counted session: a task's first session stopped at the context limit gets a price too
  const rates = learnRates([...sessions.values()].flat());
  const countedIn = new Map<string, string[]>();
  for (const [taskId, list] of sessions) {
    for (const s of list) for (const other of s.alsoFinished ?? []) countedIn.set(other, [...new Set([...(countedIn.get(other) ?? []), taskId])]);
  }
  return new Map(
    await Promise.all(
      counted.map(async (t) => {
        const stats = taskStats(t, sessions.get(t.id) ?? [], countedIn.get(t.id) ?? [], now, prices, rates);
        if (!stats) return [t.id, null] as const;
        // the delegated jobs and the plan critic are part of the task's price
        const { jobsUsd, criticUsd } = await attachedCost(fs, t, tasks, prices, rates);
        if (!jobsUsd && !criticUsd) return [t.id, stats] as const;
        return [t.id, { ...stats, costUsd: (stats.costUsd ?? 0) + jobsUsd + criticUsd, ...(jobsUsd ? { jobsCostUsd: jobsUsd } : {}), ...(criticUsd ? { criticCostUsd: criticUsd } : {}) }] as const;
      }),
    ),
  );
}
