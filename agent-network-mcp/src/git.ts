import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitContext } from "./types.js";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, timeout: 5000 });
  return stdout.trim();
}

/** repository / branch / commit via Git CLI; null when `cwd` is not inside a git repository. */
export async function readGitContext(cwd: string): Promise<GitContext | null> {
  let repositoryRoot: string;
  try {
    repositoryRoot = await git(cwd, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
  const branch = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD").catch(() => "HEAD");
  const commit = await git(cwd, "rev-parse", "HEAD").catch(() => ""); // empty repo has no commits
  return { repositoryRoot, branch, commit };
}

/**
 * Is `commit` already in the branch checked out in `cwd`? true / false; null when git cannot tell
 * (not a repository, or a commit this repository does not know).
 */
export async function containsCommit(cwd: string, commit: string): Promise<boolean | null> {
  try {
    await run("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd, timeout: 5000 });
    return true;
  } catch (e) {
    return (e as { code?: unknown }).code === 1 ? false : null;
  }
}

/**
 * The commit checked out in `cwd` and whether the folder has changes git would commit (its own .agent-network/ build logs
 * left out); null when it is not a git repository.
 */
export async function workTreeState(cwd: string): Promise<{ head: string; dirty: number } | null> {
  try {
    const head = await git(cwd, "rev-parse", "HEAD");
    const status = await git(cwd, "status", "--porcelain", "--untracked-files=normal");
    const dirty = status.split("\n").filter((l) => l.trim() && !/^.. "?\.agent-network\//.test(l)).length;
    return { head, dirty };
  } catch {
    return null;
  }
}

/**
 * Files changed by the commits of the branch in `cwd` since `base`, not counting merges and the commits in `others` (work of
 * other agents merged in): what the agent itself changed, whatever it reports. null when git cannot tell.
 */
export async function filesChangedSince(cwd: string, base: string, others: string[] = []): Promise<string[] | null> {
  try {
    const known: string[] = [];
    for (const c of [base, ...others]) {
      if (await git(cwd, "rev-parse", "--verify", "--quiet", `${c}^{commit}`).then(() => true, () => false)) known.push(c);
    }
    if (!known.includes(base)) return null;
    const out = await git(cwd, "log", "--no-merges", "--name-only", "--pretty=format:", "HEAD", "--not", ...known);
    return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))].sort();
  } catch {
    return null;
  }
}

/**
 * A commit as the repository in `cwd` knows it: the full hash of a short or full one, null when git does not know it
 * (a hash the agent made up or mistyped); undefined when `cwd` is not a git repository.
 */
export async function resolveCommit(cwd: string, commit: string): Promise<string | null | undefined> {
  try {
    await git(cwd, "rev-parse", "--git-dir");
  } catch {
    return undefined;
  }
  return git(cwd, "rev-parse", "--verify", "--quiet", `${commit}^{commit}`).catch(() => null);
}
