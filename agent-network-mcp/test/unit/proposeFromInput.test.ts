import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import type { Exec } from "../../src/openspec.js";
import { NetworkService } from "../../src/service.js";
import { SessionOutput, skillOf, type ActivityItem } from "../../src/sessionOutput.js";
import { taskStats } from "../../src/stats.js";
import type { SessionRecord } from "../../src/stores/sessionStore.js";
import { tmpDir } from "../helpers/tmp.js";

const PAGE = "<!doctype html><html><body><h1>Page</h1><p>text</p></body></html>";

function writeProposal(dir: string, name: string) {
  const c = join(dir, "openspec", "changes", name);
  mkdirSync(join(c, "specs", "loyalty"), { recursive: true });
  writeFileSync(join(c, "proposal.md"), "## Why\nRegular customers get a discount.\n");
  writeFileSync(join(c, "design.md"), "## Decisions\n### Reference\norder\n");
  writeFileSync(join(c, "specs", "loyalty", "spec.md"), "## ADDED Requirements\n### Requirement: Discount\n#### Scenario: fifth order\n- WHEN ...\n- THEN ...\n");
  writeFileSync(join(c, "tasks.md"), "## 1. Discount\n\n- [ ] 1.1 Apply 5% from the fifth order\n");
}

/** The analysts' artifacts somewhere outside the project. */
async function analystInput(): Promise<string> {
  const root = await tmpDir();
  const dir = join(root, "loyalty");
  mkdirSync(join(dir, "specs", "loyalty"), { recursive: true });
  writeFileSync(join(dir, "proposal.md"), "## Why\nDiscounts.\n");
  writeFileSync(join(dir, "specs", "loyalty", "spec.md"), "### Requirement: Discount\n");
  writeFileSync(join(dir, "notes.txt"), "not markdown: skipped");
  return dir;
}

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
  mkdirSync(join(project, "openspec", "specs"), { recursive: true });
  const dir = join(project, ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const exec: Exec = async () => ({ stdout: "valid", stderr: "" });
  const swarm = async (id: string) =>
    new Swarm(await NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) }), () => undefined, { workdir: project, openspecExec: exec });
  return { project, dir, operator, backend: await swarm("backend"), reviewer: await swarm("reviewer") };
}

const SPLIT = { summary: "loyalty", assignments: [{ agentId: "backend", responsibility: "writes", files: ["openspec/changes/add-loyalty/**"] }, { agentId: "reviewer", responsibility: "reviews", files: [] }] };

