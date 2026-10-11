import { describe, expect, it } from "vitest";
import { bashCommand, detect, emptyMemory, parseEtime, testProcesses, type Snapshot, type SnapshotAgent } from "../../src/supervisor/detect.js";

const NOW = Date.parse("2026-10-11T10:00:00Z");
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();
const tool = (name: string, args: object = {}) => `09:59:00 → ${name}(${JSON.stringify(args)})`;
const bash = (command: string) => tool("Bash", { command });
const agent = (id: string, extra: Partial<SnapshotAgent> = {}): SnapshotAgent => ({ id, session: { taskId: "task-001", attempt: 1, startedAt: ago(3600) }, log: [], ...extra });
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({ now: NOW, tasks: [{ id: "task-001", title: "Multi-currency", phase: "IMPLEMENT", status: "ACTIVE", syncRound: 0 }], questions: [], agents: [], processes: [], ...extra });

describe("supervisor detector", () => {
  it("a question to the operator open longer than the rule", () => {
    const q = (sec: number) => ({ taskId: "task-001", messageId: "msg-003", from: "backend", question: "fix the legacy tests?", askedAt: ago(sec) });
    expect(detect(snap({ questions: [q(30)] }), emptyMemory())).toEqual([]);
    expect(detect(snap({ questions: [q(90)] }), emptyMemory())).toEqual([expect.objectContaining({ key: "question:task-001:msg-003", kind: "question", agentId: "backend" })]);
  });

  it("a BLOCKED task, once per round", () => {
    const blocked = snap({ tasks: [{ id: "task-001", title: "t", phase: "SYNC", status: "BLOCKED", syncRound: 2, blockedReason: "stuck" }] });
    const mem = emptyMemory();
    const [incident] = detect(blocked, mem);
    expect(incident).toMatchObject({ key: "blocked:task-001:2", kind: "blocked", data: { reason: "stuck" } });
    mem.handled[incident!.key] = "now";
    expect(detect(blocked, mem)).toEqual([]); // handled: not again
  });

  it("an agent busy without progress for stallMin; one that only waits is fine", () => {
    const busyLog = Array.from({ length: 8 }, (_, i) => bash(`./mvnw -q test -Dtest=T${i}`));
    const mem = emptyMemory();
    const at = (min: number, a: SnapshotAgent) => detect(snap({ now: NOW + min * 60_000, agents: [a] }), mem);
    expect(at(0, agent("backend", { log: busyLog, progress: "m1" }))).toEqual([]); // first look: remembered
    expect(at(10, agent("backend", { log: busyLog, progress: "m1" }))).toEqual([]);
    expect(at(16, agent("backend", { log: busyLog, progress: "m1" }))).toEqual([expect.objectContaining({ kind: "stall", agentId: "backend", taskId: "task-001", data: expect.objectContaining({ minutes: 16 }) })]);
    expect(at(17, agent("backend", { log: busyLog, progress: "m2" }))).toEqual([]); // progress: the clock starts again

    const waiting = emptyMemory();
    const waitLog = Array.from({ length: 10 }, () => tool("mcp__agent-network__wait", { timeoutMs: 300000 }));
    detect(snap({ agents: [agent("tester", { log: waitLog, progress: "x" })] }), waiting);
    expect(detect(snap({ now: NOW + 20 * 60_000, agents: [agent("tester", { log: waitLog, progress: "x" })] }), waiting)).toEqual([]);
  });

  it("the same shell command again and again, but not builds and tests", () => {
    const kills = [bash("kill -9 74663 74808 2>/dev/null; true"), bash("kill -9 74663 74808"), tool("Read"), bash("kill -9 74663 74808 2>&1")];
    expect(detect(snap({ agents: [agent("backend", { log: kills })] }), emptyMemory())).toEqual([expect.objectContaining({ kind: "repeat", agentId: "backend", data: { command: "kill -9 74663 74808", times: 3 } })]);
    const tests = [bash("./mvnw -q test -Dtest=A"), bash("./mvnw -q test -Dtest=A"), bash("./mvnw -q test -Dtest=A")];
    expect(detect(snap({ agents: [agent("backend", { log: tests })] }), emptyMemory())).toEqual([]);
  });

  it("a test JVM in an agent's folder running longer than testMin", () => {
    const ps = [
      " 92423 05:48 /jdk/bin/java -jar /tmp/x/project-backend/target/surefire/surefirebooter.jar",
      " 92424 1-02:03:04 /jdk/bin/java -jar /tmp/x/project-backend/target/surefire/surefirebooter.jar",
      " 92425 30:00 /jdk/bin/java -jar /elsewhere/other.jar",
      " 66819 30:00 claude -p You are agent backend ... /tmp/x/project-backend",
    ].join("\n");
    const procs = testProcesses(ps, [{ agentId: "backend", cwd: "/tmp/x/project-backend" }]);
    expect(procs.map((p) => [p.pid, p.elapsedSec])).toEqual([[92423, 348], [92424, 93784]]);
    expect(detect(snap({ processes: procs, agents: [agent("backend")] }), emptyMemory())).toEqual([expect.objectContaining({ key: "test:92424", kind: "hung-test", taskId: "task-001", agentId: "backend" })]);
    // no session open: the incident belongs to the task the agent works on (its cost lands there)
    expect(detect(snap({ processes: procs, agents: [agent("backend", { session: null, task: "task-007" })] }), emptyMemory())).toEqual([expect.objectContaining({ key: "test:92424", taskId: "task-007", summary: expect.stringContaining("for 1563 min") })]);
  });

  it("a runner that gave up on a task", () => {
    const line = "09:30:00 [runner] task-001: 3 sessions ended before the task was done (last exit 1); giving up until the task changes";
    expect(detect(snap({ agents: [agent("tester", { session: null, log: [line] })] }), emptyMemory())).toEqual([expect.objectContaining({ key: "gaveup:tester:task-001:3", kind: "gave-up" })]);
  });

  it("helpers: ps etime and the command of a Bash call", () => {
    expect([parseEtime("05:48"), parseEtime("1:02:03"), parseEtime("2-00:00:01")]).toEqual([348, 3723, 172801]);
    expect(bashCommand('09:00:00 → Bash({"command":"git status  --short 2>&1","description":"x"})')).toBe("git status --short");
    expect(bashCommand("09:00:00 → Read({})")).toBeNull();
  });
});
