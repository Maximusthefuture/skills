import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { validateChange, type Exec } from "../../src/openspec.js";
import { isReviewOnly, NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

/** What the author writes: openspec/changes/<name>/ with all four artifacts. */
function writeProposal(dir: string, name: string) {
  const c = join(dir, "openspec", "changes", name);
  mkdirSync(join(c, "specs", "loyalty"), { recursive: true });
  writeFileSync(join(c, "proposal.md"), "## Why\nRegular customers get a discount.\n");
  writeFileSync(join(c, "design.md"), "## Decisions\n");
  writeFileSync(join(c, "specs", "loyalty", "spec.md"), "## ADDED Requirements\n### Requirement: Discount\n#### Scenario: fifth order\n- WHEN ...\n- THEN ...\n");
  writeFileSync(join(c, "tasks.md"), "## 1. Discount\n\n- [ ] 1.1 Apply 5% from the fifth order\n");
}

async function failure(swarm: Swarm, p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return swarm.errorBody(e);
  }
  throw new Error("expected the call to fail");
}

/** A project that uses OpenSpec (openspec/ exists, no changes); `validate` answers as the test says. */
async function setup() {
  const project = await tmpDir();
  mkdirSync(join(project, "openspec", "specs"), { recursive: true });
  const dir = join(project, ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const validate = { result: "ok" as "ok" | "fail" | "missing", calls: [] as string[][] };
  const exec: Exec = async (cmd, args) => {
    validate.calls.push([cmd, ...args]);
    if (validate.result === "missing") throw Object.assign(new Error("spawn openspec ENOENT"), { code: "ENOENT" });
    if (validate.result === "fail") throw Object.assign(new Error("exit 1"), { code: 1, stdout: "✗ loyalty: requirement has no scenario", stderr: "" });
    return { stdout: "Change 'add-loyalty' is valid", stderr: "" };
  };
  const swarm = async (id: string) =>
    new Swarm(await NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) }), () => undefined, { workdir: project, openspecExec: exec });
  return { project, dir, operator, validate, backend: await swarm("backend"), reviewer: await swarm("reviewer") };
}

