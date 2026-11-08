import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { NetworkService } from "../../src/service.js";
import { DiscussionStore, listDiscussions } from "../../src/discussions.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
import type { Message } from "../../src/types.js";

async function setup() {
  const dir = join(await tmpDir(), ".agent-network");
  const a = await NetworkService.create(dir, { id: "a", type: "test" }); await a.registerAgent();
  const b = await NetworkService.create(dir, { id: "b", type: "test" }); await b.registerAgent();
  const op = await NetworkService.create(dir, { id: "operator", type: "test" });
  const task = await a.createTask({ title: "Discussion", description: "Question tracking", agents: ["a", "b"] });
  return { dir, a, b, op, task };
}
describe("task discussions", () => {
  it("keeps nested answers open, inherits requirement, persists explicit close and reopen history", async () => {
    const { dir,a,b,op,task } = await setup();
    const q = await a.sendMessage({ taskId: task.id, to: "b", type: "QUESTION", content: "Which rule?", requirementId: " REQ-1 " });
    const answer = await b.sendMessage({ taskId: task.id, to: "a", type: "INFORMATION", content: "Deny", replyTo: q.id });
    expect(answer.requirementId).toBe("REQ-1");
    await a.sendMessage({ taskId: task.id, to: "b", type: "INFORMATION", content: "My own clarification", replyTo: q.id });
    const follow = await a.sendMessage({ taskId: task.id, to: "b", type: "QUESTION", content: "Always?", replyTo: answer.id });
    await b.sendMessage({ taskId: task.id, to: "a", type: "INFORMATION", content: "Yes", replyTo: follow.id });
    expect(listDiscussions(await a.messages.list(task.id))[0]).toMatchObject({ id:q.id, status:"open", answeredBy:["b"] });
    await expect(a.updateDiscussion({taskId:task.id,messageId:q.id,status:"closed",summary:"Deny"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(op.updateDiscussion({taskId:task.id,messageId:q.id,status:"closed"})).rejects.toMatchObject({code:"INVALID_INPUT"});
    const closed = await op.updateDiscussion({taskId:task.id,messageId:follow.id,status:"closed",summary:"Deny applies"});
    const repeat = await op.updateDiscussion({taskId:task.id,messageId:q.id,status:"closed",summary:"Deny applies"});
    expect(repeat.closedAt).toBe(closed.closedAt);
    const edited = await op.updateDiscussion({taskId:task.id,messageId:q.id,summary:"Deny applies to all roles"});
    expect(edited.history).toHaveLength(2);
    expect(edited.history?.at(-1)?.summary).toBe("Deny applies to all roles");
    const restarted = await NetworkService.create(dir, { id:"operator",type:"test" });
    const opened = await restarted.updateDiscussion({taskId:task.id,messageId:q.id,status:"open"});
    expect(opened).toMatchObject({status:"open",summary:"Deny applies to all roles"});
    expect(opened.closedAt).toBeUndefined(); expect(opened.history).toHaveLength(3);
    expect(opened.messages).toHaveLength(5);
    const saved = await new DiscussionStore(await FileStore.open(dir)).read(task.id);
    expect(saved[q.id]!.history).toHaveLength(3);
  });
  it("does not hide unanswered operator questions and validates requirement IDs", async () => {
    const {a,op,task} = await setup();
    const q = await a.sendMessage({taskId:task.id,to:"operator",type:"QUESTION",content:"Choose"});
    await expect(op.updateDiscussion({taskId:task.id,messageId:q.id,status:"closed",summary:"Done"})).rejects.toThrow(/pending operator question/);
    await expect(a.sendMessage({taskId:task.id,to:"b",type:"QUESTION",content:"x",requirementId:"bad\nID"})).rejects.toMatchObject({code:"INVALID_INPUT"});
    await op.answerQuestion({taskId:task.id,messageId:q.id,answer:"Yes"});
    expect(listDiscussions(await a.messages.list(task.id))[0]!.status).toBe("open");
    expect((await op.updateDiscussion({taskId:task.id,messageId:q.id,status:"closed",summary:"Yes chosen"})).status).toBe("closed");
    const dismissed = await a.sendMessage({taskId:task.id,to:"operator",type:"QUESTION",content:"Obsolete?"});
    await op.dismissQuestion({taskId:task.id,messageId:dismissed.id});
    const closed = await op.updateDiscussion({taskId:task.id,messageId:dismissed.id,status:"closed",summary:"Obsolete question dismissed"});
    expect(closed.status).toBe("closed"); expect(closed.answeredBy).toEqual([]);
  });
  it("handles legacy orphan links and cycles without losing question history", () => {
    const m=(id:string,type:Message["type"],replyTo?:string):Message=>({id,taskId:"task-1",from:"a",to:"b",content:id,type,replyTo,createdAt:"2026-01-01"});
    const orphan = listDiscussions([m("msg-1","QUESTION","missing"),m("msg-2","INFORMATION","msg-1")]);
    expect(orphan[0]!.messages).toHaveLength(2);
    const cycle = listDiscussions([m("msg-1","QUESTION","msg-2"),m("msg-2","QUESTION","msg-1")]);
    expect(cycle).toHaveLength(1); expect(cycle[0]!.messages).toHaveLength(2);
  });
});
