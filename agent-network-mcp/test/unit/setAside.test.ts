import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pickTask } from "../../src/pick.js";
import { NetworkService } from "../../src/service.js";
import type { Task } from "../../src/types.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { ensureWorktrees, switchTaskBranch } from "../../src/worktrees.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });

beforeAll(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
});

async function setup() {
  const networkDir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const block = async (id: string) => operator.tasks.save({ ...(await operator.tasks.get(id)), status: "BLOCKED", blockedReason: "fix rounds are used up" });
  return { networkDir, operator, block };
}

describe("a BLOCKED task put aside", () => {
  it("lets its agents take their next task, and come back once that one is closed", async () => {
    const { operator, block } = await setup();
    const s = await operator.createTaskAsOperator({ title: "Refunds", description: "refunds of paid orders", agents: ["backend", "reviewer"] });
    const n = await operator.createTaskAsOperator({ title: "Search", description: "search orders by customer", agents: ["backend", "tester"] });
    await expect(operator.setAsideTask({ taskId: s.id, reason: "different code", by: "operator" })).rejects.toMatchObject({ code: "INVALID_PHASE" });
    await block(s.id);
    await expect(operator.setAsideTask({ taskId: s.id, reason: " ", by: "operator" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(operator.setAsideTask({ taskId: s.id, reason: "x", by: "operator", sharedFolder: ["backend"] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("project folder") });

    const saved = await operator.setAsideTask({ taskId: s.id, reason: "search does not touch refunds", by: "supervisor", branches: { backend: "swarm-backend--" + s.id, reviewer: "swarm-reviewer--" + s.id } });
    // reviewer has nothing else: it stays with the blocked task, and its branch stays too
    expect(saved).toMatchObject({ setAside: { by: "supervisor", reason: "search does not touch refunds", next: { backend: n.id } }, branches: { backend: "swarm-backend--" + s.id } });
    expect(saved.branches).not.toHaveProperty("reviewer");
    await expect(operator.setAsideTask({ taskId: s.id, reason: "again", by: "operator" })).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });

    const tasks = await operator.tasks.list();
    expect(pickTask(tasks, "backend")?.id).toBe(n.id);
    expect(pickTask(tasks, "reviewer")?.id).toBe(s.id);
    // unblocked meanwhile: still no preemption, the taken task goes on
    await operator.tasks.save({ ...(await operator.tasks.get(s.id)), status: "ACTIVE" });
    expect(pickTask(await operator.tasks.list(), "backend")?.id).toBe(n.id);
    await operator.cancelTask(n.id, "done elsewhere");
    expect(pickTask(await operator.tasks.list(), "backend")?.id).toBe(s.id);
  });

  it("is refused when the next task builds on it", async () => {
    const { operator, block } = await setup();
    const s = await operator.createTaskAsOperator({ title: "Refunds", description: "refunds of paid orders", agents: ["backend", "reviewer"] });
    await block(s.id);
    await expect(operator.setAsideTask({ taskId: s.id, reason: "x", by: "operator" })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("nothing to take") });
    const named = await operator.createTaskAsOperator({ title: "Refund report", description: `a report of the refunds of ${s.id}`, agents: ["backend", "reviewer"] });
    await expect(operator.setAsideTask({ taskId: s.id, reason: "x", by: "operator" })).rejects.toMatchObject({ code: "DEPENDS_ON_BLOCKED", message: expect.stringContaining(`names ${s.id}`) });
    await operator.cancelTask(named.id);
    await operator.createTaskAsOperator({ title: "More refunds", description: "partial refunds on top", agents: ["backend", "reviewer"], parentTaskId: s.id });
    await expect(operator.setAsideTask({ taskId: s.id, reason: "x", by: "operator" })).rejects.toMatchObject({ code: "DEPENDS_ON_BLOCKED", message: expect.stringContaining("follow-up") });
  });
});

describe("the branches of a task put aside", () => {
  it("park its work, give a fresh branch for the next task, and bring it back after", async () => {
    const root = await tmpDir();
    const project = join(root, "shop");
    mkdirSync(project);
    git(project, "init", "-q", "-b", "main");
    writeFileSync(join(project, "a.txt"), "a");
    git(project, "add", "a.txt");
    git(project, "commit", "-qm", "a");
    const cwd = `${project}-backend`;
    await ensureWorktrees([{ id: "backend", cwd, worktree: { project, branch: "swarm-backend" } }]);
    writeFileSync(join(cwd, "refunds.txt"), "committed");
    git(cwd, "add", "refunds.txt");
    git(cwd, "commit", "-qm", "refunds");
    writeFileSync(join(cwd, "refunds.txt"), "half done"); // uncommitted when it got blocked

    const s = { id: "task-001", agents: ["backend"], status: "BLOCKED", setAside: { next: { backend: "task-002" } } };
    const n = { id: "task-002", agents: ["backend"], status: "ACTIVE" };
    expect(await switchTaskBranch(cwd, project, "swarm-backend", "backend", n, [s, n])).toContain("parked");
    expect(git(cwd, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("swarm-backend");
    expect(git(cwd, "ls-files").split("\n")).not.toContain("refunds.txt");
    expect(git(cwd, "show", "swarm-backend--task-001:refunds.txt")).toBe("half done");
    // the next session of the same task: nothing to do
    expect(await switchTaskBranch(cwd, project, "swarm-backend", "backend", n, [s, n])).toBeNull();

    writeFileSync(join(cwd, "search.txt"), "search");
    git(cwd, "add", "search.txt");
    git(cwd, "commit", "-qm", "search");
    const closed = { ...n, status: "COMPLETED" };
    expect(await switchTaskBranch(cwd, project, "swarm-backend", "backend", s, [s, closed])).toContain("back to the task put aside");
    expect(readFileSync(join(cwd, "refunds.txt"), "utf8")).toBe("half done");
    expect(git(cwd, "ls-files").split("\n")).not.toContain("search.txt");
    expect(git(cwd, "show", "swarm-backend--task-002:search.txt")).toBe("search");
    expect(git(cwd, "branch", "--list", "swarm-backend--task-001").trim()).toBe("");
    expect(await switchTaskBranch(cwd, project, "swarm-backend", "backend", s, [s, closed])).toBeNull();
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("«Отложить и взять следующую» on the page", () => {
  it("parks the branches of the agents in worktrees and refuses a task that depends on it", async () => {
    const root = await tmpDir();
    const project = join(root, "shop");
    mkdirSync(project);
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, [
      { id: "backend", command: ["x"], cwd: `${project}-backend`, worktree: { project, branch: "swarm-backend" }, autostart: false },
      { id: "reviewer", command: ["x"], cwd: `${project}-reviewer`, worktree: { project, branch: "swarm-reviewer" }, autostart: false },
    ]);
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const s = await operator.createTaskAsOperator({ title: "Refunds", description: "refunds of paid orders", agents: ["backend", "reviewer"] });
    await operator.tasks.save({ ...(await operator.tasks.get(s.id)), status: "BLOCKED" } as Task);
    const dep = await operator.createTaskAsOperator({ title: "Report", description: `a report of ${s.id}`, agents: ["backend", "reviewer"] });
    expect(await post(`/api/tasks/${s.id}/set-aside`, { reason: "x" })).toMatchObject({ status: 400, body: { error: "DEPENDS_ON_BLOCKED" } });
    await operator.cancelTask(dep.id);
    const n = await operator.createTaskAsOperator({ title: "Search", description: "search orders", agents: ["backend", "reviewer"] });
    const r = await post(`/api/tasks/${s.id}/set-aside`, { reason: "search is other code" });
    expect(r).toMatchObject({ status: 200, body: { task: { setAside: { by: "operator", next: { backend: n.id, reviewer: n.id } }, branches: { backend: `swarm-backend--${s.id}`, reviewer: `swarm-reviewer--${s.id}` } } } });
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.tasks.find((t: any) => t.id === s.id).setAside).toMatchObject({ reason: "search is other code" });
  });
});
