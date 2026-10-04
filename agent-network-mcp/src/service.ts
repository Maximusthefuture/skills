import { dirname } from "node:path";
import { AppError } from "./errors.js";
import { EventHub } from "./events/eventHub.js";
import { readGitContext } from "./git.js";
import { PhaseManager, type Transition } from "./phase/phaseManager.js";
import { FileStore } from "./storage/fileStore.js";
import { AgentStore } from "./stores/agentStore.js";
import { AgreementStore } from "./stores/agreementStore.js";
import { EventStore, GLOBAL_SCOPE, type NewEvent } from "./stores/eventStore.js";
import { ImplementationStore } from "./stores/implementationStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { SyncStore } from "./stores/syncStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type {
  Agent,
  AgentIdentity,
  AgentStatus,
  Agreement,
  Assignment,
  Implementation,
  Message,
  MessageType,
  NetworkEvent,
  SyncFinding,
  SyncReport,
  SyncStatus,
  Task,
} from "./types.js";
import {
  assertAgentId,
  assertCommit,
  assertMessageId,
  assertRelativeFilePath,
  assertTaskId,
} from "./validation.js";

export const DEFAULT_WAIT_MS = 30_000;
export const MAX_WAIT_MS = 300_000;

export interface ServiceOptions {
  hub?: EventHub;
  log?: (msg: string) => void;
}

export type WaitResult = { status: "EVENT"; event: NetworkEvent } | { status: "TIMEOUT" };

/**
 * All protocol logic. One instance per MCP process; `identity` comes from the process environment,
 * so no method accepts a sender / agent id from the caller.
 */
