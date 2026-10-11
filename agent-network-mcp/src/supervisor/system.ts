import { execFile } from "node:child_process";
import { AppError } from "../errors.js";
import { testProcesses, type TestProcess } from "./detect.js";

/**
 * The supervisor's look at the machine, narrow on purpose: test JVMs in the agents' folders and the Testcontainers
 * databases of their tests. No shell; a process outside the agents' folders, an agent's own CLI and a container that
 * Testcontainers did not start are refused.
 */

export interface Folder {
  agentId: string;
  cwd: string;
}

export type Exec = (file: string, args: string[]) => Promise<string>;

export const execTool: Exec = (file, args) =>
  new Promise((done, fail) =>
    execFile(file, args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? fail(new AppError("INVALID_INPUT", `${file} ${args[0] ?? ""}: ${(stderr || err.message).trim().slice(0, 500)}`)) : done(stdout))),
  );

/** AGENT_NETWORK_SUPERVISOR_FOLDERS, set by the supervisor for its session: the agents' working folders. */
export function foldersFromEnv(env: NodeJS.ProcessEnv): Folder[] {
  try {
    const raw = JSON.parse(env.AGENT_NETWORK_SUPERVISOR_FOLDERS ?? "[]") as Folder[];
    return raw.filter((f) => f && typeof f.agentId === "string" && typeof f.cwd === "string" && f.cwd.length > 1);
  } catch {
    return [];
  }
}

export async function listProcesses(folders: Folder[], exec: Exec = execTool): Promise<TestProcess[]> {
  return folders.length ? testProcesses(await exec("ps", ["-axo", "pid=,etime=,command="]), folders) : [];
}

async function ownTestProcess(pid: number, folders: Folder[], exec: Exec): Promise<TestProcess> {
  if (!Number.isInteger(pid) || pid <= 1) throw new AppError("INVALID_INPUT", `Not a process id: ${pid}`);
  const p = (await listProcesses(folders, exec)).find((x) => x.pid === pid);
  if (!p) throw new AppError("FORBIDDEN", `Process ${pid} is not a test JVM in an agent's folder (see processes): it is not yours to touch`);
  return p;
}

/** jstack, cut to what explains a hang: the main thread and the threads that run project or test code. */
export async function threadDump(pid: number, folders: Folder[], exec: Exec = execTool): Promise<string> {
  await ownTestProcess(pid, folders, exec);
  const dump = await exec("jstack", [String(pid)]);
  const threads = dump.split(/\n(?=")/);
  const wanted = threads.filter((t) => t.startsWith('"main"') || /\bat (com|org\.postgresql|liquibase|org\.testcontainers|org\.junit)\./.test(t));
  const text = wanted.map((t) => t.split("\n").slice(0, 30).join("\n")).join("\n\n");
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text || dump.slice(0, 6000);
}

/** SIGTERM, then SIGKILL after 5 s: the test run fails instead of hanging, and the agent sees the failure. */
export async function killTest(pid: number, folders: Folder[], exec: Exec = execTool, signal: (pid: number, sig: NodeJS.Signals | 0) => void = (p, s) => process.kill(p, s)): Promise<TestProcess & { killed: "TERM" | "KILL" }> {
  const p = await ownTestProcess(pid, folders, exec);
  signal(pid, "SIGTERM");
  const alive = () => {
    try {
      signal(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 25 && alive(); i++) await new Promise((r) => setTimeout(r, 200));
  if (!alive()) return { ...p, killed: "TERM" };
  signal(pid, "SIGKILL");
  return { ...p, killed: "KILL" };
}

interface Db {
  container: string;
  image: string;
  user: string;
  database: string;
}

/** PostgreSQL containers started by Testcontainers (label org.testcontainers=true). */
export async function testDatabases(exec: Exec = execTool): Promise<Db[]> {
  const out = await exec("docker", ["ps", "--filter", "label=org.testcontainers=true", "--format", "{{.ID}}\t{{.Image}}"]);
  const dbs: Db[] = [];
  for (const line of out.split("\n")) {
    const [container, image] = line.trim().split("\t");
    if (!container || !image || !/postgres/i.test(image)) continue;
    const env = await exec("docker", ["exec", container, "printenv"]).catch(() => "");
    const val = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim();
    dbs.push({ container, image, user: val("POSTGRES_USER") ?? "postgres", database: val("POSTGRES_DB") ?? val("POSTGRES_USER") ?? "postgres" });
  }
  return dbs;
}

/** pg_stat_activity of every test database: who waits on a lock, which transaction sits idle. */
export async function dbActivity(exec: Exec = execTool): Promise<{ container: string; image: string; sessions: Record<string, string>[] }[]> {
  const query =
    "select pid, state, coalesce(wait_event_type,'') as wait_type, coalesce(wait_event,'') as wait_event, " +
    "coalesce(to_char(now()-xact_start,'HH24:MI:SS'),'') as in_transaction, left(regexp_replace(query, '\\s+', ' ', 'g'), 200) as query " +
    "from pg_stat_activity where datname is not null and pid <> pg_backend_pid()";
  const cols = ["pid", "state", "wait_type", "wait_event", "in_transaction", "query"];
  const out = [];
  for (const db of await testDatabases(exec)) {
    const rows = await exec("docker", ["exec", db.container, "psql", "-U", db.user, "-d", db.database, "-At", "-F", "\t", "-c", query]);
    out.push({ container: db.container, image: db.image, sessions: rows.split("\n").filter(Boolean).map((r) => Object.fromEntries(r.split("\t").map((v, i) => [cols[i] ?? `c${i}`, v]))) });
  }
  return out;
}

/** Ends one backend (connection) in a test database, e.g. a transaction left idle that holds a lock. */
export async function dbTerminate(container: string, pid: number, exec: Exec = execTool): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) throw new AppError("INVALID_INPUT", `Not a backend pid: ${pid}`);
  const db = (await testDatabases(exec)).find((d) => d.container === container || d.container.startsWith(container));
  if (!db) throw new AppError("FORBIDDEN", `${container} is not a PostgreSQL container started by Testcontainers (see db_activity)`);
  const out = await exec("docker", ["exec", db.container, "psql", "-U", db.user, "-d", db.database, "-At", "-c", `select pg_terminate_backend(${pid})`]);
  return out.trim() === "t" ? `terminated backend ${pid} in ${db.container}` : `backend ${pid} not found in ${db.container}`;
}
