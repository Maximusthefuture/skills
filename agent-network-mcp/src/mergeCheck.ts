import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildTools, DEFAULT_BUILD_TIMEOUT_MIN, parseBuildCommand, runBuild, type BuildRun } from "./build.js";
import { AppError, isAppError } from "./errors.js";
import { mergeMessage } from "./service.js";
import type { FileStore } from "./storage/fileStore.js";
import type { Task } from "./types.js";
import { commitMerge, mergePreflight, type MergeResult, type MergeStrategy } from "./worktrees.js";

/**
 * «Влить в проект» with a check: the merge is built first in a worktree of its own on the project's HEAD, the task's
 * verifyCommand runs on that commit, and only a green one reaches the project — by moving its branch to that very
 * commit (fast-forward), so "verify green" is about exactly what landed. Nothing in the project changes until then.
 * A red build or a conflict leaves the project as it was; the candidate is kept in refs/agent-network/merge/<task> for a
 * follow-up task that starts from it.
 */

export type MergeCheckStatus = "running" | "green" | "red" | "conflict" | "stale" | "error" | "interrupted";

export interface MergeCheck {
  taskId: string;
  status: MergeCheckStatus;
  branch: string;
  into: string;
  strategy: MergeStrategy;
  /** The project's HEAD the merge was built on. */
  base: string;
  /** The merge commit that was checked (absent on a conflict). */
  candidate?: string;
  startedAt: string;
  finishedAt?: string;
  /** Where it is while running: building the merge, installing dependencies, the build itself. */
  step?: "merge" | "setup" | "build" | "land";
  setup?: { command: string; ok: boolean; summary?: string }[];
  build?: { command: string; ok: boolean; exitCode: number | null; timedOut: boolean; durationMs: number; tests?: { total: number; failed: number }; summary: string; log?: string };
  /** A conflict: the files. */
  files?: string[];
  error?: string;
  /** Started by «Принять и влить»: a green check also records the operator's acceptance. */
  accept?: true;
  /** The task's API contract (contract.ts), merged into its own repository before the service. */
  scope?: "contract";
  /** The build it ran: the task's verifyCommand, or the contract project's own. */
  command?: string;
  /** The follow-up task the operator handed it to. */
  followUp?: string;
  /** green: the commit now in the project. */
  merged?: string;
}

