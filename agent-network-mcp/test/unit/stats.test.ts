import { describe, expect, it } from "vitest";
import { normalizeUsage, SessionOutput } from "../../src/sessionOutput.js";
import { taskStats } from "../../src/stats.js";
import type { SessionRecord } from "../../src/stores/sessionStore.js";
import type { Task } from "../../src/types.js";

describe("SessionOutput", () => {
  it("Claude stream-json: a readable log and the usage of the final result", () => {
    const out = new SessionOutput();
    const lines = [
      { type: "system", subtype: "init", model: "claude-haiku-4-5" },
      { type: "assistant", message: { content: [{ type: "text", text: "Reading the task." }, { type: "tool_use", name: "mcp__agent-network__swarm_context", input: {} }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "{...}" }] } },
      { type: "result", subtype: "success", result: "Done.", num_turns: 3, total_cost_usd: 0.0123, duration_api_ms: 2000,
        usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 }, modelUsage: { "claude-haiku-4-5": {} } },
    ];
    const text = out.feed(lines.map((l) => JSON.stringify(l)).join("\n").slice(0, 70)) + out.feed(lines.map((l) => JSON.stringify(l)).join("\n").slice(70) + "\n") + out.end();
    expect(text).toBe("[session] model claude-haiku-4-5\nReading the task.\n→ mcp__agent-network__swarm_context({})\n[result] Done. · tokens 1050 (in 1010, out 40)\n");
    expect(out.result()).toEqual({ usage: { input: 1010, output: 40, cacheRead: 900, cacheCreation: 100, total: 1050 }, costUsd: 0.0123, numTurns: 3, apiMs: 2000, model: "claude-haiku-4-5" });
  });

  it("Qwen -o json (one array, possibly pretty-printed) and plain text", () => {
    const out = new SessionOutput();
    const doc = [{ type: "system", subtype: "init", model: "qwen/qwen3.5-9b" }, { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } },
      { type: "result", subtype: "success", result: "ok", num_turns: 1, usage: { input_tokens: 2468, output_tokens: 112, cache_read_input_tokens: 2000, total_tokens: 2580 } }];
    out.feed(JSON.stringify(doc, null, 2));
    out.end();
    expect(out.result()).toEqual({ usage: { input: 2468, output: 112, cacheRead: 2000, cacheCreation: 0, total: 2580 }, numTurns: 1, model: "qwen/qwen3.5-9b" });

    const plain = new SessionOutput();
    expect(plain.feed("hello\nworld\n") + plain.end()).toBe("hello\nworld\n");
    expect(plain.result()).toBeUndefined();
  });

  it("normalizeUsage ignores objects without token counts", () => {
    expect(normalizeUsage({ foo: 1 })).toBeUndefined();
    expect(normalizeUsage(undefined)).toBeUndefined();
  });
});

const at = (m: number) => new Date(Date.UTC(2026, 9, 10, 10, m)).toISOString();
const task = (over: Partial<Task> = {}): Task => ({
  id: "task-001", title: "t", description: "d", phase: "DONE", status: "COMPLETED", agents: ["a", "b"], createdAt: at(0), updatedAt: at(30),
  createdBy: "operator", git: null, syncRound: 2,
  phaseHistory: [{ phase: "DISCUSS", at: at(0) }, { phase: "IMPLEMENT", at: at(2) }, { phase: "SYNC", at: at(10) }, { phase: "IMPLEMENT", at: at(12) }, { phase: "SYNC", at: at(15) }, { phase: "INTEGRATE", at: at(17) }, { phase: "DONE", at: at(20) }],
  ...over,
});
const session = (agentId: string, total: number, ms: number, costUsd?: number, model?: string): SessionRecord => ({
  id: "s", taskId: "task-001", agentId, attempt: 1, startedAt: at(0), endedAt: at(1), durationMs: ms, exitCode: 0,
  ...(total ? { usage: { input: total - 10, output: 10, cacheRead: 0, cacheCreation: 0, total } } : {}),
  ...(costUsd !== undefined ? { costUsd } : {}),
  ...(model ? { model } : {}),
});

