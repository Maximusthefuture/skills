import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

async function setup() {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const svc = async (id: string) => NetworkService.create(dir, { id, type: "test" }, { hub: new EventHub(dir, { fallbackPollMs: 50 }) });
  const backend = new Swarm(await svc("backend"));
  const reviewer = new Swarm(await svc("reviewer"));
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
