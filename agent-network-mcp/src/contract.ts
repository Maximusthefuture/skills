import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AppError } from "./errors.js";

/**
 * A task that changes the API contract too: the OpenAPI spec lives in a Maven project of its own (published to Nexus,
 * taken by the service as a release version). The operator names that project when the task is designed; the task gets
 * a worktree of it on its own branch, the lead changes the spec there and bumps the contract's version (a new release
 * number, so installing it into ~/.m2 during the task touches no version anyone uses), the service moves to that
 * version, and «Принять и влить» merges the contract first, then the service.
 */

export interface TaskContract {
  /** The contract's repository (absolute). */
  project: string;
  /** This task's worktree of it and its branch, made from `base` (the contract's HEAD when it was set). */
  worktree: string;
  branch: string;
  base: string;
  /** Spec files found in it, repository-relative. */
  specs: string[];
  /** Maven coordinates of the contract when it was set: the version the service is on. */
  groupId: string;
  artifactId: string;
  version: string;
  setAt: string;
  /** «Принять и влить»: the contract's own merge into its repository. */
  merged?: { at: string; into: string; commit: string; already: boolean; verified?: { command: string }; unverified?: true; reverted?: { at: string; commit: string } };
}

/** Files of the contract in an agreement: "contract:<path in the contract's repository>". */
export const CONTRACT_PREFIX = "contract:";
export const isContractFile = (f: string): boolean => f.startsWith(CONTRACT_PREFIX);
export const contractPath = (f: string): string => f.slice(CONTRACT_PREFIX.length);

const git = (cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> =>
  new Promise((done) => execFile("git", args, { cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => done({ ok: !e, out: String(out), err: String(err || (e ? e.message : "")) })));

/** groupId, artifactId and version of a pom (the project's own, a missing groupId or version taken from <parent>). */
export function pomCoords(text: string): { groupId?: string; artifactId?: string; version?: string } {
  const noComments = text.replace(/<!--[\s\S]*?-->/g, "");
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(noComments)?.[1] ?? "";
  // the project's own elements: everything outside <parent>, <dependencies>, <build>, <dependencyManagement>, <profiles>
  const own = noComments.replace(/<(parent|dependencies|dependencyManagement|build|profiles|reporting|properties)>[\s\S]*?<\/\1>/g, "");
  const tag = (src: string, name: string) => new RegExp(`<${name}>\\s*([^<\\s]+)\\s*</${name}>`).exec(src)?.[1];
  const groupId = tag(own, "groupId") ?? tag(parent, "groupId");
  const artifactId = tag(own, "artifactId");
  const version = tag(own, "version") ?? tag(parent, "version");
  return { ...(groupId ? { groupId } : {}), ...(artifactId ? { artifactId } : {}), ...(version ? { version } : {}) };
}

/** The version a pom declares for a dependency (literal, or ${prop} from its <properties>); null when it has none. */
export function dependencyVersion(text: string, groupId: string, artifactId: string): { version: string; property?: string } | null {
  const noComments = text.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of noComments.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const d = m[1]!;
    if (!new RegExp(`<artifactId>\\s*${escape(artifactId)}\\s*</artifactId>`).test(d)) continue;
    const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(d)?.[1];
    if (g && g !== groupId) continue;
    const v = /<version>\s*([^<\s]+)\s*<\/version>/.exec(d)?.[1];
    if (!v) continue;
    const prop = /^\$\{([^}]+)\}$/.exec(v)?.[1];
    if (!prop) return { version: v };
    const value = new RegExp(`<${escape(prop)}>\\s*([^<\\s]+)\\s*</${escape(prop)}>`).exec(/<properties>([\s\S]*?)<\/properties>/.exec(noComments)?.[1] ?? "")?.[1];
    return value ? { version: value, property: prop } : null;
  }
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The OpenAPI files of a repository (YAML whose first lines say openapi: 3…), skipping build output and VCS folders. */
export async function findSpecs(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.length >= 50) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || e.name === "target" || e.name === "node_modules" || e.name === "build") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (/\.ya?ml$/.test(e.name) && /^\s*openapi\s*:\s*['"]?3/m.test((await readFile(p, "utf8").catch(() => "")).slice(0, 2000))) out.push(relative(root, p));
    }
  };
  await walk(root, 0);
  return out.sort();
}

