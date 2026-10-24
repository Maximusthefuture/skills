import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outsideChange, shellWrites } from "../../src/changeGuard.js";
import { runHookCli } from "../../src/hook.js";
import { NetworkService } from "../../src/service.js";
import { collectStats, learnRates, sessionCost } from "../../src/stats.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { SessionStore, type SessionRecord } from "../../src/stores/sessionStore.js";
import { SessionOutput } from "../../src/sessionOutput.js";
import { tmpDir } from "../helpers/tmp.js";

const scope = { change: "add-gift", dir: "openspec/changes/add-gift" };

describe("a change-writing task writes only its change folder", () => {
  it("paths: the change folder and anything outside the project are fine, other project files are not", () => {
    const cwd = "/work/shop-backend";
    expect(outsideChange(["openspec/changes/add-gift/design.md", "/work/shop-backend/openspec/changes/add-gift/specs/a/spec.md", "/tmp/notes.txt", "/dev/null"], cwd, scope)).toEqual([]);
    expect(outsideChange(["src/main/java/Order.java", "/work/shop-backend/pom.xml", "openspec/changes/other/x.md", "openspec/changes/add-gift-2/x.md"], cwd, scope)).toEqual([
      "src/main/java/Order.java", "/work/shop-backend/pom.xml", "openspec/changes/other/x.md", "openspec/changes/add-gift-2/x.md",
    ]);
  });

  it("shell: what a command writes — rm, mv, cp, sed -i, redirections, git checkout/restore/reset", () => {
    expect(shellWrites("rm -f src/test/A.java src/test/B.java").paths).toEqual(["src/test/A.java", "src/test/B.java"]);
    expect(shellWrites("cp /tmp/x.md openspec/changes/add-gift/design.md").paths).toEqual(["openspec/changes/add-gift/design.md"]);
    expect(shellWrites("mv a.md b.md").paths).toEqual(["a.md", "b.md"]);
    expect(shellWrites("sed -i '' 's/a/b/' src/Order.java").paths).toEqual(["src/Order.java"]);
    expect(shellWrites('echo "x" > src/Order.java && cat pom.xml >> notes.txt').paths).toEqual(["src/Order.java", "notes.txt"]);
    expect(shellWrites("git checkout -- src/Order.java src/Test.java").paths).toEqual(["src/Order.java", "src/Test.java"]);
    expect(shellWrites("git checkout main").whole).toBe("git checkout main");
    expect(shellWrites("git reset --hard").whole).toBe("git reset --hard");
    expect(shellWrites("git stash").whole).toBe("git stash");
    for (const harmless of ["git status", "git diff HEAD", "git add openspec/changes/add-gift", 'git commit -m "change: a > b"', "openspec validate add-gift --strict", "cat src/Order.java", "grep -n x src 2>&1"]) {
      const w = shellWrites(harmless);
      expect(outsideChange(w.paths, "/work/shop", scope)).toEqual([]);
      expect(w.whole).toBeUndefined();
    }
  });

  it("the hooks refuse it in a change-writing task (pre-write, pre-bash) and let it through in any other task", async () => {
    const project = await tmpDir();
    mkdirSync(join(project, "openspec", "specs"), { recursive: true });
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const writing = await operator.createTaskAsOperator({ title: "", description: "gift", agents: ["backend", "reviewer"], proposes: "add-gift" });
    const coding = await operator.createTaskAsOperator({ title: "code", description: "write the code", agents: ["backend", "reviewer"] });
    const run = async (mode: string, taskId: string, input: object) => {
      const out: string[] = [];
      await runHookCli(mode, [], { NETWORK_DIR: networkDir, AGENT_ID: "backend", AGENT_NETWORK_RUNNER: "1", AGENT_NETWORK_TASK_ID: taskId }, (s) => out.push(s), async () => JSON.stringify({ ...input, cwd: project }), project);
      return out.length ? JSON.parse(out[0]!).hookSpecificOutput : null;
    };
    const code = { tool_name: "Write", tool_input: { file_path: join(project, "src/main/java/Order.java") } };
    expect(await run("pre-write", writing.id, code)).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: expect.stringContaining("src/main/java/Order.java is outside it") });
    expect(await run("pre-write", writing.id, { tool_name: "Edit", tool_input: { file_path: join(project, "openspec/changes/add-gift/design.md") } })).toBeNull();
    expect(await run("pre-write", coding.id, code)).toBeNull();

    const rm = { tool_name: "Bash", tool_input: { command: "rm -f src/test/java/OutboxPublisherTest.java" } };
    expect(await run("pre-bash", writing.id, rm)).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: expect.stringContaining("no rm") });
    expect(await run("pre-bash", writing.id, { tool_name: "Bash", tool_input: { command: "git checkout -- src/Order.java" } })).toMatchObject({ permissionDecision: "deny" });
    expect(await run("pre-bash", writing.id, { tool_name: "Bash", tool_input: { command: "git add openspec/changes/add-gift && git commit -m change" } })).toBeNull();
    expect(await run("pre-bash", coding.id, rm)).toBeNull();
  });
});

