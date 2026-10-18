import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { filesChangedSince } from "../../src/git.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();

/** A project on main, and a worktree with its own branch per agent. */
async function repo() {
  const root = await tmpDir();
  const main = join(root, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@t");
  git(main, "config", "user.name", "t");
  writeFileSync(join(main, ".gitignore"), ".agent-network/\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  const tree = (id: string) => {
    const dir = join(root, id);
    git(main, "worktree", "add", "-q", dir, "-b", id);
    return dir;
  };
  const commit = (dir: string, file: string, body: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
    git(dir, "add", file);
    git(dir, "commit", "-qm", file);
    return git(dir, "rev-parse", "HEAD");
  };
  return { main, base: git(main, "rev-parse", "HEAD"), tree, commit };
}

describe("what a branch changed, from git", () => {
  it("its own commits since the base; merges and the merged commits of others left out", async () => {
    const r = await repo();
    const backend = r.tree("backend");
    const tester = r.tree("tester");
    const theirs = r.commit(backend, "src/Api.java", "class Api {}");
    r.commit(tester, "test/ApiTest.java", "class ApiTest {}");
    git(tester, "merge", "-q", "--no-edit", theirs); // the tester brought the backend's work in to test it
    r.commit(tester, "test/LoadTest.java", "class LoadTest {}");
    expect(await filesChangedSince(tester, r.base, [theirs])).toEqual(["test/ApiTest.java", "test/LoadTest.java"]);
    expect(await filesChangedSince(tester, r.base)).toEqual(["src/Api.java", "test/ApiTest.java", "test/LoadTest.java"]);
    expect(await filesChangedSince(tester, "0123456789abcdef0123456789abcdef01234567")).toBeNull();
  });
});

describe("ownership is checked on what the branch changed", () => {
  it("a file of another agent changed in a commit but left out of filesChanged is refused; a forgotten own file is added", async () => {
    const r = await repo();
    const networkDir = join(r.main, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const swarm = async (id: string, workdir: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }), undefined, { workdir });
    const backendDir = r.tree("backend");
    const testerDir = r.tree("tester");
    const backend = await swarm("backend", backendDir);
    const tester = await swarm("tester", testerDir);
    await operator.createTaskAsOperator({ title: "Api", description: "an endpoint and its tests", agents: ["backend", "tester"] });
    await backend.propose({ summary: "api", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "tester", responsibility: "tests", files: ["test/**"] }] });
    for (const a of [backend, tester]) {
      await a.context();
      await a.complete({});
    }

    // the tester edits the backend's file in a commit and lists only its test
    r.commit(testerDir, "test/ApiTest.java", "class ApiTest {}");
    const sneaky = r.commit(testerDir, "src/Api.java", "class Api { /* tester */ }");
    const refused = await tester.complete({ result: "tests", filesChanged: ["test/ApiTest.java"], commits: [sneaky] }).catch((e) => tester.errorBody(e));
    expect(refused).toMatchObject({ error: "FILE_NOT_OWNED" });
    expect(JSON.stringify(refused)).toContain("src/Api.java");

    // the backend forgets a file of its own: it is added, with a warning
    r.commit(backendDir, "src/Api.java", "class Api {}");
    const head = r.commit(backendDir, "src/Repo.java", "class Repo {}");
    const ok = await backend.complete({ result: "api", filesChanged: ["src/Api.java"], commits: [head] });
    expect(ok.warnings).toEqual(expect.arrayContaining([expect.stringContaining("you did not list; they count as changed: src/Repo.java")]));
    expect((await operator.implementations.find("task-001", "backend"))!.filesChanged.sort()).toEqual(["src/Api.java", "src/Repo.java"]);
  });
});

