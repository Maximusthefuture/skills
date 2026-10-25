import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isHandedOver } from "./handoff.js";
import { isParked, lastPark } from "./park.js";
import { progressMark, uncommittedCount, workBrief } from "./progress.js";
import { NetworkService } from "./service.js";
import { SessionOutput, type ActivityItem, type SessionResult } from "./sessionOutput.js";
import { FileStore } from "./storage/fileStore.js";
import { AgentStore, defaultIsProcessAlive } from "./stores/agentStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { DISABLED_SKILLS_ENV, disabledSkillsNote, withSkillOverrides } from "./skills.js";
import { SessionStore } from "./stores/sessionStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type { Phase, Task } from "./types.js";

/**
 * Supervisor that keeps one agent working across tasks without an LLM in the idle loop: it watches the network
 * directory, starts a fresh agent session (any headless CLI: `claude -p`, `qwen -p`, `codex exec`) when a task for
 * the agent appears, restarts the session when it ends before the task is finished, and waits again after DONE.
 * Inside a session the agent follows nextAction as usual; the runner never calls the swarm tools itself and never
 * registers as an agent.
 */

export const DEFAULT_PROMPT =
  'You are agent {agent} of the agent-network swarm. Task {taskId} ("{title}") is assigned to you. ' +
  "Work through the agent-network MCP tools and the project files: call swarm_context first, then do what nextAction says " +
  "and read nextAction in every response; when it is wait, call wait(). End your turn only when nextAction is done. " +
  "Nobody reads your replies in this session: if something only a human can decide is unclear (scope, requirements), ask with " +
  'send_message({to: "operator", message: <question and the option you would take>}) and call wait() for the answer; ' +
  "with no answer in 10 minutes go ahead with that option and tell the other agents. Never invent the scope. " +
  "Stuck on the environment (a refused command, a hung process, an unreachable service) after two attempts: stop retrying and ask the operator the same way.{resume}";

const RESUME =
  " This is session {attempt} for this task: the previous one ended before the task was done. " +
  "Call swarm_context to see where the task stands (your 'subtasks' show which steps are already done); do not redo work that is already committed or reported.";

/**
 * How the operator reaches an agent at once (Claude and Qwen alike): the runner stops the session the agent is in and
 * starts a fresh one whose prompt begins with the message. The page owns it (RunnerPool.interrupt).
 */
export interface UrgentChannel {
  /** The urgent message(s) for the next session, taken once. */
  take(): string | undefined;
  /** The runner hands over how to stop the session it runs now (null between sessions). */
  attach(stop: (() => void) | null): void;
}

export const URGENT =
  "URGENT FROM THE OPERATOR — your previous session was stopped so that you read this first:\n{message}\n" +
  "Act on it first (it is also in pendingMessages), then go on with the task as usual.\n\n";

const HANDOFF =
  " This is a fresh session for phase {phase}: the previous session handed the task over when the phase changed. " +
  "You have not seen the earlier discussion, on purpose: work from swarm_context (the task and the agreement) and the code, not from what the others say they did.";

const TURN_LIMIT =
  " The previous session for this task ended in the middle of the work (its turn limit, or its context grew large): sessions are kept short on purpose, " +
  "because the whole context is read again on every turn. Call swarm_context (your 'subtasks' show what is done and what is in progress), " +
  "look at the state of your folder at the end of this prompt (read the diff only of the files you need), and go on from there without redoing finished steps.";

export interface PromptVars {
  agent: string;
  taskId: string;
  title: string;
  attempt: number;
  /** The previous session ended because the task entered this phase (see handoff.ts). */
  handoff?: Phase;
  /** The previous session ended at its turn limit after making progress. */
  afterTurnLimit?: boolean;
  /** Files changed and not committed in the agent's folder, when that many that a fresh session should commit first. */
  uncommitted?: number;
}

/** From this many uncommitted files on, a session after the turn limit is told to commit first. */
export const COMMIT_FIRST_AT = 8;

export function renderPrompt(template: string, v: PromptVars): string {
  const resume = v.handoff
    ? HANDOFF.replaceAll("{phase}", v.handoff)
    : v.afterTurnLimit
      ? TURN_LIMIT +
        (v.uncommitted
          ? ` ${v.uncommitted} files are changed and not committed: first commit what already works (a work-in-progress commit is fine), ` +
            "then go on and commit after every subtask that turns green. Every fresh session then starts from git log instead of a long diff."
          : "")
      : v.attempt > 1
        ? RESUME.replaceAll("{attempt}", String(v.attempt))
        : "";
  return template
    .replaceAll("{resume}", resume)
    .replaceAll("{agent}", v.agent)
    .replaceAll("{taskId}", v.taskId)
    .replaceAll("{title}", v.title)
    .replaceAll("{attempt}", String(v.attempt));
}

