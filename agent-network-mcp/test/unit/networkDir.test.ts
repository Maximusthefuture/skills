import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { loadConfig } from "../../src/config.js";
import { detectNetworkDir, pickNetworkDir } from "../../src/networkDir.js";
import { tmpDir } from "../helpers/tmp.js";

/** A repository with one commit, a subfolder and a worktree next to it. */
async function repoWithWorktree() {
  const repo = realpathSync(await tmpDir());
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  const worktree = `${repo}-backend`;
  git(repo, "worktree", "add", "-q", worktree, "-b", "swarm-backend");
  return { repo, worktree, network: join(repo, ".agent-network") };
}

describe("network dir from the git repository", () => {
  it("is <main checkout>/.agent-network from the checkout, a subfolder and a worktree; null outside git", async () => {
    const { repo, worktree, network } = await repoWithWorktree();
    expect(detectNetworkDir(repo)).toBe(network);
    expect(detectNetworkDir(join(repo, "src"))).toBe(network);
    expect(detectNetworkDir(worktree)).toBe(network); // all worktrees of a project share one network
    expect(detectNetworkDir(realpathSync(await tmpDir()))).toBeNull();
  });

  it("a given path wins; \"auto\" and nothing mean the repository", async () => {
    const { repo, network } = await repoWithWorktree();
    expect(pickNetworkDir("/given", { NETWORK_DIR: "/env" }, repo)).toEqual({ dir: "/given", detected: false });
    expect(pickNetworkDir(undefined, { NETWORK_DIR: "/env" }, repo)).toEqual({ dir: "/env", detected: false });
    expect(pickNetworkDir(undefined, {}, repo, "/from-config")).toEqual({ dir: "/from-config", detected: false });
    expect(pickNetworkDir(undefined, {}, repo)).toEqual({ dir: network, detected: true });
    expect(pickNetworkDir("auto", { NETWORK_DIR: "/env" }, repo)).toEqual({ dir: network, detected: true });
  });

  it("the MCP server finds it only with NETWORK_DIR=auto", async () => {
    const { worktree, network } = await repoWithWorktree();
    const env = { AGENT_ID: "backend" };
    expect(loadConfig({ ...env, NETWORK_DIR: "auto" }, worktree)).toMatchObject({ networkDir: network, networkDirDetected: true });
    expect(() => loadConfig(env, worktree)).toThrow(/NETWORK_DIR environment variable is required/); // no silent networks in every repo
    const outside = realpathSync(await tmpDir());
    expect(() => loadConfig({ ...env, NETWORK_DIR: "auto" }, outside)).toThrow(/needs a git repository/);
  });

  it("operator commands use the repository of the current folder; a look around creates nothing", async () => {
    const { repo, worktree, network } = await repoWithWorktree();
    const run = async (args: string[], cwd: string) => {
      const out: string[] = [];
      return { code: await runCli(args, {}, (l) => out.push(l), cwd), out: out.join("\n") };
    };
    const list = await run(["task", "list"], repo);
    expect(list.code).toBe(2);
    expect(list.out).toContain(`no agent network at ${network} yet`);
    expect(existsSync(network)).toBe(false);

    const created = await run(["task", "create", "--title", "Cancel orders", "--agents", "backend,reviewer", "--description", "cancel an order"], worktree);
    expect(created.code).toBe(0);
    expect(created.out).toContain(`network: ${network}`);
    expect((await run(["task", "list"], join(repo, "src"))).out).toContain("Cancel orders");

    const outside = await run(["task", "list"], realpathSync(await tmpDir()));
    expect(outside.code).toBe(2);
    expect(outside.out).toContain("or run this inside a git repository");
  });
});
