import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../errors.js";
import { progressMark } from "../progress.js";
import { buildArgv, FALLBACK_SYSTEM_PROMPT, isValidModel, runSession, usesModel, withModel, type SessionRun } from "../runner.js";
import { OPERATOR } from "../service.js";
import type { ActivityItem } from "../sessionOutput.js";
import { sessionCost, type Prices } from "../stats.js";
import { FileStore } from "../storage/fileStore.js";
import { MessageStore } from "../stores/messageStore.js";
import { SessionStore } from "../stores/sessionStore.js";
import { TaskStore } from "../stores/taskStore.js";
import type { RunnerPool, SupervisorConfig } from "../ui/runners.js";
import { loadRunnersConfig, saveSupervisorField } from "../ui/runners.js";
import { BUILTIN_DESCRIPTIONS, BUILTIN_TOOLS } from "./tools.js";
import { DEFAULT_RULES, detect, emptyMemory, testProcesses, type DetectMemory, type Incident, type Snapshot } from "./detect.js";
import { Journal } from "./journal.js";
import { claudeTranscript, SessionLog } from "./sessionLog.js";

export const SUPERVISOR_ID = "supervisor";

/** What survives a restart of the UI: handled incidents, progress clocks, recent sessions (for the hourly and daily limits). */
interface State extends DetectMemory {
  sessions: { at: string; usd: number | null }[];
}

export interface SupervisorOptions {
  networkDir: string;
  config: SupervisorConfig;
  pool: RunnerPool;
  /** Where the config came from: a model chosen on the page is written back there. */
  configPath?: string;
  /** The project's token prices, for CLIs that report no cost (Qwen, local models). */
  prices?: () => Promise<{ prices?: Prices }>;
  /** Where its CLI sessions run; default: its own folder under the system temp dir, outside the project. */
  cwd?: string;
  /** How often the detector looks. Default 10 s. */
  pollMs?: number;
  /** Tests: replace the CLI session, `ps` and the clock. */
  run?: (argv: string[], env: NodeJS.ProcessEnv, cwd: string, sink: (text: string) => void, signal: AbortSignal, onEvent: (e: ActivityItem) => void) => Promise<SessionRun>;
  ps?: () => Promise<string>;
  now?: () => number;
}

export interface SupervisorStatus {
  enabled: boolean;
  /** The supervisor session open right now. */
  session: { startedAt: string; incidents: string[]; model?: string } | null;
  cli: string;
  model: string | null;
  models: string[];
  rules: SupervisorConfig["rules"];
  maxSessionsPerHour: number;
  budgetUsd: number | null;
  sessionsLastHour: number;
  /** Cost of its sessions in the last 24 h; unpriced = sessions whose cost is unknown (no CLI cost, no price). */
  spend24h: { usd: number; unpriced: number };
  /** Incidents waiting for the next session. */
  queued: number;
  /** Why it does not start a session although incidents wait, if so. */
  held: string | null;
  /** Its tools: built-in and the operator's own, each on or off. */
  tools: { name: string; builtin: boolean; description: string; enabled: boolean }[];
  log: string[];
}

const ps = (): Promise<string> =>
  new Promise((done) => execFile("ps", ["-axo", "pid=,etime=,command="], { maxBuffer: 16 * 1024 * 1024 }, (err, out) => done(err ? "" : out)));

/**
 * Looks after the agents of one project without a model (detect.ts) and starts a supervisor session (a CLI with the
 * supervisor's MCP tools, see mcp.ts) only when something needs a look: one session at a time, within the hourly and
 * daily limits. Its sessions are recorded like the agents' (agentId "supervisor"), so their cost shows in the task
 * statistics and on the Runs tab; what it saw and did goes into its journal.
 */
export class Supervisor {
  private readonly fs: Promise<FileStore>;
  private readonly journal: Promise<Journal>;
  private state?: State;
  private queue: Incident[] = [];
  private enabled = false;
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  private current: { startedAt: string; incidents: string[]; checkIns: Incident[]; model?: string; controller: AbortController; done: Promise<void> } | null = null;
  private held: string | null = null;
  private configError: string | null = null;
  /** Changes made on the page: while one is being written, and for a read that overlapped one, the file is not re-read. */
  private edits = 0;
  private editing = 0;