describe("a task that writes an OpenSpec change", () => {
  it("needs a project with openspec/, a free name, and does not also implement a change", async () => {
    const bare = await NetworkService.create(join(await tmpDir(), ".agent-network"), { id: "operator", type: "cli" });
    await expect(bare.createTaskAsOperator({ title: "", description: "d", agents: ["backend", "reviewer"], proposes: "add-loyalty" })).rejects.toMatchObject({ code: "OPENSPEC_NOT_FOUND", message: expect.stringContaining("openspec init") });

    const { project, operator } = await setup();
    await expect(operator.createTaskAsOperator({ title: "", description: "d", agents: ["backend", "reviewer"], proposes: "Add Loyalty" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const task = await operator.createTaskAsOperator({ title: "", description: "Regular customers: 5% off from the fifth order.", agents: ["backend", "reviewer"], proposes: "add-loyalty" });
    expect(task).toMatchObject({ title: "OpenSpec change add-loyalty", proposes: { change: "add-loyalty" } });
    expect(task.description).toMatch(/^Write the OpenSpec change openspec\/changes\/add-loyalty\/ .*no code changes.*\n\nWhat is wanted \(the operator's words\):\nRegular customers/s);
    writeProposal(project, "taken");
    await expect(operator.createTaskAsOperator({ title: "", description: "d", agents: ["backend", "reviewer"], proposes: "taken" })).rejects.toMatchObject({ message: expect.stringContaining("exists already") });
    await expect(operator.createTaskAsOperator({ title: "", description: "d", agents: ["backend", "reviewer"], proposes: "x", openspec: "taken" })).rejects.toMatchObject({ message: expect.stringContaining("not both") });
  });

  it("goes through the phases: the lead writes and validates, the reviewer reviews, no code", async () => {
    const { project, operator, validate, backend, reviewer } = await setup();
    const task = await operator.createTaskAsOperator({ title: "", description: "Loyalty discount.", agents: ["backend", "reviewer"], proposes: "add-loyalty" });

    const discuss = await backend.context();
    expect(discuss).toMatchObject({ nextAction: "propose", task: { proposes: { change: "add-loyalty", path: "openspec/changes/add-loyalty/" } } });
    expect((discuss as any).exampleCall.args.assignments).toEqual([
      { agentId: "backend", responsibility: "writes the change", files: ["openspec/changes/add-loyalty/**"] },
      { agentId: "reviewer", responsibility: "reviews the change", files: [] },
    ]);
    expect(await failure(backend, backend.propose({ summary: "x", assignments: [{ agentId: "backend", responsibility: "w", files: ["src/main/**"] }, { agentId: "reviewer", responsibility: "r", files: [] }] }))).toMatchObject({ error: "SPEC_ONLY" });
    await backend.propose({ summary: "loyalty", assignments: [{ agentId: "backend", responsibility: "writes", files: ["openspec/changes/add-loyalty/**"] }, { agentId: "reviewer", responsibility: "reviews", files: [] }] });
    await reviewer.context();
    await reviewer.complete({});
    await backend.complete({});

    // the author asks with choices, the operator picks: the answer is shown to author and reviewer, to go into design.md
    const asked = await backend.sendMessage({ to: "operator", message: "From the 5th order or the 6th?", options: [{ label: "5th" }, { label: "6th" }], recommended: "5th" });
    await operator.answerQuestion({ taskId: task.id, messageId: asked.messageId as string, answer: 'Chosen: "5th"' });
    const author = await backend.context();
    expect(author.operatorAnswers).toEqual([{ question: "From the 5th order or the 6th?", askedBy: "backend", answer: 'Chosen: "5th"' }]);
    expect(String(author.hint)).toContain("Record every answer of the operator");
    expect(author.nextAction).toBe("implement");
    expect(String(author.hint)).toContain("openspec new change add-loyalty");
    expect(String(author.hint)).toContain("role instructions about code");
    const agreement = await operator.agreements.find(task.id);
    expect(isReviewOnly(agreement!.assignments[0], task)).toBe(false);
    expect(isReviewOnly(agreement!.assignments[1], task)).toBe(true);
    expect(String((await reviewer.context()).hint)).toContain("review only");
    await reviewer.complete({ result: "review only: nothing to change" });

    // handed over only when it validates
    validate.result = "fail";
    expect(await failure(backend, backend.complete({ result: "written" }))).toMatchObject({ error: "OPENSPEC_INVALID", message: expect.stringContaining("requirement has no scenario") });
    validate.result = "missing"; // no CLI: the form is checked
    expect(await failure(backend, backend.complete({ result: "written" }))).toMatchObject({ error: "OPENSPEC_INVALID", message: expect.stringContaining("proposal.md is missing") });
    writeProposal(project, "add-loyalty");
    const handed = await backend.complete({ result: "1 capability, 1 scenario, 1 task" });
    expect((handed as any).warnings).toEqual(expect.arrayContaining([expect.stringContaining("only the form")]));
    expect(validate.calls[0]).toEqual(["openspec", "--no-color", "validate", "add-loyalty", "--strict"]);

    const review = await reviewer.context();
    expect(review.nextAction).toBe("sync");
    expect(String(review.hint)).toContain("java-spec-review");
    expect(String(review.hint)).toContain("every scenario can become a test");
    expect(String(review.hint)).toContain("is recorded as a decision in design.md");
    expect(review.operatorAnswers).toHaveLength(1);
    await reviewer.complete({ status: "PASS" });
    if ((await backend.context()).nextAction === "sync") await backend.complete({ status: "PASS" });

    const integrate = await backend.context();
    expect(integrate.nextAction).toBe("integrate");
    expect(String(integrate.hint)).toContain("Nothing to merge");
    validate.result = "ok";
    await backend.complete({ status: "PASS", result: "the change covers the discount" });
    expect((await operator.tasks.get(task.id)).status).toBe("COMPLETED");
  });

  it("validateChange without the CLI checks the form", async () => {
    const dir = await tmpDir();
    const missing: Exec = async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(await validateChange(dir, "add-x", missing)).toMatchObject({ ok: false, cli: false, output: expect.stringContaining("no openspec/changes/add-x/specs/<capability>/spec.md") });
    writeProposal(dir, "add-x");
    expect(await validateChange(dir, "add-x", missing)).toMatchObject({ ok: true, cli: false });
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("the page and a change-writing task", () => {
  it("creates it from the form and says when the change is in the project, ready to implement", async () => {
    const { project, dir, operator } = await setup();
    const pool = new RunnerPool(dir, [{ id: "backend", command: ["x"], autostart: false }, { id: "reviewer", command: ["x"], autostart: false }]);
    ui = await startUiServer([{ networkDir: dir, runners: pool }], { port: 0 });
    const r = await fetch(`${ui.url}/api/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "", description: "Loyalty discount.", agents: ["backend", "reviewer"], proposes: "add-loyalty", openspec: "" }) });
    const { task } = (await r.json()) as any;
    expect(task.proposes).toEqual({ change: "add-loyalty" });
    const state = async () => ((await (await fetch(`${ui!.url}/api/state`)).json()) as any).tasks[0];
    expect(await state()).toMatchObject({ proposes: { change: "add-loyalty" }, proposedReady: false });
    await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
    expect((await state()).proposedReady).toBe(false); // not merged into the project yet
    writeProposal(project, "add-loyalty");
    expect((await state()).proposedReady).toBe(true);
  });
});
