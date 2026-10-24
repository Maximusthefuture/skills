import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { loadRunnersConfig, PACKAGE_DIR, projectRunnersConfig } from "../../src/ui/runners.js";
import { ensureWorktrees, gitRoot } from "../../src/worktrees.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });

async function repo(commit = true) {
  const root = await tmpDir();
  const project = join(root, "shop");
  mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  if (commit) {
    writeFileSync(join(project, "a.txt"), "a");
    git(project, "add", ".");
    git(project, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  }
  return { root, project };
}
const agent = (project: string, id: string) => ({ id, cwd: `${project}-${id}`, worktree: { project, branch: `swarm-${id}` } });

describe("agent worktrees", () => {
  it("are created next to the project on swarm-<agent> branches, once; the network stays out of git", async () => {
    const { project } = await repo();
    const agents = [agent(project, "backend"), agent(project, "reviewer"), { id: "tester", cwd: project }];
    expect(await ensureWorktrees(agents)).toEqual([`backend: ${project}-backend (branch swarm-backend, new from HEAD)`, `reviewer: ${project}-reviewer (branch swarm-reviewer, new from HEAD)`]);
    expect(existsSync(join(`${project}-backend`, "a.txt"))).toBe(true);
    expect(git(`${project}-reviewer`, "branch", "--show-current").trim()).toBe("swarm-reviewer");
    expect(await gitRoot(`${project}-backend`)).toBeTruthy();
    expect(readFileSync(join(project, ".git", "info", "exclude"), "utf8")).toContain(".agent-network/");
    expect(await ensureWorktrees(agents)).toEqual([]); // there already
    expect(readFileSync(join(project, ".git", "info", "exclude"), "utf8").match(/\.agent-network\//g)).toHaveLength(1);
  });

  it("reuses an existing branch; refuses a repository without commits and a folder that is no worktree", async () => {
    const { project } = await repo();
    git(project, "branch", "swarm-backend");
    git(project, "worktree", "add", "-q", `${project}-backend`, "swarm-backend");
    git(project, "worktree", "remove", `${project}-backend`);
    expect(await ensureWorktrees([agent(project, "backend")])).toEqual([`backend: ${project}-backend (branch swarm-backend, existing)`]);

    mkdirSync(`${project}-stray`);
    await expect(ensureWorktrees([agent(project, "stray")])).rejects.toMatchObject({ message: expect.stringContaining("is no git worktree") });
    const empty = await repo(false);
    await expect(ensureWorktrees([agent(empty.project, "backend")])).rejects.toMatchObject({ message: expect.stringContaining("at least one commit") });
  });
});

describe("a project's own runners config", () => {
  it("is copied from the template once (Qwen by default), with file references pointed at the package, and loads in place", async () => {
    const { project } = await repo();
    const qwen = await projectRunnersConfig(project);
    expect(qwen).toEqual({ path: join(project, ".agent-network", "runners.json"), created: true, stack: null }); // a.txt only: no build to fit
    const raw = JSON.parse(readFileSync(qwen.path, "utf8"));
    expect(raw._comment[0]).toContain("copied from examples/runner/runners.qwen.example.json");
    expect(raw.defaults.command[0]).toBe("qwen");
    expect(await projectRunnersConfig(project, "claude")).toEqual({ path: qwen.path, created: false }); // there already: kept
    const config = await loadRunnersConfig(qwen.path, { projectDir: project });
    expect(config.networkDir).toBe(join(project, ".agent-network"));
    expect(config.agents.map((a) => a.cwd)).toEqual([`${project}-backend`, `${project}-reviewer`, `${project}-tester`]);
    expect(config.agents[0]!.instructionsFile).toBe(join(PACKAGE_DIR, "examples", "runner", "instructions", "backend.md"));

    const other = (await repo()).project;
    const claude = await projectRunnersConfig(other, "claude");
    const raw2 = JSON.parse(readFileSync(claude.path, "utf8"));
    expect(raw2.defaults.systemPromptFile).toBe("{agentNetworkMcp}/examples/runner/swarm-system-prompt.md"); // was relative in the template
    expect(raw2.agents[0].instructionsFile).toBe("{agentNetworkMcp}/examples/runner/instructions/backend.md");
    const c = await loadRunnersConfig(claude.path, { projectDir: other });
    expect(c.agents[0]!.command[0]).toBe("claude");
    expect(c.supervisor!.promptFile).toBe(join(PACKAGE_DIR, "examples", "runner", "supervisor-prompt.md"));
  });

  it("ui refuses an unknown template", async () => {
    const out: string[] = [];
    expect(await runCli(["ui", "--template", "gpt"], {}, (l) => out.push(l), await tmpDir())).toBe(2);
    expect(out[0]).toContain("--template is qwen or claude");
  });
});
