import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../errors.js";
import { buildArgv, FALLBACK_SYSTEM_PROMPT, isValidModel, runSession, usesModel, withModel, type SessionRun } from "../runner.js";
import { nextRun, parseCron } from "../schedule/cron.js";
import type { ActivityItem } from "../sessionOutput.js";
import { sessionCost, type Prices } from "../stats.js";
import { FileStore } from "../storage/fileStore.js";
import { PACKAGE_DIR, type ObserverConfig } from "../ui/runners.js";
import { collectDigests, readDigests } from "./digest.js";
import { ObserverStore } from "./store.js";

export interface ObserverRun {
  at: string;
  endedAt?: string;
  /** button | cron */
  by: string;
  model?: string;
  exitCode?: number;
  costUsd?: number;
  /** The report the session saved, if it did. */
  reportId?: string;
  /** The session's last words (why there is no report, for one). */
  text?: string;
}

export interface ObserverOptions {
  networkDir: string;
  config: ObserverConfig;
  prices?: () => Promise<{ prices?: Prices }>;
  log?: (line: string) => void;
  /** Tests: the CLI session. */
  run?: (argv: string[], env: NodeJS.ProcessEnv, cwd: string, sink: ((t: string) => void) | null, signal?: AbortSignal, onEvent?: (e: ActivityItem) => void) => Promise<SessionRun>;
  /** The session's calls in the page's activity feed. */
  onActivity?: (e: ActivityItem) => void;
  /** How often digests are collected and the cron looked at. Default 60 s. */
  pollMs?: number;
  now?: () => number;
}

/**
 * The observer: digests of closed tasks are collected without a model; a CLI session (button or cron) reads the new
 * ones with its own MCP tools (observer-mcp) and saves a report, the issues it tracks and proposals the operator
 * accepts (a task for the swarm) or rejects on the page.
 */
export class Observer {
  private timer?: NodeJS.Timeout;
  private looping = false;
  private current: { run: ObserverRun; done: Promise<void>; abort: AbortController } | null = null;
  private model: string | undefined;
  private dueAt: number | null = null;

  constructor(private readonly opts: ObserverOptions) {
    this.model = opts.config.model;
  }

