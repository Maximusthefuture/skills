import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RunnerOptions } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { filesChangedSince } from "../../src/git.js";
import { branchDiff, catchUpBranch, ensureWorktrees, fileDiff, mergeBranch, mergeProjectInto, removeWorktrees, revertCommit } from "../../src/worktrees.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-qm", `${file}: ${text}`);
  return git(cwd, "rev-parse", "HEAD").trim();
};

beforeAll(() => {
  // the merge commit needs an identity; the machine running the tests may have none
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
});

/** A project with two agents in auto worktrees (backend leads). */
async function stand() {
  const root = await tmpDir();
  const project = join(root, "shop");
  mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  commit(project, "a.txt", "a");
  const agents = ["backend", "reviewer"].map((id) => ({ id, cwd: `${project}-${id}`, worktree: { project, branch: `swarm-${id}` } }));
  await ensureWorktrees(agents);
  return { project, agents, backend: agents[0]!.cwd, reviewer: agents[1]!.cwd };
}

describe("merge the lead's branch", () => {
  it("merges with a merge commit; then says it is in already", async () => {
    const { project, backend } = await stand();
    const head = commit(backend, "b.txt", "feature");
    const r = await mergeBranch(project, "swarm-backend", "Merge swarm-backend: task-001 Feature", "merge");
    expect(r).toMatchObject({ already: false, into: "main" });
    expect(git(project, "log", "-1", "--format=%s%n%P").trim().split("\n")).toEqual(["Merge swarm-backend: task-001 Feature", expect.stringContaining(head)]);
    expect(existsSync(join(project, "b.txt"))).toBe(true);
    expect(await mergeBranch(project, "swarm-backend", "again")).toMatchObject({ already: true, commit: r.commit });
  });

  it("refuses a conflict, uncommitted changes, a detached HEAD and a missing branch, changing nothing", async () => {
    const { project, backend } = await stand();
    commit(backend, "a.txt", "theirs");
    const before = git(project, "rev-parse", "HEAD").trim();
    commit(project, "a.txt", "ours");
    const head = git(project, "rev-parse", "HEAD").trim();
    await expect(mergeBranch(project, "swarm-backend", "m")).rejects.toMatchObject({ code: "MERGE_CONFLICT", details: { files: ["a.txt"] } });
    expect(git(project, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(project, "status", "--porcelain")).toBe("");

    writeFileSync(join(project, "a.txt"), "dirty");
    await expect(mergeBranch(project, "swarm-backend", "m")).rejects.toThrow(/uncommitted changes/);
    git(project, "checkout", "-q", "a.txt");
    git(project, "checkout", "-q", before);
    await expect(mergeBranch(project, "swarm-backend", "m")).rejects.toThrow(/detached HEAD/);
    git(project, "checkout", "-q", "main");
    await expect(mergeBranch(project, "swarm-nope", "m")).rejects.toThrow(/No branch swarm-nope/);
  });
});

describe("the next task on an agent's old branch", () => {
  it("after the squash of its previous task: the base is merged in, and only the commits of the new task count as its work", async () => {
    const { project, backend, reviewer } = await stand();
    // task 1, a while ago: its commit, then squashed into the project (another commit with the same content)
    process.env.GIT_COMMITTER_DATE = "2026-01-01T10:00:00Z";
    commit(backend, "old.txt", "task 1");
    delete process.env.GIT_COMMITTER_DATE;
    await mergeBranch(project, "swarm-backend", "task-001");
    const base = git(project, "rev-parse", "HEAD").trim();
    const created = new Date().toISOString(); // task 2 starts from the squash

    expect(await catchUpBranch(backend, base)).toBe(`merged the task's base ${base.slice(0, 7)} into the branch`);
    expect(await catchUpBranch(backend, base)).toBeNull(); // has it now
    commit(backend, "new.txt", "task 2");
    expect(await filesChangedSince(backend, base)).toEqual(["new.txt", "old.txt"]); // by commits alone task 1 would count
    expect(await filesChangedSince(backend, base, [], created)).toEqual(["new.txt"]);

    // uncommitted changes or a conflict: nothing is merged, the log says why
    commit(project, "a.txt", "project moved on");
    const next = git(project, "rev-parse", "HEAD").trim();
    writeFileSync(join(reviewer, "a.txt"), "dirty");
    expect(await catchUpBranch(reviewer, next)).toContain("uncommitted changes: not merged");
    git(reviewer, "checkout", "-q", "a.txt");
    commit(reviewer, "a.txt", "reviewer's own");
    expect(await catchUpBranch(reviewer, next)).toContain("conflicts; nothing changed");
    expect(git(reviewer, "status", "--porcelain")).toBe("");
  });
});

describe("remove the agents' worktrees", () => {
  it("removes clean worktrees and merged branches, keeps a dirty one and an unmerged branch, and the runner brings them back", async () => {
    const { project, agents, backend, reviewer } = await stand();
    commit(backend, "b.txt", "feature");
    await mergeBranch(project, "swarm-backend", "m");
    mkdirSync(join(reviewer, ".agent-network", "builds"), { recursive: true }); // ignored files (the build logs) do not keep it
    writeFileSync(join(reviewer, ".agent-network", "builds", "build-001.log"), "log");
    const tester = { id: "tester", cwd: `${project}-tester`, worktree: { project, branch: "swarm-tester" } };
    await ensureWorktrees([tester]);
    commit(tester.cwd, "t.txt", "unmerged");
    writeFileSync(join(tester.cwd, "t.txt"), "and dirty");
    const result = await removeWorktrees([...agents, tester]);
    expect(result).toEqual([
      { id: "backend", path: backend, removed: true, branchDeleted: true },
      { id: "reviewer", path: reviewer, removed: true, branchDeleted: true },
      { id: "tester", path: tester.cwd, removed: false, branchDeleted: false, note: expect.stringContaining("worktree kept") },
    ]);
    expect(existsSync(backend)).toBe(false);
    expect(git(project, "branch", "--list", "--format=%(refname:short)", "swarm-*").trim()).toBe("swarm-tester");

    git(tester.cwd, "checkout", "-q", "t.txt");
    expect((await removeWorktrees([tester]))[0]).toMatchObject({ removed: true, branchDeleted: false, note: expect.stringContaining("not merged") });

    // the next session gets a fresh worktree from the project's HEAD (with the merged work)
    const seen: RunnerOptions[] = [];
    const pool = new RunnerPool(join(project, ".agent-network"), [{ id: "backend", command: ["x"], cwd: backend, worktree: agents[0]!.worktree, autostart: false }], {
      run: async (o) => {
        seen.push(o);
        await o.prepare?.({ git: null } as never);
        return 0;
      },
    });
    pool.start("backend");
    await new Promise((d) => setTimeout(d, 300));
    expect(existsSync(join(backend, "b.txt"))).toBe(true);
    expect(git(backend, "branch", "--show-current").trim()).toBe("swarm-backend");
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("the page: merge after DONE, clean when nothing is open", () => {
  it("merges the lead's branch of a DONE task once, cleans only when no task is open", async () => {
    const { project, agents, backend } = await stand();
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const post = async (path: string) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { status: r.status, body: (await r.json()) as any };
    };
    const task = await operator.createTaskAsOperator({ title: "Feature", description: "d", agents: ["backend", "reviewer"] });
    expect((await (await fetch(`${ui.url}/api/state`)).json() as any).control.worktrees).toEqual(["backend", "reviewer"]);

    expect(await post(`/api/tasks/${task.id}/merge`)).toMatchObject({ status: 400, body: { error: "INVALID_PHASE" } });
    expect(await post("/api/worktrees/clean")).toMatchObject({ status: 400, body: { message: expect.stringContaining(`Open tasks still need the worktrees: ${task.id} (ACTIVE)`) } });

    commit(backend, "b.txt", "feature");
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
    const diff = async () => (await (await fetch(`${ui!.url}/api/tasks/${task.id}/diff`)).json()) as any;
    expect(await diff()).toMatchObject({ branch: "swarm-backend", merged: false, commits: [expect.stringContaining("b.txt: feature")], commitsTotal: 1, files: [{ path: "b.txt", added: 1, deleted: 0 }] });
    const one = (await (await fetch(`${ui!.url}/api/tasks/${task.id}/diff?file=b.txt`)).json()) as any;
    expect(one).toMatchObject({ path: "b.txt", truncated: false, patch: expect.stringContaining("+feature") });
    const merged = await post(`/api/tasks/${task.id}/merge`);
    expect(merged).toMatchObject({ status: 200, body: { task: { merged: { branch: "swarm-backend", into: "main", already: false } } } });
    expect(git(project, "log", "-1", "--format=%s%n%P").trim().split("\n")).toEqual([`${task.id}: Feature`, expect.not.stringContaining(" ")]); // one commit, one parent
    expect(await post(`/api/tasks/${task.id}/merge`)).toMatchObject({ status: 400, body: { error: "ALREADY_COMPLETED" } });
    expect(await diff()).toMatchObject({ merged: true, files: [{ path: "b.txt" }] }); // after the merge: what the merge brought
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.tasks[0].merged).toMatchObject({ branch: "swarm-backend" });

    const cleaned = await post("/api/worktrees/clean");
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.result.map((r: any) => [r.id, r.removed, r.branchDeleted])).toEqual([["backend", true, true], ["reviewer", true, true]]);
  });

  it("a lead working in the project folder has nothing to merge", async () => {
    const { project } = await stand();
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, [{ id: "backend", command: ["x"], cwd: project, autostart: false }, { id: "reviewer", command: ["x"], cwd: project, autostart: false }]);
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
    const r = await fetch(`${ui.url}/api/tasks/${task.id}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).message).toContain("no branch of its own");
    expect(((await (await fetch(`${ui.url}/api/state`)).json()) as any).control.worktrees).toEqual([]);
  });
});

describe("a big diff", () => {
  it("lists hundreds of files and commits cheaply; one file's diff comes alone and is cut when huge", async () => {
    const { project, backend } = await stand();
    for (let i = 0; i < 300; i++) writeFileSync(join(backend, `f${i}.txt`), `line ${i}\n`);
    git(backend, "add", ".");
    git(backend, "commit", "-qm", "300 files");
    for (let i = 0; i < 120; i++) commit(backend, "log.txt", `entry ${i}`);
    writeFileSync(join(backend, "huge.txt"), Array.from({ length: 40_000 }, (_, i) => `generated line ${i}`).join("\n"));
    git(backend, "add", ".");
    git(backend, "commit", "-qm", "huge");
    const list = await branchDiff(project, "HEAD", "swarm-backend", "three-dot");
    expect(list.files).toHaveLength(302);
    expect(list.commitsTotal).toBe(122);
    expect(list.files.find((f) => f.path === "huge.txt")).toEqual({ path: "huge.txt", added: 40_000, deleted: 0 });
    expect(JSON.stringify(list).length).toBeLessThan(40_000); // no patches in the list
    const huge = await fileDiff(project, "HEAD", "swarm-backend", "three-dot", "huge.txt");
    expect(huge.truncated).toBe(true);
    expect(huge.patch.length).toBe(300_000);
    expect((await fileDiff(project, "HEAD", "swarm-backend", "three-dot", "f7.txt")).patch).toContain("+line 7");
    await expect(fileDiff(project, "HEAD", "swarm-backend", "three-dot", "--output=/tmp/x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("a merged change into the agents' folders", () => {
  it("the page says who lacks it and brings the project's branch into their branches", async () => {
    const { project, agents, reviewer } = await stand();
    mkdirSync(join(project, "openspec", "changes", "add-x"), { recursive: true });
    commit(project, "openspec/changes/add-x/tasks.md", "- [ ] 1.1 do it\n");
    const networkDir = join(project, ".agent-network");
    const pool = new RunnerPool(networkDir, [...agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })), { id: "tester", command: ["x"], cwd: `${project}-tester`, worktree: { project, branch: "swarm-tester" }, autostart: false }]);
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const folders = async () => (await (await fetch(`${ui!.url}/api/openspec/folders?change=add-x&agents=backend,reviewer,tester`)).json()) as any;
    // tester's worktree does not exist yet: it will be created from HEAD, with the change
    expect(await folders()).toEqual({ change: "add-x", inProject: true, missing: [{ id: "backend", cwd: agents[0]!.cwd }, { id: "reviewer", cwd: reviewer }] });

    writeFileSync(join(reviewer, "a.txt"), "dirty");
    const r = (await (await fetch(`${ui.url}/api/openspec/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change: "add-x" }) })).json()) as any;
    expect(r.result).toEqual([
      { id: "backend", ok: true, text: "main → swarm-backend: fast-forward" },
      { id: "reviewer", ok: false, text: expect.stringContaining("uncommitted changes") },
    ]);
    expect(r.missing).toEqual([{ id: "reviewer", cwd: reviewer }]);
    git(reviewer, "checkout", "-q", "a.txt");
    expect(await mergeProjectInto(project, reviewer)).toEqual({ from: "main", into: "swarm-reviewer", result: "fast-forward" });
    expect((await folders()).missing).toEqual([]);
  });
});

