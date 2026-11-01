import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { FileStore } from "../storage/fileStore.js";
import { payloadHash, projectTaskSchema, type EffectivePayload } from "./payload.js";

export interface ProjectProposal {
  taskId?: string;
  proposalId: string;
  projectId: string;
  runId: string;
  operationId: string;
  payload: EffectivePayload;
  hash: string;
  summary: string;
  supersedes?: string;
  status: "pending" | "approved" | "rejected" | "superseded" | "executed" | "failed";
}

export interface ProjectMessage {
  messageId: string;
  content: string;
  createdAt: string;
  replacesMessageId?: string;
}
export interface ProjectRun {
  runId: string;
  messageId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  cancelRequested?: boolean;
  ownerToken?: string;
  retryOfRunId?: string;
  result?: string;
  error?: string;
}
export interface ProjectState {
  version: 1;
  projectId: string;
  name: string;
  paused: boolean;
  approval: "always";
  maxOpenTasks: number;
  proposals: ProjectProposal[];
  messages: ProjectMessage[];
  runs: ProjectRun[];
  tasks: { taskId: string; operationId: string; origin: "created" | "attached" }[];
}

/** A single atomic document keeps message delivery and queue transitions indivisible. */
export class ProjectStore {
  constructor(private readonly fs: FileStore) {}

  private async transaction<T>(fn: (state: ProjectState) => T | Promise<T>): Promise<T> {
    return this.fs.withLock(["project", ".state-lock"], async () => {
      const state = await this.fs.readJson<ProjectState>(["project", "state.json"]) ?? {
        version: 1, projectId: randomUUID(), name: "Project", paused: false,
        approval: "always", maxOpenTasks: 3, messages: [], runs: [], tasks: [], proposals: [],
      };
      state.proposals ??= [];
      const result = await fn(state);
      await this.fs.writeJson(["project", "state.json"], state);
      return structuredClone(result);
    });
  }

  read(): Promise<ProjectState> { return this.transaction(state => state); }

  withActiveRun<T>(runId: string, ownerToken: string, action: (state: ProjectState) => Promise<T>): Promise<T> {
    return this.transaction(async state => {
      const run = this.run(state, runId);
      if (run.state !== "running" || run.cancelRequested || run.ownerToken !== ownerToken) throw new AppError("FORBIDDEN", "Run is no longer authorized");
      return action(structuredClone(state));
    });
  }

  recordCreatedTask(proposalId: string, taskId: string): Promise<void> {
    return this.transaction(state => {
      const proposal = state.proposals.find(p => p.proposalId === proposalId);
      if (!proposal || !["approved", "executed"].includes(proposal.status)) throw new AppError("INVALID_INPUT", "Proposal is not approved");
      if (proposal.taskId && proposal.taskId !== taskId) throw new AppError("INVALID_INPUT", "Proposal already created another task");
      proposal.taskId = taskId; proposal.status = "executed";
      if (!state.tasks.some(t => t.taskId === taskId)) state.tasks.push({ taskId, operationId: proposal.operationId, origin: "created" });
    });
  }

  reviseProposal(proposalId: string, expectedHash: string, payload: EffectivePayload, summary: string): Promise<ProjectProposal> {
    const parsed = projectTaskSchema.parse(payload);
    if (!summary.trim()) throw new AppError("INVALID_INPUT", "Proposal summary is required");
    return this.transaction(state => {
      const old = state.proposals.find(p => p.proposalId === proposalId);
      if (!old || old.status !== "pending" || old.hash !== expectedHash) throw new AppError("INVALID_INPUT", "Proposal changed or is no longer pending");
      const next: ProjectProposal = { proposalId: randomUUID(), projectId: state.projectId, runId: old.runId,
        operationId: randomUUID(), payload: parsed, hash: payloadHash(parsed), summary, supersedes: old.proposalId, status: "pending" };
      old.status = "superseded";
      state.proposals.push(next);
      return next;
    });
  }

