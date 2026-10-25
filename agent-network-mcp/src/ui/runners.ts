import { ATTENTION_KINDS, type NotifyConfig } from "../attention.js";
import { homedir } from "node:os";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catchUpBranch, ensureWorktrees, type AgentWorktree } from "../worktrees.js";
import { AppError } from "../errors.js";
import { parseFreshPhases } from "../handoff.js";
import { isValidModel, runRunner, usesModel, type RunnerOptions, type RunningSession } from "../runner.js";
import type { ActivityItem } from "../sessionOutput.js";
import type { Phase, Task } from "../types.js";
import type { ModelPrice, Prices } from "../stats.js";
import { parseCron } from "../schedule/cron.js";
import { DEFAULT_RULES, type DetectRules } from "../supervisor/detect.js";
import { BUILTIN_TOOLS, parseCustomTool, type CustomTool } from "../supervisor/tools.js";
import { assertAgentId } from "../validation.js";
import { listSkills, sessionDisabledSkills, SKILL_NAME, TASK_KINDS, type SkillInfo, type SkillsByTask } from "../skills.js";
import { detectStack, onPath, withBuildPermissions, type ProjectStack } from "../stack.js";
import { buildTools, parseBuildCommand } from "../build.js";

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
  /** Built-in tools taken out of the command (e.g. ["Agent", "Skill"] for a reviewer): their descriptions are read every turn. */
  withoutTools?: string[];
  /** Skills the agent may not load (see src/skills.ts); the page switches them on and off, from the next session. */
  disabledSkills?: string[];
  /**
   * Skills off only in one kind of task, on top of disabledSkills: "propose" (writes an OpenSpec change), "code" (every
   * other task), e.g. {"propose": ["java-tdd", "java-code-review"], "code": ["java-spec-intake"]}.
   */
  disabledSkillsByTask?: SkillsByTask;
  cwd?: string;
  /** File with the whole prompt template ({agent} {taskId} {title} {attempt} {resume}); read before every session. */
  promptFile?: string;
  /** File with this agent's own instructions (role, rules), appended to the prompt; read before every session. */
  instructionsFile?: string;
  /** File with the system prompt, put where the command has {systemPrompt}; read before every session. */
  systemPromptFile?: string;
  /** Put where the command has {model}; the UI can change it (applies from the next session). */
  model?: string;
  /**
   * The model for sessions of a task that writes an OpenSpec change (task create --propose): a stronger reviewer of the
   * change while the code is written on a cheaper one. Default: model.
   */
  proposeModel?: string;
  /** The choice offered on the page. */
  models?: string[];
  maxRestarts?: number;
  /** Phases a fresh session takes over (["SYNC"]: the review is done by a session that did not see the discussion). */
  freshPhases?: Phase[];
  /** End a session past this context size and go on in a fresh one (see RunnerOptions.maxContextTokens). */
  maxContextTokens?: number;
  /** Start together with the UI. Default true. */
  autostart?: boolean;
  /** Its own git worktree, created at start when missing (defaults.worktree: true and no "cwd"). */
  worktree?: AgentWorktree;
}

/** This package's folder: "{agentNetworkMcp}" in a config means it, so the shipped examples work without editing. */
export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

/**
 * "schedules": tasks the page creates by itself on a cron (no model involved). A schedule whose previous task is still
 * open (ACTIVE or BLOCKED) skips its turn. {date} and {time} in title and description become the run's date and time.
 */
export interface ScheduleConfig {
  id: string;
  /** 5-field cron in local time, or @daily, @hourly, @weekly, @weekdays... (see schedule/cron.ts). */
  cron: string;
  title: string;
  description: string;
  /** The first one is the lead; every one must be an agent of this config. */
  agents: string[];
  openspec?: string;
  verifyCommand?: string;
  maxFixRounds?: number;
  maxFollowUps?: number;
  /** Cost limit of the task in USD; default: "maxTaskCostUsd" of the config. */
  maxCostUsd?: number;
  /** Default true; switched on the page, written back here. */
  enabled: boolean;
}

export interface RunnersConfig {
  networkDir?: string;
  agents: RunnerAgentConfig[];
  supervisor?: SupervisorConfig;
  schedules?: ScheduleConfig[];
  /** Where the config came from: the UI writes the instructions file it sets back there. */
  path?: string;
  /** USD per 1M tokens per model, for sessions whose CLI reports no cost. */
  prices?: Prices;
  /** The project: "project" in the file, else the git repository `ui` was started in. */
  project?: string;
  /** Cost limit (USD) of tasks created on the page or by a schedule when they set none; absent = no limit. */
  maxTaskCostUsd?: number;
  /** The build and test command of tasks created on the page or by a schedule when they set none (the lead's green build). */
  verifyCommand?: string;
  /** Agents a task's lead may add to its team from templates (spawn_agent); their runners start by themselves. */
  spawn?: SpawnConfig;
  /** The agent that looks back over finished tasks for the system's problems and proposes improvements (src/observer). */
  observer?: ObserverConfig;
  /** Reads every version of a plan the lead writes (task.planReview) for what breaks in production (src/planCritic). */
  planCritic?: PlanCriticConfig;
  /** "Влить в проект": squash (default, one commit per task) or merge (a merge commit keeping the agents' commits). */
  mergeStrategy?: "squash" | "merge";
  /** The merge check (src/mergeCheck.ts): setup commands for its worktree before verifyCommand; [] = none; absent = by the lockfile. */
  mergeCheck?: { setup?: string[] };
  /** What waits for the operator (src/attention.ts): desktop notifications (Linux: notify-send), reminders, which kinds. */
  notify?: NotifyConfig;
}

