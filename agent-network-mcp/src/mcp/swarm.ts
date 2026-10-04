import { AppError, isAppError } from "../errors.js";
import { normalizePath, ownersOf } from "../ownership.js";
import { MAX_WAIT_MS, DEFAULT_WAIT_MS, type NetworkService } from "../service.js";
import type { Agent, Agreement, Implementation, IntegrationReport, Message, SyncFinding, SyncReport, Task } from "../types.js";

/** What the agent should do next, computed by the server so the agent never reasons about the state machine. */
export type NextAction = "propose" | "approve" | "implement" | "fix" | "sync" | "integrate" | "wait" | "done";

export interface Decision {
  nextAction: NextAction;
  allowedActions: string[];
  hint: string;
  waitingOn: string[];
  /** A ready-to-copy tool call for nextAction, with real agent ids filled in (helps weak models emit arguments). */
  exampleCall?: { tool: string; args: Record<string, unknown> };
}

interface Snapshot {
  task: Task;
  agreement: Agreement | null;
  impls: Implementation[];
  reports: SyncReport[];
  integrations: IntegrationReport[];
  agents: Agent[];
  unread: Message[];
}

export type SwarmContext = Record<string, unknown> & { nextAction: NextAction; allowedActions: string[] };

type RawFinding = Omit<SyncFinding, "severity"> & { severity: string };

const MIN_DESCRIPTION = 40;

const SEVERITIES = ["INFO", "WARNING", "ERROR"] as const;

function invalid(message: string, details?: Record<string, unknown>): AppError {
  return new AppError("INVALID_INPUT", message, details);
}

/**
 * The agent-facing layer: five operations (context, send_message, propose, complete, wait) on top of
 * NetworkService. The "current task" is the oldest ACTIVE task of this agent, so no tool takes a taskId.
 */
export interface SwarmOptions {
  /** wait() timeout when the agent passes none (AGENT_NETWORK_WAIT_MS); keep it below the client's tool-call timeout. */
  defaultWaitMs?: number;
}

export class Swarm {
  private registered?: Promise<unknown>;
  private shownMessages: { taskId: string; id: string }[] = [];
  private shownAgreement = new Map<string, number>();
  readonly defaultWaitMs: number;