describe("review comments on a diff", () => {
  it("while the task runs they go to the lead with file and line; after DONE they become a follow-up task", async () => {
    const { project, agents, backend, reviewer } = await stand();
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const task = await operator.createTaskAsOperator({ title: "Feature", description: "d", agents: ["backend", "reviewer"], verifyCommand: "npm test" });
    commit(backend, "b.txt", "feature");
    commit(reviewer, "r.txt", "notes");

    // any agent's branch while the task runs
    const diff = async (q = "") => (await (await fetch(`${ui!.url}/api/tasks/${task.id}/diff${q}`)).json()) as any;
    expect(await diff()).toMatchObject({ branch: "swarm-backend", agents: ["backend", "reviewer"], files: [{ path: "b.txt" }] });
    expect(await diff("?agent=reviewer")).toMatchObject({ branch: "swarm-reviewer", files: [{ path: "r.txt" }] });

    expect(await post(`/api/tasks/${task.id}/review`, { comments: [] })).toMatchObject({ status: 400 });
    const sent = await post(`/api/tasks/${task.id}/review`, { branch: "swarm-backend", comments: [{ file: "b.txt", line: 1, code: "feature", text: "Name it 'refund'" }, { file: "b.txt", text: "Add a test" }] });
    expect(sent).toMatchObject({ status: 201, body: { sent: "lead", to: "backend" } });
    const msg = (await operator.messages.list(task.id)).find((m) => m.to === "backend")!;
    expect(msg.content).toContain("Review comments on the diff (branch swarm-backend)");
    expect(msg.content).toContain("- rc-1 b.txt:1 `feature` — Name it 'refund'");
    expect(msg.content).toContain("- rc-2 b.txt — Add a test");
    expect((await operator.reviewComments(task.id)).map((c) => [c.id, c.status])).toEqual([["rc-1", "open"], ["rc-2", "open"]]);

    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
    const after = await post(`/api/tasks/${task.id}/review`, { comments: [{ file: "b.txt", line: 1, text: "Still wrong" }] });
    expect(after).toMatchObject({ status: 201, body: { sent: "task", task: { title: `Fix the review comments on ${task.id}: Feature`, agents: ["backend", "reviewer"], verifyCommand: "npm test" } } });
    expect(after.body.task.description).toContain("- b.txt:1 — Still wrong");
    expect(await operator.reviewComments(after.body.task.id)).toEqual([expect.objectContaining({ id: "rc-1", file: "b.txt", line: 1, status: "open" })]);
  });
});

