import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { Journal } from "../../src/supervisor/journal.js";
import { claudeTranscript, formatSessionLog, readSessionLog, SessionLog } from "../../src/supervisor/sessionLog.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

/** A network with a journal of five entries and two supervisor sessions on disk. */
async function seeded() {
  const networkDir = join(await tmpDir(), "shop", ".agent-network");
  const journal = new Journal(await FileStore.open(networkDir));
  const first = await SessionLog.create(networkDir);
  first.write({ type: "start", at: "2026-10-11T10:20:32.000Z", session: first.id, cli: "claude", model: "sonnet", incidents: [{ kind: "blocked", taskId: "task-002", summary: "task-002 is BLOCKED in IMPLEMENT round 3" }], prompt: "You are the supervisor." });
  first.write({ type: "event", at: "2026-10-11T10:20:40.000Z", kind: "tool_use", tool: "mcp__supervisor__task_detail", summary: '{"taskId":"task-002"}', detail: '{\n  "taskId": "task-002"\n}' });
  first.write({ type: "event", at: "2026-10-11T10:20:41.000Z", kind: "tool_result", tool: "mcp__supervisor__task_detail", durationMs: 900, summary: '{"id":"task-002"}' });
  first.write({ type: "event", at: "2026-10-11T10:20:50.000Z", kind: "text", summary: "The last round brought no commits.", detail: "The last round brought no commits.\nHanding the fix to the lead." });
  first.write({ type: "end", at: "2026-10-11T10:21:16.000Z", exitCode: 0, numTurns: 11, usd: 0.096, estimated: false, cliSessionId: "8df3", transcript: "/home/me/.claude/projects/x/8df3.jsonl", text: "Handed task-002 to the lead." });
  await first.close();
  const second = await SessionLog.create(networkDir);
  second.write({ type: "start", at: "2026-10-11T10:21:22.000Z", session: second.id, cli: "claude", incidents: [], prompt: "p" });
  await second.close(); // cut off: no end line

  await journal.add({ kind: "incident", by: "detector", taskId: "task-002", text: "task-002 «Refund» is BLOCKED in IMPLEMENT round 3" });
  await journal.add({ kind: "note", by: "supervisor", taskId: "task-002", text: "Round 3 brought no commits: another round of backend will not help.\nHanding over to the lead." });
  await journal.add({ kind: "action", by: "supervisor", taskId: "task-002", text: "handed the stuck fix to the lead" });
  await journal.add({ kind: "session", by: "supervisor", taskId: "task-002", text: "Session ended (exit 0, 11 turns · $0.10)", data: { session: "session-001", log: "supervisor/sessions/session-001.jsonl", transcript: "/home/me/.claude/projects/x/8df3.jsonl" } });
  await journal.add({ kind: "action", by: "supervisor", taskId: "task-001", text: "answered reviewer's question msg-001: wait for backend" });
  return { networkDir, journal };
}

const cli = async (...args: string[]) => {
  const lines: string[] = [];
  const code = await runCli(args, {}, (s) => lines.push(s), "/");
  return { code, out: lines.join("\n") };
};

describe("supervisor session log", () => {
  it("numbers the sessions, keeps every line in order and reads one back by number, id or latest", async () => {
    const { networkDir } = await seeded();
    const one = await readSessionLog(networkDir, "1");
    expect(one.id).toBe("session-001");
    expect(one.lines.map((l) => l.type)).toEqual(["start", "event", "event", "event", "end"]);
    expect((await readSessionLog(networkDir, "session-002")).lines).toHaveLength(1);
    expect((await readSessionLog(networkDir, "latest")).id).toBe("session-002");
    await expect(readSessionLog(networkDir, "7")).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("1..2") });

    const text = formatSessionLog(one.lines);
    expect(text).toContain("start session-001 · claude (sonnet) · 1 incident(s)");
    expect(text).toContain("- blocked: task-002 is BLOCKED in IMPLEMENT round 3");
    expect(text).toContain("tool_result mcp__supervisor__task_detail ✓ 0.9s");
    expect(text).toContain("Handing the fix to the lead."); // the whole text, not only its first line
    expect(text).toContain("end exit 0 · 11 turns · $0.10");
    expect(text).toContain("CLI transcript: /home/me/.claude/projects/x/8df3.jsonl");
    expect(text).not.toContain("You are the supervisor."); // the prompt only with --full
    expect(formatSessionLog(one.lines, true)).toContain("You are the supervisor.");
  });

  it("finds Claude Code's own transcript of the session by its folder", async () => {
    const home = await tmpDir();
    const cwd = "/work/shop";
    expect(await claudeTranscript(cwd, "abc", home)).toBeUndefined();
    mkdirSync(join(home, ".claude", "projects", "-work-shop"), { recursive: true });
    writeFileSync(join(home, ".claude", "projects", "-work-shop", "abc.jsonl"), "{}\n");
    expect(await claudeTranscript(cwd, "abc", home)).toBe(join(home, ".claude", "projects", "-work-shop", "abc.jsonl"));
  });
});

