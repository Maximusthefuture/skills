import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { DiscussionStore, listDiscussions } from "../../src/discussions.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const lead = await NetworkService.create(dir, { id: "lead", type: "test" });
  const peer = await NetworkService.create(dir, { id: "peer", type: "test" });
  const task = await operator.createTaskAsOperator({ title: "Discuss", description: "Discuss requirement priority", agents: ["lead", "peer"] });
  const a = new Swarm(lead), b = new Swarm(peer);
  await a.context(); await b.context();
  return { dir, operator, lead, peer, task, a, b };
}
describe("discussion MCP message integration", () => {
  it("sends a peer question and nested reply with requirement provenance; a reply never closes it", async () => {
    const { dir, task, lead, a, b } = await setup();
    const asked = await a.sendMessage({ to: "peer", message: "Does deny win?", question: true, requirementId: "REQ-001" });
    const replied = await b.sendMessage({ to: "lead", message: "Yes, deny wins", replyTo: asked.messageId as string });
    const messages = await lead.messages.list(task.id);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: asked.messageId, type: "QUESTION", requirementId: "REQ-001", to: "peer" }),
      expect.objectContaining({ id: replied.messageId, replyTo: asked.messageId, requirementId: "REQ-001" }),
    ]));
    const metadata = await new DiscussionStore(await FileStore.open(dir)).read(task.id);
    expect(listDiscussions(messages, metadata)).toEqual([expect.objectContaining({ id: asked.messageId, status: "open", requirementId: "REQ-001", answeredBy: ["peer"], messages: expect.any(Array) })]);
  });
  it("rejects agent closure and foreign-task replies without changing discussions", async () => {
    const { task, operator, lead, a } = await setup();
    const asked = await a.sendMessage({ to: "peer", message: "Question", question: true });
    await expect(lead.updateDiscussion({ taskId: task.id, messageId: asked.messageId as string, status: "closed", summary: "Agent says closed" })).rejects.toThrow(/operator/i);
    const other = await operator.createTaskAsOperator({ title: "Other", description: "Separate context", agents: ["lead", "peer"] });
    await expect(lead.sendMessage({ taskId: other.id, to: "peer", type: "INFORMATION", content: "Wrong task", replyTo: asked.messageId as string })).rejects.toThrow();
    expect(await lead.messages.list(other.id)).toHaveLength(0);
  });
});
