import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { buildUiState } from "../../src/ui/state.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => { await ui?.close(); ui = undefined; });
async function setup() {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const lead = await NetworkService.create(dir, { id: "lead", type: "test" });
  const peer = await NetworkService.create(dir, { id: "peer", type: "test" });
  await lead.registerAgent(); await peer.registerAgent(); await operator.registerAgent();
  const task = await operator.createTaskAsOperator({ title: "Discussion", description: "Requirement discussion", agents: ["lead", "peer"] });
  const root = await lead.sendMessage({ taskId: task.id, to: "peer", type: "QUESTION", content: "Deny wins?", requirementId: "REQ-001" });
  const pool = new RunnerPool(dir, [{ id: "lead", command: ["unused"], autostart: false }, { id: "peer", command: ["unused"], autostart: false }], { run: async () => { throw new Error("No runners should start"); } });
  ui = await startUiServer(dir, { port: 0, runners: pool });
  const path = `/api/tasks/${task.id}/discussions`;
  const get = async () => (await (await fetch(ui!.url + path)).json()) as any;
  const post = (body: unknown, id = root.id, headers: Record<string, string> = {}) => fetch(`${ui!.url}${path}/${id}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { dir, operator, lead, peer, task, root, get, post };
}
describe("operator discussion API", () => {
  it("requires resolving an unread operator question before closure and never treats dismissal as an answer", async () => {
    const { operator, lead, task, root, get, post } = await setup();
    const escalation = await lead.sendMessage({ taskId: task.id, to: "operator", type: "QUESTION", content: "Approve deny priority?", replyTo: root.id });
    const refused = await post({ status: "closed", summary: "Pending decision" });
    expect(refused.ok).toBe(false);
    expect((await get()).discussions[0]).toMatchObject({ status: "open", answeredBy: [] });
    await operator.dismissQuestion({ taskId: task.id, messageId: escalation.id });
    expect((await post({ status: "closed", summary: "Question dismissed; no behavior approved" })).status).toBe(200);
    expect((await get()).discussions[0]).toMatchObject({ status: "closed", answeredBy: [] });
  });
  it("requires a closure summary and operator authority; persists closure, requirement and reopening", async () => {
    const { dir, task, root, get, post } = await setup();
    expect((await get()).discussions[0]).toMatchObject({ id: root.id, status: "open", requirementId: "REQ-001" });
    expect((await post({ status: "closed", summary: "  " })).ok).toBe(false);
    expect((await post({ status: "closed", summary: "Deny wins" }, root.id, { "x-agent-network-actor": "supervisor" })).status).toBe(403);
    const closed = await post({ status: "closed", summary: "Deny wins", requirementId: "REQ-002" });
    expect(closed.status).toBe(200);
    expect((await closed.json() as any).discussion).toMatchObject({ status: "closed", summary: "Deny wins", requirementId: "REQ-002", closedBy: "operator" });
    const reopenedOperator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    await reopenedOperator.updateDiscussion({ taskId: task.id, messageId: root.id, status: "open" });
    expect((await get()).discussions[0]).toMatchObject({ status: "open", summary: "Deny wins", requirementId: "REQ-002", history: [expect.objectContaining({ status: "closed" }), expect.objectContaining({ status: "open" })] });
    expect((await get()).discussions[0].closedBy).toBeUndefined();
  });
  it("keeps old questions beyond the message window and refreshes completed-task outcomes", async () => {
    const { dir, operator, lead, peer, task, root, get, post } = await setup();
    const answer = await peer.sendMessage({ taskId: task.id, to: "lead", type: "INFORMATION", content: "Deny", replyTo: root.id });
    for (let n = 0; n < 55; n++) await lead.messages.create({ taskId: task.id, from: "lead", to: "peer", type: "INFORMATION", content: `later ${n}` });
    const fs = await FileStore.open(dir);
    await operator.tasks.save({ ...await operator.tasks.get(task.id), phase: "DONE", status: "COMPLETED" });
    const view = async () => (await buildUiState(fs)).tasks.find(t => t.id === task.id)!;
    expect((await view()).discussions[0]).toMatchObject({ id: root.id, status: "open", answeredBy: ["peer"] });
    expect((await post({ status: "closed", summary: "Deny has priority" }, answer.id)).status).toBe(200);
    expect((await view()).discussions[0]).toMatchObject({ status: "closed", summary: "Deny has priority" });
    expect((await get()).discussions[0].messages).toHaveLength(2);
  });
  it("refuses missing tasks/messages and malformed metadata without altering the root", async () => {
    const { root, get, post } = await setup();
    expect((await post({ status: "closed", summary: "Unknown" }, "msg-999999")).ok).toBe(false);
    expect((await fetch(`${ui!.url}/api/tasks/task-999999/discussions`)).ok).toBe(false);
    expect((await post({ requirementId: "bad\nidentifier" })).ok).toBe(false);
    expect((await post({ status: "invalid" })).ok).toBe(false);
    expect((await get()).discussions[0]).toMatchObject({ id: root.id, status: "open", requirementId: "REQ-001" });
  });
});