describe("a session stopped before its result still has its tokens and an estimated cost", () => {
  it("sums each model message once (every content block repeats its usage)", () => {
    const out = new SessionOutput(() => undefined);
    const msg = (id: string, block: object, usage: object) => out.feed(`${JSON.stringify({ type: "assistant", message: { id, content: [block], usage } })}\n`);
    out.feed(`${JSON.stringify({ type: "system", subtype: "init", model: "claude-haiku-4-5" })}\n`);
    const u1 = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50 };
    msg("m1", { type: "text", text: "a" }, u1);
    msg("m1", { type: "tool_use", id: "t", name: "Read", input: {} }, u1);
    msg("m2", { type: "text", text: "b" }, { input_tokens: 5, cache_read_input_tokens: 1200, output_tokens: 20 });
    // output is 0: a message event carries the count at the start of its stream, not what was written in the end
    expect(out.result()).toEqual({ partial: true, model: "claude-haiku-4-5", usage: { input: 2415, output: 0, cacheRead: 2200, cacheCreation: 200, total: 2415 } });
  });

  it("statistics price it at the rate the same model cost in the network's sessions that reported it, output left out", async () => {
    const at = "2026-10-24T10:00:00.000Z";
    const rec = (taskId: string, extra: Partial<SessionRecord>): Omit<SessionRecord, "id"> => ({ taskId, agentId: "backend", attempt: 1, startedAt: at, endedAt: at, durationMs: 1, exitCode: 0, ...extra });
    const done = rec("task-002", { model: "claude-haiku-4-5-20251001", costUsd: 0.04, usage: { input: 3000, output: 900, cacheRead: 2000, cacheCreation: 0, total: 3900 } });
    const stopped = rec("task-001", { model: "claude-haiku-4-5-20251001", usagePartial: true, usage: { input: 6000, output: 0, cacheRead: 4000, cacheCreation: 0, total: 6000 } });
    // read weight: 1000 fresh + 0.1 * 2000 cached = 1200 for $0.04; the stopped one reads twice that
    const rates = learnRates([done as SessionRecord, stopped as SessionRecord]);
    expect(sessionCost(stopped as SessionRecord, undefined, rates)).toEqual({ usd: 0.08, estimated: true });
    expect(sessionCost(stopped as SessionRecord, undefined)).toEqual({ estimated: false }); // nothing to learn from
    expect(sessionCost({ ...stopped, model: "claude-sonnet-4-5" } as SessionRecord, undefined, rates)).toEqual({ estimated: false }); // another model

    // the first task's only session was stopped: its price comes from another task of the network
    const dir = await tmpDir();
    const fs = await FileStore.open(join(dir, ".agent-network"));
    const store = new SessionStore(fs);
    await store.create(stopped);
    await store.create(done);
    const task = (id: string) => ({ id, phaseHistory: [{ phase: "DISCUSS", at }], createdAt: at, status: "ACTIVE", updatedAt: at }) as never;
    const stats = await collectStats(fs, [task("task-001"), task("task-002")], new Date(at));
    expect(stats.get("task-001")).toMatchObject({ costUsd: 0.08, costEstimated: true });
  });
});
