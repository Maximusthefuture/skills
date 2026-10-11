import { AppError } from "../errors.js";
import { NetworkService } from "../service.js";
import { FileStore } from "../storage/fileStore.js";
import { loadRunnersConfig, saveScheduleEnabled, type ScheduleConfig } from "../ui/runners.js";
import { nextRun, parseCron } from "./cron.js";

/** One schedule's history: <network>/schedules/state.json. */
interface Run {
  at: string;
  /** The task it created, or why it did not. */
  taskId?: string;
  skipped?: string;
  error?: string;
  manual?: true;
}

type State = Record<string, { runs: Run[] }>;

export interface ScheduleView {
  id: string;
  cron: string;
  title: string;
  agents: string[];
  openspec: string | null;
  enabled: boolean;
  nextRunAt: string | null;
  /** The latest runs, newest first. */
  runs: Run[];
  /** The task of the latest run while it is still open (the next run waits for it). */
  openTask: string | null;
}

export interface SchedulerOptions {
  networkDir: string;
  schedules: ScheduleConfig[];
  /** runners.json: read again on every look (edits apply at once), "enabled" is written back. */
  configPath?: string;
  /** The project the config was loaded for (a config without "project" reads it from here). */
  projectDir?: string;
  /** How often it looks. Default 30 s. */
  pollMs?: number;
  /** Cost limit of a schedule's task that sets none ("maxTaskCostUsd" of runners.json, read again with the file). */
  maxTaskCostUsd?: number;
  now?: () => number;
  log?: (line: string) => void;
}

const fill = (text: string, at: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return text.replaceAll("{date}", date).replaceAll("{time}", `${pad(at.getHours())}:${pad(at.getMinutes())}`);
};

/**
 * Creates the tasks of "schedules" (runners.json) on their cron, without a model: the runners pick them up like any task
 * created on the page. A run is skipped while the task of the previous run is still open, so a slow task never piles up
 * copies of itself. Runs missed while the page was down are not made up (like cron).
 */
export class Scheduler {
  private readonly fs: Promise<FileStore>;
  private readonly operator: Promise<NetworkService>;
  private state?: State;
  private next = new Map<string, { cron: string; at: number | null }>();
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  private running = false;
  private configError: string | null = null;
  private maxTaskCostUsd?: number;

  constructor(private readonly opts: SchedulerOptions) {
    this.fs = FileStore.open(opts.networkDir);
    this.maxTaskCostUsd = opts.maxTaskCostUsd;
    this.operator = NetworkService.create(opts.networkDir, { id: "operator", type: "scheduler" });
  }