export class NetworkService {
  readonly agents: AgentStore;
  readonly tasks: TaskStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly agreements: AgreementStore;
  readonly implementations: ImplementationStore;
  readonly syncs: SyncStore;
  readonly phases = new PhaseManager();
  readonly hub: EventHub;
  private pollQueue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly fs: FileStore,
    readonly identity: AgentIdentity,
    opts: ServiceOptions,
  ) {
    this.agents = new AgentStore(fs);
    this.tasks = new TaskStore(fs);
    this.messages = new MessageStore(fs);
    this.events = new EventStore(fs);
    this.agreements = new AgreementStore(fs);
    this.implementations = new ImplementationStore(fs);
    this.syncs = new SyncStore(fs);
    this.hub = opts.hub ?? new EventHub(fs.root, { log: opts.log });
  }

  static async create(networkDir: string, identity: AgentIdentity, opts: ServiceOptions = {}): Promise<NetworkService> {
    assertAgentId(identity.id, "AGENT_ID");
    const fs = await FileStore.open(networkDir);
    await fs.createJson(["network.json"], { version: 1, createdAt: new Date().toISOString() });
    return new NetworkService(fs, identity, opts);
  }

  get networkDir(): string {
    return this.fs.root;
  }

  get me(): string {
    return this.identity.id;
  }

  close(): void {
    this.hub.close();
  }

  // ---------------------------------------------------------------- agents

  async registerAgent(announce = false): Promise<{ agent: Agent; created: boolean }> {
    const res = await this.agents.register(this.identity);
    if (res.created || announce) await this.emit({ type: "AGENT_REGISTERED", sourceAgent: this.me, payload: { agentId: this.me, type: res.agent.type, role: res.agent.role } });
    return res;
  }

  async listAgents(): Promise<Agent[]> {
    await this.requireMe();
    return this.agents.list();
  }

  async heartbeat(status?: AgentStatus): Promise<Agent> {
    return this.agents.heartbeat(this.me, status);
  }

  async markOffline(): Promise<void> {
    await this.agents.setStatus(this.me, "OFFLINE");
  }

  // ---------------------------------------------------------------- tasks

  async createTask(input: { title: string; description: string; agents: string[] }): Promise<Task> {
    await this.requireMe();
    return this.createTaskCore(this.me, input, true);
  }

  /**
   * Task creation from outside the LLM (CLI / operator). The creator is not an agent and the task agents
   * do not have to be registered yet: they register when their MCP processes start.
   */
  async createTaskAsOperator(input: { title: string; description: string; agents: string[] }): Promise<Task> {
    return this.createTaskCore("operator", input, false);
  }

  private async createTaskCore(createdBy: string, input: { title: string; description: string; agents: string[] }, asAgent: boolean): Promise<Task> {
    const title = input.title.trim();
    if (!title) throw new AppError("INVALID_INPUT", "title must not be empty");
    const agents = [...new Set(input.agents.map((a) => assertAgentId(a)))];
    if (agents.length < 2) throw new AppError("INVALID_INPUT", "A task needs at least two distinct agents");
    if (asAgent) {
      if (!agents.includes(createdBy)) throw new AppError("NOT_ASSIGNED", "The creating agent must be one of the task agents");
      for (const a of agents) await this.agents.require(a);
    }

    const git = await readGitContext(dirname(this.fs.root));
    const task = await this.tasks.create({ title, description: input.description, agents, createdBy, git });
    await this.emit({ type: "TASK_CREATED", taskId: task.id, sourceAgent: createdBy, payload: { title, agents } });
    return task;
  }

  /** Operator: retire a task (wrong or empty assignment). Agents move on to their next task. */
  async cancelTask(taskId: string, reason?: string): Promise<Task> {
    assertTaskId(taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "ACTIVE") throw new AppError("ALREADY_COMPLETED", `Task ${taskId} is already ${task.status}`);
      const saved = await this.tasks.save({ ...task, status: "CANCELLED" });
      await this.emit({ type: "TASK_CANCELLED", taskId, sourceAgent: "operator", payload: { reason: reason ?? null } });
      return saved;
    });
  }

  async getTask(taskId: string): Promise<Task> {
    await this.requireMe();
    return this.requireMember(taskId);
  }

  // ---------------------------------------------------------------- agreement

  async proposeAgreement(input: {
    taskId: string;
    summary: string;
    assignments: Assignment[];
    decisions?: string[];
    interfaces?: string[];
  }): Promise<{ agreement: Agreement; phase: Task["phase"] }> {
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "DISCUSS");
      const ids = input.assignments.map((a) => assertAgentId(a.agentId));
      if (new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT", "Each agent may have only one assignment");
      for (const id of ids) if (!task.agents.includes(id)) throw new AppError("NOT_ASSIGNED", `Agent '${id}' is not part of ${task.id}`);
      const missing = task.agents.filter((a) => !ids.includes(a));
      if (missing.length) throw new AppError("INVALID_INPUT", `Every task agent needs an assignment; missing: ${missing.join(", ")}`);

      const previous = await this.agreements.find(task.id);
      const agreement: Agreement = {
        taskId: task.id,
        summary: input.summary,
        assignments: input.assignments,
        decisions: input.decisions ?? [],
        interfaces: input.interfaces ?? [],
        approvedBy: [],
        createdAt: new Date().toISOString(),
        proposedBy: this.me,
        version: (previous?.version ?? 0) + 1,
      };
      await this.agreements.save(agreement);
      await this.emit({ type: "AGREEMENT_UPDATED", taskId: task.id, sourceAgent: this.me, payload: { proposedBy: this.me, version: agreement.version } });
      return { agreement };
    });
  }

  async approveAgreement(input: { taskId: string; version?: number }): Promise<{ agreement: Agreement; phase: Task["phase"] }> {
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "DISCUSS");
      const agreement = await this.agreements.find(task.id);
      if (!agreement) throw new AppError("AGREEMENT_NOT_READY", "No agreement has been proposed yet; use agreement_propose first");
      if (!agreement.assignments.some((a) => a.agentId === this.me)) throw new AppError("NOT_ASSIGNED", "You have no assignment in this agreement");
      if (input.version !== undefined && input.version !== agreement.version) {
        throw new AppError("INVALID_INPUT", `Agreement changed: you approved version ${input.version}, current is ${agreement.version}. Read it with agreement_get`);
      }
      if (agreement.approvedBy.includes(this.me)) throw new AppError("ALREADY_COMPLETED", "You already approved this agreement");
      const updated: Agreement = { ...agreement, approvedBy: [...agreement.approvedBy, this.me] };
      await this.agreements.save(updated);
      await this.emit({ type: "AGREEMENT_APPROVED", taskId: task.id, sourceAgent: this.me, payload: { approvedBy: this.me, version: updated.version } });
      return { agreement: updated };
    });
  }

  async getAgreement(taskId: string): Promise<Agreement> {
    await this.requireMe();
    const task = await this.requireMember(taskId);
    const agreement = await this.agreements.find(task.id);
    if (!agreement) throw new AppError("AGREEMENT_NOT_READY", "No agreement has been proposed yet");
    return agreement;
  }

  // ---------------------------------------------------------------- messages

  async sendMessage(input: { taskId: string; to: string; type: MessageType; content: string; replyTo?: string }): Promise<Message> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    if (task.status === "COMPLETED") throw new AppError("ALREADY_COMPLETED", "The task is completed");
    const to = assertAgentId(input.to, "to");
    if (to === this.me) throw new AppError("INVALID_INPUT", "You cannot send a message to yourself");
    if (!task.agents.includes(to)) throw new AppError("NOT_ASSIGNED", `Agent '${to}' is not part of ${task.id}`);
    if (!input.content.trim()) throw new AppError("INVALID_INPUT", "content must not be empty");
    if (input.replyTo) {
      assertMessageId(input.replyTo);
      await this.messages.get(task.id, input.replyTo);
    }
    const message = await this.messages.create({ taskId: task.id, from: this.me, to, type: input.type, content: input.content, replyTo: input.replyTo });
    await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: to, sourceAgent: this.me, payload: { messageId: message.id, from: this.me, type: message.type } });
    return message;
  }

  async listMessages(input: { taskId: string; direction?: "inbox" | "sent" | "all"; unreadOnly?: boolean }): Promise<Message[]> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    const direction = input.direction ?? "inbox";
    const all = await this.messages.list(task.id, { unreadOnly: input.unreadOnly });
    return all.filter((m) => (direction === "inbox" ? m.to === this.me : direction === "sent" ? m.from === this.me : m.to === this.me || m.from === this.me));
  }

  async readMessage(input: { taskId: string; messageId: string }): Promise<Message> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    const message = await this.messages.get(task.id, input.messageId);
    if (message.to === this.me) return this.messages.markRead(message);
    if (message.from === this.me) return message;
    throw new AppError("FORBIDDEN", "This message is addressed to another agent");
  }

  // ---------------------------------------------------------------- events

  async waitForEvent(input: { taskId?: string; timeoutMs?: number }, signal?: AbortSignal): Promise<WaitResult> {
    await this.requireMe();
    if (input.taskId) await this.requireMember(input.taskId);
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);

    // 1. filesystem first: events that arrived while we were away (restart, lost watcher, race)
    const pending = await this.pollEvents(input.taskId);
    if (pending) return { status: "EVENT", event: pending };
    if (timeoutMs === 0) return { status: "TIMEOUT" };

    // 2. register a waiter; the shared watcher + fallback poll re-run the same filesystem check
    await this.agents.setStatus(this.me, "WAITING").catch(() => undefined);
    try {
      const event = await this.hub.wait(() => this.pollEvents(input.taskId), timeoutMs, signal);
      return event ? { status: "EVENT", event } : { status: "TIMEOUT" };
    } finally {
      await this.agents.setStatus(this.me, "WORKING").catch(() => undefined);
    }
  }

  /** Next unconsumed event for this agent (consuming it), or null. Serialized per process. */
  private pollEvents(taskId?: string): Promise<NetworkEvent | null> {
    const run = this.pollQueue.then(() => this.pollEventsNow(taskId));
    this.pollQueue = run.catch(() => undefined);
    return run;
  }

  private async pollEventsNow(taskId?: string): Promise<NetworkEvent | null> {
    const scopes = taskId ? [taskId] : [GLOBAL_SCOPE, ...(await this.tasks.listForAgent(this.me)).map((t) => t.id)];
    const cursors = await this.events.getCursors(this.me);

    const firstMatch: { scope: string; seq: number; event: NetworkEvent }[] = [];
    const scannedMax = new Map<string, number>();
    for (const scope of scopes) {
      const stored = await this.events.list(scope, cursors[scope] ?? 0);
      for (const { event, seq } of stored) {
        scannedMax.set(scope, seq);
        if (this.isDeliverable(event)) {
          firstMatch.push({ scope, seq, event });
          break; // only the oldest match per scope; later ones stay unconsumed
        }
      }
    }

    // non-matching events are skipped for good (deterministic), so move cursors past them
    const winner = [...firstMatch].sort((a, b) => a.event.createdAt.localeCompare(b.event.createdAt) || a.seq - b.seq)[0];
    for (const [scope, max] of scannedMax) {
      const candidate = firstMatch.find((m) => m.scope === scope);
      const upTo = candidate ? (candidate === winner ? candidate.seq : candidate.seq - 1) : max;
      if (upTo > (cursors[scope] ?? 0)) await this.events.setCursor(this.me, scope, upTo);
    }
    return winner?.event ?? null;
  }

  private isDeliverable(event: NetworkEvent): boolean {
    if (event.sourceAgent === this.me) return false;
    return event.targetAgent == null || event.targetAgent === this.me;
  }

  // ---------------------------------------------------------------- implementation

  async startImplementation(taskId: string): Promise<{ implementation: Implementation; alreadyStarted: boolean; phase: Task["phase"] }> {
    return this.mutate(taskId, async (task) => {
      this.requirePhase(task, "IMPLEMENT");
      const existing = await this.implementations.find(task.id, this.me);
      if (existing?.status === "IN_PROGRESS") return { implementation: existing, alreadyStarted: true };
      if (existing?.status === "READY_FOR_SYNC") throw new AppError("ALREADY_COMPLETED", "Your implementation is already READY_FOR_SYNC");
      const implementation: Implementation = { taskId: task.id, agentId: this.me, status: "IN_PROGRESS", summary: "", filesChanged: [], commits: [] };
      await this.implementations.save(implementation);
      await this.emit({ type: "IMPLEMENTATION_STARTED", taskId: task.id, sourceAgent: this.me, payload: { agentId: this.me } });
      return { implementation, alreadyStarted: false };
    });
  }

  async completeImplementation(input: { taskId: string; summary: string; filesChanged?: string[]; commits?: string[] }): Promise<{ implementation: Implementation; phase: Task["phase"] }> {
    const filesChanged = (input.filesChanged ?? []).map(assertRelativeFilePath);
    const commits = (input.commits ?? []).map(assertCommit);
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "IMPLEMENT");
      const existing = await this.implementations.find(task.id, this.me);
      if (!existing) throw new AppError("NOT_STARTED", "Call implementation_start before implementation_complete");
      if (existing.status === "READY_FOR_SYNC") throw new AppError("ALREADY_COMPLETED", "Your implementation is already READY_FOR_SYNC");
      const implementation: Implementation = { ...existing, status: "READY_FOR_SYNC", summary: input.summary, filesChanged, commits, completedAt: new Date().toISOString() };
      await this.implementations.save(implementation);
      await this.emit({ type: "IMPLEMENTATION_COMPLETED", taskId: task.id, sourceAgent: this.me, payload: { agentId: this.me, filesChanged, commits } });
      return { implementation };
    });
  }

  async listImplementations(taskId: string): Promise<Implementation[]> {
    await this.requireMe();
    const task = await this.requireMember(taskId);
    return this.implementations.list(task.id);
  }

  // ---------------------------------------------------------------- sync

  async submitSync(input: { taskId: string; status: SyncStatus; findings?: SyncFinding[] }): Promise<{ report: SyncReport; phase: Task["phase"] }> {
    const findings = (input.findings ?? []).map((f) => ({
      ...f,
      ...(f.files ? { files: f.files.map(assertRelativeFilePath) } : {}),
      ...(f.relatedAgent ? { relatedAgent: assertAgentId(f.relatedAgent, "relatedAgent") } : {}),
    }));
    if (input.status === "NEEDS_FIX" && findings.length === 0) {
      throw new AppError("INVALID_INPUT", "NEEDS_FIX requires at least one finding explaining what must be fixed");
    }
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "SYNC");
      for (const f of findings) {
        if (f.relatedAgent && !task.agents.includes(f.relatedAgent)) throw new AppError("NOT_ASSIGNED", `relatedAgent '${f.relatedAgent}' is not part of ${task.id}`);
      }
      const round = await this.syncs.list(task.id, task.syncRound);
      if (round.some((r) => r.agentId === this.me)) throw new AppError("ALREADY_COMPLETED", `You already submitted a sync report for round ${task.syncRound}`);
      const report = await this.syncs.create({ taskId: task.id, agentId: this.me, status: input.status, findings, round: task.syncRound });
      await this.emit({ type: "SYNC_REPORT_CREATED", taskId: task.id, sourceAgent: this.me, payload: { reportId: report.id, agentId: this.me, status: report.status, round: report.round } });
      return { report };
    });
  }

  async listSyncReports(input: { taskId: string; round?: number }): Promise<SyncReport[]> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    return this.syncs.list(task.id, input.round);
  }

  // ---------------------------------------------------------------- phase

  async getPhase(taskId: string) {
    await this.requireMe();
    const task = await this.requireMember(taskId);
    const [agreement, implementations, reports] = await Promise.all([
      this.agreements.find(task.id),
      this.implementations.list(task.id),
      this.syncs.list(task.id, task.syncRound),
    ]);
    let waitingOn: string[] = [];
    let hint = "";
    switch (task.phase) {
      case "DISCUSS":
        if (!agreement) {
          waitingOn = [...task.agents];
          hint = "Discuss with message_send, then someone calls agreement_propose";
        } else {
          waitingOn = agreement.assignments.map((a) => a.agentId).filter((id) => !agreement.approvedBy.includes(id));
          hint = "Agents listed in waitingOn must call agreement_approve";
        }
        break;
      case "IMPLEMENT":
        waitingOn = task.agents.filter((id) => !implementations.some((i) => i.agentId === id && i.status === "READY_FOR_SYNC"));
        hint = "Agents in waitingOn must implementation_start (if needed) and implementation_complete";
        break;
      case "SYNC":
        waitingOn = task.agents.filter((id) => !reports.some((r) => r.agentId === id));
        hint = "Agents in waitingOn must review the others' work and call sync_submit";
        break;
      case "DONE":
        hint = "Task is complete";
    }
    return {
      taskId: task.id,
      phase: task.phase,
      status: task.status,
      syncRound: task.syncRound,
      agents: task.agents,
      waitingOn,
      youAreWaitedOn: waitingOn.includes(this.me),
      hint,
    };
  }

  // ---------------------------------------------------------------- internals

  private async requireMe(): Promise<Agent> {
    return this.agents.require(this.me);
  }

  private async requireMember(taskId: string): Promise<Task> {
    assertTaskId(taskId);
    const task = await this.tasks.get(taskId);
    if (!task.agents.includes(this.me)) throw new AppError("NOT_ASSIGNED", `You are not assigned to ${taskId}`);
    return task;
  }

  private requirePhase(task: Task, expected: Task["phase"]): void {
    if (task.phase !== expected) {
      throw new AppError("INVALID_PHASE", `Task ${task.id} is in phase ${task.phase}; this action requires ${expected}`);
    }
  }

  /** Run a state change under the task lock, then apply any automatic phase transition that became due. */
  private async mutate<T extends object>(taskId: string, fn: (task: Task) => Promise<T>): Promise<T & { phase: Task["phase"] }> {
    assertTaskId(taskId);
    await this.requireMe();
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.requireMember(taskId);
      if (task.status === "CANCELLED") throw new AppError("ALREADY_COMPLETED", `Task ${taskId} was cancelled by the operator`);
      const result = await fn(task);
      const after = await this.advance(taskId);
      return { ...result, phase: after.phase };
    });
  }

  private async advance(taskId: string): Promise<Task> {
    let task = await this.tasks.get(taskId);
    for (let i = 0; i < 4; i++) {
      const [agreement, implementations, syncReports] = await Promise.all([
        this.agreements.find(taskId),
        this.implementations.list(taskId),
        this.syncs.list(taskId, task.syncRound),
      ]);
      const transition = this.phases.evaluate({ task, agreement, implementations, syncReports });
      if (!transition) return task;
      task = await this.applyTransition(task, transition, syncReports);
    }
    return task;
  }

  private async applyTransition(task: Task, t: Transition, reports: SyncReport[]): Promise<Task> {
    const next = this.phases.apply(task, t);
    if (t.needsFix) {
      for (const agentId of t.needsFix) {
        const impl = await this.implementations.find(task.id, agentId);
        if (impl) {
          const { completedAt: _drop, ...rest } = impl;
          await this.implementations.save({ ...rest, status: "IN_PROGRESS" });
        }
      }
    }
    const saved = await this.tasks.save(next);
    await this.emit({
      type: "PHASE_CHANGED",
      taskId: task.id,
      payload: {
        from: t.from,
        to: t.to,
        reason: t.reason,
        ...(t.needsFix ? { needsFix: t.needsFix, reportIds: reports.filter((r) => r.status === "NEEDS_FIX").map((r) => r.id) } : {}),
      },
    });
    if (t.to === "SYNC") await this.emit({ type: "SYNC_REQUIRED", taskId: task.id, payload: { round: saved.syncRound } });
    if (t.to === "DONE") await this.emit({ type: "TASK_COMPLETED", taskId: task.id, payload: { title: saved.title } });
    return saved;
  }

  private async emit(e: NewEvent): Promise<NetworkEvent> {
    const event = await this.events.create(e);
    this.hub.notify();
    return event;
  }
}