export interface ObserverConfig {
  /** A CLI like the supervisor's, with {prompt} and, for a choice of model, {model}. */
  command: string[];
  model?: string;
  models?: string[];
  promptFile: string;
  systemPromptFile?: string;
  /** When it runs by itself (5-field cron, local time); without it only the page's button starts it. */
  cron?: string;
}

/**
 * The plan critic: the observer's kind of CLI ({prompt}, {model}; {projectDir} and {planDir} for its read tools), no cron,
 * plus skill sets: each applies when one of its "when" files is in the project's root (pom.xml, package.json, go.mod, ...).
 */
export type PlanCriticConfig = Omit<ObserverConfig, "cron"> & { skillSets?: SkillSet[] };

/** Skills the critic gets for a kind of project: a skill folder (with SKILL.md) or a folder of skills (skills/<name>/SKILL.md). */
export interface SkillSet {
  name: string;
  /** File names (a * matches anything) in the project's root that mark this kind of project. */
  when: string[];
  /** Absolute paths. */
  skills: string[];
}

export interface SpawnTemplate {
  name: string;
  /** What this kind of agent is for, shown to the lead. */
  description: string;
  /** The runner of an agent spawned from it, under the template's name (spawnedAgent gives it its own id and folder). */
  config: RunnerAgentConfig;
}

export interface SpawnConfig {
  templates: SpawnTemplate[];
  /** How many agents one task may add. Default 2. */
  maxPerTask: number;
}

/** The runner config of an agent spawned from a template: its own id, and its own worktree <project>-<id> when the template has one. */
export function spawnedAgent(t: SpawnTemplate, id: string): RunnerAgentConfig {
  const { worktree, cwd, ...rest } = t.config;
  if (worktree) return { ...rest, id, worktree: { project: worktree.project, branch: `swarm-${id}` }, cwd: join(dirname(worktree.project), `${basename(worktree.project)}-${id}`), autostart: true };
  return { ...rest, id, ...(cwd ? { cwd } : {}), autostart: true };
}

/** The shipped runners configs a project's own config is copied from (`ui --template`). */
export const TEMPLATES = { qwen: "runners.qwen.example.json", claude: "runners.claude.example.json" } as const;
export type TemplateName = keyof typeof TEMPLATES;

/** The CLI of each template, looked up on PATH when `ui` is started without --template. */
const TEMPLATE_CLI: Record<TemplateName, string> = { qwen: "qwen", claude: "claude" };

/** The templates whose agent CLI is installed (on PATH). */
export async function installedTemplates(env: NodeJS.ProcessEnv = process.env): Promise<TemplateName[]> {
  const names = Object.keys(TEMPLATES) as TemplateName[];
  const found = await Promise.all(names.map((t) => onPath(TEMPLATE_CLI[t], env)));
  return names.filter((_, i) => found[i]);
}

/** <project>/.agent-network/runners.json: a project's own runners config. */
export const projectConfigFile = (project: string): string => join(project, ".agent-network", "runners.json");

/** The role instructions the templates name, at the top of examples/runner/instructions/ (they are the Maven ones). */
const ROLE_INSTRUCTIONS = /^(\{agentNetworkMcp\}\/examples\/runner\/instructions\/)([a-z-]+\.md)$/;

/**
 * A template copy fitted to the project's stack: its build permission instead of ./mvnw, its verifyCommand, and the
 * role instructions for it. Without a stack the Maven permission stays, but not the Maven verifyCommand: a task that
 * cannot run it could never pass.
 */
function fitToStack(copy: Record<string, unknown>, stack: ProjectStack | null): Record<string, unknown> {
  const fit = (v: unknown): unknown => {
    if (Array.isArray(v)) return stack && v.every((x) => typeof x === "string") ? withBuildPermissions(v as string[], stack) : v.map(fit);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "instructionsFile" ? instructionsFor(x, stack) : fit(x)]));
    return v;
  };
  const out = fit(copy) as Record<string, unknown>;
  if (stack?.verifyCommand) out.verifyCommand = stack.verifyCommand;
  else delete out.verifyCommand;
  return out;
}

function instructionsFor(file: unknown, stack: ProjectStack | null): unknown {
  const m = typeof file === "string" && stack?.instructions ? ROLE_INSTRUCTIONS.exec(file) : null;
  return m ? `${m[1]}${stack!.instructions}/${m[2]}` : file;
}

/**
 * A project's own runners config: <project>/.agent-network/runners.json (out of git with the network). Missing, it is
 * copied from a shipped template; file references relative to the template ("instructions/backend.md") are pointed at
 * the package ({agentNetworkMcp}/examples/runner/...), so the copy works where it lies, and it is fitted to the
 * project's stack (see detectStack). The page writes its changes (models, instructions, schedules on/off, supervisor
 * settings) into this copy, never into the shipped example.
 */