describe("taskStats", () => {
  it("sums time per phase across fix rounds and tokens per agent", () => {
    const st = taskStats(task(), [session("a", 1000, 60_000, 0.01, "haiku"), session("a", 500, 30_000, 0.02, "sonnet"), session("a", 0, 1, undefined, "haiku"), session("b", 0, 10_000)], [])!;
    expect(st).toMatchObject({ elapsedMs: 20 * 60_000, finishedAt: at(20), sessions: 4, sessionsWithoutUsage: 2, costUsd: 0.03 });
    expect(st.phases).toEqual([{ phase: "DISCUSS", ms: 2 * 60_000 }, { phase: "IMPLEMENT", ms: 11 * 60_000 }, { phase: "SYNC", ms: 4 * 60_000 }, { phase: "INTEGRATE", ms: 3 * 60_000 }]);
    expect(st.usage?.total).toBe(1500);
    expect(st.agents).toEqual([
      { agentId: "a", models: ["haiku", "sonnet"], sessions: 3, ms: 90_001, usage: { input: 1480, output: 20, cacheRead: 0, cacheCreation: 0, total: 1500 }, costUsd: expect.closeTo(0.03), costEstimated: false },
      { agentId: "b", models: [], sessions: 1, ms: 10_000, usage: null, costUsd: null, costEstimated: false },
    ]);
    expect(st).toMatchObject({ costEstimated: false, unpricedModels: [] });
  });

  it("prices sessions without a CLI cost with the operator's prices; the CLI's own cost wins", () => {
    const qwen = (agentId: string, input: number, output: number, cacheRead = 0): SessionRecord => ({
      id: "s", taskId: "task-001", agentId, attempt: 1, startedAt: at(0), endedAt: at(1), durationMs: 1000, exitCode: 0, model: "qwen/qwen3.5-9b",
      usage: { input, output, cacheRead, cacheCreation: 0, total: input + output },
    });
    const prices = { "Qwen/Qwen3.5-9B": { input: 0.1, output: 0.4, cacheRead: 0.01 } }; // names match without case
    const st = taskStats(task(), [qwen("a", 1_000_000, 100_000, 400_000), qwen("b", 2_000_000, 0), session("c", 1000, 1, 0.5, "haiku")], [], new Date(), prices)!;
    // a: 600k fresh * 0.1 + 400k cached * 0.01 + 100k out * 0.4 = 0.06 + 0.004 + 0.04; b: 2M * 0.1; c: as the CLI reported
    expect(st.agents.map((a) => [a.agentId, a.costUsd, a.costEstimated])).toEqual([["a", expect.closeTo(0.104), true], ["b", expect.closeTo(0.2), true], ["c", 0.5, false]]);
    expect(st).toMatchObject({ costUsd: expect.closeTo(0.804), costEstimated: true, unpricedModels: [] });

    const without = taskStats(task(), [qwen("a", 1000, 10), session("b", 500, 1, undefined, "local:7b"), session("c", 0, 1)], [], new Date(), {})!;
    expect(without).toMatchObject({ costUsd: null, costEstimated: false, unpricedModels: ["qwen/qwen3.5-9b", "local:7b"] }); // c has no tokens: nothing to price
  });

  it("a running task counts up to now; an old task without phaseHistory has no statistics", () => {
    const running = task({ status: "ACTIVE", phase: "IMPLEMENT", phaseHistory: [{ phase: "DISCUSS", at: at(0) }, { phase: "IMPLEMENT", at: at(5) }] });
    const st = taskStats(running, [], ["task-000"], new Date(at(8)))!;
    expect(st).toMatchObject({ finishedAt: null, elapsedMs: 8 * 60_000, usage: null, costUsd: null, countedIn: ["task-000"] });
    expect(st.phases).toEqual([{ phase: "DISCUSS", ms: 5 * 60_000 }, { phase: "IMPLEMENT", ms: 3 * 60_000 }]);
    expect(taskStats(task({ phaseHistory: undefined }), [], [])).toBeNull();
    const closedOutside = task({ phaseHistory: [{ phase: "DISCUSS", at: at(0) }], updatedAt: at(4) }); // COMPLETED without a DONE entry
    expect(taskStats(closedOutside, [], [], new Date(at(50)))).toMatchObject({ finishedAt: at(4), elapsedMs: 4 * 60_000 });
  });
});
