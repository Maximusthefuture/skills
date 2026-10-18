import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { PLAN_READ_WHOLE, applyEdits, checkFeedback, feedbackText, injectSdk, planAround, planOutline, planStatus, stripSdk } from "../../src/plan.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

const PAGE = `<!doctype html><html><head><style>h1{color:#333}</style></head><body><h1>Refunds</h1><h2>Who does what</h2><ul><li>backend: POST /orders/{id}/refunds</li><li>reviewer: tests</li></ul>
<div data-question="Partial refunds?"><label><input type="radio" name="q1" value="yes"> yes</label><label><input type="radio" name="q1" value="no"> no</label></div></body></html>`;
const assignments = [
  { agentId: "backend", responsibility: "api", files: ["src/main/**"] },
  { agentId: "reviewer", responsibility: "review", files: [] },
];

async function setup() {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const svc = async (id: string) => NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
  const backend = new Swarm(await svc("backend"));
  const reviewer = new Swarm(await svc("reviewer"));
  const task = await operator.createTaskAsOperator({ title: "Refunds", description: "partial refunds of a PAID order", agents: ["backend", "reviewer"], planReview: true });
  return { dir, operator, backend, reviewer, task };
}

async function failure(swarm: Swarm, p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return swarm.errorBody(e);
  }
  throw new Error("expected the call to fail");
}

describe("reading a big plan", () => {
  it("by its headings and by parts around a text: never the whole page in the lead's context", () => {
    const html = `<!doctype html><html><body><h1>Refunds</h1><h2>Who does what</h2>${"<p>filler text</p>".repeat(3000)}<h2>Risks</h2><p>the retry may double the refund</p></body></html>`;
    expect(html.length).toBeGreaterThan(PLAN_READ_WHOLE);
    expect(planOutline(html)).toEqual(["Refunds", "  Who does what", "  Risks"]);
    const parts = planAround(html, "double the refund", 20);
    expect(parts).toEqual([{ at: html.indexOf("double the refund"), text: expect.stringContaining("the retry may double the refund</p>") }]);
  });
});

describe("the plan's pieces", () => {
  it("find/replace edits need text that occurs exactly once", () => {
    expect(applyEdits("<p>a</p><p>b</p>", [{ find: "<p>b</p>", replace: "<p>c</p>" }])).toBe("<p>a</p><p>c</p>");
    expect(() => applyEdits("<p>a</p><p>a</p>", [{ find: "<p>a</p>", replace: "" }])).toThrow(/more than once/);
    expect(() => applyEdits("<p>a</p>", [{ find: "<p>z</p>", replace: "" }])).toThrow(/plan\({read: true}\)/);
  });

  it("the review script goes in before </body> and comes out again", () => {
    const shown = injectSdk(PAGE);
    expect(shown).toMatch(/<script data-an-sdk>[\s\S]*<\/script><\/body>/);
    expect(stripSdk(shown)).toBe(PAGE);
  });

  it("feedback from the page is checked and cut to size", () => {
    const fb = checkFeedback({
      comments: [{ target: "li «backend»", text: "  202, not 200 " }, { target: "x", text: "" }, "junk"],
      edits: [{ before: "a", after: "b" }, { before: "same", after: "same" }],
      answers: [{ question: "Partial refunds?", value: ["yes"] }, { question: "empty", value: [] }],
    });
    expect(fb).toEqual({ comments: [{ target: "li «backend»", text: "202, not 200" }], edits: [{ before: "a", after: "b" }], answers: [{ question: "Partial refunds?", value: ["yes"] }] });
  });
});

describe("diagrams in the plan", () => {
  it("an edited Mermaid diagram goes to the lead as its new source, longer than a text edit may be", () => {
    const after = `sequenceDiagram\n  Client->>Api: POST /refunds\n  Api->>Db: save Refund (FOR UPDATE)\n${"  %% note\n".repeat(300)}`;
    const fb = checkFeedback({ edits: [{ before: "sequenceDiagram\n  Client->>Api: POST /refunds", after, kind: "diagram" }, { before: "x", after: "y", kind: "other" }] });
    expect(fb.edits[0]).toMatchObject({ kind: "diagram", after: after.trim() });
    expect(fb.edits[1]).toEqual({ before: "x", after: "y" });
    const text = feedbackText({ round: 1, at: "", onVersion: 1, savedAs: 2, comments: [{ target: "схема: стрелка «save Refund»", text: "lock the order row" }], edits: fb.edits, answers: [] });
    expect(text).toContain("1. on схема: стрелка «save Refund»: lock the order row");
    expect(text).toContain("- the diagram (Mermaid), 2 lines before, now:\n```mermaid\nsequenceDiagram\n  Client->>Api: POST /refunds\n  Api->>Db: save Refund (FOR UPDATE)");
  });
});

