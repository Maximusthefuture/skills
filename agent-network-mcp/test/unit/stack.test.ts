import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { Scheduler } from "../../src/schedule/scheduler.js";
import { NetworkService } from "../../src/service.js";
import { detectStack, onPath, withBuildPermissions } from "../../src/stack.js";
import { installedTemplates, loadRunnersConfig, PACKAGE_DIR, projectRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });

/** A project folder with these files in its root (content "" unless given). */
async function project(files: Record<string, string>): Promise<string> {
  const dir = join(await tmpDir(), "shop");
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: "shop", scripts });

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("the project's stack", () => {
  it("Maven and Gradle: the wrapper when the project has one, a verify command the build tool reads", async () => {
    expect(await detectStack(await project({ "pom.xml": "", mvnw: "" }))).toEqual({ name: "maven", marker: "pom.xml", shell: ["./mvnw"], verifyCommand: "./mvnw -q -B verify -Dsurefire.timeout=900", instructions: "" });
    expect(await detectStack(await project({ "pom.xml": "" }))).toMatchObject({ shell: ["mvn"], verifyCommand: "mvn -q -B verify -Dsurefire.timeout=900" });
    expect(await detectStack(await project({ "build.gradle.kts": "", gradlew: "" }))).toEqual({ name: "gradle", marker: "build.gradle.kts", shell: ["./gradlew"], verifyCommand: "./gradlew check --console=plain", instructions: "gradle" });
    expect(await detectStack(await project({ "settings.gradle": "" }))).toMatchObject({ shell: ["gradle"], verifyCommand: "gradle check --console=plain" });
    // a package.json next to a JVM build (a frontend, tooling) does not make it an npm project
    expect(await detectStack(await project({ "pom.xml": "", "package.json": pkg({ test: "vitest" }) }))).toMatchObject({ name: "maven" });
  });

  it("npm, yarn, pnpm by the lockfile; the verify command from the scripts that check the whole project", async () => {
    expect(await detectStack(await project({ "package.json": pkg({ test: "vitest run", lint: "eslint ." }) }))).toEqual({ name: "npm", marker: "package.json", shell: ["npm test", "npm run"], verifyCommand: "npm test", instructions: "npm" });
    expect(await detectStack(await project({ "package.json": pkg({ test: "jest", check: "tsc && jest" }), "yarn.lock": "" }))).toMatchObject({ name: "yarn", shell: ["yarn test", "yarn run"], verifyCommand: "yarn run check" });
    expect(await detectStack(await project({ "package.json": pkg({ test: "vitest" }), "pnpm-lock.yaml": "" }))).toMatchObject({ name: "pnpm", verifyCommand: "pnpm test" });
    // what npm init writes into "test" only fails: the build is the best there is
    expect(await detectStack(await project({ "package.json": pkg({ test: 'echo "Error: no test specified" && exit 1', build: "tsc" }) }))).toMatchObject({ verifyCommand: "npm run build" });
    const none = await detectStack(await project({ "package.json": "{ broken" }));
    expect(none).toMatchObject({ name: "npm" });
    expect(none).not.toHaveProperty("verifyCommand");
    expect(await detectStack(await project({ "main.py": "" }))).toBeNull();
  });

  it("the template's ./mvnw permission becomes the stack's, for Claude Code and for Qwen", async () => {
    const npm = (await detectStack(await project({ "package.json": pkg({ test: "vitest" }) })))!;
    expect(withBuildPermissions(["claude", "--allowedTools", "Read", "Bash(./mvnw:*)", "Bash(git diff:*)"], npm)).toEqual(["claude", "--allowedTools", "Read", "Bash(npm test:*)", "Bash(npm run:*)", "Bash(git diff:*)"]);
    expect(withBuildPermissions(["qwen", "run_shell_command(./mvnw)"], npm)).toEqual(["qwen", "run_shell_command(npm test)", "run_shell_command(npm run)"]);
  });

  it("the agent CLIs on PATH pick the template", async () => {
    const bin = await tmpDir();
    writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
    chmodSync(join(bin, "claude"), 0o755);
    writeFileSync(join(bin, "qwen"), "not executable");
    expect(await onPath("claude", { PATH: bin })).toBe(true);
    expect(await onPath("qwen", { PATH: bin })).toBe(false);
    expect(await installedTemplates({ PATH: bin })).toEqual(["claude"]);
  });
});