/** The operator's own instructions for one agent (its role, rules, style) go after the standard prompt, never instead of it. */
export function withInstructions(prompt: string, instructions: string | undefined, v: PromptVars): string {
  const text = instructions?.trim();
  return text ? `${prompt}\n\nInstructions from the operator for you (${v.agent}):\n${renderPrompt(text, v)}` : prompt;
}

/**
 * One more folder the session may read and write (the contract's worktree): Claude Code's --add-dir, Qwen Code's
 * --include-directories, put right after the CLI's name; another CLI is left as it is (added: false).
 */
export function withExtraDir(command: string[], dir: string): { command: string[]; added: boolean } {
  const cli = basename(command[0] ?? "");
  const flag = cli === "claude" ? "--add-dir" : cli === "qwen" ? "--include-directories" : null;
  if (!flag) return { command, added: false };
  return { command: [command[0]!, flag, dir, ...command.slice(1)], added: true };
}

/**
 * `{prompt}` inside any argument is replaced; without a placeholder the prompt becomes the last argument.
 * `{systemPrompt}` is replaced by the system prompt text (for --system-prompt), when given.
 */
export function buildArgv(command: string[], prompt: string, systemPrompt?: string): string[] {
  const args = systemPrompt === undefined ? command : command.map((a) => a.replaceAll("{systemPrompt}", systemPrompt));
  return args.some((a) => a.includes("{prompt}")) ? args.map((a) => a.replaceAll("{prompt}", prompt)) : [...args, prompt];
}

/** `{model}` in the command (e.g. `-m "{model}"`) lets the operator pick the model per agent without rewriting the command. */
export const usesModel = (command: string[]): boolean => command.some((a) => a.includes("{model}"));

export function withModel(command: string[], model: string | undefined): string[] {
  return model === undefined ? command : command.map((a) => a.replaceAll("{model}", model));
}

/** A model name as it goes into the argv: no spaces, and it cannot be taken for a flag. */
export function isValidModel(model: unknown): model is string {
  return typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(model);
}

