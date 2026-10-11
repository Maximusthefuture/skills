/**
 * The supervisor's eyes, without a model: from a snapshot of the network, the runners and the test processes it finds
 * what needs a look. Each incident has a key; the caller remembers handled keys, so one problem wakes the supervisor once.
 */

export interface DetectRules {
  /** A question to the operator open this long. */
  questionAfterSec: number;
  /** An agent busy in a session (tool calls other than wait) whose progress mark did not change this long. */
  stallMin: number;
  /** The same shell command this many times among the agent's latest tool calls. */
  repeatCount: number;
  /** A test JVM in an agent's folder running this long. */
  testMin: number;
  /** This many tool calls refused (no permission, blocked) within 10 minutes, even when each command is different. */
  refusedCount: number;
  /** An agent works on one phase of a task this long: the supervisor checks in (and again every as many minutes). */
  checkInMin: number;
}

export const DEFAULT_RULES: DetectRules = { questionAfterSec: 60, stallMin: 15, repeatCount: 3, testMin: 10, refusedCount: 4, checkInMin: 30 };

/** A tool result that says the call was not allowed (Claude Code and Qwen Code wordings). */
export const REFUSED = /requires? approval|has been denied|was blocked|not allowed|permission denied|declined|Contains simple_expansion|outside (the )?allowed/i;

export interface SnapshotTask {
  id: string;
  title: string;
  phase: string;
  status: string;
  syncRound: number;
  blockedReason?: string | null;
  /** When the task entered its current phase. */
  phaseSince?: string;
}

export interface SnapshotQuestion {
  taskId: string;
  messageId: string;
  from: string;
  question: string;
  askedAt: string;
}

export interface SnapshotAgent {
  id: string;
  /** The session the runner has open, if any. */
  session: { taskId: string; attempt: number; startedAt: string } | null;
  /** The runner's log tail (the agent's tool calls look like "HH:MM:SS → Bash({...})"). */
  log: string[];
  /** progressMark of the agent on its session's task (see progress.ts). */
  progress?: string;
  /** The task it works on: its session's, else its oldest open task (the one it takes next). */
  task?: string;
  /** Its latest tool results (the activity feed), oldest first. */
  results?: { at: string; tool?: string; isError?: boolean; summary: string }[];
}

export interface TestProcess {
  pid: number;
  elapsedSec: number;
  command: string;
  /** The agent whose folder the process runs in. */
  agentId: string;
}

export interface Snapshot {
  now: number;
  tasks: SnapshotTask[];
  questions: SnapshotQuestion[];
  agents: SnapshotAgent[];
  processes: TestProcess[];
}

export interface DetectMemory {
  /** Incident keys already queued for the supervisor -> when. */
  handled: Record<string, string>;
  /** "agent:task" -> the progress mark last seen and since when it is unchanged. */
  progress: Record<string, { mark: string; since: number }>;
}

export type IncidentKind = "question" | "blocked" | "stall" | "repeat" | "refused" | "check-in" | "hung-test" | "gave-up";

export interface Incident {
  key: string;
  kind: IncidentKind;
  taskId?: string;
  agentId?: string;
  summary: string;
  data?: Record<string, unknown>;
}

export const emptyMemory = (): DetectMemory => ({ handled: {}, progress: {} });

const hash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** Tool calls in a runner log line: "→ name({...})". */
const TOOL = /→ ([\w-]+)\((.*)$/;
const isWaiting = (tool: string) => /__(wait|swarm_context)$/.test(tool);

/** The shell command of a "→ Bash({"command":"…"})" line, without redirections and noise, so variants compare equal. */
export function bashCommand(line: string): string | null {
  const m = TOOL.exec(line);
  if (!m || m[1] !== "Bash") return null;
  const c = /"command":"((?:[^"\\]|\\.)*)/.exec(m[2]!);
  if (!c) return null;
  return c[1]!
    .replace(/\\"/g, '"')
    .replace(/\s*(2>&1|2>\/dev\/null|>\/dev\/null|;\s*true|\|\|\s*true)\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/…$/, "")
    .trim()
    .slice(0, 100);
}