export async function projectRunnersConfig(project: string, template: TemplateName = "qwen"): Promise<{ path: string; created: boolean; stack?: ProjectStack | null }> {
  const path = projectConfigFile(project);
  if (await stat(path).then(() => true, () => false)) return { path, created: false };
  const examples = join(PACKAGE_DIR, "examples", "runner");
  const raw = JSON.parse(await readFile(join(examples, TEMPLATES[template]), "utf8")) as Record<string, unknown>;
  const point = (v: unknown, key: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => point(x, ""));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, point(x, k)]));
    if (typeof v === "string" && /File$/.test(key) && !isAbsolute(v) && !v.startsWith("{agentNetworkMcp}")) return `{agentNetworkMcp}/examples/runner/${v}`;
    return v;
  };
  const stack = await detectStack(project);
  const copy = fitToStack(point(raw, "") as Record<string, unknown>, stack);
  const note = `This project's own config, copied from examples/runner/${TEMPLATES[template]} on ${new Date().toISOString().slice(0, 10)}: edit models, build commands, limits and schedules here (the page writes its changes here too). Delete it to start over from the template.`;
  const fitted = stack
    ? `Fitted to the project's stack, ${stack.name} (${stack.marker}): the agents may run ${stack.shell.join(", ")} in the shell, ${stack.verifyCommand ? `tasks check the merged result with "${stack.verifyCommand}" (verifyCommand)` : "no verifyCommand (package.json has no verify, check, test or build script): set one"}, role instructions from examples/runner/instructions/${stack.instructions && `${stack.instructions}/`}.`
    : "No pom.xml, build.gradle or package.json in the project's root: the build permissions and role instructions are the template's Maven ones, and there is no verifyCommand. Set them for your build.";
  copy._comment = [note, fitted, ...(Array.isArray(copy._comment) ? copy._comment : [])];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(copy, null, 2) + "\n", { flag: "wx" });
  return { path, created: true, stack };
}

type RawAgent = Partial<RunnerAgentConfig>;

/**
 * The command without some built-in tools: Claude Code's --tools list and --allowedTools lose them (and --agents goes
 * with Agent: no subagents to define); Qwen's --exclude-tools gets them (agent, skill...). Every tool's description is
 * read again on every turn, so a role that never uses one should not carry it.
 */
export function withoutTools(command: string[], tools: string[]): string[] {
  if (!tools.length) return command;
  const drop = new Set(tools);
  const out: string[] = [];
  for (let i = 0; i < command.length; i++) {
    const a = command[i]!;
    if (a === "--tools" && i + 1 < command.length) {
      out.push(a, command[++i]!.split(",").filter((t) => !drop.has(t.trim())).join(","));
    } else if (a === "--agents" && drop.has("Agent")) {
      i++; // the subagent definitions go with the Agent tool
    } else if (a === "--allowedTools" || a === "--allowed-tools") {
      out.push(a);
      while (i + 1 < command.length && !command[i + 1]!.startsWith("--")) {
        const v = command[++i]!;
        if (!drop.has(v)) out.push(v);
      }
    } else if (a === "--exclude-tools") {
      out.push(a);
      while (i + 1 < command.length && !command[i + 1]!.startsWith("-")) out.push(command[++i]!);
      out.push(...tools.map((t) => t.toLowerCase()));
    } else out.push(a);
  }
  return out;
}

/** A verifyCommand the build tool can run: one build-tool command without a shell (see parseBuildCommand). */
function parseVerifyCommand(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError("INVALID_CONFIG", `${what} must be the build and test command, e.g. "./mvnw -q -B verify" or "npm test"`);
  try {
    parseBuildCommand(value, buildTools());
  } catch (e) {
    throw new AppError("INVALID_CONFIG", `${what}: ${(e as Error).message}`);
  }
  return value.trim();
}

function costLimit(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new AppError("INVALID_CONFIG", `${what} must be a positive amount in USD, e.g. 10`);
  return value;
}

