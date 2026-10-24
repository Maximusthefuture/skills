import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outsideChange, shellWrites } from "../../src/changeGuard.js";
import { runHookCli } from "../../src/hook.js";
import { NetworkService } from "../../src/service.js";
import { estimateCost } from "../../src/runner.js";
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
    expect(out.result()).toEqual({ partial: true, model: "claude-haiku-4-5", usage: { input: 2415, output: 70, cacheRead: 2200, cacheCreation: 200, total: 2485 } });
  });

  it("prices the tokens at the rate the same model cost in sessions that reported it", () => {
    const usage = { input: 1200, output: 100, cacheRead: 1000, cacheCreation: 0, total: 1300 };
    // weighted: 200 fresh + 5*100 + 0.1*1000 = 800 tokens for $0.008: $0.00001 each
    expect(estimateCost({ input: 2400, output: 200, cacheRead: 2000, cacheCreation: 0, total: 2600 }, [{ usage, costUsd: 0.008 }])).toBeCloseTo(0.016, 6);
    expect(estimateCost(usage, [])).toBeUndefined();
  });
});
