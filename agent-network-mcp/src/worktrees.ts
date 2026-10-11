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