export async function loadRunnersConfig(path: string, opts: { projectDir?: string } = {}): Promise<RunnersConfig> {
  const file = resolve(path);
  let raw: { networkDir?: unknown; project?: unknown; defaults?: RawAgent & { worktree?: unknown }; agents?: (RawAgent & { worktree?: unknown })[]; prices?: unknown; supervisor?: unknown; schedules?: unknown; maxTaskCostUsd?: unknown; verifyCommand?: unknown; spawn?: unknown; observer?: unknown; planCritic?: unknown; mergeStrategy?: unknown; mergeCheck?: unknown; notify?: unknown };
  try {
    // {agentNetworkMcp} anywhere in the file is this package's folder
    raw = JSON.parse((await readFile(file, "utf8")).replaceAll("{agentNetworkMcp}", PACKAGE_DIR.replaceAll("\\", "/")));
  } catch (e) {
    throw new AppError("INVALID_CONFIG", `Cannot read ${file}: ${(e as Error).message}`);
  }
  const base = dirname(file);
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(base, p));
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) throw new AppError("INVALID_CONFIG", `${file}: "agents" must list at least one agent`);
  if (raw.project !== undefined && typeof raw.project !== "string") throw new AppError("INVALID_CONFIG", `${file}: "project" must be the project folder`);
  const project = typeof raw.project === "string" ? abs(raw.project) : opts.projectDir;
  const seen = new Set<string>();
  const agents: RunnersConfig["agents"] = [];
  // one agent (or a spawn template under its name): command, model, files, worktree; checked the same way
  const parseAgent = async (merged: RawAgent & { worktree?: unknown }, id: string): Promise<RunnerAgentConfig> => {
    if (!Array.isArray(merged.command) || merged.command.length === 0 || !merged.command.every((c) => typeof c === "string")) {
      throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" needs "command": the agent CLI as an array, e.g. ["qwen", "{prompt}", "-m", "qwen/qwen3.5-9b"]`);
    }
    if (merged.proposeModel !== undefined && !isValidModel(merged.proposeModel)) throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" proposeModel ${JSON.stringify(merged.proposeModel)}: a model name without spaces, not starting with "-"`);
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
    // defaults.worktree: an agent without "cwd" works in <project>-<id> on branch swarm-<id>, created at start
    const wantsWorktree = (merged as { worktree?: unknown }).worktree === true && !merged.cwd;
    if (wantsWorktree && !project) throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" gets its own worktree, but the project is unknown: start ui inside the project's git repository or set "project"`);
    const worktree: AgentWorktree | undefined = wantsWorktree ? { project: project!, branch: `swarm-${id}` } : undefined;
    const cwd = merged.cwd ? abs(merged.cwd) : worktree ? join(dirname(worktree.project), `${basename(worktree.project)}-${id}`) : undefined;
    const without = Array.isArray(merged.withoutTools) ? merged.withoutTools.filter((t): t is string => typeof t === "string") : [];
    if (merged.disabledSkills !== undefined && (!Array.isArray(merged.disabledSkills) || !merged.disabledSkills.every((s) => typeof s === "string" && SKILL_NAME.test(s.replace(/:\*$/, ":x"))))) {
      throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" "disabledSkills" must be a list of skill names, e.g. ["java-tdd", "backend-design-java:migration-safety", "backend-design-java:*"]`);
    }
    const disabledSkills = [...new Set(merged.disabledSkills ?? [])];
    const byTaskRaw = merged.disabledSkillsByTask as unknown;
    const isSkillList = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string" && SKILL_NAME.test(s.replace(/:\*$/, ":x")));
    if (byTaskRaw !== undefined && (typeof byTaskRaw !== "object" || byTaskRaw === null || Array.isArray(byTaskRaw)
      || !Object.entries(byTaskRaw).every(([k, v]) => (TASK_KINDS as readonly string[]).includes(k) && isSkillList(v)))) {
      throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" "disabledSkillsByTask" must map ${TASK_KINDS.join(" / ")} to skill names, e.g. {"propose": ["java-tdd"], "code": ["java-spec-intake"]}`);
    }
    const disabledSkillsByTask = Object.fromEntries(Object.entries((byTaskRaw ?? {}) as SkillsByTask).filter(([, v]) => v.length).map(([k, v]) => [k, [...new Set(v)]])) as SkillsByTask;
    return {
      id,
      command: withoutTools(merged.command, without),
      ...(without.length ? { withoutTools: without } : {}),
      ...(disabledSkills.length ? { disabledSkills } : {}),
      ...(Object.keys(disabledSkillsByTask).length ? { disabledSkillsByTask } : {}),
      ...(cwd ? { cwd } : {}),
      ...(worktree ? { worktree } : {}),
      ...(promptFile ? { promptFile } : {}),
      ...(instructionsFile ? { instructionsFile } : {}),
      ...(systemPromptFile ? { systemPromptFile } : {}),
      ...(merged.model ? { model: merged.model } : {}),
      ...(merged.proposeModel ? { proposeModel: merged.proposeModel } : {}),
      ...(merged.models?.length ? { models: [...new Set(merged.models)] } : {}),
      ...(merged.maxRestarts !== undefined ? { maxRestarts: Number(merged.maxRestarts) } : {}),
      ...(freshPhases.length ? { freshPhases } : {}),
      ...(typeof merged.maxContextTokens === "number" && merged.maxContextTokens >= 10_000 ? { maxContextTokens: merged.maxContextTokens } : {}),
      autostart: merged.autostart !== false,
    };
  };
  // "spawn": {"templates": {"backend": {"description": "...", ...agent fields}}, "maxPerTask": 2}; a template is an agent without an id
  async function parseSpawn(rawSpawn: unknown): Promise<SpawnConfig> {
    const bad = (what: string): never => {
      throw new AppError("INVALID_CONFIG", `${file}: "spawn" ${what}`);
    };
    if (!rawSpawn || typeof rawSpawn !== "object" || Array.isArray(rawSpawn)) bad('must be an object: {"templates": {"<name>": {...}}, "maxPerTask": 2}');
    const sp = rawSpawn as { templates?: unknown; maxPerTask?: unknown };
    if (!sp.templates || typeof sp.templates !== "object" || Array.isArray(sp.templates)) bad('needs "templates": {"<name>": {"description": "...", ...agent fields}}');
    const maxPerTask = sp.maxPerTask === undefined ? 2 : Number(sp.maxPerTask);
    if (!Number.isInteger(maxPerTask) || maxPerTask < 1 || maxPerTask > 10) bad('"maxPerTask" must be a whole number 1..10');
    const templates: SpawnTemplate[] = [];
    for (const [name, t] of Object.entries(sp.templates as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9-]{0,20}$/.test(name)) bad(`template "${name}": a name of lowercase letters, digits and -`);
      if (!t || typeof t !== "object" || Array.isArray(t)) bad(`template "${name}" must be an object`);
      const { description, ...fields } = t as RawAgent & { description?: unknown; worktree?: unknown };
      if (typeof description !== "string" || !description.trim()) bad(`template "${name}" needs "description": what this kind of agent does (the lead reads it)`);
      templates.push({ name, description: (description as string).trim(), config: await parseAgent({ ...raw.defaults, ...fields }, name) });
    }
    return { templates, maxPerTask };
  }

  function parseSkillSets(rawSets: unknown): { skillSets?: SkillSet[] } {
    if (rawSets === undefined) return {};
    const bad = (what: string): never => {
      throw new AppError("INVALID_CONFIG", `${file}: "planCritic.skillSets" ${what}`);
    };
    if (!Array.isArray(rawSets)) bad('is a list: [{"name": "java-spring", "when": ["pom.xml"], "skills": ["path/to/skill"]}]');
    const strings = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim());
    const sets = (rawSets as Record<string, unknown>[]).map((x, i) => {
      if (!x || typeof x !== "object" || typeof x.name !== "string" || !x.name.trim()) bad(`[${i}] needs "name"`);
      if (!strings(x.when)) bad(`[${i}] needs "when": file names in the project's root, e.g. ["pom.xml", "build.gradle*"]`);
      if (!strings(x.skills)) bad(`[${i}] needs "skills": skill folders (with SKILL.md) or folders of skills`);
      // ~ is the home folder; a relative path is relative to this file
      return { name: (x.name as string).trim(), when: x.when as string[], skills: (x.skills as string[]).map((s) => (s.startsWith("~/") ? join(homedir(), s.slice(2)) : abs(s))) };
    });
    return sets.length ? { skillSets: sets } : {};
  }

  async function parseObserver(rawObserver: unknown, key = "observer"): Promise<ObserverConfig> {
    const bad = (what: string): never => {
      throw new AppError("INVALID_CONFIG", `${file}: "${key}" ${what}`);
    };
    if (!rawObserver || typeof rawObserver !== "object" || Array.isArray(rawObserver)) bad("must be an object");
    const o = rawObserver as Record<string, unknown>;
    if (!Array.isArray(o.command) || !o.command.length || !o.command.every((c) => typeof c === "string") || !o.command.some((c) => (c as string).includes("{prompt}"))) bad('needs "command": the CLI as an array with {prompt}');
    const command = o.command as string[];
    if (o.model !== undefined && !isValidModel(o.model)) bad('"model" must be a model name');
    if (usesModel(command) && !o.model) bad('command has {model}: set "model"');
    if (o.models !== undefined && (!Array.isArray(o.models) || !o.models.every(isValidModel))) bad('"models" must be a list of model names');
    if (typeof o.promptFile !== "string") bad(`needs "promptFile" (e.g. "{agentNetworkMcp}/examples/runner/${key === "observer" ? "observer" : "plan-critic"}-prompt.md")`);
    const promptFile = abs(o.promptFile as string);
    await readFile(promptFile, "utf8").catch((e: Error) => bad(`promptFile ${promptFile}: ${e.message}`));
    const systemPromptFile = typeof o.systemPromptFile === "string" ? abs(o.systemPromptFile) : undefined;
    if (o.cron !== undefined) {
      if (typeof o.cron !== "string") bad('"cron" must be a cron string, e.g. "0 9 * * 1"');
      try {
        parseCron(o.cron as string);
      } catch (e) {
        bad(`"cron": ${(e as Error).message}`);
      }
    }
    return {
      command, promptFile,
      ...(typeof o.model === "string" ? { model: o.model } : {}),
      ...(Array.isArray(o.models) ? { models: o.models as string[] } : {}),
      ...(systemPromptFile ? { systemPromptFile } : {}),
      ...(typeof o.cron === "string" ? { cron: o.cron } : {}),
    };
  }

  for (const a of raw.agents) {
    const merged = { ...raw.defaults, ...a };
    const id = assertAgentId(String(merged.id ?? ""), "agents[].id");
    if (seen.has(id)) throw new AppError("INVALID_CONFIG", `${file}: agent "${id}" is listed twice`);
    seen.add(id);
    agents.push(await parseAgent(merged, id));
  }
  const spawn = raw.spawn === undefined ? undefined : await parseSpawn(raw.spawn);
  const observer = raw.observer === undefined ? undefined : await parseObserver(raw.observer);
  const planCritic = raw.planCritic === undefined ? undefined : { ...(await parseObserver({ ...(raw.planCritic as object), cron: undefined }, "planCritic")), ...parseSkillSets((raw.planCritic as { skillSets?: unknown }).skillSets) };
  if (raw.mergeStrategy !== undefined && raw.mergeStrategy !== "squash" && raw.mergeStrategy !== "merge") throw new AppError("INVALID_CONFIG", `${file}: "mergeStrategy" is "squash" (one commit per task) or "merge"`);
  const mergeCheck = raw.mergeCheck === undefined ? undefined : parseMergeCheck(raw.mergeCheck, file);
  const notify = raw.notify === undefined ? undefined : parseNotify(raw.notify, file);
  const prices = parsePrices(raw.prices, file);
  const maxTaskCostUsd = raw.maxTaskCostUsd === undefined || raw.maxTaskCostUsd === null ? undefined : costLimit(raw.maxTaskCostUsd, `${file}: "maxTaskCostUsd"`);
  const verifyCommand = raw.verifyCommand === undefined || raw.verifyCommand === null ? undefined : parseVerifyCommand(raw.verifyCommand, `${file}: "verifyCommand"`);
  const supervisor = raw.supervisor === undefined ? undefined : await parseSupervisor(raw.supervisor, file, abs);
  const schedules = raw.schedules === undefined ? undefined : parseSchedules(raw.schedules, file, agents.map((a) => a.id));
  return {
    ...(typeof raw.networkDir === "string" ? { networkDir: abs(raw.networkDir) } : project ? { networkDir: join(project, ".agent-network") } : {}),
    ...(project ? { project } : {}), agents, path: file,
    ...(prices ? { prices } : {}), ...(supervisor ? { supervisor } : {}), ...(schedules?.length ? { schedules } : {}),
    ...(maxTaskCostUsd !== undefined ? { maxTaskCostUsd } : {}),
    ...(verifyCommand ? { verifyCommand } : {}),
    ...(spawn?.templates.length ? { spawn } : {}),
    ...(observer ? { observer } : {}),
    ...(planCritic ? { planCritic } : {}),
    ...(raw.mergeStrategy ? { mergeStrategy: raw.mergeStrategy as "squash" | "merge" } : {}),
    ...(mergeCheck ? { mergeCheck } : {}),
    ...(notify ? { notify } : {}),
  };
}

