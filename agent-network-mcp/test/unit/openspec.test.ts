import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { archiveChange, hasChange, listChanges, parseTasks, readChange, type Exec } from "../../src/openspec.js";
import { isReviewOnly, NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

const TASKS = `# Tasks

## 1. API

- [ ] 1.1 Add currency to CreateOrderRequest — @WebMvcTest
- [ ] 1.2 Return currency in OrderResponse
  - [ ] a detail line, not a task
- [x] 1.3 Already done earlier

## 2. Validation

- [ ] 2.1 Reject an unknown currency with 400
`;

/** A project folder with an OpenSpec change; the network lives in <project>/.agent-network. */
function writeChange(project: string, name = "add-currency", tasks = TASKS): string {
  const dir = join(project, "openspec", "changes", name);
  mkdirSync(join(dir, "specs", "orders"), { recursive: true });
  writeFileSync(join(dir, "proposal.md"), "# Why\nOrders need a currency.\n");
  writeFileSync(join(dir, "design.md"), "# Design\n");
  writeFileSync(join(dir, "tasks.md"), tasks);
  writeFileSync(join(dir, "specs", "orders", "spec.md"), "## ADDED Requirements\n");
  return dir;
}

const tick = (dir: string, ids: string[]) => {
  const file = join(dir, "tasks.md");
  let text = readFileSync(file, "utf8");
  for (const id of ids) text = text.replace(`- [ ] ${id} `, `- [x] ${id} `);
  writeFileSync(file, text);
};

async function failure(swarm: Swarm, p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return swarm.errorBody(e);
  }
  throw new Error("expected the call to fail");
}

async function setup() {
  const project = await tmpDir();
  const changeDir = writeChange(project);
  const dir = join(project, ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const s: Record<string, Swarm> = {};
  for (const id of ["backend", "reviewer"]) {
    s[id] = new Swarm(await NetworkService.create(dir, { id, type: "test", role: id }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) }));
  }
  return { project, changeDir, dir, operator, backend: s.backend!, reviewer: s.reviewer! };
}

const split = [
  { agentId: "backend", responsibility: "API tasks", files: ["src/main/**"], tasks: ["1.1", "1.2"] },
  { agentId: "reviewer", responsibility: "validation", files: ["src/test/**"], tasks: ["2.1"] },
];

describe("openspec files", () => {
  it("reads numbered top-level tasks with their group; indented checkboxes are details", () => {
    expect(parseTasks(TASKS)).toEqual([
      { id: "1.1", text: "Add currency to CreateOrderRequest — @WebMvcTest", done: false, group: "1. API" },
      { id: "1.2", text: "Return currency in OrderResponse", done: false, group: "1. API" },
      { id: "1.3", text: "Already done earlier", done: true, group: "1. API" },
      { id: "2.1", text: "Reject an unknown currency with 400", done: false, group: "2. Validation" },
    ]);
    expect(parseTasks("- [X] 3 Done with a capital X")).toEqual([{ id: "3", text: "Done with a capital X", done: true }]);
    expect(() => parseTasks("## 1. A\n- [ ] add something")).toThrow(/line 2: a task without a number/);
    expect(() => parseTasks("- [ ] 1.1 a\n- [ ] 1.1 b")).toThrow(/task 1.1 appears twice/);
  });

  it("reads a change, lists the changes in progress and archives through the CLI", async () => {
    const project = await tmpDir();
    writeChange(project);
    writeChange(project, "broken", "- [ ] no number\n");
    mkdirSync(join(project, "openspec", "changes", "archive", "2026-01-01-old"), { recursive: true });

    const change = await readChange(project, "add-currency");
    expect(change.path).toBe("openspec/changes/add-currency");
    expect(change.files).toEqual([
      "openspec/changes/add-currency/proposal.md",
      "openspec/changes/add-currency/design.md",
      "openspec/changes/add-currency/tasks.md",
      "openspec/changes/add-currency/specs/orders/spec.md",
    ]);
    await expect(readChange(project, "missing")).rejects.toMatchObject({ code: "OPENSPEC_NOT_FOUND" });
    await expect(readChange(project, "../etc")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await listChanges(project)).toEqual([
      { name: "add-currency", done: 1, total: 4 },
      { name: "broken", done: 0, total: 0, error: expect.stringContaining("without a number") },
    ]);
    expect(await listChanges(join(project, "nope"))).toEqual([]);
    expect(await hasChange(project, "add-currency")).toBe(true);
    expect(await hasChange(join(project, "nope"), "add-currency")).toBe(false);

    const calls: unknown[] = [];
    const ok: Exec = async (cmd, args, opts) => {
      calls.push([cmd, args, opts.cwd]);
      return { stdout: "Change 'add-currency' archived", stderr: "" };
    };
    expect(await archiveChange(project, "add-currency", ok)).toBe("Change 'add-currency' archived");
    expect(calls).toEqual([["openspec", ["--no-color", "archive", "add-currency", "-y"], project]]);
    const missingCli: Exec = async () => {
      throw Object.assign(new Error("spawn openspec ENOENT"), { code: "ENOENT" });
    };
    await expect(archiveChange(project, "add-currency", missingCli)).rejects.toMatchObject({ code: "OPENSPEC_FAILED", message: expect.stringContaining("not on PATH") });
    const fails: Exec = async () => {
      throw Object.assign(new Error("exit 1"), { code: 1, stdout: "", stderr: "Validation failed: spec has no scenarios" });
    };
    await expect(archiveChange(project, "add-currency", fails)).rejects.toMatchObject({ message: expect.stringContaining("Validation failed") });
  });
});