  constructor(
    private readonly service: NetworkService,
    private readonly log: (m: string) => void = () => undefined,
    opts: SwarmOptions = {},
  ) {
    this.defaultWaitMs = Math.min(Math.max(opts.defaultWaitMs ?? DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);
  }

  private get me(): string {
    return this.service.me;
  }

  // ------------------------------------------------------------------ tools

  /** Safe to call at any time: read-only (it does not mark messages as read). */
  async context(): Promise<SwarmContext> {
    await this.begin(false);
    return this.contextNow();
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

  async sendMessage(input: { to?: string; message?: string; requestFiles?: string[]; grantFiles?: string[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const others = task.agents.filter((a) => a !== this.me);
    if (!input.to?.trim()) throw invalid("'to' is required", { validRecipients: others });
    if (!input.message?.trim()) throw invalid("'message' must not be empty");
    if (!others.includes(input.to)) {
      throw new AppError("NOT_ASSIGNED", `'${input.to}' is not another agent of ${task.id}`, { validRecipients: others });
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
    return { ...(await this.contextNow()), ok: true, action: type === "FILE_REQUEST" ? "FILES_REQUESTED" : "MESSAGE_SENT", messageId: sent.id, ...(files ? { requested: files } : {}) } as SwarmContext;
  }

  async propose(input: { summary?: string; assignments?: { agentId: string; responsibility: string; files?: string[] }[]; decisions?: string[]; interfaces?: string[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    if (task.phase !== "DISCUSS") {
      throw new AppError("INVALID_PHASE", `propose is only available during DISCUSS (task is in ${task.phase}).`);
    }
    if (!input.summary?.trim()) throw invalid("'summary' is required", { taskAgents: task.agents });
    if (!input.assignments?.length) {
      throw invalid(`'assignments' is required: one entry {agentId, responsibility} for every agent: ${task.agents.join(", ")}`, { taskAgents: task.agents });
    }
    const noFiles = input.assignments.filter((a) => !a.files?.length).map((a) => a.agentId);
    if (noFiles.length) {
      throw invalid(`Every assignment needs 'files': the files (paths or globs like src/main/**) that agent will change. Missing for: ${noFiles.join(", ")}. Agree on this with the other agents first (send_message); every file must have exactly one owner.`, { taskAgents: task.agents });
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

  async complete(input: { result?: string; filesChanged?: string[]; commits?: string[]; status?: string; findings?: RawFinding[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const given = (keys: (keyof typeof input)[]) => keys.filter((k) => input[k] !== undefined);
    let action: string;
    let warnings: string[] | undefined;

    switch (task.phase) {
      case "DISCUSS": {
        const extra = given(["result", "filesChanged", "commits", "status", "findings"]);
        if (extra.length) throw invalid(`During DISCUSS complete() takes no arguments (it approves the agreement); got: ${extra.join(", ")}`);
        action = await this.approve(task);
        break;
      }
      case "IMPLEMENT": {
        const extra = given(["status", "findings"]);
        if (extra.length) throw invalid(`During IMPLEMENT complete() takes {result, filesChanged?, commits?}; got unexpected: ${extra.join(", ")}`);
        if (!input.result?.trim()) throw invalid("complete() during IMPLEMENT requires 'result': a short summary of what you implemented");
        const existing = await this.service.implementations.find(task.id, this.me);
        if (!existing) await this.service.startImplementation(task.id);
        const done = await this.service.completeImplementation({ taskId: task.id, summary: input.result, filesChanged: input.filesChanged, commits: input.commits });
        warnings = done.warnings;
        action = "IMPLEMENTATION_COMPLETED";
        break;
      }
      case "SYNC": {
        const extra = given(["result", "filesChanged", "commits"]);
        if (extra.length) throw invalid(`During SYNC complete() takes {status, findings?}; got unexpected: ${extra.join(", ")}`);
        if (input.status !== "PASS" && input.status !== "NEEDS_FIX") {
          throw invalid("complete() during SYNC requires 'status': \"PASS\" or \"NEEDS_FIX\" (with 'findings')");
        }
        await this.service.submitSync({ taskId: task.id, status: input.status, findings: this.findings(input.findings) });
        action = input.status === "PASS" ? "SYNC_PASS" : "SYNC_NEEDS_FIX";
        break;
      }
      case "INTEGRATE": {
        const extra = given(["filesChanged"]);
        if (extra.length) throw invalid(`During INTEGRATE complete() takes {status, result, commits?, findings?}; got unexpected: ${extra.join(", ")}`);
        if (input.status !== "PASS" && input.status !== "NEEDS_FIX") {
          throw invalid("complete() during INTEGRATE requires 'status': \"PASS\" (merged, build and tests green) or \"NEEDS_FIX\" (with 'findings')");
        }
        if (!input.result?.trim()) throw invalid("complete() during INTEGRATE requires 'result': what you merged, where the result is, and the build/test outcome");
        await this.service.submitIntegration({ taskId: task.id, status: input.status, result: input.result, commits: input.commits, findings: this.findings(input.findings) });
        action = input.status === "PASS" ? "INTEGRATION_PASS" : "INTEGRATION_NEEDS_FIX";
        break;
      }
      case "DONE":
        throw new AppError("INVALID_PHASE", "The task is already DONE; there is nothing to complete.");
    }
    const after = await this.contextNow();
    const phaseChanged = (after.task as { phase: string } | null)?.phase !== task.phase ? { from: task.phase, to: (after.task as { phase: string }).phase } : undefined;
    return { ...after, ok: true, action, ...(phaseChanged ? { phaseChanged } : {}), ...(warnings?.length ? { warnings } : {}) } as SwarmContext;
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
    const [agreement, impls, reports, integrations, agents, unread] = await Promise.all([
      this.service.agreements.find(task.id),
      this.service.implementations.list(task.id),
      this.service.syncs.list(task.id, task.syncRound),
      this.service.integrations.list(task.id, task.syncRound),
      this.service.agents.list(),
      this.service.messages.list(task.id, { to: this.me, unreadOnly: true }),
    ]);
    return { task, agreement, impls, reports, integrations, agents, unread };
  }

  private async contextNow(): Promise<SwarmContext> {
    const me = (await this.service.agents.get(this.me))!;
    const agent = { id: this.me, role: me.role ?? null, type: me.type };
    const task = await this.currentTask();
    if (!task) {
      return {
        task: null,
        agent,
        otherAgents: [],
        pendingMessages: [],
        registeredAgents: (await this.service.agents.list()).map((a) => a.id).filter((id) => id !== this.me),
        allowedActions: ["create_task", "wait"],
        nextAction: "wait",
        waitingOn: [],
        hint: `No task is assigned to agent '${this.me}' in ${this.service.networkDir}. Call wait(). Call create_task ONLY if the user asked you to start a task (then use the user's words). If a task should already exist, the operator may have created it in another network directory or for other agent names.`,
        networkDir: this.service.networkDir,
      };
    }
    const snap = await this.snapshot(task);
    const d = this.decide(snap);
    const { agreement, impls, reports, integrations, agents, unread } = snap;
    const phases = this.service.phases;

    // remember what the agent has actually seen
    for (const m of unread) if (!this.shownMessages.some((s) => s.id === m.id && s.taskId === task.id)) this.shownMessages.push({ taskId: task.id, id: m.id });
    if (agreement) this.shownAgreement.set(task.id, agreement.version);

    const mine = impls.find((i) => i.agentId === this.me) ?? null;
    // after a failed review or integration the round's reports explain what to fix
    const fixRequests =
      task.phase === "IMPLEMENT" && task.syncRound > 0
        ? [...reports, ...integrations]
            .filter((r) => r.status === "NEEDS_FIX")
            .flatMap((r) => r.findings.map((f) => ({ ...f, reportedBy: r.agentId, forYou: !f.relatedAgent || f.relatedAgent === this.me })))
        : [];
    const integration = integrations.at(-1);

    return {
      task: {
        id: task.id, title: task.title, description: task.description, phase: task.phase, status: task.status, syncRound: task.syncRound, agents: task.agents,
        maxFixRounds: phases.maxFixRounds(task), lead: phases.integrator(task),
        ...(task.verifyCommand ? { verifyCommand: task.verifyCommand } : {}),
        ...(task.requireCommits ? { requireCommits: true } : {}),
        ...(task.blockedReason ? { blockedReason: task.blockedReason } : {}),
      },
      agent,
      assignment: agreement?.assignments.find((a) => a.agentId === this.me) ? { responsibility: agreement.assignments.find((a) => a.agentId === this.me)!.responsibility } : null,
      otherAgents: task.agents
        .filter((id) => id !== this.me)
        .map((id) => {
          const a = agents.find((x) => x.id === id);
          return { id, role: a?.role ?? null, status: a?.status ?? "NOT_REGISTERED" };
        }),
      pendingMessages: unread.map((m) => ({ id: m.id, from: m.from, type: m.type, ...(m.files ? { files: m.files } : {}), content: m.content, createdAt: m.createdAt })),
      agreement: agreement
        ? { version: agreement.version, proposedBy: agreement.proposedBy, summary: agreement.summary, assignments: agreement.assignments, decisions: agreement.decisions, interfaces: agreement.interfaces, approvedBy: agreement.approvedBy, approvedByYou: agreement.approvedBy.includes(this.me) }
        : null,
      ...(await this.ownershipView(task.id)),
      implementation: mine ? { status: mine.status, summary: mine.summary, filesChanged: mine.filesChanged, commits: mine.commits } : null,
      teamImplementations: impls.filter((i) => i.agentId !== this.me).map((i) => ({ agentId: i.agentId, status: i.status, summary: i.summary, filesChanged: i.filesChanged, commits: i.commits })),
      ...(task.phase === "SYNC" ? { reviewTargets: phases.reviewees(task).filter((a) => a !== this.me), syncReports: reports.map((r) => ({ agentId: r.agentId, status: r.status, findings: r.findings })) } : {}),
      ...(integration ? { integration: { status: integration.status, result: integration.result, commits: integration.commits, findings: integration.findings } } : {}),
      ...(fixRequests.length ? { fixRequests } : {}),
      waitingOn: d.waitingOn,
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
        othersFiles: own.assignments.filter((a) => a.agentId !== this.me).map((a) => ({ agentId: a.agentId, files: a.files ?? [] })),
        grantedToYou: own.grantedToYou,
        grantedByYou: own.grantedByYou,
        rule: "Change only yourFiles and grantedToYou. To change another agent's file: send_message(to=owner, message=why, requestFiles=[...]); the owner answers with grantFiles.",
      },
    };
  }

  /** The decision table: phase + my own progress -> nextAction / allowedActions. */
  decide(s: Snapshot): Decision {
    const d = this.decideCore(s);
    const example = this.example(s.task, d.nextAction);
    return example ? { ...d, exampleCall: example } : d;
  }

  private example(task: Task, next: NextAction): Decision["exampleCall"] {
    switch (next) {
      case "propose":
        return { tool: "propose", args: { summary: "<what the team will build>", assignments: task.agents.map((agentId) => ({ agentId, responsibility: "<what this agent implements>", files: ["<files or globs this agent will change, e.g. src/main/**>"] })), decisions: ["<agreed decision>"], interfaces: ["<agreed contract, e.g. POST /x -> 201>"] } };
      case "approve":
        return { tool: "complete", args: {} };
      case "implement":
      case "fix":
        return { tool: "complete", args: { result: "<what you implemented>", filesChanged: ["<path/File.java>"], commits: [] } };
      case "sync":
        return { tool: "complete", args: { status: "PASS" } };
      case "integrate":
        return { tool: "complete", args: { status: "PASS", result: "<branch/commit with everyone's work merged; build and test output summary>", commits: ["<HEAD of the merged result>"] } };
      case "wait":
        return { tool: "wait", args: {} };
      default:
        return undefined;
    }
  }

  private decideCore(s: Snapshot): Decision {
    const { task, agreement, impls, reports } = s;
    const mine = impls.find((i) => i.agentId === this.me);
    const lead = task.agents[0];
    const done = (nextAction: NextAction, allowed: string[], hint: string, waitingOn: string[]): Decision => ({ nextAction, allowedActions: allowed, hint, waitingOn });

    if (task.status === "BLOCKED") {
      return done("wait", ["send_message", "wait"], `The task is BLOCKED: ${task.blockedReason ?? "the fix-round limit was reached"}. The operator decides (task unblock / task cancel). Call wait().`, ["operator"]);
    }
    const phases = this.service.phases;
    switch (task.phase) {
      case "DISCUSS": {
        if (!agreement) {
          const base = ["send_message", "propose", "wait"];
          return this.me === lead
            ? done("propose", base, "Tell the other agents which files you will change and ask which files they will change (send_message). Then call propose() with one assignment per agent, each with its own `files`; every file has exactly ONE owner.", [...task.agents])
            : done("wait", base, `Tell ${lead} which files you will change (send_message) and wait for the proposal, or propose() yourself. Every file must have exactly ONE owner.`, [...task.agents]);
        }
        const pending = agreement.assignments.map((a) => a.agentId).filter((id) => !agreement.approvedBy.includes(id));
        if (!agreement.approvedBy.includes(this.me)) {
          return done("approve", ["send_message", "propose", "complete", "wait"], "Review 'agreement' (assignments AND each agent's files). complete() approves it; propose() replaces it; send_message to discuss.", pending);
        }
        return done("wait", ["send_message", "propose", "wait"], `You approved. Waiting for: ${pending.join(", ")}.`, pending);
      }
      case "IMPLEMENT": {
        const pending = task.agents.filter((id) => !impls.some((i) => i.agentId === id && i.status === "READY_FOR_SYNC"));
        if (mine?.status === "READY_FOR_SYNC") {
          return done("wait", ["send_message", "wait"], `Your part is ready. Waiting for: ${pending.join(", ")}.`, pending);
        }
        return task.syncRound > 0
          ? done("fix", ["send_message", "complete", "wait"], "A sync review requested fixes (see 'fixRequests'). Fix your part, then complete({result, filesChanged, commits}).", pending)
          : done("implement", ["send_message", "complete", "wait"], "Implement ONLY your assignment and change only your own files (see 'ownership'). Need another agent's file? send_message(requestFiles) to its owner and wait for their grant. Then complete({result, filesChanged, commits}).", pending);
      }
      case "SYNC": {
        const pending = phases.reviewers(task).filter((id) => !reports.some((r) => r.agentId === id));
        const targets = phases.reviewees(task).filter((a) => a !== this.me);
        if (targets.length === 0) {
          return done("wait", ["send_message", "wait"], `This round reviews only your fixes; nothing for you to review. Waiting for: ${pending.join(", ")}.`, pending);
        }
        if (reports.some((r) => r.agentId === this.me)) {
          return done("wait", ["send_message", "wait"], `Your sync report is submitted. Waiting for: ${pending.join(", ")}.`, pending);
        }
        const scope = task.syncRound > 1 ? `the fixes of ${targets.join(", ")} (see 'teamImplementations' and the previous findings)` : `the work of ${targets.join(", ")} ('teamImplementations': commits, changed files) against the agreed interfaces`;
        return done(
          "sync",
          ["send_message", "complete", "wait"],
          `Review ${scope}. Then complete({status: "PASS"}) — WARNING/INFO findings may go with PASS — or complete({status: "NEEDS_FIX", findings: [...]}) with at least one ERROR finding naming the agent to fix in relatedAgent. Only real defects or agreement violations are ERRORs.`,
          pending,
        );
      }
      case "INTEGRATE": {
        const lead = phases.integrator(task);
        if (this.me !== lead) return done("wait", ["send_message", "wait"], `${lead} is merging everyone's work and running the build/tests. Waiting for: ${lead}.`, [lead]);
        const verify = task.verifyCommand ? ` with \`${task.verifyCommand}\`` : "";
        return done(
          "integrate",
          ["send_message", "complete", "wait"],
          `Merge everyone's commits into one branch (yours and 'teamImplementations'[].commits; in separate worktrees merge their branches), run the build and ALL tests${verify} on the result. ` +
            `Then complete({status: "PASS", result, commits: [<merged HEAD>]}) or complete({status: "NEEDS_FIX", result, findings: [{severity: "ERROR", description, relatedAgent}]}) for conflicts or failures.`,
          [lead],
        );
      }
      case "DONE":
        return done("done", [], "The task is complete. Nothing more to do.", []);
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
