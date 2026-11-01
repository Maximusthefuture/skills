import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FileStore } from "../storage/fileStore.js";
import { defineTool, errorResult } from "../mcp/toolkit.js";
import { ProjectStore } from "./store.js";
import { historyPage } from "./history.js";
import { normalizeProjectTask, projectTaskFields } from "./payload.js";
import { AppError } from "../errors.js";
import { ProjectMemory } from "./memory.js";
import { projectTaskContextPage } from "./taskContext.js";

export async function createProjectServer(options: {
  networkDir: string; projectId: string; runId: string; ownerToken: string;
  agentIds?: string[];
  resolved: { maxTaskCostUsd?: number; maxCostUsd?: number; verifyCommand?: string };
}): Promise<McpServer> {
  const fs = await FileStore.open(options.networkDir);
  const store = new ProjectStore(fs);
  const server = new McpServer({ name: "agent-network-project", version: "0.1.0" });
  const authorize = async () => {
    const state = await store.read();
    const run = state.runs.find(r => r.runId === options.runId);
    if (state.projectId !== options.projectId || run?.ownerToken !== options.ownerToken || run.state !== "running" || run.cancelRequested)
      throw new AppError("FORBIDDEN", "Project run is no longer authorized");
    return state;
  };
  const onError = (error: unknown) => errorResult({ message: error instanceof Error ? error.message : String(error) });
  defineTool(server, onError, "read_memory", "Read project agreements and their baseHash. Memory is not evidence of code state.", {}, async () => {
    await authorize();
    const memory = await new ProjectMemory(fs, options.projectId).read();
    return { content: memory.content, baseHash: memory.baseHash };
  });
  defineTool(server, onError, "propose_memory_change", "Save immutable proposed memory for separate human approval. Does not change approved memory.", {
    operationId: z.string().min(1), content: z.string().max(16384), baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  }, async input => store.withActiveRun(options.runId, options.ownerToken, async state => {
    if (state.projectId !== options.projectId) throw new AppError("FORBIDDEN", "Wrong project");
    if (state.runs.find(run => run.runId === options.runId)?.retryOfRunId) throw new AppError("FORBIDDEN", "A retry cannot create new memory proposals");
    const change = await new ProjectMemory(fs, options.projectId).propose(input.content, input.baseHash, input.operationId, options.runId);
    return { changeId: change.changeId, status: change.status };
  }));
  defineTool(server, onError, "read_history", "Read a bounded page of project messages; continue with next cursor.", {
    message: z.number().int().nonnegative().default(0), offset: z.number().int().nonnegative().default(0),
  }, async cursor => historyPage(await authorize(), cursor));
  defineTool(server, onError, "read_proposal", "Read a saved proposal by ID, including its exact payload and current status.", {
    proposalId: z.string().min(1),
  }, async ({ proposalId }) => {
    const state = await authorize();
    const proposal = state.proposals.find(item => item.proposalId === proposalId);
    if (!proposal || proposal.projectId !== options.projectId) throw new AppError("INVALID_INPUT", "Unknown project proposal");
    return proposal;
  });
  defineTool(server, onError, "read_task_context", "Read a bounded page of server-owned details for a task linked to this project. Continue with the returned cursor.", {
    taskId: z.string().min(1), cursor: z.number().int().nonnegative().default(0),
  }, async ({ taskId, cursor }) => {
    const state = await authorize();
    if (!state.tasks.some(item => item.taskId === taskId)) throw new AppError("FORBIDDEN", "Task is not linked to this project");
    return projectTaskContextPage(fs, taskId, cursor);
  });
  const agentIds = options.agentIds ?? [];
  const { agents: _agents, ...taskFields } = projectTaskFields;
  const agentSchema = agentIds.length
    ? z.enum(agentIds as [string, ...string[]])
    : z.string().trim().min(1).describe("Runner ID from this project's configured agents");
  const proposalPayload = z.object({
    ...taskFields,
    agents: z.array(agentSchema).min(2).describe(`Required team: choose at least two distinct runner IDs. Available IDs: ${agentIds.join(", ") || "none configured"}. The first ID is the lead.`),
  }).strict().describe("Task fields. title and description explain the work; agents must contain at least two configured runner IDs.");
  defineTool(server, onError, "propose_task", `Save a task proposal for explicit human approval; this never creates or starts a task. payload must include title, description, and agents: an array of at least two distinct configured runner IDs. Available IDs: ${agentIds.join(", ") || "none configured"}. The first agent is the lead. Reuse operationId for delivery retry.`, {
    operationId: z.string().min(1), payload: proposalPayload, summary: z.string().min(1).max(2048), supersedes: z.string().optional(),
  }, async input => {
    await authorize();
    const proposal = await store.propose({ ...input, runId: options.runId, ownerToken: options.ownerToken,
      payload: normalizeProjectTask(input.payload, options.resolved) });
    return { proposalId: proposal.proposalId, status: proposal.status, hash: proposal.hash, createdTask: false };
  });
  return server;
}
