import { AppError, isAppError } from "../errors.js";
import { containsCommit, readGitContext } from "../git.js";
import { phaseEpoch } from "../handoff.js";
import { changePath, readChange, type ChangeInfo } from "../openspec.js";
import { normalizePath, ownersOf } from "../ownership.js";
import { MAX_WAIT_MS, DEFAULT_WAIT_MS, MIN_DESCRIPTION, OPERATOR, isReviewOnly, type NetworkService } from "../service.js";
import type { Agent, Agreement, FollowUpRequest, GitContext, Implementation, IntegrationReport, Message, Phase, SubtaskList, SyncFinding, SyncReport, Task } from "../types.js";

/** What the agent should do next, computed by the server so the agent never reasons about the state machine. */
export type NextAction = "respond" | "propose" | "approve" | "implement" | "fix" | "sync" | "integrate" | "wait" | "done";

export interface Decision {
  nextAction: NextAction;
  allowedActions: string[];
  hint: string;
  waitingOn: string[];
  /** A ready-to-copy tool call for nextAction, with real agent ids filled in (helps weak models emit arguments). */
  exampleCall?: { tool: string; args: Record<string, unknown> };
  /** The task entered a phase a fresh session does: this session ends (nextAction done). */
  handoff?: Phase;
}

interface Snapshot {
  task: Task;
  /** OpenSpec task, until DONE: the change as it is in the project folder (null if it cannot be read). */
  change?: ChangeInfo | null;
  changeError?: string;
  agreement: Agreement | null;
  impls: Implementation[];
  reports: SyncReport[];
  integrations: IntegrationReport[];
  agents: Agent[];
  unread: Message[];
  /** FILE_REQUESTs addressed to this agent that it has not answered yet. */
  openToMe: Message[];
  /** FILE_REQUESTs this agent sent that the owner has not answered yet. */
  openFromMe: Message[];
  /** Every task agent's own checklist. */
  subtasks: SubtaskList[];
  /** Questions this agent asked the operator that are not answered yet. */
  myQuestions: Message[];
  /** INTEGRATE only: what the follow-up budget of the task chain still allows. */
  followUpBudget?: { max: number; used: number; remaining: number };
  /** The phase this session hands over to a fresh one, if any (see handoff.ts). */
  handoff: Phase | null;
  /** SYNC after a fix round: the ERROR findings the fixes had to address. */
  fixedFindings?: (SyncFinding & { reportedBy: string })[];
  /** IMPLEMENT: the agent's own git branch when it works apart from the task's checkout (a worktree); null otherwise. */
  ownBranch?: string | null;
  /** SYNC: reviewee -> its reported commits that this session's branch does not contain (its copy of their files is older). */
  missingCommits?: Record<string, string[]>;
}

/** "2/5 done, s3 in progress" */
function progress(list: SubtaskList | undefined): string | null {
  const items = (list?.items ?? []).filter((i) => i.status !== "DROPPED");
  if (!items.length) return null;
  const doing = items.find((i) => i.status === "DOING");
  return `${items.filter((i) => i.status === "DONE").length}/${items.length} done${doing ? `, ${doing.id} in progress` : ""}`;
}

export type SwarmContext = Record<string, unknown> & { nextAction: NextAction; allowedActions: string[] };

type RawFinding = Omit<SyncFinding, "severity"> & { severity: string };


const seq = (m: Message): number => Number(m.id.slice(4));

/**
 * A FILE_REQUEST stays open until the owner writes back to the requester (a grant or any reply, e.g. a refusal).
 * Merely reading it does not close it: the requester is blocked until it gets an answer.
 */
export function openFileRequests(messages: Message[]): Message[] {
  return messages.filter((m) => m.type === "FILE_REQUEST" && !messages.some((r) => r.from === m.to && r.to === m.from && seq(r) > seq(m)));
}


const SEVERITIES = ["INFO", "WARNING", "ERROR"] as const;

function invalid(message: string, details?: Record<string, unknown>): AppError {
  return new AppError("INVALID_INPUT", message, details);
}

/**
 * The agent-facing layer: seven operations (context, create_task, send_message, propose, subtasks, complete, wait) on top of
 * NetworkService. The "current task" is the oldest ACTIVE task of this agent, so no tool takes a taskId.
 */
export interface SwarmOptions {
  /** wait() timeout when the agent passes none (AGENT_NETWORK_WAIT_MS); keep it below the client's tool-call timeout. */
  defaultWaitMs?: number;
  /** AGENT_NETWORK_FRESH_PHASES: when the task enters one of these phases, a session that saw an earlier one hands it over. */
  freshPhases?: readonly Phase[];
  /** The agent's working folder (default: this process's cwd, which the CLI sets to the agent's project or worktree). */
  workdir?: string;
  /** Started by a runner (AGENT_NETWORK_RUNNER=1): on a BLOCKED task the session ends instead of waiting; the runner waits without a model. */
  underRunner?: boolean;
}

export class Swarm {
  private registered?: Promise<unknown>;
  private shownMessages: { taskId: string; id: string }[] = [];
  private shownAgreement = new Map<string, number>();
  /** Tasks whose description this session has already shown (it stays in the agent's context). */
  private shownDescription = new Set<string>();
  /** taskId -> phaseHistory length when this session first saw the task; later phases are new to it. */
  private firstSeenEpoch = new Map<string, number>();
  /** "taskId@epoch" whose handoff marker is written. */
  private markedHandoff = "";
  private readonly freshPhases: readonly Phase[];
  private readonly workdir: string;
  private readonly underRunner: boolean;
  /** Git context of the working folder, read once per session. */
  private workGit?: Promise<GitContext | null>;
  readonly defaultWaitMs: number;

