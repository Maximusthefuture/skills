import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildTools, parseBuildCommand } from "./build.js";
import { AppError } from "./errors.js";
import { EventHub } from "./events/eventHub.js";
import { readGitContext } from "./git.js";
import { mergeBranch, revertCommit, type MergeResult, type MergeStrategy } from "./worktrees.js";
import { writeHandoffMarker } from "./handoff.js";
import { archiveChange, assertChangeName, changePath, hasChange, readChange, type Exec } from "./openspec.js";
import { anyDeclared, covers, findOverlaps, matches, normalizePath, overlaps, ownersOf } from "./ownership.js";
import { DEFAULT_MAX_FIX_ROUNDS, isHalt, PhaseManager, type Halt, type Transition } from "./phase/phaseManager.js";
import { writeParkMarker } from "./park.js";
import { applyEdits, checkFeedback, checkPlanHtml, feedbackRounds, feedbackText, inputViewed, planStatus, readPlanState, reviewsPages, type PlanFeedback, type PlanStage, type PlanState } from "./plan.js";
import { collectInput, copyInput } from "./specInput.js";
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
  QuestionChoices,
  ReviewComment,
  SpawnRole,
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
  /** How long the operator has to decide on a question or a BLOCKED task before the fallback (AGENT_NETWORK_OPERATOR_TIMEOUT_MIN). */
  operatorTimeoutMs?: number;
}

/** No answer from the operator in this time: the asker goes ahead with its own proposal, a stuck fix goes to the lead. */
export const OPERATOR_TIMEOUT_MS = 10 * 60_000;

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
  /** Cost limit in USD over all sessions of the task; absent = none. */
  maxCostUsd?: number;
  /** The task writes this new OpenSpec change (openspec/changes/<name>/): the lead writes it, the others review it. */
  proposes?: string;
  /**
   * With proposes: the analysts' artifacts (.md files or folders, absolute or relative to the project) the change is
   * written from. Copied into the task; the lead shows them as a page, grills the operator, writes its own change.
   */
  from?: string[];
  /** The lead first asks what is unclear, or says how it understood the task, before it may propose. */
  clarify?: boolean;
  /** The lead writes an HTML plan first, and proposes only after the operator approved it. */
  planReview?: boolean;
  /** Clarify by a grilling: rounds of questions, then the operator confirms the lead's summary (implies clarify). */
  grill?: boolean;
  /** The lead may add agents from the spawn templates (spawn_agent); off by default. */
  allowSpawn?: boolean;
}

/**
 * A message that checks the task (clarify): the lead's question to the operator, or its note that starts with how it
 * understood the task. Any other note (an error report, a status) does not count.
 */
export function clarifies(m: Pick<Message, "from" | "to" | "type" | "content">, lead: string): boolean {
  if (m.from !== lead || m.to !== OPERATOR) return false;
  return m.type === "QUESTION" || UNDERSTOOD.test(m.content);
}

