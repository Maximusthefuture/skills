import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Every project the operator has opened a page for, across the machine: ~/.agent-network/projects.json
 * (AGENT_NETWORK_HOME moves it, for tests). Each `ui` writes its projects in, so the list fills itself; the page shows it
 * all and opens a project from it without a restart. `servedBy` is the `ui` process that runs the project's runners now:
 * a second page must not start a second set of runners for the same agents.
 */
export interface RegisteredProject {
  /** The git repository (the network is <dir>/.agent-network). */
  dir: string;
  name: string;
  /** Its runners config, when it is not the project's own (.agent-network/runners.json). */
  config?: string;
  openedAt: string;
  servedBy?: { pid: number; url: string };
}

export const registryFile = (env: NodeJS.ProcessEnv = process.env): string => join(env.AGENT_NETWORK_HOME || join(homedir(), ".agent-network"), "projects.json");

const alive = (pid: number): boolean => {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

async function read(file: string): Promise<RegisteredProject[]> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { projects?: RegisteredProject[] };
    return Array.isArray(raw.projects) ? raw.projects.filter((p) => typeof p?.dir === "string") : [];
  } catch {
    return [];
  }
}

// one writer at a time inside this process; across processes a write is whole (rename), the last one wins
let chain: Promise<unknown> = Promise.resolve();
function update<T>(file: string, change: (list: RegisteredProject[]) => T): Promise<T> {
  const next = chain.then(async () => {
    const list = await read(file);
    const out = change(list);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ projects: list }, null, 2) + "\n");
    await rename(tmp, file);
    return out;
  });
  chain = next.catch(() => undefined);
  return next;
}

/** The list, most recently opened first; a page that is gone (its process ended) no longer serves its projects. */
export async function listProjects(file = registryFile()): Promise<RegisteredProject[]> {
  return (await read(file))
    .map((p) => (p.servedBy && !alive(p.servedBy.pid) ? (({ servedBy: _, ...rest }) => rest)(p) : p))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

/** A project opened by a page (served by it), or only put on the list (`served` absent). */
export async function registerProject(dir: string, opts: { config?: string; served?: { pid: number; url: string } } = {}, file = registryFile()): Promise<RegisteredProject> {
  const at = resolve(dir);
  return update(file, (list) => {
    const old = list.find((p) => p.dir === at);
    const entry: RegisteredProject = {
      dir: at, name: basename(at), openedAt: new Date().toISOString(),
      ...(opts.config ? { config: resolve(opts.config) } : old?.config ? { config: old.config } : {}),
      ...(opts.served ? { servedBy: opts.served } : old?.servedBy && alive(old.servedBy.pid) && old.servedBy.pid !== process.pid ? { servedBy: old.servedBy } : {}),
    };
    if (old) list.splice(list.indexOf(old), 1, entry);
    else list.push(entry);
    return entry;
  });
}

/** The page closed the project (or stopped): it stays on the list, served by nobody. */
export async function releaseProjects(dirs: string[], pid = process.pid, file = registryFile()): Promise<void> {
  const set = new Set(dirs.map((d) => resolve(d)));
  await update(file, (list) => {
    for (const p of list) if (set.has(p.dir) && p.servedBy?.pid === pid) delete p.servedBy;
  });
}

/** «Убрать из списка»: off the list; nothing in the project changes. */
export async function forgetProject(dir: string, file = registryFile()): Promise<boolean> {
  const at = resolve(dir);
  return update(file, (list) => {
    const i = list.findIndex((p) => p.dir === at);
    if (i >= 0) list.splice(i, 1);
    return i >= 0;
  });
}

/** What a project not on this page looks like from its folder alone: its open tasks and when it last moved. */
export async function peekProject(dir: string): Promise<{ exists: boolean; open: number; blocked: number; lastActivity: string | null }> {
  if (!existsSync(dir)) return { exists: false, open: 0, blocked: 0, lastActivity: null };
  const tasksDir = join(dir, ".agent-network", "tasks");
  const ids = await readdir(tasksDir).catch(() => [] as string[]);
  let open = 0;
  let blocked = 0;
  let last: string | null = null;
  for (const id of ids) {
    const t = await readFile(join(tasksDir, id, "task.json"), "utf8").then((s) => JSON.parse(s) as { status?: string; updatedAt?: string }, () => null);
    if (!t) continue;
    if (t.status === "ACTIVE" || t.status === "BLOCKED") open++;
    if (t.status === "BLOCKED") blocked++;
    if (t.updatedAt && (!last || t.updatedAt > last)) last = t.updatedAt;
  }
  return { exists: true, open, blocked, lastActivity: last };
}
