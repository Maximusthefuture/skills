import { dirname } from "node:path";
import { AppError } from "./errors.js";
import { EventHub } from "./events/eventHub.js";
import { readGitContext } from "./git.js";
import { writeHandoffMarker } from "./handoff.js";
import { archiveChange, changePath, readChange, type Exec } from "./openspec.js";
import { anyDeclared, covers, findOverlaps, matches, normalizePath, overlaps, ownersOf } from "./ownership.js";
import { DEFAULT_MAX_FIX_ROUNDS, isHalt, PhaseManager, type Halt, type Transition } from "./phase/phaseManager.js";
import { FileStore } from "./storage/fileStore.js";
import { AgentStore } from "./stores/agentStore.js";
import { AgreementStore } from "./stores/agreementStore.js";
import { EventStore, GLOBAL_SCOPE, type NewEvent } from "./stores/eventStore.js";
import { GrantStore } from "./stores/grantStore.js";
import { ImplementationStore } from "./stores/implementationStore.js";
import { IntegrationStore } from "./stores/integrationStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { SubtaskStore } from "./stores/subtaskStore.js";
import { SyncStore } from "./stores/syncStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type {
  Agent,
  AgentIdentity,
  AgentStatus,
  Agreement,
  FollowUpRequest,
  Assignment,
  Implementation,
  IntegrationReport,
  Message,
  MessageType,
  NetworkEvent,
  SubtaskList,
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

export const DEFAULT_WAIT_MS = 120_000;
export const MAX_WAIT_MS = 300_000;
/** A task description must say concretely what to build. */
export const MIN_DESCRIPTION = 40;
export const MAX_SUBTASKS = 50;
/** The human behind the network (UI, CLI). Agents ask it with send_message(to: "operator"); it is never a task agent. */
export const OPERATOR = "operator";

export interface ServiceOptions {
  hub?: EventHub;
  log?: (msg: string) => void;
}

export interface NewTaskInput {
  title: string;
  description: string;
  agents: string[];
  /** Default 3. */
  maxFixRounds?: number;
  verifyCommand?: string;
  /** How many follow-up tasks the leads of this chain may create when they integrate. Default 0 (none). */
  maxFollowUps?: number;
  /** The task implements this OpenSpec change of the project (openspec/changes/<name>/). */
  openspec?: string;
}

/** An assignment that declares an empty file list: the agent changes nothing and reviews the others' work. */
export function isReviewOnly(a: Assignment | undefined): boolean {
  // an OpenSpec lead without tasks of its own only holds the change folder (to tick tasks.md at INTEGRATE): still a reviewer
  return !!a && Array.isArray(a.files) && a.files.every((f) => CHANGE_DIR.test(f)) && !a.tasks?.length;
}

const CHANGE_DIR = /^openspec\/changes\/[a-z0-9][a-z0-9-]*\/\*\*$/;

/** The text an OpenSpec task starts with: where the WHAT is. The operator's own words follow it. */
export function openspecDescription(change: string, operatorText: string): string {
  const head = `Implement the OpenSpec change ${changePath(change)}/: proposal.md (why and what), design.md (how), specs/ (each scenario is a test), tasks.md (the numbered tasks to split between the agents).`;
  return operatorText.trim() ? `${head}\n\n${operatorText.trim()}` : head;
}