const git = (cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> =>
  new Promise((done) => execFile("git", args, { cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => done({ ok: !e, out: String(out), err: String(err || (e ? e.message : "")) })));

/** The dependencies a fresh worktree lacks, by the project's lockfile: node_modules for npm, yarn, pnpm; Maven and Gradle need none. */
export function defaultMergeSetup(project: string): string[] {
  const has = (f: string) => existsSync(join(project, f));
  if (has("pnpm-lock.yaml")) return ["pnpm install --frozen-lockfile"];
  if (has("yarn.lock")) return ["yarn install --frozen-lockfile"];
  if (has("package-lock.json") || has("npm-shrinkwrap.json")) return ["npm ci"];
  if (has("package.json")) return ["npm install"];
  return [];
}

export const mergeRef = (taskId: string, scope?: "contract"): string => `refs/agent-network/merge/${taskId}${scope ? `-${scope}` : ""}`;

export interface MergeCheckerOptions {
  /** Setup commands (build tools only, no shell) run in the worktree before the build; default: by the lockfile. */
  setup?: string[];
  timeoutMs?: number;
  /**
   * Records the landed merge on the task (the operator's mergeTask), calling `move` under the task's lock to move the
   * project's branch. Separate from the checker so it never writes task.json itself.
   */
  land: (task: Task, input: { project: string; branch: string; strategy: MergeStrategy; verified: NonNullable<MergeCheck["build"]>; accept: boolean; scope?: "contract" }, move: () => Promise<MergeResult>) => Promise<void>;
  /** After a green check is over (its worktree gone): the contract's merge goes on with the service's. */
  after?: (check: MergeCheck) => Promise<void>;
}

export class MergeChecker {
  private running: { taskId: string; scope?: "contract"; done: Promise<void> } | null = null;

  constructor(private readonly fs: FileStore, private readonly opts: MergeCheckerOptions) {}

  private path(taskId: string, scope?: "contract"): string[] {
    return ["tasks", taskId, `merge-check${scope ? `-${scope}` : ""}.json`];
  }

  async get(taskId: string, scope?: "contract"): Promise<MergeCheck | null> {
    const c = await this.fs.readJson<MergeCheck>(this.path(taskId, scope));
    // a check this process is not running was cut off by a restart of the page
    if (c?.status === "running" && (this.running?.taskId !== taskId || this.running.scope !== scope)) return { ...c, status: "interrupted" };
    return c;
  }

  private async save(check: MergeCheck): Promise<MergeCheck> {
    await this.fs.writeJson(this.path(check.taskId, check.scope), check);
    return check;
  }

  /** The check in progress finishes (tests and shutdown). */
  async idle(): Promise<void> {
    await this.running?.done;
  }

  /**
   * Starts the check of a DONE task's merge and returns at once: running, or conflict when the merge cannot be built.
   * Its work already in the project: null (there is nothing to check; the caller records it as merged).
   */
  async start(task: Task, input: { project: string; branch: string; strategy: MergeStrategy; accept?: boolean; verifyCommand?: string; scope?: "contract" }): Promise<MergeCheck | null> {
    const command = input.verifyCommand ?? task.verifyCommand;
    if (!command) throw new AppError("INVALID_INPUT", `${task.id} has no verifyCommand: there is nothing to check the merge with`);
    if (this.running) {
      // a check whose result is written may still be cleaning up its worktree: a new one waits for that, not the operator
      const last = await this.fs.readJson<MergeCheck>(this.path(this.running.taskId, this.running.scope));
      if (last?.status === "running") throw new AppError("MERGE_CHECK_RUNNING", `The merge of ${this.running.taskId} is being checked; one check at a time — wait for it`);
      await this.running.done;
    }
    const base: Omit<MergeCheck, "status" | "base" | "into"> = {
      taskId: task.id, branch: input.branch, strategy: input.strategy, startedAt: new Date().toISOString(), command,
      ...(input.accept ? { accept: true as const } : {}), ...(input.scope ? { scope: input.scope } : {}),
    };
    let pre: Awaited<ReturnType<typeof mergePreflight>>;
    try {
      pre = await mergePreflight(input.project, input.branch);
    } catch (e) {
      if (isAppError(e) && e.code === "MERGE_CONFLICT") {
        const head = (await git(input.project, ["rev-parse", "HEAD"])).out.trim();
        const into = (await git(input.project, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim();
        return this.save({ ...base, status: "conflict", base: head, into, files: (e.details?.files as string[] | undefined) ?? [], finishedAt: new Date().toISOString() });
      }
      throw e;
    }
    if (pre.already) return null;
    const check = await this.save({ ...base, status: "running", step: "merge", base: pre.head, into: pre.into });
    const done = this.run(task, { ...input, command }, check)
      .finally(() => {
        this.running = null;
      })
      .then(async () => {
        const last = await this.fs.readJson<MergeCheck>(this.path(task.id, input.scope));
        if (last?.status === "green") await this.opts.after?.(last);
      })
      .catch(() => undefined);
    this.running = { taskId: task.id, ...(input.scope ? { scope: input.scope } : {}), done };
    return check;
  }

  private async run(task: Task, input: { project: string; branch: string; strategy: MergeStrategy; command: string; scope?: "contract" }, check: MergeCheck): Promise<void> {
    const dir = `${input.project}-merge-${task.id}`;
    const finish = (patch: Partial<MergeCheck>) => this.save({ ...check, ...patch, step: undefined, finishedAt: new Date().toISOString() } as MergeCheck);
    try {
      await removeWorktree(input.project, dir);
      const add = await git(input.project, ["worktree", "add", "--detach", dir, check.base]);
      if (!add.ok) throw new AppError("INVALID_INPUT", `Cannot create the worktree ${dir}: ${add.err.trim().slice(0, 300)}`);
      await commitMerge(dir, input.branch, mergeMessage(task, input.branch, input.strategy), input.strategy);
      check.candidate = (await git(dir, ["rev-parse", "HEAD"])).out.trim();
      await git(input.project, ["update-ref", mergeRef(task.id, input.scope), check.candidate]);

      const timeoutMs = this.opts.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MIN * 60_000;
      check.setup = [];
      for (const command of this.opts.setup ?? defaultMergeSetup(input.project)) {
        await this.save({ ...check, step: "setup" });
        const r = await runBuild({ cwd: dir, argv: parseBuildCommand(command, buildTools()).argv, timeoutMs });
        check.setup.push({ command, ok: r.ok, ...(r.ok ? {} : { summary: r.summary }) });
        if (!r.ok) {
          await finish({ status: "error", error: `${command} failed in the merge's worktree: the build could not be checked` });
          return;
        }
      }

      await this.save({ ...check, step: "build" });
      const run = await runBuild({ cwd: dir, argv: parseBuildCommand(input.command, buildTools()).argv, timeoutMs });
      check.build = await this.keepLog(task.id, dir, input.command, run, input.scope);
      if (!run.ok) {
        await finish({ status: "red" });
        return;
      }

      await this.save({ ...check, step: "land" });
      try {
        await this.opts.land(task, { project: input.project, branch: input.branch, strategy: input.strategy, verified: check.build, accept: !!check.accept, ...(input.scope ? { scope: input.scope } : {}) }, () => fastForward(input.project, check));
      } catch (e) {
        if (isAppError(e) && e.code === "MERGE_STALE") {
          await finish({ status: "stale", error: e.message });
          return;
        }
        throw e;
      }
      await finish({ status: "green", merged: check.candidate });
    } catch (e) {
      await finish({ status: "error", error: (e as Error).message.slice(0, 1000) });
    } finally {
      await removeWorktree(input.project, dir);
    }
  }

  /** The build's log goes with the task: the worktree it was written in is removed. */
  private async keepLog(taskId: string, dir: string, command: string, run: BuildRun, scope?: "contract"): Promise<NonNullable<MergeCheck["build"]>> {
    const into = join(this.fs.root, "tasks", taskId, "merge-check");
    await mkdir(into, { recursive: true });
    const name = `build${scope ? `-${scope}` : ""}.log`;
    const log = join(into, name);
    const kept = await copyFile(join(dir, run.logPath), log).then(() => true, () => false);
    const keptAt = `tasks/${taskId}/merge-check/${name}`;
    // the summary names the log where the build wrote it: in the worktree that is about to go
    const summary = run.summary.split(run.logPath).join(kept ? `.agent-network/${keptAt} (in the project)` : "(not kept)");
    return {
      command, ok: run.ok, exitCode: run.exitCode, timedOut: run.timedOut, durationMs: run.durationMs,
      ...(run.tests ? { tests: run.tests } : {}), summary: summary.slice(0, 4000), ...(kept ? { log: keptAt } : {}),
    };
  }

  /** The operator handed a red or conflicting merge to a follow-up task. */
  async handedTo(taskId: string, followUp: string, scope?: "contract"): Promise<void> {
    const c = await this.fs.readJson<MergeCheck>(this.path(taskId, scope));
    if (c) await this.save({ ...c, followUp });
  }
}

/**
 * The checked commit into the project: only while the project is where the check started (its branch, its HEAD, clean),
 * by moving the branch to that very commit — no new merge, no second build.
 */
async function fastForward(project: string, check: MergeCheck): Promise<MergeResult> {
  const into = (await git(project, ["symbolic-ref", "--short", "-q", "HEAD"])).out.trim();
  const head = (await git(project, ["rev-parse", "HEAD"])).out.trim();
  if (into !== check.into || head !== check.base) {
    throw new AppError("MERGE_STALE", `The project moved while the merge was checked (${check.into} at ${check.base.slice(0, 7)} → ${into || "no branch"} at ${head.slice(0, 7)}): nothing was changed; check it again`);
  }
  const dirty = (await git(project, ["status", "--porcelain", "--untracked-files=no"])).out.trim();
  if (dirty) throw new AppError("MERGE_STALE", `${project} has uncommitted changes now: nothing was changed; commit or stash them and check again`);
  const r = await git(project, ["merge", "--ff-only", check.candidate!]);
  if (!r.ok) throw new AppError("INVALID_INPUT", `git merge --ff-only ${check.candidate!.slice(0, 7)} failed: ${(r.err || r.out).trim().slice(0, 300)}`);
  return { commit: check.candidate!, already: false, into, strategy: check.strategy };
}

async function removeWorktree(project: string, dir: string): Promise<void> {
  await git(project, ["worktree", "remove", "--force", dir]);
  await rm(dir, { recursive: true, force: true });
  await git(project, ["worktree", "prune"]);
}
