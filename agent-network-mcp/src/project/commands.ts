import { AppError } from "../errors.js";
import type { NetworkService } from "../service.js";
import type { FileStore } from "../storage/fileStore.js";
import { ProjectStore } from "./store.js";
import { ProjectOperations } from "./operations.js";
import { correlatedRecord } from "./correlation.js";
import { payloadHash, type EffectivePayload } from "./payload.js";
import type { ProjectState } from "./store.js";

export class ProjectCommandService {
  constructor(private readonly fs: FileStore, private readonly operator: NetworkService) {}
  async createFromProposal(proposalId: string, expectedHash: string,
    preflight: (state: ProjectState, payload: EffectivePayload) => Promise<void>) {
    const store = new ProjectStore(this.fs);
    const state = await store.read();
    const proposal = state.proposals.find(p => p.proposalId === proposalId);
    if (!proposal || !["approved", "executed"].includes(proposal.status)) throw new AppError("FORBIDDEN", "Explicit proposal approval is required");
    if (proposal.hash !== expectedHash || payloadHash(proposal.payload) !== expectedHash) throw new AppError("INVALID_INPUT", "Proposal payload mismatch");
    const origin = { projectId: state.projectId, operationId: proposal.operationId };
    const task = await new ProjectOperations(this.fs, state.projectId).execute({
      operationId: proposal.operationId, kind: "create_task", request: { proposalId, hash: expectedHash },
      recover: async () => correlatedRecord(await this.operator.tasks.list(), state.projectId, proposal.operationId),
      mutate: async () => {
        const current = await store.read();
        const saved = current.proposals.find(p => p.proposalId === proposalId);
        if (saved?.status !== "approved" || saved.hash !== expectedHash) throw new AppError("FORBIDDEN", "Proposal is no longer approved");
        await preflight(current, structuredClone(proposal.payload));
        const { maxTaskCostUsd: _resolvedLimit, ...input } = proposal.payload;
        return this.operator.createTaskAsOperator(input, origin);
      },
      finalize: task => this.operator.finalizeProjectTask(task.id, origin, proposal.payload.from ?? []),
    });
    await store.recordCreatedTask(proposalId, task.id);
    return task;
  }
  async sendToTask(input: { taskId: string; content: string; operationId: string }) {
    const state = await new ProjectStore(this.fs).read();
    return new ProjectOperations(this.fs, state.projectId).execute({
      operationId: input.operationId, kind: "send_to_task", request: { taskId: input.taskId, content: input.content },
      recover: async () => correlatedRecord(await this.operator.messages.list(input.taskId), state.projectId, input.operationId),
      mutate: async () => {
        const current = await new ProjectStore(this.fs).read();
        if (!current.tasks.some(t => t.taskId === input.taskId)) throw new AppError("FORBIDDEN", "Task is not linked to this project");
        const task = await this.operator.tasks.get(input.taskId);
        if (!["ACTIVE", "BLOCKED"].includes(task.status)) throw new AppError("INVALID_INPUT", "Closed tasks require a new task proposal");
        return this.operator.messageLead({ taskId: input.taskId, content: input.content }, { projectId: current.projectId, operationId: input.operationId });
      },
    });
  }
}