describe("a plan the operator approves before the agreement (planReview)", () => {
  it("the lead writes it, the operator comments and edits it, the lead reworks it, the approval opens propose()", async () => {
    const { operator, backend, reviewer, task } = await setup();
    expect(task.planReview).toBe(true);

    const first = await backend.context();
    expect(first).toMatchObject({ nextAction: "propose", plan: { status: "none", version: null } });
    expect(first.allowedActions).toContain("plan");
    expect(first.allowedActions).not.toContain("propose");
    expect(String(first.hint)).toContain("ONE self-contained HTML page");
    expect(first.exampleCall).toBeUndefined();
    expect(await reviewer.context()).toMatchObject({ nextAction: "wait", hint: expect.stringContaining("writes the plan for the operator") });
    expect(await failure(backend, backend.propose({ summary: "s", assignments }))).toMatchObject({ error: "PLAN_NOT_APPROVED" });
    expect(await failure(reviewer, reviewer.plan({ html: PAGE }))).toMatchObject({ error: "FORBIDDEN" });
    expect(await failure(backend, backend.plan({ html: "just words" }))).toMatchObject({ error: "INVALID_INPUT" });

    expect(await backend.plan({ html: PAGE, note: "first draft" })).toMatchObject({ ok: true, version: 1, nextAction: "wait", plan: { status: "awaiting", version: 1 } });
    await expect(operator.planFeedback({ taskId: task.id, version: 1 })).rejects.toThrow(/Nothing to send/);
    await expect(operator.planFeedback({ taskId: task.id, version: 2, comments: [{ target: "h1", text: "x" }] })).rejects.toThrow(/current plan is v1/);

    // the operator: a note, an edit in place (the page sends the edited html) and an answer
    const edited = PAGE.replace("reviewer: tests", "reviewer: tests of every refund status");
    const sent = await operator.planFeedback({
      taskId: task.id, version: 1,
      comments: [{ target: "li «backend: POST /orders/{id}/refunds»", text: "202 Accepted: the refund is async" }],
      edits: [{ before: "reviewer: tests", after: "reviewer: tests of every refund status" }],
      answers: [{ question: "Partial refunds?", value: ["yes"] }],
      html: edited,
    });
    expect(sent.state.versions.map((v) => `${v.n}:${v.by}`)).toEqual(["1:backend", "2:operator"]);
    expect(sent.message!.to).toBe("backend");
    expect(sent.message!.content).toContain("202 Accepted: the refund is async");
    expect(sent.message!.content).toContain('"reviewer: tests" → "reviewer: tests of every refund status"');
    expect(sent.message!.content).toContain("saved as v2");
    expect(sent.message!.content).toContain("- Partial refunds?: yes");
    expect(planStatus(sent.state)).toBe("revising");
    await expect(operator.planFeedback({ taskId: task.id, version: 2, approve: true })).rejects.toThrow(/approve the version it sends/);

    const woke = await backend.wait({ timeoutMs: 3000 });
    expect(woke.status).toBe("MESSAGES");
    expect(woke).toMatchObject({ nextAction: "propose", plan: { status: "revising", version: 2 } });
    expect(String(woke.hint)).toContain("plan({read: true})");
    // the lead reads the operator's version and edits it
    expect((await backend.plan({ read: true })).html).toContain("tests of every refund status");
    const near = await backend.plan({ read: true, around: "refund status" });
    expect(near.html).toBeUndefined();
    expect((near.parts as { text: string }[])[0]!.text).toContain("reviewer: tests of every refund status");
    expect(await failure(backend, backend.plan({ read: true, around: "no such words here" }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(backend, backend.plan({ edits: [{ find: "reviewer: tests</li>", replace: "x" }] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await backend.plan({ edits: [{ find: "backend: POST /orders/{id}/refunds", replace: "backend: POST /orders/{id}/refunds → 202" }], note: "async refund" })).toMatchObject({ version: 3, plan: { status: "awaiting" } });
    expect(await failure(backend, backend.propose({ summary: "s", assignments }))).toMatchObject({ error: "PLAN_NOT_APPROVED" });
    // a note alone is only for answering feedback: here there is none to answer
    expect(await failure(backend, backend.plan({ note: "fine as it is" }))).toMatchObject({ error: "INVALID_INPUT" });

    // comments and edits go to the lead first; an approval carries only answers
    await expect(operator.planFeedback({ taskId: task.id, version: 3, comments: [{ target: "h2", text: "log every refund" }], approve: true })).rejects.toThrow(/to the lead first/);
    await expect(operator.planFeedback({ taskId: task.id, version: 3, edits: [{ before: "a", after: "b" }], approve: true })).rejects.toThrow(/to the lead first/);
    const ok = await operator.planFeedback({ taskId: task.id, version: 3, answers: [{ question: "Partial refunds?", value: ["yes"] }], approve: true });
    expect(ok.state.approved).toMatchObject({ version: 3 });
    expect(ok.message!.content).toContain("approved plan v3");
    expect(ok.message!.content).toContain("- Partial refunds?: yes");
    await expect(operator.planFeedback({ taskId: task.id, version: 3, comments: [{ target: "h2", text: "more" }] })).rejects.toThrow(/approved already/);
    expect(await failure(backend, backend.plan({ html: PAGE }))).toMatchObject({ error: "ALREADY_COMPLETED" });
    const after = await backend.context();
    expect(after).toMatchObject({ nextAction: "propose", plan: { status: "approved", approvedVersion: 3 } });
    expect(String(after.hint)).toContain("The operator approved plan v3");
    expect(after.exampleCall).toMatchObject({ tool: "propose" });
    await backend.propose({ summary: "refunds as planned", assignments });
    expect((await backend.context()).plan).toBeUndefined(); // past the plan: no more of it in the context
  });

  it("a cancelled task takes no new plan version", async () => {
    const { dir, operator, backend, task } = await setup();
    await backend.plan({ html: PAGE });
    await operator.cancelTask(task.id, "not needed");
    const lead = await NetworkService.create(dir, { id: "backend", type: "test" });
    await expect(lead.writePlan({ taskId: task.id, html: PAGE })).rejects.toThrow(/CANCELLED: the plan is closed/);
  });

  it("a change-writing task has no plan of its own; a plain task is not held", async () => {
    const { operator } = await setup();
    await expect(operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], proposes: "add-refunds", planReview: true })).rejects.toThrow();
    const plain = await operator.createTaskAsOperator({ title: "x", description: "d", agents: ["backend", "reviewer"] });
    expect(plain.planReview).toBeUndefined();
  });
});

describe("an unanswered question during the plan", () => {
  it("does not let the lead go ahead: the recommendation goes into the plan", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const svc = async (id: string) => NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
    const backend = new Swarm(await svc("backend"), undefined, { operatorTimeoutMs: 50 });
    await operator.createTaskAsOperator({ title: "Refunds", description: "partial refunds of a PAID order", agents: ["backend", "reviewer"], planReview: true });
    await backend.plan({ html: PAGE });
    await backend.sendMessage({ to: "operator", message: "Partial refunds?", options: [{ label: "yes" }, { label: "no" }], recommended: "yes" });
    await new Promise((r) => setTimeout(r, 80));
    const ctx = await backend.context();
    expect(String(ctx.hint)).toContain("Do not go ahead past the plan");
    expect(String(ctx.hint)).not.toContain("go ahead with your recommended option");
  });
});

describe("the lead keeps the plan as it is", () => {
  it("after feedback, a note alone sends the same page again for the operator to approve", async () => {
    const { operator, backend, task } = await setup();
    await backend.plan({ html: PAGE });
    await operator.planFeedback({ taskId: task.id, version: 1, comments: [{ target: "h1", text: "rename to Partial refunds?" }] });
    expect(await backend.plan({ note: "Refunds covers full ones too: the title stays" })).toMatchObject({ version: 2, plan: { status: "awaiting" } });
    expect((await operator.planHtml(task.id, 2))!.html).toBe(PAGE);
    expect((await operator.planState(task.id)).versions[1]).toMatchObject({ by: "backend", note: "Refunds covers full ones too: the title stays" });
    expect((await operator.planFeedback({ taskId: task.id, version: 2, approve: true })).state.approved).toMatchObject({ version: 2 });
  });
});

describe("the plan on the page", () => {
  it("shows the versions, serves the page sandboxed with the review script, takes feedback and the approval", async () => {
    const { dir, backend, task } = await setup();
    const pool = new RunnerPool(dir, [{ id: "backend", command: ["x"], autostart: false }, { id: "reviewer", command: ["x"], autostart: false }]);
    ui = await startUiServer([{ networkDir: dir, runners: pool }], { port: 0 });
    const post = (path: string, body: unknown) => fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    const made = (await (await post("/api/tasks", { title: "t2", description: "d", agents: ["backend", "reviewer"], planReview: true })).json()) as any;
    expect(made.task.planReview).toBe(true);
    let state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.tasks.find((t: any) => t.id === task.id)).toMatchObject({ planReview: true, plan: { status: "none", version: null }, waitingOn: ["backend"] });

    await backend.plan({ html: PAGE });
    state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.tasks.find((t: any) => t.id === task.id)).toMatchObject({ plan: { status: "awaiting", version: 1, by: "backend" }, waitingOn: ["operator"] });

    const view = await fetch(`${ui.url}/api/tasks/${task.id}/plan/1/view`);
    expect(view.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(view.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(await view.text()).toContain("<script data-an-sdk>");
    expect((await (await fetch(`${ui.url}/`)).headers.get("content-security-policy"))).toContain("frame-src 'self'");
    expect(((await (await fetch(`${ui.url}/api/tasks/${task.id}/plan/1`)).json()) as any).html).toBe(PAGE);
    expect((await fetch(`${ui.url}/api/tasks/${task.id}/plan/9`)).status).toBe(404);

    // the edited page comes back with the review script in it: it is taken out before it is saved
    const fb = await post(`/api/tasks/${task.id}/plan/feedback`, { version: 1, comments: [{ target: "h1", text: "name the endpoint" }], edits: [{ before: "Refunds", after: "Partial refunds" }], html: injectSdk(PAGE.replace("<h1>Refunds", "<h1>Partial refunds")) });
    expect(fb.status).toBe(201);
    expect(((await fb.json()) as any).to).toBe("backend");
    const saved = ((await (await fetch(`${ui.url}/api/tasks/${task.id}/plan/2`)).json()) as any).html;
    expect(saved).toContain("<h1>Partial refunds");
    expect(saved).not.toContain("data-an-sdk");
    expect(((await (await fetch(`${ui.url}/api/tasks/${task.id}/plan`)).json()) as any).plan.feedback).toHaveLength(1);

    // while the lead works the feedback in, the page cannot approve; after its answer it can
    expect((await post(`/api/tasks/${task.id}/plan/approve`, { version: 2 })).status).toBe(400);
    await backend.plan({ note: "the edit is right; the endpoint is named in the table" });
    const ap = await post(`/api/tasks/${task.id}/plan/approve`, { version: 3 });
    expect(((await ap.json()) as any).plan.approved.version).toBe(3);
    state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.tasks.find((t: any) => t.id === task.id).plan).toMatchObject({ status: "approved", approvedVersion: 3 });
  });
});

