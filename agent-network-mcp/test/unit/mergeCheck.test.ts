import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defaultMergeSetup, mergeRef } from "../../src/mergeCheck.js";
import { unreported } from "../../src/observer/digest.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { ensureWorktrees } from "../../src/worktrees.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string, text: string) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-qm", `${file}: ${text}`);
  return git(cwd, "rev-parse", "HEAD");
};

beforeAll(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
});

// the project's build: red when ok.txt says "bad"; "wait:<file>" holds it until that file exists
const CHECK = `const fs = require("fs");
const s = fs.readFileSync("ok.txt", "utf8").trim();
if (s === "bad") { console.error("not ok 1 - ok.txt says bad"); process.exit(1); }
if (s.startsWith("wait:")) { const f = s.slice(5); const t = Date.now(); while (!fs.existsSync(f) && Date.now() - t < 15000) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); } }
console.log("ok");`;

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

/** A project whose verifyCommand (npm test) reads ok.txt, two agents in auto worktrees (backend leads), the page with runners. */
async function stand() {
  const root = await tmpDir();
  const project = join(root, "shop");
  mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "shop", version: "1.0.0", scripts: { test: "node check.js" } }));
  writeFileSync(join(project, "check.js"), CHECK);
  writeFileSync(join(project, ".gitignore"), ".agent-network/\n");
  writeFileSync(join(project, "ok.txt"), "good");
  git(project, "add", ".");
  git(project, "commit", "-qm", "init");
  const agents = ["backend", "reviewer"].map((id) => ({ id, cwd: `${project}-${id}`, worktree: { project, branch: `swarm-${id}` } }));
  await ensureWorktrees(agents);
  const networkDir = join(project, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const pool = new RunnerPool(networkDir, agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
  ui = await startUiServer([{ networkDir, runners: pool, mergeSetup: [] }], { port: 0 });
  const url = ui.url;
  const post = async (path: string, body: unknown = {}, headers: Record<string, string> = {}) => {
    const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const state = async () => (await (await fetch(`${url}/api/state`)).json()) as any;
  const done = async (title: string, verifyCommand: string | null = "npm test") => {
    const task = await operator.createTaskAsOperator({ title, description: "d", agents: ["backend", "reviewer"], ...(verifyCommand ? { verifyCommand } : {}) });
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
    return task;
  };
  /** The check of a task once it is over. */
  const settled = async (id: string, until = (c: any) => c && c.status !== "running") => {
    for (let i = 0; i < 300; i++) {
      const c = (await state()).tasks.find((t: any) => t.id === id)?.mergeCheck;
      if (until(c)) return c;
      await new Promise((d) => setTimeout(d, 50));
    }
    throw new Error(`the merge check of ${id} did not settle`);
  };
  return { project, backend: agents[0]!.cwd, operator, post, state, done, settled, url };
}

describe("the merge check", () => {
  it("green: the merge built and verified apart from the project lands as that very commit", async () => {
    const s = await stand();
    commit(s.backend, "feature.txt", "feature");
    const task = await s.done("Feature");
    const before = git(s.project, "rev-parse", "HEAD");

    const started = await s.post(`/api/tasks/${task.id}/merge`);
    expect(started).toMatchObject({ status: 202, body: { check: { status: "running", base: before, into: "main" } } });
    expect(git(s.project, "rev-parse", "HEAD")).toBe(before); // nothing in the project while it is checked
    const check = await s.settled(task.id);
    expect(check).toMatchObject({ status: "green", build: { command: "npm test", ok: true }, merged: check.candidate });
    expect(git(s.project, "rev-parse", "HEAD")).toBe(check.candidate); // the checked commit itself, fast-forward
    expect(git(s.project, "log", "-1", "--format=%s%n%P").split("\n")).toEqual([`${task.id}: Feature`, before]);
    expect(existsSync(`${s.project}-merge-${task.id}`)).toBe(false); // its worktree is gone
    const t = (await s.state()).tasks.find((x: any) => x.id === task.id);
    expect(t.merged).toMatchObject({ commit: check.candidate, verified: { command: "npm test" } });
    expect(t.mergeCheck).toMatchObject({ status: "green" }); // the card shows the merge once it is in; the check stays for the record
  });

  it("red: the project stays as it was, the candidate is kept for a follow-up of the team; the operator may merge it anyway", async () => {
    const s = await stand();
    commit(s.backend, "ok.txt", "bad");
    const task = await s.done("Breaks the build");
    const before = git(s.project, "rev-parse", "HEAD");
    expect((await s.post(`/api/tasks/${task.id}/merge`)).status).toBe(202);
    const check = await s.settled(task.id);
    expect(check).toMatchObject({ status: "red", build: { ok: false, log: `tasks/${task.id}/merge-check/build.log` } });
    expect(check.build.summary).toContain("ok.txt says bad");
    expect(check.build.summary).toContain(`full log: .agent-network/tasks/${task.id}/merge-check/build.log (in the project)`); // not the gone worktree's
    expect(git(s.project, "rev-parse", "HEAD")).toBe(before);
    expect(git(s.project, "rev-parse", mergeRef(task.id))).toBe(check.candidate);
    expect(existsSync(join(s.project, ".agent-network", "tasks", task.id, "merge-check", "build.log"))).toBe(true);
    const info = (await (await fetch(`${s.url}/api/tasks/${task.id}/acceptance`)).json()) as any;
    expect(info.alerts).toEqual(expect.arrayContaining([{ level: "bad", text: "Сборка после вливания в main красная" }]));

    const handed = await s.post(`/api/tasks/${task.id}/merge/handoff`);
    expect(handed).toMatchObject({ status: 201, body: { followUp: { parentTaskId: task.id, baseCommit: check.candidate, verifyCommand: "npm test", agents: ["backend", "reviewer"] } } });
    expect(handed.body.followUp.description).toContain("ok.txt says bad");
    expect(await s.post(`/api/tasks/${task.id}/merge/handoff`)).toMatchObject({ status: 400, body: { error: "ALREADY_COMPLETED" } });
    expect((await s.settled(task.id)).followUp).toBe(handed.body.followUp.id);

    expect(await s.post(`/api/tasks/${task.id}/merge/force`, {}, { "x-agent-network-actor": "supervisor" })).toMatchObject({ status: 403 });
    const forced = await s.post(`/api/tasks/${task.id}/merge/force`);
    expect(forced).toMatchObject({ status: 200, body: { task: { merged: { unverified: true } } } });
    expect(git(s.project, "show", "HEAD:ok.txt")).toBe("bad");
  });

  it("stale: the project moved while it was checked, nothing lands; checked again, it does", async () => {
    const s = await stand();
    const go = join(await tmpDir(), "go");
    commit(s.backend, "ok.txt", `wait:${go}`);
    const task = await s.done("Slow");
    await s.post(`/api/tasks/${task.id}/merge`);
    await s.settled(task.id, (c) => c?.step === "build");
    const moved = commit(s.project, "other.txt", "someone else's work");
    writeFileSync(go, "");
    const check = await s.settled(task.id);
    expect(check).toMatchObject({ status: "stale", error: expect.stringContaining("The project moved") });
    expect(git(s.project, "rev-parse", "HEAD")).toBe(moved);

    expect((await s.post(`/api/tasks/${task.id}/merge/retry`)).status).toBe(202);
    expect(await s.settled(task.id)).toMatchObject({ status: "green" });
    expect(git(s.project, "log", "-1", "--format=%s")).toBe(`${task.id}: Slow`);
    expect(git(s.project, "rev-parse", "HEAD^")).toBe(moved);
  });

  it("a conflict is known at once and goes to the team as a merge of the project's HEAD", async () => {
    const s = await stand();
    commit(s.backend, "ok.txt", "theirs");
    const head = commit(s.project, "ok.txt", "ours");
    const task = await s.done("Conflicts");
    const r = await s.post(`/api/tasks/${task.id}/merge`);
    expect(r).toMatchObject({ status: 202, body: { check: { status: "conflict", files: ["ok.txt"], base: head } } });
    expect(await s.post(`/api/tasks/${task.id}/merge/force`)).toMatchObject({ status: 400, body: { error: "MERGE_CONFLICT" } });
    const handed = await s.post(`/api/tasks/${task.id}/merge/handoff`);
    expect(handed.body.followUp).toMatchObject({ baseCommit: head });
    expect(handed.body.followUp.description).toContain("conflicts in: ok.txt");
  });

  it("«Принять и влить» accepts only once the checked merge lands; a task without verifyCommand merges unverified", async () => {
    const s = await stand();
    commit(s.backend, "feature.txt", "feature");
    const task = await s.done("Accepted");
    expect(await s.post(`/api/tasks/${task.id}/acceptance/accept`)).toMatchObject({ status: 202, body: { check: { status: "running", accept: true } } });
    expect((await s.state()).tasks.find((x: any) => x.id === task.id).acceptance).toBeNull();
    await s.settled(task.id);
    const t = (await s.state()).tasks.find((x: any) => x.id === task.id);
    expect(t).toMatchObject({ acceptance: { status: "accepted" }, merged: { verified: { command: "npm test" } } });

    commit(s.backend, "more.txt", "more");
    const plain = await s.done("No verify", null);
    expect(await s.post(`/api/tasks/${plain.id}/merge`)).toMatchObject({ status: 200, body: { task: { merged: { unverified: true } } } });
  });
});

describe("deleting a task", () => {
  it("only a closed one with no open task of its chain; its number is not given again", async () => {
    const s = await stand();
    const open = await s.operator.createTaskAsOperator({ title: "Open", description: "d", agents: ["backend", "reviewer"] });
    expect(await s.post(`/api/tasks/${open.id}/delete`)).toMatchObject({ status: 400, body: { error: "INVALID_PHASE" } });
    await s.operator.cancelTask(open.id, "not needed");
    const parent = await s.done("Parent");
    const child = await s.operator.createTaskAsOperator({ title: "Child", description: "d", agents: ["backend", "reviewer"], parentTaskId: parent.id });
    expect(child).toMatchObject({ parentTaskId: parent.id, rootTaskId: parent.id });
    expect(await s.post(`/api/tasks/${parent.id}/delete`)).toMatchObject({ status: 400, body: { message: expect.stringContaining(child.id) } });
    expect(await s.post(`/api/tasks/${open.id}/delete`, {}, { "x-agent-network-actor": "supervisor" })).toMatchObject({ status: 403 });

    expect(await s.post(`/api/tasks/${open.id}/delete`, { reason: "the agent made the task up" })).toMatchObject({ status: 200, body: { deleted: { id: open.id, title: "Open", folder: `deleted/${open.id}` } } });
    const ids = (await s.state()).tasks.map((t: any) => t.id);
    expect(ids).not.toContain(open.id);
    // nothing is erased: the folder moved where the observer reads it, its digest says why
    const net = join(s.project, ".agent-network");
    expect(JSON.parse(readFileSync(join(net, "deleted", open.id, "task.json"), "utf8"))).toMatchObject({ id: open.id, status: "CANCELLED" });
    expect(JSON.parse(readFileSync(join(net, "tasks", open.id, "deleted.json"), "utf8"))).toMatchObject({ id: open.id, reason: "the agent made the task up", folder: `deleted/${open.id}` });
    expect(JSON.parse(readFileSync(join(net, "observer", "digests", `${open.id}.json`), "utf8"))).toMatchObject({ taskId: open.id, deleted: { reason: "the agent made the task up", folder: `deleted/${open.id}` } });
    await s.operator.cancelTask(child.id, "x");
    expect(await s.post(`/api/tasks/${child.id}/delete`)).toMatchObject({ status: 200 });
    const next = await s.operator.createTaskAsOperator({ title: "Next", description: "d", agents: ["backend", "reviewer"] });
    expect(next.id).toBe("task-004"); // task-003 (the child, the latest) stays taken
  });
});

describe("deleted tasks and the observer", () => {
  it("a task deleted after a report covered it is news again", () => {
    const d = (taskId: string, deleted?: string) => ({ taskId, ...(deleted ? { deleted: { at: deleted, folder: `deleted/${taskId}` } } : {}) }) as any;
    const reports = [{ at: "2026-10-20T10:00:00Z", covers: ["task-001", "task-002", "task-003"] }];
    expect(unreported([d("task-001"), d("task-002", "2026-10-21T09:00:00Z"), d("task-003", "2026-10-19T09:00:00Z"), d("task-004")], reports).map((x) => x.taskId)).toEqual(["task-002", "task-004"]);
  });
});

describe("the setup a fresh worktree needs", () => {
  it("follows the lockfile", async () => {
    const dir = await tmpDir();
    expect(defaultMergeSetup(dir)).toEqual([]);
    writeFileSync(join(dir, "package.json"), "{}");
    expect(defaultMergeSetup(dir)).toEqual(["npm install"]);
    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(defaultMergeSetup(dir)).toEqual(["npm ci"]);
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(defaultMergeSetup(dir)).toEqual(["pnpm install --frozen-lockfile"]);
  });
});
