import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

/** NETWORK_DIR / --network-dir value that means "find the network from the git repository of the folder". */
export const AUTO = "auto";

/**
 * <root of the main checkout>/.agent-network for a folder inside a git repository, else null. The main checkout is
 * found through the common git dir, which all worktrees of a repository share, so every worktree of a project lands in
 * the same network: an agent opened in any project or worktree joins that project's network.
 */
export function detectNetworkDir(cwd: string): string | null {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString().trim();
  try {
    const common = resolve(cwd, git("rev-parse", "--path-format=absolute", "--git-common-dir"));
    // <main checkout>/.git for a repository and its worktrees; otherwise (a submodule) the current checkout
    const root = basename(common) === ".git" ? dirname(common) : git("rev-parse", "--show-toplevel");
    return root ? join(root, ".agent-network") : null;
  } catch {
    return null; // not a repository (or a bare one), or no git
  }
}

/**
 * Operator commands: --network-dir, else NETWORK_DIR, else `fallback` (e.g. "networkDir" of the runners config), else the
 * git repository around `cwd`. "auto" anywhere means the repository too. `detected`: the path came from git.
 */
export function pickNetworkDir(flag: string | undefined, env: NodeJS.ProcessEnv, cwd: string, fallback?: string): { dir: string | null; detected: boolean } {
  const given = flag || env.NETWORK_DIR || fallback;
  if (given && given !== AUTO) return { dir: given, detected: false };
  return { dir: detectNetworkDir(cwd), detected: true };
}
