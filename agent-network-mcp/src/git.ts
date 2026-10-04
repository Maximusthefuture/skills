import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "./errors.js";
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

export interface InspectedCommits {
  /** Full hashes, in the order given. */
  commits: string[];
  /** Files touched by those commits (merge commits contribute nothing), sorted. */
  files: string[];
}

/**
 * Verify commits reported by an agent and list the files they touch. Every commit must exist and, when the task
 * recorded a base commit, descend from it (i.e. be made for this task). Worktrees of one repository share the
 * object database, so commits made in any worktree resolve here.
 */
export async function inspectCommits(repo: string, base: string, commits: string[]): Promise<InspectedCommits> {
  const full: string[] = [];
  const files = new Set<string>();
  for (const c of commits) {
    const sha = await git(repo, "rev-parse", "--verify", "--quiet", `${c}^{commit}`).catch(() => "");
    if (!sha) throw new AppError("INVALID_INPUT", `Commit '${c}' does not exist in ${repo}. Commit your changes and pass the hashes from 'git log'.`);
    if (base) {
      const descends = sha !== base && (await git(repo, "merge-base", "--is-ancestor", base, sha).then(() => true, () => false));
      if (!descends) throw new AppError("INVALID_INPUT", `Commit '${c}' was not made on top of the task's base commit ${base.slice(0, 12)}. Report only commits you made for this task.`);
    }
    full.push(sha);
    const changed = await git(repo, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha);
    for (const f of changed.split("\n")) if (f) files.add(f);
  }
  return { commits: full, files: [...files].sort() };
}
