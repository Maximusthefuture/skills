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