/** Builds and tests are re-run on purpose while fixing; the hung-test and stall rules cover them. */
const BUILD = /^(\.\/mvnw|mvn|\.\/gradlew|gradle|npm|npx|yarn|pnpm)\b/;

export function detect(s: Snapshot, mem: DetectMemory, rules: DetectRules = DEFAULT_RULES): Incident[] {
  const found: Incident[] = [];
  const title = (id: string) => s.tasks.find((t) => t.id === id)?.title ?? id;

  for (const q of s.questions) {
    if (s.now - Date.parse(q.askedAt) < rules.questionAfterSec * 1000) continue;
    found.push({ key: `question:${q.taskId}:${q.messageId}`, kind: "question", taskId: q.taskId, agentId: q.from, summary: `${q.from} asked the operator (${q.messageId}) in ${q.taskId} «${title(q.taskId)}» and nobody answered: ${q.question.length > 200 ? `${q.question.slice(0, 200)}…` : q.question}`, data: { messageId: q.messageId, question: q.question, askedAt: q.askedAt } });
  }

  for (const t of s.tasks) {
    if (t.status !== "BLOCKED") continue;
    found.push({ key: `blocked:${t.id}:${t.syncRound}`, kind: "blocked", taskId: t.id, summary: `${t.id} «${t.title}» is BLOCKED in ${t.phase} round ${t.syncRound}`, data: { reason: t.blockedReason ?? null } });
  }

  const tracked = new Set<string>();
  for (const a of s.agents) {
    const tools = a.log.map((l) => TOOL.exec(l)).filter((m): m is RegExpExecArray => !!m);

    // busy without progress: tool calls keep coming, the mark (subtasks, events, git) does not change
    if (a.session && a.progress !== undefined) {
      const k = `${a.id}:${a.session.taskId}`;
      tracked.add(k);
      const seen = mem.progress[k];
      if (!seen || seen.mark !== a.progress) mem.progress[k] = { mark: a.progress, since: s.now };
      else if (s.now - seen.since >= rules.stallMin * 60_000) {
        const busy = tools.slice(-30).filter((m) => !isWaiting(m[1]!)).length >= 5;
        if (busy) {
          const minutes = Math.round((s.now - seen.since) / 60_000);
          found.push({ key: `stall:${a.id}:${a.session.taskId}:${hash(a.progress)}`, kind: "stall", taskId: a.session.taskId, agentId: a.id, summary: `${a.id} has been busy in ${a.session.taskId} for ${minutes} min without progress (no subtask ticked, no event, no change in its folder)`, data: { minutes, attempt: a.session.attempt } });
        }
      }
    }

    // the same shell command again and again: usually a refused command or a loop
    const commands = a.log.map(bashCommand).filter((c): c is string => !!c && !BUILD.test(c)).slice(-12);
    const counts = new Map<string, number>();
    for (const c of commands) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const [command, n] of counts) {
      if (n < rules.repeatCount) continue;
      found.push({ key: `repeat:${a.id}:${hash(command)}`, kind: "repeat", ...(a.session || a.task ? { taskId: a.session?.taskId ?? a.task } : {}), agentId: a.id, summary: `${a.id} ran the same command ${n} times: ${command}`, data: { command, times: n } });
    }

    // working on one phase for long: a look every checkInMin, before anyone has to ask why it takes so long
    const working = a.session ? s.tasks.find((t) => t.id === a.session!.taskId && t.status === "ACTIVE") : undefined;
    if (working?.phaseSince) {
      const minutes = Math.floor((s.now - Date.parse(working.phaseSince)) / 60_000);
      const busy = (a.results ?? []).filter((r) => s.now - Date.parse(r.at) <= 30 * 60_000 && !isWaiting(r.tool ?? "")).length >= 5; // waiting is no work
      if (busy && minutes >= rules.checkInMin) {
        const n = Math.floor(minutes / rules.checkInMin);
        found.push({
          key: `checkin:${a.id}:${working.id}:${working.phase}:${working.syncRound}:${n}`, kind: "check-in", taskId: working.id, agentId: a.id,
          summary: `${a.id} has been working on ${working.id} «${working.title}» in ${working.phase} for ${minutes} min (session ${a.session!.attempt}): is it moving, and what would help?`,
          data: { minutes, phase: working.phase, attempt: a.session!.attempt },
        });
      }
    }

    // refused again and again with different commands: it probes for something it may not do (repeat misses this)
    const recent = (a.results ?? []).filter((r) => s.now - Date.parse(r.at) <= 10 * 60_000);
    const refused = recent.filter((r) => r.isError && REFUSED.test(r.summary));
    const quiet = !Object.entries(mem.handled).some(([k, at]) => k.startsWith(`refused:${a.id}:`) && s.now - Date.parse(at) < 15 * 60_000);
    if (refused.length >= rules.refusedCount && quiet) {
      const taskId = a.session?.taskId ?? a.task;
      found.push({
        key: `refused:${a.id}:${refused[0]!.at}`, kind: "refused", ...(taskId ? { taskId } : {}), agentId: a.id,
        summary: `${a.id} was refused ${refused.length} times in 10 min: ${[...new Set(refused.map((r) => r.summary.slice(0, 80)))].slice(0, 4).join(" | ")}`,
        data: { refused: refused.map((r) => ({ at: r.at, tool: r.tool ?? null, result: r.summary.slice(0, 200) })) },
      });
    }

    // the runner stopped starting sessions for a task
    for (const line of a.log) {
      const m = /\[runner\] (task-\d+): (\d+) sessions ended before the task was done.*giving up until the task changes/.exec(line);
      if (!m) continue;
      found.push({ key: `gaveup:${a.id}:${m[1]}:${m[2]}`, kind: "gave-up", taskId: m[1]!, agentId: a.id, summary: `the runner of ${a.id} gave up on ${m[1]} after ${m[2]} sessions`, data: { line } });
    }
  }
  for (const k of Object.keys(mem.progress)) if (!tracked.has(k)) delete mem.progress[k]; // the session ended

  for (const p of s.processes) {
    if (p.elapsedSec < rules.testMin * 60) continue;
    const agent = s.agents.find((a) => a.id === p.agentId);
    const taskId = agent?.session?.taskId ?? agent?.task;
    found.push({ key: `test:${p.pid}`, kind: "hung-test", ...(taskId ? { taskId } : {}), agentId: p.agentId, summary: `a test process of ${p.agentId} (pid ${p.pid}) has been running for ${p.elapsedSec < 120 ? `${p.elapsedSec} s` : `${Math.round(p.elapsedSec / 60)} min`}`, data: { pid: p.pid, command: p.command.slice(0, 300) } });
  }

  return found.filter((i) => !mem.handled[i.key]);
}

/** "[[dd-]hh:]mm:ss" (ps etime) -> seconds. */
export function parseEtime(etime: string): number {
  const [days, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = rest!.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, sec] = parts as [number, number, number];
  return Number(days) * 86400 + h * 3600 + m * 60 + sec;
}

/**
 * Test JVMs in the agents' folders from `ps -axo pid=,etime=,command=`: a java process whose command line names one of
 * the folders. The agents' own CLIs are never in the list.
 */
export function testProcesses(psOutput: string, folders: { agentId: string; cwd: string }[]): TestProcess[] {
  const out: TestProcess[] = [];
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[3]!;
    if (!/(^|\/)java(\s|$)/.test(command.split(" ")[0]!) && !/\bjava\s/.test(command.split(" -")[0]!)) continue;
    const owner = folders.find((f) => command.includes(f.cwd));
    if (owner) out.push({ pid: Number(m[1]), elapsedSec: parseEtime(m[2]!), command, agentId: owner.agentId });
  }
  return out;
}