/** NEEDS_FIX means "an ERROR must be fixed"; WARNING / INFO findings travel with PASS as notes. */
function checkVerdict(status: SyncStatus, findings: SyncFinding[]): void {
  const errors = findings.filter((f) => f.severity === "ERROR").length;
  if (status === "NEEDS_FIX" && errors === 0) {
    throw new AppError("INVALID_INPUT", "NEEDS_FIX requires at least one finding with severity ERROR (something that is broken or violates the agreement). Report WARNING / INFO findings with status PASS.");
  }
  if (status === "PASS" && errors > 0) {
    throw new AppError("INVALID_INPUT", "A finding with severity ERROR means NEEDS_FIX. Use status NEEDS_FIX, or downgrade the finding to WARNING if it does not have to be fixed.");
  }
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
  readonly grants: GrantStore;
  readonly integrations: IntegrationStore;
  readonly subtasks: SubtaskStore;
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
    this.grants = new GrantStore(fs);
    this.integrations = new IntegrationStore(fs);
    this.subtasks = new SubtaskStore(fs);
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

  /** This session was told to hand the task over to a fresh one: lets the Stop hook release it. */
  async markHandoff(taskId: string, epoch: number): Promise<void> {
    await writeHandoffMarker(this.fs, this.me, taskId, epoch);
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

  async createTask(input: NewTaskInput): Promise<Task> {
    await this.requireMe();
    return this.createTaskCore(this.me, input, true);
  }

  /**
   * Task creation from outside the LLM (CLI / operator). The creator is not an agent and the task agents
   * do not have to be registered yet: they register when their MCP processes start.
   */
  async createTaskAsOperator(input: NewTaskInput): Promise<Task> {
    return this.createTaskCore("operator", input, false);
  }

  /** The project the network belongs to (<project>/.agent-network): OpenSpec changes are read from there. */
  get projectDir(): string {
    return dirname(this.fs.root);
  }

  private async createTaskCore(createdBy: string, input: NewTaskInput, asAgent: boolean): Promise<Task> {
    const change = input.openspec?.trim() ? await readChange(this.projectDir, input.openspec.trim()) : null;
    const title = input.title.trim() || change?.name || "";
    if (!title) throw new AppError("INVALID_INPUT", "title must not be empty");
    const agents = [...new Set(input.agents.map((a) => assertAgentId(a)))];
    if (agents.length < 2) throw new AppError("INVALID_INPUT", "A task needs at least two distinct agents");
    if (agents.includes(OPERATOR)) throw new AppError("INVALID_INPUT", `'${OPERATOR}' is reserved for the human operator and cannot be a task agent`);
    if (asAgent) {
      if (!agents.includes(createdBy)) throw new AppError("NOT_ASSIGNED", "The creating agent must be one of the task agents");
      for (const a of agents) await this.agents.require(a);
    }

    const maxFixRounds = input.maxFixRounds ?? DEFAULT_MAX_FIX_ROUNDS;
    if (!Number.isInteger(maxFixRounds) || maxFixRounds < 0 || maxFixRounds > 20) throw new AppError("INVALID_INPUT", "maxFixRounds must be an integer 0..20");
    const verifyCommand = input.verifyCommand?.trim() || undefined;
    const maxFollowUps = input.maxFollowUps ?? 0;
    if (!Number.isInteger(maxFollowUps) || maxFollowUps < 0 || maxFollowUps > 20) throw new AppError("INVALID_INPUT", "maxFollowUps must be an integer 0..20");

    const git = await readGitContext(this.projectDir);
    const description = change ? openspecDescription(change.name, input.description) : input.description;
    const task = await this.tasks.create({ title, description, agents, createdBy, git, maxFixRounds, verifyCommand, maxFollowUps, ...(change ? { openspec: change.name } : {}) });
    await this.emit({ type: "TASK_CREATED", taskId: task.id, sourceAgent: createdBy, payload: { title, agents } });
    return task;
  }

  /** Operator: retire a task (wrong or empty assignment). Agents move on to their next task. */
  async cancelTask(taskId: string, reason?: string): Promise<Task> {
    assertTaskId(taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "ACTIVE" && task.status !== "BLOCKED") throw new AppError("ALREADY_COMPLETED", `Task ${taskId} is already ${task.status}`);
      const saved = await this.tasks.save({ ...task, status: "CANCELLED" });
      await this.emit({ type: "TASK_CANCELLED", taskId, sourceAgent: "operator", payload: { reason: reason ?? null } });
      return saved;
    });
  }

  /** Operator: give a BLOCKED task more fix rounds; the fix that was held back starts right away. */
  async unblockTask(taskId: string, extraRounds = 1): Promise<Task> {
    assertTaskId(taskId);
    if (!Number.isInteger(extraRounds) || extraRounds < 1 || extraRounds > 20) throw new AppError("INVALID_INPUT", "rounds must be an integer 1..20");
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "BLOCKED") throw new AppError("INVALID_INPUT", `Task ${taskId} is ${task.status}, not BLOCKED`);
      const { blockedReason: _drop, ...rest } = task;
      await this.tasks.save({ ...rest, status: "ACTIVE", maxFixRounds: this.phases.maxFixRounds(task) + extraRounds });
      await this.emit({ type: "TASK_UNBLOCKED", taskId, sourceAgent: "operator", payload: { extraRounds } });
      return this.advance(taskId);
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

      const normalized = input.assignments.map(({ tasks, ...a }) => ({
        ...a,
        ...(a.files ? { files: [...new Set(a.files.map((f) => normalizePath(assertRelativeFilePath(f))))] } : {}),
        ...(task.openspec && tasks !== undefined ? { tasks } : {}), // task numbers mean something only for an OpenSpec task
      }));
      const assignments = task.openspec ? await this.splitOpenspec(task, normalized) : normalized;
      const overlaps = findOverlaps(assignments);
      if (overlaps.length) {
        const first = overlaps[0]!;
        throw new AppError(
          "FILE_OVERLAP",
          `Two agents claim the same files: ${first.agents[0]} '${first.files[0]}' and ${first.agents[1]} '${first.files[1]}'` +
            `${overlaps.length > 1 ? ` (and ${overlaps.length - 1} more)` : ""}. Split the files so that every file has ONE owner (talk it over with send_message); ` +
            `if an agent later needs a file of the other, it asks with send_message(requestFiles=[...]).`,
          { overlaps },
        );
      }

      const previous = await this.agreements.find(task.id);
      const agreement: Agreement = {
        taskId: task.id,
        summary: input.summary,
        assignments,
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

  /**
   * OpenSpec task: every open task of tasks.md goes to exactly one agent (assignments[].tasks); the change folder belongs
   * to the lead, who gets it in its files, so nobody else may change it (the lead ticks tasks.md when it integrates).
   */
  private async splitOpenspec(task: Task, assignments: Assignment[]): Promise<Assignment[]> {
    const change = await readChange(this.projectDir, task.openspec!.change);
    const dir = `${change.path}/**`;
    const lead = this.phases.integrator(task);
    const noTasks = assignments.filter((a) => !Array.isArray(a.tasks)).map((a) => a.agentId);
    if (noTasks.length) {
      throw new AppError(
        "OPENSPEC_TASKS",
        `This task implements the OpenSpec change ${change.path}: every assignment needs 'tasks', the tasks.md numbers that agent implements ([] for an agent that only reviews). Missing for: ${noTasks.join(", ")}.`,
        { openTasks: change.tasks.filter((t) => !t.done).map((t) => t.id) },
      );
    }
    const cleaned = assignments.map((a) => ({ ...a, tasks: [...new Set(a.tasks!.map((t) => String(t).trim()))] }));
    const known = new Map(change.tasks.map((t) => [t.id, t]));
    const owners = new Map<string, string[]>();
    for (const a of cleaned) for (const id of a.tasks) owners.set(id, [...(owners.get(id) ?? []), a.agentId]);
    const unknown = [...owners.keys()].filter((id) => !known.has(id));
    const alreadyDone = [...owners.keys()].filter((id) => known.get(id)?.done);
    const duplicated = [...owners].filter(([, who]) => who.length > 1).map(([id, agents]) => ({ id, agents }));
    const missing = change.tasks.filter((t) => !t.done && !owners.has(t.id)).map((t) => t.id);
    if (unknown.length || alreadyDone.length || duplicated.length || missing.length) {
      const problems = [
        missing.length ? `open tasks nobody took: ${missing.join(", ")}` : "",
        duplicated.length ? `tasks given to several agents: ${duplicated.map((d) => `${d.id} (${d.agents.join(", ")})`).join(", ")}` : "",
        unknown.length ? `numbers that are not in tasks.md: ${unknown.join(", ")}` : "",
        alreadyDone.length ? `tasks already ticked [x]: ${alreadyDone.join(", ")}` : "",
      ].filter(Boolean);
      throw new AppError("OPENSPEC_TASKS", `Split ${change.path}/tasks.md so that every open task has exactly one agent: ${problems.join("; ")}.`, { missing, duplicated, unknown, alreadyDone });
    }
    const intruders = cleaned.filter((a) => a.agentId !== lead && (a.files ?? []).some((f) => overlaps(f, dir))).map((a) => a.agentId);
    if (intruders.length) {
      throw new AppError(
        "OPENSPEC_DIR_LEAD_ONLY",
        `${change.path}/ belongs to the lead (${lead}), who ticks tasks.md when it integrates: take it out of the files of ${intruders.join(", ")}. If the design must change, ask the operator: send_message({to: "operator", message}).`,
        { lead, agents: intruders },
      );
    }
    return cleaned.map((a) => (a.agentId === lead && !(a.files ?? []).some((f) => covers(f, dir)) ? { ...a, files: [...(a.files ?? []), dir] } : a));
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

  async sendMessage(input: { taskId: string; to: string; type: MessageType; content: string; replyTo?: string; files?: string[] }): Promise<Message> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    if (task.status === "COMPLETED") throw new AppError("ALREADY_COMPLETED", "The task is completed");
    const to = assertAgentId(input.to, "to");
    if (to === this.me) throw new AppError("INVALID_INPUT", "You cannot send a message to yourself");
    if (to !== OPERATOR && !task.agents.includes(to)) throw new AppError("NOT_ASSIGNED", `Agent '${to}' is not part of ${task.id}`);
    if (to === OPERATOR && input.files?.length) throw new AppError("INVALID_INPUT", "The operator owns no files: ask it questions, not for files");
    if (!input.content.trim()) throw new AppError("INVALID_INPUT", "content must not be empty");
    if (input.replyTo) {
      assertMessageId(input.replyTo);
      await this.messages.get(task.id, input.replyTo);
    }
    const message = await this.messages.create({ taskId: task.id, from: this.me, to, type: input.type, content: input.content, replyTo: input.replyTo, files: input.files });
    await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: to, sourceAgent: this.me, payload: { messageId: message.id, from: this.me, type: message.type, ...(message.files ? { files: message.files } : {}) } });
    return message;
  }

  /**
   * The operator answers a question an agent asked it. The answer is an ordinary message to that agent (so its wait()
   * wakes up with it in pendingMessages) and the question counts as answered (read).
   */
  async answerQuestion(input: { taskId: string; messageId: string; answer: string }): Promise<Message> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator answers questions to the operator");
    const task = await this.tasks.get(assertTaskId(input.taskId));
    const question = await this.messages.get(task.id, assertMessageId(input.messageId));
    if (question.to !== OPERATOR) throw new AppError("INVALID_INPUT", `${question.id} is not a question to the operator`);
    if (!input.answer.trim()) throw new AppError("INVALID_INPUT", "The answer must not be empty");
    const answer = await this.messages.create({ taskId: task.id, from: OPERATOR, to: question.from, type: "INFORMATION", content: input.answer.trim(), replyTo: question.id });
    await this.messages.markRead(question);
    await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: question.from, sourceAgent: OPERATOR, payload: { messageId: answer.id, from: OPERATOR, type: answer.type, replyTo: question.id } });
    return answer;
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

  // ---------------------------------------------------------------- file ownership

  /** Declared owners, grants made to / by this agent. Empty ownership when the agreement declares no files. */
  async ownership(taskId: string, agentId = this.me) {
    const [agreement, grants] = await Promise.all([this.agreements.find(taskId), this.grants.list(taskId)]);
    const assignments = agreement?.assignments ?? [];
    const mine = assignments.find((a) => a.agentId === agentId);
    return {
      declared: anyDeclared(assignments),
      assignments,
      yours: mine?.files ?? [],
      /** The agreement gives this agent no files: it changes nothing and reviews the others' work. */
      reviewOnly: isReviewOnly(mine),
      grantedToYou: grants.filter((g) => g.to === agentId).flatMap((g) => g.files.map((f) => ({ file: f, from: g.from }))),
      grantedByYou: grants.filter((g) => g.from === agentId).map((g) => ({ to: g.to, files: g.files })),
    };
  }

  /** The owner lets `to` change some of the owner's files (and tells them by message). */
  async grantFiles(input: { taskId: string; to: string; files: string[]; message: string }): Promise<{ message: Message; files: string[] }> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    const own = await this.ownership(task.id);
    if (!own.declared) throw new AppError("AGREEMENT_NOT_READY", "The agreement declares no files yet, so there is nothing to grant.");
    const files = [...new Set(input.files.map((f) => normalizePath(assertRelativeFilePath(f))))];
    if (!files.length) throw new AppError("INVALID_INPUT", "grantFiles must list at least one file");
    const notMine = files.filter((f) => !own.yours.some((o) => covers(o, f)));
    if (notMine.length) {
      throw new AppError("FILE_NOT_OWNED", `You can only grant files you own. Not yours: ${notMine.join(", ")}. Your files: ${own.yours.join(", ") || "(none)"}.`, { notYours: notMine, yourFiles: own.yours });
    }
    const message = await this.sendMessage({ taskId: task.id, to: input.to, type: "FILE_GRANT", content: input.message, files });
    await this.grants.create({ taskId: task.id, from: this.me, to: input.to, files });
    return { message, files };
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

  async completeImplementation(input: { taskId: string; summary: string; filesChanged?: string[]; commits?: string[]; tasksDone?: string[] }): Promise<{ implementation: Implementation; phase: Task["phase"]; warnings?: string[] }> {
    const filesChanged = [...new Set((input.filesChanged ?? []).map((f) => normalizePath(assertRelativeFilePath(f))))].sort();
    // commits are optional and recorded as given (they help the lead merge separate branches); nothing checks them
    const commits = (input.commits ?? []).map(assertCommit);
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "IMPLEMENT");
      const existing = await this.implementations.find(task.id, this.me);
      if (!existing) throw new AppError("NOT_STARTED", "Call implementation_start before implementation_complete");
      if (existing.status === "READY_FOR_SYNC") throw new AppError("ALREADY_COMPLETED", "Your implementation is already READY_FOR_SYNC");
      const open = (await this.subtasks.get(task.id, this.me)).items.filter((i) => i.status === "TODO" || i.status === "DOING");
      if (open.length) {
        throw new AppError(
          "OPEN_SUBTASKS",
          `You still have open subtasks: ${open.map((i) => `${i.id} "${i.title}"`).join(", ")}. Finish them and mark them done with subtasks({done: [...]}), or drop the ones that are not needed: subtasks({drop: [{id, reason}]}). Then complete again.`,
          { openSubtasks: open },
        );
      }
      const tasksDone = task.openspec ? await this.checkTasksDone(task, input.tasksDone) : undefined;
      const warnings = await this.checkOwnership(task.id, filesChanged);
      const implementation: Implementation = {
        ...existing,
        status: "READY_FOR_SYNC",
        summary: input.summary,
        filesChanged,
        commits,
        completedAt: new Date().toISOString(),
        ...(tasksDone ? { tasksDone } : {}),
      };
      await this.implementations.save(implementation);
      await this.emit({ type: "IMPLEMENTATION_COMPLETED", taskId: task.id, sourceAgent: this.me, payload: { agentId: this.me, filesChanged, commits } });
      return { implementation, ...(warnings.length ? { warnings } : {}) };
    });
  }

  /** OpenSpec task: which of its own tasks.md numbers the agent finished (required when it has any). */
  private async checkTasksDone(task: Task, given: string[] | undefined): Promise<string[] | undefined> {
    const mine = (await this.agreements.find(task.id))?.assignments.find((a) => a.agentId === this.me)?.tasks ?? [];
    if (!mine.length) return undefined; // review only
    if (!given) {
      throw new AppError(
        "INVALID_INPUT",
        `Say which of your OpenSpec tasks are done: complete({result, filesChanged, tasksDone: [...]}). Your tasks: ${mine.join(", ")}; list only the ones you finished and say in result why the others are not.`,
        { yourTasks: mine },
      );
    }
    const ids = [...new Set(given.map((t) => String(t).trim()))];
    const notYours = ids.filter((id) => !mine.includes(id));
    if (notYours.length) throw new AppError("OPENSPEC_TASK_NOT_YOURS", `Not your tasks: ${notYours.join(", ")}. Your tasks: ${mine.join(", ")}.`, { notYours, yourTasks: mine });
    return mine.filter((id) => ids.includes(id));
  }

  /**
   * Operator, after DONE: `openspec archive` in the project folder, once its tasks.md is fully ticked there (the lead
   * ticks the tasks in its own checkout; its branch has to be merged into the project folder first).
   */
  async archiveOpenspec(input: { taskId: string }, exec?: Exec): Promise<{ task: Task; output: string }> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator archives an OpenSpec change");
    const taskId = assertTaskId(input.taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (!task.openspec) throw new AppError("INVALID_INPUT", `${taskId} has no OpenSpec change`);
      if (task.openspec.archivedAt) throw new AppError("ALREADY_COMPLETED", `${changePath(task.openspec.change)} was archived at ${task.openspec.archivedAt}`);
      if (task.status !== "COMPLETED") throw new AppError("INVALID_PHASE", `Archive the change once the task is DONE; ${taskId} is ${task.phase} (${task.status})`);
      const change = await readChange(this.projectDir, task.openspec.change);
      const open = change.tasks.filter((t) => !t.done).map((t) => t.id);
      if (open.length) {
        throw new AppError(
          "OPENSPEC_NOT_READY",
          `${change.tasks.length - open.length}/${change.tasks.length} tasks are ticked in ${this.projectDir}/${change.path}/tasks.md (open: ${open.join(", ")}). Merge the lead's branch into this folder first: the lead ticks the tasks when it integrates.`,
          { open },
        );
      }
      const output = await archiveChange(this.projectDir, change.name, exec);
      const saved = await this.tasks.save({ ...task, openspec: { ...task.openspec, archivedAt: new Date().toISOString() } });
      await this.emit({ type: "OPENSPEC_ARCHIVED", taskId, sourceAgent: OPERATOR, payload: { change: change.name } });
      return { task: saved, output };
    });
  }

  /**
   * Files that belong to another agent need that agent's grant. Files nobody declared are allowed but reported.
   * Does nothing when the agreement declares no files (legacy agreements).
   */
  private async checkOwnership(taskId: string, filesChanged: string[]): Promise<string[]> {
    const own = await this.ownership(taskId);
    if (!own.declared) return [];
    const violations: { file: string; owners: string[] }[] = [];
    const warnings: string[] = [];
    for (const file of filesChanged) {
      const owners = ownersOf(file, own.assignments);
      if (owners.includes(this.me) || own.grantedToYou.some((g) => matches(g.file, file))) continue;
      if (owners.length === 0) warnings.push(`'${file}' is not in anyone's declared files; tell the other agents about it`);
      else violations.push({ file, owners });
    }
    if (violations.length) {
      const list = violations.map((v) => `${v.file} (owner: ${v.owners.join("/")})`).join(", ");
      throw new AppError(
        "FILE_NOT_OWNED",
        `You changed files that belong to another agent without their grant: ${list}. ` +
          `Ask the owner: send_message(to=<owner>, message=<why>, requestFiles=[...]); the owner answers with grantFiles. Then call complete again. ` +
          `Or revert those files and drop them from filesChanged.`,
        { notYours: violations, yourFiles: own.yours },
      );
    }
    return warnings;
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
    checkVerdict(input.status, findings);
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "SYNC");
      if (!this.phases.reviewers(task).includes(this.me)) {
        throw new AppError("NOT_ASSIGNED", `Round ${task.syncRound} reviews only the fixes of ${this.phases.reviewees(task).join(", ")}; you have nothing to review. Wait.`);
      }
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

  // ---------------------------------------------------------------- integration

  /** INTEGRATE: the lead reports the merged result and the outcome of the build/tests on it. */
  async submitIntegration(input: { taskId: string; status: SyncStatus; result: string; commits?: string[]; findings?: SyncFinding[]; followUps?: FollowUpRequest[] }): Promise<{ report: IntegrationReport; followUps: Task[]; phase: Task["phase"] }> {
    const followUps = await this.checkFollowUps(input.followUps ?? [], input.status);
    const findings = (input.findings ?? []).map((f) => ({
      ...f,
      ...(f.files ? { files: f.files.map(assertRelativeFilePath) } : {}),
      ...(f.relatedAgent ? { relatedAgent: assertAgentId(f.relatedAgent, "relatedAgent") } : {}),
    }));
    checkVerdict(input.status, findings);
    if (!input.result.trim()) throw new AppError("INVALID_INPUT", "result must say what was merged, where, and how the build/tests went");
    const commits = (input.commits ?? []).map(assertCommit);
    return this.mutate(input.taskId, async (task) => {
      this.requirePhase(task, "INTEGRATE");
      this.requireIntegrator(task);
      for (const f of findings) {
        if (f.relatedAgent && !task.agents.includes(f.relatedAgent)) throw new AppError("NOT_ASSIGNED", `relatedAgent '${f.relatedAgent}' is not part of ${task.id}`);
      }
      if ((await this.integrations.list(task.id, task.syncRound)).length) throw new AppError("ALREADY_COMPLETED", `Integration for round ${task.syncRound} is already reported`);
      // the budget is taken before anything is written, so a refusal leaves the task untouched
      const rootId = followUps.length ? await this.reserveFollowUps(task, followUps.length) : task.id;
      const report = await this.integrations.create({ taskId: task.id, agentId: this.me, status: input.status, result: input.result, commits, findings, round: task.syncRound });
      await this.emit({ type: "INTEGRATION_REPORT_CREATED", taskId: task.id, sourceAgent: this.me, payload: { reportId: report.id, status: report.status, round: report.round } });
      const base = commits[0]; // the merged HEAD, if the lead named one: a hint where the follow-up starts
      const created: Task[] = [];
      for (const f of followUps) {
        const child = await this.tasks.create({
          title: f.title,
          description: f.description,
          agents: f.agents ?? task.agents,
          createdBy: this.me,
          git: task.git && base ? { ...task.git, commit: base } : task.git,
          maxFixRounds: this.phases.maxFixRounds(task),
          ...(task.verifyCommand ? { verifyCommand: task.verifyCommand } : {}),
          parentTaskId: task.id,
          rootTaskId: rootId,
          ...(base ? { baseCommit: base } : {}),
        });
        created.push(child);
        await this.emit({ type: "TASK_CREATED", taskId: child.id, sourceAgent: this.me, payload: { title: child.title, agents: child.agents, parentTaskId: task.id } });
      }
      return { report, followUps: created };
    });
  }

  /** Follow-ups come only with PASS (defects are fixed in this task), each concrete, for at least two registered agents. */
  private async checkFollowUps(raw: FollowUpRequest[], status: SyncStatus): Promise<FollowUpRequest[]> {
    if (!raw.length) return [];
    if (status !== "PASS") throw new AppError("INVALID_INPUT", "followUps go only with status PASS. A defect found while integrating is fixed in this task: NEEDS_FIX with an ERROR finding.");
    const out: FollowUpRequest[] = [];
    for (const f of raw) {
      const title = (f.title ?? "").trim();
      const description = (f.description ?? "").trim();
      if (!title) throw new AppError("INVALID_INPUT", "every follow-up needs a 'title'");
      if (description.length < MIN_DESCRIPTION) {
        throw new AppError("INVALID_INPUT", `follow-up '${title}': 'description' must say concretely what to change (at least ${MIN_DESCRIPTION} characters): what is wrong or missing, where (files), expected behaviour, who does what.`);
      }
      let agents: string[] | undefined;
      if (f.agents?.length) {
        agents = [...new Set(f.agents.map((a) => assertAgentId(a.trim())))];
        if (agents.length < 2) throw new AppError("INVALID_INPUT", `follow-up '${title}': 'agents' needs at least two distinct agents (the first one leads); omit it to keep this task's agents`);
        for (const a of agents) await this.agents.require(a);
      }
      out.push({ title, description, ...(agents ? { agents } : {}) });
    }
    return out;
  }

  /** Take n follow-ups from the chain budget kept on the root task (under the root's lock when it is another task). */
  private async reserveFollowUps(task: Task, n: number): Promise<string> {
    const rootId = task.rootTaskId ?? task.id;
    const reserve = async (): Promise<void> => {
      const root = await this.tasks.get(rootId);
      const max = root.maxFollowUps ?? 0;
      const used = root.followUpsUsed ?? 0;
      if (used + n > max) {
        throw new AppError(
          "FOLLOW_UP_LIMIT",
          max === 0
            ? "Follow-up tasks are not enabled for this task chain (the operator enables them with 'task create --follow-ups N'). List the remaining work in 'result' instead."
            : `This task chain may create ${max - used} more follow-up task(s) (limit ${max}, used ${used}); you asked for ${n}. Merge related items into fewer tasks or list the rest in 'result'.`,
          { maxFollowUps: max, followUpsUsed: used },
        );
      }
      await this.tasks.save({ ...root, followUpsUsed: used + n });
    };
    if (rootId === task.id) await reserve();
    else await this.fs.withLock(this.tasks.lockPath(rootId), reserve);
    return rootId;
  }

  /** How many follow-up tasks the chain of this task may still create. */
  async followUpBudget(task: Task): Promise<{ max: number; used: number; remaining: number }> {
    const root = task.rootTaskId ? await this.tasks.get(task.rootTaskId) : task;
    const max = root.maxFollowUps ?? 0;
    const used = root.followUpsUsed ?? 0;
    return { max, used, remaining: Math.max(0, max - used) };
  }

  // ---------------------------------------------------------------- subtasks

  /**
   * The agent's own checklist for its part: add steps, start one (only one is DOING), mark them done or drop them
   * with a reason. Only the agent changes its list; the others read it. complete() in IMPLEMENT refuses while
   * steps are open, so a restarted session sees exactly what is left.
   */
  async updateSubtasks(input: { taskId: string; add?: string[]; start?: string; done?: string[]; drop?: { id: string; reason: string }[] }): Promise<SubtaskList> {
    const task = await this.requireMember(input.taskId);
    if (task.status === "BLOCKED") throw new AppError("TASK_BLOCKED", `Task ${task.id} is blocked; wait for the operator.`);
    if (task.status !== "ACTIVE") throw new AppError("ALREADY_COMPLETED", `Task ${task.id} is ${task.status}`);
    const list = await this.subtasks.get(task.id, this.me);
    const now = new Date().toISOString();
    const find = (raw: string) => {
      const id = raw.trim();
      const item = list.items.find((i) => i.id === id);
      if (!item) throw new AppError("INVALID_INPUT", `No subtask '${id}'. Yours: ${list.items.map((i) => i.id).join(", ") || "(none yet; add some with 'add')"}`);
      return item;
    };
    for (const raw of input.add ?? []) {
      const title = raw.trim();
      if (!title) throw new AppError("INVALID_INPUT", "a subtask title must not be empty");
      if (title.length > 300) throw new AppError("INVALID_INPUT", "a subtask title must be at most 300 characters: one concrete step");
      list.items.push({ id: `s${list.nextSeq++}`, title, status: "TODO", updatedAt: now });
    }
    if (list.items.length > MAX_SUBTASKS) throw new AppError("INVALID_INPUT", `At most ${MAX_SUBTASKS} subtasks per agent and task; make the steps bigger`);
    for (const raw of input.done ?? []) Object.assign(find(raw), { status: "DONE", updatedAt: now });
    for (const d of input.drop ?? []) {
      if (!d.reason?.trim()) throw new AppError("INVALID_INPUT", `dropping '${d.id}' needs a 'reason'`);
      Object.assign(find(d.id), { status: "DROPPED", note: d.reason.trim(), updatedAt: now });
    }
    if (input.start) {
      const item = find(input.start);
      for (const other of list.items) if (other !== item && other.status === "DOING") Object.assign(other, { status: "TODO", updatedAt: now });
      Object.assign(item, { status: "DOING", updatedAt: now });
    }
    return this.subtasks.save(list);
  }

  private requireIntegrator(task: Task): void {
    const lead = this.phases.integrator(task);
    if (lead !== this.me) throw new AppError("NOT_ASSIGNED", `Only the lead (${lead}) integrates`);
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
        waitingOn = this.phases.reviewers(task).filter((id) => !reports.some((r) => r.agentId === id));
        hint = `Agents in waitingOn must review the work of ${this.phases.reviewees(task).join(", ")} and call sync_submit`;
        break;
      case "INTEGRATE":
        waitingOn = [this.phases.integrator(task)];
        hint = "The lead merges everyone's commits, runs the build and tests, and calls integration_submit";
        break;
      case "DONE":
        hint = "Task is complete";
    }
    if (task.status === "BLOCKED") {
      waitingOn = ["operator"];
      hint = `Task is BLOCKED (${task.blockedReason ?? "fix-round limit reached"}); the operator unblocks or cancels it`;
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
      if (task.status === "BLOCKED") throw new AppError("TASK_BLOCKED", `Task ${taskId} is blocked (${task.blockedReason ?? "fix-round limit reached"}); the operator has to unblock or cancel it. Wait.`);
      const result = await fn(task);
      const after = await this.advance(taskId);
      return { ...result, phase: after.phase };
    });
  }

  private async advance(taskId: string): Promise<Task> {
    let task = await this.tasks.get(taskId);
    for (let i = 0; i < 4; i++) {
      const [agreement, implementations, syncReports, integrations] = await Promise.all([
        this.agreements.find(taskId),
        this.implementations.list(taskId),
        this.syncs.list(taskId, task.syncRound),
        this.integrations.list(taskId, task.syncRound),
      ]);
      const transition = this.phases.evaluate({ task, agreement, implementations, syncReports, integrations });
      if (!transition) return task;
      if (isHalt(transition)) return this.block(task, transition);
      task = await this.applyTransition(task, transition, syncReports);
    }
    return task;
  }

  private async block(task: Task, h: Halt): Promise<Task> {
    const saved = await this.tasks.save({ ...task, status: "BLOCKED", blockedReason: h.reason });
    await this.emit({ type: "TASK_BLOCKED", taskId: task.id, payload: { phase: h.phase, reason: h.reason, needsFix: h.needsFix, round: task.syncRound } });
    return saved;
  }

  private async applyTransition(task: Task, t: Transition, reports: SyncReport[]): Promise<Task> {
    const next = { ...this.phases.apply(task, t), phaseHistory: [...(task.phaseHistory ?? []), { phase: t.to, at: new Date().toISOString() }] };
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
    if (t.to === "SYNC") await this.emit({ type: "SYNC_REQUIRED", taskId: task.id, payload: { round: saved.syncRound, reviewees: this.phases.reviewees(saved) } });
    if (t.to === "INTEGRATE") await this.emit({ type: "INTEGRATION_REQUIRED", taskId: task.id, payload: { round: saved.syncRound, integrator: this.phases.integrator(saved) } });
    if (t.to === "DONE") await this.emit({ type: "TASK_COMPLETED", taskId: task.id, payload: { title: saved.title } });
    return saved;
  }

  private async emit(e: NewEvent): Promise<NetworkEvent> {
    const event = await this.events.create(e);
    this.hub.notify();
    return event;
  }
}