describe("a project's first config fitted to its stack", () => {
  async function repo(files: Record<string, string>): Promise<string> {
    const dir = await project(files);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "add", ".");
    git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    return dir;
  }

  it("npm: build permissions, verifyCommand and the npm role instructions, and it loads as it is", async () => {
    const dir = await repo({ "package.json": pkg({ test: "vitest run" }) });
    const own = await projectRunnersConfig(dir, "claude");
    expect(own).toMatchObject({ created: true, stack: { name: "npm" } });
    const raw = JSON.parse(readFileSync(own.path, "utf8"));
    expect(raw._comment[1]).toContain("Fitted to the project's stack, npm (package.json)");
    expect(raw.verifyCommand).toBe("npm test");
    expect(raw.defaults.command).toContain("Bash(npm run:*)");
    expect(raw.defaults.command).not.toContain("Bash(./mvnw:*)");
    expect(raw.agents.map((a: { instructionsFile: string }) => a.instructionsFile)).toEqual(["backend", "reviewer", "tester"].map((r) => `{agentNetworkMcp}/examples/runner/instructions/npm/${r}.md`));
    expect(raw.spawn.templates.backend.instructionsFile).toBe("{agentNetworkMcp}/examples/runner/instructions/npm/backend.md");

    const config = await loadRunnersConfig(own.path, { projectDir: dir });
    expect(config.verifyCommand).toBe("npm test");
    expect(config.agents[0]!.instructionsFile).toBe(join(PACKAGE_DIR, "examples", "runner", "instructions", "npm", "backend.md"));
  });

  it("Gradle with the Qwen template; a project without a known build keeps Maven's but gets no verifyCommand", async () => {
    const gradle = await projectRunnersConfig(await repo({ "build.gradle": "", gradlew: "" }), "qwen");
    const raw = JSON.parse(readFileSync(gradle.path, "utf8"));
    expect(raw.verifyCommand).toBe("./gradlew check --console=plain");
    expect(raw.defaults.command).toContain("run_shell_command(./gradlew)");
    expect(raw.agents[1].instructionsFile).toBe("{agentNetworkMcp}/examples/runner/instructions/gradle/reviewer.md");

    const python = await projectRunnersConfig(await repo({ "main.py": "" }), "claude");
    const plain = JSON.parse(readFileSync(python.path, "utf8"));
    expect(python.stack).toBeNull();
    expect(plain).not.toHaveProperty("verifyCommand");
    expect(plain.defaults.command).toContain("Bash(./mvnw:*)");
    expect(plain.agents[0].instructionsFile).toBe("{agentNetworkMcp}/examples/runner/instructions/backend.md");
    expect(plain._comment[1]).toContain("No pom.xml, build.gradle or package.json");
  });

  it("ui says what it found: the template from PATH and the stack", async () => {
    const dir = await repo({ "package.json": pkg({ test: "vitest run" }) });
    const bin = await tmpDir();
    writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
    chmodSync(join(bin, "claude"), 0o755);
    const out: string[] = [];
    // the port is checked after the config is written: the test stops before any runner starts
    expect(await runCli(["ui", "--port", "70000"], { PATH: bin }, (l) => out.push(l), dir)).toBe(2);
    expect(out[0]).toBe("template: claude (the only agent CLI on PATH; --template picks another)");
    expect(out[1]).toContain("(new, from the claude template");
    expect(out[2]).toBe('stack: npm (package.json): the agents may run npm test, npm run; verifyCommand "npm test"');
  });
});

describe("verifyCommand in runners.json", () => {
  it("is checked like a build command and is the default of the page's and the schedules' tasks", async () => {
    const dir = await tmpDir();
    const networkDir = join(dir, ".agent-network");
    const path = join(dir, "runners.json");
    const write = (extra: Record<string, unknown>, schedule: Record<string, unknown> = {}) =>
      writeFile(path, JSON.stringify({ networkDir, defaults: { command: ["x", "{prompt}"] }, agents: [{ id: "backend" }, { id: "reviewer" }], schedules: [{ id: "nightly", cron: "@daily", title: "n", agents: ["backend", "reviewer"], ...schedule }], ...extra }));
    await write({ verifyCommand: "npm test && npm run lint" });
    await expect(loadRunnersConfig(path)).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining('"verifyCommand": build runs one plain command') });
    await write({ verifyCommand: "npm test" });
    const config = await loadRunnersConfig(path);
    expect(config.verifyCommand).toBe("npm test");

    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const scheduler = new Scheduler({ networkDir, schedules: config.schedules!, configPath: path, verifyCommand: "npm test" });
    expect((await scheduler.runNow("nightly")).taskId).toBe("task-001");
    await write({ verifyCommand: "npm test" }, { verifyCommand: "npm run check" });
    await operator.cancelTask("task-001");
    await scheduler.tick(); // reads the file again
    expect((await scheduler.runNow("nightly")).taskId).toBe("task-002");
    await operator.cancelTask("task-002");

    const pool = new RunnerPool(networkDir, [{ id: "backend", command: ["x"], autostart: false }, { id: "reviewer", command: ["x"], autostart: false }]);
    ui = await startUiServer([{ networkDir, runners: pool, verifyCommand: "npm test" }], { port: 0 });
    const post = async (body: Record<string, unknown>) =>
      ((await (await fetch(`${ui!.url}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "t", description: "d", agents: ["backend", "reviewer"], ...body }) })).json()) as { task: { id: string } }).task.id;
    const ids = [await post({}), await post({ verifyCommand: "" }), await post({ verifyCommand: "npm run e2e" })];
    for (const id of ids.slice(0, 2)) await operator.cancelTask(id);
    expect((await operator.tasks.list()).map((t) => t.verifyCommand)).toEqual(["npm test", "npm run check", "npm test", undefined, "npm run e2e"]);
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as { control: { verifyCommand: string } };
    expect(state.control.verifyCommand).toBe("npm test");
  });
});