/** "notify": {"os": true, "remindAfterMin": 30, "kinds": ["question", "plan", …]} */
function parseNotify(raw: unknown, file: string): NotifyConfig {
  const bad = (what: string) => new AppError("INVALID_CONFIG", `${file}: "notify"${what}`);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw bad(` is {"os": true, "remindAfterMin": 30, "kinds": [${ATTENTION_KINDS.map((k) => `"${k}"`).join(", ")}]}`);
  const o = raw as { os?: unknown; remindAfterMin?: unknown; kinds?: unknown };
  if (o.os !== undefined && typeof o.os !== "boolean") throw bad('.os is true or false');
  if (o.remindAfterMin !== undefined && (typeof o.remindAfterMin !== "number" || o.remindAfterMin < 0 || o.remindAfterMin > 24 * 60)) throw bad(".remindAfterMin is minutes, 0..1440 (0: no reminders)");
  if (o.kinds !== undefined && (!Array.isArray(o.kinds) || !o.kinds.every((k) => (ATTENTION_KINDS as readonly unknown[]).includes(k)))) throw bad(`.kinds: some of ${ATTENTION_KINDS.join(", ")}`);
  return { ...(o.os !== undefined ? { os: o.os as boolean } : {}), ...(o.remindAfterMin !== undefined ? { remindAfterMin: o.remindAfterMin as number } : {}), ...(o.kinds ? { kinds: o.kinds as NotifyConfig["kinds"] } : {}) };
}

