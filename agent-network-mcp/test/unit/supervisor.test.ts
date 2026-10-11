import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRun } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import type { ActivityItem } from "../../src/sessionOutput.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { MessageStore } from "../../src/stores/messageStore.js";
import { SessionStore } from "../../src/stores/sessionStore.js";
import { Journal } from "../../src/supervisor/journal.js";
import { Supervisor, type SupervisorOptions } from "../../src/supervisor/supervisor.js";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

interface Call {
  cwd: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  finish: (r: SessionRun) => void;
}

const running: Supervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.stop()));
});

const usage = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheCreation: 0, total: input + output });

/** A project with one task (backend + reviewer), a runners.json with a "supervisor" section, and a fake supervisor CLI. */
async function setup(supervisor: Record<string, unknown> = {}, extra: Partial<SupervisorOptions> = {}) {
  const projectDir = join(await tmpDir(), "shop");
  const backendDir = join(projectDir, "..", "shop-backend");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(backendDir, { recursive: true });
  const networkDir = join(projectDir, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const task = await operator.createTaskAsOperator({ title: "Multi-currency", description: "Prices in EUR and USD", agents: ["backend", "reviewer"] });
  await writeFile(join(projectDir, "sup.md"), "You are the supervisor of this swarm.");
  const configPath = join(projectDir, "runners.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        networkDir,
        defaults: { command: ["x", "{prompt}"] },
        agents: [{ id: "backend", cwd: backendDir }, { id: "reviewer" }],
        supervisor: { command: ["claude", "-p", "{prompt}", "--model", "{model}"], model: "sonnet", models: ["haiku", "sonnet"], promptFile: "sup.md", ...supervisor },
      },
      null,
      2,
    ),
  );
  const config = await loadRunnersConfig(configPath);
  const pool = new RunnerPool(networkDir, config.agents, { configPath });
  const fs = await FileStore.open(networkDir);
  const calls: Call[] = [];
  const run: SupervisorOptions["run"] = (argv, env, cwd, _sink, signal, onEvent: (e: ActivityItem) => void) =>
    new Promise((resolve) => {
      onEvent({ kind: "tool_use", tool: "mcp__supervisor__overview", summary: "overview" });
      signal.addEventListener("abort", () => resolve({ code: 143 }));
      calls.push({ cwd, argv, env, signal, finish: resolve });
    });
  const make = () => {
    const sup = new Supervisor({ networkDir, config: config.supervisor!, pool, configPath, pollMs: 20, run, ps: async () => "", now: () => Date.now() + 120_000, ...extra });
    sup.attach("http://127.0.0.1:9", "shop");
    running.push(sup);
    return sup;
  };
  const ask = (content: string) => new MessageStore(fs).create({ taskId: task.id, from: "backend", to: "operator", type: "QUESTION", content });
  const journal = () => new Journal(fs).list();
  return { task, pool, fs, calls, make, ask, journal, configPath, backendDir, networkDir };
}

const quiet = () => new Promise((r) => setTimeout(r, 150)); // several detector rounds at pollMs 20