  private get now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  start(): void {
    if (this.looping) return;
    this.looping = true;
    const loop = () => {
      if (!this.looping) return;
      void this.tick()
        .catch((e: Error) => this.opts.log?.(`[observer] ${e.message}`))
        .finally(() => {
          if (this.looping) this.timer = setTimeout(loop, this.opts.pollMs ?? 60_000);
        });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.looping = false;
    clearTimeout(this.timer);
    this.current?.abort.abort();
    await this.current?.done;
  }

  /** Collect new digests; start a run when its cron is due. Public for tests. */
  async tick(): Promise<void> {
    const prices = (await this.opts.prices?.())?.prices;
    const written = await collectDigests(this.opts.networkDir, prices);
    if (written.length) this.opts.log?.(`[observer] digests: ${written.join(", ")}`);
    if (!this.opts.config.cron) return;
    if (this.dueAt === null) this.dueAt = nextRun(parseCron(this.opts.config.cron), new Date(this.now))?.getTime() ?? null;
    if (this.dueAt !== null && this.now >= this.dueAt && !this.current) {
      this.dueAt = nextRun(parseCron(this.opts.config.cron), new Date(this.now))?.getTime() ?? null;
      const fresh = await this.uncovered();
      if (fresh) await this.runNow("cron");
      else this.opts.log?.("[observer] cron: no new closed tasks since the last report; skipped");
    }
  }

  private async uncovered(): Promise<number> {
    const covered = new Set((await (await ObserverStore.open(this.opts.networkDir)).reports()).flatMap((r) => r.covers));
    return (await readDigests(this.opts.networkDir)).filter((d) => !covered.has(d.taskId)).length;
  }

  setModel(model: string): void {
    if (!isValidModel(model)) throw new AppError("INVALID_INPUT", `Not a model name: ${model}`);
    if (!usesModel(this.opts.config.command)) throw new AppError("INVALID_INPUT", "The observer's command has no {model}");
    this.model = model;
  }

  /** Starts a session in the background; refused while one runs. */
  async runNow(by: string): Promise<ObserverRun> {
    if (this.current) throw new AppError("INVALID_INPUT", "The observer is at work already");
    await collectDigests(this.opts.networkDir, (await this.opts.prices?.())?.prices);
    const run: ObserverRun = { at: new Date(this.now).toISOString(), by, ...(this.model ? { model: this.model } : {}) };
    const abort = new AbortController();
    const done = this.session(run, abort.signal).catch((e: Error) => this.opts.log?.(`[observer] ${e.message}`)).finally(() => {
      this.current = null;
    });
    this.current = { run, done, abort };
    return run;
  }

  /** Waits for the running session (tests). */
  async idle(): Promise<void> {
    await this.current?.done;
  }

  async status() {
    const fs = await FileStore.open(this.opts.networkDir);
    const runs = (await fs.readJson<ObserverRun[]>(["observer", "runs.json"])) ?? [];
    const digests = await readDigests(this.opts.networkDir);
    return {
      running: this.current?.run ?? null,
      model: usesModel(this.opts.config.command) ? (this.model ?? null) : null,
      models: [...new Set([...(this.opts.config.models ?? []), ...(this.model ? [this.model] : [])])],
      cli: this.opts.config.command[0]!.split("/").at(-1)!,
      cron: this.opts.config.cron ?? null,
      nextRunAt: this.opts.config.cron ? (nextRun(parseCron(this.opts.config.cron), new Date(this.now))?.toISOString() ?? null) : null,
      digests: { total: digests.length, uncovered: await this.uncovered() },
      runs: runs.slice(-10).reverse(),
    };
  }

  private async session(run: ObserverRun, signal: AbortSignal): Promise<void> {
    const cfg = this.opts.config;
    const fs = await FileStore.open(this.opts.networkDir);
    const store = await ObserverStore.open(this.opts.networkDir);
    const before = (await store.reports()).at(-1)?.id;
    const instructions = (await readFile(cfg.promptFile, "utf8").catch(() => "")).trim() || "You are the observer of an agent-network swarm. Use digests and history, then save_report.";
    const brief = { networkDir: this.opts.networkDir, agentNetworkSource: PACKAGE_DIR, newClosedTasks: await this.uncovered() };
    const prompt = `${instructions}\n\nThis run (JSON):\n${JSON.stringify(brief, null, 2)}`;
    const system = cfg.command.some((a) => a.includes("{systemPrompt}")) ? (cfg.systemPromptFile ? (await readFile(cfg.systemPromptFile, "utf8").catch(() => "")).trim() : "") || FALLBACK_SYSTEM_PROMPT : undefined;
    // {networkDir}: the network folder (e.g. --add-dir {networkDir}), so its read tools reach the logs
    const argv = buildArgv(withModel(cfg.command, this.model).map((a) => a.replaceAll("{networkDir}", this.opts.networkDir)), prompt, system);
    // its own empty folder: a CLI started in the project would load the project's CLAUDE.md and hooks
    const cwd = join(tmpdir(), "agent-network-observer", createHash("sha1").update(this.opts.networkDir).digest("hex").slice(0, 12));
    await mkdir(cwd, { recursive: true });
    this.opts.log?.(`[observer] run (${run.by})${this.model ? `, model ${this.model}` : ""}: ${brief.newClosedTasks} new closed task(s)`);
    const exec = this.opts.run ?? runSession;
    let res: SessionRun;
    try {
      res = await exec(argv, { ...process.env, NETWORK_DIR: this.opts.networkDir, AGENT_NETWORK_SOURCE: PACKAGE_DIR }, cwd, null, signal, this.opts.onActivity);
    } catch (e) {
      res = { code: 1, result: { text: (e as Error).message } as SessionRun["result"] };
    }
    const after = (await store.reports()).at(-1)?.id;
    const cost = sessionCost({ id: "", taskId: "", agentId: "observer", attempt: 1, startedAt: run.at, endedAt: new Date(this.now).toISOString(), durationMs: 0, exitCode: res.code, ...(res.result?.usage ? { usage: res.result.usage } : {}), ...(res.result?.costUsd !== undefined ? { costUsd: res.result.costUsd } : {}), ...(this.model ? { model: this.model } : {}) }, (await this.opts.prices?.())?.prices);
    Object.assign(run, {
      endedAt: new Date(this.now).toISOString(),
      exitCode: res.code,
      ...(cost.usd !== undefined ? { costUsd: Math.round(cost.usd * 1000) / 1000 } : {}),
      ...(after && after !== before ? { reportId: after } : {}),
      ...(res.result?.text ? { text: res.result.text.slice(0, 500) } : {}),
    });
    const runs = (await fs.readJson<ObserverRun[]>(["observer", "runs.json"])) ?? [];
    await fs.writeJson(["observer", "runs.json"], [...runs, run].slice(-50));
    this.opts.log?.(`[observer] ${run.reportId ? `report ${run.reportId}` : "no report saved"} (exit ${res.code}${run.costUsd !== undefined ? `, $${run.costUsd}` : ""})`);
  }
}
