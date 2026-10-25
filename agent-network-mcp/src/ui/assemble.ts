import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { costGuard } from "../costLimit.js";
import { AppError } from "../errors.js";
import { Observer } from "../observer/observer.js";
import { PlanCritic } from "../planCritic.js";
import { Scheduler } from "../schedule/scheduler.js";
import { NetworkService } from "../service.js";
import { Spawner, writeSpawnFile } from "../spawner.js";
import { Supervisor } from "../supervisor/supervisor.js";
import { ensureWorktrees, gitRoot } from "../worktrees.js";
import { installedTemplates, loadRunnersConfig, projectConfigFile, projectRunnersConfig, RunnerPool, watchPrices, type RunnersConfig, type TemplateName } from "./runners.js";
import type { UiProject } from "./server.js";

/**
 * One project of the page with all it runs: its runners, supervisor, schedules, observer, plan critic and spawner.
 * `start` begins them once the page is up (the supervisor acts through it), `stop` ends them («Закрыть», Ctrl+C).
 * Built the same way at the start of `ui` and when the page opens a project from the list.
 */
export function assembleProject(networkDir: string, config: RunnersConfig | undefined, out: (line: string) => void): UiProject {
  const dir = resolve(networkDir);
  let operator: Promise<NetworkService> | undefined;
  const prices = config?.path ? watchPrices(config.path) : undefined;
  // after every agent session: a task over its cost limit (maxCostUsd) is BLOCKED for the operator
  const onSessionEnd = config ? costGuard({ networkDir: dir, ...(prices ? { prices } : {}), log: (line) => out(line) }) : undefined;
  // a runner that gave up blocks its task: the others would wait for it forever
  const onGiveUp = async (agentId: string, taskId: string, reason: string) => {
    operator ??= NetworkService.create(dir, { id: "operator", type: "ui" });
    const blocked = await (await operator).blockForRunner(taskId, agentId, reason);
    if (blocked) out(`[runner] ${taskId}: BLOCKED, ${agentId}'s runner gave up (${reason})`);
  };
  const runners = config ? new RunnerPool(dir, config.agents, { ...(config.path ? { configPath: config.path } : {}), ...(onSessionEnd ? { onSessionEnd } : {}), onGiveUp }) : undefined;
  // the supervisor watches this project's runners; it acts through the page, so it is attached once the page is up
  const supervisor =
    runners && config?.supervisor
      ? new Supervisor({ networkDir: dir, config: config.supervisor, pool: runners, ...(config.path ? { configPath: config.path } : {}), ...(config.project ? { projectDir: config.project } : {}), ...(prices ? { prices } : {}) })
      : undefined;
  // always with runners: schedules can be added on the page, and they apply without a restart
  const scheduler =
    runners && config
      ? new Scheduler({ networkDir: dir, schedules: config.schedules ?? [], ...(config.path ? { configPath: config.path } : {}), ...(config.project ? { projectDir: config.project } : {}), ...(config.maxTaskCostUsd !== undefined ? { maxTaskCostUsd: config.maxTaskCostUsd } : {}), ...(config.verifyCommand ? { verifyCommand: config.verifyCommand } : {}), log: (line) => out(line) })
      : undefined;
  // looks back over closed tasks; its calls show in the activity feed like the supervisor's
  const observer =
    runners && config?.observer
      ? new Observer({ networkDir: dir, config: config.observer, ...(prices ? { prices } : {}), log: (line) => out(line), onActivity: (e) => runners.recordActivity("observer", e) })
      : undefined;
  // reads each version of a plan the lead writes, for what breaks in production
  const planCritic =
    runners && config?.planCritic
      ? new PlanCritic({ networkDir: dir, projectDir: config.project ?? dirname(dir), config: config.planCritic, folderOf: (id) => runners.agentFolder(id)?.cwd, ...(prices ? { prices } : {}), log: (line) => out(line), onActivity: (e) => runners.recordActivity("plan-critic", e) })
      : undefined;
  let spawner: Spawner | undefined;
  const name = basename(dirname(dir));

  const start = async (url: string, projectId: string, many: boolean): Promise<void> => {
    if (!runners || !config) return;
    const where = many ? ` (${name})` : "";
    // the templates leads may spawn from, for their MCP servers; and the loop that starts the spawned runners
    await writeSpawnFile(dir, config.spawn);
    if (config.spawn) {
      spawner = new Spawner({ networkDir: dir, spawn: config.spawn, pool: runners, log: (line) => out(line) });
      spawner.start();
    }
    const auto = config.agents.filter((a) => a.autostart !== false).map((a) => a.id);
    for (const id of auto) runners.start(id);
    out(`runners${where}: ${config.agents.map((a) => a.id).join(", ")}${auto.length ? `; started: ${auto.join(", ")}` : "; none started (autostart: false)"}`);
    if (observer) {
      observer.start();
      out(`observer${where}: ${config.observer!.cron ? `runs on ${config.observer!.cron}` : "runs from the button on its tab"}; digests of closed tasks are collected as they close`);
    }
    if (planCritic) {
      planCritic.start();
      out(`plan critic${where}: reads every plan version a lead writes for a task with a plan to approve`);
    }
    if (config.spawn) out(`spawn${where}: leads may add ${config.spawn.templates.map((t) => t.name).join(", ")} (up to ${config.spawn.maxPerTask} per task)`);
    if (scheduler) {
      scheduler.start();
      const list = config.schedules ?? [];
      out(`schedules${where}: ${list.length ? list.map((s) => `${s.id} (${s.cron}${s.enabled ? "" : ", off"})`).join(", ") : "none yet (add them on the Tasks tab)"}`);
    }
    if (supervisor) {
      supervisor.attach(url, projectId);
      if (config.supervisor!.autostart) supervisor.start();
      out(`supervisor${where}: ${config.supervisor!.command[0]}${config.supervisor!.model ? ` (${config.supervisor!.model})` : ""}; ${config.supervisor!.autostart ? "watching" : "off (autostart: false), switch it on on the page"}`);
    }
  };
  const stop = async (): Promise<void> => {
    await Promise.all([spawner?.stop(), observer?.stop(), planCritic?.stop(), runners?.stopAll(), supervisor?.stop(), scheduler?.stop()]);
    (await operator)?.close();
  };

  return {
    networkDir: dir, ...(runners ? { runners } : {}), ...(prices ? { prices } : {}), ...(supervisor ? { supervisor } : {}), ...(scheduler ? { scheduler } : {}), ...(observer ? { observer } : {}), ...(planCritic ? { planCritic } : {}),
    ...(config?.maxTaskCostUsd !== undefined ? { maxTaskCostUsd: config.maxTaskCostUsd } : {}),
    ...(config?.verifyCommand ? { verifyCommand: config.verifyCommand } : {}),
    ...(config?.mergeStrategy ? { mergeStrategy: config.mergeStrategy } : {}),
    ...(config?.mergeCheck?.setup ? { mergeSetup: config.mergeCheck.setup } : {}),
    ...(config?.notify ? { notify: config.notify } : {}),
    ...(runners && config?.drafter ? { drafter: config.drafter } : {}),
    ...(config?.path ? { configPath: config.path } : {}),
    start, stop,
  };
}

/**
 * «Открыть» on the page: a project from the list, as `ui` started in its folder would load it — its own config
 * (created from the template of the agent CLI on PATH the first time, or the config the list remembers), its agents'
 * worktrees, then everything it runs.
 */
export async function openProjectAt(dir: string, opts: { config?: string; template?: TemplateName; env?: NodeJS.ProcessEnv }, out: (line: string) => void): Promise<UiProject> {
  const root = await gitRoot(dir);
  if (!root) throw new AppError("INVALID_INPUT", `${dir} is not in a git repository: a project is a git repository`);
  let file = opts.config;
  if (!file) {
    const installed = await installedTemplates(opts.env);
    const template = opts.template ?? (existsSync(projectConfigFile(root)) ? "qwen" : installed[0] ?? "qwen");
    const own = await projectRunnersConfig(root, template);
    out(own.created ? `config: ${own.path} (new, from the ${template} template)` : `config: ${own.path}`);
    file = own.path;
  }
  const config = await loadRunnersConfig(file, { projectDir: root });
  for (const line of await ensureWorktrees(config.agents)) out(`worktree created: ${line}`);
  return assembleProject(config.networkDir ?? join(root, ".agent-network"), config, out);
}
