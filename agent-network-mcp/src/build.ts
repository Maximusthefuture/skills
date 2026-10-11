import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { summarizeBuild, type TestTotals } from "./buildSummary.js";
import { AppError } from "./errors.js";

/** Commands the build tool runs: a build tool first, never a shell. AGENT_NETWORK_BUILD_TOOLS adds more (comma-separated). */
export const BUILD_TOOLS = ["./mvnw", "mvn", "./gradlew", "gradle", "npm", "npx", "yarn", "pnpm", "make"] as const;
export const DEFAULT_BUILD_TIMEOUT_MIN = 20;
const KEEP_LOGS = 5;
/** Where the full logs go, inside the agent's folder (.agent-network/ is kept out of git). */
export const BUILD_LOG_DIR = join(".agent-network", "builds");

export function buildTools(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.AGENT_NETWORK_BUILD_TOOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([...BUILD_TOOLS, ...extra])];
}

// globs (*, ?) pass as they are: -Dtest=Order*Test means the pattern, not files
const SHELL = /[|&;<>`$()]/;

/**
 * Splits a build command into argv the way a shell would for simple commands (quotes, no expansion). A trailing output
 * filter ("2>&1 | tail -60", "| grep …") is dropped: the tool shortens the output itself. Anything else that needs a shell
 * (&&, ;, redirects, $VAR, subshells) is refused, so the tool never runs more than the build the agent's shell rules allow.
 */
export function parseBuildCommand(command: string, tools: readonly string[]): { argv: string[]; dropped?: string } {
  let cmd = command.trim();
  let dropped: string | undefined;
  const pipe = /\s*(?:2>&1\s*)?\|\s*(tail|head|grep|less|cat)\b[^|]*$/.exec(cmd);
  if (pipe) {
    dropped = cmd.slice(pipe.index).trim();
    cmd = cmd.slice(0, pipe.index);
  }
  cmd = cmd.replace(/\s+2>&1\s*$/, "");
  const argv: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) argv.push(cur);
      cur = "";
      has = false;
    } else {
      if (SHELL.test(ch)) {
        throw new AppError("INVALID_INPUT", `build runs one plain command without a shell; "${ch}" in "${command}" needs one. Run each command separately (no &&, ;, pipes, redirects or $VARS), e.g. build({command: "./mvnw -q test -Dtest=OrderServiceTest"}).`);
      }
      cur += ch;
    }
  }
  if (quote) throw new AppError("INVALID_INPUT", `Unclosed ${quote} in "${command}"`);
  if (has || cur) argv.push(cur);
  if (!argv.length) throw new AppError("INVALID_INPUT", "build needs a command, e.g. './mvnw -q verify'");
  const first = argv[0]!;
  const allowed = tools.includes(first) || /(^|\/)(mvnw|gradlew)$/.test(first);
  if (!allowed) {
    throw new AppError("INVALID_INPUT", `build runs build tools only (${tools.join(", ")}); "${first}" is not one. Use your shell for other commands.`);
  }
  return { argv, ...(dropped ? { dropped } : {}) };
}

export interface BuildRun {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Relative to the working folder. */
  logPath: string;
  /** The short answer for the agent. */
  summary: string;
  tests?: TestTotals;
}

/** Build processes still running: killed with their children when this process exits (a stopped session leaves no JVM behind). */
const running = new Set<ChildProcess>();
let exitHook = false;

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function nextLog(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const logs = (await readdir(dir)).filter((f) => /^build-\d+\.log$/.test(f)).sort();
  for (const old of logs.slice(0, Math.max(0, logs.length - (KEEP_LOGS - 1)))) await rm(join(dir, old), { force: true });
  const last = logs.length ? Number(/\d+/.exec(logs.at(-1)!)![0]) : 0;
  return join(dir, `build-${String(last + 1).padStart(3, "0")}.log`);
}

/** Runs one build command in `cwd` with the whole output going to a log file; answers with a short summary. */
export async function runBuild(opts: { cwd: string; argv: string[]; timeoutMs: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv }): Promise<BuildRun> {
  if (!existsSync(opts.cwd)) throw new AppError("INVALID_INPUT", `Working folder ${opts.cwd} does not exist`);
  const logFile = await nextLog(join(opts.cwd, BUILD_LOG_DIR));
  const log = createWriteStream(logFile);
  log.write(`$ ${opts.argv.join(" ")}\n`);
  const started = Date.now();
  if (!exitHook) {
    exitHook = true;
    process.on("exit", () => running.forEach((c) => killGroup(c, "SIGKILL")));
  }
  let timedOut = false;
  const { exitCode } = await new Promise<{ exitCode: number | null }>((resolve) => {
    const child = spawn(opts.argv[0]!, opts.argv.slice(1), { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    running.add(child);
    child.stdout!.pipe(log, { end: false });
    child.stderr!.pipe(log, { end: false });
    let hard: NodeJS.Timeout | undefined;
    const stop = () => {
      killGroup(child, "SIGTERM");
      hard = setTimeout(() => killGroup(child, "SIGKILL"), 5000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    const onAbort = () => stop();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      log.write(`\n${e.message}\n`);
      finish(127);
    });
    child.on("close", (code, sig) => finish(code ?? (sig ? 128 : null)));
    let done = false;
    function finish(code: number | null) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hard);
      opts.signal?.removeEventListener("abort", onAbort);
      running.delete(child);
      resolve({ exitCode: code });
    }
  });
  await new Promise<void>((r) => log.end(r));
  const durationMs = Date.now() - started;
  const output = await readFile(logFile, "utf8");
  const logPath = relative(opts.cwd, logFile);
  const s = summarizeBuild(output.slice(output.indexOf("\n") + 1), exitCode, durationMs, { logPath, timedOut });
  return { ok: s.ok, exitCode, timedOut, durationMs, logPath, summary: s.text, ...(s.tests ? { tests: s.tests } : {}) };
}
