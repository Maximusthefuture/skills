import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_TOOLS, parseBuildCommand, runBuild } from "../../src/build.js";
import { summarizeBuild, testTotals } from "../../src/buildSummary.js";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";

const MAVEN_RED = `[INFO] Scanning for projects...
[INFO] Building orders-service 0.1.0
${Array.from({ length: 400 }, (_, i) => `2026-10-11 INFO  o.s.b.SpringApplication - started bean ${i}`).join("\n")}
[ERROR] Tests run: 12, Failures: 1, Errors: 1, Skipped: 0, Time elapsed: 3.2 s <<< FAILURE! -- in com.shop.OrderServiceTest
[ERROR] com.shop.OrderServiceTest.savesCurrency -- Time elapsed: 0.1 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <EUR> but was: <USD>
	at org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:151)
[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   OrderServiceTest.savesCurrency:42 expected: <EUR> but was: <USD>
[ERROR] Errors:
[ERROR]   OrderApiIT.create » IllegalState Failed to load ApplicationContext
[INFO]
[ERROR] Tests run: 180, Failures: 1, Errors: 1, Skipped: 0
[INFO]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.2.5:test (default-test) on project orders-service: There are test failures.
[ERROR]
[ERROR] Please refer to /x/target/surefire-reports for the individual test results.
[ERROR] -> [Help 1]`;

const MAVEN_COMPILE = `[INFO] Compiling 42 source files
[ERROR] COMPILATION ERROR :
[ERROR] /x/src/main/java/com/shop/Order.java:[12,17] cannot find symbol
[ERROR]   symbol:   variable currency
[ERROR]   location: class com.shop.Order
[INFO] 1 error
[INFO] BUILD FAILURE
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.11.0:compile (default-compile) on project orders-service: Compilation failure`;

const GRADLE_RED = `> Task :compileJava
> Task :test

OrderServiceTest > savesCurrency() FAILED
    org.opentest4j.AssertionFailedError at OrderServiceTest.java:42

12 tests completed, 1 failed

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':test'.

BUILD FAILED in 14s`;

const VITEST_RED = ` FAIL  test/unit/cart.test.ts > cart > adds an item
AssertionError: expected 2 to be 3
 ❯ test/unit/cart.test.ts:12:20
${Array.from({ length: 100 }, (_, i) => ` ✓ test/unit/other${i}.test.ts (3 tests) 12ms`).join("\n")}

 Test Files  1 failed | 29 passed (30)
      Tests  1 failed | 388 passed (389)
   Duration  14.71s`;

describe("build summary", () => {
  it("Maven red: totals, the failing tests and the goal, not the Spring log", () => {
    const s = summarizeBuild(MAVEN_RED, 1, 133_000, { logPath: ".agent-network/builds/build-001.log" });
    expect(s).toMatchObject({ ok: false, tests: { total: 180, failed: 2 } });
    const lines = s.text.split("\n");
    expect(lines[0]).toBe("FAIL (exit 1) in 2m13s · tests: 180, failed: 2");
    expect(lines[1]).toContain(".agent-network/builds/build-001.log");
    expect(s.text).toContain("OrderServiceTest.savesCurrency:42 expected: <EUR> but was: <USD>");
    expect(s.text).toContain("OrderApiIT.create » IllegalState Failed to load ApplicationContext");
    expect(s.text).toContain("BUILD FAILURE");
    expect(s.text).not.toContain("started bean");
    expect(s.text).not.toContain("[Help 1]"); // Maven's advice lines are noise
    expect(lines.length).toBeLessThanOrEqual(60);
  });

  it("Maven compile error with its symbol and location", () => {
    const s = summarizeBuild(MAVEN_COMPILE, 1, 9000);
    expect(s.text).toContain("Order.java:[12,17] cannot find symbol");
    expect(s.text).toContain("symbol:   variable currency");
    expect(s.text).toContain("location: class com.shop.Order");
    expect(s.tests).toBeUndefined();
  });

  it("Maven green (-q prints nothing): one line", () => {
    const s = summarizeBuild("", 0, 18_200);
    expect(s).toMatchObject({ ok: true, text: "PASS in 18s" });
    const noisy = Array.from({ length: 50 }, (_, i) => `2026-10-11 20:15:0${i % 10}.123 DEBUG [main] o.s.b.f.s.DefaultListableBeanFactory - Creating bean ${i}`).join("\n");
    expect(summarizeBuild(noisy, 0, 3000).text).toBe("PASS in 3s"); // the tests' logging is no outcome
  });

  it("Gradle and vitest", () => {
    const g = summarizeBuild(GRADLE_RED, 1, 14_000);
    expect(g.tests).toEqual({ total: 12, failed: 1 });
    expect(g.text).toContain("OrderServiceTest > savesCurrency() FAILED");
    expect(g.text).toContain("AssertionFailedError at OrderServiceTest.java:42");
    expect(g.text).toContain("Execution failed for task ':test'.");
    const v = summarizeBuild(VITEST_RED, 1, 15_000);
    expect(v.tests).toEqual({ total: 389, failed: 1 });
    expect(v.text).toContain("FAIL  test/unit/cart.test.ts > cart > adds an item");
    expect(v.text).toContain("AssertionError: expected 2 to be 3");
    expect(v.text).not.toContain("other50");
    expect(testTotals(["Tests:       1 failed, 5 passed, 6 total"])).toEqual({ total: 6, failed: 1 }); // jest
    expect(testTotals(["# tests 5", "# suites 0", "# pass 4", "# fail 1", "# duration_ms 54"])).toEqual({ total: 5, failed: 1 }); // node --test
  });

  it("caps a huge failure output", () => {
    const s = summarizeBuild(Array.from({ length: 5000 }, (_, i) => `error ${i}: ${"x".repeat(500)}`).join("\n"), 2, 1000);
    expect(s.text.split("\n").length).toBeLessThanOrEqual(61);
    expect(s.text.length).toBeLessThanOrEqual(4100);
  });
});