/** "mergeCheck": {"setup": ["npm ci"]} — each a plain build-tool command, as the build tool runs it. */
function parseMergeCheck(raw: unknown, file: string): { setup?: string[] } {
  const o = (raw ?? {}) as { setup?: unknown };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_CONFIG", `${file}: "mergeCheck" is {"setup": ["npm ci"]}`);
  if (o.setup === undefined) return {};
  if (!Array.isArray(o.setup) || !o.setup.every((c) => typeof c === "string" && c.trim())) throw new AppError("INVALID_CONFIG", `${file}: "mergeCheck.setup" is a list of commands, e.g. ["npm ci"]; [] for none`);
  for (const c of o.setup as string[]) {
    try {
      parseBuildCommand(c, buildTools());
    } catch (e) {
      throw new AppError("INVALID_CONFIG", `${file}: "mergeCheck.setup": ${(e as Error).message}`);
    }
  }
  return { setup: (o.setup as string[]).map((c) => c.trim()) };
}

function parseSchedules(raw: unknown, file: string, agentIds: string[]): ScheduleConfig[] {
  if (!Array.isArray(raw)) throw new AppError("INVALID_CONFIG", `${file}: "schedules" must be a list of {id, cron, title, description, agents}`);
  const out: ScheduleConfig[] = [];
  for (const [i, item] of raw.entries()) {
    const s = (item ?? {}) as Record<string, unknown>;
    const where = `${file}: schedules[${i}]${typeof s.id === "string" ? ` "${s.id}"` : ""}`;
    const bad = (what: string): never => {
      throw new AppError("INVALID_CONFIG", `${where}: ${what}`);
    };
    if (typeof s.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(s.id)) bad('"id": lowercase letters, digits and -, e.g. "nightly-flaky-tests"');
    if (out.some((o) => o.id === s.id)) bad("this id is listed twice");
    if (typeof s.cron !== "string") bad('"cron": e.g. "0 3 * * 1-5" (03:00 Mon-Fri, local time) or "@daily"');
    try {
      parseCron(s.cron as string);
    } catch (e) {
      bad((e as Error).message);
    }
    const openspec = typeof s.openspec === "string" && s.openspec.trim() ? s.openspec.trim() : undefined;
    if ((typeof s.title !== "string" || !s.title.trim()) && !openspec) bad('needs "title" (or "openspec")');
    if (s.description !== undefined && typeof s.description !== "string") bad('"description" must be text');
    if (!Array.isArray(s.agents) || !s.agents.length || !s.agents.every((a) => typeof a === "string")) bad('"agents": the lead first, e.g. ["backend", "reviewer"]');
    const unknown = (s.agents as string[]).filter((a) => !agentIds.includes(a));
    if (unknown.length) bad(`agents ${unknown.join(", ")} are not agents of this config (${agentIds.join(", ")}): nobody would pick the task up`);
    for (const k of ["maxFixRounds", "maxFollowUps"] as const) {
      if (s[k] !== undefined && (typeof s[k] !== "number" || !Number.isInteger(s[k]) || (s[k] as number) < 0)) bad(`"${k}" must be a whole number >= 0`);
    }
    if (s.maxCostUsd !== undefined && (typeof s.maxCostUsd !== "number" || !(s.maxCostUsd > 0))) bad('"maxCostUsd" must be a positive amount in USD');
    out.push({
      id: s.id as string,
      cron: s.cron as string,
      title: typeof s.title === "string" ? s.title.trim() : "",
      description: typeof s.description === "string" ? s.description : "",
      agents: s.agents as string[],
      ...(openspec ? { openspec } : {}),
      ...(typeof s.verifyCommand === "string" && s.verifyCommand.trim() ? { verifyCommand: s.verifyCommand } : {}),
      ...(s.maxFixRounds !== undefined ? { maxFixRounds: s.maxFixRounds as number } : {}),
      ...(s.maxFollowUps !== undefined ? { maxFollowUps: s.maxFollowUps as number } : {}),
      ...(s.maxCostUsd !== undefined ? { maxCostUsd: s.maxCostUsd as number } : {}),
      enabled: s.enabled !== false,
    });
  }
  return out;
}

const SCHEDULE_FIELDS = ["id", "cron", "title", "description", "agents", "openspec", "verifyCommand", "maxFixRounds", "maxFollowUps", "maxCostUsd", "enabled"] as const;