describe("a change written from the analysts' artifacts", () => {
  it("takes .md files or folders with --propose only, within limits, and copies them into the task", async () => {
    const { operator, dir } = await setup();
    const input = await analystInput();
    const base = { title: "", description: "d", agents: ["backend", "reviewer"] };
    await expect(operator.createTaskAsOperator({ ...base, title: "t", from: [input] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("--propose") });
    await expect(operator.createTaskAsOperator({ ...base, proposes: "add-loyalty", from: [join(input, "nope")] })).rejects.toMatchObject({ message: expect.stringContaining("no such file") });
    await expect(operator.createTaskAsOperator({ ...base, proposes: "add-loyalty", from: [join(input, "notes.txt")] })).rejects.toMatchObject({ message: expect.stringContaining("only Markdown") });

    const task = await operator.createTaskAsOperator({ ...base, proposes: "add-loyalty", from: [input] });
    expect(task.proposes).toEqual({ change: "add-loyalty", input: ["loyalty/proposal.md", "loyalty/specs/loyalty/spec.md"] });
    expect(task.grill).toBe(true); // grilled by default
    expect(readFileSync(join(dir, "tasks", task.id, "input", "loyalty", "proposal.md"), "utf8")).toContain("Discounts");

    const quiet = await operator.createTaskAsOperator({ ...base, proposes: "add-other", from: [join(input, "proposal.md")], grill: false });
    expect(quiet.grill).toBeUndefined();
    expect(quiet.proposes?.input).toEqual(["proposal.md"]);
  });

  it("input page → grilling → propose → change page accepted or returned → complete only with the accepted change", async () => {
    const { project, operator, backend, reviewer } = await setup();
    const task = await operator.createTaskAsOperator({ title: "", description: "Loyalty discount.", agents: ["backend", "reviewer"], proposes: "add-loyalty", from: [await analystInput()] });

    // DISCUSS: the analysts' files in the agent's folder, and the input page first
    const first = await backend.context();
    expect(first.task).toMatchObject({ proposes: { input: `.agent-network/input/${task.id}`, inputFiles: ["loyalty/proposal.md", "loyalty/specs/loyalty/spec.md"] } });
    expect(existsSync(join(project, ".agent-network", "input", task.id, "loyalty", "proposal.md"))).toBe(true);
    expect(String(first.hint)).toContain('plan({stage: "input", html, note})');
    expect(first.allowedActions).toContain("plan");
    expect(await failure(backend, backend.propose(SPLIT))).toMatchObject({ error: "INPUT_NOT_REVIEWED" });
    expect(await failure(backend, backend.plan({ html: PAGE }))).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("two pages") });
    expect(await failure(backend, backend.plan({ stage: "change", html: PAGE }))).toMatchObject({ error: "INVALID_PHASE" });
    await backend.plan({ stage: "input", html: PAGE, note: "their spec" });
    expect((await backend.context()).nextAction).toBe("wait");
    await operator.planFeedback({ taskId: task.id, version: 1, approve: true });

    // the grilling: propose() waits for the operator's yes to the summary
    const grill = await backend.context();
    expect(String(grill.hint)).toContain("analysts' artifacts");
    expect(String(grill.hint)).toContain("How I understand it");
    expect(await failure(backend, backend.propose(SPLIT))).toMatchObject({ error: "CLARIFY_FIRST" });
    const q = await backend.sendMessage({ to: "operator", message: "How I understand it: 5% from the 5th order. Is that right?", options: [{ label: "Yes, that's it" }, { label: "No, I will correct it" }], recommended: "Yes, that's it" });
    await operator.answerQuestion({ taskId: task.id, messageId: q.messageId as string, answer: 'Chosen: "Yes, that\'s it"' });
    expect((await backend.context()).operatorAnswers).toHaveLength(1); // also in DISCUSS now
    await backend.propose(SPLIT);
    await reviewer.context();
    await reviewer.complete({});
    await backend.complete({});

    // IMPLEMENT: the shape of the code in design.md, then the change page
    const write = await backend.context();
    expect(write.nextAction).toBe("implement");
    expect(String(write.hint)).toContain("Classes table");
    expect(String(write.hint)).toContain("java-spec-intake");
    writeProposal(project, "add-loyalty");
    expect(await failure(backend, backend.complete({ result: "written" }))).toMatchObject({ error: "CHANGE_NOT_APPROVED", message: expect.stringContaining('plan({stage: "change"') });
    await backend.plan({ stage: "change", html: PAGE, note: "ours next to theirs" });
    expect((await backend.context()).nextAction).toBe("wait");
    expect(await failure(backend, backend.complete({ result: "written" }))).toMatchObject({ error: "CHANGE_NOT_APPROVED", message: expect.stringContaining("has not accepted") });

    // returned for rework: the notes reach the author; the next version is accepted
    const back = await operator.planFeedback({ taskId: task.id, version: 2, comments: [{ target: "h1", text: "the service goes to service/, not loyalty/" }] });
    expect(back.message?.content).toContain("returns the change for rework");
    expect(String((await backend.context()).hint)).toContain("returned the change for rework");
    writeFileSync(join(project, "openspec", "changes", "add-loyalty", "design.md"), "## Decisions\n### Classes\nLoyaltyService | service\n");
    await backend.plan({ stage: "change", edits: [{ find: "text", replace: "text v3" }], note: "service/" });
    const accepted = await operator.planFeedback({ taskId: task.id, version: 3, approve: true });
    expect(accepted.message?.content).toContain("accepted the change");

    // an edit after the acceptance needs the operator again
    writeFileSync(join(project, "openspec", "changes", "add-loyalty", "tasks.md"), "## 1. Discount\n\n- [ ] 1.1 changed\n");
    expect(await failure(backend, backend.complete({ result: "written" }))).toMatchObject({ error: "CHANGE_NOT_APPROVED", message: expect.stringContaining("changed after the operator accepted") });
    writeFileSync(join(project, "openspec", "changes", "add-loyalty", "tasks.md"), "## 1. Discount\n\n- [ ] 1.1 Apply 5% from the fifth order\n");
    await backend.complete({ result: "1 capability; Skills: java-spec-intake" });

    const review = await reviewer.context();
    expect(review.nextAction).toBe("sync");
    expect(String(review.hint)).toContain("every requirement and scenario of the input is covered");
  });

  it("an empty --from is refused; notes on the input page go along with «Посмотрел»; rounds are counted per page", async () => {
    const { operator, backend } = await setup();
    const base = { title: "", description: "d", agents: ["backend", "reviewer"], proposes: "add-loyalty" };
    await expect(operator.createTaskAsOperator({ ...base, from: [""] })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("path is empty") });
    await expect(operator.createTaskAsOperator({ ...base, from: ["  "] })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const task = await operator.createTaskAsOperator({ ...base, from: [await analystInput()] });
    await backend.context();
    await backend.plan({ stage: "input", html: PAGE });
    const notes = await operator.planFeedback({ taskId: task.id, version: 1, comments: [{ target: "h1", text: "is the wrap always paid?" }] });
    expect(notes.state.feedback[0]).toMatchObject({ round: 1 });
    // the lead has not answered yet, and notes come along: «Посмотрел» is accepted all the same (in-place edits are not)
    await expect(operator.planFeedback({ taskId: task.id, version: 1, approve: true, edits: [{ before: "Page", after: "Their page" }] })).rejects.toMatchObject({ message: expect.stringContaining("Send your comments and edits to the lead first") });
    const viewed = await operator.planFeedback({ taskId: task.id, version: 1, approve: true, comments: [{ target: "p", text: "and the currency?" }] });
    expect(viewed.message?.content).toContain("Now grill the operator");
    expect(viewed.message?.content).toContain("and the currency?");
    expect(viewed.state.approved).toMatchObject({ version: 1 });
  });

  it("a change-writing task without input still clarifies first when asked to (it used to be told to propose and refused)", async () => {
    const { operator, backend } = await setup();
    await operator.createTaskAsOperator({ title: "", description: "Loyalty discount.", agents: ["backend", "reviewer"], proposes: "add-loyalty", clarify: true });
    const ctx = await backend.context();
    expect(String(ctx.hint)).toContain("First check the task");
    await backend.sendMessage({ to: "operator", fyi: true, message: "How I understand it: a 5% discount. No questions." });
    const after = await backend.context();
    expect(after.nextAction).toBe("propose");
    expect(String(after.hint)).toContain("propose() right away");
    await backend.propose(SPLIT);
  });
});

