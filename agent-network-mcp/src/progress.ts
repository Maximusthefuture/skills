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
