import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { AppError } from "./errors.js";

/** An agent's own git worktree next to the project: <project>-<agent> on branch swarm-<agent>. */
export interface AgentWorktree {
  project: string;
  branch: string;
}

const git = (cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> =>
  new Promise((done) => execFile("git", args, { cwd, timeout: 30_000 }, (e, out, err) => done({ ok: !e, out: String(out), err: String(err || (e ? e.message : "")) })));

/** The root of the git repository a folder is in, or null. */
export async function gitRoot(dir: string): Promise<string | null> {
  const r = await git(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok ? r.out.trim() : null;
}

/**
 * Makes sure every agent that works in its own worktree has it: creates <project>-<agent> on branch swarm-<agent> from
 * the project's HEAD when the folder is missing (an existing branch is reused), and keeps the network folder out of
 * git (.git/info/exclude, no commit needed). Returns what it did, one line per created worktree.
 */
export async function ensureWorktrees(agents: { id: string; cwd?: string; worktree?: AgentWorktree }[]): Promise<string[]> {
  const done: string[] = [];
  const projects = new Set(agents.flatMap((a) => (a.worktree ? [a.worktree.project] : [])));
  for (const project of projects) {
    if (!existsSync(project)) throw new AppError("INVALID_CONFIG", `Project folder ${project} does not exist`);
    if (!(await git(project, ["rev-parse", "--verify", "HEAD"])).ok) {
      throw new AppError("INVALID_CONFIG", `${project} needs a git repository with at least one commit: the agents' worktrees branch off it (git init && git add . && git commit -m init)`);
    }
    // the network lives in the project folder: keep it out of git without touching .gitignore
    const common = (await git(project, ["rev-parse", "--git-common-dir"])).out.trim();
    const exclude = join(isAbsolute(common) ? common : resolve(project, common), "info", "exclude");
    const current = await readFile(exclude, "utf8").catch(() => "");
    if (!current.split("\n").some((l) => l.trim() === ".agent-network/" || l.trim() === ".agent-network")) {
      await appendFile(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}.agent-network/\n`).catch(() => undefined);
    }
  }
  for (const a of agents) {
    if (!a.worktree || !a.cwd) continue;
    if (existsSync(a.cwd)) {
      if (!(await gitRoot(a.cwd))) throw new AppError("INVALID_CONFIG", `${a.cwd} (agent ${a.id}) exists but is no git worktree: move it away or set the agent's "cwd"`);
      continue;
    }
    const { project, branch } = a.worktree;
    const known = (await git(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
    const r = await git(project, known ? ["worktree", "add", a.cwd, branch] : ["worktree", "add", a.cwd, "-b", branch]);
    if (!r.ok) throw new AppError("INVALID_CONFIG", `Cannot create the worktree of ${a.id} at ${a.cwd}: ${r.err.trim().slice(0, 300)}`);
    done.push(`${a.id}: ${a.cwd} (branch ${branch}${known ? ", existing" : ", new from HEAD"})`);
  }
  return done;
}

export interface MergeResult {
  strategy?: MergeStrategy;
  /** The merge commit, or HEAD when the branch was in it already. */
  commit: string;
  already: boolean;
  into: string;
}

/**
 * Merges `branch` into the project's current branch (no fast-forward, no push). Refused, with nothing changed, when the
 * project has uncommitted changes to tracked files, is on no branch, or the merge would conflict (checked first with
 * git merge-tree, which touches neither the index nor the files).
 */
export type MergeStrategy = "squash" | "merge";

/** Merging `branch` would change nothing in the project (its work is in HEAD, also after a squash). */
async function contentMerged(project: string, branch: string): Promise<boolean> {
  const tree = await git(project, ["merge-tree", "--write-tree", "HEAD", branch]);
  return tree.ok && tree.out.trim().split("\n")[0] === (await git(project, ["rev-parse", "HEAD^{tree}"])).out.trim();
}

/**
 * squash (default): the whole task as ONE commit on the project's branch — easy to read, and one `git revert` undoes it.
 * merge: a merge commit that keeps the agents' commits.
 */
export async function mergeBranch(project: string, branch: string, message: string, strategy: MergeStrategy = "squash"): Promise<MergeResult> {
  const pre = await mergePreflight(project, branch);
  if (pre.already) return { commit: pre.already, already: true, into: pre.into };
  await commitMerge(project, branch, message, strategy);
  return { commit: (await git(project, ["rev-parse", "HEAD"])).out.trim(), already: false, into: pre.into, strategy };
}

/**
 * What every merge into the project checks first: the branch exists, the project is on a branch and clean, the merge
 * would not conflict (git merge-tree touches neither the index nor the files). already: the branch's work is in HEAD.
 */
export async function mergePreflight(project: string, branch: string): Promise<{ into: string; head: string; already?: string }> {
  if (!(await git(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok) throw new AppError("INVALID_INPUT", `No branch ${branch} in ${project}`);
  const into = (await git(project, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim();
  if (!into) throw new AppError("INVALID_INPUT", `${project} is on no branch (detached HEAD): check out the branch to merge into first`);
  const dirty = (await git(project, ["status", "--porcelain", "--untracked-files=no"])).out.trim();
  if (dirty) throw new AppError("INVALID_INPUT", `${project} has uncommitted changes; commit or stash them first:\n${dirty.split("\n").slice(0, 10).join("\n")}`);
  const head = (await git(project, ["rev-parse", "HEAD"])).out.trim();
  if ((await git(project, ["merge-base", "--is-ancestor", branch, "HEAD"])).ok || (await contentMerged(project, branch))) return { into, head, already: head };
  const probe = await git(project, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", branch]);
  if (!probe.ok) {
    const files = probe.out.trim().split("\n").slice(1).filter(Boolean);
    if (files.length) throw new AppError("MERGE_CONFLICT", `${branch} conflicts with ${into} in: ${files.join(", ")}. Nothing was changed; merge by hand (git merge ${branch}) or let the lead merge ${into} into its branch first.`, { files });
    throw new AppError("INVALID_INPUT", `Cannot check the merge of ${branch}: ${probe.err.trim().slice(0, 300)}`);
  }
  return { into, head };
}

/** Makes the merge commit of `branch` on what `cwd` has checked out: the project itself, or a merge check's own worktree. */
export async function commitMerge(cwd: string, branch: string, message: string, strategy: MergeStrategy): Promise<void> {
  if (strategy === "merge") {
    const r = await git(cwd, ["merge", "--no-ff", "--no-edit", "-m", message, branch]);
    if (!r.ok) {
      await git(cwd, ["merge", "--abort"]);
      throw new AppError("INVALID_INPUT", `git merge ${branch} failed: ${(r.err || r.out).trim().slice(0, 400)}`);
    }
    return;
  }
  // the commits of the branch, listed in the one commit: what went in, without their history in the project
  const log = (await git(cwd, ["log", "--format=%h %s", `HEAD..${branch}`])).out.trim();
  const sq = await git(cwd, ["merge", "--squash", branch]);
  const c = sq.ok ? await git(cwd, ["commit", "-m", message, "-m", `Squashed from ${branch}:\n${log}`]) : sq;
  if (!c.ok) {
    await git(cwd, ["reset", "--merge"]);
    throw new AppError("INVALID_INPUT", `git merge --squash ${branch} failed: ${(c.err || c.out).trim().slice(0, 400)}`);
  }
}

/**
 * Undo a merged task: `git revert` of its commit (-m 1 for a merge commit), refused with nothing changed when the project
 * has uncommitted changes or the revert conflicts (later work touched the same lines).
 */
export async function revertCommit(project: string, commit: string, message: string): Promise<{ commit: string }> {
  const dirty = (await git(project, ["status", "--porcelain", "--untracked-files=no"])).out.trim();
  if (dirty) throw new AppError("INVALID_INPUT", `${project} has uncommitted changes; commit or stash them first`);
  const parents = (await git(project, ["rev-list", "--parents", "-n", "1", commit])).out.trim().split(" ").length - 1;
  if (parents < 1) throw new AppError("INVALID_INPUT", `No commit ${commit} in ${project}`);
  const r = await git(project, ["revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), commit]);
  if (!r.ok) {
    await git(project, ["revert", "--abort"]);
    throw new AppError("MERGE_CONFLICT", `Reverting ${commit.slice(0, 7)} conflicts with later changes; nothing was changed. Revert it by hand (git revert ${commit.slice(0, 7)}).`);
  }
  await git(project, ["commit", "--amend", "-m", message, "-m", `This reverts commit ${commit}.`]);
  return { commit: (await git(project, ["rev-parse", "HEAD"])).out.trim() };
}

export interface RemovedWorktree {
  id: string;
  path: string;
  removed: boolean;
  branchDeleted: boolean;
  /** Why something stayed. */
  note?: string;
}

/**
 * Removes the agents' auto worktrees and their branches, never by force: git keeps a worktree with changes (we say
 * which) and a branch not merged into the project's HEAD (its work would be lost). The runners create a missing
 * worktree again from the project's HEAD before their next session.
 */
export async function removeWorktrees(agents: { id: string; cwd?: string; worktree?: AgentWorktree }[]): Promise<RemovedWorktree[]> {
  const out: RemovedWorktree[] = [];
  for (const a of agents) {
    if (!a.worktree || !a.cwd) continue;
    const { project, branch } = a.worktree;
    const item: RemovedWorktree = { id: a.id, path: a.cwd, removed: false, branchDeleted: false };
    if (existsSync(a.cwd)) {
      const r = await git(project, ["worktree", "remove", a.cwd]);
      if (r.ok) item.removed = true;
      else item.note = `worktree kept: ${r.err.trim().split("\n").pop()?.replace(/^fatal: /, "")}`;
    } else {
      item.removed = true;
    }
    if (item.removed && (await git(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok) {
      let d = await git(project, ["branch", "-d", branch]);
      // squashed into the project: its commits are not ancestors of HEAD, but its work is all in it — safe to drop
      if (!d.ok && (await contentMerged(project, branch))) d = await git(project, ["branch", "-D", branch]);
      if (d.ok) item.branchDeleted = true;
      else item.note = `branch ${branch} kept: it is not merged into the project's branch (git branch -D ${branch} drops it)`;
    }
    out.push(item);
  }
  for (const project of new Set(agents.flatMap((a) => (a.worktree ? [a.worktree.project] : [])))) await git(project, ["worktree", "prune"]);
  return out;
}

export interface BranchDiff {
  /** Commits on the branch that the base lacks, newest first: "abc1234 subject" (at most MAX_COMMITS). */
  commits: string[];
  commitsTotal: number;
  /** Every changed file with its line counts; a file's diff comes separately (fileDiff). */
  files: { path: string; added: number; deleted: number; binary?: true }[];
}

const MAX_COMMITS = 500;
/** One file's diff is cut here: a generated file or a lock file can be megabytes. */
const MAX_FILE_DIFF = 300_000;

const rangeOf = (base: string, head: string, mode: "three-dot" | "two-dot") => (mode === "three-dot" ? `${base}...${head}` : `${base}..${head}`);

/**
 * What a branch changes against a base: "three-dot" = since the branch left the base (what a merge would bring),
 * "two-dot" = between two commits (e.g. a merge commit against its first parent). The list only: cheap for any size.
 */
export async function branchDiff(project: string, base: string, head: string, mode: "three-dot" | "two-dot"): Promise<BranchDiff> {
  const range = rangeOf(base, head, mode);
  const log = await git(project, ["log", "--format=%h %s", `${base}..${head}`, "--"]);
  if (!log.ok) throw new AppError("INVALID_INPUT", `Cannot read ${range}: ${log.err.trim().slice(0, 300)}`);
  const numstat = await new Promise<string>((done) =>
    execFile("git", ["diff", "--numstat", "--no-renames", range, "--"], { cwd: project, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (_e, out) => done(String(out))),
  );
  const files = numstat.split("\n").filter(Boolean).map((l) => {
    const [a, d, ...p] = l.split("\t");
    return { path: p.join("\t"), added: a === "-" ? 0 : Number(a), deleted: d === "-" ? 0 : Number(d), ...(a === "-" ? { binary: true as const } : {}) };
  });
  const commits = log.out.trim().split("\n").filter(Boolean);
  return { commits: commits.slice(0, MAX_COMMITS), commitsTotal: commits.length, files };
}

/** One file's unified diff in the same range, cut at MAX_FILE_DIFF characters. */
export async function fileDiff(project: string, base: string, head: string, mode: "three-dot" | "two-dot", path: string): Promise<{ path: string; patch: string; truncated: boolean }> {
  if (!path || path.startsWith("-")) throw new AppError("INVALID_INPUT", "file must be a path of the diff");
  const out = await new Promise<{ ok: boolean; text: string; err: string }>((done) =>
    execFile("git", ["diff", "--no-color", "--no-renames", rangeOf(base, head, mode), "--", path], { cwd: project, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (e, o, err) =>
      done({ ok: !e, text: String(o), err: String(err) }),
    ),
  );
  if (!out.ok) throw new AppError("INVALID_INPUT", `Cannot read the diff of ${path}: ${out.err.trim().slice(0, 300)}`);
  return { path, patch: out.text.slice(0, MAX_FILE_DIFF), truncated: out.text.length > MAX_FILE_DIFF };
}

/**
 * Before a session: the agent's own branch must hold the task's base (the project's commit the task started from), or the
 * agent works on old code and its earlier task's commits look like new work. Merges the base in when the folder is clean;
 * returns a line for the log when it did something or could not, null when the branch had it already.
 */
export async function catchUpBranch(cwd: string, base: string): Promise<string | null> {
  if (!(await git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`])).ok) return null; // another repository
  if ((await git(cwd, ["merge-base", "--is-ancestor", base, "HEAD"])).ok) return null;
  const short = base.slice(0, 7);
  if ((await git(cwd, ["status", "--porcelain", "--untracked-files=no"])).out.trim()) return `the branch lacks the task's base ${short}, but has uncommitted changes: not merged`;
  const r = await git(cwd, ["merge", "--no-edit", "-m", `Bring in the task's base ${short}`, base]);
  if (!r.ok) {
    await git(cwd, ["merge", "--abort"]);
    return `merging the task's base ${short} conflicts; nothing changed: ${(r.out || r.err).trim().split("\n").slice(-2).join(" ")}`;
  }
  return `merged the task's base ${short} into the branch`;
}

/**
 * Brings the project's current branch into an agent's own branch (git merge in its folder): the way a change merged into
 * the project reaches the agents that will implement it. Refused, with nothing changed, when the folder has uncommitted
 * changes or the merge conflicts (it is aborted).
 */
export async function mergeProjectInto(project: string, cwd: string): Promise<{ into: string; from: string; result: string }> {
  const from = (await git(project, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim();
  if (!from) throw new AppError("INVALID_INPUT", `${project} is on no branch (detached HEAD)`);
  const into = (await git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim() || "HEAD";
  const dirty = (await git(cwd, ["status", "--porcelain", "--untracked-files=no"])).out.trim();
  if (dirty) throw new AppError("INVALID_INPUT", `${cwd} has uncommitted changes; commit or stash them first`);
  const r = await git(cwd, ["merge", "--no-edit", from]);
  if (!r.ok) {
    await git(cwd, ["merge", "--abort"]);
    throw new AppError("MERGE_CONFLICT", `Merging ${from} into ${into} in ${cwd} conflicts; nothing was changed: ${(r.out || r.err).trim().split("\n").slice(-3).join(" ")}`);
  }
  return { into, from, result: /Already up to date/.test(r.out) ? "up to date" : /Fast-forward/.test(r.out) ? "fast-forward" : "merged" };
}
