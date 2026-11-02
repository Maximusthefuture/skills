import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { createProjectServer } from "../../src/project/mcp.js";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
const brief = { goal: "Avoid duplicate submissions", expectedBehavior: ["Submitting twice creates one record"],
  acceptanceCriteria: [{ condition: "Submit the same request twice", expected: "One record exists", verification: "Inspect the saved records" }] };
it("exposes proposal tools without task creation and revokes access on cancellation", async () => {
  const dir = await tmpDir(), store = new ProjectStore(await FileStore.open(dir));
  const run = await store.enqueue("m1", "request"); await store.claim("owner");
  const server = await createProjectServer({ networkDir: dir, projectId: (await store.read()).projectId, runId: run.runId, ownerToken: "owner", agentIds: ["a", "b"], resolved: {} });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(["read_memory", "propose_memory_change", "read_history", "read_proposal", "read_task_context", "propose_task"]);
    const args = { operationId: "op1", summary: "Goal", brief, payload: { title: "Task", description: "Goal", agents: ["a", "b"] } };
    for (const invalidBrief of [undefined, { ...brief, goal: " " }, { ...brief, expectedBehavior: [] },
      { ...brief, acceptanceCriteria: [] }, { ...brief, acceptanceCriteria: [{ condition: "x", expected: "y", verification: " " }] }]) {
      expect((await client.callTool({ name: "propose_task", arguments: { ...args, brief: invalidBrief } })).isError).toBe(true);
    }
    expect((await store.read()).proposals).toHaveLength(0);
    expect((await client.callTool({ name: "propose_task", arguments: args })).isError).not.toBe(true);
    const proposals = (await store.read()).proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.payload.description).toContain(brief.goal);
    expect(proposals[0]!.payload.description).toContain(brief.expectedBehavior[0]);
    expect(proposals[0]!.payload.description).toContain(brief.acceptanceCriteria[0]!.verification);
    expect((await client.callTool({ name: "propose_task", arguments: args })).isError).not.toBe(true);
    expect((await store.read()).proposals).toHaveLength(1);
    expect((await client.callTool({ name: "propose_task", arguments: { ...args, brief: { ...brief, goal: "Changed" } } })).isError).toBe(true);
    expect((await client.callTool({ name: "propose_task", arguments: { ...args, operationId: "unknown-agent", payload: { ...args.payload, agents: ["a", "unknown"] } } })).isError).toBe(true);
    const memory = await client.callTool({ name: "read_memory", arguments: {} });
    const data = JSON.parse((memory.content as { text: string }[])[0]!.text);
    expect((await client.callTool({ name: "propose_memory_change", arguments: { operationId: "memory1", content: "Agreement", baseHash: data.baseHash } })).isError).not.toBe(true);
    await store.cancel(run.runId);
    expect((await client.callTool({ name: "propose_task", arguments: { ...args, operationId: "op2" } })).isError).toBe(true);
    expect((await client.callTool({ name: "read_history", arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: "propose_memory_change", arguments: { operationId: "memory2", content: "Late write", baseHash: data.baseHash } })).isError).toBe(true);
  } finally { await client.close(); await server.close(); }
});

it("allows retries to read saved proposals but rejects new proposal and memory writes", async () => {
  const dir = await tmpDir(), fs = await FileStore.open(dir), store = new ProjectStore(fs);
  const original = await store.enqueue("retry", "request"); await store.claim("first");
  await store.finish(original.runId, "first", { error: "stopped" });
  const retry = await store.retry(original.runId, "retry-run"); await store.claim("owner");
  const state = await store.read();
  const server = await createProjectServer({ networkDir: dir, projectId: state.projectId, runId: retry.runId, ownerToken: "owner", agentIds: ["a", "b"], resolved: {} });
  const client = new Client({ name: "test", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const memoryResult = await client.callTool({ name: "read_memory", arguments: {} });
    const memory = JSON.parse((memoryResult.content as { text: string }[])[0]!.text) as { baseHash: string };
    expect((await client.callTool({ name: "propose_memory_change", arguments: { operationId: "retry-memory", content: "new", baseHash: memory.baseHash } })).isError).toBe(true);
    expect((await client.callTool({ name: "propose_task", arguments: { operationId: "retry-task", summary: "new", brief, payload: { title: "New", description: "New", agents: ["a", "b"] } } })).isError).toBe(true);
  } finally { await client.close(); await server.close(); }
});
