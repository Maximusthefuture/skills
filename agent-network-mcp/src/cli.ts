import { parseArgs } from "node:util";
import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors.js";
import { runHookCli } from "./hook.js";
import { NetworkService } from "./service.js";
import { startUiServer } from "./ui/server.js";

const USAGE = `Usage:
  agent-network-mcp task create --title <t> --agents <a,b[,c]> [--description <d>] [--verify <build/test command>]
                                [--max-fix-rounds 3] [--no-commits] [--network-dir <abs path>]
  agent-network-mcp task list [--network-dir <abs path>]
  agent-network-mcp task cancel --id <task-001> [--reason <text>] [--network-dir <abs path>]
  agent-network-mcp task unblock --id <task-001> [--rounds 1] [--network-dir <abs path>]   more fix rounds for a BLOCKED task
  agent-network-mcp agent list [--network-dir <abs path>]
  agent-network-mcp ui [--port 4777] [--network-dir <abs path>]   read-only web viewer on http://127.0.0.1:<port>
  agent-network-mcp hook <post-tool|stop> [--network-dir <abs path>] [--agent <id>]   Claude Code hook: new messages / stay in the loop

NETWORK_DIR is used when --network-dir is not given. Tasks created here are picked up automatically by
the agents' swarm_context / wait. The first agent of --agents is the lead (proposes first, integrates at the end).
In a git repository agents must commit their work (--no-commits turns that off); --verify is the command the lead
runs on the merged result. After --max-fix-rounds failed reviews the task is BLOCKED until "task unblock" or "task cancel".`;

/** Operator commands run outside any LLM. Returns the process exit code, or -1 when a long-running server was started. */
export async function runCli(argv: string[], env: NodeJS.ProcessEnv, out: (s: string) => void): Promise<number> {
  const [group, command, ...rest] = argv;
  if (group === "ui") return runUi(command ? [command, ...rest] : rest, env, out);
  if (group === "hook") return runHookCli(command, rest, env, out);
  const known = (group === "task" && (command === "create" || command === "list" || command === "cancel" || command === "unblock")) || (group === "agent" && command === "list");
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
      "no-commits": { type: "boolean" },
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
    if (command === "list") {
      const tasks = await service.tasks.list();
      out(
        JSON.stringify(
          tasks.map((t) => ({ id: t.id, title: t.title, phase: t.phase, status: t.status, agents: t.agents, syncRound: t.syncRound, maxFixRounds: service.phases.maxFixRounds(t), ...(t.blockedReason ? { blockedReason: t.blockedReason } : {}) })),
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
      ...(values["no-commits"] ? { requireCommits: false } : {}),
    });
    out(JSON.stringify(task, null, 2));
    return 0;
  } catch (e) {
    out(`error: ${e instanceof AppError ? `${e.code}: ${e.message}` : (e as Error).message}`);
    return 1;
  }
}

async function runUi(args: string[], env: NodeJS.ProcessEnv, out: (s: string) => void): Promise<number> {
  const { values } = parseArgs({ args, options: { port: { type: "string" }, "network-dir": { type: "string" } } });
  const dir = values["network-dir"] ?? env.NETWORK_DIR;
  if (!dir || !isAbsolute(dir)) {
    out("error: an absolute --network-dir (or NETWORK_DIR) is required");
    return 2;
  }
  const port = values.port === undefined ? 4777 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    out("error: --port must be 0..65535");
    return 2;
  }
  try {
    const ui = await startUiServer(resolve(dir), { port });
    out(`Agent Network UI: ${ui.url}  (network: ${resolve(dir)})  Ctrl+C to stop`);
    return -1;
  } catch (e) {
    out(`error: ${(e as Error).message}`);
    return 1;
  }
}
