import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { AppError } from "../errors.js";
import { runRunner, type RunnerOptions } from "../runner.js";
import { assertAgentId } from "../validation.js";

/**
 * runners.json — the agents the UI keeps working:
 *
 *   {
 *     "networkDir": "/abs/project/.agent-network",          optional: --network-dir / NETWORK_DIR win
 *     "defaults": { "command": ["qwen", "{prompt}", ...], "promptFile": "qwen-prompt.md", "maxRestarts": 2 },
 *     "agents": [ { "id": "backend", "cwd": "../project-backend" }, { "id": "reviewer", "cwd": "../project-reviewer", "autostart": false } ]
 *   }
 *
 * Every agent field may also sit in "defaults"; relative paths are resolved against the config file.
 */
export interface RunnerAgentConfig {
  id: string;
  /** Agent CLI argv with "{prompt}" (see `run`). */
  command: string[];
  cwd?: string;
  /** File with the prompt template ({agent} {taskId} {title} {attempt} {resume}). */
  promptFile?: string;
  maxRestarts?: number;
  /** Start together with the UI. Default true. */
  autostart?: boolean;
}

export interface RunnersConfig {
  networkDir?: string;
  agents: (RunnerAgentConfig & { promptTemplate?: string })[];
}

type RawAgent = Partial<RunnerAgentConfig>;

export async function loadRunnersConfig(path: string): Promise<RunnersConfig> {
  const file = resolve(path);
  let raw: { networkDir?: unknown; defaults?: RawAgent; agents?: RawAgent[] };
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
    const promptFile = merged.promptFile ? abs(merged.promptFile) : undefined;
    agents.push({
      id,
      command: merged.command,
      ...(merged.cwd ? { cwd: abs(merged.cwd) } : {}),
      ...(promptFile ? { promptFile, promptTemplate: await readFile(promptFile, "utf8") } : {}),
      ...(merged.maxRestarts !== undefined ? { maxRestarts: Number(merged.maxRestarts) } : {}),
      autostart: merged.autostart !== false,
    });
  }
  return { ...(typeof raw.networkDir === "string" ? { networkDir: abs(raw.networkDir) } : {}), agents };
}

export interface RunnerView {
  id: string;
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  cwd: string | null;
  command: string;
}

interface Managed {
  config: RunnersConfig["agents"][number];
  controller?: AbortController;
  done?: Promise<void>;
  startedAt: string | null;
  stoppedAt: string | null;
  lines: string[];
  partial: string;
}

/** The runners the UI process owns: start/stop per agent, a log tail of the runner and its sessions. */
export class RunnerPool {
  private readonly managed = new Map<string, Managed>();

  constructor(
    private readonly networkDir: string,
    agents: RunnersConfig["agents"],
    private readonly opts: { maxLines?: number; run?: (o: RunnerOptions) => Promise<number> } = {},
  ) {
    for (const config of agents) this.managed.set(config.id, { config, startedAt: null, stoppedAt: null, lines: [], partial: "" });
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
    }));
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
    this.push(m, `[ui] runner started\n`);
    const run = this.opts.run ?? runRunner;
    m.done = run({
      agent: m.config.id,
      networkDir: this.networkDir,
      command: m.config.command,
      ...(m.config.cwd ? { cwd: m.config.cwd } : {}),
      ...(m.config.promptTemplate ? { promptTemplate: m.config.promptTemplate } : {}),
      ...(m.config.maxRestarts !== undefined ? { maxRestarts: m.config.maxRestarts } : {}),
      signal: controller.signal,
      log: (line) => this.push(m, `[runner] ${line}\n`),
      output: (text) => this.push(m, text),
    }).then(
      (code) => this.push(m, `[ui] runner stopped (${code})\n`),
      (e: unknown) => this.push(m, `[ui] runner failed: ${(e as Error).message}\n`),
    ).finally(() => {
      m.controller = undefined;
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