  constructor(
    private readonly service: NetworkService,
    private readonly log: (m: string) => void = () => undefined,
    opts: SwarmOptions = {},
  ) {
    this.defaultWaitMs = Math.min(Math.max(opts.defaultWaitMs ?? DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);
    this.freshPhases = opts.freshPhases ?? [];
    this.workdir = opts.workdir ?? process.cwd();
    this.underRunner = opts.underRunner ?? false;
  }

  private get me(): string {
    return this.service.me;
  }

  // ------------------------------------------------------------------ tools

  /** Safe to call at any time: read-only (it does not mark messages as read). */
  async context(input: { full?: boolean } = {}): Promise<SwarmContext> {
    await this.begin(false);
    return this.contextNow(input.full === true);
  }

  /**
   * An agent starts a task on the user's request. Guards against junk tasks: only when the agent has no
   * active task, the description must be substantial, and every agent must already be registered.
   * The creator becomes the lead (first in the list).
   */
  async createTask(input: { title?: string; description?: string; agents?: string[]; verifyCommand?: string }): Promise<SwarmContext> {
    await this.begin(true);
    const registered = (await this.service.agents.list()).map((a) => a.id).filter((id) => id !== this.me);
    const known = { registeredAgents: registered }; // other agents you can put in 'agents'
    const active = (await this.service.tasks.listForAgent(this.me)).find((t) => t.status === "ACTIVE" || t.status === "BLOCKED");
    if (active) {
      throw new AppError("HAS_ACTIVE_TASK", `You already have an active task (${active.id}: ${active.title}). Finish it before creating another one.`, { taskId: active.id });
    }
    if (!input.title?.trim()) throw invalid("'title' is required", known);
    if ((input.description ?? "").trim().length < MIN_DESCRIPTION) {
      throw invalid(`'description' must say concretely what to build (at least ${MIN_DESCRIPTION} characters): the problem, expected behaviour, files, who does what. Use the user's own words; do not invent scope.`, known);
    }
    const others = [...new Set((input.agents ?? []).map((a) => a.trim()).filter((a) => a && a !== this.me))];
    if (others.length < 1) throw invalid("'agents' must list at least one OTHER agent (you are added automatically as lead)", known);
    const unknown = others.filter((a) => !registered.includes(a));
    if (unknown.length) {
      throw new AppError("AGENT_NOT_REGISTERED", `Not registered (not started yet or misspelled): ${unknown.join(", ")}. Use only registered agents.`, known);
    }
    const task = await this.service.createTask({ title: input.title, description: input.description!, agents: [this.me, ...others], verifyCommand: input.verifyCommand });
    return { ...(await this.contextNow()), ok: true, action: "TASK_CREATED", taskId: task.id } as SwarmContext;
  }

  /** The agent's own checklist for its part. Compact answer: it is called after every step. */
  async subtasks(input: { add?: string[]; start?: string; done?: string[]; drop?: { id: string; reason: string }[] }): Promise<SwarmContext> {
    await this.begin(false); // a checklist update does not count as reading the messages shown earlier
    const task = await this.requireTask();
    const list = await this.service.updateSubtasks({ taskId: task.id, ...input });
    const snap = await this.snapshot(task);
    const d = this.decide(snap);
    const open = list.items.filter((i) => i.status === "TODO" || i.status === "DOING");
    return {
      ok: true,
      action: "SUBTASKS_UPDATED",
      subtasks: list.items.map((i) => ({ id: i.id, title: i.title, status: i.status, ...(i.note ? { note: i.note } : {}) })),
      progress: progress(list) ?? "no subtasks",
      ...(snap.unread.length ? { unreadMessages: snap.unread.length } : {}),
      nextAction: d.nextAction,
      allowedActions: d.allowedActions,
      hint:
        (open.length ? `Open: ${open.map((i) => `${i.id}${i.status === "DOING" ? " (doing)" : ""}`).join(", ")}. ` : "All subtasks are closed. ") +
        (snap.unread.length ? `You have ${snap.unread.length} unread message(s): call swarm_context. ` : "") +
        d.hint,
    };
  }

  async sendMessage(input: { to?: string; message?: string; requestFiles?: string[]; grantFiles?: string[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const others = task.agents.filter((a) => a !== this.me);
    const recipients = [...others, OPERATOR];
    if (!input.to?.trim()) throw invalid("'to' is required", { validRecipients: recipients });
    if (!input.message?.trim()) throw invalid("'message' must not be empty");
    if (input.to === OPERATOR) {
      if (input.requestFiles?.length || input.grantFiles?.length) throw invalid("The operator owns no files: requestFiles/grantFiles go to agents. Ask the operator a plain question.");
      const asked = await this.service.sendMessage({ taskId: task.id, to: OPERATOR, type: "QUESTION", content: input.message });
      return {
        ...(await this.contextNow()), ok: true, action: "QUESTION_SENT", messageId: asked.id,
        note: "The operator (a human) answers on the network page; the answer arrives in pendingMessages. If you cannot go on without it, call wait(); otherwise continue with the work that does not depend on it.",
      } as SwarmContext;
    }
    if (!others.includes(input.to)) {
      throw new AppError("NOT_ASSIGNED", `'${input.to}' is not another agent of ${task.id}`, { validRecipients: recipients });
    }
    if (input.requestFiles?.length && input.grantFiles?.length) throw invalid("Use either requestFiles or grantFiles in one message, not both");

    if (input.grantFiles?.length) {
      const granted = await this.service.grantFiles({ taskId: task.id, to: input.to, files: input.grantFiles, message: input.message });
      return { ...(await this.contextNow()), ok: true, action: "FILES_GRANTED", messageId: granted.message.id, granted: granted.files } as SwarmContext;
    }

    let type: "INFORMATION" | "FILE_REQUEST" = "INFORMATION";
    let files: string[] | undefined;
    if (input.requestFiles?.length) {
      const own = await this.service.ownership(task.id);
      if (!own.declared) throw new AppError("AGREEMENT_NOT_READY", "File ownership is not agreed yet. Declare files in the agreement (propose) first.");
      const wanted = [...new Set(input.requestFiles.map((f) => normalizePath(f)))];
      const owners = Object.fromEntries(wanted.map((f) => [f, ownersOf(f, own.assignments)]));
      files = wanted.filter((f) => owners[f]!.includes(input.to!) && !owners[f]!.includes(this.me));
      if (!files.length) {
        throw invalid(`'${input.to}' does not own any of these files (owners: ${wanted.map((f) => `${f} -> ${owners[f]!.join("/") || "nobody"}`).join(", ")}). Ask the actual owner, or just change files nobody owns.`, { owners });
      }
      type = "FILE_REQUEST";
    }
    const sent = await this.service.sendMessage({ taskId: task.id, to: input.to, type, content: input.message, ...(files ? { files } : {}) });
    return { ...(await this.contextNow()), ok: true, action: type === "FILE_REQUEST" ? "FILES_REQUESTED" : "MESSAGE_SENT", messageId: sent.id,
      ...(files ? { requested: files, note: `Asked ${input.to} for permission to CHANGE these files (reading needs no permission). Continue with your own work; the answer arrives in pendingMessages. Do not edit them before the grant.` } : {}) } as SwarmContext;
  }

  async propose(input: { summary?: string; assignments?: { agentId: string; responsibility: string; files?: string[]; tasks?: string[] }[]; decisions?: string[]; interfaces?: string[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    if (task.phase !== "DISCUSS") {
      throw new AppError("INVALID_PHASE", `propose is only available during DISCUSS (task is in ${task.phase}).`);
    }
    if (!input.summary?.trim()) throw invalid("'summary' is required", { taskAgents: task.agents });
    if (!input.assignments?.length) {
      throw invalid(`'assignments' is required: one entry {agentId, responsibility} for every agent: ${task.agents.join(", ")}`, { taskAgents: task.agents });
    }
    const noFiles = input.assignments.filter((a) => !Array.isArray(a.files)).map((a) => a.agentId);
    if (noFiles.length) {
      throw invalid(`Every assignment needs 'files': the files (paths or globs like src/main/**) that agent will change. Missing for: ${noFiles.join(", ")}. Agree on this with the other agents first (send_message); every file must have exactly one owner. Use 'files: []' for an agent that changes nothing and only reviews the others' work; never invent a file for it.`, { taskAgents: task.agents });
    }
    if (input.assignments.every((a) => a.files!.length === 0)) {
      throw invalid("At least one agent must own files: someone has to make the change. 'files: []' is only for agents that review the others' work.", { taskAgents: task.agents });
    }
    const res = await this.service.proposeAgreement({
      taskId: task.id,
      summary: input.summary,
      assignments: input.assignments,
      decisions: input.decisions,
      interfaces: input.interfaces,
    });
    return { ...(await this.contextNow()), ok: true, action: "AGREEMENT_PROPOSED", agreementVersion: res.agreement.version } as SwarmContext;
  }

  async complete(input: { result?: string; filesChanged?: string[]; commits?: string[]; tasksDone?: string[]; status?: string; findings?: RawFinding[]; followUps?: FollowUpRequest[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const given = (keys: (keyof typeof input)[]) => keys.filter((k) => input[k] !== undefined);
    let action: string;
    let warnings: string[] | undefined;
    let followUpsCreated: { id: string; title: string; agents: string[] }[] | undefined;

    switch (task.phase) {
      case "DISCUSS": {
        const extra = given(["result", "filesChanged", "commits", "tasksDone", "status", "findings", "followUps"]);
        if (extra.length) throw invalid(`During DISCUSS complete() takes no arguments (it approves the agreement); got: ${extra.join(", ")}`);
        action = await this.approve(task);
        break;
      }
      case "IMPLEMENT": {
        const extra = given(["status", "findings", "followUps"]);
        if (extra.length) throw invalid(`During IMPLEMENT complete() takes {result, filesChanged?, commits?, tasksDone?}; got unexpected: ${extra.join(", ")}`);
        if (!input.result?.trim()) throw invalid("complete() during IMPLEMENT requires 'result': a short summary of what you implemented");
        const existing = await this.service.implementations.find(task.id, this.me);
        if (!existing) await this.service.startImplementation(task.id);
        const unreported = input.commits?.length ? undefined : await this.unreportedWork(task, existing?.commits ?? []);
        const commits = unreported?.head ? [unreported.head] : input.commits;
        const done = await this.service.completeImplementation({ taskId: task.id, summary: input.result, filesChanged: input.filesChanged, commits, tasksDone: input.tasksDone });
        warnings = [...(done.warnings ?? []), ...(unreported ? [unreported.note] : [])];
        action = "IMPLEMENTATION_COMPLETED";
        break;
      }
      case "SYNC": {
        const extra = given(["result", "filesChanged", "commits", "tasksDone", "followUps"]);
        if (extra.length) throw invalid(`During SYNC complete() takes {status, findings?}; got unexpected: ${extra.join(", ")}`);
        if (input.status !== "PASS" && input.status !== "NEEDS_FIX") {
          throw invalid("complete() during SYNC requires 'status': \"PASS\" or \"NEEDS_FIX\" (with 'findings')");
        }
        await this.service.submitSync({ taskId: task.id, status: input.status, findings: this.findings(input.findings) });
        action = input.status === "PASS" ? "SYNC_PASS" : "SYNC_NEEDS_FIX";
        break;
      }
      case "INTEGRATE": {
        const extra = given(["filesChanged", "tasksDone"]);
        if (extra.length) throw invalid(`During INTEGRATE complete() takes {status, result, commits?, findings?, followUps?}; got unexpected: ${extra.join(", ")}`);
        if (input.status !== "PASS" && input.status !== "NEEDS_FIX") {
          throw invalid("complete() during INTEGRATE requires 'status': \"PASS\" (merged, build and tests green) or \"NEEDS_FIX\" (with 'findings')");
        }
        if (!input.result?.trim()) throw invalid("complete() during INTEGRATE requires 'result': what you merged, where the result is, and the build/test outcome");
        const res = await this.service.submitIntegration({ taskId: task.id, status: input.status, result: input.result, commits: input.commits, findings: this.findings(input.findings), followUps: input.followUps });
        action = input.status === "PASS" ? "INTEGRATION_PASS" : "INTEGRATION_NEEDS_FIX";
        if (res.followUps.length) followUpsCreated = res.followUps.map((t) => ({ id: t.id, title: t.title, agents: t.agents }));
        break;
      }
      case "DONE":
        throw new AppError("INVALID_PHASE", "The task is already DONE; there is nothing to complete.");
    }
    const after = await this.contextNow();
    const phaseChanged = (after.task as { phase: string } | null)?.phase !== task.phase ? { from: task.phase, to: (after.task as { phase: string }).phase } : undefined;
    return { ...after, ok: true, action, ...(phaseChanged ? { phaseChanged } : {}), ...(warnings?.length ? { warnings } : {}), ...(followUpsCreated ? { followUpsCreated } : {}) } as SwarmContext;
  }

  private findings(raw: RawFinding[] | undefined): SyncFinding[] {
    return (raw ?? []).map((f): SyncFinding => {
      if (!(SEVERITIES as readonly string[]).includes(f.severity)) throw invalid(`finding.severity must be one of ${SEVERITIES.join(", ")}`);
      if (!f.description?.trim()) throw invalid("every finding needs a 'description'");
      return f as SyncFinding;
    });
  }

  /**
   * Blocks until the agent has something to do (messages, an action required, task done) or the
   * timeout expires. Returns immediately if something is already pending, so it can never deadlock
   * an agent that still has work.
   */
  async wait(input: { timeoutMs?: number }, signal?: AbortSignal): Promise<SwarmContext> {
    await this.begin(true);
    const deadline = Date.now() + Math.min(Math.max(input.timeoutMs ?? this.defaultWaitMs, 0), MAX_WAIT_MS);
    let entry: string | undefined;
    for (;;) {
      const ctx = await this.contextNow();
      const signature = this.signature(ctx);
      entry ??= signature;
      if ((ctx.pendingMessages as unknown[]).length > 0) return { ...ctx, status: "MESSAGES" } as SwarmContext;
      if (ctx.nextAction === "done") return { ...ctx, status: "DONE" } as SwarmContext;
      if (ctx.nextAction !== "wait") return { ...ctx, status: "ACTION_REQUIRED" } as SwarmContext;
      if (signature !== entry) return { ...ctx, status: "UPDATED" } as SwarmContext; // new task or phase change the agent should know about
      const left = deadline - Date.now();
      if (left <= 0 || signal?.aborted) return this.compact(ctx, "TIMEOUT");
      // Consumes at most one event; the loop re-reads the (filesystem) state to decide whether it matters.
      await this.service.waitForEvent({ timeoutMs: left }, signal);
    }
  }

  private signature(ctx: SwarmContext): string {
    const t = ctx.task as { id: string; phase: string; syncRound: number; status: string } | null;
    return t ? `${t.id}:${t.phase}:${t.syncRound}:${t.status}` : "none";
  }

  /** Nothing changed while waiting: repeat only what the agent needs to call wait() again, not the whole context. */
  private compact(ctx: SwarmContext, status: string): SwarmContext {
    const t = ctx.task as { id: string; phase: string; status: string; syncRound: number } | null;
    return {
      status,
      task: t ? { id: t.id, phase: t.phase, status: t.status, syncRound: t.syncRound } : null,
      pendingMessages: [],
      waitingOn: ctx.waitingOn,
      allowedActions: ctx.allowedActions,
      nextAction: ctx.nextAction,
      hint: `Nothing changed. ${ctx.hint as string} Call wait() again; call swarm_context if you need the full state.`,
    };
  }

  // ------------------------------------------------------------------ errors

  /** Error body for LLM consumption: code, message, current state, nextAction (+ pending / allowedActions). */
  async errorBody(e: unknown): Promise<Record<string, unknown>> {
    const known = isAppError(e);
    if (!known) this.log(`internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    const body: Record<string, unknown> = {
      error: known ? e.code : "INTERNAL_ERROR",
      message: known ? e.message : "Internal error. Call swarm_context to re-read the state, then retry.",
    };
    try {
      const task = await this.currentTask();
      if (task) {
        const d = this.decide(await this.snapshot(task));
        Object.assign(body, { currentPhase: task.phase, status: task.status, taskId: task.id, nextAction: d.nextAction, allowedActions: d.allowedActions });
        if (d.waitingOn.length) body.pending = d.waitingOn;
      } else {
        Object.assign(body, { currentPhase: null, nextAction: "wait", allowedActions: ["create_task", "wait"] });
      }
    } catch {
      body.nextAction = "wait";
    }
    if (known && e.details) Object.assign(body, e.details);
    return body;
  }

  // ------------------------------------------------------------------ internals

  private async begin(acknowledge: boolean): Promise<void> {
    this.registered ??= this.service.registerAgent().catch((e: unknown) => {
      this.registered = undefined;
      throw e;
    });
    await this.registered;
    await this.service.heartbeat().catch(() => undefined);
    if (acknowledge) await this.acknowledgeShownMessages();
  }

  /** Messages shown in an earlier response count as read once the agent acts (or waits) again. */
  private async acknowledgeShownMessages(): Promise<void> {
    const shown = this.shownMessages.splice(0);
    for (const m of shown) {
      await this.service.messages.find(m.taskId, m.id).then((msg) => (msg && msg.to === this.me ? this.service.messages.markRead(msg) : undefined)).catch(() => undefined);
    }
  }

  /** Oldest unfinished (ACTIVE or BLOCKED) task of this agent; otherwise the latest finished one; otherwise none. */
  private async currentTask(): Promise<Task | null> {
    const tasks = (await this.service.tasks.listForAgent(this.me)).filter((t) => t.status !== "CANCELLED");
    return tasks.find((t) => t.status === "ACTIVE" || t.status === "BLOCKED") ?? tasks.at(-1) ?? null;
  }

  private async requireTask(): Promise<Task> {
    const task = await this.currentTask();
    if (!task) throw new AppError(
        "NO_ACTIVE_TASK",
        `No task is assigned to you (agent '${this.me}') in ${this.service.networkDir}. Do NOT call propose, complete or send_message now. Call wait() until a task appears, or create_task if the USER asked you to start one. If a task should exist, tell the user: it may have been created in a different network directory or for different agent names.`,
        { agentId: this.me, networkDir: this.service.networkDir },
      );
    return task;
  }

  private async snapshot(task: Task): Promise<Snapshot> {
    const [agreement, impls, reports, integrations, agents, messages] = await Promise.all([
      this.service.agreements.find(task.id),
      this.service.implementations.list(task.id),
      this.service.syncs.list(task.id, task.syncRound),
      this.service.integrations.list(task.id, task.syncRound),
      this.service.agents.list(),
      this.service.messages.list(task.id),
    ]);
    const open = openFileRequests(messages);
    const subtasks = await Promise.all(task.agents.map((a) => this.service.subtasks.get(task.id, a)));
    return {
      task, agreement, impls, reports, integrations, agents, subtasks,
      unread: messages.filter((m) => m.to === this.me && !m.readAt),
      openToMe: open.filter((m) => m.to === this.me),
      openFromMe: open.filter((m) => m.from === this.me),
      myQuestions: messages.filter((m) => m.from === this.me && m.to === OPERATOR && !m.readAt),
      ...(task.phase === "INTEGRATE" ? { followUpBudget: await this.service.followUpBudget(task) } : {}),
      handoff: await this.handoffPhase(task),
      ...(task.phase === "SYNC" && task.syncRound > 1 ? { fixedFindings: await this.fixedFindings(task) } : {}),
      ...(task.phase === "IMPLEMENT" ? { ownBranch: await this.ownBranch(task) } : {}),
      ...(task.phase === "SYNC" ? { missingCommits: await this.missingCommits(task, impls) } : {}),
      ...(task.openspec && task.phase !== "DONE" ? await this.readOpenspec(task.openspec.change) : {}),
    };
  }

  private async readOpenspec(name: string): Promise<{ change: ChangeInfo | null; changeError?: string }> {
    try {
      return { change: await readChange(this.service.projectDir, name) };
    } catch (e) {
      return { change: null, changeError: isAppError(e) ? e.message : String(e) };
    }
  }

  /**
   * OpenSpec task: DISCUSS gets every task of tasks.md (the split), IMPLEMENT the agent's own tasks, the integrating lead
   * the open ones with who took them and who reported them done.
   */
  private openspecView(s: Snapshot, full: boolean): Record<string, unknown> {
    const { task } = s;
    if (!task.openspec || (task.phase === "DONE" && !full)) return {};
    const base = { change: task.openspec.change, path: changePath(task.openspec.change) };
    const c = s.change;
    if (!c) return { openspec: { ...base, ...(s.changeError ? { error: s.changeError } : {}) } };
    const owner = new Map((s.agreement?.assignments ?? []).flatMap((a) => (a.tasks ?? []).map((id) => [id, a.agentId] as const)));
    const reported = new Set(s.impls.flatMap((i) => i.tasksDone ?? []));
    const mine = s.agreement?.assignments.find((a) => a.agentId === this.me)?.tasks ?? [];
    if (full) {
      return { openspec: { ...base, files: c.files, tasks: c.tasks.map((t) => ({ id: t.id, text: t.text, done: t.done, owner: owner.get(t.id) ?? null, reportedDone: reported.has(t.id) })) } };
    }
    switch (task.phase) {
      case "DISCUSS":
        return { openspec: { ...base, files: c.files, tasks: c.tasks.map((t) => ({ id: t.id, text: t.text.length > 100 ? `${t.text.slice(0, 100)}…` : t.text, ...(t.done ? { done: true } : {}) })) } };
      case "IMPLEMENT":
        return { openspec: { ...base, yourTasks: c.tasks.filter((t) => mine.includes(t.id)).map((t) => ({ id: t.id, text: t.text })) } };
      case "INTEGRATE":
        if (this.service.phases.integrator(task) !== this.me) return { openspec: base };
        return { openspec: { ...base, tasks: c.tasks.filter((t) => !t.done).map((t) => ({ id: t.id, owner: owner.get(t.id) ?? null, reportedDone: reported.has(t.id) })) } };
      default:
        return { openspec: base };
    }
  }

  /**
   * SYNC: the reviewees' reported commits that this session's branch does not contain. Without them the reviewer reads
   * and tests an older copy of their files (e.g. one it merged in an earlier round) and reports fixed problems again.
   */
  private async missingCommits(task: Task, impls: Implementation[]): Promise<Record<string, string[]>> {
    this.workGit ??= readGitContext(this.workdir).catch(() => null);
    if (!(await this.workGit)) return {};
    const targets = this.service.phases.reviewees(task).filter((a) => a !== this.me);
    const missing: Record<string, string[]> = {};
    for (const i of impls) {
      if (!targets.includes(i.agentId)) continue;
      const absent: string[] = [];
      for (const c of i.commits ?? []) if ((await containsCommit(this.workdir, c)) === false) absent.push(c); // null: git cannot tell
      if (absent.length) missing[i.agentId] = absent;
    }
    return missing;
  }

  /**
   * The agent's branch when it works apart from the checkout the task was created in (its own worktree or branch).
   * Its uncommitted changes are invisible to the reviewers and the lead there, so it has to commit before complete().
   */
  private async ownBranch(task: Task): Promise<string | null> {
    if (!task.git) return null;
    this.workGit ??= readGitContext(this.workdir).catch(() => null);
    const mine = await this.workGit;
    if (!mine || mine.branch === "HEAD") return null; // not a repository, or a detached HEAD
    return mine.repositoryRoot !== task.git.repositoryRoot || mine.branch !== task.git.branch ? mine.branch : null;
  }

  /**
   * The phase to hand over to a fresh session: the task entered a fresh phase after this session first saw it. A session
   * that first sees the task in that phase is the fresh one and keeps it. The marker lets the Stop hook release the session.
   */
  private async handoffPhase(task: Task): Promise<Phase | null> {
    const epoch = phaseEpoch(task);
    if (epoch === undefined) return null; // created before phaseHistory existed
    const first = this.firstSeenEpoch.get(task.id) ?? epoch;
    this.firstSeenEpoch.set(task.id, first);
    if (task.status !== "ACTIVE" || !this.freshPhases.includes(task.phase) || epoch <= first) return null;
    const key = `${task.id}@${epoch}`;
    if (this.markedHandoff !== key) {
      try {
        await this.service.markHandoff(task.id, epoch);
        this.markedHandoff = key;
      } catch (e) {
        this.log(`cannot write the handoff marker: ${(e as Error).message}`); // the Stop hook then asks once more; harmless
      }
    }
    return task.phase;
  }

  /**
   * complete() in IMPLEMENT without commits, by an agent on its own branch: the reviewers and the lead see only committed
   * work there, and agents often commit and then forget the hash. Records the branch head (read now, not the cached
   * context) and says so; warns when nothing new is committed. Nothing for an agent in the task's checkout or a review-only one.
   */
  private async unreportedWork(task: Task, reported: string[]): Promise<{ head?: string; note: string } | undefined> {
    const branch = await this.ownBranch(task);
    if (!branch || !task.git || (await this.service.ownership(task.id)).reviewOnly) return undefined;
    const head = (await readGitContext(this.workdir).catch(() => null))?.commit;
    if (!head) return undefined;
    if (head === (task.baseCommit ?? task.git.commit)) {
      return { note: `Your branch ${branch} has no commits since the task started, so the reviewers and the lead cannot see your changes: commit them and send the hash to the others (send_message).` };
    }
    if (task.syncRound > 0 && reported.includes(head)) {
      return { head, note: `Your branch ${branch} has no new commits since your last report, so the reviewers will see the old version: commit your fix and send the hash to the others (send_message).` };
    }
    return { head, note: `You reported no commits: recorded the head of your branch ${branch} (${head}) so the reviewers and the lead can find your work.` };
  }

  /** What the previous round asked the agents under review to fix, in the reviewers' words. */
  private async fixedFindings(task: Task): Promise<(SyncFinding & { reportedBy: string })[]> {
    const round = task.syncRound - 1;
    const under = this.service.phases.reviewees(task);
    const [syncs, integrations] = await Promise.all([this.service.syncs.list(task.id, round), this.service.integrations.list(task.id, round)]);
    return [...syncs, ...integrations]
      .filter((r) => r.status === "NEEDS_FIX")
      .flatMap((r) => r.findings.filter((f) => f.severity === "ERROR" && (!f.relatedAgent || under.includes(f.relatedAgent))).map((f) => ({ ...f, reportedBy: r.agentId })));
  }

  /**
   * The state an agent needs for its next step. Compact by default: only what the current phase uses, no empty fields,
   * the task description once per session (it stays in the agent's context). `full` returns everything.
   */
  private async contextNow(full = false): Promise<SwarmContext> {
    const me = (await this.service.agents.get(this.me))!;
    const agent = full ? { id: this.me, role: me.role ?? null, type: me.type } : { id: this.me };
    const task = await this.currentTask();
    if (!task) {
      return {
        task: null,
        agent,
        pendingMessages: [],
        registeredAgents: (await this.service.agents.list()).map((a) => a.id).filter((id) => id !== this.me),
        allowedActions: ["create_task", "wait"],
        nextAction: "wait",
        hint: `No task for '${this.me}' in ${this.service.networkDir}. Call wait(); create_task only when the user asked for a task. A task created for other agent names or in another network directory does not reach you.`,
        networkDir: this.service.networkDir,
      };
    }
    const snap = await this.snapshot(task);
    const d = this.decide(snap);
    if (d.handoff) {
      // nothing else: messages stay unread for the fresh session, and nothing here should tempt this one to go on
      return {
        task: { id: task.id, title: task.title, phase: task.phase, status: task.status },
        agent,
        handoff: { phase: d.handoff },
        pendingMessages: [],
        allowedActions: d.allowedActions,
        nextAction: d.nextAction,
        hint: d.hint,
      };
    }
    const { agreement, impls, reports, integrations, agents, unread, openToMe, openFromMe, subtasks } = snap;
    const listOf = (id: string) => subtasks.find((l) => l.agentId === id);
    const mySubtasks = listOf(this.me)?.items ?? [];
    const phases = this.service.phases;
    const phase = task.phase;
    const show = (p: Phase[]) => full || p.includes(phase);

    // remember what the agent has actually seen
    for (const m of unread) if (!this.shownMessages.some((s) => s.id === m.id && s.taskId === task.id)) this.shownMessages.push({ taskId: task.id, id: m.id });
    if (agreement) this.shownAgreement.set(task.id, agreement.version);
    const describe = full || phase === "DISCUSS" || !this.shownDescription.has(task.id);
    this.shownDescription.add(task.id);

    const mine = impls.find((i) => i.agentId === this.me) ?? null;
    // after a failed review or integration the round's reports explain what to fix
    const fixRequests =
      phase === "IMPLEMENT" && task.syncRound > 0
        ? [...reports, ...integrations]
            .filter((r) => r.status === "NEEDS_FIX")
            .flatMap((r) => r.findings.map((f) => ({ ...f, reportedBy: r.agentId, forYou: !f.relatedAgent || f.relatedAgent === this.me })))
        : [];
    const integration = integrations.at(-1);
    const nonEmpty = <T>(key: string, list: T[]) => (list.length ? { [key]: list } : {});
    const myAssignment = agreement?.assignments.find((a) => a.agentId === this.me);

    const agreementView = !agreement
      ? {}
      : full || phase === "DISCUSS"
        ? { agreement: { version: agreement.version, proposedBy: agreement.proposedBy, summary: agreement.summary, assignments: agreement.assignments, ...nonEmpty("decisions", agreement.decisions), ...nonEmpty("interfaces", agreement.interfaces), approvedBy: agreement.approvedBy } }
        : phase === "IMPLEMENT"
          ? { agreement: { summary: agreement.summary, ...nonEmpty("decisions", agreement.decisions), ...nonEmpty("interfaces", agreement.interfaces) } }
          : phase === "SYNC"
            ? { agreement: { summary: agreement.summary, ...nonEmpty("decisions", agreement.decisions), ...nonEmpty("interfaces", agreement.interfaces), assignments: agreement.assignments.map((a) => ({ agentId: a.agentId, responsibility: a.responsibility })) } }
            : phase === "INTEGRATE"
              ? { agreement: { summary: agreement.summary } }
              : {};

    return {
      task: {
        id: task.id, title: task.title, ...(describe ? { description: task.description } : {}), phase, status: task.status, agents: task.agents, lead: phases.integrator(task),
        ...(task.syncRound > 0 || full ? { syncRound: task.syncRound, maxFixRounds: phases.maxFixRounds(task) } : {}),
        ...(task.verifyCommand ? { verifyCommand: task.verifyCommand } : {}),
        ...(task.blockedReason ? { blockedReason: task.blockedReason } : {}),
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(task.baseCommit ? { baseCommit: task.baseCommit } : {}),
      },
      agent,
      ...(myAssignment ? { assignment: { responsibility: myAssignment.responsibility } } : {}),
      ...this.openspecView(snap, full),
      otherAgents: task.agents
        .filter((id) => id !== this.me)
        .map((id) => {
          const a = agents.find((x) => x.id === id);
          const p = progress(listOf(id));
          return { id, ...(full || (a?.role && a.role !== id) ? { role: a?.role ?? null } : {}), status: a?.status ?? "NOT_REGISTERED", ...(p ? { subtasks: p } : {}) };
        }),
      pendingMessages: unread.map((m) => ({ id: m.id, from: m.from, type: m.type, ...(m.files ? { files: m.files } : {}), content: m.content, ...(full ? { createdAt: m.createdAt } : {}) })),
      ...agreementView,
      ...(openToMe.length ? { openFileRequests: openToMe.map((m) => ({ messageId: m.id, from: m.from, files: m.files ?? [], reason: m.content })) } : {}),
      ...(snap.myQuestions.length ? { questionsToOperator: snap.myQuestions.map((m) => ({ messageId: m.id, question: m.content })) } : {}),
      ...(openFromMe.length ? { yourOpenRequests: openFromMe.map((m) => ({ messageId: m.id, to: m.to, files: m.files ?? [] })) } : {}),
      ...(show(["IMPLEMENT"]) ? await this.ownershipView(task.id) : {}),
      ...(show(["IMPLEMENT"]) && mySubtasks.length ? { subtasks: mySubtasks.map((i) => ({ id: i.id, title: i.title, status: i.status, ...(i.note ? { note: i.note } : {}) })) } : {}),
      ...(mine && (full || phase === "IMPLEMENT") ? { implementation: full ? { status: mine.status, summary: mine.summary, filesChanged: mine.filesChanged, commits: mine.commits, ...nonEmpty("tasksDone", mine.tasksDone ?? []) } : { status: mine.status } } : {}),
      ...(show(["SYNC", "INTEGRATE"])
        ? {
            teamImplementations: impls.filter((i) => i.agentId !== this.me).map((i) => {
              const steps = listOf(i.agentId)?.items ?? [];
              // in SYNC the reviewer judges the code, not its author's account of it (also with full: weak models ask for it first)
              return { agentId: i.agentId, status: i.status, ...(phase !== "SYNC" ? { summary: i.summary } : {}), filesChanged: i.filesChanged, ...nonEmpty("commits", i.commits), ...nonEmpty("tasksDone", i.tasksDone ?? []), ...nonEmpty("notInYourBranch", snap.missingCommits?.[i.agentId] ?? []), ...(steps.length ? { subtasks: steps.map((st) => `${st.id} [${st.status}] ${st.title}${st.note ? ` (${st.note})` : ""}`) } : {}) };
            }),
          }
        : {}),
      ...(phase === "SYNC" ? { reviewTargets: phases.reviewees(task).filter((a) => a !== this.me) } : {}),
      ...(snap.fixedFindings?.length ? { fixedFindings: snap.fixedFindings } : {}),
      ...(full && phase === "SYNC" ? { syncReports: reports.map((r) => ({ agentId: r.agentId, status: r.status, findings: r.findings })) } : {}),
      ...(full && integration ? { integration: { status: integration.status, result: integration.result, commits: integration.commits, findings: integration.findings } } : {}),
      ...(fixRequests.length ? { fixRequests } : {}),
      ...(phase === "INTEGRATE" && snap.followUpBudget && phases.integrator(task) === this.me
        ? {
            followUps: {
              ...snap.followUpBudget,
              notes: reports.flatMap((r) => r.findings.filter((f) => f.severity !== "ERROR").map((f) => ({ ...f, reportedBy: r.agentId }))),
            },
          }
        : {}),
      ...(d.nextAction === "wait" || full ? { waitingOn: d.waitingOn } : {}),
      allowedActions: d.allowedActions,
      nextAction: d.nextAction,
      hint: d.hint,
      ...(d.exampleCall ? { exampleCall: d.exampleCall } : {}),
    };
  }

  private async ownershipView(taskId: string): Promise<Record<string, unknown>> {
    const own = await this.service.ownership(taskId);
    if (!own.declared) return {};
    return {
      ownership: {
        yourFiles: own.yours,
        ...(own.reviewOnly ? { reviewOnly: true } : {}),
        othersFiles: own.assignments.filter((a) => a.agentId !== this.me && a.files?.length).map((a) => ({ agentId: a.agentId, files: a.files ?? [] })),
        ...(own.grantedToYou.length ? { grantedToYou: own.grantedToYou } : {}),
        ...(own.grantedByYou.length ? { grantedByYou: own.grantedByYou } : {}),
      },
    };
  }

  /** The decision table: phase + my own progress -> nextAction / allowedActions. */
  decide(s: Snapshot): Decision {
    if (s.handoff) {
      return {
        nextAction: "done",
        allowedActions: [],
        hint: `The task entered ${s.handoff}, which a fresh session does: end your session now, with no more tool calls. The runner starts a new session that works only from the task, the agreement and the code.`,
        waitingOn: [],
        handoff: s.handoff,
      };
    }
    const core = this.decideCore(s);
    // an unanswered request for one of my files blocks another agent: answering it comes first
    const req = s.openToMe[0];
    if (req && s.task.phase !== "DONE") {
      const files = req.files ?? [];
      return {
        nextAction: "respond",
        allowedActions: [...new Set(["send_message", ...core.allowedActions])],
        hint:
          `${req.from} waits for your answer (${req.id}): it wants to change your files ${files.join(", ")}. Answer first, then continue: ` +
          `send_message({to: "${req.from}", message, grantFiles: [...]}) allows it, a plain message with the reason refuses it.` +
          (s.openToMe.length > 1 ? ` ${s.openToMe.length - 1} more request(s) in openFileRequests.` : ""),
        waitingOn: core.waitingOn,
        exampleCall: { tool: "send_message", args: { to: req.from, message: "<conditions, or the reason for refusing>", grantFiles: files } },
      };
    }
    let d = core;
    const asked = s.myQuestions[0];
    if (asked && s.task.phase !== "DONE") {
      const waitingOn = [...new Set([...core.waitingOn, OPERATOR])];
      const what = `Your question to the operator (${asked.id}) has no answer yet.`;
      d =
        core.nextAction === "propose" || core.nextAction === "approve"
          ? { nextAction: "wait", allowedActions: [...new Set(["wait", ...core.allowedActions])], hint: `${what} Call wait(): the answer arrives in pendingMessages; propose or approve after it.`, waitingOn }
          : { ...core, hint: `${what} Continue with what does not depend on it. ${core.hint}`, waitingOn };
    }
    const example = this.example(s.task, d.nextAction);
    return example ? { ...d, exampleCall: example } : d;
  }

  /** A ready-to-copy call where the arguments have structure (the agreement); simpler calls are spelled out in the hint. */
  private example(task: Task, next: NextAction): Decision["exampleCall"] {
    if (next !== "propose") return undefined;
    const tasks = task.openspec ? { tasks: ["<tasks.md numbers this agent implements; [] = review only>"] } : {};
    return { tool: "propose", args: { summary: "<what the team will build>", assignments: task.agents.map((agentId) => ({ agentId, responsibility: "<what this agent does>", files: ["<files or globs it changes; [] = review only>"], ...tasks })) } };
  }

  private decideCore(s: Snapshot): Decision {
    const { task, agreement, impls, reports } = s;
    const mine = impls.find((i) => i.agentId === this.me);
    const lead = task.agents[0];
    const done = (nextAction: NextAction, allowed: string[], hint: string, waitingOn: string[]): Decision => ({ nextAction, allowedActions: allowed, hint, waitingOn });

    if (task.status === "BLOCKED") {
      const why = `BLOCKED: ${task.blockedReason ?? "the fix-round limit was reached"}. The operator decides`;
      return this.underRunner
        ? done("done", [], `${why}: end your session now; the runner starts a new one when the task is unblocked.`, [])
        : done("wait", ["send_message", "wait"], `${why}; call wait().`, ["operator"]);
    }
    const phases = this.service.phases;
    const spec = task.openspec ? changePath(task.openspec.change) : null;
    switch (task.phase) {
      case "DISCUSS": {
        if (!agreement) {
          const base = ["send_message", "propose", "wait"];
          const split = spec
            ? `This task implements the OpenSpec change ${spec}/ ('openspec'): read its proposal.md, design.md and specs/, then split it without redesigning: every open task of tasks.md goes to exactly one agent (assignments[].tasks: ["1.1", ...]) together with the files those tasks change; ${spec}/ stays with you, the lead. If the design has to change, ask the operator. `
            : "";
          return this.me === lead
            ? done("propose", base, `${split}Agree with the others who changes which files (send_message), then propose(): one assignment per agent, every file with ONE owner; an agent with nothing of its own to change gets files: [] (review only).`, [...task.agents])
            : done("wait", base, `Tell ${lead} which ${spec ? "tasks of tasks.md and which " : ""}files you will take, or that you only review (files: []), then wait() for the proposal.`, [...task.agents]);
        }
        const pending = agreement.assignments.map((a) => a.agentId).filter((id) => !agreement.approvedBy.includes(id));
        if (!agreement.approvedBy.includes(this.me)) {
          return done("approve", ["send_message", "propose", "complete", "wait"], `Check 'agreement' (assignments, files${spec ? " and the tasks.md numbers each agent takes" : ""}): complete() approves it, propose() replaces it.`, pending);
        }
        return done("wait", ["send_message", "propose", "wait"], `Approved. Waiting for: ${pending.join(", ")}.`, pending);
      }
      case "IMPLEMENT": {
        const pending = task.agents.filter((id) => !impls.some((i) => i.agentId === id && i.status === "READY_FOR_SYNC"));
        if (mine?.status === "READY_FOR_SYNC") {
          return done("wait", ["send_message", "wait"], `Your part is ready. Waiting for: ${pending.join(", ")}.`, pending);
        }
        const myAssignment = agreement?.assignments.find((a) => a.agentId === this.me);
        if (task.syncRound === 0 && isReviewOnly(myAssignment)) {
          return done("implement", ["send_message", "complete", "wait"], 'Your assignment has no files: review only, you change nothing in this task. Mark your part ready now with complete({result: "review only: nothing to change"}); you review in SYNC.', pending);
        }
        const base = task.baseCommit ? `Follow-up of ${task.parentTaskId}: in your own git branch, first git merge ${task.baseCommit}. ` : "";
        const steps = s.subtasks.find((l) => l.agentId === this.me)?.items ?? [];
        const open = steps.filter((i) => i.status === "TODO" || i.status === "DOING");
        const plan = open.length
          ? `Open subtasks: ${open.map((i) => `${i.id}${i.status === "DOING" ? " (doing)" : ""}`).join(", ")}; mark each done as you finish it. `
          : steps.length
            ? ""
            : "Several steps? Plan them first with subtasks({add: [...]}). ";
        const commit = s.ownBranch
          ? `You work on your own branch ${s.ownBranch}: commit your files before complete() and pass the hashes in commits; the reviewers and the lead see only committed work. `
          : "";
        const specTasks = spec ? myAssignment?.tasks ?? [] : [];
        const yourSpec = specTasks.length
          ? `Your OpenSpec tasks: ${specTasks.join(", ")} ('openspec.yourTasks'): implement exactly these, each scenario of their specs as a test; ${spec}/ (tasks.md included) belongs to the lead. `
          : "";
        const finish = `Then complete({result, filesChanged${specTasks.length ? ", tasksDone: [<the numbers of your tasks you finished>]" : ""}}).`;
        return task.syncRound > 0
          ? done("fix", ["send_message", "subtasks", "complete", "wait"], `${base}Fix what 'fixRequests' (forYou) name. ${plan}${commit}${finish}`, pending)
          : done("implement", ["send_message", "subtasks", "complete", "wait"], `${base}${yourSpec}Implement your assignment in your own files (reading any file needs no permission; to change another agent's file ask its owner with send_message requestFiles). ${plan}${commit}${finish}`, pending);
      }
      case "SYNC": {
        const pending = phases.reviewers(task).filter((id) => !reports.some((r) => r.agentId === id));
        const targets = phases.reviewees(task).filter((a) => a !== this.me);
        if (targets.length === 0) {
          return done("wait", ["send_message", "wait"], `This round reviews only the others' fixes. Waiting for: ${pending.join(", ")}.`, pending);
        }
        if (reports.some((r) => r.agentId === this.me)) {
          return done("wait", ["send_message", "wait"], `Report submitted. Waiting for: ${pending.join(", ")}.`, pending);
        }
        const scope = task.syncRound > 1 ? `the fixes of ${targets.join(", ")}` : `the work of ${targets.join(", ")}`;
        const absent = Object.entries(s.missingCommits ?? {});
        const fresh = absent.length
          ? `Your branch lacks their latest commits (${absent.map(([a, cs]) => `${a}: ${cs.join(", ")}`).join("; ")}), so your copy of their files is older: first run git merge ${absent.flatMap(([, cs]) => cs).join(" ")}. `
          : "";
        return done(
          "sync",
          ["send_message", "complete", "wait"],
          `${fresh}Review ${scope} ('teamImplementations': their changed files and commits) against the task and the agreement: judge the code, not what its authors say about it. Work done in another branch is in its commits (git show <hash>); if a change listed in filesChanged is not visible to you, ask its author with send_message to commit it and wait() for the reply instead of reporting it missing.${task.syncRound > 1 ? " 'fixedFindings' lists what the fixes had to address: check each one." : ""}${spec ? ` Check each task in their tasksDone against its scenarios in ${spec}/specs/.` : ""} Then complete({status: "PASS"}) (WARNING/INFO findings allowed) or complete({status: "NEEDS_FIX", findings}) with an ERROR naming the agent to fix in relatedAgent.`,
          pending,
        );
      }
      case "INTEGRATE": {
        const lead = phases.integrator(task);
        if (this.me !== lead) return done("wait", ["send_message", "wait"], `${lead} is integrating. Waiting for: ${lead}.`, [lead]);
        const verify = task.verifyCommand ? `\`${task.verifyCommand}\`` : "the build and all tests";
        const left = s.followUpBudget?.remaining ?? 0;
        const followUps = left ? ` With PASS, left-over work ('followUps.notes', things you noticed) can become up to ${left} follow-up task(s): followUps: [{title, description}], each concrete.` : "";
        return done(
          "integrate",
          ["send_message", "complete", "wait"],
          `Bring everyone's work together (merge their branches if they use worktrees), run ${verify} on the result, ` +
            (spec
              ? `tick [x] in ${spec}/tasks.md the tasks reported done ('openspec.tasks') and run \`openspec validate ${task.openspec!.change} --strict\` if the openspec CLI is installed, then complete({status: "PASS", result}) naming the tasks left open, `
              : `then complete({status: "PASS", result}) `) +
            `or complete({status: "NEEDS_FIX", result, findings}) with an ERROR naming the agent.` + followUps,
          [lead],
        );
      }
      case "DONE":
        return done("done", [], "The task is done.", []);
    }
  }

  /** DISCUSS: approve the agreement, but only the version this process has actually shown the agent. */
  private async approve(task: Task): Promise<string> {
    const agreement = await this.service.agreements.find(task.id);
    if (!agreement) {
      throw new AppError("AGREEMENT_NOT_READY", `No agreement has been proposed yet. ${task.agents[0]} (or any agent) should call propose().`);
    }
    if (agreement.approvedBy.includes(this.me)) throw new AppError("ALREADY_COMPLETED", "You already approved this agreement. Call wait().");
    if (this.shownAgreement.get(task.id) !== agreement.version) {
      this.shownAgreement.set(task.id, agreement.version);
      throw new AppError("AGREEMENT_NOT_REVIEWED", "You have not seen the current version of the agreement. Review it below, then call complete() again to approve.", { agreement });
    }
    await this.service.approveAgreement({ taskId: task.id, version: agreement.version });
    return "AGREEMENT_APPROVED";
  }
}
