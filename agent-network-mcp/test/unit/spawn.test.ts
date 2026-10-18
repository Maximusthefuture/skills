import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import type { RunnerOptions } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import { Spawner, writeSpawnFile } from "../../src/spawner.js";
import { loadRunnersConfig, RunnerPool, spawnedAgent } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });

/** A git project, runners.json with a "spawn" section, the network with spawn.json written as the page does. */
async function setup(spawn: Record<string, unknown> = {}) {
  const root = await tmpDir();
  const project = join(root, "shop");
  mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  writeFileSync(join(project, "a.txt"), "a");
  git(project, "add", ".");
  git(project, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const path = join(root, "runners.json");
  writeFileSync(path, JSON.stringify({
    defaults: { command: ["x", "{prompt}", "{model}"], model: "sonnet", worktree: true },
    agents: [{ id: "backend" }, { id: "reviewer" }],
    spawn: { templates: { backend: { description: "another developer" }, tester: { description: "cross-cutting tests", model: "haiku" } }, maxPerTask: 2, ...spawn },
  }));
  const config = await loadRunnersConfig(path, { projectDir: project });
  const networkDir = config.networkDir!;
  await writeSpawnFile(networkDir, config.spawn);
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const swarm = async (id: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }));
  return { project, path, config, networkDir, operator, swarm };
}

async function failure(swarm: Swarm, p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return swarm.errorBody(e);
  }
  throw new Error("expected the call to fail");
}

describe("spawn templates in runners.json", () => {
  it("are agents without an id: checked like agents; a spawned agent gets its own id and worktree", async () => {
    const { project, config } = await setup();
    expect(config.spawn!.maxPerTask).toBe(2);
    const tester = config.spawn!.templates.find((t) => t.name === "tester")!;
    expect(tester).toMatchObject({ description: "cross-cutting tests", config: { model: "haiku" } });
    expect(spawnedAgent(tester, "tester-2")).toMatchObject({ id: "tester-2", model: "haiku", cwd: `${project}-tester-2`, worktree: { project, branch: "swarm-tester-2" }, autostart: true });
  });

  it("refuses a bad section", async () => {
    await expect(setup({ maxPerTask: 0 })).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining('"maxPerTask"') });
    await expect(setup({ templates: { Bad_Name: { description: "x" } } })).rejects.toMatchObject({ message: expect.stringContaining("lowercase") });
    await expect(setup({ templates: { qa: {} } })).rejects.toMatchObject({ message: expect.stringContaining('needs "description"') });
  });
});