describe("a grilling before the plan", () => {
  it("plan() waits for the operator's yes; then the lead gets the decisions to put into the plan", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const backend = new Swarm(await NetworkService.create(dir, { id: "backend", type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) }));
    const task = await operator.createTaskAsOperator({ title: "Promo limit", description: "a promo code may be used 100 times", agents: ["backend", "reviewer"], planReview: true, grill: true });

    expect(String((await backend.context()).hint)).toContain("Work it in rounds");
    expect(await failure(backend, backend.plan({ html: PAGE }))).toMatchObject({ error: "CLARIFY_FIRST" });

    const q1 = await backend.sendMessage({ to: "operator", message: "Q1: Once per customer?", options: [{ label: "Yes" }, { label: "No" }], recommended: "Yes" });
    await operator.answerQuestion({ taskId: task.id, messageId: q1.messageId as string, answer: 'Chosen: "Yes"' });
    const sum = await backend.sendMessage({ to: "operator", message: "How I understand it: 100 uses, once per customer. Is that right?", options: [{ label: "Yes, that's it" }, { label: "No, I will correct it" }] });
    expect(await failure(backend, backend.plan({ html: PAGE }))).toMatchObject({ error: "CLARIFY_FIRST" });
    await operator.answerQuestion({ taskId: task.id, messageId: sum.messageId as string, answer: 'Chosen: "Yes, that\'s it"' });

    const ctx = await backend.context();
    expect(ctx).toMatchObject({ nextAction: "propose", plan: { status: "none" } });
    expect(String(ctx.hint)).toContain('"Decided in the grilling"');
    expect(ctx.grillDecisions).toEqual([
      { question: "Q1: Once per customer?", askedBy: "backend", answer: 'Chosen: "Yes"' },
      { question: "How I understand it: 100 uses, once per customer. Is that right?", askedBy: "backend", answer: 'Chosen: "Yes, that\'s it"' },
    ]);
    expect(await backend.plan({ html: PAGE })).toMatchObject({ version: 1 });
    // the critic checks the plan against the same decisions
    const prompts: string[] = [];
    const { PlanCritic } = await import("../../src/planCritic.js");
    const critic = new PlanCritic({ networkDir: dir, projectDir: dir, config: { command: ["x", "{prompt}"], promptFile: "/none" }, run: async (argv) => (prompts.push(argv[1]!), { code: 0, result: { text: '{"risks": []}' } as never }) });
    await critic.tick();
    await critic.idle();
    expect(prompts[0]).toContain('"grillDecisions"');
    expect(prompts[0]).toContain("Q1: Once per customer?");
  });
});