describe("one commit per task, and undoing it", () => {
  it("squash puts the task in as one commit that one revert undoes; the squashed branches can still be cleaned", async () => {
    const { project, agents, backend, reviewer } = await stand();
    commit(backend, "b.txt", "one");
    commit(backend, "c.txt", "two");
    git(reviewer, "merge", "-q", "swarm-backend"); // the reviewer had the lead's work too
    const before = git(project, "rev-parse", "HEAD").trim();
    const r = await mergeBranch(project, "swarm-backend", "task-001: Feature");
    expect(r).toMatchObject({ already: false, into: "main", strategy: "squash" });
    expect(git(project, "rev-list", "--count", `${before}..HEAD`).trim()).toBe("1");
    expect(git(project, "log", "-1", "--format=%s%n%b").trim()).toMatch(/^task-001: Feature\nSquashed from swarm-backend:\n\w+ c\.txt: two\n\w+ b\.txt: one$/);
    expect(await mergeBranch(project, "swarm-backend", "again")).toMatchObject({ already: true }); // its work is in HEAD

    const undone = await revertCommit(project, r.commit, "Revert task-001: Feature");
    expect(git(project, "log", "-1", "--format=%s").trim()).toBe("Revert task-001: Feature");
    expect(existsSync(join(project, "b.txt"))).toBe(false);
    expect(undone.commit).toBe(git(project, "rev-parse", "HEAD").trim());

    // a squashed branch is no ancestor of HEAD: branch -d refuses it, but its work is in the project — dropped all the same
    await mergeBranch(project, "swarm-backend", "task-001: Feature again"); // after the revert it applies anew
    const cleaned = await removeWorktrees(agents);
    expect(cleaned.map((x) => [x.id, x.removed, x.branchDeleted])).toEqual([["backend", true, true], ["reviewer", true, true]]);
  });

  it("revert refuses on uncommitted changes and on conflicts, changing nothing", async () => {
    const { project, backend } = await stand();
    commit(backend, "a.txt", "theirs");
    const r = await mergeBranch(project, "swarm-backend", "task-001: Feature");
    commit(project, "a.txt", "later work on the same line");
    const head = git(project, "rev-parse", "HEAD").trim();
    await expect(revertCommit(project, r.commit, "Revert")).rejects.toMatchObject({ code: "MERGE_CONFLICT" });
    expect(git(project, "rev-parse", "HEAD").trim()).toBe(head);
    expect(git(project, "status", "--porcelain")).toBe("");
    writeFileSync(join(project, "a.txt"), "dirty");
    await expect(revertCommit(project, r.commit, "Revert")).rejects.toThrow(/uncommitted changes/);
  });
});

describe("the page: revert a merged task", () => {
  it("one button undoes the task's commit, once", async () => {
    const { project, agents, backend } = await stand();
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const post = async (path: string) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { status: r.status, body: (await r.json()) as any };
    };
    const task = await operator.createTaskAsOperator({ title: "Feature", description: "d", agents: ["backend", "reviewer"] });
    commit(backend, "b.txt", "feature");
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
    expect(await post(`/api/tasks/${task.id}/revert`)).toMatchObject({ status: 400 }); // not merged yet
    expect((await post(`/api/tasks/${task.id}/merge`)).body.task.merged).toMatchObject({ strategy: "squash", already: false });
    const undone = await post(`/api/tasks/${task.id}/revert`);
    expect(undone).toMatchObject({ status: 200, body: { task: { merged: { reverted: { commit: expect.any(String) } } } } });
    expect(git(project, "log", "-1", "--format=%s").trim()).toBe(`Revert ${task.id}: Feature`);
    expect(existsSync(join(project, "b.txt"))).toBe(false);
    expect(await post(`/api/tasks/${task.id}/revert`)).toMatchObject({ status: 400, body: { error: "ALREADY_COMPLETED" } });
  });
});