  /** Runs a change made on the page so that no re-read of the file overlaps it (it would bring the old value back). */
  private async edit<T>(change: () => Promise<T>): Promise<T> {
    this.editing++;
    try {
      return await change();
    } finally {
      this.editing--;
      this.edits++;
    }
  }
  private lines: string[] = [];
  private partial = "";
  private uiUrl?: string;
  private projectId?: string;

  constructor(private readonly opts: SupervisorOptions) {
    this.fs = FileStore.open(opts.networkDir);
    this.journal = this.fs.then((fs) => new Journal(fs));
  }

  private get now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** The page's address and this project's id there: the supervisor's tools call the same API as the page. */
  attach(uiUrl: string, projectId: string): void {
    this.uiUrl = uiUrl;
    this.projectId = projectId;
  }

  start(): SupervisorStatus {
    if (!this.enabled) {
      this.enabled = true;
      this.say("[supervisor] watching");
      const loop = () => {
        if (!this.enabled) return;
        this.ticking = this.tick().catch((e: Error) => this.say(`[supervisor] detector failed: ${e.message}`));
        void this.ticking.finally(() => {
          if (this.enabled) this.timer = setTimeout(loop, this.opts.pollMs ?? 10_000);
        });
      };
      loop();
    }
    return this.statusNow();
  }

  /** Stops watching and ends a running supervisor session. */
  async stop(): Promise<SupervisorStatus> {
    this.enabled = false;
    clearTimeout(this.timer);
    this.current?.controller.abort();
    await this.ticking;
    await this.current?.done;
    this.say("[supervisor] stopped");
    return this.statusNow();
  }

  async status(): Promise<SupervisorStatus> {
    await this.load();
    return this.statusNow();
  }

  /** Switch one of its tools on or off from the next session; written back to the config file ("disabledTools"). */
  async setToolEnabled(name: string, enabled: boolean): Promise<SupervisorStatus> {
    return this.edit(async () => {
      const cfg = this.opts.config;
      const known = [...BUILTIN_TOOLS, ...cfg.tools.map((t) => t.name)] as string[];
      if (!known.includes(name)) throw new AppError("INVALID_INPUT", `No supervisor tool "${name}" (tools: ${known.join(", ")})`);
      cfg.disabledTools = enabled ? cfg.disabledTools.filter((n) => n !== name) : [...new Set([...cfg.disabledTools, name])];
      if (this.opts.configPath) await saveSupervisorField(this.opts.configPath, "disabledTools", cfg.disabledTools);
      this.say(`[supervisor] tool ${name}: ${enabled ? "on" : "off"} (applies from the next session)`);
      return this.statusNow();
    });
  }

