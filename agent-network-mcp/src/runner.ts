import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { FileStore } from "./storage/fileStore.js";
import { AgentStore, defaultIsProcessAlive } from "./stores/agentStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type { Task } from "./types.js";

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
  "and read nextAction in every response; when it is wait, call wait(). End your turn only when nextAction is done.{resume}";

const RESUME =
  " This is session {attempt} for this task: the previous one ended before the task was done. " +
  "Call swarm_context to see where the task stands (your 'subtasks' show which steps are already done); do not redo work that is already committed or reported.";

export interface PromptVars {
  agent: string;
  taskId: string;
  title: string;
  attempt: number;
}

export function renderPrompt(template: string, v: PromptVars): string {
  const resume = v.attempt > 1 ? RESUME.replaceAll("{attempt}", String(v.attempt)) : "";
  return template
    .replaceAll("{resume}", resume)
    .replaceAll("{agent}", v.agent)
    .replaceAll("{taskId}", v.taskId)
    .replaceAll("{title}", v.title)
    .replaceAll("{attempt}", String(v.attempt));
}

/** `{prompt}` inside any argument is replaced; without a placeholder the prompt becomes the last argument. */
export function buildArgv(command: string[], prompt: string): string[] {
  return command.some((a) => a.includes("{prompt}")) ? command.map((a) => a.replaceAll("{prompt}", prompt)) : [...command, prompt];
}

const seq = (t: Task): number => Number(t.id.slice(t.id.lastIndexOf("-") + 1));
const isFinished = (t: Task): boolean => t.status === "COMPLETED" || t.status === "CANCELLED";

/** The same task the server treats as current: the oldest unfinished (ACTIVE or BLOCKED) task of the agent. */
export function pickTask(tasks: Task[], agent: string): Task | null {
  return [...tasks].sort((a, b) => seq(a) - seq(b)).find((t) => t.agents.includes(agent) && (t.status === "ACTIVE" || t.status === "BLOCKED")) ?? null;
}

export interface RunnerOptions {
  agent: string;
  networkDir: string;
  /** Agent CLI argv; `{prompt}` is replaced by the prompt (or the prompt is appended). */
  command: string[];
  cwd?: string;
  /** Placeholders: {agent} {taskId} {title} {attempt} {resume}. */
  promptTemplate?: string;
  /** Extra sessions for one task after the first before the runner gives up until the task changes. Default 3. */
  maxRestarts?: number;
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

/** Runs the agent session; on abort sends SIGTERM, then SIGKILL after 10 s. Resolves with the exit code. */
function runSession(argv: string[], env: NodeJS.ProcessEnv, cwd: string | undefined, stdio: "inherit" | "ignore", signal?: AbortSignal, output?: (text: string) => void): Promise<number> {
  return new Promise((done) => {
    const out = output ? "pipe" : stdio;
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ["ignore", out, out] });
    if (output) {
      child.stdout?.on("data", (b: Buffer) => output(b.toString("utf8")));
      child.stderr?.on("data", (b: Buffer) => output(b.toString("utf8")));
    }
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (): void => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    };
    signal?.addEventListener("abort", stop, { once: true });
    const finish = (code: number): void => {
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
      done(code);
    };
    child.on("error", () => finish(127)); // e.g. the CLI is not installed
    child.on("exit", (code, sig) => finish(code ?? (sig ? 128 : 1)));
  });
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

  const attempts = new Map<string, number>();
  /** taskId -> state signature when the runner gave up; retried as soon as the state changes. */
  const gaveUp = new Map<string, string>();
  let note = "";
  const say = (line: string): void => {
    if (line !== note) log(line);
    note = line;
  };
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
      say(`${task.id} is BLOCKED (${task.blockedReason ?? "fix-round limit"}); waiting for the operator`);
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

    const attempt = (attempts.get(task.id) ?? 0) + 1;
    attempts.set(task.id, attempt);
    const prompt = renderPrompt(opts.promptTemplate ?? DEFAULT_PROMPT, { agent, taskId: task.id, title: task.title, attempt });
    const env = { ...process.env, AGENT_ID: agent, NETWORK_DIR: networkDir, AGENT_NETWORK_TASK_ID: task.id, AGENT_NETWORK_ATTEMPT: String(attempt) };
    say(`${task.id}: starting session ${attempt} (phase ${task.phase})`);
    const finishedBefore = new Set((await tasks.listForAgent(agent)).filter(isFinished).map((t) => t.id));
    const code = await runSession(buildArgv(opts.command, prompt), env, opts.cwd, opts.stdio ?? "inherit", signal, opts.output);
    if (signal?.aborted) break;

    const after = await tasks.find(task.id);
    if (!after || isFinished(after)) {
      // a session may go on to the next task by itself (e.g. a follow-up): name everything it finished
      const also = (await tasks.listForAgent(agent)).filter((t) => isFinished(t) && t.id !== task.id && !finishedBefore.has(t.id)).map((t) => `${t.id} ${t.status}`);
      say(`${task.id}: ${after?.status ?? "gone"}${also.length ? `; in the same session also ${also.join(", ")}` : ""} (session exit ${code})`);
      attempts.delete(task.id);
      if (opts.once) return 0;
      continue;
    }
    if (after.status === "BLOCKED") continue; // handled at the top: wait for the operator
    if (attempt > maxRestarts) {
      gaveUp.set(task.id, await signature(after));
      say(`${task.id}: ${attempt} sessions ended before the task was done (last exit ${code}); giving up until the task changes`);
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