  private get now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.ticking = this.tick().catch((e: Error) => this.opts.log?.(`[schedules] ${e.message}`));
      void this.ticking.finally(() => {
        if (this.running) this.timer = setTimeout(loop, this.opts.pollMs ?? 30_000);
      });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.ticking;
  }

  /** One look: every enabled schedule that is due creates its task (or records why not). Public for tests. */
  async tick(): Promise<void> {
    await this.reloadConfig();
    for (const s of this.opts.schedules) {
      const due = this.dueAt(s);
      if (!s.enabled || due === null || this.now < due) continue;
      await this.fire(s, false);
      this.next.set(s.id, { cron: s.cron, at: nextRun(parseCron(s.cron), new Date(this.now))?.getTime() ?? null });
    }
  }

  /** "Run now" on the page: the same as a scheduled run (and skipped the same way while the last task is open). */
  async runNow(id: string): Promise<Run> {
    return this.fire(this.get(id), true);
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduleView[]> {
    const s = this.get(id);
    s.enabled = enabled;
    if (this.opts.configPath) await saveScheduleEnabled(this.opts.configPath, id, enabled);
    if (enabled) this.next.delete(id); // from now on, not a run missed while it was off
    this.opts.log?.(`[schedules] ${id}: ${enabled ? "on" : "off"}`);
    return this.status();
  }

  async status(): Promise<ScheduleView[]> {
    const state = await this.load();
    const tasks = await (await this.operator).tasks.list();
    return this.opts.schedules.map((s) => {
      const runs = state[s.id]?.runs ?? [];
      const last = runs.find((r) => r.taskId);
      const open = last?.taskId ? tasks.find((t) => t.id === last.taskId && (t.status === "ACTIVE" || t.status === "BLOCKED")) : undefined;
      const at = s.enabled ? this.dueAt(s) : null;
      return {
        id: s.id, cron: s.cron, title: s.title || s.openspec || s.id, agents: s.agents, openspec: s.openspec ?? null, enabled: s.enabled,
        nextRunAt: at === null ? null : new Date(at).toISOString(), runs: runs.slice(0, 10), openTask: open?.id ?? null,
      };
    });
  }

  private get(id: string): ScheduleConfig {
    const s = this.opts.schedules.find((x) => x.id === id);
    if (!s) throw new AppError("INVALID_INPUT", `No schedule "${id}" (${this.opts.schedules.map((x) => x.id).join(", ") || "none"})`);
    return s;
  }

  /** When it runs next: computed from now the first time it is seen (or its cron changed), so no missed run fires. */
  private dueAt(s: ScheduleConfig): number | null {
    const known = this.next.get(s.id);
    if (known && known.cron === s.cron) return known.at;
    const at = nextRun(parseCron(s.cron), new Date(this.now))?.getTime() ?? null;
    this.next.set(s.id, { cron: s.cron, at });
    return at;
  }

  private async fire(s: ScheduleConfig, manual: boolean): Promise<Run> {
    const state = await this.load();
    const runs = (state[s.id] ??= { runs: [] }).runs;
    const at = new Date(this.now);
    const operator = await this.operator;
    const last = runs.find((r) => r.taskId);
    const open = last?.taskId ? await operator.tasks.find(last.taskId) : null;
    let run: Run;
    if (open && (open.status === "ACTIVE" || open.status === "BLOCKED")) {
      run = { at: at.toISOString(), skipped: `${open.id} of the previous run is still ${open.status}`, ...(manual ? { manual: true as const } : {}) };
    } else {
      try {
        const task = await operator.createTaskAsOperator({
          title: fill(s.title, at),
          description: fill(s.description, at),
          agents: s.agents,
          ...(s.openspec ? { openspec: s.openspec } : {}),
          ...(s.verifyCommand ? { verifyCommand: s.verifyCommand } : {}),
          ...(s.maxFixRounds !== undefined ? { maxFixRounds: s.maxFixRounds } : {}),
          ...(s.maxFollowUps !== undefined ? { maxFollowUps: s.maxFollowUps } : {}),
          ...((s.maxCostUsd ?? this.maxTaskCostUsd) !== undefined ? { maxCostUsd: s.maxCostUsd ?? this.maxTaskCostUsd } : {}),
        });
        run = { at: at.toISOString(), taskId: task.id, ...(manual ? { manual: true as const } : {}) };
      } catch (e) {
        run = { at: at.toISOString(), error: (e as Error).message, ...(manual ? { manual: true as const } : {}) };
      }
    }
    runs.unshift(run);
    runs.splice(30);
    await this.save();
    this.opts.log?.(`[schedules] ${s.id}${manual ? " (run now)" : ""}: ${run.taskId ? `created ${run.taskId}` : run.skipped ? `skipped: ${run.skipped}` : `failed: ${run.error}`}`);
    return run;
  }

  /** The "schedules" of the config file as it is now; a broken file keeps the last good ones and says so once. */
  private async reloadConfig(): Promise<void> {
    if (!this.opts.configPath) return;
    try {
      const config = await loadRunnersConfig(this.opts.configPath, this.opts.projectDir ? { projectDir: this.opts.projectDir } : {});
      this.opts.schedules = config.schedules ?? [];
      this.maxTaskCostUsd = config.maxTaskCostUsd;
      this.configError = null;
    } catch (e) {
      const message = (e as Error).message;
      if (message !== this.configError) this.opts.log?.(`[schedules] runners.json cannot be read (${message}); the last good schedules stay`);
      this.configError = message;
    }
  }

  private async load(): Promise<State> {
    this.state ??= (await (await this.fs).readJson<State>(["schedules", "state.json"])) ?? {};
    return this.state;
  }

  private async save(): Promise<void> {
    if (this.state) await (await this.fs).writeJson(["schedules", "state.json"], this.state);
  }
}
