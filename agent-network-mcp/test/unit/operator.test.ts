import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm, type SwarmOptions } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

async function setup(opts: SwarmOptions = {}) {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const svc = async (id: string) => NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
  const backend = new Swarm(await svc("backend"), undefined, opts);
  const reviewer = new Swarm(await svc("reviewer"), undefined, opts);
  const task = await operator.createTaskAsOperator({ title: "Vague", description: "do the thing", agents: ["backend", "reviewer"] });
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

describe("questions to the operator", () => {
  it("the lead asks instead of inventing the scope, waits, and continues in the same session with the answer", async () => {
    const { operator, backend, task } = await setup();
    expect((await backend.context()).nextAction).toBe("propose");

    const asked = await backend.sendMessage({ to: "operator", message: "What exactly should 'the thing' do?" });
    expect(asked).toMatchObject({ ok: true, action: "QUESTION_SENT", nextAction: "wait", waitingOn: expect.arrayContaining(["operator"]) });
    expect(asked.questionsToOperator).toEqual([expect.objectContaining({ messageId: asked.messageId, question: "What exactly should 'the thing' do?" })]);
    expect(asked.hint).toContain("Call wait(): the answer arrives in pendingMessages; propose or approve after it.");

    const waiting = backend.wait({ timeoutMs: 5000 });
    await operator.answerQuestion({ taskId: task.id, messageId: asked.messageId as string, answer: "Add GET /health returning 200 OK." });
    const woke = await waiting;
    expect(woke).toMatchObject({ status: "MESSAGES", pendingMessages: [expect.objectContaining({ from: "operator", content: "Add GET /health returning 200 OK." })] });

    const after = await backend.context(); // the question is answered: back to work
    expect(after.nextAction).toBe("propose");
    expect(after.questionsToOperator).toBeUndefined();
  });

  it("with no answer in time the asker goes ahead with its own proposal and says so; the operator can still answer", async () => {
    const { operator, backend, task } = await setup({ operatorTimeoutMs: 300 });
    const asked = await backend.sendMessage({ to: "operator", message: "Scope A or B? I would take A." });
    expect(asked).toMatchObject({ nextAction: "wait", waitingOn: expect.arrayContaining(["operator"]) });
    expect(asked.hint).toContain("If none comes within 0 min of asking, go ahead with the option you proposed in it.");
    expect(asked.note).toContain("go ahead with the option you proposed and say so");

    const started = Date.now();
    const woke = await backend.wait({ timeoutMs: 5000 }); // the clock frees the agent, no event needed
    expect(Date.now() - started).toBeLessThan(3000);
    expect(woke).toMatchObject({ status: "ACTION_REQUIRED", nextAction: "propose" });
    expect(woke.hint).toContain(`The operator has not answered your question ${asked.messageId}`);
    expect(woke.hint).toContain("say so, send_message to the other agents");

    await backend.sendMessage({ to: "reviewer", message: "No answer from the operator on the scope, I go ahead with A." });
    const said = await backend.context();
    expect(said.hint).not.toContain("has not answered"); // told the team: the reminder is gone
    expect(said.questionsToOperator).toHaveLength(1); // still open on the page

    await operator.answerQuestion({ taskId: task.id, messageId: asked.messageId as string, answer: "B, sorry." });
    expect((await backend.context()).pendingMessages).toEqual([expect.objectContaining({ from: "operator", content: "B, sorry." })]);
  });

  it("outside DISCUSS a question does not stop the work, it only says the answer is pending", async () => {
    const { backend, reviewer } = await setup();
    await backend.context();
    await backend.propose({ summary: "s", assignments: [{ agentId: "backend", responsibility: "a", files: ["a/**"] }, { agentId: "reviewer", responsibility: "b", files: ["b/**"] }] });
    await reviewer.context();
    await reviewer.complete({});
    await backend.complete({});
    const r = await backend.sendMessage({ to: "operator", message: "Which port?" });
    expect(r).toMatchObject({ nextAction: "implement" });
    expect(r.hint).toContain("Continue with what does not depend on it");
  });

  it("guards: no files to the operator, only the operator answers, only questions get answers, 'operator' is no agent name", async () => {
    const { operator, backend, task, dir } = await setup();
    expect(await failure(backend, backend.sendMessage({ to: "operator", message: "x", requestFiles: ["a"] }))).toMatchObject({ error: "INVALID_INPUT" });
    expect(await failure(backend, backend.sendMessage({ to: "nobody", message: "x" }))).toMatchObject({ error: "NOT_ASSIGNED", validRecipients: ["reviewer", "operator"] });
    const q = await backend.sendMessage({ to: "operator", message: "Q?" });
    const agentSvc = await NetworkService.create(dir, { id: "reviewer", type: "test" });
    await expect(agentSvc.answerQuestion({ taskId: task.id, messageId: q.messageId as string, answer: "a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const plain = await backend.sendMessage({ to: "reviewer", message: "hi" });
    await expect(operator.answerQuestion({ taskId: task.id, messageId: plain.messageId as string, answer: "a" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "operator"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("fyi to the operator: shown for information, no question, holds nobody, closed with Ok", async () => {
    const { dir, operator, backend, task } = await setup();
    const told = await backend.sendMessage({ to: "operator", message: "Understood: only the test fix stays.", fyi: true });
    expect(told).toMatchObject({ ok: true, action: "INFO_SENT", nextAction: "propose" }); // no wait for an answer
    expect((await backend.context()).questionsToOperator).toBeUndefined();
    const msgs = await operator.messages.list(task.id);
    expect(msgs.at(-1)).toMatchObject({ from: "backend", to: "operator", type: "INFORMATION" });

    ui = await startUiServer(dir, { port: 0, runners: new RunnerPool(dir, []) });
    const state = async () => (await (await fetch(`${ui!.url}/api/state`)).json()) as any;
    let s = await state();
    expect(s.openQuestions).toEqual([]); // not a question: nothing to answer, the supervisor is not woken
    expect(s.operatorNotes).toEqual([expect.objectContaining({ taskId: task.id, from: "backend", text: "Understood: only the test fix stays." })]);
    const ok = await fetch(`${ui.url}/api/questions/dismiss`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, messageId: s.operatorNotes[0].messageId }) });
    expect(ok.status).toBe(200);
    s = await state();
    expect(s.operatorNotes).toEqual([]);
  });

  it("the page lists open questions and answers them", async () => {
    const { dir, backend, task } = await setup();
    const q = await backend.sendMessage({ to: "operator", message: "Which database?" });
    ui = await startUiServer(dir, { port: 0, runners: new RunnerPool(dir, []) });
    const state = async () => (await (await fetch(`${ui!.url}/api/state`)).json()) as { openQuestions: { taskId: string; messageId: string; from: string; question: string }[] };
    expect((await state()).openQuestions).toEqual([expect.objectContaining({ taskId: task.id, messageId: q.messageId, from: "backend", question: "Which database?" })]);

    const res = await fetch(`${ui.url}/api/questions/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, messageId: q.messageId, answer: "PostgreSQL" }) });
    expect(res.status).toBe(201);
    expect((await state()).openQuestions).toEqual([]);
    expect((await backend.context()).pendingMessages).toEqual([expect.objectContaining({ from: "operator", content: "PostgreSQL" })]);
  });
});

describe("questions with choices", () => {
  const options = [
    { label: "Service layer", description: "PriceCalculator stays pure" },
    { label: "In the calculator", description: "it looks the count up itself" },
  ];

  it("are kept with the question, shown on the page, and checked", async () => {
    const { dir, backend, reviewer, task } = await setup();
    const asked = await backend.sendMessage({ to: "operator", message: "Where is the customer identified?", options, recommended: "Service layer" });
    expect(asked.note).toContain('go ahead with "Service layer"');
    const pool = new RunnerPool(dir, [{ id: "backend", command: ["x"], autostart: false }]);
    ui = await startUiServer([{ networkDir: dir, runners: pool }], { port: 0 });
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.openQuestions[0]).toMatchObject({ messageId: asked.messageId, choices: { options, recommended: "Service layer" } });

    const bad = (input: Record<string, unknown>) => failure(backend, backend.sendMessage({ to: "operator", message: "q", ...input } as never));
    expect(await bad({ options: [options[0]] })).toMatchObject({ error: "INVALID_INPUT", message: expect.stringContaining("2 to 6") });
    expect(await bad({ options: [options[0], { label: "service layer" }] })).toMatchObject({ message: expect.stringContaining("must differ") });
    expect(await bad({ options, recommended: "Elsewhere" })).toMatchObject({ message: expect.stringContaining("one of the labels") });
    expect(await bad({ options, fyi: true })).toMatchObject({ message: expect.stringContaining("question to the operator") });
    expect(await failure(reviewer, reviewer.sendMessage({ to: "backend", message: "A or B?", options } as never))).toMatchObject({ message: expect.stringContaining("to an agent write the options") });
    expect(task.id).toBe("task-001");
  });

  it("with no answer in time the agent goes ahead with the recommended option by name", async () => {
    const { backend } = await setup({ operatorTimeoutMs: 300 });
    const asked = await backend.sendMessage({ to: "operator", message: "Which layer?", options, recommended: "Service layer", multiSelect: false });
    const woke = await backend.wait({ timeoutMs: 5000 });
    expect(woke.hint).toContain(`The operator has not answered your question ${asked.messageId}`);
    expect(woke.hint).toContain('go ahead with your recommended option "Service layer"');
  });
});