describe("supervisor", () => {
  it("a question nobody answers wakes one session with the incidents; its cost is recorded like an agent's", async () => {
    const { task, pool, fs, calls, make, ask, journal, backendDir, networkDir } = await setup();
    await ask("Why does the lead not approve my proposal?");
    const sup = make();
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const { argv, env, cwd } = calls[0]!;
    expect(cwd.startsWith(join(networkDir, ".."))).toBe(false); // outside the project: no project CLAUDE.md, hooks or settings
    expect(argv.slice(0, 2)).toEqual(["claude", "-p"]);
    expect(argv.slice(-2)).toEqual(["--model", "sonnet"]);
    expect(argv[2]).toContain("You are the supervisor of this swarm.");
    expect(argv[2]).toContain('"kind": "question"');
    expect(argv[2]).toContain("Why does the lead not approve my proposal?");
    expect(env).toMatchObject({ AGENT_NETWORK_UI_URL: "http://127.0.0.1:9", AGENT_NETWORK_PROJECT: "shop", NETWORK_DIR: networkDir });
    expect(JSON.parse(env.AGENT_NETWORK_SUPERVISOR_FOLDERS!)).toEqual([{ agentId: "backend", cwd: backendDir }]);
    expect((await sup.status()).session).toMatchObject({ incidents: [expect.stringMatching(/^question:task-001:/)], model: "sonnet" });
    expect(pool.activity().find((e) => e.agentId === "supervisor" && e.kind === "tool_use")).toMatchObject({ tool: "mcp__supervisor__overview", taskId: task.id });

    calls[0]!.finish({ code: 0, sessionId: "5f0c-cli-session", result: { costUsd: 0.31, numTurns: 7, usage: usage(40_000, 900), model: "claude-sonnet-4-5", text: "Answered the question." } });
    await vi.waitFor(async () => expect((await journal()).map((e) => e.kind)).toEqual(["incident", "session"]));
    const [incident, session] = await journal();
    expect(incident).toMatchObject({ by: "detector", taskId: task.id, text: expect.stringContaining("Why does the lead not approve") });
    expect(session).toMatchObject({ by: "supervisor", taskId: task.id, text: expect.stringMatching(/exit 0, 7 turns · \$0\.31.*Answered the question\./) });
    expect(session!.data).toMatchObject({ session: "session-001", log: "supervisor/sessions/session-001.jsonl", cliSessionId: "5f0c-cli-session" });
    // the whole session on disk: the prompt with the incidents, every event, the end
    const log = (await readFile(join(networkDir, "supervisor", "sessions", "session-001.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(log.map((l) => l.type)).toEqual(["start", "event", "end"]);
    expect(log[0]).toMatchObject({ session: "session-001", cli: "claude", model: "sonnet", incidents: [expect.objectContaining({ kind: "question", taskId: task.id })], prompt: expect.stringContaining("You are the supervisor of this swarm.") });
    expect(log[1]).toMatchObject({ kind: "tool_use", tool: "mcp__supervisor__overview" });
    expect(log[2]).toMatchObject({ exitCode: 0, numTurns: 7, usd: 0.31, estimated: false, cliSessionId: "5f0c-cli-session", text: "Answered the question." });
    const recorded = (await new SessionStore(fs).list(task.id)).filter((s) => s.agentId === "supervisor");
    expect(recorded).toEqual([expect.objectContaining({ attempt: 1, exitCode: 0, costUsd: 0.31, numTurns: 7, model: "claude-sonnet-4-5" })]);
    expect(await sup.status()).toMatchObject({ session: null, sessionsLastHour: 1, spend24h: { usd: 0.31, unpriced: 0 }, queued: 0 });

    await quiet();
    expect(calls).toHaveLength(1); // handled: the same question does not wake it again
  });

  it("one session at a time: what comes up meanwhile waits for the next one", async () => {
    const { calls, make, ask } = await setup();
    await ask("first");
    const sup = make();
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await ask("second");
    await vi.waitFor(async () => expect((await sup.status()).queued).toBe(1));
    expect(calls).toHaveLength(1);

    calls[0]!.finish({ code: 0 });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.argv[2]).toContain("nobody answered: second");
    expect(calls[1]!.argv[2]).not.toContain("nobody answered: first"); // that one went to the first session
  });

  it("holds the queue at the hourly limit and says why", async () => {
    const { calls, make, ask, journal } = await setup({ maxSessionsPerHour: 1 });
    await ask("first");
    const sup = make();
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.finish({ code: 0 });
    await ask("second");
    await vi.waitFor(async () => expect((await sup.status()).held).toBe("1 supervisor sessions in the last hour (limit 1)"));
    expect((await journal()).find((e) => e.kind === "note")).toMatchObject({ text: expect.stringContaining("Supervisor holds 1 incident(s)") });
    await quiet();
    expect(calls).toHaveLength(1);
  });

  it("holds the queue when the daily budget is spent; a session without a CLI cost is priced with the project's prices", async () => {
    const prices = { "qwen/qwen3-coder-30b": { input: 2, output: 8 } }; // USD per 1M tokens
    const { calls, make, ask } = await setup({ budgetUsd: 0.1 }, { prices: async () => ({ prices }) });
    await ask("first");
    const sup = make();
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.finish({ code: 0, result: { usage: usage(100_000, 1000), model: "qwen/qwen3-coder-30b" } }); // 0.2 + 0.008
    await ask("second");
    await vi.waitFor(async () => expect((await sup.status()).held).toBe("$0.21 spent in 24 h (budget $0.1)"));
    expect((await sup.status()).spend24h.usd).toBeCloseTo(0.208);
    expect(calls).toHaveLength(1);
  });

  it("remembers what it handled across a restart of the page", async () => {
    const { calls, make, ask } = await setup();
    await ask("first");
    const first = make();
    first.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.finish({ code: 0 });
    await vi.waitFor(async () => expect((await first.status()).session).toBeNull());
    await first.stop();

    const second = make();
    second.start();
    await quiet();
    expect(calls).toHaveLength(1);
    await ask("after the restart");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.argv[2]).toContain("after the restart");
  });

  it("model and tools chosen on the page: checked, written back to runners.json, used from the next session", async () => {
    const { calls, make, ask, configPath } = await setup();
    const sup = make();
    expect((await sup.status()).models).toEqual(["haiku", "sonnet"]);
    await expect(sup.setModel("bad model")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await sup.setModel("haiku");
    await expect(sup.setToolEnabled("nope", false)).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("kill_test") });
    const st = await sup.setToolEnabled("kill_test", false);
    expect(st.tools.find((t) => t.name === "kill_test")).toMatchObject({ builtin: true, enabled: false });
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved.supervisor).toMatchObject({ model: "haiku", disabledTools: ["kill_test"], promptFile: "sup.md" });

    await ask("which model?");
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.argv.slice(-2)).toEqual(["--model", "haiku"]);
    expect(JSON.parse(calls[0]!.env.AGENT_NETWORK_SUPERVISOR_TOOLS!)).toEqual({ tools: [], disabled: ["kill_test"] });
  });

  it("thresholds set on the page: checked, written back to runners.json", async () => {
    const { make, configPath } = await setup();
    const sup = make();
    expect((await sup.setRules({ checkInMin: 1, stallMin: 20 })).rules).toMatchObject({ checkInMin: 1, stallMin: 20, questionAfterSec: 60 });
    expect(JSON.parse(await readFile(configPath, "utf8")).supervisor.rules).toMatchObject({ checkInMin: 1, stallMin: 20 });
    await expect(sup.setRules({ checkInMin: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(sup.setRules({ nope: 1 })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("checkInMin") });
  });

  it("limits set on the page: checked, written back, the queue held by the old limit goes on", async () => {
    const { calls, make, ask, configPath } = await setup({ maxSessionsPerHour: 1 });
    await ask("first");
    const sup = make();
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.finish({ code: 0 });
    await ask("second");
    await vi.waitFor(async () => expect((await sup.status()).held).toContain("limit 1"), { timeout: 5000 });
    expect(await sup.setLimits({ maxSessionsPerHour: 12, budgetUsd: 3 })).toMatchObject({ maxSessionsPerHour: 12, budgetUsd: 3 });
    await vi.waitFor(() => expect(calls).toHaveLength(2), { timeout: 5000 }); // the held incident goes at the next look
    expect(JSON.parse(await readFile(configPath, "utf8")).supervisor).toMatchObject({ maxSessionsPerHour: 12, budgetUsd: 3 });
    expect((await sup.setLimits({ budgetUsd: null })).budgetUsd).toBeNull();
    await expect(sup.setLimits({ maxSessionsPerHour: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(sup.setLimits({ budgetUsd: -1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("a command without {model} offers no choice of model", async () => {
    const { make } = await setup({ command: ["qwen", "{prompt}"], model: undefined, models: undefined });
    const sup = make();
    expect(await sup.status()).toMatchObject({ cli: "qwen", model: null, models: [] });
    await expect(sup.setModel("haiku")).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("{model}") });
  });

  it("stop ends a running session and stops watching", async () => {
    const { calls, make, ask } = await setup();
    await ask("first");
    const sup = make();
    sup.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const st = await sup.stop();
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(st).toMatchObject({ enabled: false, session: null });
    await ask("second");
    await quiet();
    expect(calls).toHaveLength(1);
  });
});