describe("another agent's reported work in IMPLEMENT", () => {
  it("is named with its commits to merge: they never reach this branch by themselves; waiting is no answer", async () => {
    const r = await repo();
    const networkDir = join(r.main, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const swarm = async (id: string, workdir: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }), undefined, { workdir });
    const backendDir = r.tree("backend");
    const testerDir = r.tree("tester");
    const backend = await swarm("backend", backendDir);
    const tester = await swarm("tester", testerDir);
    await operator.createTaskAsOperator({ title: "Api", description: "an endpoint and its tests", agents: ["backend", "tester"] });
    await backend.propose({ summary: "api", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "tester", responsibility: "tests", files: ["test/**"] }] });
    await tester.context();
    await tester.complete({});
    expect(String((await tester.context()).hint)).not.toContain("reported its part");

    const api = r.commit(backendDir, "src/Api.java", "class Api {}");
    await backend.complete({ result: "api", filesChanged: ["src/Api.java"], commits: [api] });
    const told = await tester.context();
    expect(told.hint).toContain(`backend reported its part (commits ${api.slice(0, 7)}): their commits never reach your branch by themselves`);
    expect(told.hint).toContain(`git merge ${api.slice(0, 7)}`);
    // waiting for "their push" anyway: the short answer at the timeout says to act, not to wait again
    await tester.wait({ timeoutMs: 1000 });
    const again = await tester.wait({ timeoutMs: 100 });
    expect(again).toMatchObject({ status: "TIMEOUT", nextAction: "implement" });
    expect(again.hint).toContain("nothing will: your next action is still implement");
    // merged: no more news
    git(testerDir, "merge", "-q", "--no-edit", api);
    expect(String((await tester.context({ full: true })).hint)).not.toContain("reported its part");
  });
});

describe("commits are checked against git, and the lead takes in what it delegated", () => {
  it("a made-up hash is refused, a short one stored in full; PASS waits until the job's commit is in the merged result", async () => {
    const { writeSpawnFile } = await import("../../src/spawner.js");
    const r = await repo();
    const networkDir = join(r.main, ".agent-network");
    await writeSpawnFile(networkDir, { templates: [{ name: "tester", description: "tests", config: { id: "tester", command: ["x", "{prompt}"] } }], maxPerTask: 2 });
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const swarm = async (id: string, workdir: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }), undefined, { workdir });
    const backendDir = r.tree("backend");
    const testerDir = r.tree("tester");
    const backend = await swarm("backend", backendDir);
    const tester = await swarm("tester", testerDir);
    const task = await operator.createTaskAsOperator({ title: "Api", description: "an endpoint and its tests", agents: ["backend", "tester"] });
    await backend.propose({ summary: "api", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "tester", responsibility: "tests", files: ["test/**"] }] });
    for (const a of [backend, tester]) {
      await a.context();
      await a.complete({});
    }
    const api = r.commit(backendDir, "src/Api.java", "class Api {}");
    const sent = await backend.delegate({ template: "tester", job: "Benchmark Api and write the numbers to bench/README.md", files: ["bench/**"] });
    // the lead has nothing but the job open: it waits (no busy wait() returning "implement")
    expect(await backend.context()).toMatchObject({ nextAction: "wait", waitingOn: ["tester-job1"] });

    const jobDir = r.tree("tester-job1");
    const job = await swarm("tester-job1", jobDir);
    git(jobDir, "merge", "-q", api);
    const bench = r.commit(jobDir, "bench/README.md", "p95 12 ms");
    const madeUp = `${bench.slice(0, 7)}${"0".repeat(33)}`;
    expect(await job.complete({ result: "bench", filesChanged: ["bench/README.md"], commits: [madeUp] }).catch((e) => job.errorBody(e))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("never complete one") });
    await job.complete({ result: "p95 12 ms", filesChanged: ["bench/README.md"], commits: [bench.slice(0, 7)] });
    expect((await operator.implementations.find(sent.job as string, "tester-job1"))!.commits).toEqual([bench]);

    await backend.complete({ result: "api", filesChanged: ["src/Api.java"], commits: [api] });
    const t = r.commit(testerDir, "test/ApiTest.java", "class ApiTest {}");
    await tester.complete({ result: "tests", filesChanged: ["test/ApiTest.java"], commits: [t] });
    for (const a of [backend, tester]) await a.complete({ status: "PASS" });
    expect((await operator.tasks.get(task.id)).phase).toBe("INTEGRATE");

    git(backendDir, "merge", "-q", "--no-edit", "tester");
    const refused = await backend.complete({ status: "PASS", result: "merged", commits: [git(backendDir, "rev-parse", "HEAD")] }).catch((e) => backend.errorBody(e));
    expect(refused).toMatchObject({ error: "JOBS_OPEN" });
    expect(JSON.stringify(refused)).toContain(bench.slice(0, 7));
    git(backendDir, "merge", "-q", "--no-edit", bench);
    expect(await backend.complete({ status: "PASS", result: "merged with the benchmark", commits: [git(backendDir, "rev-parse", "HEAD")] })).toMatchObject({ task: { phase: "DONE" } });
  });
});