/** The turn limit the command gives the CLI: `--max-turns 70` (Claude Code) or `--max-session-turns 70` (Qwen Code). */
export function turnLimitOf(command: string[]): number | undefined {
  for (let i = 0; i < command.length; i++) {
    const m = /^--max(?:-session)?-turns(?:=(\d+))?$/.exec(command[i]!);
    if (!m) continue;
    const n = Number(m[1] ?? command[i + 1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/** Used for {systemPrompt} when the system prompt file cannot be read: the CLI must not get an empty system prompt. */
export const FALLBACK_SYSTEM_PROMPT = "You are a headless coding agent in an agent-network swarm. Follow nextAction from the agent-network tools.";

const seq = (t: Task): number => Number(t.id.slice(t.id.lastIndexOf("-") + 1));
const isFinished = (t: Task): boolean => t.status === "COMPLETED" || t.status === "CANCELLED";

/** The same task the server treats as current: the oldest unfinished (ACTIVE or BLOCKED) task of the agent. */
export function pickTask(tasks: Task[], agent: string): Task | null {
  return [...tasks].sort((a, b) => seq(a) - seq(b)).find((t) => t.agents.includes(agent) && (t.status === "ACTIVE" || t.status === "BLOCKED")) ?? null;
}

export interface RunningSession {
  taskId: string;
  attempt: number;
  startedAt: string;
  model?: string;
}

export interface RunnerOptions {
  agent: string;
  networkDir: string;
  /** Agent CLI argv; `{prompt}` is replaced by the prompt (or the prompt is appended). */
  command: string[];
  cwd?: string;
  /** Placeholders: {agent} {taskId} {title} {attempt} {resume}. */
  promptTemplate?: string;
  /** Read before every session (edits apply to the next one); replaces the whole template. Wins over promptTemplate. */
  promptFile?: string;
  /** Read before every session: the agent's own instructions, appended to the prompt. */
  instructionsFile?: string;
  /** Read before every session and put where the command has {systemPrompt} (e.g. --system-prompt "{systemPrompt}"). */
  systemPromptFile?: string;
  /** Put where the command has {model}. A function is asked before every session, so a change applies to the next one. */
  model?: string | ((task?: Task) => string | undefined);
  /**
   * Skills switched off for this agent in this task, asked before every session: Claude Code does not list them
   * (skillOverrides in --settings), other CLIs get them named in the prompt; the hook "pre-skill" refuses them.
   */
  disabledSkills?: (task?: Task) => readonly string[];
  /** Extra sessions for one task after the first before the runner gives up until the task changes. Default 3. */
  maxRestarts?: number;
  /**
   * When the task enters one of these phases, the session that saw an earlier phase ends and a fresh one takes over
   * (["SYNC"]: the review is done by a session that did not take part in the discussion). Such a handoff is not a failed attempt.
   */
  freshPhases?: readonly Phase[];
  /** How often the idle runner looks at the network directory. Default 2000 ms. */
  pollMs?: number;
  /** Pause before a restart, multiplied by the attempt number. Default 5000 ms. */
  restartDelayMs?: number;
  /** Return after the first task leaves the runner's hands (finished, cancelled or given up). */
  once?: boolean;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Child stdout/stderr. Default inherit; ignored when `output` is given. */
  stdio?: "inherit" | "ignore";
  /** Receive the session's stdout/stderr instead of inheriting them (e.g. to show a log tail in the UI). */
  output?: (text: string) => void;
  isProcessAlive?: (pid: number) => boolean;
  /** Told when a session starts and (with null) when it ends: the UI shows what each runner is doing right now. */
  onSession?: (session: RunningSession | null) => void;
  /** The sessions' activity as it comes (tool calls, results, text): the activity feed on the page. */
  onActivity?: (e: ActivityItem) => void;
  /** The operator's urgent messages: interrupt the current session and start the next one with the message first. */
  urgent?: UrgentChannel;
  /**
   * End a session whose context grew past this many tokens (after the tool call in flight) and go on in a fresh one, as
   * after the turn limit: every turn reads the whole context again. Claude Code's stream-json reports it; off when unset.
   */
  maxContextTokens?: number;
  /** Before a session starts: e.g. create the agent's worktree again after the operator removed it. Throwing = not now. */
  /** Before each session of a task (e.g. its worktree, its branch up to the task's base); a returned line goes to the log. */
  prepare?: (task: Task) => Promise<string | void>;
  /** The runner gave up on a task (maxRestarts sessions failed): the page blocks the task, so the operator sees it. */
  onGiveUp?: (taskId: string, reason: string) => Promise<void> | void;
  /** After a session is recorded, before the runner looks at the task again (the page checks the task's cost limit here). */
  onSessionEnd?: (taskId: string) => Promise<void> | void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal?.aborted) return done();
    const t = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    function finish(): void {
      clearTimeout(t);
      signal?.removeEventListener("abort", finish);
      done();
    }
  });
}

export interface SessionRun {
  code: number;
  result?: SessionResult;
  /** The CLI's id of the session, when its output named one. */
  sessionId?: string;
}

/**
 * Runs the agent session; on abort sends SIGTERM, then SIGKILL after 10 s. Its stdout goes through SessionOutput
 * (JSON events become a readable log and the final usage is kept); `sink` receives what to show (null = nothing).
 */
export function runSession(argv: string[], env: NodeJS.ProcessEnv, cwd: string | undefined, sink: ((text: string) => void) | null, signal?: AbortSignal, onEvent?: (e: ActivityItem) => void, onContext?: (tokens: number) => void): Promise<SessionRun> {
  return new Promise((done) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const parsed = new SessionOutput(onEvent, Date.now, onContext);
    const show = (text: string): void => {
      if (text && sink) sink(text);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => show(parsed.feed(text)));
    child.stderr.on("data", (text: string) => {
      show(text);
      for (const line of text.split("\n")) if (line.trim()) onEvent?.({ kind: "stderr", summary: line.trim().slice(0, 300) });
    });
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (): void => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    };
    if (signal?.aborted) stop(); // stopped while the session was being prepared
    else signal?.addEventListener("abort", stop, { once: true });
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
      show(parsed.end());
      const result = parsed.result();
      const sessionId = parsed.sessionId();
      done({ code, ...(result ? { result } : {}), ...(sessionId ? { sessionId } : {}) });
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      show(`cannot start ${argv[0]}: ${e.code ?? e.message}\n`);
      finish(127); // e.g. the CLI is not installed
    });
    child.on("close", (code, sig) => finish(code ?? (sig ? 128 : 1))); // after the output is fully read
  });
}