/**
 * Add, replace or remove one schedule in the JSON config (the page's schedule form), keeping everything else. The new
 * list is checked exactly as at start (agents of this config, cron, limits) before anything is written.
 * `previousId`: the schedule being edited (its id may change); without it the id must be new.
 */
export async function saveSchedule(configPath: string, agentIds: string[], change: { schedule?: Record<string, unknown>; previousId?: string; removeId?: string }): Promise<ScheduleConfig[]> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as { schedules?: Record<string, unknown>[] };
  let list = [...(raw.schedules ?? [])];
  if (change.removeId !== undefined) {
    if (!list.some((s) => s.id === change.removeId)) throw new AppError("INVALID_INPUT", `No schedule "${change.removeId}"`);
    list = list.filter((s) => s.id !== change.removeId);
  } else {
    const given = change.schedule ?? {};
    // only the known fields; empty ones are left out (the defaults apply)
    const clean: Record<string, unknown> = {};
    for (const k of SCHEDULE_FIELDS) {
      const v = given[k];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length && k !== "agents")) continue;
      clean[k] = typeof v === "string" ? v.trim() : v;
    }
    const at = change.previousId === undefined ? -1 : list.findIndex((s) => s.id === change.previousId);
    if (change.previousId !== undefined && at < 0) throw new AppError("INVALID_INPUT", `No schedule "${change.previousId}"`);
    if (list.some((s, i) => s.id === clean.id && i !== at)) throw new AppError("INVALID_INPUT", `A schedule "${String(clean.id)}" exists already: pick another id`);
    if (at >= 0) list[at] = clean;
    else list.push(clean);
  }
  let parsed: ScheduleConfig[];
  try {
    parsed = parseSchedules(list, "schedule", agentIds);
  } catch (e) {
    throw new AppError("INVALID_INPUT", (e as Error).message.replace(/^schedule: schedules\[\d+\]\s*/, ""));
  }
  if (list.length) raw.schedules = list;
  else delete raw.schedules;
  await writeConfig(configPath, raw);
  return parsed;
}

/** Switch one schedule on or off in the JSON config, keeping everything else. */
export async function saveScheduleEnabled(configPath: string, id: string, enabled: boolean): Promise<void> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as { schedules?: Record<string, unknown>[] };
  const s = raw.schedules?.find((x) => x.id === id);
  if (!s) return;
  s.enabled = enabled;
  await writeConfig(configPath, raw);
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
  /** Added by a task's lead (spawn_agent): the task and the template; it is not in runners.json. */
  spawned: { taskId: string; template: string } | null;
  /** Skills this agent may not load (from its next session). */
  disabledSkills: string[];
  /** Skills off only in one kind of task (runners.json), shown next to the switches. */
  disabledSkillsByTask: SkillsByTask;
  /** Its model in tasks that write an OpenSpec change, when it differs. */
  proposeModel: string | null;
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
  /** Urgent messages from the operator for the next session, and how to stop the current one. */
  urgent: string[];
  stopSession: (() => void) | null;
  /** An interrupt waits for the tool call in flight to finish (not mid-write), at most a while. */
  interruptAt: number | null;
  /** Spawned by a task's lead (not in runners.json). */
  spawnedFor?: { taskId: string; template: string };
}

/** How long an interrupt waits for the tool call in flight before stopping the session anyway. */
const INTERRUPT_WAIT_MS = 90_000;

/** The runners the UI process owns: start/stop per agent, a log tail of the runner and its sessions. */
export class RunnerPool {
  private readonly managed = new Map<string, Managed>();
  /** Activity of sources that are no runner (the supervisor). */
  private readonly other = new Map<string, ActivityEvent[]>();
  private seq = 0;

  constructor(
    private readonly networkDir: string,
    agents: RunnersConfig["agents"],
    private readonly opts: { maxLines?: number; run?: (o: RunnerOptions) => Promise<number>; configPath?: string; home?: string; onSessionEnd?: (agentId: string, taskId: string) => Promise<void>; onGiveUp?: (agentId: string, taskId: string, reason: string) => Promise<void> } = {},
  ) {
    for (const config of agents) this.managed.set(config.id, { config, startedAt: null, stoppedAt: null, lines: [], partial: "", session: null, events: [], urgent: [], stopSession: null, interruptAt: null });
  }

  ids(): string[] {
    return [...this.managed.keys()];
  }