describe("spawn_agent", () => {
  it("the lead adds agents in DISCUSS before propose, up to the limit, with fresh ids", async () => {
    const { operator, swarm } = await setup();
    const task = await operator.createTaskAsOperator({ title: "Refunds", description: "two endpoint groups", agents: ["backend", "reviewer"], allowSpawn: true });
    const backend = await swarm("backend");
    const reviewer = await swarm("reviewer");
    await reviewer.context(); // registered: its id is taken

    const ctx = await backend.context();
    expect(ctx.spawnable).toEqual({ templates: [{ name: "backend", description: "another developer", model: "sonnet" }, { name: "tester", description: "cross-cutting tests", model: "haiku" }], roles: [], left: 2 });
    expect(ctx.allowedActions).toContain("spawn_agent");
    expect(String(ctx.hint)).toContain("spawn_agent({template, reason, role?})");
    expect((await reviewer.context()).spawnable).toBeUndefined(); // the lead only

    expect(await failure(reviewer, reviewer.spawnAgent({ template: "backend", reason: "r" }))).toMatchObject({ error: "FORBIDDEN" });
    expect(await failure(backend, backend.spawnAgent({ template: "qa", reason: "r" }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("backend, tester") });
    expect(await failure(backend, backend.spawnAgent({ template: "backend", reason: "" }))).toMatchObject({ message: expect.stringContaining("reason") });
    expect(await failure(backend, backend.spawnAgent({ template: "backend", id: "reviewer", reason: "r" }))).toMatchObject({ message: expect.stringContaining("taken") });

    const first = await backend.spawnAgent({ template: "backend", reason: "the /refunds group" });
    expect(first).toMatchObject({ action: "AGENT_SPAWNED", agentId: "backend-2" });
    await backend.spawnAgent({ template: "tester", id: "qa", reason: "e2e tests" });
    const after = await operator.tasks.get(task.id);
    expect(after.agents).toEqual(["backend", "reviewer", "backend-2", "qa"]);
    expect(after.spawned!.map((s) => [s.id, s.template, s.by])).toEqual([["backend-2", "backend", "backend"], ["qa", "tester", "backend"]]);
    expect(await failure(backend, backend.spawnAgent({ template: "backend", reason: "more" }))).toMatchObject({ message: expect.stringContaining("limit is 2") });
    expect((await backend.context()).spawnable).toBeUndefined();
    const events = (await operator.events.list(task.id)).map((e) => e.event).filter((e) => e.type === "AGENT_SPAWNED");
    expect(events.map((e) => (e.payload as { agentId: string }).agentId)).toEqual(["backend-2", "qa"]);

    // the agreement must cover the new agents too; after propose no more spawning
    await backend.propose({ summary: "s", assignments: after.agents.map((agentId) => ({ agentId, responsibility: "r", files: agentId === "reviewer" ? [] : [`src/${agentId}/**`] })) });
    expect(await failure(backend, backend.spawnAgent({ template: "backend", reason: "r" }))).toMatchObject({ error: "INVALID_PHASE", message: expect.stringContaining("before you propose") });
  });

  it("only when the operator allowed it for the task: otherwise the lead splits the work among its team", async () => {
    const { operator, swarm } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    const backend = await swarm("backend");
    const ctx = await backend.context();
    expect(ctx.spawnable).toBeUndefined();
    expect(ctx.allowedActions).not.toContain("spawn_agent");
    expect(String(ctx.hint)).not.toContain("spawn_agent");
    expect(await failure(backend, backend.spawnAgent({ template: "tester", reason: "a load test" }))).toMatchObject({ error: "FORBIDDEN", message: expect.stringContaining("split the work among backend, reviewer") });
    expect((await operator.tasks.get(task.id)).agents).toEqual(["backend", "reviewer"]);
  });

  it("without templates there is nothing to spawn", async () => {
    const { networkDir, operator, swarm } = await setup();
    await writeSpawnFile(networkDir, undefined);
    await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], allowSpawn: true });
    const backend = await swarm("backend");
    expect((await backend.context()).spawnable).toBeUndefined();
    expect(await failure(backend, backend.spawnAgent({ template: "backend", reason: "r" }))).toMatchObject({ message: expect.stringContaining('no "spawn" templates') });
  });
});

describe("the spawner", () => {
  it("starts a runner (in its own worktree) for an agent a lead added, and stops it when the task is done", async () => {
    const { project, config, networkDir, operator, swarm } = await setup();
    const started: RunnerOptions[] = [];
    const pool = new RunnerPool(networkDir, config.agents, {
      run: (o) => {
        started.push(o);
        return new Promise((done) => o.signal?.addEventListener("abort", () => done(0)));
      },
    });
    const lines: string[] = [];
    const spawner = new Spawner({ networkDir, spawn: config.spawn!, pool, log: (l) => lines.push(l) });
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], allowSpawn: true });
    await (await swarm("backend")).spawnAgent({ template: "tester", reason: "e2e" });

    await spawner.tick();
    expect(pool.ids()).toEqual(["backend", "reviewer", "tester-2"]);
    expect(started.map((o) => [o.agent, o.cwd])).toEqual([["tester-2", `${project}-tester-2`]]);
    expect(existsSync(join(`${project}-tester-2`, "a.txt"))).toBe(true);
    expect(pool.list().find((r) => r.id === "tester-2")).toMatchObject({ running: true, model: "haiku", spawned: { taskId: task.id, template: "tester" } });
    await spawner.tick(); // once
    expect(started).toHaveLength(1);

    await operator.cancelTask(task.id);
    await spawner.tick();
    expect(pool.list().find((r) => r.id === "tester-2")).toMatchObject({ running: false });
    expect(lines).toEqual([expect.stringContaining("worktree created: tester-2"), expect.stringContaining("added tester-2 (tester); its runner started"), expect.stringContaining("runner stopped")]);
    await pool.stopAll();
  });
});

describe("a role without a name", () => {
  it("instructions alone are a role all the same: named after the template, never a refusal", async () => {
    const { operator, swarm } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], allowSpawn: true });
    const backend = await swarm("backend");
    await backend.spawnAgent({ template: "backend", reason: "the second endpoint group", instructions: "You build /refunds only; you do not touch /orders. Report the endpoints and their status codes." });
    expect((await operator.tasks.get(task.id)).spawned![0]!.role).toMatchObject({ name: "backend-role", source: "lead" });
  });
});