describe("build command", () => {
  const tools = [...BUILD_TOOLS];
  it("splits like a shell, drops a trailing output filter, refuses what needs a shell or is no build tool", () => {
    expect(parseBuildCommand("./mvnw -q test -Dtest='Order*Test' -Dsurefire.timeout=300", tools)).toEqual({ argv: ["./mvnw", "-q", "test", "-Dtest=Order*Test", "-Dsurefire.timeout=300"] });
    expect(parseBuildCommand('npm test -- -t "adds an item"', tools).argv).toEqual(["npm", "test", "--", "-t", "adds an item"]);
    expect(parseBuildCommand("./mvnw -q verify 2>&1 | tail -60", tools)).toEqual({ argv: ["./mvnw", "-q", "verify"], dropped: "2>&1 | tail -60" });
    expect(parseBuildCommand("../mvnw -q verify", tools).argv[0]).toBe("../mvnw");
    expect(() => parseBuildCommand("cd x && ./mvnw verify", tools)).toThrow(/no &&/);
    expect(() => parseBuildCommand("./mvnw verify > out.txt", tools)).toThrow(/without a shell/);
    expect(() => parseBuildCommand("./mvnw -Dx=$HOME verify", tools)).toThrow(/without a shell/);
    expect(() => parseBuildCommand("rm -rf target", tools)).toThrow(/build tools only/);
    expect(() => parseBuildCommand("", tools)).toThrow(/needs a command/);
  });
});

describe("running a build", () => {
  it("writes the whole output to a log, keeps the last five, answers with the summary", async () => {
    const cwd = await tmpDir();
    for (let i = 0; i < 6; i++) {
      await runBuild({ cwd, argv: ["node", "-e", `console.log("line ${i}"); console.error("Tests  ${i} failed | 1 passed (${i + 1})"); process.exit(${i ? 1 : 0})`], timeoutMs: 30_000 });
    }
    const dir = join(cwd, ".agent-network", "builds");
    expect(readdirSync(dir).sort()).toEqual(["build-002.log", "build-003.log", "build-004.log", "build-005.log", "build-006.log"]);
    expect(readFileSync(join(dir, "build-006.log"), "utf8")).toContain("line 5");
    const r = await runBuild({ cwd, argv: ["node", "-e", 'console.log("Tests  2 failed | 3 passed (5)"); process.exit(1)'], timeoutMs: 30_000 });
    expect(r).toMatchObject({ ok: false, exitCode: 1, timedOut: false, logPath: join(".agent-network", "builds", "build-007.log"), tests: { total: 5, failed: 2 } });
    expect(r.summary.split("\n")[0]).toMatch(/^FAIL \(exit 1\) in \d+s · tests: 5, failed: 2$/);
  });

  it("a timeout stops the whole process group (the forked test JVM too)", async () => {
    const cwd = await tmpDir();
    const pidFile = join(cwd, "child.pid");
    const script = `const c=require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},1e9)"],{stdio:"ignore"});require("fs").writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},1e9)`;
    const r = await runBuild({ cwd, argv: ["node", "-e", script], timeoutMs: 1500 });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(r.summary).toMatch(/^TIMEOUT/);
    const pid = Number(readFileSync(pidFile, "utf8"));
    await new Promise((d) => setTimeout(d, 300));
    expect(() => process.kill(pid, 0)).toThrow(); // the grandchild is gone
  });

  it("the swarm tool: the task's verifyCommand by default, an event for the page, no task needed for an explicit command", async () => {
    const root = await tmpDir();
    const dir = join(root, ".agent-network");
    const workdir = join(root, "backend");
    mkdirSync(workdir);
    writeFileSync(join(workdir, "package.json"), JSON.stringify({ scripts: { test: 'node -e "console.log(42)"' } }));
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const backend = await NetworkService.create(dir, { id: "backend", type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
    const swarm = new Swarm(backend, () => undefined, { workdir, buildTools: [...BUILD_TOOLS, "node"] });
    await expect(swarm.build({})).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("no verifyCommand") });
    expect(await swarm.build({ command: "node -e 'process.exit(3)'" })).toMatchObject({ status: "FAIL", log: join(".agent-network", "builds", "build-001.log") });

    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], verifyCommand: "npm test --silent 2>&1 | tail -5" });
    const res = await swarm.build({});
    expect(res).toMatchObject({ status: "PASS", note: expect.stringContaining("tail -5") });
    expect(String(res.summary)).toMatch(/^PASS in \d+s\nfull log: \.agent-network\/builds\/build-002\.log[^\n]*$/); // "42" is no total
    const events = (await operator.events.list(task.id)).map((e) => e.event);
    expect(events.filter((e) => e.type === "BUILD_RAN").map((e) => e.payload)).toEqual([
      expect.objectContaining({ agentId: "backend", command: "npm test --silent", ok: true, exitCode: 0 }),
    ]);
    expect(existsSync(join(workdir, ".agent-network", "builds", "build-002.log"))).toBe(true);
  });
});