describe("skills in the progress", () => {
  it("a Skill call or a read of SKILL.md names the skill, subagents' too", () => {
    expect(skillOf("Skill", { skill: "java-tdd" })).toBe("java-tdd");
    expect(skillOf("Skill", { skill: "backend-design-java:migration-safety" })).toBe("backend-design-java:migration-safety");
    expect(skillOf("read_file", { absolute_path: "/home/u/.qwen/skills/grilling/SKILL.md" })).toBe("grilling");
    expect(skillOf("Read", { file_path: "/x/java-tdd/references/modes.md" })).toBeUndefined();
    expect(skillOf("Bash", { command: "cat SKILL.md" })).toBeUndefined();

    const events: ActivityItem[] = [];
    const out = new SessionOutput((e) => events.push(e));
    out.feed(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Skill", input: { skill: "java-spec-intake" } }] } })}\n`);
    out.feed(`${JSON.stringify({ type: "assistant", parent_tool_use_id: "a", message: { content: [{ type: "tool_use", id: "b", name: "Skill", input: { skill: "grilling" } }] } })}\n`);
    expect(events.map((e) => [e.skill, e.sub ?? false])).toEqual([["java-spec-intake", false], ["grilling", true]]);
  });

  it("the task's stats list each agent's skills in the order of first use", () => {
    const at = "2026-10-23T10:00:00.000Z";
    const task = { id: "task-001", phaseHistory: [{ phase: "DISCUSS", at }], createdAt: at } as never;
    const s = (skills: string[]): SessionRecord => ({ id: "s", taskId: "task-001", agentId: "backend", attempt: 1, startedAt: at, endedAt: at, durationMs: 1, exitCode: 0, skills });
    const stats = taskStats(task, [s(["java-spec-intake", "grilling"]), s(["grilling", "java-spec-review"])], [], new Date(at));
    expect(stats?.agents[0]?.skills).toEqual(["java-spec-intake", "grilling", "java-spec-review"]);
  });
});
