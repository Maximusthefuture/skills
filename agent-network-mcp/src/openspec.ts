import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./errors.js";

/**
 * An OpenSpec change (openspec/changes/<name>/: proposal, design, specs, tasks.md) as the agreed WHAT of a swarm task.
 * The change lives in the project folder next to the network directory (<project>/.agent-network). Reading is done here,
 * without the openspec CLI; only archiving runs the CLI, because it merges the change's spec deltas into openspec/specs.
 */

export interface SpecTask {
  /** The task number from tasks.md, e.g. "2.3". */
  id: string;
  text: string;
  done: boolean;
  /** The "## N. ..." heading the task is under. */
  group?: string;
}

export interface ChangeInfo {
  name: string;
  /** Project-relative: openspec/changes/<name>. */
  path: string;
  /** Project-relative paths of the change's documents (proposal.md, design.md, tasks.md, specs/**). */
  files: string[];
  tasks: SpecTask[];
}

export interface ChangeSummary {
  name: string;
  done: number;
  total: number;
  /** tasks.md is missing or cannot be parsed. */
  error?: string;
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;
const CHECKBOX = /^[-*]\s+\[([ xX])\]\s+(.*)$/;
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/;
const GROUP = /^#{2,}\s+(.+?)\s*$/;

export const changePath = (name: string): string => `openspec/changes/${name}`;

export function assertChangeName(name: unknown): string {
  if (typeof name !== "string" || !NAME.test(name)) {
    throw new AppError("INVALID_INPUT", `Not an OpenSpec change name: ${JSON.stringify(name)} (the folder name in openspec/changes, e.g. add-multi-currency)`);
  }
  return name;
}

/**
 * The tasks of tasks.md: top-level checkbox lines "- [ ] 1.1 text" / "- [x] 1.1 text". Indented checkboxes are details
 * of the task above and are skipped. Every task needs a number: agents split the change and report by these numbers.
 */
export function parseTasks(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  let group: string | undefined;
  markdown.split(/\r?\n/).forEach((line, i) => {
    const heading = GROUP.exec(line);
    if (heading) {
      group = heading[1];
      return;
    }
    const box = CHECKBOX.exec(line);
    if (!box) return;
    const numbered = NUMBERED.exec(box[2]!.trim());
    if (!numbered) {
      throw new AppError("INVALID_INPUT", `tasks.md line ${i + 1}: a task without a number ("${box[2]!.trim().slice(0, 60)}"); number the tasks like "1.1"`);
    }
    const id = numbered[1]!;
    if (tasks.some((t) => t.id === id)) throw new AppError("INVALID_INPUT", `tasks.md line ${i + 1}: task ${id} appears twice`);
    tasks.push({ id, text: numbered[2]!.trim(), done: box[1] !== " ", ...(group ? { group } : {}) });
  });
  return tasks;
}

async function listFiles(dir: string, rel: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) out.push(...(await listFiles(join(dir, e.name), `${rel}/${e.name}`)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(`${rel}/${e.name}`);
  }
  return out;
}

export async function readChange(projectDir: string, name: string): Promise<ChangeInfo> {
  assertChangeName(name);
  const path = changePath(name);
  let markdown: string;
  try {
    markdown = await readFile(join(projectDir, path, "tasks.md"), "utf8");
  } catch {
    throw new AppError("OPENSPEC_NOT_FOUND", `No OpenSpec change '${name}' in ${projectDir}: ${path}/tasks.md not found`);
  }
  const tasks = parseTasks(markdown);
  if (!tasks.length) throw new AppError("OPENSPEC_NOT_FOUND", `${path}/tasks.md has no tasks ("- [ ] 1.1 ..." lines)`);
  const top = ["proposal.md", "design.md", "tasks.md"].map((f) => `${path}/${f}`);
  const present = (await listFiles(join(projectDir, path), path)).filter((f) => !f.startsWith(`${path}/specs/`));
  return {
    name,
    path,
    files: [...top.filter((f) => present.includes(f)), ...(await listFiles(join(projectDir, path, "specs"), `${path}/specs`))],
    tasks,
  };
}

/** Does `dir` (e.g. an agent's worktree) have the change's tasks.md? */
export async function hasChange(dir: string, name: string): Promise<boolean> {
  return readFile(join(dir, changePath(assertChangeName(name)), "tasks.md"), "utf8").then(
    () => true,
    () => false,
  );
}

/** The changes in progress (openspec/changes/*, without the archive), with their task progress; [] without OpenSpec. */
export async function listChanges(projectDir: string): Promise<ChangeSummary[]> {
  const entries = await readdir(join(projectDir, "openspec", "changes"), { withFileTypes: true }).catch(() => []);
  const names = entries.filter((e) => e.isDirectory() && e.name !== "archive" && NAME.test(e.name)).map((e) => e.name).sort();
  return Promise.all(
    names.map(async (name) => {
      try {
        const tasks = parseTasks(await readFile(join(projectDir, changePath(name), "tasks.md"), "utf8"));
        return { name, done: tasks.filter((t) => t.done).length, total: tasks.length };
      } catch (e) {
        return { name, done: 0, total: 0, error: e instanceof AppError ? e.message : "tasks.md not found" };
      }
    }),
  );
}

export type Exec = (cmd: string, args: string[], opts: { cwd: string; timeout: number }) => Promise<{ stdout: string; stderr: string }>;

const execCli: Exec = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    // the CLI is a Node program: its ExperimentalWarning lines are noise in the output shown on the page
    execFile(cmd, args, { ...opts, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: "1" } }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
  });

const tail = (s: string, n = 2000): string => (s.length > n ? `…${s.slice(-n)}` : s);

/** `openspec archive <name> -y` in the project: moves the change to openspec/changes/archive and updates openspec/specs. */
export async function archiveChange(projectDir: string, name: string, exec: Exec = execCli): Promise<string> {
  assertChangeName(name);
  try {
    const { stdout, stderr } = await exec("openspec", ["--no-color", "archive", name, "-y"], { cwd: projectDir, timeout: 120_000 });
    return tail(`${stdout}${stderr}`.trim());
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (err.code === "ENOENT") throw new AppError("OPENSPEC_FAILED", `The openspec CLI is not on PATH: run \`openspec archive ${name}\` in ${projectDir} yourself`);
    throw new AppError("OPENSPEC_FAILED", `openspec archive ${name} failed: ${tail(`${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message, 1500)}`);
  }
}