describe("supervisor CLI", () => {
  it("journal: the whole journal, filtered by task, kind and time, as text or JSON", async () => {
    const { networkDir } = await seeded();
    const all = await cli("supervisor", "journal", "--network-dir", networkDir);
    expect(all.code).toBe(0);
    expect(all.out.split("\n").filter((l) => /^\d{4}-/.test(l))).toHaveLength(5);
    expect(all.out).toMatch(/note\s+supervisor task-002 {2}Round 3 brought no commits: another round of backend will not help.\n\s+Handing over to the lead./);
    expect(all.out).toMatch(/session\s+supervisor task-002 {2}Session ended .*\n\s+log: supervisor\/sessions\/session-001.jsonl \(supervisor session 1\)\n\s+CLI transcript: \/home\/me/);

    const actions = await cli("supervisor", "journal", "--task", "task-002", "--kind", "action,note", "--json", "--network-dir", networkDir);
    expect(JSON.parse(actions.out).map((e: any) => e.text.slice(0, 20))).toEqual(["Round 3 brought no c", "handed the stuck fix"]);
    expect((await cli("supervisor", "journal", "--since", "1m", "--network-dir", networkDir)).out.split("\n").filter((l) => /^\d{4}-/.test(l))).toHaveLength(5);
    expect((await cli("supervisor", "journal", "--since", "2099-01-01", "--network-dir", networkDir)).out).toBe("No journal entries for this filter.");
    expect(await cli("supervisor", "journal", "--since", "yesterday", "--network-dir", networkDir)).toMatchObject({ code: 2, out: expect.stringContaining("--since") });
  });

  it("sessions lists them; session shows one in full", async () => {
    const { networkDir } = await seeded();
    const list = await cli("supervisor", "sessions", "--network-dir", networkDir);
    expect(list.out.split("\n")).toEqual([
      "session-001  2026-10-11 10:20:32  sonnet  blocked task-002  ·  exit 0, 11 turns, $0.10",
      "session-002  2026-10-11 10:21:22  no incidents  ·  no end (cut off?)",
    ]);
    const one = await cli("supervisor", "session", "1", "--network-dir", networkDir);
    expect(one.code).toBe(0);
    expect(one.out).toContain("session-001.jsonl");
    expect(one.out).toContain("tool_use mcp__supervisor__task_detail");
    expect(JSON.parse((await cli("supervisor", "session", "latest", "--json", "--network-dir", networkDir)).out)).toHaveLength(1);
    expect(await cli("supervisor", "session", "9", "--network-dir", networkDir)).toMatchObject({ code: 2, out: expect.stringContaining("No supervisor session 9") });
    expect(await cli("supervisor", "journal", "--network-dir", join(networkDir, "nope"))).toMatchObject({ code: 2, out: expect.stringContaining("no agent network") });
  });

  it("the page serves the whole journal on request and a session's log", async () => {
    const { networkDir, journal } = await seeded();
    for (let i = 0; i < 120; i++) await journal.add({ kind: "note", by: "operator", text: `note ${i}` });
    ui = await startUiServer(networkDir, { port: 0 });
    const get = async (path: string) => (await (await fetch(`${ui!.url}${path}`)).json()) as any;
    const latest = await get("/api/supervisor");
    expect([latest.journal.length, latest.journalTotal]).toEqual([100, 125]);
    expect((await get("/api/supervisor?all=1")).journal).toHaveLength(125);
    const session = await get("/api/supervisor/sessions/session-001");
    expect(session).toMatchObject({ id: "session-001", text: expect.stringContaining("end exit 0 · 11 turns") });
    expect(session.lines).toHaveLength(5);
    expect((await fetch(`${ui.url}/api/supervisor/sessions/9`)).status).toBe(400);
  });
});
