import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FileStore } from "./storage/fileStore.js";
import { TaskStore } from "./stores/taskStore.js";
import { spawnedAgent, type RunnerPool, type SpawnConfig } from "./ui/runners.js";
import { ensureWorktrees } from "./worktrees.js";

/** What leads may spawn, for the agents' MCP servers: <network>/spawn.json (removed when runners.json has no "spawn"). */
export async function writeSpawnFile(networkDir: string, spawn: SpawnConfig | undefined): Promise<void> {
  const fs = await FileStore.open(networkDir);
  if (!spawn?.templates.length) {
    await rm(join(networkDir, "spawn.json"), { force: true });
    return;
  }
  await fs.writeJson(["spawn.json"], {
    templates: spawn.templates.map((t) => ({ name: t.name, description: t.description, ...(t.config.model ? { model: t.config.model } : {}) })),
    maxPerTask: spawn.maxPerTask,
  });
}

/**
 * Appended to every role, whoever wrote it: a lead once told its job agent "do not call any swarm tools", which would have
 * left the job unable to hand its work in.
 */
export const SWARM_STILL =
  "Whatever the role says about tools: you work in the agent-network swarm. Start with swarm_context, follow its nextAction, and hand your work in with complete() — that is how it reaches the lead. Talk to the others only with send_message.";

/**
 * The page's side of spawn_agent: a runner for every agent a lead added to an open task (from the template it names,
 * in its own worktree when the template has one), stopped again once none of its tasks is open. Polls the tasks.
 */
export class Spawner {
  private timer?: NodeJS.Timeout;
  private running = false;
  private ticking?: Promise<void>;
  private readonly warned = new Set<string>();

  constructor(private readonly opts: { networkDir: string; spawn: SpawnConfig; pool: RunnerPool; log?: (line: string) => void; pollMs?: number }) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.ticking = this.tick().catch((e: Error) => this.opts.log?.(`[spawn] ${e.message}`));
      void this.ticking.finally(() => {
        if (this.running) this.timer = setTimeout(loop, this.opts.pollMs ?? 3000);
      });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.ticking;
  }

  /** One look. Public for tests. */
  async tick(): Promise<void> {
    const tasks = await new TaskStore(await FileStore.open(this.opts.networkDir)).list();
    const isOpen = (status: string) => status === "ACTIVE" || status === "BLOCKED";
    const busy = new Set(tasks.filter((t) => isOpen(t.status)).flatMap((t) => t.agents));
    const pool = this.opts.pool;
    for (const task of tasks) {
      for (const s of task.spawned ?? []) {
        const there = pool.ids().includes(s.id);
        if (isOpen(task.status) && !there) {
          const template = this.opts.spawn.templates.find((t) => t.name === s.template);
          if (!template) {
            if (!this.warned.has(s.id)) this.opts.log?.(`[spawn] ${task.id}: no template "${s.template}" in runners.json for ${s.id}; its runner cannot start`);
            this.warned.add(s.id);
            continue;
          }
          let config = spawnedAgent(template, s.id);
          // its role: the instructions the runner reads before every session, the template's own ones after them
          if (s.role) {
            const base = config.instructionsFile ? await readFile(config.instructionsFile, "utf8").catch(() => "") : "";
            const file = join(this.opts.networkDir, "roles", "tasks", `${task.id}-${s.id}.md`);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, `Your role in this task: ${s.role.name}${s.role.source === "library" ? " (from the project's role library)" : " (written by the lead)"}.\n\n${s.role.instructions}\n\n${SWARM_STILL}\n${base.trim() ? `\n---\nThe base instructions of your template (${s.template}); your role above comes first:\n\n${base.trim()}\n` : ""}`);
            config = { ...config, instructionsFile: file };
          }
          for (const line of await ensureWorktrees([config])) this.opts.log?.(`[spawn] worktree created: ${line}`);
          if (pool.add(config, { taskId: task.id, template: s.template })) this.opts.log?.(`[spawn] ${task.id}: ${s.by} added ${s.id} (${s.template}${s.role ? `, role ${s.role.name}` : ""}); its runner started`);
        } else if (!isOpen(task.status) && there && !busy.has(s.id)) {
          const view = pool.list().find((r) => r.id === s.id);
          if (view?.running && !view.session) {
            await pool.stop(s.id);
            this.opts.log?.(`[spawn] ${s.id}: its task ${task.id} is ${task.status}; runner stopped`);
          }
        }
      }
    }
  }
}
