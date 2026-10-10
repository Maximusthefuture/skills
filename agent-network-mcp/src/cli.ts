import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors.js";
import { runHookCli } from "./hook.js";
import { runRunner } from "./runner.js";
import { collectStats } from "./stats.js";
import { FileStore } from "./storage/fileStore.js";
import { NetworkService } from "./service.js";
import { loadRunnersConfig, RunnerPool, type RunnersConfig } from "./ui/runners.js";
import { startUiServer } from "./ui/server.js";

const USAGE = `Usage:
  agent-network-mcp task create --title <t> --agents <a,b[,c]> [--description <d>] [--verify <build/test command>]
                                [--max-fix-rounds 3] [--follow-ups 0] [--network-dir <abs path>]
  agent-network-mcp task list [--network-dir <abs path>]
  agent-network-mcp task stats [--id <task-001>] [--network-dir <abs path>]   time per phase, sessions, tokens, cost
  agent-network-mcp task cancel --id <task-001> [--reason <text>] [--network-dir <abs path>]
  agent-network-mcp task unblock --id <task-001> [--rounds 1] [--network-dir <abs path>]   more fix rounds for a BLOCKED task
  agent-network-mcp agent list [--network-dir <abs path>]
  agent-network-mcp ui [--port 4777] [--network-dir <abs path>] [--runners runners.json]
                        web page on http://127.0.0.1:<port>; read-only, or with --runners: a task form and the
                        agents' runners (start/stop, log tail), started together with the page
  agent-network-mcp hook <post-tool|stop> [--network-dir <abs path>] [--agent <id>]   Claude Code hook: new messages / stay in the loop
  agent-network-mcp run --agent <id> [--network-dir <abs path>] [--cwd <dir>] [--prompt-file <path>] [--instructions-file <path>] [--system-prompt-file <path>] [--max-restarts 3]
                        [--restart-delay-ms 5000] [--poll-ms 2000] [--once] -- <agent CLI> [args, "{prompt}"]
                        keeps one agent working: starts a session per task, restarts it until DONE, then waits again

NETWORK_DIR is used when --network-dir is not given. Tasks created here are picked up automatically by
the agents' swarm_context / wait. The first agent of --agents is the lead (proposes first, integrates at the end).
Commits are optional (agents may report them; nothing checks them); --verify is the command the lead runs on the
merged result. After --max-fix-rounds failed reviews the task is BLOCKED until "task unblock" or "task cancel".
--follow-ups N lets the leads of this task and of the tasks it spawns create up to N follow-up tasks in total when they
integrate with PASS (work that is left); the agents pick them up after the task is DONE. Default 0: no follow-ups.`;

/** Operator commands run outside any LLM. Returns the process exit code, or -1 when a long-running server was started. */
export async function runCli(argv: string[], env: NodeJS.ProcessEnv, out: (s: string) => void): Promise<number> {
  const [group, command, ...rest] = argv;
  if (group === "ui") return runUi(command ? [command, ...rest] : rest, env, out);
  if (group === "hook") return runHookCli(command, rest, env, out);
  if (group === "run") return runAgentRunner(command === undefined ? rest : [command, ...rest], env, out);
  const known = (group === "task" && (command === "create" || command === "list" || command === "stats" || command === "cancel" || command === "unblock")) || (group === "agent" && command === "list");
  if (!known) {
    out(USAGE);
    return group === "help" || group === "--help" ? 0 : 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      title: { type: "string" },
      description: { type: "string" },
      agents: { type: "string" },
      id: { type: "string" },
      reason: { type: "string" },
      verify: { type: "string" },
      "max-fix-rounds": { type: "string" },
      "no-commits": { type: "boolean" }, // obsolete: commits are never required; accepted so old scripts keep working
      "follow-ups": { type: "string" },
      rounds: { type: "string" },
      "network-dir": { type: "string" },
    },
  });
  const dir = values["network-dir"] ?? env.NETWORK_DIR;
  if (!dir || !isAbsolute(dir)) {
    out("error: an absolute --network-dir (or NETWORK_DIR) is required");
    return 2;
  }
  try {
    const service = await NetworkService.create(resolve(dir), { id: "operator", type: "cli" });
    if (group === "agent") {
      const agents = await service.agents.list();
      out(JSON.stringify(agents.map((a) => ({ id: a.id, type: a.type, role: a.role ?? null, status: a.status, lastSeenAt: a.lastSeenAt, pid: a.pid ?? null })), null, 2));
      return 0;
    }
    if (command === "cancel" || command === "unblock") {
      if (!values.id) {
        out("error: --id is required");
        return 2;
      }
      const task = command === "cancel" ? await service.cancelTask(values.id, values.reason) : await service.unblockTask(values.id, values.rounds === undefined ? 1 : Number(values.rounds));
      out(JSON.stringify(task, null, 2));
      return 0;
    }
    if (command === "stats") {
      const tasks = (await service.tasks.list()).filter((t) => !values.id || t.id === values.id);
      if (values.id && !tasks.length) {
        out(`error: no task ${values.id}`);
        return 1;
      }
      const stats = await collectStats(await FileStore.open(resolve(dir)), tasks);
      out(JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, phase: t.phase, stats: stats.get(t.id) ?? null })), null, 2));
      return 0;
    }
    if (command === "list") {
      const tasks = await service.tasks.list();
      out(
        JSON.stringify(
          tasks.map((t) => ({
            id: t.id, title: t.title, phase: t.phase, status: t.status, agents: t.agents, syncRound: t.syncRound, maxFixRounds: service.phases.maxFixRounds(t),
            ...(t.blockedReason ? { blockedReason: t.blockedReason } : {}),
            ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}),
            ...(t.maxFollowUps ? { followUps: `${t.followUpsUsed ?? 0}/${t.maxFollowUps} used` } : {}),
          })),
          null,
          2,
        ),
      );
      return 0;
    }
    if (!values.title || !values.agents) {
      out("error: --title and --agents are required");
      return 2;
    }
    const task = await service.createTaskAsOperator({
      title: values.title,
      description: values.description ?? values.title,
      agents: values.agents.split(",").map((a) => a.trim()).filter(Boolean),
      ...(values["max-fix-rounds"] !== undefined ? { maxFixRounds: Number(values["max-fix-rounds"]) } : {}),
      ...(values.verify ? { verifyCommand: values.verify } : {}),
      ...(values["follow-ups"] !== undefined ? { maxFollowUps: Number(values["follow-ups"]) } : {}),
    });
    out(JSON.stringify(task, null, 2));
    return 0;
  } catch (e) {
    out(`error: ${e instanceof AppError ? `${e.code}: ${e.message}` : (e as Error).message}`);
    return 1;
  }
}