/** The yes of a summary question: "Yes, that's it" / "Да, всё так" (a plain "Yes" is an ordinary choice). */
const CONFIRM_YES = /^\s*(yes|да)[\s,!.—-]+(that'?s (it|right)|correct|exactly|всё так|все так|верно|именно)/i;
const UNDERSTOOD = /^[\s*_#>]*(how i understand( it| the task)?|(updated |my )?understanding|как я понял|моё понимание|мое понимание)/i;

/**
 * A grilled task is clear once the operator said yes to the lead's summary: a question of the lead that starts with how it
 * understood the task, answered with its first option ("Yes, that's it") or a plain yes.
 */
export function grillConfirmed(messages: Pick<Message, "id" | "from" | "to" | "type" | "content" | "replyTo" | "choices">[], lead: string): boolean {
  // the summary: it starts with how the lead understood the task (markdown around it is fine), or it offers yes / no
  const summary = (q: (typeof messages)[number]) =>
    UNDERSTOOD.test(q.content) || (CONFIRM_YES.test(q.choices?.options[0]?.label ?? "") && /^\s*(no|нет)(?![a-zа-яё])/i.test(q.choices?.options[1]?.label ?? ""));
  return messages.some((q) => q.from === lead && q.to === OPERATOR && q.type === "QUESTION" && summary(q) &&
    messages.some((a) => a.from === OPERATOR && a.replyTo === q.id && (
      (q.choices?.options[0] && a.content.startsWith(`Chosen: "${q.choices.options[0].label}"`)) ||
      /^\s*(chosen: "(yes|да)|yes(?![a-z])|да(?![а-яё])|ок(?![а-яё])|ok(?![a-z])|верно|всё так|все так)/i.test(a.content))));
}

/** How much the lead prepares before the agreement: fast (nothing), standard (clarify), thorough (grill + plan to approve). */
export type Depth = "fast" | "standard" | "thorough";
export function depthFlags(depth: string): { clarify: boolean; grill: boolean; planReview: boolean } {
  if (depth === "fast") return { clarify: false, grill: false, planReview: false };
  if (depth === "standard") return { clarify: true, grill: false, planReview: false };
  if (depth === "thorough") return { clarify: true, grill: true, planReview: true };
  throw new AppError("INVALID_INPUT", `depth is fast, standard or thorough, not "${depth}"`);
}

const ROLE_NAME = /^[a-z][a-z0-9-]{1,30}$/;

/** A cost limit: a positive amount in USD (cents are kept). */
export function checkCostLimit(value: unknown, what = "maxCostUsd"): number {
  const n = Number(value);
  if (typeof value === "boolean" || value === null || value === "" || !Number.isFinite(n) || n <= 0 || n > 100_000) throw new AppError("INVALID_INPUT", `${what} must be a positive amount in USD`);
  return Math.round(n * 100) / 100;
}

/** An assignment that declares an empty file list: the agent changes nothing and reviews the others' work. */
export function isReviewOnly(a: Assignment | undefined, task?: Pick<Task, "proposes">): boolean {
  // the author of a change-writing task holds only the change folder, and writing it is its work
  if (task?.proposes && a?.files?.some((f) => f === `${changePath(task.proposes!.change)}/**`)) return false;
  // an OpenSpec lead without tasks of its own only holds the change folder (to tick tasks.md at INTEGRATE): still a reviewer
  return !!a && Array.isArray(a.files) && a.files.every((f) => CHANGE_DIR.test(f)) && !a.tasks?.length;
}

const CHANGE_DIR = /^openspec\/changes\/[a-z0-9][a-z0-9-]*\/\*\*$/;

/** dependsOn names other agents of the task that change files, without a cycle (nobody in a cycle could ever report). */
function assertDependencies(assignments: Assignment[]): void {
  const byId = new Map(assignments.map((a) => [a.agentId, a]));
  for (const a of assignments) {
    for (const d of a.dependsOn ?? []) {
      const target = byId.get(d);
      if (d === a.agentId) throw new AppError("INVALID_INPUT", `${a.agentId}: dependsOn names itself`);
      if (!target) throw new AppError("INVALID_INPUT", `${a.agentId}: dependsOn '${d}' is not an agent of this task`);
      if (isReviewOnly(target)) throw new AppError("INVALID_INPUT", `${a.agentId}: dependsOn '${d}', but ${d} changes no files (review only): there is no code to wait for`);
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new AppError("INVALID_INPUT", `dependsOn goes in a circle: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}; none of them could ever report`);
    state.set(id, "visiting");
    for (const d of byId.get(id)?.dependsOn ?? []) visit(d, [...path, id]);
    state.set(id, "done");
  };
  for (const a of assignments) visit(a.agentId, []);
}

/** The text an OpenSpec task starts with: where the WHAT is. The operator's own words follow it. */
export function openspecDescription(change: string, operatorText: string): string {
  const head = `Implement the OpenSpec change ${changePath(change)}/: proposal.md (why and what), design.md (how), specs/ (each scenario is a test), tasks.md (the numbered tasks to split between the agents).`;
  return operatorText.trim() ? `${head}\n\n${operatorText.trim()}` : head;
}

export function proposeDescription(change: string, operatorText: string): string {
  const head = `Write the OpenSpec change ${changePath(change)}/ (it does not exist yet): proposal.md (why and what), specs/<capability>/spec.md (requirements with WHEN/THEN scenarios, each one testable), design.md (how), tasks.md (numbered implementation tasks). Plan only: no code changes in this task.`;
  return operatorText.trim() ? `${head}\n\nWhat is wanted (the operator's words):\n${operatorText.trim()}` : head;
}

/** Options of a question to the operator: 2..6 distinct labels, the recommended one among them. */
export function checkChoices(c: QuestionChoices, toOperator: boolean): QuestionChoices {
  if (!toOperator) throw new AppError("INVALID_INPUT", "options go with a question to the operator (to: \"operator\", without fyi)");
  const options = (c.options ?? []).map((o) => ({ label: String(o?.label ?? "").trim(), ...(o?.description?.trim() ? { description: o.description.trim().slice(0, 500) } : {}) }));
  if (options.length < 2 || options.length > 6) throw new AppError("INVALID_INPUT", "options: 2 to 6 choices, each {label, description?}");
  if (options.some((o) => !o.label || o.label.length > 80)) throw new AppError("INVALID_INPUT", "options: every label is 1..80 characters, e.g. 'Service layer'");
  if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) throw new AppError("INVALID_INPUT", "options: the labels must differ");
  const recommended = c.recommended?.trim();
  if (recommended && !options.some((o) => o.label === recommended)) throw new AppError("INVALID_INPUT", `recommended must be one of the labels: ${options.map((o) => o.label).join(", ")}`);
  return { options, ...(recommended ? { recommended } : {}), ...(c.multiSelect ? { multiSelect: true as const } : {}) };
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
  private readonly operatorTimeoutMs: number;
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
    this.operatorTimeoutMs = opts.operatorTimeoutMs ?? OPERATOR_TIMEOUT_MS;
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
    const proposes = input.proposes?.trim() ? await this.checkNewChange(input.proposes.trim(), !!change) : undefined;
    if (proposes && input.planReview) throw new AppError("INVALID_INPUT", "A task that writes an OpenSpec change has no separate plan: the change itself is what you review");
    const from = (input.from ?? []).map((f) => f.trim()).filter(Boolean);
    if (input.from?.length && !from.length) throw new AppError("INVALID_INPUT", "--from: the path is empty; give the analysts' .md files or their folder");
    if (from.length && !proposes) throw new AppError("INVALID_INPUT", "--from (the analysts' artifacts) goes with --propose <change>: they are the input of a change-writing task");
    const inputFiles = from.length ? await collectInput(from, this.projectDir) : [];
    const title = input.title.trim() || change?.name || (proposes ? `OpenSpec change ${proposes}` : "");
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
    const maxCostUsd = input.maxCostUsd === undefined ? undefined : checkCostLimit(input.maxCostUsd);

    const git = await readGitContext(this.projectDir);
    const description = change ? openspecDescription(change.name, input.description) : proposes ? proposeDescription(proposes, input.description) : input.description;
    const task = await this.tasks.create({
      title, description, agents, createdBy, git, maxFixRounds, verifyCommand, maxFollowUps,
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}), ...(change ? { openspec: change.name } : {}), ...(proposes ? { proposes } : {}),
      ...(inputFiles.length ? { proposesInput: inputFiles.map((f) => f.rel) } : {}),
      ...(input.clarify ? { clarify: true } : {}),
      ...(input.planReview ? { planReview: true } : {}),
      // analysts' input is grilled by default: their spec is a question list as much as an answer
      ...(input.grill || (inputFiles.length && input.grill === undefined) ? { grill: true } : {}),
      ...(input.allowSpawn ? { allowSpawn: true } : {}),
    });
    if (inputFiles.length) await copyInput(inputFiles, join(this.fs.root, "tasks", task.id, "input"));
    await this.emit({ type: "TASK_CREATED", taskId: task.id, sourceAgent: createdBy, payload: { title, agents } });
    return task;
  }

  /** The operator's review comments on the task's diff: tasks/<id>/review.json. */
  async reviewComments(taskId: string): Promise<ReviewComment[]> {
    return (await this.fs.readJson<ReviewComment[]>(["tasks", assertTaskId(taskId), "review.json"])) ?? [];
  }

  /** Operator: comments on lines of the diff, open until the lead marks each fixed or declined. */
  async addReviewComments(taskId: string, comments: { file: string; line?: number; code?: string; text: string }[]): Promise<ReviewComment[]> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator writes review comments");
    return this.fs.withLock(this.tasks.lockPath(assertTaskId(taskId)), async () => {
      const all = await this.reviewComments(taskId);
      let n = all.reduce((m, c) => Math.max(m, Number(c.id.slice(3))), 0);
      const at = new Date().toISOString();
      const added: ReviewComment[] = comments.map((c) => ({
        id: `rc-${++n}`, file: c.file, ...(Number.isInteger(c.line) ? { line: c.line } : {}), ...(c.code?.trim() ? { code: c.code.trim().slice(0, 200) } : {}), text: c.text.trim(), at, status: "open" as const,
      }));
      await this.fs.writeJson(["tasks", taskId, "review.json"], [...all, ...added]);
      await this.emit({ type: "REVIEW_COMMENTS", taskId, sourceAgent: OPERATOR, payload: { ids: added.map((c) => c.id) } });
      return added;
    });
  }

  /** The lead: each open comment fixed (what was done) or declined (why); the task cannot be handed in while any is open. */
  async resolveReviewComments(taskId: string, resolve: { id: string; status: string; note?: string }[]): Promise<ReviewComment[]> {
    await this.requireMe();
    return this.fs.withLock(this.tasks.lockPath(assertTaskId(taskId)), async () => {
      const task = await this.requireMember(taskId);
      if (this.phases.integrator(task) !== this.me) throw new AppError("FORBIDDEN", `The lead (${this.phases.integrator(task)}) answers the operator's review comments`);
      const all = await this.reviewComments(taskId);
      const at = new Date().toISOString();
      for (const r of resolve) {
        const c = all.find((x) => x.id === r.id);
        if (!c) throw new AppError("INVALID_INPUT", `No review comment ${r.id}; the open ones: ${all.filter((x) => x.status === "open").map((x) => x.id).join(", ") || "none"}`);
        if (r.status !== "fixed" && r.status !== "declined") throw new AppError("INVALID_INPUT", `${r.id}: status is "fixed" or "declined"`);
        if (r.status === "declined" && !r.note?.trim()) throw new AppError("INVALID_INPUT", `${r.id}: declining needs a note — why it stays as it is`);
        Object.assign(c, { status: r.status, ...(r.note?.trim() ? { note: r.note.trim().slice(0, 1000) } : {}), resolvedAt: at });
      }
      await this.fs.writeJson(["tasks", taskId, "review.json"], all);
      await this.emit({ type: "REVIEW_RESOLVED", taskId, sourceAgent: this.me, payload: { resolved: resolve.map((r) => `${r.id}:${r.status}`) } });
      return all;
    });
  }

  /** The lead may not hand its part or the integration in while the operator's comments are open. */
  private async requireReviewDone(task: Task): Promise<void> {
    if (this.phases.integrator(task) !== this.me) return;
    const open = (await this.reviewComments(task.id)).filter((c) => c.status === "open");
    if (open.length) {
      throw new AppError(
        "REVIEW_OPEN",
        `The operator's review comments are open: ${open.map((c) => `${c.id} (${c.file}${c.line ? `:${c.line}` : ""})`).join(", ")}. Fix each (or have its owner fix it) and mark it with resolve_comments({resolve: [{id, status: "fixed", note}]}), or decline it with a reason (status "declined"); then complete() again.`,
        { open: open.map((c) => c.id) },
      );
    }
  }

  /** An agent's tool call was refused: <network>/observer/errors/<agent>.jsonl, for the observer's look across tasks. */
  async recordProtocolError(e: { tool: string; code: string; taskId?: string; phase?: string }): Promise<void> {
    const dir = join(this.fs.root, "observer", "errors");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, `${assertAgentId(this.me)}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), agentId: this.me, ...e })}\n`);
  }

  /** Operator (the page): keep a role a lead wrote in the project's library, so later leads take it by name. */
  async saveRole(input: { taskId: string; agentId: string; name?: string; overwrite?: boolean }): Promise<{ name: string; path: string }> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator adds roles to the library");
    const task = await this.tasks.get(assertTaskId(input.taskId));
    const s = task.spawned?.find((x) => x.id === input.agentId);
    if (!s?.role) throw new AppError("INVALID_INPUT", `${input.agentId} of ${task.id} has no role of its own`);
    const name = (input.name?.trim() || s.role.name).toLowerCase();
    if (!ROLE_NAME.test(name)) throw new AppError("INVALID_INPUT", "A role name of lowercase letters, digits and -");
    const path = join(this.fs.root, "roles", `${name}.md`);
    if (!input.overwrite && (await stat(path).then(() => true, () => false))) throw new AppError("ALREADY_COMPLETED", `The library has a role "${name}" already: overwrite it or pick another name`);
    await mkdir(join(this.fs.root, "roles"), { recursive: true });
    const text = s.role.instructions.startsWith("#") ? s.role.instructions : `# ${name}: ${s.reason.split("\n")[0]!.slice(0, 160)}\n\n${s.role.instructions}`;
    await writeFile(path, `${text}\n`);
    return { name, path };
  }

  /** Operator: remove a role from the library. */
  async deleteRole(name: string): Promise<void> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator changes the role library");
    if (!ROLE_NAME.test(name)) throw new AppError("INVALID_INPUT", "No such role");
    await rm(join(this.fs.root, "roles", `${name}.md`));
  }

  /** The lead checked the task with the operator (clarify): a question, or a note on how it understood the task. */
  async leadWroteOperator(task: Task): Promise<boolean> {
    const lead = this.phases.integrator(task);
    const all = await this.messages.list(task.id);
    return task.grill ? grillConfirmed(all, lead) : all.some((m) => clarifies(m, lead));
  }

  // ---------------------------------------------------------------- the plan (task.planReview)

  async planState(taskId: string): Promise<PlanState> {
    return readPlanState(this.fs, assertTaskId(taskId));
  }

  /** One version of the plan as it was saved (null when there is none). */
  async planHtml(taskId: string, version?: number): Promise<{ version: number; html: string } | null> {
    const s = await this.planState(taskId);
    const v = version ?? s.versions.at(-1)?.n;
    if (!v || !s.versions.some((x) => x.n === v)) return null;
    return { version: v, html: await readFile(join(this.fs.root, "tasks", taskId, "plan", `v${v}.html`), "utf8") };
  }

  private async savePlanVersion(taskId: string, s: PlanState, html: string, note?: string, page?: { stage?: PlanStage; hash?: string }): Promise<number> {
    const n = (s.versions.at(-1)?.n ?? 0) + 1;
    await mkdir(join(this.fs.root, "tasks", taskId, "plan"), { recursive: true });
    await writeFile(join(this.fs.root, "tasks", taskId, "plan", `v${n}.html`), html);
    s.versions.push({ n, by: this.me, at: new Date().toISOString(), ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}), bytes: Buffer.byteLength(html), ...(page?.stage ? { stage: page.stage } : {}), ...(page?.hash ? { hash: page.hash } : {}) });
    return n;
  }

  /**
   * A change-writing task with analysts' input: which page the lead writes now. "input" in DISCUSS before the grilling
   * (their artifacts as they are); "change" in IMPLEMENT once the change is written (ours next to theirs). A "change"
   * page after an acceptance is a new review when the change folder changed since (hash), and is refused otherwise.
   */
  private async pageStage(task: Task, s: PlanState, stage: string | undefined, hash: string | undefined): Promise<PlanStage> {
    if (stage !== "input" && stage !== "change") throw new AppError("INVALID_INPUT", `${task.id} shows two pages: plan({stage: "input", html}) — the analysts' artifacts, in DISCUSS — and plan({stage: "change", html}) — your change next to theirs, in IMPLEMENT`);
    if (stage === "input") {
      this.requirePhase(task, "DISCUSS");
      if (inputViewed(s)) throw new AppError("ALREADY_COMPLETED", "The operator has looked at the input page already: go on with the grilling, then propose()");
      return stage;
    }
    this.requirePhase(task, "IMPLEMENT");
    if (!inputViewed(s)) throw new AppError("INPUT_NOT_REVIEWED", "The operator has not looked at the input page yet");
    if (s.versions.at(-1)?.stage === "input") {
      // the change page starts: the input stage is settled and kept as such
      s.inputViewed = s.approved ?? s.inputViewed;
      delete s.approved;
    }
    if (s.approved) {
      const accepted = s.versions.find((v) => v.n === s.approved!.version);
      if (accepted?.hash && accepted.hash === hash) throw new AppError("ALREADY_COMPLETED", `The operator accepted the change (page v${accepted.n}) and the change folder is the same: validate, commit and complete()`);
      delete s.approved; // the change changed after the acceptance (a fix round): the operator looks again
    }
    return stage;
  }

  /** The lead: a new version of the plan, the whole page or find/replace edits of the current one. */
  async writePlan(input: { taskId: string; html?: string; edits?: { find: string; replace: string }[]; note?: string; stage?: string; hash?: string }): Promise<{ version: number; status: string }> {
    await this.requireMe();
    return this.fs.withLock(this.tasks.lockPath(assertTaskId(input.taskId)), async () => {
      const task = await this.requireMember(input.taskId);
      if (task.status !== "ACTIVE") throw new AppError("ALREADY_COMPLETED", `${task.id} is ${task.status}: the plan is closed`);
      if (!reviewsPages(task)) throw new AppError("INVALID_INPUT", `${task.id} asks for no plan: propose() the agreement`);
      if (this.phases.integrator(task) !== this.me) throw new AppError("FORBIDDEN", `The lead (${this.phases.integrator(task)}) writes the ${task.planReview ? "plan" : "pages"}; tell it what you think with send_message`);
      const s = await this.planState(task.id);
      const pages = !task.planReview;
      const stage = pages ? await this.pageStage(task, s, input.stage, input.hash) : undefined;
      if (!pages) {
        this.requirePhase(task, "DISCUSS");
        // a grilled task: the plan is written from the settled decisions, so the grilling comes first
        if (task.grill && !grillConfirmed(await this.messages.list(task.id), this.me)) {
          throw new AppError("CLARIFY_FIRST", `${task.id} grills the operator about the task first: finish the rounds of questions and get its "yes" to your summary ("How I understand it: ... Is that right?"); then write the plan with every decision in it.`);
        }
        if (s.approved) throw new AppError("ALREADY_COMPLETED", `The operator approved plan v${s.approved.version}: propose() the agreement as it says`);
      }
      if (input.html !== undefined && input.edits?.length) throw new AppError("INVALID_INPUT", "Send either html (the whole page) or edits (changes of the current version), not both");
      let html: string;
      if (input.html !== undefined) html = checkPlanHtml(input.html);
      else if (input.edits?.length) {
        const current = await this.planHtml(task.id);
        if (!current) throw new AppError("INVALID_INPUT", "There is no plan yet: send the whole page as html");
        html = checkPlanHtml(applyEdits(current.html, input.edits));
      } else if (input.note?.trim() && (planStatus(s) === "revising" || (stage === "change" && s.versions.at(-1)?.stage === "change"))) {
        // the lead looked at the operator's feedback and keeps the page as it is (or shows the changed folder on the same
        // page): the same page again, with why
        html = (await this.planHtml(task.id))!.html;
      } else throw new AppError("INVALID_INPUT", "Send html (the whole page) or edits: [{find, replace}]; after the operator's feedback, a note alone keeps the page as it is (say why)");
      if (stage && s.versions.at(-1)?.stage !== stage && input.html === undefined) throw new AppError("INVALID_INPUT", `The ${stage} page is a new page: send it whole as html`);
      const version = await this.savePlanVersion(task.id, s, html, input.note, stage ? { stage, ...(stage === "change" && input.hash ? { hash: input.hash } : {}) } : undefined);
      await this.fs.writeJson(["tasks", task.id, "plan", "state.json"], s);
      await this.emit({ type: "PLAN_UPDATED", taskId: task.id, sourceAgent: this.me, payload: { version } });
      return { version, status: planStatus(s) };
    });
  }

  /**
   * The operator: notes, in-place edits and answers on a version of the plan (the edited page becomes a new version),
   * and with approve the plan is approved: propose() is open to the lead, the notes go along.
   */
  async planFeedback(input: { taskId: string; version: number; comments?: unknown; edits?: unknown; answers?: unknown; html?: string; approve?: boolean }): Promise<{ state: PlanState; message: Message | null }> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator reviews the plan");
    return this.fs.withLock(this.tasks.lockPath(assertTaskId(input.taskId)), async () => {
      const task = await this.tasks.get(input.taskId);
      if (!reviewsPages(task)) throw new AppError("INVALID_INPUT", `${task.id} has no plan to review`);
      const s = await this.planState(task.id);
      const stage = task.planReview ? undefined : s.versions.at(-1)?.stage;
      const phase = stage === "change" ? "IMPLEMENT" : "DISCUSS";
      if (task.status !== "ACTIVE" || task.phase !== phase) throw new AppError("INVALID_PHASE", `${task.id} is past this page (${task.status}, ${task.phase})`);
      if (s.approved) throw new AppError("ALREADY_COMPLETED", `Plan v${s.approved.version} is approved already`);
      const last = s.versions.at(-1);
      if (!last) throw new AppError("INVALID_INPUT", "The lead has not written a plan yet");
      if (input.version !== last.n) throw new AppError("INVALID_INPUT", `You looked at v${input.version}, the current plan is v${last.n}: open it and send again`);
      const fb: PlanFeedback = { round: feedbackRounds(s, last.stage) + 1, at: new Date().toISOString(), onVersion: last.n, ...checkFeedback(input) };
      // comments and edits are the lead's to look at first: it decides whether the plan changes; only answers go with an approval
      // the analysts' input page is only looked at: notes on it are grilling questions and go along with «Посмотрел»
      const viewOnly = stage === "input";
      if (input.approve && !viewOnly && planStatus(s) === "revising") throw new AppError("INVALID_INPUT", `The lead is working in your feedback on v${last.n}: approve the version it sends`);
      if (input.approve && fb.edits.length + (viewOnly ? 0 : fb.comments.length) > 0) throw new AppError("INVALID_INPUT", "Send your comments and edits to the lead first: it reworks the plan (or says why not), then you approve the new version");
      if (fb.edits.length && input.html) fb.savedAs = await this.savePlanVersion(task.id, s, checkPlanHtml(input.html), "the operator's edits", last.stage ? { stage: last.stage, ...(last.hash ? { hash: last.hash } : {}) } : undefined);
      const said = fb.comments.length + fb.edits.length + fb.answers.length > 0;
      if (!said && !input.approve) throw new AppError("INVALID_INPUT", "Nothing to send: comment on a block, edit the text or answer a question");
      if (input.approve) {
        s.approved = { version: fb.savedAs ?? last.n, at: fb.at };
        if (said) fb.withApproval = true;
      }
      if (said) s.feedback.push(fb);
      await this.fs.writeJson(["tasks", task.id, "plan", "state.json"], s);
      const lead = this.phases.integrator(task);
      const notes = said ? `\n${feedbackText(fb)}` : "";
      const content =
        stage === "input"
          ? input.approve
            ? `The operator has looked at the analysts' artifacts (page v${s.approved!.version}). Now grill the operator: the discrepancies on the page and the operator's notes below are where the questions come from; then propose().${notes}`
            : `The operator's notes on the input page v${last.n}: they are not edits of the analysts' artifacts but questions and decisions for the grilling. Take them into the rounds; if the page itself misrepresents the input, fix it (plan({stage: "input", edits})).${notes}`
          : stage === "change"
            ? input.approve
              ? `The operator accepted the change (page v${s.approved!.version}). Change nothing in the change folder now (an edit needs a new page); run openspec validate --strict, commit and complete({result}).${notes}`
              : `The operator returns the change for rework (page v${last.n}, round ${fb.round}). Edit the change files as the notes say (a question you cannot settle: send_message({to: "operator"})), validate, then show it again: plan({stage: "change", html or edits, note: "<what changed>"}).${notes}`
            : input.approve
              ? `The operator approved plan v${s.approved!.version}. propose() the agreement now, as the plan says (assignments, files, contracts)${said ? "; the operator's answers below are part of it" : ""}.${notes}`
              : `The operator's feedback on plan v${last.n} (round ${fb.round}). Work it in: plan({edits: [{find, replace}]}) or plan({html}), with a note on what changed; a question you cannot settle: send_message({to: "operator"}). The operator approves the plan on the page, then you propose().${notes}`;
      const message = await this.messages.create({ taskId: task.id, from: OPERATOR, to: lead, type: "INFORMATION", content });
      await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: lead, sourceAgent: OPERATOR, payload: { messageId: message.id, from: OPERATOR, type: message.type } });
      await this.emit({ type: input.approve ? "PLAN_APPROVED" : "PLAN_FEEDBACK", taskId: task.id, sourceAgent: OPERATOR, payload: { version: input.approve ? s.approved!.version : last.n, comments: fb.comments.length, edits: fb.edits.length, answers: fb.answers.length } });
      return { state: s, message };
    });
  }

  /** What the page lets leads spawn (<network>/spawn.json, written from runners.json "spawn" when the page starts). */
  async spawnTemplates(): Promise<{ templates: { name: string; description: string; model?: string }[]; maxPerTask: number }> {
    return (await this.fs.readJson<{ templates: { name: string; description: string; model?: string }[]; maxPerTask: number }>(["spawn.json"])) ?? { templates: [], maxPerTask: 0 };
  }

  /**
   * The lead adds an agent to its task's team from a template (DISCUSS, before the agreement): the agent joins the task,
   * and the page starts its runner (in its own worktree when the template has one). Bounded by the template's maxPerTask.
   */
  /** The project's role library: <network>/roles/<name>.md (the first line describes it). */
  async roles(): Promise<{ name: string; description: string; instructions: string }[]> {
    const dir = join(this.fs.root, "roles");
    const out: { name: string; description: string; instructions: string }[] = [];
    for (const f of (await readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith(".md")).sort()) {
      const instructions = (await readFile(join(dir, f), "utf8")).trim();
      out.push({ name: f.slice(0, -3), description: instructions.split("\n")[0]!.replace(/^#+\s*/, "").slice(0, 200), instructions });
    }
    return out;
  }

  /** A spawned agent's role: written by the lead now (role + instructions), or taken from the project's library by name. */
  private async roleOf(input: { role?: string; instructions?: string }, fallback = "lead-written"): Promise<SpawnRole | undefined> {
    // instructions with no name are a role all the same: it gets one (a lead that left it out lost a turn to the refusal)
    const roleName = input.role?.trim() || (input.instructions?.trim() ? fallback : undefined);
    if (roleName) {
      if (!ROLE_NAME.test(roleName)) throw new AppError("INVALID_INPUT", "role: a name of lowercase letters, digits and -, e.g. 'architect'");
      if (input.instructions?.trim()) {
        const text = input.instructions.trim();
        if (text.length < 40 || text.length > 6000) throw new AppError("INVALID_INPUT", "instructions: 40..6000 characters — what this agent does in the task, what it looks at, what it must not do, how it reports");
        return { name: roleName, instructions: text, source: "lead" };
      }
      const found = (await this.roles()).find((r) => r.name === roleName);
      if (!found) throw new AppError("INVALID_INPUT", `No role "${roleName}" in the project's library; write it with instructions, or use one of: ${(await this.roles()).map((r) => r.name).join(", ") || "(none yet)"}`);
      return { name: roleName, instructions: found.instructions, source: "library" };
    }
    return undefined;
  }

  /** This agent's session parks on the task's current state (see park.ts): the runner waits without a model. */
  async park(task: Task): Promise<void> {
    await writeParkMarker(this.fs, this.me, task);
  }

  /** The jobs delegated from a task (their own tasks, newest last). */
  async jobsOf(taskId: string): Promise<Task[]> {
    return (await this.tasks.list()).filter((t) => t.jobOf?.taskId === taskId);
  }

  /**
   * The lead hands a self-contained piece of its work to a new runner (a load test, a diagnosis, a migration dry run):
   * a task of its own with one agent from a spawn template, started in IMPLEMENT from the lead's commit, no agreement and
   * no review. It is the lead's open subtask until it is done; then its result and commits come back to the lead.
   */
  async delegate(input: { taskId: string; template: string; job: string; files?: string[]; role?: string; instructions?: string; baseCommit?: string }): Promise<{ job: Task; agentId: string; subtask: string }> {
    await this.requireMe();
    return this.mutate(input.taskId, async (task) => {
      const lead = this.phases.integrator(task);
      if (lead !== this.me) throw new AppError("FORBIDDEN", `Only the lead (${lead}) delegates work of ${task.id}`);
      if (task.phase !== "IMPLEMENT" && task.phase !== "INTEGRATE") throw new AppError("INVALID_PHASE", "Delegate in IMPLEMENT or INTEGRATE, once the agreement says who does what; before that, spawn_agent adds a team member");
      if (task.jobOf) throw new AppError("FORBIDDEN", "A delegated job does not delegate further: do it, or say in your result what is left");
      const job = input.job?.trim() ?? "";
      if (job.length < 20) throw new AppError("INVALID_INPUT", "job: what to do, concretely — the goal, where (files, endpoints), how to check it, what to report back (20+ characters)");
      const { templates, maxPerTask } = await this.spawnTemplates();
      if (!templates.length) throw new AppError("INVALID_INPUT", 'Nothing to delegate to: the operator has no "spawn" templates in runners.json');
      const template = templates.find((t) => t.name === input.template);
      if (!template) throw new AppError("INVALID_INPUT", `No template "${input.template}"; the templates: ${templates.map((t) => t.name).join(", ")}`, { templates: templates.map((t) => t.name) });
      const jobs = await this.jobsOf(task.id);
      const used = (task.spawned?.length ?? 0) + jobs.length;
      if (used >= maxPerTask) throw new AppError("INVALID_INPUT", `This task added or delegated ${used} runner(s) already, the limit is ${maxPerTask}`);
      const files = [...new Set((input.files ?? []).map((f) => normalizePath(assertRelativeFilePath(f))))];
      // a job works on the lead's own files or on files nobody in the task owns: never on another agent's
      const agreement = await this.agreements.find(task.id);
      const taken = (agreement?.assignments ?? []).filter((a) => a.agentId !== lead).flatMap((a) => (a.files ?? []).filter((g) => files.some((f) => overlaps(f, g))).map((g) => `${g} (${a.agentId})`));
      if (taken.length) {
        throw new AppError("FILE_NOT_OWNED", `The job's files belong to other agents of ${task.id}: ${taken.join(", ")}. Delegate work on your own files or new ones; that part is theirs — or ask them (send_message) to hand it over first.`, { taken });
      }
      const role = await this.roleOf(input, `${template.name}-job`);
      const ids = new Set([...(await this.agents.list()).map((a) => a.id), ...(await this.tasks.list()).flatMap((t) => t.agents), OPERATOR]);
      let agentId = "";
      for (let n = 1; ; n++) if (!ids.has((agentId = `${template.name}-job${n}`)) && (await this.claimAgentId(agentId, task.id))) break;
      // the lead's checklist gets the job as an open step: its own complete() waits for it
      let subtask = "";
      await this.subtasks.update(task.id, lead, (list) => {
        subtask = `s${list.nextSeq}`;
        return { ...list, items: [...list.items, { id: subtask, title: `delegated to ${agentId}: ${job.split("\n")[0]!.slice(0, 120)}`, status: "TODO", updatedAt: new Date().toISOString() }], nextSeq: list.nextSeq + 1 };
      });
      const at = new Date().toISOString();
      const description =
        `Delegated by ${lead}, the lead of ${task.id} ("${task.title}"):\n\n${job}\n\n` +
        `You do this job alone: no agreement, no review; the lead takes your result into its task.` +
        (input.baseCommit ? ` Start from the lead's code: git merge ${input.baseCommit} first.` : "") +
        (files.length ? ` Change only: ${files.join(", ")}; commit your work.` : " Change no file: report what you found in your result.") +
        ` Then complete({result: <what you did and found, the numbers>, filesChanged, commits}): that ends the job and sends the result to ${lead}. Questions about the job: send_message({to: "operator"}).`;
      const created = await this.tasks.create({
        title: `${task.id} job: ${job.split("\n")[0]!}`.slice(0, 200), description, agents: [agentId], createdBy: lead, git: task.git,
        maxFixRounds: 0, ...(task.verifyCommand ? { verifyCommand: task.verifyCommand } : {}), ...(task.maxCostUsd !== undefined ? { maxCostUsd: task.maxCostUsd } : {}),
        ...(input.baseCommit ? { baseCommit: input.baseCommit } : {}), parentTaskId: task.id,
      });
      const started: Task = {
        ...created, phase: "IMPLEMENT", phaseHistory: [...(created.phaseHistory ?? []), { phase: "IMPLEMENT", at }],
        jobOf: { taskId: task.id, by: lead, subtask },
        spawned: [{ id: agentId, template: template.name, by: lead, at, reason: job.slice(0, 1000), ...(role ? { role } : {}) }],
      };
      await this.tasks.save(started);
      await this.agreements.save({ taskId: created.id, summary: job.slice(0, 500), assignments: [{ agentId, responsibility: job, files }], decisions: [], interfaces: [], approvedBy: [agentId], createdAt: at, proposedBy: lead, version: 1 });
      await this.emit({ type: "TASK_CREATED", taskId: created.id, sourceAgent: lead, payload: { title: started.title, agents: [agentId], jobOf: task.id } });
      await this.emit({ type: "JOB_DELEGATED", taskId: task.id, sourceAgent: lead, payload: { job: created.id, agentId, template: template.name, subtask } });
      return { job: started, agentId, subtask };
    });
  }

  /**
   * "Done" means a green build the lead ran, not its word: with a verifyCommand, PASS needs the lead's latest build() to be
   * that command, green, run in this INTEGRATE round on the merged commit it reports, with nothing uncommitted.
   */
  private async requireGreenBuild(task: Task, merged: string | undefined): Promise<void> {
    if (!task.verifyCommand) return;
    const b = await this.fs.readJson<{ command: string; ok: boolean; at: string; head?: string; dirty?: number; phase?: string; round?: number; timedOut?: boolean }>(["tasks", task.id, "builds", `${this.me}.json`]);
    // the command as build() records it (a "2>&1 | tail" dropped, the arguments split)
    let want = task.verifyCommand.trim().replace(/\s+/g, " ");
    try {
      want = parseBuildCommand(task.verifyCommand, buildTools()).argv.join(" ");
    } catch {
      /* not a build-tool command: compare it as written */
    }
    const why = !b
      ? "you have not run it"
      : b.command !== want
        ? `your latest build was "${b.command}"`
        : !b.ok
          ? `your latest run of it ${b.timedOut ? "timed out" : "failed"}`
          : b.phase !== "INTEGRATE" || b.round !== task.syncRound
            ? "your latest green run was before this integration round"
            : b.dirty
              ? `it ran with ${b.dirty} uncommitted change(s): commit the merged result first`
              : merged && b.head && !b.head.startsWith(merged) && !merged.startsWith(b.head)
                ? `it ran on ${b.head.slice(0, 7)}, not on the merged commit ${merged.slice(0, 7)} you report`
                : null;
    if (why) {
      throw new AppError(
        "VERIFY_REQUIRED",
        `PASS needs a green "${task.verifyCommand}" on the merged result, run by you in this integration: ${why}. Commit the merged result, call build() (no command runs verifyCommand), and complete({status: "PASS", result, commits: [<that HEAD>]}) once it is green; if it fails, fix it or complete with NEEDS_FIX.`,
        { verifyCommand: task.verifyCommand },
      );
    }
  }

  /** A job is over (done or cancelled): its step in the lead's checklist closes, the lead gets the result in its task. */
  private async finishJob(job: Task, outcome: "done" | "cancelled", reason?: string): Promise<void> {
    if (!job.jobOf) return;
    const { taskId, by, subtask } = job.jobOf;
    const agentId = job.agents[0]!;
    const impl = await this.implementations.find(job.id, agentId);
    const note = outcome === "done" ? (impl?.summary ?? "done").slice(0, 300) : `cancelled${reason ? `: ${reason}` : ""}`;
    await this.subtasks.update(taskId, by, (list) => ({ ...list, items: list.items.map((i) => (i.id === subtask ? { ...i, status: outcome === "done" ? ("DONE" as const) : ("DROPPED" as const), note, updatedAt: new Date().toISOString() } : i)) }));
    const commits = impl?.commits ?? [];
    const content = outcome === "done"
      ? `Your delegated job ${job.id} is done (${agentId}; your subtask ${subtask} is ticked).\nResult: ${impl?.summary ?? "(none)"}` +
        (impl?.filesChanged.length ? `\nFiles: ${impl.filesChanged.join(", ")}` : "") +
        (commits.length ? `\nCommits: ${commits.join(" ")} — bring them into your branch: git merge ${commits.at(-1)}` : "")
      : `Your delegated job ${job.id} (${agentId}) was cancelled${reason ? `: ${reason}` : ""}; your subtask ${subtask} is dropped. Do that part yourself or leave it out and say so in your result.`;
    const message = await this.messages.create({ taskId, from: agentId, to: by, type: "INFORMATION", content });
    await this.emit({ type: "MESSAGE_CREATED", taskId, targetAgent: by, sourceAgent: agentId, payload: { messageId: message.id, from: agentId, type: message.type } });
    await this.emit({ type: "JOB_FINISHED", taskId, sourceAgent: agentId, payload: { job: job.id, outcome, ...(commits.length ? { commits } : {}) } });
  }

  async spawnAgent(input: { taskId: string; template: string; id?: string; reason: string; role?: string; instructions?: string }): Promise<{ task: Task; agentId: string }> {
    await this.requireMe();
    return this.mutate(input.taskId, async (task) => {
      if (this.phases.integrator(task) !== this.me) throw new AppError("FORBIDDEN", `Only the lead (${this.phases.integrator(task)}) adds agents to ${task.id}`);
      this.requirePhase(task, "DISCUSS");
      if (!task.allowSpawn) throw new AppError("FORBIDDEN", `${task.id} does not let the lead add agents (the operator did not tick it): split the work among ${task.agents.join(", ")}; an agent with tests in its part writes them too`);
      if (await this.agreements.find(task.id)) throw new AppError("INVALID_PHASE", "Add agents before you propose: the agreement needs an assignment for every agent of the task");
      const { templates, maxPerTask } = await this.spawnTemplates();
      if (!templates.length) throw new AppError("INVALID_INPUT", 'Nothing to spawn from: the operator has no "spawn" templates in runners.json');
      const template = templates.find((t) => t.name === input.template);
      if (!template) throw new AppError("INVALID_INPUT", `No template "${input.template}"; the templates: ${templates.map((t) => t.name).join(", ")}`, { templates: templates.map((t) => t.name) });
      const spawned = task.spawned ?? [];
      if (spawned.length >= maxPerTask) throw new AppError("INVALID_INPUT", `This task added ${spawned.length} agent(s) already, the limit is ${maxPerTask}`);
      if (!input.reason?.trim()) throw new AppError("INVALID_INPUT", "reason: which part of the work the new agent takes and why the team needs it");
      const role = await this.roleOf(input, `${template.name}-role`);
      // a fresh id: never one of a registered agent or one already in a task
      const taken = new Set([...(await this.agents.list()).map((a) => a.id), ...(await this.tasks.list()).flatMap((t) => t.agents), OPERATOR]);
      let id = input.id?.trim();
      if (id) {
        assertAgentId(id, "id");
        if (taken.has(id) || !(await this.claimAgentId(id, task.id))) throw new AppError("INVALID_INPUT", `The id ${id} is taken: leave id out for a fresh one`);
      } else {
        for (let n = 2; ; n++) if (!taken.has((id = `${template.name}-${n}`)) && (await this.claimAgentId(id, task.id))) break;
      }
      const saved = await this.tasks.save({ ...task, agents: [...task.agents, id!], spawned: [...spawned, { id: id!, template: template.name, by: this.me, at: new Date().toISOString(), reason: input.reason.trim(), ...(role ? { role } : {}) }] });
      await this.emit({ type: "AGENT_SPAWNED", taskId: task.id, sourceAgent: this.me, payload: { agentId: id, template: template.name, reason: input.reason.trim(), ...(role ? { role: role.name, roleSource: role.source } : {}) } });
      return { task: saved, agentId: id! };
    });
  }

  /**
   * A new agent's id, claimed once for the whole network (claims/agents/<id>.json, created only if absent): two leads of
   * different tasks adding agents at the same moment hold only their own task's lock, and must never get the same id.
   */
  private async claimAgentId(id: string, taskId: string): Promise<boolean> {
    return this.fs.createJson(["claims", "agents", `${assertAgentId(id, "id")}.json`], { taskId, by: this.me, at: new Date().toISOString() });
  }

  /** A change-writing task: a free name in a project that uses OpenSpec (openspec/ exists; we never create it). */
  private async checkNewChange(name: string, implementsOne: boolean): Promise<string> {
    assertChangeName(name);
    if (implementsOne) throw new AppError("INVALID_INPUT", "A task either writes an OpenSpec change (proposes) or implements one (openspec), not both");
    if (!(await stat(join(this.projectDir, "openspec")).then((s) => s.isDirectory(), () => false))) {
      throw new AppError("OPENSPEC_NOT_FOUND", `${this.projectDir} does not use OpenSpec yet (no openspec/ folder): run \`openspec init --tools claude,qwen\` there and commit it first`);
    }
    if (await hasChange(this.projectDir, name)) throw new AppError("INVALID_INPUT", `The change ${changePath(name)} exists already: implement it (openspec) or pick another name`);
    return name;
  }

  /** Operator: retire a task (wrong or empty assignment). Agents move on to their next task. */
  async cancelTask(taskId: string, reason?: string): Promise<Task> {
    assertTaskId(taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "ACTIVE" && task.status !== "BLOCKED") throw new AppError("ALREADY_COMPLETED", `Task ${taskId} is already ${task.status}`);
      const saved = await this.tasks.save({ ...task, status: "CANCELLED" });
      await this.emit({ type: "TASK_CANCELLED", taskId, sourceAgent: "operator", payload: { reason: reason ?? null } });
      if (saved.jobOf) await this.finishJob(saved, "cancelled", reason);
      return saved;
    });
  }

  /**
   * Operator: give a BLOCKED task more fix rounds; the fix that was held back starts right away. A task blocked by its
   * cost limit gets more money instead (extraUsd; rounds are left as they are) and goes on where it stopped.
   */
  async unblockTask(taskId: string, extraRounds = 1, extraUsd?: number): Promise<Task> {
    assertTaskId(taskId);
    if (!Number.isInteger(extraRounds) || extraRounds < 1 || extraRounds > 20) throw new AppError("INVALID_INPUT", "rounds must be an integer 1..20");
    const usd = extraUsd === undefined ? undefined : checkCostLimit(extraUsd, "usd");
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "BLOCKED") throw new AppError("INVALID_INPUT", `Task ${taskId} is ${task.status}, not BLOCKED`);
      if (task.blockedBy === "cost") {
        if (usd === undefined) throw new AppError("INVALID_INPUT", `Task ${taskId} is blocked by its cost limit ($${task.maxCostUsd}): raise it with usd, e.g. +5`);
        const { blockedReason: _r, blockedBy: _b, ...open } = task;
        const maxCostUsd = Math.round(((task.maxCostUsd ?? 0) + usd) * 100) / 100;
        await this.tasks.save({ ...open, status: "ACTIVE", maxCostUsd });
        await this.emit({ type: "TASK_UNBLOCKED", taskId, sourceAgent: "operator", payload: { extraUsd: usd, maxCostUsd } });
        return this.advance(taskId);
      }
      if (task.blockedBy === "runner") {
        // the runner that gave up sees the task changed and tries again from a fresh session
        const { blockedReason: _r, blockedBy: _b, ...open } = task;
        await this.tasks.save({ ...open, status: "ACTIVE" });
        await this.emit({ type: "TASK_UNBLOCKED", taskId, sourceAgent: "operator", payload: { kind: "runner" } });
        return this.advance(taskId);
      }
      if (usd !== undefined) throw new AppError("INVALID_INPUT", `Task ${taskId} is blocked by its fix rounds, not by money: give it rounds`);
      const { blockedReason: _drop, handover: _handover, takeover: _takeover, ...rest } = task;
      // unblockedAtRound: the fix held back in this round goes ahead even if it was stopped as a stalled fix
      await this.tasks.save({ ...rest, status: "ACTIVE", maxFixRounds: this.phases.maxFixRounds(task) + extraRounds, unblockedAtRound: task.syncRound });
      await this.emit({ type: "TASK_UNBLOCKED", taskId, sourceAgent: "operator", payload: { extraRounds } });
      return this.advance(taskId);
    });
  }

  /**
   * Operator (the page, after an agent session ended): the task's sessions have cost `spentUsd`, at or above its limit.
   * An ACTIVE task becomes BLOCKED until the operator raises the limit or cancels it; the agents end their sessions as on
   * any BLOCKED task. Returns null when there is nothing to block (no limit, not reached, not ACTIVE).
   */
  async blockForCost(taskId: string, spentUsd: number): Promise<Task | null> {
    assertTaskId(taskId);
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator blocks a task by its cost");
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "ACTIVE" || task.maxCostUsd === undefined || spentUsd < task.maxCostUsd) return null;
      const reason = `cost limit $${task.maxCostUsd} reached ($${spentUsd.toFixed(2)} spent); the operator decides: raise the limit or cancel`;
      const saved = await this.tasks.save({ ...task, status: "BLOCKED", blockedReason: reason, blockedBy: "cost" });
      await this.emit({ type: "TASK_BLOCKED", taskId, sourceAgent: OPERATOR, payload: { phase: task.phase, reason, kind: "cost", maxCostUsd: task.maxCostUsd, spentUsd: Math.round(spentUsd * 100) / 100, round: task.syncRound } });
      return saved;
    });
  }

  /** Operator (the page): an agent's runner gave up on the task; without it the others wait forever, so it goes to the operator. */
  async blockForRunner(taskId: string, agentId: string, reason: string): Promise<Task | null> {
    assertTaskId(taskId);
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator blocks a task for a runner");
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "ACTIVE") return null;
      const why = `${agentId}'s runner gave up: ${reason}; see its log on the Runners tab. Try again (the runner starts afresh) or cancel`;
      const saved = await this.tasks.save({ ...task, status: "BLOCKED", blockedReason: why, blockedBy: "runner" });
      await this.emit({ type: "TASK_BLOCKED", taskId, sourceAgent: OPERATOR, payload: { phase: task.phase, reason: why, kind: "runner", agentId, round: task.syncRound } });
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
      if (task.proposes?.input?.length && !inputViewed(await this.planState(task.id))) {
        throw new AppError(
          "INPUT_NOT_REVIEWED",
          `${task.id} starts from the analysts' artifacts: show them to the operator first as one page — plan({stage: "input", html, note}) — and wait() until it has looked; then the grilling, then propose().`,
        );
      }
      if (task.clarify && !(await this.leadWroteOperator(task))) {
        throw new AppError(
          "CLARIFY_FIRST",
          task.grill
            ? `${task.id} asks the lead to grill the operator about the task first: rounds of questions (send_message({to: "operator", message, options, recommended}), one per question, each with your recommendation), then your summary as a question — send_message({to: "operator", message: "How I understand it: <the decisions>. Is that right?", options: [{label: "Yes, that's it"}, {label: "No, I will correct it"}], recommended: "Yes, that's it"}). propose() after the operator's yes.`
            : `${task.id} asks the lead to check the task first: ask the operator what is unclear (send_message({to: "operator", message, options, recommended})), or tell it how you understood the task (send_message({to: "operator", fyi: true, message: "How I understand it: ... No questions."})); then propose().`,
        );
      }
      if (task.planReview) {
        const plan = await this.planState(task.id);
        if (!plan.approved) {
          const st = planStatus(plan);
          throw new AppError(
            "PLAN_NOT_APPROVED",
            st === "none"
              ? `${task.id} asks for a plan first: write it with plan({html}) — the operator reviews and approves it on the page, then you propose().`
              : `Plan v${plan.versions.at(-1)!.n} is not approved yet${st === "revising" ? ": work in the operator's feedback with plan({edits}) or plan({html})" : ": wait() for the operator"}; propose() after the approval.`,
            { plan: st },
          );
        }
      }
      const ids = input.assignments.map((a) => assertAgentId(a.agentId));
      if (new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT", "Each agent may have only one assignment");
      for (const id of ids) if (!task.agents.includes(id)) throw new AppError("NOT_ASSIGNED", `Agent '${id}' is not part of ${task.id}`);
      const missing = task.agents.filter((a) => !ids.includes(a));
      if (missing.length) throw new AppError("INVALID_INPUT", `Every task agent needs an assignment; missing: ${missing.join(", ")}`);

      const normalized = input.assignments.map(({ tasks, dependsOn, ...a }) => {
        const deps = [...new Set((dependsOn ?? []).map((d) => assertAgentId(String(d).trim())))];
        return {
          ...a,
          ...(a.files ? { files: [...new Set(a.files.map((f) => normalizePath(assertRelativeFilePath(f))))] } : {}),
          ...(task.openspec && tasks !== undefined ? { tasks } : {}), // task numbers mean something only for an OpenSpec task
          ...(deps.length ? { dependsOn: deps } : {}),
        };
      });
      assertDependencies(normalized);
      const assignments = task.openspec ? await this.splitOpenspec(task, normalized) : task.proposes ? this.specOnly(task, normalized) : normalized;
      const overlaps = findOverlaps(assignments);
      if (overlaps.length) {
        const first = overlaps[0]!;
        throw new AppError(
          "FILE_OVERLAP",
          (first.files[0] === first.files[1]
            ? `Two agents claim the same files: ${first.agents[0]} and ${first.agents[1]} both list '${first.files[0]}'`
            : `Two agents claim the same files: ${first.agents[0]} '${first.files[0]}' and ${first.agents[1]} '${first.files[1]}'`) +
            `${overlaps.length > 1 ? ` (and ${overlaps.length - 1} more)` : ""}. Split the files so that every file has ONE owner (talk it over with send_message) — split the work, do not take it away: an agent that was to write tests gets its own test class (e.g. a separate *LoadTest or *EdgeCasesTest) rather than files: []; ` +
            `if an agent later needs a file of the other, it asks with send_message(requestFiles=[...]).`,
          { overlaps: overlaps.map((o) => ({ agents: o.agents, files: [...new Set(o.files)] })) },
        );
      }

      const previous = await this.agreements.find(task.id);
      const agreement: Agreement = {
        taskId: task.id,
        summary: input.summary,
        assignments,
        decisions: input.decisions ?? [],
        interfaces: input.interfaces ?? [],
        // proposing it is approving it: no separate turn for the author to approve its own proposal
        approvedBy: assignments.some((a) => a.agentId === this.me) ? [this.me] : [],
        createdAt: new Date().toISOString(),
        proposedBy: this.me,
        version: (previous?.version ?? 0) + 1,
      };
      await this.agreements.save(agreement);
      await this.emit({ type: "AGREEMENT_UPDATED", taskId: task.id, sourceAgent: this.me, payload: { proposedBy: this.me, version: agreement.version } });
      if (agreement.approvedBy.includes(this.me)) await this.emit({ type: "AGREEMENT_APPROVED", taskId: task.id, sourceAgent: this.me, payload: { approvedBy: this.me, version: agreement.version, byProposing: true } });
      return { agreement };
    });
  }

  /**
   * Change-writing task: the lead (the author) owns the change folder and nothing else, the others review (files: []).
   * No code changes in such a task: the change is reviewed, merged and implemented by a task of its own.
   */
  private specOnly(task: Task, assignments: Assignment[]): Assignment[] {
    const dir = `${changePath(task.proposes!.change)}/**`;
    const lead = this.phases.integrator(task);
    const wrong = assignments.filter((a) => (a.files ?? []).some((f) => (a.agentId === lead ? f !== dir : true)));
    if (wrong.length) {
      throw new AppError(
        "SPEC_ONLY",
        `This task writes the OpenSpec change ${changePath(task.proposes!.change)}/ and changes no code: the lead ${lead} gets files ["${dir}"], every other agent files [] (it reviews the change). Wrong files for: ${wrong.map((a) => `${a.agentId} (${(a.files ?? []).join(", ")})`).join("; ")}.`,
        { lead, files: dir },
      );
    }
    return assignments.map((a) => ({ ...a, files: a.agentId === lead ? [dir] : [], ...(a.tasks ? { tasks: [] } : {}) }));
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
      // the author approved it by proposing it: its own approve after that changes nothing
      if (agreement.approvedBy.includes(this.me) && agreement.proposedBy === this.me) return { agreement };
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

  async sendMessage(input: { taskId: string; to: string; type: MessageType; content: string; replyTo?: string; files?: string[]; choices?: QuestionChoices; quiet?: boolean }): Promise<Message> {
    await this.requireMe();
    const task = await this.requireMember(input.taskId);
    if (task.status === "COMPLETED") throw new AppError("ALREADY_COMPLETED", "The task is completed");
    const to = assertAgentId(input.to, "to");
    if (to === this.me) throw new AppError("INVALID_INPUT", "You cannot send a message to yourself");
    if (to !== OPERATOR && !task.agents.includes(to)) throw new AppError("NOT_ASSIGNED", `Agent '${to}' is not part of ${task.id}`);
    if (to === OPERATOR && input.files?.length) throw new AppError("INVALID_INPUT", "The operator owns no files: ask it questions, not for files");
    if (!input.content.trim()) throw new AppError("INVALID_INPUT", "content must not be empty");
    const choices = input.choices ? checkChoices(input.choices, to === OPERATOR && input.type === "QUESTION") : undefined;
    if (input.replyTo) {
      assertMessageId(input.replyTo);
      await this.messages.get(task.id, input.replyTo);
    }
    const quiet = input.quiet && to !== OPERATOR && input.type === "INFORMATION";
    const message = await this.messages.create({ taskId: task.id, from: this.me, to, type: input.type, content: input.content, replyTo: input.replyTo, files: input.files, ...(choices ? { choices } : {}), ...(quiet ? { quiet: true } : {}) });
    await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: to, sourceAgent: this.me, payload: { messageId: message.id, from: this.me, type: message.type, ...(message.files ? { files: message.files } : {}), ...(quiet ? { quiet: true } : {}) } });
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
    // the page, the CLI and the supervisor may answer at nearly the same time: the agent gets one answer, not two
    if (question.readAt) throw new AppError("INVALID_INPUT", `${question.id} is answered or closed already (${question.readAt})`);
    if (!input.answer.trim()) throw new AppError("INVALID_INPUT", "The answer must not be empty");
    const answer = await this.messages.create({ taskId: task.id, from: OPERATOR, to: question.from, type: "INFORMATION", content: input.answer.trim(), replyTo: question.id });
    await this.messages.markRead(question);
    await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: question.from, sourceAgent: OPERATOR, payload: { messageId: answer.id, from: OPERATOR, type: answer.type, replyTo: question.id } });
    // the lead keeps the agreement: a decision the operator gave another agent reaches it too (a reviewer once got
    // "unchecked exception", the lead built a checked one, and the review sent it back a round)
    const lead = this.phases.integrator(task);
    if (question.from !== lead && task.agents.includes(lead) && task.status !== "COMPLETED" && task.status !== "CANCELLED") {
      const copy = await this.messages.create({
        taskId: task.id, from: OPERATOR, to: lead, type: "INFORMATION", quiet: true,
        content: `[For your information, the lead: the operator answered ${question.from}'s question. No reply needed; make the agreement and the work follow it.]\nQuestion (${question.from}): ${question.content.slice(0, 600)}\nAnswer: ${input.answer.trim()}`,
      });
      await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: lead, sourceAgent: OPERATOR, payload: { messageId: copy.id, from: OPERATOR, type: copy.type, quiet: true } });
    }
    return answer;
  }

  /**
   * The operator closes a question without answering it: the agent went ahead on its own, or it was settled another
   * way (on the supervisor's tab). The agent gets no message; the question no longer waits on the page.
   */
  async dismissQuestion(input: { taskId: string; messageId: string }): Promise<Message> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator closes questions to the operator");
    const task = await this.tasks.get(assertTaskId(input.taskId));
    const question = await this.messages.get(task.id, assertMessageId(input.messageId));
    if (question.to !== OPERATOR) throw new AppError("INVALID_INPUT", `${question.id} is not a question to the operator`);
    return this.messages.markRead(question);
  }

  /**
   * The operator (or the supervisor acting for it) writes to a task without being asked. It goes to the task's lead
   * only, who acts on it and passes on to the other agents what concerns them: one voice for the team, no orders
   * crossing the lead's plan. An ordinary message, so a waiting lead wakes up with it and a busy one gets it through
   * its hooks. (Answers to an agent's own question still go to that agent: answerQuestion.)
   */
  async messageLead(input: { taskId: string; content: string; urgent?: boolean }): Promise<Message> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator writes to the lead this way");
    const task = await this.tasks.get(assertTaskId(input.taskId));
    if (task.status === "COMPLETED" || task.status === "CANCELLED") throw new AppError("ALREADY_COMPLETED", `Task ${task.id} is ${task.status}`);
    if (!input.content.trim()) throw new AppError("INVALID_INPUT", "The message must not be empty");
    const to = this.phases.integrator(task);
    const others = task.agents.filter((a) => a !== to);
    const note = others.length
      ? `[From the operator to you, the lead of ${task.id}: act on it, and pass on to ${others.join(", ")} with send_message what they need to do. No reply needed; if you reply, use fyi: true.]\n`
      : `[From the operator. No reply needed; if you reply, use fyi: true.]\n`;
    const message = await this.messages.create({ taskId: task.id, from: OPERATOR, to, type: "INFORMATION", content: `${note}${input.content.trim()}`, ...(input.urgent ? { urgent: true } : {}) });
    await this.emit({ type: "MESSAGE_CREATED", taskId: task.id, targetAgent: to, sourceAgent: OPERATOR, payload: { messageId: message.id, from: OPERATOR, type: message.type } });
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
      reviewOnly: isReviewOnly(mine, await this.tasks.find(taskId).then((t) => t ?? undefined)),
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

  /** The build tool finished a run: recorded for the page only (addressed to the agent itself, so it wakes nobody). */
  async recordBuild(taskId: string | null, payload: { command: string; ok: boolean; exitCode: number | null; timedOut: boolean; durationMs: number; logPath: string; tests?: { total: number; failed: number }; head?: string; dirty?: number; phase?: string; round?: number }): Promise<void> {
    await this.emit({ type: "BUILD_RAN", ...(taskId ? { taskId } : {}), targetAgent: this.me, sourceAgent: this.me, payload: { agentId: this.me, ...payload } });
    // the page shows the latest run per agent without reading every event of the task
    if (taskId) await this.fs.writeJson(["tasks", taskId, "builds", `${this.me}.json`], { agentId: this.me, at: new Date().toISOString(), ...payload });
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
      if (existing?.status === "IN_PROGRESS" || existing?.auto) return { implementation: existing, alreadyStarted: true };
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
      await this.requireReviewDone(task);
      const existing = await this.implementations.find(task.id, this.me);
      if (!existing) throw new AppError("NOT_STARTED", "Call implementation_start before implementation_complete");
      // a review-only part the server marked ready: the agent's own report (a review note, say) replaces it
      if (existing.status === "READY_FOR_SYNC" && !existing.auto) throw new AppError("ALREADY_COMPLETED", "Your implementation is already READY_FOR_SYNC");
      const open = (await this.subtasks.get(task.id, this.me)).items.filter((i) => i.status === "TODO" || i.status === "DOING");
      if (open.length) {
        throw new AppError(
          "OPEN_SUBTASKS",
          `You still have open subtasks: ${open.map((i) => `${i.id} "${i.title}"`).join(", ")}. Finish them and mark them done with subtasks({done: [...]}), or drop the ones that are not needed: subtasks({drop: [{id, reason}]}). Then complete again.`,
          { openSubtasks: open },
        );
      }
      await this.checkDependencies(task);
      const tasksDone = task.openspec ? await this.checkTasksDone(task, input.tasksDone) : undefined;
      const warnings = await this.checkOwnership(task.id, filesChanged);
      const { auto: _auto, ...reported } = existing;
      const implementation: Implementation = {
        ...reported,
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

  /**
   * dependsOn: the agent works in parallel, but reports its part only after the agents whose code it calls reported
   * theirs (READY_FOR_SYNC in this round). The Swarm also checks that their commits are in the agent's branch.
   */
  private async checkDependencies(task: Task): Promise<void> {
    const mine = (await this.agreements.find(task.id))?.assignments.find((a) => a.agentId === this.me);
    // a review-only part (files: []) runs nothing against their code in IMPLEMENT: it reviews in SYNC, after them anyway
    if (isReviewOnly(mine, task)) return;
    const deps = mine?.dependsOn ?? [];
    if (!deps.length) return;
    const impls = await this.implementations.list(task.id);
    const waiting = deps.filter((d) => !impls.some((i) => i.agentId === d && i.status === "READY_FOR_SYNC"));
    if (waiting.length) {
      throw new AppError(
        "DEPENDENCY_NOT_READY",
        `Your part depends on ${waiting.join(", ")} (dependsOn in the agreement): complete() is accepted after ${waiting.length > 1 ? "they report their parts" : "it reports its part"} and you ran your work against that code. ` +
          "Go on with what does not need it, or call wait(): you are woken when they report.",
        { waitingFor: waiting },
      );
    }
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
  /**
   * Operator, after DONE: merge the lead's branch (its own worktree) into the project's current branch, without a push.
   * Refused, with nothing changed, on conflicts or uncommitted changes in the project (see worktrees.mergeBranch).
   */
  async mergeTask(
    input: { taskId: string; project: string; branch: string; strategy?: MergeStrategy },
    merge: (project: string, branch: string, message: string, strategy?: MergeStrategy) => Promise<MergeResult> = mergeBranch,
  ): Promise<Task> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator merges a task's branch into the project");
    const taskId = assertTaskId(input.taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "COMPLETED") throw new AppError("INVALID_PHASE", `Merge once the task is DONE; ${taskId} is ${task.phase} (${task.status})`);
      if (task.merged) throw new AppError("ALREADY_COMPLETED", `${task.merged.branch} was merged into ${task.merged.into} at ${task.merged.at} (${task.merged.commit.slice(0, 7)})`);
      const strategy = input.strategy ?? "squash";
      // one commit per task by default: "task-001: <title>" — the history reads by task, and one revert undoes one
      const message = (strategy === "squash" ? `${taskId}: ${task.title}` : `Merge ${input.branch}: ${taskId} ${task.title}`).slice(0, 200);
      const r = await merge(input.project, input.branch, message, strategy);
      const merged = { at: new Date().toISOString(), branch: input.branch, into: r.into, commit: r.commit, already: r.already, ...(r.already ? {} : { strategy }) };
      const saved = await this.tasks.save({ ...task, merged });
      await this.emit({ type: "TASK_MERGED", taskId, sourceAgent: OPERATOR, payload: merged });
      return saved;
    });
  }

  /** Operator: undo a merged task with one revert commit (refused, with nothing changed, on conflicts). */
  async revertTask(input: { taskId: string; project: string }, revert: (project: string, commit: string, message: string) => Promise<{ commit: string }> = revertCommit): Promise<Task> {
    if (this.me !== OPERATOR) throw new AppError("FORBIDDEN", "Only the operator reverts a merged task");
    const taskId = assertTaskId(input.taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (!task.merged || task.merged.already) throw new AppError("INVALID_INPUT", `${taskId} was not merged by the page: nothing to revert`);
      if (task.merged.reverted) throw new AppError("ALREADY_COMPLETED", `${taskId} was reverted at ${task.merged.reverted.at} (${task.merged.reverted.commit.slice(0, 7)})`);
      const r = await revert(input.project, task.merged.commit, `Revert ${taskId}: ${task.title}`.slice(0, 200));
      const saved = await this.tasks.save({ ...task, merged: { ...task.merged, reverted: { at: new Date().toISOString(), commit: r.commit } } });
      await this.emit({ type: "TASK_REVERTED", taskId, sourceAgent: OPERATOR, payload: { commit: r.commit, of: task.merged.commit } });
      return saved;
    });
  }

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
      if (input.status === "PASS") await this.requireGreenBuild(task, commits[0]);
      // the work delegated in this round comes back first: PASS without it would leave a job running for nothing
      const open = (await this.jobsOf(task.id)).filter((j) => j.status === "ACTIVE" || j.status === "BLOCKED");
      if (input.status === "PASS" && open.length) {
        throw new AppError("JOBS_OPEN", `Your delegated jobs are not back yet: ${open.map((j) => `${j.id} (${j.agents[0]})`).join(", ")}. wait() for their results (they arrive in pendingMessages), merge them, then complete again.`, { jobs: open.map((j) => j.id) });
      }
      this.requireIntegrator(task);
      if (input.status === "PASS") await this.requireReviewDone(task);
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
          ...(task.maxCostUsd !== undefined ? { maxCostUsd: task.maxCostUsd } : {}),
          ...(task.allowSpawn ? { allowSpawn: true } : {}),
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
    return this.subtasks.update(task.id, this.me, (list) => {
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
      return list;
    });
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

  /**
   * The operator decides. If nobody does by the deadline, the lead takes over the stuck fix for one round (see
   * escalateIfDue); not when the lead itself has to fix, and not again after a takeover.
   */
  private async block(task: Task, h: Halt): Promise<Task> {
    const lead = this.phases.integrator(task);
    const from = h.needsFix.filter((a) => a !== lead);
    const handover = !task.takeover && from.length && !h.needsFix.includes(lead) ? { dueAt: new Date(Date.now() + this.operatorTimeoutMs).toISOString(), from, lead } : undefined;
    const saved = await this.tasks.save({ ...task, status: "BLOCKED", blockedReason: h.reason, ...(handover ? { handover } : {}) });
    await this.emit({ type: "TASK_BLOCKED", taskId: task.id, payload: { phase: h.phase, reason: h.reason, needsFix: h.needsFix, round: task.syncRound, ...(handover ? { handover } : {}) } });
    return saved;
  }

  /**
   * Anyone may call it (a runner, the page, a waiting agent): once the operator has let the deadline of a BLOCKED task
   * pass, the lead takes over the stuck fix. Returns the task when it was handed over, null otherwise.
   */
  async escalateIfDue(taskId: string): Promise<Task | null> {
    const due = (t: Task | null) => !!t && t.status === "BLOCKED" && !!t.handover && Date.parse(t.handover.dueAt) <= Date.now();
    if (!due(await this.tasks.find(assertTaskId(taskId)))) return null;
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      return due(task) ? this.takeOver(task, "timeout") : null;
    });
  }

  /** Operator: give the stuck fix to the lead now instead of waiting for the deadline. */
  async handOverToLead(taskId: string): Promise<Task> {
    assertTaskId(taskId);
    return this.fs.withLock(this.tasks.lockPath(taskId), async () => {
      const task = await this.tasks.get(taskId);
      if (task.status !== "BLOCKED" || !task.handover) {
        throw new AppError("INVALID_INPUT", task.status !== "BLOCKED" ? `Task ${taskId} is ${task.status}, not BLOCKED` : `Task ${taskId} cannot go to the lead: the lead itself has to fix, or it already took over once`);
      }
      return this.takeOver(task, "operator");
    });
  }

  /** The held-back fix goes to the lead: the stuck agents' files are granted to it, and only it works this round. */
  private async takeOver(task: Task, by: "operator" | "timeout"): Promise<Task> {
    const { handover, blockedReason: _drop, ...rest } = task;
    const { from, lead } = handover!;
    const agreement = await this.agreements.find(task.id);
    for (const agent of from) {
      const files = agreement?.assignments.find((a) => a.agentId === agent)?.files ?? [];
      if (files.length) await this.grants.create({ taskId: task.id, from: agent, to: lead, files });
    }
    const taken: Task = { ...rest, status: "ACTIVE", takeover: { from, round: task.syncRound, by } };
    const why = by === "timeout" ? "the operator did not decide in time" : "the operator handed it over";
    const next = await this.applyTransition(taken, { from: task.phase, to: "IMPLEMENT", reason: `${lead} takes over the fix of ${from.join(", ")} (${why})`, needsFix: [lead] }, await this.syncs.list(task.id, task.syncRound));
    await this.emit({ type: "TASK_HANDED_OVER", taskId: task.id, ...(by === "operator" ? { sourceAgent: OPERATOR } : {}), payload: { from, lead, by } });
    return next;
  }

  private async applyTransition(task: Task, t: Transition, reports: SyncReport[]): Promise<Task> {
    const next = { ...this.phases.apply(task, t), phaseHistory: [...(task.phaseHistory ?? []), { phase: t.to, at: new Date().toISOString() }] };
    if (t.needsFix) {
      for (const agentId of t.needsFix) {
        const impl = await this.implementations.find(task.id, agentId);
        if (impl) {
          const { completedAt: _drop, ...rest } = impl;
          await this.implementations.save({ ...rest, status: "IN_PROGRESS", commitsBeforeFix: impl.commits });
        }
      }
    }
    const saved = await this.tasks.save(next);
    // an agent that only reviews has nothing to implement: its part is ready as IMPLEMENT starts, no turn of its own for it
    if (t.from === "DISCUSS" && t.to === "IMPLEMENT") {
      const agreement = await this.agreements.find(task.id);
      for (const a of (agreement?.assignments ?? []).filter((x) => isReviewOnly(x, saved))) {
        if (await this.implementations.find(task.id, a.agentId)) continue;
        await this.implementations.save({ taskId: task.id, agentId: a.agentId, status: "READY_FOR_SYNC", summary: "review only: nothing to change", filesChanged: [], commits: [], completedAt: new Date().toISOString(), auto: true });
        await this.emit({ type: "IMPLEMENTATION_COMPLETED", taskId: task.id, sourceAgent: a.agentId, payload: { agentId: a.agentId, filesChanged: [], commits: [], reviewOnly: true } });
      }
    }
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
    if (t.to === "DONE" && saved.jobOf) await this.finishJob(saved, "done");
    return saved;
  }

  private async emit(e: NewEvent): Promise<NetworkEvent> {
    const event = await this.events.create(e);
    this.hub.notify();
    return event;
  }
}
