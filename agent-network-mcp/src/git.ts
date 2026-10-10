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