describe("a swarm task on an OpenSpec change", () => {
  it("is created from the change: title, description pointing at it; a missing change is refused", async () => {
    const { operator } = await setup();
    const task = await operator.createTaskAsOperator({ title: "", description: "", agents: ["backend", "reviewer"], openspec: "add-currency" });
    expect(task).toMatchObject({ title: "add-currency", openspec: { change: "add-currency" } });
    expect(task.description).toMatch(/^Implement the OpenSpec change openspec\/changes\/add-currency\/: proposal.md/);
    const withText = await operator.createTaskAsOperator({ title: "Currency", description: "Only the API part, keep it small.", agents: ["backend", "reviewer"], openspec: "add-currency" });
    expect(withText.description).toMatch(/tasks\.md \(the numbered tasks.*\n\nOnly the API part, keep it small\.$/s);
    await expect(operator.createTaskAsOperator({ title: "x", description: "d", agents: ["backend", "reviewer"], openspec: "nope" })).rejects.toMatchObject({ code: "OPENSPEC_NOT_FOUND" });
  });

  it("DISCUSS shows the tasks and refuses a split that leaves an open task without exactly one agent", async () => {
    const { operator, backend, reviewer } = await setup();
    await operator.createTaskAsOperator({ title: "", description: "", agents: ["backend", "reviewer"], openspec: "add-currency" });
    const ctx = await backend.context();
    expect(ctx.openspec).toMatchObject({
      change: "add-currency",
      path: "openspec/changes/add-currency",
      files: expect.arrayContaining(["openspec/changes/add-currency/design.md"]),
      tasks: [{ id: "1.1", text: expect.any(String) }, { id: "1.2", text: expect.any(String) }, { id: "1.3", text: expect.any(String), done: true }, { id: "2.1", text: expect.any(String) }],
    });
    expect(ctx.hint).toContain("every open task of tasks.md goes to exactly one agent");
    expect((ctx.exampleCall as { args: { assignments: { tasks?: string[] }[] } }).args.assignments[0]!.tasks).toEqual([expect.stringContaining("tasks.md numbers")]);
    expect((await reviewer.context()).hint).toContain("which tasks of tasks.md and which files");

    const without = split.map(({ tasks: _t, ...a }) => a);
    expect(await failure(backend, backend.propose({ summary: "s", assignments: without }))).toMatchObject({ error: "OPENSPEC_TASKS", openTasks: ["1.1", "1.2", "2.1"] });
    const bad = await failure(backend, backend.propose({ summary: "s", assignments: [{ ...split[0]!, tasks: ["1.1", "1.3", "9.9"] }, { ...split[1]!, tasks: ["1.1"] }] }));
    expect(bad).toMatchObject({ error: "OPENSPEC_TASKS", missing: ["1.2", "2.1"], duplicated: [{ id: "1.1", agents: ["backend", "reviewer"] }], unknown: ["9.9"], alreadyDone: ["1.3"] });
    expect(bad.message).toContain("open tasks nobody took: 1.2, 2.1");
    const intruder = await failure(backend, backend.propose({ summary: "s", assignments: [split[0]!, { ...split[1]!, files: ["src/test/**", "openspec/**"] }] }));
    expect(intruder).toMatchObject({ error: "OPENSPEC_DIR_LEAD_ONLY", lead: "backend", agents: ["reviewer"] });

    await backend.propose({ summary: "split by tasks", assignments: split });
    const agreement = (await backend.context()).agreement as { assignments: { agentId: string; files: string[]; tasks: string[] }[] };
    expect(agreement.assignments).toEqual([
      expect.objectContaining({ agentId: "backend", files: ["src/main/**", "openspec/changes/add-currency/**"], tasks: ["1.1", "1.2"] }),
      expect.objectContaining({ agentId: "reviewer", files: ["src/test/**"], tasks: ["2.1"] }),
    ]);
    expect((await reviewer.context()).hint).toContain("the tasks.md numbers each agent takes");
  });

  it("agents report their task numbers, the lead ticks them, the operator archives after DONE", async () => {
    const { project, changeDir, dir, operator, backend, reviewer } = await setup();
    const task = await operator.createTaskAsOperator({ title: "", description: "", agents: ["backend", "reviewer"], openspec: "add-currency" });
    await backend.context();
    await backend.propose({ summary: "split by tasks", assignments: split });
    await reviewer.context();
    await reviewer.complete({});
    await backend.complete({});

    const impl = await backend.context();
    expect(impl.openspec).toEqual({ change: "add-currency", path: "openspec/changes/add-currency", yourTasks: [{ id: "1.1", text: expect.any(String) }, { id: "1.2", text: expect.any(String) }] });
    expect(impl.hint).toContain("Your OpenSpec tasks: 1.1, 1.2");
    expect(impl.hint).toContain("tasksDone: [<the numbers of your tasks you finished>]");
    expect(await failure(backend, backend.complete({ result: "api", filesChanged: ["src/main/Api.java"] }))).toMatchObject({ error: "INVALID_INPUT", yourTasks: ["1.1", "1.2"] });
    expect(await failure(backend, backend.complete({ result: "api", filesChanged: ["src/main/Api.java"], tasksDone: ["1.1", "2.1"] }))).toMatchObject({ error: "OPENSPEC_TASK_NOT_YOURS", notYours: ["2.1"] });
    // the change folder is the lead's: another agent changing tasks.md is refused like any other file it does not own
    expect(await failure(reviewer, reviewer.complete({ result: "v", filesChanged: ["openspec/changes/add-currency/tasks.md"], tasksDone: ["2.1"] }))).toMatchObject({ error: "FILE_NOT_OWNED" });
    await backend.complete({ result: "api", filesChanged: ["src/main/Api.java"], tasksDone: ["1.2", "1.1"] });
    await reviewer.complete({ result: "validation", filesChanged: ["src/test/ValidationTest.java"], tasksDone: ["2.1"] });

    const sync = await reviewer.context();
    expect(sync.teamImplementations).toEqual([expect.objectContaining({ agentId: "backend", tasksDone: ["1.1", "1.2"] })]);
    expect(sync.hint).toContain("against its scenarios in openspec/changes/add-currency/specs/");
    await backend.complete({ status: "PASS" });
    await reviewer.complete({ status: "PASS" });

    const integrate = await backend.context();
    expect(integrate.openspec).toEqual({
      change: "add-currency",
      path: "openspec/changes/add-currency",
      tasks: [
        { id: "1.1", owner: "backend", reportedDone: true },
        { id: "1.2", owner: "backend", reportedDone: true },
        { id: "2.1", owner: "reviewer", reportedDone: true },
      ],
    });
    expect(integrate.hint).toContain("tick [x] in openspec/changes/add-currency/tasks.md");
    expect(integrate.hint).toContain("openspec validate add-currency --strict");
    expect((await reviewer.context()).openspec).toEqual({ change: "add-currency", path: "openspec/changes/add-currency" });
    await backend.complete({ status: "PASS", result: "merged, build green, tasks ticked" });

    const calls: unknown[] = [];
    const exec: Exec = async (_cmd, args, opts) => {
      calls.push([args, opts.cwd]);
      return { stdout: "archived", stderr: "" };
    };
    const agentSide = await NetworkService.create(dir, { id: "reviewer", type: "test" });
    await expect(agentSide.archiveOpenspec({ taskId: task.id }, exec)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(operator.archiveOpenspec({ taskId: task.id }, exec)).rejects.toMatchObject({ code: "OPENSPEC_NOT_READY", details: { open: ["1.1", "1.2", "2.1"] } });
    tick(changeDir, ["1.1", "1.2", "2.1"]); // the lead's branch merged into the project folder
    const res = await operator.archiveOpenspec({ taskId: task.id }, exec);
    expect(res.output).toBe("archived");
    expect(res.task.openspec?.archivedAt).toEqual(expect.any(String));
    expect(calls).toEqual([[["--no-color", "archive", "add-currency", "-y"], project]]);
    await expect(operator.archiveOpenspec({ taskId: task.id }, exec)).rejects.toMatchObject({ code: "ALREADY_COMPLETED" });
  });

  it("an OpenSpec lead without tasks of its own still only reviews; task numbers mean nothing without a change", async () => {
    expect(isReviewOnly({ agentId: "a", responsibility: "r", files: ["openspec/changes/x/**"], tasks: [] })).toBe(true);
    expect(isReviewOnly({ agentId: "a", responsibility: "r", files: ["openspec/changes/x/**"], tasks: ["1.1"] })).toBe(false);
    expect(isReviewOnly({ agentId: "a", responsibility: "r", files: [] })).toBe(true);

    const { operator, backend, reviewer } = await setup();
    await operator.createTaskAsOperator({ title: "", description: "", agents: ["backend", "reviewer"], openspec: "add-currency" });
    await backend.context();
    await backend.propose({ summary: "reviewer builds, lead reviews", assignments: [{ agentId: "backend", responsibility: "review and integrate", files: [], tasks: [] }, { ...split[1]!, files: ["src/**"], tasks: ["1.1", "1.2", "2.1"] }] });
    await reviewer.context();
    await reviewer.complete({});
    await backend.complete({});
    expect((await backend.context()).hint).toContain("review only");

    const plain = await setup();
    await plain.operator.createTaskAsOperator({ title: "Plain", description: "No OpenSpec here, a plain task.", agents: ["backend", "reviewer"] });
    await plain.backend.context();
    await plain.backend.propose({ summary: "s", assignments: split });
    const agreement = (await plain.backend.context()).agreement as { assignments: Record<string, unknown>[] };
    expect(agreement.assignments.every((a) => !("tasks" in a))).toBe(true);
    expect((await plain.backend.context()).openspec).toBeUndefined();
  });
});

describe("the page and OpenSpec", () => {
  let ui: UiServer | undefined;
  afterEach(async () => {
    await ui?.close();
    ui = undefined;
  });
  const post = (path: string, body: unknown) => fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("lists the changes, checks the agents' folders before creating the task, archives on request", async () => {
    const { project, changeDir, dir, backend, reviewer } = await setup();
    const worktree = join(dirname(project), `${project.split("/").pop()}-reviewer`);
    mkdirSync(worktree, { recursive: true });
    const pool = new RunnerPool(dir, [
      { id: "backend", command: ["x"], cwd: project, autostart: false },
      { id: "reviewer", command: ["x"], cwd: worktree, autostart: false },
    ]);
    const exec: Exec = async () => ({ stdout: "archived", stderr: "" });
    ui = await startUiServer(dir, { port: 0, runners: pool, openspecExec: exec });

    expect(await (await fetch(`${ui.url}/api/openspec/changes`)).json()).toEqual({ projectDir: project, changes: [{ name: "add-currency", done: 1, total: 4 }] });

    const refused = await post("/api/tasks", { title: "", description: "", agents: ["backend", "reviewer"], openspec: "add-currency" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "OPENSPEC_NOT_FOUND", message: expect.stringContaining(`reviewer (${worktree})`) });
    writeChange(worktree); // committed and merged into the reviewer's branch
    const created = await post("/api/tasks", { title: "", description: "", agents: ["backend", "reviewer"], openspec: "add-currency" });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as { task: { id: string } };

    const state = async () => ((await (await fetch(`${ui!.url}/api/state`)).json()) as { tasks: { id: string; openspec: unknown }[] }).tasks.find((t) => t.id === task.id)!.openspec;
    expect(await state()).toEqual({ change: "add-currency", path: "openspec/changes/add-currency", archivedAt: null, progress: { done: 1, total: 4 }, error: null, assigned: [] });

    await backend.context();
    await backend.propose({ summary: "split", assignments: split });
    await reviewer.context();
    await reviewer.complete({});
    await backend.complete({});
    await backend.complete({ result: "api", filesChanged: ["src/main/Api.java"], tasksDone: ["1.1"] });
    expect(await state()).toMatchObject({ assigned: [{ agentId: "backend", tasks: ["1.1", "1.2"], done: ["1.1"] }, { agentId: "reviewer", tasks: ["2.1"], done: [] }] });

    const early = await post("/api/openspec/archive", { taskId: task.id });
    expect(await early.json()).toMatchObject({ error: "INVALID_PHASE" });
    await reviewer.complete({ result: "v", filesChanged: ["src/test/V.java"], tasksDone: ["2.1"] });
    await backend.complete({ status: "PASS" });
    await reviewer.complete({ status: "PASS" });
    await backend.complete({ status: "PASS", result: "merged" });
    tick(changeDir, ["1.1", "1.2", "2.1"]);
    const archived = await post("/api/openspec/archive", { taskId: task.id });
    expect(await archived.json()).toMatchObject({ output: "archived", task: { openspec: { archivedAt: expect.any(String) } } });
    expect(await state()).toMatchObject({ archivedAt: expect.any(String), progress: null });
  });
});
