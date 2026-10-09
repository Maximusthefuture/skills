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
