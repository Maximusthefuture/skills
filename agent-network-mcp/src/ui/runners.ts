import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { AppError } from "../errors.js";
import { parseFreshPhases } from "../handoff.js";
import { isValidModel, runRunner, usesModel, type RunnerOptions, type RunningSession } from "../runner.js";
import type { ActivityItem } from "../sessionOutput.js";
import type { Phase } from "../types.js";
import type { ModelPrice, Prices } from "../stats.js";
import { DEFAULT_RULES, type DetectRules } from "../supervisor/detect.js";
import { BUILTIN_TOOLS, parseCustomTool, type CustomTool } from "../supervisor/tools.js";
import { assertAgentId } from "../validation.js";

/**
 * runners.json — the agents the UI keeps working:
 *
 *   {
 *     "networkDir": "/abs/project/.agent-network",          optional: --network-dir / NETWORK_DIR win
 *     "defaults": { "command": ["qwen", "{prompt}", "-m", "{model}", ...], "model": "qwen/qwen3.5-9b", "models": ["qwen/qwen3.5-9b", "qwen/qwen3-coder-30b"], "promptFile": "qwen-prompt.md" },
 *     "agents": [ { "id": "backend", "cwd": "../project-backend", "instructionsFile": "backend.md" }, { "id": "reviewer", "cwd": "../project-reviewer", "autostart": false } ]
 *   }
 *
 * Every agent field may also sit in "defaults"; relative paths are resolved against the config file.
 */
export interface RunnerAgentConfig {
  id: string;
  /** Agent CLI argv with "{prompt}" (see `run`). */
  command: string[];
  cwd?: string;
  /** File with the whole prompt template ({agent} {taskId} {title} {attempt} {resume}); read before every session. */
  promptFile?: string;
  /** File with this agent's own instructions (role, rules), appended to the prompt; read before every session. */
  instructionsFile?: string;
  /** File with the system prompt, put where the command has {systemPrompt}; read before every session. */
  systemPromptFile?: string;
  /** Put where the command has {model}; the UI can change it (applies from the next session). */
  model?: string;
  /** The choice offered on the page. */
  models?: string[];
  maxRestarts?: number;
  /** Phases a fresh session takes over (["SYNC"]: the review is done by a session that did not see the discussion). */
  freshPhases?: Phase[];
  /** Start together with the UI. Default true. */
  autostart?: boolean;
}

/**
 * "supervisor": the agent that looks after the others when something goes wrong (see src/supervisor). Its command is a
 * CLI like the agents' (Claude Code or Qwen Code) with "{prompt}" and, for a choice of model, "{model}".
 */
export interface SupervisorConfig {
  command: string[];
  model?: string;
  /** The choice offered on the page. */
  models?: string[];
  /** Its instructions; read before every session. */
  promptFile: string;
  systemPromptFile?: string;
  /** When the detector wakes it (see DetectRules). */
  rules: DetectRules;
  /** At most this many supervisor sessions an hour. Default 6. */
  maxSessionsPerHour: number;
  /** At most this much USD of supervisor sessions in 24 h (CLI cost, or "prices"); no limit when absent. */
  budgetUsd?: number;
  /** Start watching together with the UI. Default true. */
  autostart: boolean;
  /** The operator's own commands for the supervisor (see supervisor/tools.ts). */
  tools: CustomTool[];
  /** Tools switched off, built-in or own. */
  disabledTools: string[];
}

export interface RunnersConfig {
  networkDir?: string;
  agents: RunnerAgentConfig[];
  supervisor?: SupervisorConfig;
  /** Where the config came from: the UI writes the instructions file it sets back there. */
  path?: string;
  /** USD per 1M tokens per model, for sessions whose CLI reports no cost. */
  prices?: Prices;
}

type RawAgent = Partial<RunnerAgentConfig>;