  /** Thresholds of the detector (DetectRules), checked and written back to the config file; the next look uses them. */
  async setRules(raw: unknown): Promise<SupervisorStatus> {
    return this.edit(async () => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_INPUT", "rules must be an object, e.g. {\"checkInMin\": 10}");
      const rules = { ...this.opts.config.rules };
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!(k in DEFAULT_RULES)) throw new AppError("INVALID_INPUT", `Unknown rule "${k}" (${Object.keys(DEFAULT_RULES).join(", ")})`);
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new AppError("INVALID_INPUT", `rules.${k} must be a number > 0`);
        rules[k as keyof typeof rules] = v;
      }
      this.opts.config.rules = rules;
      if (this.opts.configPath) await saveSupervisorField(this.opts.configPath, "rules", rules);
      this.say(`[supervisor] rules: ${Object.entries(rules).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      return this.statusNow();
    });
  }

  /** Sessions an hour and USD a day (null = no budget), checked and written back to the config file; applies at once. */
  async setLimits(raw: { maxSessionsPerHour?: unknown; budgetUsd?: unknown }): Promise<SupervisorStatus> {
    return this.edit(async () => {
      const cfg = this.opts.config;
      if (raw.maxSessionsPerHour !== undefined) {
        const n = raw.maxSessionsPerHour;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 100) throw new AppError("INVALID_INPUT", "maxSessionsPerHour must be a whole number 1..100");
        cfg.maxSessionsPerHour = n;
        if (this.opts.configPath) await saveSupervisorField(this.opts.configPath, "maxSessionsPerHour", n);
      }
      if (raw.budgetUsd !== undefined) {
        const b = raw.budgetUsd;
        if (b !== null && (typeof b !== "number" || !Number.isFinite(b) || b < 0)) throw new AppError("INVALID_INPUT", "budgetUsd must be a number >= 0, or null for no budget");
        if (b === null) delete cfg.budgetUsd;
        else cfg.budgetUsd = b;
        if (this.opts.configPath) await saveSupervisorField(this.opts.configPath, "budgetUsd", b);
      }
      this.say(`[supervisor] limits: ${cfg.maxSessionsPerHour} sessions an hour, ${cfg.budgetUsd === undefined ? "no budget" : `$${cfg.budgetUsd} a day`}`);
      return this.statusNow();
    });
  }

  /** The model of the next session; written back to the config file. */
  async setModel(raw: string): Promise<SupervisorStatus> {
    return this.edit(async () => {
      const model = raw.trim();
      if (!usesModel(this.opts.config.command)) throw new AppError("INVALID_INPUT", 'The supervisor command has no {model}: put "{model}" where it names the model and set "model"');
      if (!isValidModel(model)) throw new AppError("INVALID_INPUT", `Not a model name: ${JSON.stringify(raw)} (no spaces, not starting with "-")`);
      this.opts.config.model = model;
      if (this.opts.configPath) await saveSupervisorField(this.opts.configPath, "model", model);
      this.say(`[supervisor] model: ${model}${this.current ? " (applies from the next session)" : ""}`);
      return this.statusNow();
    });
  }

  /** One look: snapshot, new incidents into the journal and the queue, maybe a session. Public for tests. */
  async tick(): Promise<void> {
    await this.reloadConfig(); // rules, limits and tools apply without a restart
    const state = await this.load();
    const fs = await this.fs;
    // one check-in per agent at a time: while one waits in the queue or is being looked at, the next minutes add nothing
    const checking = new Set([...this.queue, ...(this.current?.checkIns ?? [])].filter((i) => i.kind === "check-in").map((i) => `${i.agentId}:${i.taskId}`));
    const incidents = detect(await this.snapshot(fs), state, this.opts.config.rules).filter((i) => i.kind !== "check-in" || !checking.has(`${i.agentId}:${i.taskId}`));
    for (const i of incidents) {
      state.handled[i.key] = new Date(this.now).toISOString();
      this.queue.push(i);
      await (await this.journal).add({ kind: "incident", by: "detector", ...(i.taskId ? { taskId: i.taskId } : {}), text: i.summary, data: { kind: i.kind, ...i.data } });
    }
    await this.save();
    if (!this.current && this.queue.length && this.enabled) await this.maybeStart(state);
  }

  private async maybeStart(state: State): Promise<void> {
    const hourAgo = this.now - 3600_000;
    const dayAgo = this.now - 24 * 3600_000;
    const lastHour = state.sessions.filter((s) => Date.parse(s.at) >= hourAgo).length;
    const spent = state.sessions.filter((s) => Date.parse(s.at) >= dayAgo).reduce((a, s) => a + (s.usd ?? 0), 0);
    const { maxSessionsPerHour, budgetUsd } = this.opts.config;
    const held =
      lastHour >= maxSessionsPerHour
        ? `${lastHour} supervisor sessions in the last hour (limit ${maxSessionsPerHour})`
        : budgetUsd !== undefined && spent >= budgetUsd
          ? `$${spent.toFixed(2)} spent in 24 h (budget $${budgetUsd})`
          : !this.uiUrl
            ? "the page is not up yet"
            : null;
    if (held !== this.held && held) await (await this.journal).add({ kind: "note", by: "detector", text: `Supervisor holds ${this.queue.length} incident(s): ${held}` });
    this.held = held;
    if (held) return;

    const incidents = this.queue.splice(0);
    const fs = await this.fs;
    const model = usesModel(this.opts.config.command) ? this.opts.config.model : undefined;
    const controller = new AbortController();
    const startedAt = new Date(this.now);
    const done = this.session(fs, incidents, model, controller.signal, startedAt).finally(() => {
      this.current = null;
    });
    this.current = { startedAt: startedAt.toISOString(), incidents: incidents.map((i) => i.key), checkIns: incidents.filter((i) => i.kind === "check-in"), ...(model ? { model } : {}), controller, done };
  }

  private async session(fs: FileStore, incidents: Incident[], model: string | undefined, signal: AbortSignal, startedAt: Date): Promise<void> {
    await this.reloadConfig(); // the operator may have added or removed tools, rules or limits: no restart needed
    const cfg = this.opts.config;
    const folders = this.opts.pool.list().filter((r) => r.cwd).map((r) => ({ agentId: r.id, cwd: r.cwd! }));
    const instructions = (await readFile(cfg.promptFile, "utf8").catch(() => "")).trim() || "You are the supervisor of an agent-network swarm. Use your tools to look into the incidents below and resolve them.";
    const brief = {
      project: this.projectId,
      incidents: incidents.map((i) => ({ kind: i.kind, taskId: i.taskId ?? null, agentId: i.agentId ?? null, summary: i.summary, data: i.data ?? {} })),
    };
    const prompt = `${instructions}\n\nIncidents to look into (JSON):\n${JSON.stringify(brief, null, 2)}`;
    const wantsSystem = cfg.command.some((a) => a.includes("{systemPrompt}"));
    const system = wantsSystem ? (cfg.systemPromptFile ? (await readFile(cfg.systemPromptFile, "utf8").catch(() => "")).trim() : "") || FALLBACK_SYSTEM_PROMPT : undefined;
    const argv = buildArgv(withModel(cfg.command, model), prompt, system);
    const env = {
      ...process.env,
      AGENT_NETWORK_UI_URL: this.uiUrl ?? "",
      AGENT_NETWORK_PROJECT: this.projectId ?? "",
      NETWORK_DIR: this.opts.networkDir,
      AGENT_NETWORK_SUPERVISOR_FOLDERS: JSON.stringify(folders),
      AGENT_NETWORK_SUPERVISOR_TOOLS: JSON.stringify({ tools: cfg.tools, disabled: cfg.disabledTools }),
    };
    this.say(`[supervisor] session for ${incidents.length} incident(s): ${incidents.map((i) => i.kind).join(", ")}${model ? ` (model ${model})` : ""}`);
    const run = this.opts.run ?? ((a, e, c, sink, sig, ev) => runSession(a, e, c, sink, sig, ev));
    const taskOf = incidents.find((i) => i.taskId)?.taskId;
    // its own empty folder, not the project: a CLI started in the project would load the project's CLAUDE.md, hooks and
    // settings, which are written for the agents (in a live run the critic gate made the supervisor ask for pre-mortems)
    const cwd = this.opts.cwd ?? join(tmpdir(), "agent-network-supervisor", createHash("sha1").update(this.opts.networkDir).digest("hex").slice(0, 12));
    await mkdir(cwd, { recursive: true }).catch(() => undefined);
    // the whole session on disk (prompt, every call and result, its text): what it did and why, for later analysis
    const log = await SessionLog.create(this.opts.networkDir).catch((e: Error) => {
      this.say(`[supervisor] cannot write the session log: ${e.message}`);
      return null;
    });
    log?.write({ type: "start", at: startedAt.toISOString(), session: log.id, cli: cfg.command[0]!.split("/").at(-1)!, ...(model ? { model } : {}), incidents: brief.incidents, prompt });
    const feed = (e: ActivityItem) => {
      this.opts.pool.recordActivity(SUPERVISOR_ID, e, taskOf ? { taskId: taskOf } : {}); // its calls show in the activity feed too
      log?.write({ type: "event", at: new Date().toISOString(), ...e });
    };
    let res: SessionRun;
    try {
      res = await run(argv, env, cwd, (text) => this.push(text), signal, feed);
    } catch (e) {
      res = { code: 1 };
      this.say(`[supervisor] cannot start: ${(e as Error).message}`);
    }
    const endedAt = new Date(this.now);
    const taskId = incidents.find((i) => i.taskId)?.taskId;
    const sessions = new SessionStore(fs);
    const record = {
      taskId: taskId ?? "",
      agentId: SUPERVISOR_ID,
      attempt: taskId ? (await sessions.list(taskId)).filter((s) => s.agentId === SUPERVISOR_ID).length + 1 : 1,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      exitCode: res.code,
      ...(res.result?.usage ? { usage: res.result.usage } : {}),
      ...(res.result?.costUsd !== undefined ? { costUsd: res.result.costUsd } : {}),
      ...(res.result?.numTurns !== undefined ? { numTurns: res.result.numTurns } : {}),
      ...(res.result?.model || model ? { model: res.result?.model ?? model } : {}),
    };
    if (taskId) await sessions.create(record).catch((e: Error) => this.say(`[supervisor] cannot record the session: ${e.message}`));
    const prices = (await this.opts.prices?.())?.prices;
    const cost = sessionCost({ id: "", ...record }, prices);
    const state = await this.load();
    state.sessions = [...state.sessions.filter((s) => Date.parse(s.at) >= this.now - 24 * 3600_000), { at: startedAt.toISOString(), usd: cost.usd ?? null }];
    await this.save();
    const usd = cost.usd !== undefined ? ` · $${cost.usd.toFixed(2)}${cost.estimated ? " (by your prices)" : ""}` : " · cost unknown (no CLI cost, no price for the model)";
    const outcome = res.result?.text ? `: ${res.result.text}` : "";
    const transcript = res.sessionId ? await claudeTranscript(cwd, res.sessionId) : undefined;
    log?.write({
      type: "end", at: endedAt.toISOString(), exitCode: res.code,
      ...(res.result?.numTurns !== undefined ? { numTurns: res.result.numTurns } : {}),
      ...(cost.usd !== undefined ? { usd: cost.usd, estimated: cost.estimated } : {}),
      ...(res.sessionId ? { cliSessionId: res.sessionId } : {}),
      ...(transcript ? { transcript } : {}),
      ...(res.result?.text ? { text: res.result.text } : {}),
    });
    await log?.close();
    await (await this.journal).add({
      kind: "session", by: "supervisor", ...(taskId ? { taskId } : {}),
      text: `Session ended (exit ${res.code}${res.result?.numTurns !== undefined ? `, ${res.result.numTurns} turns` : ""}${usd})${outcome}`,
      data: { incidents: incidents.map((i) => i.key), ...(log ? { session: log.id, log: log.path } : {}), ...(res.sessionId ? { cliSessionId: res.sessionId } : {}), ...(transcript ? { transcript } : {}) },
    });
    this.say(`[supervisor] session ended (exit ${res.code})`);
  }

  /** The "supervisor" section of the config file as it is now; a broken file keeps the last good one and says so. */
  private async reloadConfig(): Promise<void> {
    if (!this.opts.configPath) return;
    if (this.editing) return;
    const before = this.edits;
    try {
      const fresh = (await loadRunnersConfig(this.opts.configPath)).supervisor;
      if (fresh && this.edits === before && !this.editing) Object.assign(this.opts.config, fresh); // a page edit overlapped the read: keep it
      this.configError = null;
    } catch (e) {
      const message = (e as Error).message;
      if (message !== this.configError) await (await this.journal).add({ kind: "note", by: "detector", text: `runners.json cannot be read (${message}); the supervisor keeps its last good settings` });
      this.configError = message;
    }
  }

  private async snapshot(fs: FileStore): Promise<Snapshot> {
    const tasks = (await new TaskStore(fs).list()).filter((t) => t.status === "ACTIVE" || t.status === "BLOCKED");
    const messages = new MessageStore(fs);
    const questions = [];
    for (const t of tasks) {
      for (const m of await messages.list(t.id)) {
        if (m.to === OPERATOR && m.type === "QUESTION" && !m.readAt) questions.push({ taskId: t.id, messageId: m.id, from: m.from, question: m.content, askedAt: m.createdAt });
      }
    }
    const runners = this.opts.pool.list();
    const open = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const agents = await Promise.all(
      runners.map(async (r) => ({
        id: r.id,
        ...(r.session || open.some((t) => t.agents.includes(r.id)) ? { task: r.session?.taskId ?? open.find((t) => t.agents.includes(r.id))!.id } : {}),
        session: r.session ? { taskId: r.session.taskId, attempt: r.session.attempt, startedAt: r.session.startedAt } : null,
        log: this.opts.pool.log(r.id).slice(-80),
        results: this.opts.pool.activity(0, 200, r.id).filter((e) => e.kind === "tool_result").slice(-30).map((e) => ({ at: e.at, ...(e.tool ? { tool: e.tool } : {}), ...(e.isError ? { isError: true } : {}), summary: e.summary })),
        ...(r.session ? { progress: await progressMark(fs, r.session.taskId, r.id, r.cwd ?? undefined).catch(() => "") } : {}),
      })),
    );
    const folders = runners.filter((r) => r.cwd).map((r) => ({ agentId: r.id, cwd: r.cwd! }));
    const processes = folders.length ? testProcesses(await (this.opts.ps ?? ps)(), folders) : [];
    return { now: this.now, tasks: tasks.map((t) => ({ id: t.id, title: t.title, phase: t.phase, status: t.status, syncRound: t.syncRound, blockedReason: t.blockedReason ?? null, phaseSince: t.phaseHistory?.at(-1)?.at ?? t.updatedAt })), questions, agents, processes };
  }

  private async load(): Promise<State> {
    if (!this.state) {
      const saved = await (await this.fs).readJson<State>(["supervisor", "state.json"]);
      this.state = { ...emptyMemory(), sessions: [], ...(saved ?? {}) };
    }
    return this.state;
  }

  private async save(): Promise<void> {
    if (this.state) await (await this.fs).writeJson(["supervisor", "state.json"], this.state);
  }

  private statusNow(): SupervisorStatus {
    const cfg = this.opts.config;
    const sessions = this.state?.sessions ?? [];
    const day = sessions.filter((s) => Date.parse(s.at) >= this.now - 24 * 3600_000);
    return {
      enabled: this.enabled,
      session: this.current ? { startedAt: this.current.startedAt, incidents: this.current.incidents, ...(this.current.model ? { model: this.current.model } : {}) } : null,
      cli: cfg.command[0]!.split("/").at(-1)!,
      model: usesModel(cfg.command) ? cfg.model ?? null : null,
      models: usesModel(cfg.command) ? [...new Set([...(cfg.models ?? []), ...(cfg.model ? [cfg.model] : [])])] : [],
      rules: cfg.rules,
      maxSessionsPerHour: cfg.maxSessionsPerHour,
      budgetUsd: cfg.budgetUsd ?? null,
      sessionsLastHour: sessions.filter((s) => Date.parse(s.at) >= this.now - 3600_000).length,
      spend24h: { usd: day.reduce((a, s) => a + (s.usd ?? 0), 0), unpriced: day.filter((s) => s.usd === null).length },
      queued: this.queue.length,
      held: this.held,
      tools: [
        ...BUILTIN_TOOLS.map((name) => ({ name, builtin: true, description: BUILTIN_DESCRIPTIONS[name], enabled: !cfg.disabledTools.includes(name) })),
        ...cfg.tools.map((t) => ({ name: t.name, builtin: false, description: t.description, enabled: !cfg.disabledTools.includes(t.name) })),
      ],
      log: this.partial ? [...this.lines, this.partial] : [...this.lines],
    };
  }

  private say(line: string): void {
    this.push(`${line}\n`);
    this.opts.pool.recordActivity(SUPERVISOR_ID, { kind: "runner", summary: line.replace(/^\[supervisor\] /, "") });
  }

  private push(text: string): void {
    const parts = (this.partial + text).split("\n");
    this.partial = parts.pop() ?? "";
    const stamp = new Date().toLocaleTimeString("en-GB");
    for (const line of parts) this.lines.push(`${stamp} ${line}`);
    if (this.lines.length > 300) this.lines.splice(0, this.lines.length - 300);
  }
}
