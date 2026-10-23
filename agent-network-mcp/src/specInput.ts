import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppError } from "./errors.js";

/**
 * Analysts' artifacts a change-writing task starts from (task create --propose <name> --from <path>): Markdown files the
 * operator points at anywhere on disk. They are copied once into the task folder (tasks/<id>/input/), so the task does not
 * depend on the operator's folder, and from there into each agent's own folder (<cwd>/.agent-network/input/<task>/),
 * which git ignores: they never end up in the project.
 */

export const MAX_INPUT_FILES = 40;
export const MAX_INPUT_FILE_BYTES = 200_000;
export const MAX_INPUT_BYTES = 1_000_000;

export interface InputFile {
  /** Where the file is copied to, relative to the input folder: the file name, or <folder>/<path in it>. */
  rel: string;
  abs: string;
}

async function walk(dir: string, prefix: string, out: InputFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) await walk(abs, `${prefix}/${e.name}`, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push({ rel: `${prefix}/${e.name}`, abs });
  }
}

/** The .md files the given paths name (a file, or every .md under a folder), checked against the limits. */
export async function collectInput(paths: string[], baseDir: string): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const raw of paths.map((p) => p.trim()).filter(Boolean)) {
    const abs = resolve(baseDir, raw.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    const st = await stat(abs).catch(() => null);
    if (!st) throw new AppError("INVALID_INPUT", `--from ${raw}: no such file or folder`);
    if (st.isDirectory()) {
      const found: InputFile[] = [];
      await walk(abs, basename(abs), found);
      if (!found.length) throw new AppError("INVALID_INPUT", `--from ${raw}: the folder has no .md files`);
      out.push(...found);
    } else if (abs.toLowerCase().endsWith(".md")) out.push({ rel: basename(abs), abs });
    else throw new AppError("INVALID_INPUT", `--from ${raw}: only Markdown files (.md) or folders with them`);
  }
  if (!out.length) throw new AppError("INVALID_INPUT", "--from: no files given");
  const seen = new Set<string>();
  for (const f of out) {
    if (seen.has(f.rel)) throw new AppError("INVALID_INPUT", `--from: two files would both be ${f.rel}; pass their folder instead`);
    seen.add(f.rel);
  }
  if (out.length > MAX_INPUT_FILES) throw new AppError("INVALID_INPUT", `--from: ${out.length} files, at most ${MAX_INPUT_FILES}`);
  let total = 0;
  for (const f of out) {
    const size = (await stat(f.abs)).size;
    if (size > MAX_INPUT_FILE_BYTES) throw new AppError("INVALID_INPUT", `--from: ${f.rel} is over ${MAX_INPUT_FILE_BYTES / 1000} KB`);
    total += size;
  }
  if (total > MAX_INPUT_BYTES) throw new AppError("INVALID_INPUT", `--from: ${Math.round(total / 1000)} KB in all, at most ${MAX_INPUT_BYTES / 1000} KB`);
  return out;
}

/** Copies the files into dir, keeping their relative names. */
export async function copyInput(files: InputFile[], dir: string): Promise<void> {
  for (const f of files) {
    const to = join(dir, ...f.rel.split("/"));
    if (!to.startsWith(dir + sep)) throw new AppError("INVALID_INPUT", `--from: ${f.rel} is not a plain file name`);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(f.abs, to);
  }
}

/**
 * The task's input in the agent's own folder: <cwd>/.agent-network/input/<task>/, copied from the task folder the first
 * time (git ignores .agent-network/). Returns the folder relative to cwd, or an absolute path when cwd is the network.
 */
export async function inputInWorkdir(networkRoot: string, taskId: string, rels: string[], cwd: string): Promise<string> {
  const from = join(networkRoot, "tasks", taskId, "input");
  const to = join(cwd, ".agent-network", "input", taskId);
  for (const rel of rels) {
    const target = join(to, ...rel.split("/"));
    if (await stat(target).then(() => true, () => false)) continue;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(from, ...rel.split("/")), target);
  }
  const r = relative(cwd, to);
  return isAbsolute(r) || r.startsWith("..") ? to : r.split(sep).join("/");
}

async function allFiles(dir: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) await allFiles(join(dir, e.name), `${rel}/${e.name}`, out);
    else if (e.isFile()) out.push(`${rel}/${e.name}`);
  }
}

/** What the change folder holds, as one hash: the page the operator accepted is about exactly these files. */
export async function changeHash(dir: string, changeDir: string): Promise<string> {
  const files: string[] = [];
  await allFiles(join(dir, changeDir), changeDir, files);
  const h = createHash("sha256");
  for (const f of files) {
    h.update(`${f}\0`);
    h.update(await readFile(join(dir, f)));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}