export async function loadRunnersConfig(path: string): Promise<RunnersConfig> {
  const file = resolve(path);
  let raw: { networkDir?: unknown; defaults?: RawAgent; agents?: RawAgent[]; prices?: unknown; supervisor?: unknown };
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new AppError("INVALID_CONFIG", `Cannot read ${file}: ${(e as Error).message}`);
  }
  const base = dirname(file);
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(base, p));
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) throw new AppError("INVALID_CONFIG", `${file}: "agents" must list at least one agent`);
  const seen = new Set<string>();
  const agents: RunnersConfig["agents"] = [];
  for (const a of raw.agents) {
    const merged = { ...raw.defaults, ...a };
    const id = assertAgentId(String(merged.id ?? ""), "agents[].id");
    if (seen.has(id)) throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" is listed twice`);
    seen.add(id);
    if (!Array.isArray(merged.command) || merged.command.length === 0 || !merged.command.every((c) => typeof c === "string")) {
      throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" needs "command": the agent CLI as an array, e.g. ["qwen", "{prompt}", "-m", "qwen/qwen3.5-9b"]`);
    }
    if (merged.model !== undefined && !isValidModel(merged.model)) throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" model ${JSON.stringify(merged.model)}: a model name without spaces, not starting with "-"`);
    if (merged.models !== undefined && (!Array.isArray(merged.models) || !merged.models.every(isValidModel))) {
      throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" "models" must be a list of model names`);
    }
    if (usesModel(merged.command) && !merged.model) throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" command has {model}: set "model" (in the agent or in "defaults")`);
    const freshPhases = parseFreshPhases(merged.freshPhases as readonly unknown[] | string | undefined, `${file}: agent "${id}" freshPhases`);
    const promptFile = merged.promptFile ? abs(merged.promptFile) : undefined;
    const instructionsFile = merged.instructionsFile ? abs(merged.instructionsFile) : undefined;
    const systemPromptFile = merged.systemPromptFile ? abs(merged.systemPromptFile) : undefined;
    for (const [what, f] of [["promptFile", promptFile], ["instructionsFile", instructionsFile], ["systemPromptFile", systemPromptFile]] as const) {
      if (f) await readFile(f, "utf8").catch((e: Error) => { throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" ${what} ${f}: ${e.message}`); });
    }
    agents.push({
      id,
      command: merged.command,
      ...(merged.cwd ? { cwd: abs(merged.cwd) } : {}),
      ...(promptFile ? { promptFile } : {}),
      ...(instructionsFile ? { instructionsFile } : {}),
      ...(systemPromptFile ? { systemPromptFile } : {}),
      ...(merged.model ? { model: merged.model } : {}),
      ...(merged.models?.length ? { models: [...new Set(merged.models)] } : {}),
      ...(merged.maxRestarts !== undefined ? { maxRestarts: Number(merged.maxRestarts) } : {}),
      ...(freshPhases.length ? { freshPhases } : {}),
      autostart: merged.autostart !== false,
    });
  }
  const prices = parsePrices(raw.prices, file);
  const supervisor = raw.supervisor === undefined ? undefined : await parseSupervisor(raw.supervisor, file, abs);
  return { ...(typeof raw.networkDir === "string" ? { networkDir: abs(raw.networkDir) } : {}), agents, path: file, ...(prices ? { prices } : {}), ...(supervisor ? { supervisor } : {}) };
}

async function parseSupervisor(raw: unknown, file: string, abs: (p: string) => string): Promise<SupervisorConfig> {
  const bad = (what: string): never => {
    throw new AppError("INVALID_CONFIG", `${file}: "supervisor" ${what}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("must be an object");
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.command) || !s.command.length || !s.command.every((c) => typeof c === "string")) bad('needs "command": the CLI as an array, e.g. ["claude", "-p", "{prompt}", "--model", "{model}", ...]');
  const command = s.command as string[];
  if (s.model !== undefined && !isValidModel(s.model)) bad(`model ${JSON.stringify(s.model)}: a model name without spaces, not starting with "-"`);
  if (s.models !== undefined && (!Array.isArray(s.models) || !s.models.every(isValidModel))) bad('"models" must be a list of model names');
  if (usesModel(command) && !s.model) bad('command has {model}: set "model"');
  if (typeof s.promptFile !== "string" || !s.promptFile) bad('needs "promptFile": its instructions (examples/runner/supervisor-prompt.md)');
  const promptFile = abs(s.promptFile as string);
  const systemPromptFile = typeof s.systemPromptFile === "string" && s.systemPromptFile ? abs(s.systemPromptFile) : undefined;
  for (const [what, f] of [["promptFile", promptFile], ["systemPromptFile", systemPromptFile]] as const) {
    if (f) await readFile(f, "utf8").catch((e: Error) => bad(`${what} ${f}: ${e.message}`));
  }
  const rules = { ...DEFAULT_RULES };
  if (s.rules !== undefined) {
    if (!s.rules || typeof s.rules !== "object" || Array.isArray(s.rules)) bad('"rules" must be an object');
    for (const [k, v] of Object.entries(s.rules as Record<string, unknown>)) {
      if (k.startsWith("_")) continue;
      if (!(k in DEFAULT_RULES)) bad(`rules: unknown rule "${k}" (${Object.keys(DEFAULT_RULES).join(", ")})`);
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) bad(`rules.${k} must be a number > 0`);
      rules[k as keyof DetectRules] = v as number;
    }
  }
  const perHour = s.maxSessionsPerHour === undefined ? 6 : s.maxSessionsPerHour;
  if (typeof perHour !== "number" || !Number.isInteger(perHour) || perHour < 1 || perHour > 100) bad("maxSessionsPerHour must be an integer 1..100");
  if (s.budgetUsd !== undefined && (typeof s.budgetUsd !== "number" || !Number.isFinite(s.budgetUsd) || s.budgetUsd < 0)) bad("budgetUsd must be a number >= 0");
  if (s.tools !== undefined && !Array.isArray(s.tools)) bad('"tools" must be a list of {name, description, command, params?}');
  const tools = ((s.tools as unknown[] | undefined) ?? []).map((t, i) => parseCustomTool(t, `${file}: "supervisor".tools[${i}]`));
  const names = [...BUILTIN_TOOLS, ...tools.map((t) => t.name)];
  const twice = tools.map((t) => t.name).find((n, i, all) => all.indexOf(n) !== i);
  if (twice) bad(`tools: "${twice}" is listed twice`);
  if (s.disabledTools !== undefined && (!Array.isArray(s.disabledTools) || !s.disabledTools.every((n) => typeof n === "string"))) bad('"disabledTools" must be a list of tool names');
  const disabledTools = [...new Set((s.disabledTools as string[] | undefined) ?? [])];
  const unknown = disabledTools.filter((n) => !(names as string[]).includes(n));
  if (unknown.length) bad(`disabledTools: no tool ${unknown.map((n) => `"${n}"`).join(", ")} (tools: ${names.join(", ")})`);
  return {
    command,
    ...(s.model ? { model: s.model as string } : {}),
    ...(Array.isArray(s.models) && s.models.length ? { models: [...new Set(s.models as string[])] } : {}),
    promptFile,
    ...(systemPromptFile ? { systemPromptFile } : {}),
    rules,
    maxSessionsPerHour: perHour as number,
    ...(s.budgetUsd !== undefined ? { budgetUsd: s.budgetUsd as number } : {}),
    autostart: s.autostart !== false,
    tools,
    disabledTools,
  };
}

/** The config file is read again while the page runs (supervisor, prices): replace it whole, never half-written. */
async function writeConfig(configPath: string, raw: unknown): Promise<void> {
  const tmp = `${configPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(raw, null, 2)}\n`);
  await rename(tmp, configPath);
}

/** Update one field of the "supervisor" section in the JSON config, keeping everything else. */
export async function saveSupervisorField(configPath: string, field: string, value: unknown): Promise<void> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as { supervisor?: Record<string, unknown> };
  if (!raw.supervisor) return;
  if (value === null) delete raw.supervisor[field];
  else raw.supervisor[field] = value;
  await writeConfig(configPath, raw);
}

/**
 * "prices": {"<model>": {"input": 0.1, "output": 0.4, "cacheRead"?: 0.01, "cacheWrite"?: 0.125}} in USD per 1M tokens.
 * The model is the name the session reports (the "[session] model …" line of the runner log). Keys starting with "_"
 * are comments.
 */
export function parsePrices(raw: unknown, file: string): Prices | undefined {
  if (raw === undefined) return undefined;
  const shape = `${file}: "prices" must be {"<model>": {"input": <USD per 1M tokens>, "output": <USD per 1M tokens>}}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_CONFIG", shape);
  const prices: Prices = {};
  for (const [model, p] of Object.entries(raw)) {
    if (model.startsWith("_")) continue;
    const price = p as Record<string, unknown>;
    const ok = (v: unknown, required: boolean) => (v === undefined ? !required : typeof v === "number" && Number.isFinite(v) && v >= 0);
    if (!price || typeof price !== "object" || !ok(price.input, true) || !ok(price.output, true) || !ok(price.cacheRead, false) || !ok(price.cacheWrite, false)) {
      throw new AppError("INVALID_CONFIG", `${shape}; "${model}" is ${JSON.stringify(p)} (numbers >= 0; cacheRead and cacheWrite are optional)`);
    }
    prices[model] = Object.fromEntries(Object.entries(price).filter(([k]) => ["input", "output", "cacheRead", "cacheWrite"].includes(k))) as unknown as ModelPrice;
  }
  return prices;
}

/**
 * The prices of a config file, read again whenever the file changes, so editing them needs no restart. A file that
 * does not parse keeps the last good prices and reports the error.
 */
export function watchPrices(file: string): () => Promise<{ prices?: Prices; error?: string }> {
  let mtime = -1;
  let last: { prices?: Prices; error?: string } = {};
  return async () => {
    try {
      const m = (await stat(file)).mtimeMs;
      if (m !== mtime) {
        mtime = m;
        const prices = parsePrices((JSON.parse(await readFile(file, "utf8")) as { prices?: unknown }).prices, file);
        last = prices ? { prices } : {};
      }
    } catch (e) {
      last = { ...(last.prices ? { prices: last.prices } : {}), error: (e as Error).message };
    }
    return last;
  };
}

export interface RunnerView {
  id: string;
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  cwd: string | null;
  command: string;
  promptFile: string | null;
  instructionsFile: string | null;
  /** The command has {model}: the model can be chosen; null otherwise (the command names it itself, if at all). */
  model: string | null;
  /** What the page offers: the configured list plus the current model. */
  models: string[];
  /** The agent session the runner has open right now, if any. */
  session: RunningSession | null;
}

export interface RunnerDetails extends RunnerView {
  /** The start of the instructions file, or why it cannot be read. */
  instructions: { preview: string } | { error: string } | null;
}

/** One entry of the activity feed: what an agent's session (or its runner) did, numbered across the project. */
export interface ActivityEvent extends ActivityItem {
  seq: number;
  at: string;
  agentId: string;
  taskId?: string;
  attempt?: number;
}

const MAX_EVENTS = 1500;

interface Managed {
  config: RunnersConfig["agents"][number];
  controller?: AbortController;
  done?: Promise<void>;
  startedAt: string | null;
  stoppedAt: string | null;
  lines: string[];
  partial: string;
  session: RunningSession | null;
  events: ActivityEvent[];
}

/** The runners the UI process owns: start/stop per agent, a log tail of the runner and its sessions. */
export class RunnerPool {
  private readonly managed = new Map<string, Managed>();
  /** Activity of sources that are no runner (the supervisor). */
  private readonly other = new Map<string, ActivityEvent[]>();
  private seq = 0;

  constructor(
    private readonly networkDir: string,
    agents: RunnersConfig["agents"],
    private readonly opts: { maxLines?: number; run?: (o: RunnerOptions) => Promise<number>; configPath?: string } = {},
  ) {
    for (const config of agents) this.managed.set(config.id, { config, startedAt: null, stoppedAt: null, lines: [], partial: "", session: null, events: [] });
  }

  ids(): string[] {
    return [...this.managed.keys()];
  }

  list(): RunnerView[] {
    return [...this.managed.values()].map((m) => ({
      id: m.config.id,
      running: !!m.controller,
      startedAt: m.startedAt,
      stoppedAt: m.stoppedAt,
      cwd: m.config.cwd ?? null,
      command: m.config.command.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(" "),
      promptFile: m.config.promptFile ?? null,
      instructionsFile: m.config.instructionsFile ?? null,
      model: usesModel(m.config.command) ? m.config.model ?? null : null,
      models: usesModel(m.config.command) ? [...new Set([...(m.config.models ?? []), ...(m.config.model ? [m.config.model] : [])])] : [],
      session: m.session,
    }));
  }

  /** list() plus a look into each instructions file, for the page. */
  async details(): Promise<RunnerDetails[]> {
    return Promise.all(
      this.list().map(async (v) => {
        if (!v.instructionsFile) return { ...v, instructions: null };
        try {
          const text = (await readFile(v.instructionsFile, "utf8")).trim();
          return { ...v, instructions: { preview: text.length > 300 ? `${text.slice(0, 300)}…` : text } };
        } catch (e) {
          return { ...v, instructions: { error: (e as NodeJS.ErrnoException).code ?? (e as Error).message } };
        }
      }),
    );
  }

  /**
   * Point an agent at another instructions file (null/empty = none). Relative paths are resolved against the config file.
   * The file must be readable; it is read again before every session, so the change applies to the next one.
   * With a config file the value is written back there, so it survives a restart.
   */
  async setInstructionsFile(id: string, raw: string | null): Promise<RunnerView> {
    const m = this.get(id);
    const given = raw?.trim() || null;
    const base = this.opts.configPath ? dirname(this.opts.configPath) : process.cwd();
    const path = given ? (isAbsolute(given) ? given : resolve(base, given)) : null;
    if (path) {
      await readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
        throw new AppError("INVALID_INPUT", `Cannot read ${path}: ${e.code ?? e.message}`);
      });
    }
    if (path) m.config.instructionsFile = path;
    else delete m.config.instructionsFile;
    if (this.opts.configPath) await saveAgentField(this.opts.configPath, id, "instructionsFile", given);
    this.say(m, `[ui] instructions file: ${path ?? "none"} (applies from the next session)`);
    return this.view(id);
  }

  /**
   * Choose the agent's model: put where its command has {model} from the next session on (a running session keeps its
   * model). With a config file the value is written back there, so it survives a restart.
   */
  async setModel(id: string, raw: string): Promise<RunnerView> {
    const m = this.get(id);
    const model = raw.trim();
    if (!usesModel(m.config.command)) throw new AppError("INVALID_INPUT", `The command of '${id}' has no {model}: put "{model}" where it names the model (e.g. "-m", "{model}") and set "model"`);
    if (!isValidModel(model)) throw new AppError("INVALID_INPUT", `Not a model name: ${JSON.stringify(raw)} (no spaces, not starting with "-")`);
    m.config.model = model;
    if (this.opts.configPath) await saveAgentField(this.opts.configPath, id, "model", model);
    this.say(m, `[ui] model: ${model}${m.controller ? " (applies from the next session)" : ""}`);
    return this.view(id);
  }

  /** The activity feed of the project: every agent's and the supervisor's events (or one agent's) after `after`, oldest first, the newest `limit`. */
  activity(after = 0, limit = 1000, agentId?: string): ActivityEvent[] {
    const all = [...[...this.managed.values()].flatMap((m) => m.events), ...[...this.other.values()].flat()].filter((e) => e.seq > after && (!agentId || e.agentId === agentId));
    return all.sort((a, b) => a.seq - b.seq).slice(-limit);
  }

  /** An event of a source that is no runner of this pool (the supervisor's sessions). */
  recordActivity(source: string, item: ActivityItem, context: { taskId?: string; attempt?: number } = {}): void {
    const list = this.other.get(source) ?? [];
    this.other.set(source, list);
    this.append(list, { ...item, seq: ++this.seq, at: new Date().toISOString(), agentId: source, ...context });
  }

  private record(m: Managed, item: ActivityItem): void {
    this.append(m.events, { ...item, seq: ++this.seq, at: new Date().toISOString(), agentId: m.config.id, ...(m.session ? { taskId: m.session.taskId, attempt: m.session.attempt } : {}) });
  }

  private append(list: ActivityEvent[], e: ActivityEvent): void {
    list.push(e);
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  }

  /** A line of the runner or the page about this agent: in its log and in the feed. */
  private say(m: Managed, line: string): void {
    this.push(m, `${line}\n`);
    this.record(m, { kind: "runner", summary: line.replace(/^\[(runner|ui)\] /, "") });
  }

  log(id: string): string[] {
    const m = this.get(id);
    return m.partial ? [...m.lines, m.partial] : [...m.lines];
  }

  start(id: string): RunnerView {
    const m = this.get(id);
    if (m.controller) return this.view(id);
    const controller = new AbortController();
    m.controller = controller;
    m.startedAt = new Date().toISOString();
    m.stoppedAt = null;
    this.say(m, "[ui] runner started");
    const run = this.opts.run ?? runRunner;
    m.done = run({
      agent: m.config.id,
      networkDir: this.networkDir,
      command: m.config.command,
      ...(m.config.cwd ? { cwd: m.config.cwd } : {}),
      ...(m.config.promptFile ? { promptFile: m.config.promptFile } : {}),
      ...(m.config.instructionsFile ? { instructionsFile: m.config.instructionsFile } : {}),
      ...(m.config.systemPromptFile ? { systemPromptFile: m.config.systemPromptFile } : {}),
      model: () => m.config.model,
      onSession: (session) => {
        m.session = session;
      },
      onActivity: (e) => this.record(m, e),
      ...(m.config.maxRestarts !== undefined ? { maxRestarts: m.config.maxRestarts } : {}),
      ...(m.config.freshPhases ? { freshPhases: m.config.freshPhases } : {}),
      signal: controller.signal,
      log: (line) => this.say(m, `[runner] ${line}`),
      output: (text) => this.push(m, text),
    }).then(
      (code) => this.say(m, `[ui] runner stopped (${code})`),
      (e: unknown) => this.say(m, `[ui] runner failed: ${(e as Error).message}`),
    ).finally(() => {
      m.controller = undefined;
      m.session = null;
      m.stoppedAt = new Date().toISOString();
    });
    return this.view(id);
  }

  async stop(id: string): Promise<RunnerView> {
    const m = this.get(id);
    m.controller?.abort();
    await m.done;
    return this.view(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.ids().map((id) => this.stop(id)));
  }

  private view(id: string): RunnerView {
    return this.list().find((v) => v.id === id)!;
  }

  private get(id: string): Managed {
    const m = this.managed.get(id);
    if (!m) throw new AppError("AGENT_NOT_REGISTERED", `No runner for agent '${id}' in the runners config`);
    return m;
  }

  private push(m: Managed, text: string): void {
    const parts = (m.partial + text).split("\n");
    m.partial = parts.pop() ?? "";
    const stamp = new Date().toLocaleTimeString("en-GB");
    for (const line of parts) m.lines.push(`${stamp} ${line}`);
    const max = this.opts.maxLines ?? 400;
    if (m.lines.length > max) m.lines.splice(0, m.lines.length - max);
  }
}

/** Update one field of one agent in the JSON config, keeping everything else (including _comment). */
async function saveAgentField(configPath: string, id: string, field: string, value: string | null): Promise<void> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as { agents?: Record<string, unknown>[] };
  const agent = raw.agents?.find((a) => a.id === id);
  if (!agent) return;
  if (value === null) delete agent[field];
  else agent[field] = value;
  await writeConfig(configPath, raw);
}