  attach(taskId: string, operationId: string, checkTask: (taskId: string) => Promise<void>) {
    if (!operationId.trim()) throw new AppError("INVALID_INPUT", "Operation ID is required");
    return this.transaction(async state => {
      const operation = state.tasks.find(t => t.operationId === operationId);
      if (operation && operation.taskId !== taskId) throw new AppError("INVALID_INPUT", "Operation ID already used for another task");
      await checkTask(taskId);
      const existing = state.tasks.find(t => t.taskId === taskId);
      if (existing) return existing;
      const link = { taskId, operationId, origin: "attached" as const };
      state.tasks.push(link);
      return link;
    });
  }

  detach(taskId: string, taskStatus: (taskId: string) => Promise<string>): Promise<void> {
    return this.transaction(async state => {
      if (!state.tasks.some(t => t.taskId === taskId)) return;
      const status = await taskStatus(taskId);
      if (status === "ACTIVE" || status === "BLOCKED") throw new AppError("INVALID_INPUT", "Open tasks cannot be detached");
      state.tasks = state.tasks.filter(t => t.taskId !== taskId);
    });
  }

  propose(input: { runId: string; ownerToken: string; operationId: string; payload: EffectivePayload; summary: string; supersedes?: string }): Promise<ProjectProposal> {
    const payload = projectTaskSchema.parse(input.payload);
    const digest = payloadHash(payload);
    if (!input.operationId.trim() || !input.summary.trim()) throw new AppError("INVALID_INPUT", "Operation ID and proposal summary are required");
    return this.transaction(state => {
      const run = this.run(state, input.runId);
      if (run.state !== "running" || run.cancelRequested || run.ownerToken !== input.ownerToken) throw new AppError("FORBIDDEN", "Run cannot write proposals");
      const existing = state.proposals.find(p => p.operationId === input.operationId);
      if (existing) {
        if (existing.runId !== run.runId || existing.hash !== digest || existing.summary !== input.summary || existing.supersedes !== input.supersedes) throw new AppError("INVALID_INPUT", "Operation ID already used for another proposal");
        return existing;
      }
      if (run.retryOfRunId) throw new AppError("FORBIDDEN", "Retry must use previously saved proposals");
      if (input.supersedes) {
        const previous = state.proposals.find(p => p.proposalId === input.supersedes);
        if (!previous || previous.status !== "pending") throw new AppError("INVALID_INPUT", "Only pending proposals can be replaced");
        previous.status = "superseded";
      }
      const proposal: ProjectProposal = {
        proposalId: randomUUID(), projectId: state.projectId, runId: run.runId,
        operationId: input.operationId, payload, hash: digest, summary: input.summary, status: "pending",
        ...(input.supersedes ? { supersedes: input.supersedes } : {}),
      };
      state.proposals.push(proposal);
      return proposal;
    });
  }

  /** Preflight is supplied by the command service; the lock prevents concurrent supersession. */
  decideProposal(proposalId: string, expectedHash: string, approve: boolean,
    preflight: (payload: EffectivePayload) => Promise<void>): Promise<ProjectProposal> {
    return this.transaction(async state => {
      const proposal = state.proposals.find(p => p.proposalId === proposalId);
      if (!proposal || proposal.hash !== expectedHash || payloadHash(proposal.payload) !== expectedHash) throw new AppError("INVALID_INPUT", "Proposal payload mismatch");
      const target = approve ? "approved" : "rejected";
      if (proposal.status === target) return proposal;
      if (proposal.status !== "pending") throw new AppError("INVALID_INPUT", "Proposal is no longer pending");
      if (approve) await preflight(structuredClone(proposal.payload));
      proposal.status = target;
      return proposal;
    });
  }

  enqueue(messageId: string, content: string): Promise<ProjectRun> {
    return this.transaction(state => this.enqueueInto(state, messageId, content));
  }