describe("roles of spawned agents", () => {
  const architect = "Review the agreement and the code for module boundaries, coupling and layering; use the java-extensibility-review skill; change no file; report ERROR findings for real defects only.";

  it("the lead writes a role or takes one from the library; the operator keeps a good one; its runner reads it", async () => {
    const { networkDir, config, operator, swarm } = await setup();
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], allowSpawn: true });
    const backend = await swarm("backend");
    expect(await failure(backend, backend.spawnAgent({ template: "backend", reason: "r", role: "architect" }))).toMatchObject({ message: expect.stringContaining("No role \"architect\"") });
    expect(await failure(backend, backend.spawnAgent({ template: "backend", reason: "r", role: "architect", instructions: "short" }))).toMatchObject({ message: expect.stringContaining("40..6000") });
    await backend.spawnAgent({ template: "backend", reason: "boundaries of the new module", role: "architect", instructions: architect });
    expect((await operator.tasks.get(task.id)).spawned![0]!.role).toEqual({ name: "architect", instructions: architect, source: "lead" });

    // the runner's instructions: the role first, the template's own after it
    const pool = new RunnerPool(networkDir, config.agents, { run: (o) => new Promise((done) => o.signal?.addEventListener("abort", () => done(0))) });
    await new Spawner({ networkDir, spawn: config.spawn!, pool }).tick();
    const file = join(networkDir, "roles", "tasks", `${task.id}-backend-2.md`);
    expect(pool.list().find((r) => r.id === "backend-2")!.instructionsFile).toBe(file);
    expect(readFileSync(file, "utf8")).toMatch(/^Your role in this task: architect \(written by the lead\)\.\n\nReview the agreement/);
    // whatever the lead wrote, the agent still hands its work in through the swarm
    expect(readFileSync(file, "utf8")).toContain("hand your work in with complete()");
    await pool.stopAll();

    // kept in the library, then taken by name in the next task
    expect(await operator.saveRole({ taskId: task.id, agentId: "backend-2" })).toMatchObject({ name: "architect" });
    await expect(operator.saveRole({ taskId: task.id, agentId: "backend-2" })).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
    expect(readFileSync(join(networkDir, "roles", "architect.md"), "utf8")).toMatch(/^# architect: boundaries of the new module\n\nReview the agreement/);
    await operator.cancelTask(task.id);
    const next = await operator.createTaskAsOperator({ title: "t2", description: "d", agents: ["backend", "reviewer"], allowSpawn: true });
    const ctx = await backend.context();
    expect((ctx.spawnable as any).roles).toEqual([{ name: "architect", description: "architect: boundaries of the new module" }]);
    await backend.spawnAgent({ template: "backend", reason: "again", role: "architect" });
    expect((await operator.tasks.get(next.id)).spawned![0]!.role).toMatchObject({ name: "architect", source: "library" });
    await operator.deleteRole("architect");
    expect(await operator.roles()).toEqual([]);
  });
});

describe("roles without the tools they never use", () => {
  it("Claude Code: out of --tools and --allowedTools, --agents goes with Agent; Qwen: into --exclude-tools", async () => {
    const { withoutTools } = await import("../../src/ui/runners.js");
    const claude = ["claude", "-p", "{prompt}", "--tools", "Read,Edit,Bash,Skill,Agent", "--agents", "{\"helper\":{}}", "--allowedTools", "mcp__agent-network", "Agent", "Read", "Skill", "--model", "{model}"];
    expect(withoutTools(claude, ["Agent", "Skill"])).toEqual(["claude", "-p", "{prompt}", "--tools", "Read,Edit,Bash", "--allowedTools", "mcp__agent-network", "Read", "--model", "{model}"]);
    expect(withoutTools(claude, [])).toBe(claude);
    const qwen = ["qwen", "{prompt}", "--exclude-tools", "web_fetch", "web_search", "-m", "{model}"];
    expect(withoutTools(qwen, ["Agent", "Skill"])).toEqual(["qwen", "{prompt}", "--exclude-tools", "web_fetch", "web_search", "agent", "skill", "-m", "{model}"]);
  });
});