/** The contract project the operator names: an absolute path to a git repository with a pom.xml and an OpenAPI spec. */
export async function inspectContract(path: string): Promise<{ project: string; specs: string[]; groupId: string; artifactId: string; version: string }> {
  if (!path || !isAbsolute(path)) throw new AppError("INVALID_INPUT", `The contract project is an absolute path to its repository, e.g. /Users/me/projects/orders-api; got "${path}"`);
  const project = resolve(path);
  const top = await git(project, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new AppError("INVALID_INPUT", `${project} is not a git repository`);
  if (resolve(top.out.trim()) !== project) throw new AppError("INVALID_INPUT", `${project} is inside the repository ${top.out.trim()}: name the repository's own folder`);
  const pom = await readFile(join(project, "pom.xml"), "utf8").catch(() => null);
  if (pom === null) throw new AppError("INVALID_INPUT", `${project} has no pom.xml: the contract is a Maven project the service takes as an artifact`);
  const c = pomCoords(pom);
  if (!c.groupId || !c.artifactId || !c.version) throw new AppError("INVALID_INPUT", `${project}/pom.xml: cannot read its groupId, artifactId and version`);
  const specs = await findSpecs(project);
  if (!specs.length) throw new AppError("INVALID_INPUT", `${project} has no OpenAPI spec (a .yaml starting with "openapi: 3")`);
  return { project, specs, groupId: c.groupId, artifactId: c.artifactId, version: c.version };
}

/** This task's worktree of the contract: <project>-<task> on branch swarm-<task>, from the contract's HEAD. */
export async function openContractWorktree(project: string, taskId: string): Promise<{ worktree: string; branch: string; base: string }> {
  const worktree = `${project}-${taskId}`;
  const branch = `swarm-${taskId}`;
  const base = (await git(project, ["rev-parse", "HEAD"])).out.trim();
  if (!existsSync(worktree)) {
    const exists = (await git(project, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
    const r = await git(project, ["worktree", "add", ...(exists ? [worktree, branch] : ["-b", branch, worktree, base])]);
    if (!r.ok) throw new AppError("INVALID_INPUT", `Cannot create the contract's worktree ${worktree}: ${r.err.trim().slice(0, 300)}`);
  }
  return { worktree, branch, base };
}

/** What the contract's worktree has that its base has not: committed or not. */
export async function contractChanges(worktree: string): Promise<string[]> {
  const st = await git(worktree, ["status", "--porcelain", "--untracked-files=all"]);
  return st.out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").at(-1)!);
}

/**
 * The lead's changes to the contract, committed by the server (the agent's git rules do not reach another repository):
 * every changed file must be one the agreement gives it. Returns the commit, or null with nothing to commit.
 */
export async function commitContract(worktree: string, owned: string[], message: string, matches: (pattern: string, path: string) => boolean): Promise<string | null> {
  const changed = (await contractChanges(worktree)).filter((f) => !f.startsWith(".agent-network/"));
  if (!changed.length) return null;
  const foreign = changed.filter((f) => !owned.some((o) => matches(o, f)));
  if (foreign.length) {
    throw new AppError("FILE_NOT_OWNED", `The contract's worktree has changes to files the agreement does not give you: ${foreign.join(", ")}. Undo them, or propose an agreement with contract:<path> for them.`, { files: foreign });
  }
  await git(worktree, ["add", "--", ...changed]);
  const c = await git(worktree, ["commit", "-m", message]);
  if (!c.ok) throw new AppError("INVALID_INPUT", `Cannot commit the contract: ${(c.err || c.out).trim().slice(0, 300)}`);
  return (await git(worktree, ["rev-parse", "HEAD"])).out.trim();
}

/** The pom version on the contract's branch. */
export async function contractVersion(worktree: string): Promise<string | undefined> {
  return pomCoords(await readFile(join(worktree, "pom.xml"), "utf8").catch(() => "")).version;
}

/**
 * Where ~/.m2 got a version of the contract from: "remote" (downloaded: it is in Nexus), "local" (only `mvn install`ed
 * here — not released), "missing". Maven notes it in _remote.repositories next to the artifact ("x.pom>=" local,
 * "x.pom>nexus=" downloaded).
 */
export async function m2Origin(groupId: string, artifactId: string, version: string, repo = process.env.AGENT_NETWORK_M2_REPO || join(homedir(), ".m2", "repository")): Promise<"remote" | "local" | "missing"> {
  const dir = join(repo, ...groupId.split("."), artifactId, version);
  if (!existsSync(dir)) return "missing";
  const marks = await readFile(join(dir, "_remote.repositories"), "utf8").catch(() => "");
  const lines = marks.split("\n").filter((l) => l.includes(">"));
  return lines.some((l) => !/>=\s*$/.test(l)) ? "remote" : "local";
}

/** The release that a change of this kind needs after `from` (breaking: major, additions: minor, else patch). */
export function nextVersion(from: string, kind: "breaking" | "additive" | "patch"): string | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(from);
  if (!m) return null;
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return kind === "breaking" ? `${maj + 1}.0.0` : kind === "additive" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
}

/** a ≥ b as release numbers (x.y.z); null when either is not one. */
export function versionAtLeast(a: string, b: string): boolean | null {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]);
  return true;
}

/** The contract's change in this task: files and the diff against its base, committed or not (the reviewers' view). */
export async function contractDiff(worktree: string, base: string, maxChars = 40_000): Promise<{ files: string[]; diff: string; truncated: boolean }> {
  const names = await git(worktree, ["diff", "--name-only", base]);
  const untracked = await git(worktree, ["ls-files", "--others", "--exclude-standard"]);
  const files = [...new Set([...names.out.split("\n"), ...untracked.out.split("\n")].filter((f) => f && !f.startsWith(".agent-network/")))].sort();
  const d = await git(worktree, ["diff", "--no-color", base]);
  return { files, diff: d.out.slice(0, maxChars), truncated: d.out.length > maxChars };
}

/** How the lead installs the contract into ~/.m2: the project's Maven wrapper when it has one. */
export const installCommand = (worktree: string): string => `${existsSync(join(worktree, "mvnw")) ? "./mvnw" : "mvn"} -q -B install -DskipTests`;
