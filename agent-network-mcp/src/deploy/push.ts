import { execFile } from "node:child_process";
import { AppError } from "../errors.js";

/**
 * Pushes the commit a task was merged as to its own branch in Bitbucket, over SSH with the operator's own git
 * credentials (ssh-agent, ~/.ssh): agent-network keeps no Bitbucket token. Never a force push: a branch that moved on
 * in Bitbucket is refused by git and reported. BatchMode keeps ssh from waiting for a password nobody types.
 */

export interface PushResult {
  remoteUrl: string;
  branch: string;
  commit: string;
  /** Commits that were not in the remote before (the merged task plus anything local not pushed yet), newest first. */
  commits: { sha: string; subject: string }[];
  /** git's own words about the push. */
  output: string;
  webUrl: string | null;
}

export type Git = (cwd: string, args: string[], timeoutMs?: number) => Promise<{ ok: boolean; out: string; err: string }>;

export const runGit: Git = (cwd, args, timeoutMs = 120_000) =>
  new Promise((resolve) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=15" };
    execFile("git", args, { cwd, env, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (e, out, err) => resolve({ ok: !e, out: String(out), err: String(err) || (e ? e.message : "") }));
  });

/** {task} {change} {slug} {env} put into the branch template. */
const RU: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };

export function branchName(template: string, v: { task: string; change?: string; title: string; env: string }): string {
  const slug = [...v.title.toLowerCase()].map((c) => RU[c] ?? c).join("").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "") || v.task;
  return template.replaceAll("{task}", v.task).replaceAll("{change}", v.change ?? slug).replaceAll("{slug}", slug).replaceAll("{env}", v.env);
}

/** A link to the branch: the operator's template, or bitbucket.org's own address made from the remote URL. */
export function branchWebUrl(remoteUrl: string, branch: string, template?: string): string | null {
  if (template) return template.replaceAll("{branch}", encodeURIComponent(branch));
  const cloud = /bitbucket\.org[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  return cloud ? `https://bitbucket.org/${cloud[1]}/${cloud[2]}/branch/${encodeURIComponent(branch)}` : null;
}

export async function pushTask(
  projectDir: string,
  input: { remote: string; branch: string; commit: string; webUrlTemplate?: string },
  git: Git = runGit,
): Promise<PushResult> {
  const url = await git(projectDir, ["remote", "get-url", input.remote]);
  if (!url.ok) throw new AppError("PUSH_FAILED", `No git remote "${input.remote}" in ${projectDir}: add it (git remote add ${input.remote} <ssh address of the Bitbucket repository>) or name another in the settings`);
  const remoteUrl = url.out.trim();
  if (!(await git(projectDir, ["check-ref-format", "--branch", input.branch])).ok) throw new AppError("PUSH_FAILED", `"${input.branch}" is not a valid branch name: change the branch template in the settings`);
  if (!(await git(projectDir, ["cat-file", "-e", `${input.commit}^{commit}`])).ok) throw new AppError("PUSH_FAILED", `Commit ${input.commit.slice(0, 7)} is not in ${projectDir}`);
  const fetch = await git(projectDir, ["fetch", "--quiet", input.remote]);
  if (!fetch.ok) throw new AppError("PUSH_FAILED", `git fetch ${input.remote} failed — is the SSH key loaded (ssh-add -l) and the address right (${remoteUrl})?\n${fetch.err.trim().slice(0, 600)}`);
  const log = await git(projectDir, ["log", "--format=%H %s", "-50", input.commit, "--not", `--remotes=${input.remote}`]);
  const commits = log.out.split("\n").filter(Boolean).map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
  const push = await git(projectDir, ["push", "--porcelain", input.remote, `${input.commit}:refs/heads/${input.branch}`]);
  const output = `${push.out}\n${push.err}`.trim().slice(0, 4000);
  if (!push.ok) {
    const rejected = /rejected|non-fast-forward|fetch first/i.test(output);
    throw new AppError("PUSH_FAILED", rejected
      ? `Bitbucket refused the push: ${input.branch} there has commits this one does not (someone pushed to it). Nothing was forced; look at the branch, or change the branch template.\n${output}`
      : `git push to ${input.remote} failed:\n${output}`);
  }
  return { remoteUrl, branch: input.branch, commit: input.commit, commits, output, webUrl: branchWebUrl(remoteUrl, input.branch, input.webUrlTemplate) };
}
