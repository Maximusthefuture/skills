import { execFile } from "node:child_process";
import type { FileStore } from "./storage/fileStore.js";
import { EventStore } from "./stores/eventStore.js";
import { SubtaskStore } from "./stores/subtaskStore.js";

/** HEAD and the uncommitted changes of a git folder ("" when it is no git folder): tells whether a session changed anything. */
export function gitState(cwd: string | undefined): Promise<string> {
  const git = (args: string[]) =>
    new Promise<string>((done) => execFile("git", args, { cwd, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => done(err ? "" : out)));
  return Promise.all([git(["rev-parse", "HEAD"]), git(["status", "--porcelain"]), git(["diff", "HEAD"])]).then(([head, status, diff]) => `${head.trim()}|${status}|${diff.length}:${hash(diff)}`);
}

/**
 * The state of an agent's git folder for the top of its prompt: the latest commits and the uncommitted files, so a fresh
 * session does not spend turns (and context) on git log and git status. "" when it is no git folder.
 */
export async function workBrief(cwd: string | undefined, maxFiles = 25): Promise<string> {
  const git = (args: string[]) =>
    new Promise<string | null>((done) => execFile("git", args, { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => done(err ? null : out)));
  const [branch, log, status] = await Promise.all([git(["branch", "--show-current"]), git(["log", "--oneline", "-5"]), git(["status", "--short"])]);
  if (log === null || status === null) return "";
  const files = status.split("\n").filter((l) => l.trim());
  const shown = files.slice(0, maxFiles);
  return [
    `Branch ${branch?.trim() || "(detached)"}, latest commits:`,
    ...log.trim().split("\n").map((l) => `  ${l}`),
    files.length ? `Not committed (${files.length} file${files.length === 1 ? "" : "s"}):` : "Nothing uncommitted.",
    ...shown.map((l) => `  ${l}`),
    ...(files.length > shown.length ? [`  … and ${files.length - shown.length} more`] : []),
  ].join("\n");
}

/** How many files of a git folder are changed and not committed (0 when it is no git folder). */
export function uncommittedCount(cwd: string | undefined): Promise<number> {
  return new Promise((done) =>
    execFile("git", ["status", "--porcelain"], { cwd, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => done(err ? 0 : out.split("\n").filter((l) => l.trim()).length)),
  );
}

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

/**
 * What an agent has done on a task so far: its checklist, the events it caused (messages, proposals, reports) and its
 * work on disk (a new commit or changed files count even when it ticked nothing yet). Two equal marks = no progress
 * in between: the runner uses it for sessions that hit their turn limit, the supervisor for agents that stall.
 */
export async function progressMark(fs: FileStore, taskId: string, agent: string, cwd: string | undefined): Promise<string> {
  const [list, evs, work] = await Promise.all([new SubtaskStore(fs).get(taskId, agent), new EventStore(fs).list(taskId), gitState(cwd)]);
  return JSON.stringify([list.items.map((i) => `${i.id}:${i.status}`), evs.filter((e) => e.event.sourceAgent === agent).length, work]);
}