async function runUi(args: string[], env: NodeJS.ProcessEnv, out: (s: string) => void): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, "network-dir": { type: "string" }, runners: { type: "string" } } });
  let config: RunnersConfig | undefined;
  try {
    if (values.runners) config = await loadRunnersConfig(values.runners);
  } catch (e) {
    out(`error: ${(e as Error).message}`);
    return 2;
  }
  const dir = values["network-dir"] ?? env.NETWORK_DIR ?? config?.networkDir;
  if (!dir || !isAbsolute(dir)) {
    out("error: an absolute --network-dir (or NETWORK_DIR, or \"networkDir\" in the runners config) is required");
    return 2;
  }
  const port = values.port === undefined ? 4777 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    out("error: --port must be 0..65535");
    return 2;
  }
  try {
    const runners = config ? new RunnerPool(resolve(dir), config.agents, config.path ? { configPath: config.path } : {}) : undefined;
    const ui = await startUiServer(resolve(dir), { port, ...(runners ? { runners } : {}) });
    out(`Agent Network UI: ${ui.url}  (network: ${resolve(dir)})  Ctrl+C to stop`);
    if (runners && config) {
      const auto = config.agents.filter((a) => a.autostart !== false).map((a) => a.id);
      for (const id of auto) runners.start(id);
      out(`runners: ${config.agents.map((a) => a.id).join(", ")}${auto.length ? `; started: ${auto.join(", ")}` : "; none started (autostart: false)"}`);
      let stopping = false;
      const shutdown = (): void => {
        if (stopping) process.exit(130); // second Ctrl+C: leave now
        stopping = true;
        out("stopping the runners...");
        void runners.stopAll().then(() => ui.close()).then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    }
    return -1;
  } catch (e) {
    out(`error: ${(e as Error).message}`);
    return 1;
  }
}

function positiveInt(value: string | undefined, name: string, fallback: number, min = 0): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new AppError("INVALID_INPUT", `--${name} must be an integer >= ${min}`);
  return n;
}

async function runAgentRunner(args: string[], env: NodeJS.ProcessEnv, out: (s: string) => void): Promise<number> {
  const split = args.indexOf("--");
  const command = split < 0 ? [] : args.slice(split + 1);
  if (!command.length) {
    out("error: give the agent command after --, e.g. run --agent backend -- claude -p \"{prompt}\"");
    return 2;
  }
  const { values } = parseArgs({
    args: args.slice(0, split),
    options: {
      agent: { type: "string" },
      "network-dir": { type: "string" },
      cwd: { type: "string" },
      "prompt-file": { type: "string" },
      "instructions-file": { type: "string" },
      "system-prompt-file": { type: "string" },
      "max-restarts": { type: "string" },
      "restart-delay-ms": { type: "string" },
      "poll-ms": { type: "string" },
      once: { type: "boolean" },
    },
  });
  const dir = values["network-dir"] ?? env.NETWORK_DIR;
  if (!values.agent || !dir || !isAbsolute(dir)) {
    out("error: --agent and an absolute --network-dir (or NETWORK_DIR) are required");
    return 2;
  }
  try {
    // both files are read again before every session, so edits apply to the next one; a wrong path fails right away
    if (values["prompt-file"]) await readFile(values["prompt-file"], "utf8");
    if (values["instructions-file"]) await readFile(values["instructions-file"], "utf8");
    if (values["system-prompt-file"]) await readFile(values["system-prompt-file"], "utf8");
    const controller = new AbortController();
    let interrupts = 0;
    const onSignal = (): void => {
      if (++interrupts > 1) process.exit(130);
      controller.abort();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      return await runRunner({
        agent: values.agent,
        networkDir: resolve(dir),
        command,
        ...(values.cwd ? { cwd: resolve(values.cwd) } : {}),
        ...(values["prompt-file"] ? { promptFile: resolve(values["prompt-file"]) } : {}),
        ...(values["instructions-file"] ? { instructionsFile: resolve(values["instructions-file"]) } : {}),
        ...(values["system-prompt-file"] ? { systemPromptFile: resolve(values["system-prompt-file"]) } : {}),
        maxRestarts: positiveInt(values["max-restarts"], "max-restarts", 3),
        restartDelayMs: positiveInt(values["restart-delay-ms"], "restart-delay-ms", 5000),
        pollMs: positiveInt(values["poll-ms"], "poll-ms", 2000, 10),
        once: values.once ?? false,
        signal: controller.signal,
      });
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  } catch (e) {
    out(`error: ${(e as Error).message}`);
    return 1;
  }
}