  /** Where an agent works: its folder and, for an auto worktree, the project and branch. */
  agentFolder(id: string): { cwd?: string; worktree?: AgentWorktree } | null {
    const m = this.managed.get(id);
    return m ? { ...(m.config.cwd ? { cwd: m.config.cwd } : {}), ...(m.config.worktree ? { worktree: m.config.worktree } : {}) } : null;
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
      spawned: m.spawnedFor ?? null,
      disabledSkills: m.config.disabledSkills ?? [],
      disabledSkillsByTask: m.config.disabledSkillsByTask ?? {},
      proposeModel: m.config.proposeModel ?? null,
    }));
  }

  /** The skills installed in the user's folders and the agents' folders, for the page's on/off table. */
  async skills(projectDir?: string): Promise<SkillInfo[]> {
    const dirs = [...(projectDir ? [projectDir] : []), ...[...this.managed.values()].flatMap((m) => (m.config.cwd ? [m.config.cwd] : []))];
    return listSkills(dirs, this.opts.home);
  }

  /**
   * Switch a skill on or off for an agent from its next session (a running session keeps what it got). With a config file
   * the list is written back there ("disabledSkills"), so it survives a restart.
   */
  async setSkillEnabled(id: string, skill: string, enabled: boolean): Promise<RunnerView> {
    const m = this.get(id);
    const name = skill.trim();
    if (!SKILL_NAME.test(name.replace(/:\*$/, ":x"))) throw new AppError("INVALID_INPUT", `Not a skill name: ${JSON.stringify(skill)}`);
    const now = m.config.disabledSkills ?? [];
    const next = enabled ? now.filter((s) => s !== name) : [...new Set([...now, name])];
    if (next.length) m.config.disabledSkills = next;
    else delete m.config.disabledSkills;
    if (this.opts.configPath && !this.managed.get(id)?.spawnedFor) await saveAgentField(this.opts.configPath, id, "disabledSkills", next.length ? next : null);
    this.say(m, `[ui] skill ${name} ${enabled ? "on" : "off"}${m.controller ? " (applies from the next session)" : ""}`);
    return this.view(id);
  }

  /** An agent a lead spawned: its runner joins the pool (not runners.json) and starts. Returns false when it is there already. */
  add(config: RunnersConfig["agents"][number], spawnedFor: { taskId: string; template: string }): boolean {
    if (this.managed.has(config.id)) return false;
    this.managed.set(config.id, { config, startedAt: null, stoppedAt: null, lines: [], partial: "", session: null, events: [], urgent: [], stopSession: null, interruptAt: null, spawnedFor });
    this.start(config.id);
    return true;
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
    if (this.opts.configPath && !this.managed.get(id)?.spawnedFor) await saveAgentField(this.opts.configPath, id, "instructionsFile", given);
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
    if (this.opts.configPath && !this.managed.get(id)?.spawnedFor) await saveAgentField(this.opts.configPath, id, "model", model);
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
    if (m.interruptAt !== null && item.kind === "tool_result") queueMicrotask(() => this.interruptNow(m)); // the call in flight is done
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
      model: (task) => (task?.proposes && m.config.proposeModel) || m.config.model,
      disabledSkills: (task) => sessionDisabledSkills(m.config.disabledSkills ?? [], m.config.disabledSkillsByTask, task),
      onSession: (session) => {
        m.session = session;
      },
      onActivity: (e) => this.record(m, e),
      ...(this.opts.onSessionEnd ? { onSessionEnd: (taskId: string) => this.opts.onSessionEnd!(m.config.id, taskId) } : {}),
      ...(this.opts.onGiveUp ? { onGiveUp: (taskId: string, reason: string) => this.opts.onGiveUp!(m.config.id, taskId, reason) } : {}),
      // an auto worktree removed after a task ("Убрать worktree") comes back from the project's HEAD before the next session
      // and its branch gets the task's base when it lacks it (the project moved on, e.g. by the squash of its previous task)
      ...(m.config.worktree
        ? {
            prepare: async (task: Task) => {
              (await ensureWorktrees([m.config])).forEach((line) => this.say(m, `[ui] worktree created again: ${line}`));
              const base = task.baseCommit ?? task.git?.commit;
              return base && m.config.cwd ? ((await catchUpBranch(m.config.cwd, base)) ?? undefined) : undefined;
            },
          }
        : {}),
      urgent: {
        take: () => {
          const text = m.urgent.splice(0).join("\n\n");
          return text || undefined;
        },
        attach: (stop) => {
          m.stopSession = stop;
          if (!stop) m.interruptAt = null;
          else if (m.urgent.length) this.interruptNow(m); // it came while no session ran: the next one starts with it anyway
        },
      },
      ...(m.config.maxRestarts !== undefined ? { maxRestarts: m.config.maxRestarts } : {}),
      ...(m.config.freshPhases ? { freshPhases: m.config.freshPhases } : {}),
      ...(m.config.maxContextTokens ? { maxContextTokens: m.config.maxContextTokens } : {}),
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

  /**
   * The operator's urgent message: stop the agent's current session as soon as its tool call in flight is done (never
   * in the middle of one, at most INTERRUPT_WAIT_MS), and start the next session with the message first. Returns what
   * happens: "now" (stopped), "after-tool" (stops when the call in flight ends), "next-session" (no session runs now;
   * the next one starts with it), "not-running" (the runner is stopped: the message waits in pendingMessages).
   */
  interrupt(id: string, text: string): "now" | "after-tool" | "next-session" | "not-running" {
    const m = this.get(id);
    if (!m.controller) return "not-running";
    m.urgent.push(text);
    if (!m.stopSession) return "next-session";
    const last = [...m.events].reverse().find((e) => e.kind === "tool_use" || e.kind === "tool_result");
    if (last?.kind === "tool_use") {
      m.interruptAt = Date.now() + INTERRUPT_WAIT_MS;
      this.say(m, "[ui] urgent message from the operator: the session stops when its current tool call ends");
      setTimeout(() => {
        if (m.interruptAt !== null && Date.now() >= m.interruptAt) this.interruptNow(m);
      }, INTERRUPT_WAIT_MS + 50);
      return "after-tool";
    }
    this.interruptNow(m);
    return "now";
  }

  private interruptNow(m: Managed): void {
    m.interruptAt = null;
    if (!m.stopSession) return;
    this.say(m, "[ui] urgent message from the operator: stopping the session; the next one starts with it");
    m.stopSession();
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
async function saveAgentField(configPath: string, id: string, field: string, value: string | string[] | null): Promise<void> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as { agents?: Record<string, unknown>[] };
  const agent = raw.agents?.find((a) => a.id === id);
  if (!agent) return;
  if (value === null) delete agent[field];
  else agent[field] = value;
  await writeConfig(configPath, raw);
}
