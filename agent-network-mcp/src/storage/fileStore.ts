import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { AppError } from "../errors.js";
import { assertSafeSegment } from "../validation.js";

const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

export interface NumberedEntry {
  /** e.g. "msg-001" */
  id: string;
  seq: number;
  /** file name on disk, e.g. "msg-001.json" */
  name: string;
}

function isErrno(e: unknown, ...codes: string[]): boolean {
  return typeof e === "object" && e !== null && "code" in e && codes.includes((e as NodeJS.ErrnoException).code ?? "");
}

export function formatSeq(seq: number): string {
  return String(seq).padStart(3, "0");
}

/**
 * Filesystem primitives for the network directory. The filesystem is the source of truth:
 * - overwrites go through temp file + atomic rename;
 * - unique ids are allocated with an exclusive create (link / mkdir fail with EEXIST), so
 *   several MCP processes can create files concurrently without a shared index file;
 * - every path is built from validated segments and must stay inside the root.
 */
export class FileStore {
  private constructor(readonly root: string) {}

  static async open(rootDir: string): Promise<FileStore> {
    if (!isAbsolute(rootDir)) throw new AppError("INVALID_CONFIG", "Network directory must be absolute");
    const abs = resolve(rootDir);
    await fs.mkdir(abs, { recursive: true });
    const real = await fs.realpath(abs);
    return new FileStore(real);
  }

  /** Resolve segments to an absolute path, guaranteeing it stays inside the root. */
  resolve(segments: readonly string[]): string {
    for (const s of segments) assertSafeSegment(s);
    const full = resolve(join(this.root, ...segments));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new AppError("INVALID_INPUT", "Path escapes the network directory");
    }
    return full;
  }

  async ensureDir(segments: readonly string[]): Promise<void> {
    await fs.mkdir(this.resolve(segments), { recursive: true });
  }

  async exists(segments: readonly string[]): Promise<boolean> {
    try {
      await fs.access(this.resolve(segments), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async readJson<T>(segments: readonly string[]): Promise<T | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.resolve(segments), "utf8");
    } catch (e) {
      if (isErrno(e, "ENOENT", "ENOTDIR")) return null;
      throw e;
    }
    return JSON.parse(raw) as T;
  }

  /** Write (or overwrite) a JSON document atomically: temp file in the same dir, then rename. */
  async writeJson(segments: readonly string[], value: unknown): Promise<void> {
    const target = this.resolve(segments);
    await fs.mkdir(join(target, ".."), { recursive: true });
    const tmp = await this.writeTemp(target, value);
    try {
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }

  /** Create a JSON document only if it does not exist yet. Returns false if it already exists. */
  async createJson(segments: readonly string[], value: unknown): Promise<boolean> {
    const target = this.resolve(segments);
    await fs.mkdir(join(target, ".."), { recursive: true });
    const tmp = await this.writeTemp(target, value);
    try {
      await fs.link(tmp, target); // atomic, fails with EEXIST if target exists
      return true;
    } catch (e) {
      if (isErrno(e, "EEXIST")) return false;
      throw e;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /**
   * Allocate the next `<prefix>-NNN.json` in a directory and write `build(id, seq)` into it.
   * Concurrent creators never overwrite each other: the loser of a race retries with the next number.
   */
  async createNumbered<T>(
    dir: readonly string[],
    prefix: string,
    build: (id: string, seq: number) => T,
  ): Promise<T> {
    await this.ensureDir(dir);
    let seq = ((await this.listNumbered(dir, prefix)).at(-1)?.seq ?? 0) + 1;
    for (;;) {
      const id = `${prefix}-${formatSeq(seq)}`;
      const value = build(id, seq);
      if (await this.createJson([...dir, `${id}.json`], value)) return value;
      seq += 1;
    }
  }

  /** Create the next `<prefix>-NNN` directory (mkdir is atomic). Returns its id. */
  async createNumberedDir(dir: readonly string[], prefix: string): Promise<string> {
    await this.ensureDir(dir);
    let seq = ((await this.listNumberedDirs(dir, prefix)).at(-1)?.seq ?? 0) + 1;
    for (;;) {
      const id = `${prefix}-${formatSeq(seq)}`;
      try {
        await fs.mkdir(this.resolve([...dir, id]));
        return id;
      } catch (e) {
        if (!isErrno(e, "EEXIST")) throw e;
        seq += 1;
      }
    }
  }

  async listNumbered(dir: readonly string[], prefix: string): Promise<NumberedEntry[]> {
    const re = new RegExp(`^${prefix}-(\\d+)\\.json$`);
    return this.listMatching(dir, re, (m, name) => ({ id: `${prefix}-${m[1]}`, seq: Number(m[1]), name }));
  }

  async listNumberedDirs(dir: readonly string[], prefix: string): Promise<NumberedEntry[]> {
    const re = new RegExp(`^${prefix}-(\\d+)$`);
    return this.listMatching(dir, re, (m, name) => ({ id: name, seq: Number(m[1]), name }));
  }

  /** `<name>.json` files whose name matches `^[A-Za-z0-9][A-Za-z0-9_-]*\.json$` (temp files never match). */
  async listJsonNames(dir: readonly string[]): Promise<string[]> {
    const re = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.json$/;
    const entries = await this.listMatching(dir, re, (m) => m[1] as string);
    return entries.sort();
  }

  private async listMatching<R>(
    dir: readonly string[],
    re: RegExp,
    map: (m: RegExpMatchArray, name: string) => R,
  ): Promise<R[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.resolve(dir));
    } catch (e) {
      if (isErrno(e, "ENOENT", "ENOTDIR")) return [];
      throw e;
    }
    const out: R[] = [];
    for (const name of names) {
      const m = name.match(re);
      if (m) out.push(map(m, name));
    }
    return out.sort((a, b) => {
      const sa = (a as { seq?: number }).seq;
      const sb = (b as { seq?: number }).seq;
      return sa !== undefined && sb !== undefined ? sa - sb : 0;
    });
  }

  /**
   * Cross-process mutex built on mkdir. Used only for read-modify-write of task state
   * (agreement approvals, implementation status, phase transitions). Stale locks left by
   * crashed processes are broken after LOCK_STALE_MS.
   */
  async withLock<T>(lockDir: readonly string[], fn: () => Promise<T>): Promise<T> {
    const path = this.resolve(lockDir);
    await fs.mkdir(join(path, ".."), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        await fs.mkdir(path);
        break;
      } catch (e) {
        if (!isErrno(e, "EEXIST")) throw e;
        await this.breakStaleLock(path);
        if (Date.now() > deadline) throw new AppError("LOCK_TIMEOUT", "Timed out waiting for task lock, try again");
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(path, { recursive: true, force: true });
    }
  }

  private async breakStaleLock(path: string): Promise<void> {
    try {
      const st = await fs.stat(path);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) await fs.rm(path, { recursive: true, force: true });
    } catch {
      // lock released in the meantime
    }
  }

  private async writeTemp(target: string, value: unknown): Promise<string> {
    const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return tmp;
  }
}