  retry(runId: string, retryRunId: string): Promise<ProjectRun> {
    if (!retryRunId.trim()) throw new AppError("INVALID_INPUT", "Retry run ID is required");
    return this.transaction(state => {
      const previous = this.run(state, runId);
      const existing = state.runs.find(r => r.runId === retryRunId);
      if (existing) {
        if (existing.retryOfRunId !== runId) throw new AppError("INVALID_INPUT", "Retry ID already used");
        return existing;
      }
      if (previous.state !== "failed") throw new AppError("INVALID_INPUT", "Only failed runs can be retried");
      if (state.runs.some(r => r.retryOfRunId === runId && ["queued", "running"].includes(r.state))) throw new AppError("INVALID_INPUT", "Retry already queued or running");
      const retry: ProjectRun = { runId: retryRunId, messageId: previous.messageId, state: "queued", retryOfRunId: runId };
      state.runs.push(retry);
      return retry;
    });
  }

  private enqueueInto(state: ProjectState, messageId: string, content: string): ProjectRun {
    if (!messageId.trim() || !content.trim()) throw new AppError("INVALID_INPUT", "Message ID and text are required");
    const previous = state.messages.find(m => m.messageId === messageId);
    if (previous) {
      if (previous.content !== content) throw new AppError("INVALID_INPUT", "Message ID already has different text");
      return state.runs.find(r => r.messageId === messageId)!;
    }
    state.messages.push({ messageId, content, createdAt: new Date().toISOString() });
    const run: ProjectRun = { runId: randomUUID(), messageId, state: "queued" };
    state.runs.push(run);
    return run;
  }

  setPaused(paused: boolean): Promise<void> {
    return this.transaction(state => { state.paused = paused; });
  }

  claim(ownerToken: string): Promise<ProjectRun | null> {
    if (!ownerToken) throw new AppError("INVALID_INPUT", "Owner token is required");
    return this.transaction(state => {
      if (state.paused || state.runs.some(r => r.state === "running")) return null;
      const run = state.runs.find(r => r.state === "queued");
      if (!run) return null;
      run.state = "running";
      run.ownerToken = ownerToken;
      return run;
    });
  }

  cancel(runId: string): Promise<void> {
    return this.transaction(state => {
      const run = this.run(state, runId);
      if (run.state !== "queued" && run.state !== "running") return;
      state.paused = true;
      run.cancelRequested = true;
      if (run.state === "queued") run.state = "cancelled";
    });
  }

  replaceQueued(runId: string, messageId: string, content: string): Promise<ProjectRun> {
    return this.transaction(state => {
      const old = this.run(state, runId);
      const replacement = state.messages.find(m => m.messageId === messageId);
      if (replacement?.replacesMessageId === old.messageId) return this.enqueueInto(state, messageId, content);
      if (old.state !== "queued" || replacement) throw new AppError("INVALID_INPUT", "Queued message changed; refresh before replacing it");
      const next = this.enqueueInto(state, messageId, content);
      state.messages.find(m => m.messageId === messageId)!.replacesMessageId = old.messageId;
      old.state = "cancelled";
      return next;
    });
  }

  /** Call only after the child process has exited. Cancellation discards late output. */
  finish(runId: string, ownerToken: string, outcome: { result?: string; error?: string }): Promise<void> {
    return this.transaction(state => {
      const run = this.run(state, runId);
      if (run.state !== "running" || run.ownerToken !== ownerToken) throw new AppError("FORBIDDEN", "Run is not owned by this Coordinator");
      if (run.cancelRequested) run.state = "cancelled";
      else {
        run.state = outcome.error === undefined ? "succeeded" : "failed";
        Object.assign(run, outcome);
      }
      delete run.ownerToken;
    });
  }

  /** The caller must hold the Coordinator lifetime lock before recovery or claiming runs. */
  recoverInterrupted(): Promise<void> {
    return this.transaction(state => {
      for (const run of state.runs) if (run.state === "running") {
        run.state = "failed";
        run.error = "interrupted";
        delete run.ownerToken;
      }
    });
  }

  private run(state: ProjectState, runId: string): ProjectRun {
    const run = state.runs.find(r => r.runId === runId);
    if (!run) throw new AppError("INVALID_INPUT", "Unknown project run");
    return run;
  }
}