/** A file the operator may edit at any time; unreadable = say so and go on without it. */
async function readText(path: string, what: string, log: (l: string) => void): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    log(`cannot read the ${what} ${path} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}); starting without it`);
    return undefined;
  }
}

/** Returns 0 when stopped by the signal or after --once finished the task, 1 when --once gave up. */
export async function runRunner(opts: RunnerOptions): Promise<number> {
  const { agent, signal } = opts;
  const log = opts.log ?? ((l: string) => process.stderr.write(`[runner ${agent}] ${l}\n`));
  const maxRestarts = opts.maxRestarts ?? 3;
  const pollMs = opts.pollMs ?? 2000;
  const restartDelayMs = opts.restartDelayMs ?? 5000;
  const alive = opts.isProcessAlive ?? defaultIsProcessAlive;
  const networkDir = resolve(opts.networkDir);
  const fs = await FileStore.open(networkDir);
  const tasks = new TaskStore(fs);
  const agents = new AgentStore(fs);
  const messages = new MessageStore(fs);
  const sessions = new SessionStore(fs);
  const turnLimit = turnLimitOf(opts.command);

  const attempts = new Map<string, number>();
  const freshPhases = opts.freshPhases ?? [];
  /** taskId -> sessions that ended by design (a handoff, or the task became BLOCKED); they do not count against maxRestarts. */
  const plannedEnds = new Map<string, number>();
  /** taskId -> the phase the next session takes over after a handoff. */
  const handedTo = new Map<string, Phase>();
  /** Tasks whose last session ended at its turn limit after making progress: the next one is told to go on from there. */
  const turnLimited = new Set<string>();
  /** taskId -> state signature when the runner gave up; retried as soon as the state changes. */
  const gaveUp = new Map<string, string>();
  let note = "";
  const say = (line: string): void => {
    if (line !== note) log(line);
    note = line;
  };
  /** What the agent has done on the task (see progress.ts): compared before and after a session. */
  const progress = (taskId: string): Promise<string> => progressMark(fs, taskId, agent, opts.cwd);
  /** Phase/status changes and new messages for the agent: a reason to try a given-up task again. */
  const signature = async (t: Task): Promise<string> => {
    const mine = await messages.list(t.id, { to: agent });
    return `${t.updatedAt}|${mine.at(-1)?.id ?? ""}`;
  };

  say(`waiting for tasks in ${networkDir}`);
  while (!signal?.aborted) {
    const task = pickTask(await tasks.listForAgent(agent), agent);
    if (!task) {
      say("no task; waiting");
      await sleep(pollMs, signal);
      continue;
    }
    if (task.status === "BLOCKED") {
      const handover = task.handover;
      if (handover && Date.parse(handover.dueAt) <= Date.now()) {
        // the operator let the deadline pass: the lead takes over the stuck fix (any runner of the task may do it, once)
        const service = await NetworkService.create(networkDir, { id: agent, type: "runner" });
        try {
          if (await service.escalateIfDue(task.id)) log(`${task.id}: the operator did not decide in time; ${handover.lead} (the lead) takes over the fix of ${handover.from.join(", ")}`);
        } catch (e) {
          log(`${task.id}: cannot hand the fix over to the lead: ${(e as Error).message}`);
          await sleep(pollMs, signal);
        } finally {
          service.close();
        }
        continue;
      }
      const lead = handover ? `; ${handover.lead} (the lead) takes over at ${new Date(handover.dueAt).toLocaleTimeString()} unless the operator decides` : "";
      say(`${task.id} is BLOCKED (${task.blockedReason ?? "fix-round limit"}); waiting for the operator${lead}`);
      await sleep(pollMs, signal);
      continue;
    }
    // the last session parked on this state (nothing to do but wait for the others): wait here, without a model
    if (await isParked(fs, agent, task).catch(() => false)) {
      say(`${task.id}: parked in ${task.phase}, waiting without a model until something changes for ${agent}`);
      await sleep(pollMs, signal);
      continue;
    }
    const given = gaveUp.get(task.id);
    if (given !== undefined) {
      if (given === (await signature(task))) {
        say(`gave up on ${task.id}; waiting until it changes`);
        await sleep(pollMs, signal);
        continue;
      }
      gaveUp.delete(task.id);
      attempts.delete(task.id);
      log(`${task.id} changed; trying again`);
    }
    const holder = await agents.get(agent);
    if (holder && holder.status !== "OFFLINE" && holder.pid !== undefined && alive(holder.pid)) {
      say(`agent id ${agent} is held by a live process (pid ${holder.pid}); waiting`);
      await sleep(pollMs, signal);
      continue;
    }

    const model = usesModel(opts.command) ? (typeof opts.model === "function" ? opts.model(task) : opts.model) : undefined;
    if (usesModel(opts.command) && !model) {
      say("the command has {model} but no model is set; waiting");
      await sleep(pollMs, signal);
      continue;
    }
    if (opts.prepare) {
      try {
        const line = await opts.prepare(task);
        if (line) say(`${task.id}: ${line}`);
      } catch (e) {
        say(`cannot prepare the session: ${(e as Error).message}; waiting`);
        await sleep(pollMs, signal);
        continue;
      }
    }

    const attempt = (attempts.get(task.id) ?? 0) + 1;
    attempts.set(task.id, attempt);
    const handoff = handedTo.get(task.id);
    handedTo.delete(task.id);
    const afterTurnLimit = turnLimited.delete(task.id);
    // a long uncommitted diff costs every fresh session many turns of finding its bearings: commit first
    const uncommitted = afterTurnLimit ? await uncommittedCount(opts.cwd) : 0;
    const vars = {
      agent, taskId: task.id, title: task.title, attempt, ...(handoff ? { handoff } : {}), ...(afterTurnLimit ? { afterTurnLimit } : {}),
      ...(uncommitted >= COMMIT_FIRST_AT ? { uncommitted } : {}),
    };
    const template = (opts.promptFile ? await readText(opts.promptFile, "prompt file", log) : undefined) ?? opts.promptTemplate ?? DEFAULT_PROMPT;
    const instructions = opts.instructionsFile ? await readText(opts.instructionsFile, "instructions file", log) : undefined;
    const urgent = opts.urgent?.take();
    // where the work stands on disk, so the session does not spend its first turns (and context) on git log and status
    const brief = await workBrief(opts.cwd).catch(() => "");
    const offSkills = [...(opts.disabledSkills?.(task) ?? [])];
    // the lead of a task that changes the API contract writes the contract's worktree too: the CLI is told so
    const contractDir = task.contract && task.agents[0] === agent ? task.contract.worktree : undefined;
    const dirs = contractDir ? withExtraDir(opts.command, contractDir) : { command: opts.command, added: false };
    const skillsOff = withSkillOverrides(dirs.command, offSkills);
    const prompt =
      (urgent ? URGENT.replace("{message}", urgent) : "") +
      withInstructions(renderPrompt(template, vars), instructions, vars) +
      (skillsOff.hidden ? "" : disabledSkillsNote(offSkills)) +
      (brief ? `\n\nYour folder right now (from the runner, no need to run git log or git status for this):\n${brief}` : "") +
      (contractDir ? `\n\nThe API contract's worktree of this task, yours to edit: ${contractDir}${dirs.added ? "" : " (your CLI may ask before writing outside your folder)"}.` : "");
    const env = {
      ...process.env, AGENT_ID: agent, NETWORK_DIR: networkDir, AGENT_NETWORK_TASK_ID: task.id, AGENT_NETWORK_ATTEMPT: String(attempt), AGENT_NETWORK_RUNNER: "1",
      [DISABLED_SKILLS_ENV]: JSON.stringify(offSkills),
      ...(freshPhases.length ? { AGENT_NETWORK_FRESH_PHASES: freshPhases.join(",") } : {}),
    };
    say(`${task.id}: starting session ${attempt} (phase ${task.phase}${handoff ? ", fresh after a handoff" : afterTurnLimit ? ", going on after the turn limit" : ""}${model ? `, model ${model}` : ""})`);
    const progressBefore = await progress(task.id).catch(() => "");
    const finishedBefore = new Set((await tasks.listForAgent(agent)).filter(isFinished).map((t) => t.id));
    const sink = opts.output ?? (opts.stdio === "ignore" ? null : (text: string) => void process.stdout.write(text));
    const startedAt = new Date();
    opts.onSession?.({ taskId: task.id, attempt, startedAt: startedAt.toISOString(), ...(model ? { model } : {}) });
    const wantsSystem = opts.command.some((a) => a.includes("{systemPrompt}"));
    const systemText = wantsSystem ? (opts.systemPromptFile ? await readText(opts.systemPromptFile, "system prompt file", log) : undefined) : undefined;
    const system = wantsSystem ? renderPrompt(systemText?.trim() || FALLBACK_SYSTEM_PROMPT, vars) : undefined;
    // its own stop, so that an urgent message ends this session without stopping the runner
    const session = new AbortController();
    const stopAll = () => session.abort();
    signal?.addEventListener("abort", stopAll, { once: true });
    let interrupted = false;
    opts.urgent?.attach(() => {
      interrupted = true;
      session.abort();
    });
    // the context grew too big: end the session once its current tool call is back, a fresh one goes on
    let contextFull = 0;
    let contextEnded = false;
    const onContext = (tokens: number): void => {
      if (opts.maxContextTokens && tokens > opts.maxContextTokens && !contextFull) contextFull = tokens;
    };
    const skills: string[] = [];
    const onActivity = (e: ActivityItem): void => {
      opts.onActivity?.(e);
      if (e.skill && !skills.includes(e.skill)) skills.push(e.skill);
      if (contextFull && !contextEnded && e.kind === "tool_result") {
        contextEnded = true;
        session.abort();
      }
    };
    const { code, result } = await runSession(buildArgv(withModel(skillsOff.command, model), prompt, system), env, opts.cwd, sink, signal?.aborted ? signal : session.signal, onActivity, onContext);
    opts.urgent?.attach(null);
    signal?.removeEventListener("abort", stopAll);
    const endedAt = new Date();
    opts.onSession?.(null);
    // a session stopped by its turn limit after doing something is a planned end (short sessions keep the context small)
    const hitTurnLimit = result?.stopReason === "max_turns" || (turnLimit !== undefined && (result?.numTurns ?? 0) >= turnLimit);
    const plannedTurnLimit = hitTurnLimit && (await progress(task.id).catch(() => progressBefore)) !== progressBefore;
    // a session may go on to the next task by itself (e.g. a follow-up): its time and tokens are counted for this task
    const alsoTasks = (await tasks.listForAgent(agent)).filter((t) => isFinished(t) && t.id !== task.id && !finishedBefore.has(t.id));
    // why it ended, for the record (the page's runs, the observer, cost by phase)
    const ended = await tasks.find(task.id).catch(() => null);
    const parkedBy = await lastPark(fs, agent).catch(() => null);
    const endedBy = contextEnded
      ? ("context-limit" as const)
      : interrupted
      ? ("interrupted" as const)
      : !ended || isFinished(ended)
        ? ("task-done" as const)
        : parkedBy?.taskId === task.id && Date.parse(parkedBy.at) >= startedAt.getTime()
          ? ("parked" as const)
          : ended.status === "BLOCKED"
            ? ("blocked" as const)
            : freshPhases.length && (ended.phaseHistory?.length ?? 0) > (task.phaseHistory?.length ?? 0) && (await isHandedOver(fs, agent, ended).catch(() => false))
              ? ("handoff" as const)
              : plannedTurnLimit
                ? ("turn-limit" as const)
                : code === 0
                  ? ("ended" as const)
                  : ("failed" as const);
    await sessions
      .create({
        taskId: task.id, agentId: agent, attempt, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(), exitCode: code,
        ...(result?.usage ? { usage: result.usage } : {}),
        ...(result?.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        // stopped before the CLI's result (the context limit): tokens read so far; the statistics price them (stats.ts)
        ...(result?.partial && result.usage ? { usagePartial: true as const } : {}),
        ...(result?.numTurns !== undefined ? { numTurns: result.numTurns } : {}),
        ...(result?.model || model ? { model: result?.model ?? model } : {}), // what the CLI reported, else what it was asked for
        ...(skills.length ? { skills } : {}),
        ...(alsoTasks.length ? { alsoFinished: alsoTasks.map((t) => t.id) } : {}),
        ...(plannedTurnLimit ? { turnLimit: true as const } : {}),
        phase: task.phase, ...(ended ? { endPhase: ended.phase } : {}), endedBy,
      })
      .catch((e: Error) => log(`cannot record the session: ${e.message}`));
    await Promise.resolve(opts.onSessionEnd?.(task.id)).catch((e: Error) => log(`after the session: ${e.message}`));
    if (signal?.aborted) break;
    if (contextEnded && !signal?.aborted) {
      turnLimited.add(task.id);
      const limits = `${Math.round(contextFull / 1000)}k tokens of context (limit ${Math.round(opts.maxContextTokens! / 1000)}k)`;
      // after progress, a planned end like the turn limit: the next session goes on from the subtasks and git, with a small
      // context. Without progress it is a failed attempt (a first step whose output alone fills the context would
      // otherwise restart the same session for ever): it waits and counts against maxRestarts
      if ((await progress(task.id).catch(() => progressBefore)) !== progressBefore) {
        plannedEnds.set(task.id, (plannedEnds.get(task.id) ?? 0) + 1);
        say(`${task.id}: session ${attempt} reached ${limits}; a fresh session goes on (phase ${task.phase})`);
        continue;
      }
      say(`${task.id}: session ${attempt} reached ${limits} without progress: counted as a failed attempt`);
    }
    if (interrupted) {
      // the operator's urgent message: a planned end, the next session starts at once with the message first
      plannedEnds.set(task.id, (plannedEnds.get(task.id) ?? 0) + 1);
      say(`${task.id}: session ${attempt} stopped for the operator's urgent message; a fresh session starts with it`);
      continue;
    }

    const after = await tasks.find(task.id);
    if (!after || isFinished(after)) {
      const also = alsoTasks.map((t) => `${t.id} ${t.status}`);
      const tokens = result?.usage ? `, ${result.usage.total} tokens` : "";
      say(`${task.id}: ${after?.status ?? "gone"}${also.length ? `; in the same session also ${also.join(", ")}` : ""} (session exit ${code}${tokens})`);
      attempts.delete(task.id);
      plannedEnds.delete(task.id);
      if (opts.once) return 0;
      continue;
    }
    // the session parked (a planned end): the top of the loop waits without a model, or, if something changed for the
    // agent while the session was ending, starts a fresh one at once
    const parked = await lastPark(fs, agent).catch(() => null);
    if (parked?.taskId === task.id && Date.parse(parked.at) >= startedAt.getTime()) {
      plannedEnds.set(task.id, (plannedEnds.get(task.id) ?? 0) + 1);
      if (!(await isParked(fs, agent, after).catch(() => false))) say(`${task.id}: parked, but something changed for ${agent} meanwhile; a fresh session starts`);
      continue;
    }
    if (after.status === "BLOCKED") {
      // the server ends runner sessions on a BLOCKED task; the top of the loop waits for the operator without a model
      plannedEnds.set(task.id, (plannedEnds.get(task.id) ?? 0) + 1);
      continue;
    }
    // the server told the session to end because the task moved on into a fresh phase: start the fresh one right away
    const movedOn = (after.phaseHistory?.length ?? 0) > (task.phaseHistory?.length ?? 0);
    if (freshPhases.length && movedOn && (await isHandedOver(fs, agent, after).catch(() => false))) {
      plannedEnds.set(task.id, (plannedEnds.get(task.id) ?? 0) + 1);
      handedTo.set(task.id, after.phase);
      say(`${task.id}: handoff to a fresh session for ${after.phase} (session exit ${code})`);
      continue;
    }
    if (plannedTurnLimit) {
      plannedEnds.set(task.id, (plannedEnds.get(task.id) ?? 0) + 1);
      turnLimited.add(task.id);
      say(`${task.id}: session ${attempt} reached its turn limit (${result?.numTurns ?? turnLimit} turns) after progress; a fresh session goes on (phase ${after.phase})`);
      continue;
    }
    if (attempt - (plannedEnds.get(task.id) ?? 0) > maxRestarts) {
      gaveUp.set(task.id, await signature(after));
      plannedEnds.delete(task.id);
      say(`${task.id}: ${attempt} sessions ended before the task was done (last exit ${code}); giving up until the task changes`);
      // the others would wait for this agent forever: the operator has to see it (unblocking it changes the task: we try again)
      await Promise.resolve(opts.onGiveUp?.(task.id, `${attempt} sessions ended before its part was done (last exit ${code})`)).catch((e: Error) => log(`after giving up: ${e.message}`));
      if (opts.once) return 1;
      continue;
    }
    const delay = restartDelayMs * attempt;
    say(`${task.id}: session ended (exit ${code}) in phase ${after.phase}; restarting in ${Math.round(delay / 1000)} s`);
    await sleep(delay, signal);
  }
  log("stopped");
  return 0;
}
