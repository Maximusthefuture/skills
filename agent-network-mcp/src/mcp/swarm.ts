import { buildTools, DEFAULT_BUILD_TIMEOUT_MIN, parseBuildCommand, runBuild } from "../build.js";
import { AppError, isAppError } from "../errors.js";
import { containsCommit, filesChangedSince, ownCommitsSince, readGitContext, resolveCommit, workTreeState } from "../git.js";
import { phaseEpoch } from "../handoff.js";
import { WAKES } from "../park.js";
import { changePath, readChange, validateChange, type ChangeInfo, type Exec } from "../openspec.js";
import { normalizePath, ownersOf } from "../ownership.js";
import { PLAN_READ_WHOLE, planAround, planBrief, planOutline, type PlanStatus } from "../plan.js";
import { MAX_WAIT_MS, DEFAULT_WAIT_MS, MIN_DESCRIPTION, OPERATOR, OPERATOR_TIMEOUT_MS, clarifies, grillConfirmed, isReviewOnly, type NetworkService } from "../service.js";
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
  /** A runner's session with nothing to do but wait for the others: it ends; the runner waits without a model (park.ts). */
  park?: true;
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
  /** When this agent last wrote to another agent (after an unanswered question: did it tell the team it went ahead?). */
  myLastMessageAt?: string;
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
  /** IMPLEMENT: an agent this one depends on (dependsOn) and has reported -> its commits this session's branch lacks. */
  dependencyCommits?: Record<string, string[]>;
  /** IMPLEMENT: this session tried to complete before its dependencies reported; it waits for them instead of trying again. */
  dependencyParked?: boolean;
  /** The lead: the operator's review comments still open (each fixed or declined with resolve_comments). */
  openReview?: { id: string; file: string; line?: number; code?: string; text: string }[];
  /** A task with clarify: the lead has not written to the operator yet (a question or how it understood the task). */
  mustClarify?: boolean;
  /** DISCUSS, the lead, no agreement yet: the agents it may add from templates. */
  spawnable?: { templates: { name: string; description: string; model?: string }[]; roles: { name: string; description: string }[]; left: number };
  /** The lead in IMPLEMENT / INTEGRATE: templates it may delegate a job to, and its jobs so far. */
  delegable?: { templates: { name: string; description: string; model?: string }[]; left: number };
  jobs?: { task: string; agent: string; status: string; job: string; subtask: string }[];
  /** A task with planReview, DISCUSS: where the lead's HTML plan stands. */
  plan?: { status: PlanStatus; version: number | null; approvedVersion: number | null };
  /** A change-writing task: every answer of the operator to a question of this task (they belong in design.md). */
  operatorAnswers?: { question: string; askedBy: string; answer: string }[];
}

/**
 * The words right after an agent's name in a task description, when they give it work of its own (tests, code...),
 * not just a review: "reviewer — модульные тесты и ревью" → "модульные тесты и ревью"; null otherwise.
 */
export function workGiven(description: string, agentId: string): string | null {
  const re = new RegExp(`(^|[^\\w-])${agentId.replace(/[-]/g, "\\-")}(?![\\w-])\\s*[—:–-]?\\s*([^.;\\n]{3,80})`, "gi");
  for (const m of description.matchAll(re)) {
    const words = m[2]!.trim();
    if (/тест|test|пиш|writ|implement|реализ|код|code|делает|builds?\b|migration|миграц/i.test(words)) return words.slice(0, 80);
  }
  return null;
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

/** Big parts of the context that change rarely: after the agent has seen one, replies say "(unchanged)" until it changes. */
// hint and exampleCall too: every reply stays in the agent's context and is read again each turn, so the same guidance
// repeated in each reply of a phase grows the context for nothing
const SECTIONS = ["openspec", "agreement", "assignment", "ownership", "subtasks", "teamImplementations", "fixedFindings", "fixRequests", "followUps", "hint", "exampleCall"] as const;
const UNCHANGED = "(unchanged)";
const UNCHANGED_NOTE = "Parts marked (unchanged), and the task's title, agents and description left out, are as in an earlier response of this session; swarm_context shows them again.";

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
 * The agent-facing layer: eight operations (context, create_task, send_message, propose, subtasks, complete, build, wait) on top of
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
  /**
   * The task a runner started this session for (AGENT_NETWORK_TASK_ID). Once it is done, the session ends instead of going
   * on to the agent's next task: the runner starts that one in a fresh session (a clean context, its own cost).
   */
  sessionTask?: string;
  /**
   * Under a runner: park only after this many wait() timeouts in a row (default 2). A wait() turn is read from the prompt
   * cache (cheap); a parked session's restart writes the cache again and spends a few turns, so a short wait is cheaper
   * waited out, a long one parked.
   */
  parkAfterWaits?: number;
  /** How long a question to the operator blocks the asker (AGENT_NETWORK_OPERATOR_TIMEOUT_MIN); then it goes ahead with its own proposal. */
  operatorTimeoutMs?: number;
  /** The commands build() may start (default: BUILD_TOOLS plus AGENT_NETWORK_BUILD_TOOLS). */
  buildTools?: string[];
  /** Runs `openspec validate` for a change-writing task (tests replace it). */
  openspecExec?: Exec;
}

/** While an agent waits for the operator, wait() looks at the clock this often, so it learns in time that the question timed out. */
const OPERATOR_POLL_MS = 30_000;

export class Swarm {
  private registered?: Promise<unknown>;
  private shownMessages: { taskId: string; id: string }[] = [];
  private shownAgreement = new Map<string, number>();
  /** "taskId:round" where complete() was refused because a dependency (dependsOn) had not reported yet. */
  private parkedOnDependency = new Set<string>();
  /** "taskId:section" -> the section as this session last saw it (see reply()). */
  private shownSections = new Map<string, string>();
  /** Tasks whose fixed fields (title, agents, lead, description...) this session's replies have shown. */
  private shownTaskFixed = new Set<string>();
  /** Tasks whose description this session has already shown (it stays in the agent's context). */
  private shownDescription = new Set<string>();
  /** taskId -> phaseHistory length when this session first saw the task; later phases are new to it. */
  private firstSeenEpoch = new Map<string, number>();
  /** "taskId@epoch" whose handoff marker is written. */
  private markedHandoff = "";
  private readonly freshPhases: readonly Phase[];
  private readonly workdir: string;
  private readonly underRunner: boolean;
  private readonly sessionTask: string | undefined;
  private readonly parkAfterWaits: number;
  /** wait() timeouts in a row with nothing to do: parking pays off once the wait proves long. */
  private idleWaits = 0;
  /** The action wait() last told this agent to take: asked again with nothing changed, wait() waits instead of repeating it. */
  private lastToldAction: string | null = null;
  private lastToldAt = 0;
  /** Git context of the working folder, read once per session. */
  private workGit?: Promise<GitContext | null>;
  readonly defaultWaitMs: number;
  private readonly operatorTimeoutMs: number;
  private readonly buildTools: string[];
  private readonly openspecExec?: Exec;

  constructor(
    private readonly service: NetworkService,
    private readonly log: (m: string) => void = () => undefined,
    opts: SwarmOptions = {},
  ) {
    // under a runner the longest wait by default: every wait() that returns is a model turn
    this.defaultWaitMs = Math.min(Math.max(opts.defaultWaitMs ?? (opts.underRunner ? MAX_WAIT_MS : DEFAULT_WAIT_MS), 0), MAX_WAIT_MS);
    this.parkAfterWaits = opts.parkAfterWaits ?? 2;
    this.freshPhases = opts.freshPhases ?? [];
    this.workdir = opts.workdir ?? process.cwd();
    this.underRunner = opts.underRunner ?? false;
    this.sessionTask = opts.underRunner ? opts.sessionTask : undefined;
    this.operatorTimeoutMs = opts.operatorTimeoutMs ?? OPERATOR_TIMEOUT_MS;
    this.buildTools = opts.buildTools ?? buildTools();
    this.openspecExec = opts.openspecExec;
  }

  private get me(): string {
    return this.service.me;
  }

  // ------------------------------------------------------------------ tools

  /** Safe to call at any time: read-only (it does not mark messages as read). */
  async context(input: { full?: boolean } = {}): Promise<SwarmContext> {
    await this.begin(false);
    return this.reply(await this.contextNow(input.full === true), true);
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
    return { ...this.reply(await this.contextNow()), ok: true, action: "TASK_CREATED", taskId: task.id } as SwarmContext;
  }

  /**
   * Runs the build or tests in the agent's folder and answers with the outcome and what failed, not the whole output
   * (that goes to a log file the agent can grep). Default command: the task's verifyCommand.
   */
  async build(input: { command?: string; timeoutMin?: number }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const task = await this.currentTask();
    const open = task && (task.status === "ACTIVE" || task.status === "BLOCKED") ? task : null;
    const command = input.command?.trim() || open?.verifyCommand;
    if (!command) {
      throw invalid("No command: the task has no verifyCommand. Pass the build or test command, e.g. build({command: \"./mvnw -q verify\"}) or build({command: \"npm test\"}).");
    }
    const { argv, dropped } = parseBuildCommand(command, this.buildTools);
    const minutes = input.timeoutMin ?? DEFAULT_BUILD_TIMEOUT_MIN;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 180) throw invalid("timeoutMin must be 1..180");
    // what the build ran on: the integration accepts PASS only from a green run on the committed merged result
    const tree = await workTreeState(this.workdir);
    const run = await runBuild({ cwd: this.workdir, argv, timeoutMs: minutes * 60_000, ...(signal ? { signal } : {}) });
    await this.service
      .recordBuild(open?.id ?? null, {
        command: argv.join(" "), ok: run.ok, exitCode: run.exitCode, timedOut: run.timedOut, durationMs: run.durationMs, logPath: run.logPath, ...(run.tests ? { tests: run.tests } : {}),
        ...(tree ? { head: tree.head, dirty: tree.dirty } : {}), ...(open ? { phase: open.phase, round: open.syncRound } : {}),
      })
      .catch((e: Error) => this.log(`build event not recorded: ${e.message}`));
    return {
      status: run.timedOut ? "TIMEOUT" : run.ok ? "PASS" : "FAIL",
      summary: run.summary,
      log: run.logPath,
      ...(dropped ? { note: `"${dropped}" was dropped: build shortens the output itself` } : {}),
    };
  }

  /** The lead adds an agent to the team from a template (DISCUSS, before propose); its runner starts by itself. */
  /** The lead hands a self-contained piece of its work to a new runner, from its own committed code. */
  async delegate(input: { template?: string; job?: string; files?: string[]; role?: string; instructions?: string }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const head = (await readGitContext(this.workdir).catch(() => null))?.commit;
    const { job, agentId, subtask } = await this.service.delegate({
      taskId: task.id, template: input.template ?? "", job: input.job ?? "", ...(input.files ? { files: input.files } : {}),
      ...(input.role ? { role: input.role } : {}), ...(input.instructions ? { instructions: input.instructions } : {}), ...(head ? { baseCommit: head } : {}),
    });
    return {
      ...this.reply(await this.contextNow()), ok: true, action: "JOB_DELEGATED", job: job.id, agentId, subtask,
      note: `${agentId} starts on ${job.id} in a few seconds${head ? `, from your commit ${head.slice(0, 7)} (uncommitted changes are not in it)` : ""}. It is your open subtask ${subtask}: go on with your own work; the result comes in pendingMessages.`,
    } as SwarmContext;
  }

  async spawnAgent(input: { template?: string; id?: string; reason?: string; role?: string; instructions?: string }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const { agentId } = await this.service.spawnAgent({
      taskId: task.id, template: input.template ?? "", reason: input.reason ?? "",
      ...(input.id ? { id: input.id } : {}), ...(input.role ? { role: input.role } : {}), ...(input.instructions ? { instructions: input.instructions } : {}),
    });
    return {
      ...this.reply(await this.contextNow()), ok: true, action: "AGENT_SPAWNED", agentId,
      note: `${agentId} joined the task; its runner starts in a few seconds. Give it an assignment in propose() like any agent (it approves the agreement when it starts).`,
    } as SwarmContext;
  }

  /** The lead answers the operator's review comments: each fixed (what was done) or declined (why). */
  async resolveComments(input: { resolve?: { id: string; status: string; note?: string }[] }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    if (!input.resolve?.length) throw invalid("resolve: [{id: 'rc-1', status: 'fixed', note: 'what changed'}]");
    const all = await this.service.resolveReviewComments(task.id, input.resolve);
    const open = all.filter((c) => c.status === "open").map((c) => c.id);
    return { ...this.reply(await this.contextNow()), ok: true, action: "COMMENTS_RESOLVED", stillOpen: open } as SwarmContext;
  }

  /** The lead's plan as an HTML page for the operator (task.planReview): a new version, or the current one to read. */
  async plan(input: { html?: string; edits?: { find: string; replace: string }[]; note?: string; read?: boolean; around?: string }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    if (input.read || input.around) {
      const current = await this.service.planHtml(task.id);
      if (!current) throw invalid("there is no plan yet: write it with plan({html})");
      const base = { ...this.reply(await this.contextNow()), ok: true, action: "PLAN_READ", version: current.version, size: current.html.length };
      // the page stays in the context for the rest of the session and is read again every turn: a big one goes by parts
      if (input.around) {
        const parts = planAround(current.html, input.around);
        if (!parts.length) throw invalid(`around: ${JSON.stringify(input.around.slice(0, 80))} is not in plan v${current.version}; pick a shorter piece of the text, or plan({read: true}) for the headings`);
        return { ...base, parts } as SwarmContext;
      }
      if (current.html.length <= PLAN_READ_WHOLE) return { ...base, html: current.html } as SwarmContext;
      return {
        ...base, outline: planOutline(current.html),
        note: `The page is ${Math.round(current.html.length / 1000)}k characters: too big to hold in your context whole. Read the parts you change with plan({read: true, around: "<a few words of the text>"}) and copy the exact text for edits from them.`,
      } as SwarmContext;
    }
    const saved = await this.service.writePlan({ taskId: task.id, ...input });
    return { ...this.reply(await this.contextNow()), ok: true, action: "PLAN_SAVED", version: saved.version } as SwarmContext;
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
      ...(open.length ? { openSubtasks: open.map((i) => ({ id: i.id, title: i.title, status: i.status })) } : {}),
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

  async sendMessage(input: { to?: string; message?: string; requestFiles?: string[]; grantFiles?: string[]; fyi?: boolean; options?: { label: string; description?: string }[]; recommended?: string; multiSelect?: boolean }): Promise<SwarmContext> {
    await this.begin(true);
    const task = await this.requireTask();
    const others = task.agents.filter((a) => a !== this.me);
    const recipients = [...others, OPERATOR];
    if (!input.to?.trim()) throw invalid("'to' is required", { validRecipients: recipients });
    if (!input.message?.trim()) throw invalid("'message' must not be empty");
    if (input.options?.length && (input.to !== OPERATOR || input.fyi)) throw invalid("options go with a question to the operator (to: \"operator\", without fyi); to an agent write the options in the message");
    if (input.to === OPERATOR) {
      if (input.requestFiles?.length || input.grantFiles?.length) throw invalid("The operator owns no files: requestFiles/grantFiles go to agents. Ask the operator a plain question.");
      if (input.fyi) {
        // for the operator's information: shown on the page, answered by nobody, holds nobody
        const told = await this.service.sendMessage({ taskId: task.id, to: OPERATOR, type: "INFORMATION", content: input.message });
        return { ...this.reply(await this.contextNow()), ok: true, action: "INFO_SENT", messageId: told.id, note: "The operator sees it on the page; no answer comes. Go on with your work." } as SwarmContext;
      }
      const choices = input.options?.length ? { options: input.options, ...(input.recommended ? { recommended: input.recommended } : {}), ...(input.multiSelect ? { multiSelect: true as const } : {}) } : undefined;
      const asked = await this.service.sendMessage({ taskId: task.id, to: OPERATOR, type: "QUESTION", content: input.message, ...(choices ? { choices } : {}) });
      return {
        ...this.reply(await this.contextNow()), ok: true, action: "QUESTION_SENT", messageId: asked.id,
        note: `The operator (a human) answers on the network page; the answer arrives in pendingMessages. If you cannot go on without it, call wait(); otherwise continue with the work that does not depend on it. No answer in ${Math.round(this.operatorTimeoutMs / 60_000)} min: go ahead with ${choices?.recommended ? `"${choices.recommended}"` : "the option you proposed"} and say so.`,
      } as SwarmContext;
    }
    if (!others.includes(input.to)) {
      throw new AppError("NOT_ASSIGNED", `'${input.to}' is not another agent of ${task.id}`, { validRecipients: recipients });
    }
    if (input.requestFiles?.length && input.grantFiles?.length) throw invalid("Use either requestFiles or grantFiles in one message, not both");

    if (input.grantFiles?.length) {
      const granted = await this.service.grantFiles({ taskId: task.id, to: input.to, files: input.grantFiles, message: input.message });
      return { ...this.reply(await this.contextNow()), ok: true, action: "FILES_GRANTED", messageId: granted.message.id, granted: granted.files } as SwarmContext;
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
    return { ...this.reply(await this.contextNow()), ok: true, action: type === "FILE_REQUEST" ? "FILES_REQUESTED" : "MESSAGE_SENT", messageId: sent.id,
      ...(files ? { requested: files, note: `Asked ${input.to} for permission to CHANGE these files (reading needs no permission). Continue with your own work; the answer arrives in pendingMessages. Do not edit them before the grant.` } : {}) } as SwarmContext;
  }

  async propose(input: { summary?: string; assignments?: { agentId: string; responsibility: string; files?: string[]; tasks?: string[]; dependsOn?: string[] }[]; decisions?: string[]; interfaces?: string[] }): Promise<SwarmContext> {
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
    // the task gives an agent work (tests, code) and the agreement leaves it nothing: say so (a lead once took the
    // reviewer's unit tests over and spawned a tester for them, a third of the task's cost)
    const warnings = input.assignments
      .filter((a) => a.files!.length === 0)
      .flatMap((a) => {
        const given = workGiven(task.description, a.agentId);
        return given ? [`task.description gives ${a.agentId} work ("${given}") but its assignment has files: [] — propose again with its files, or keep it and say why in decisions.`] : [];
      });
    return { ...this.reply(await this.contextNow()), ok: true, action: "AGREEMENT_PROPOSED", agreementVersion: res.agreement.version, ...(warnings.length ? { warnings } : {}) } as SwarmContext;
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
        action = await this.approve(task);
        warnings = this.ignoredFields(extra);
        break;
      }
      case "IMPLEMENT": {
        const extra = given(["status", "findings", "followUps"]);
        if (!input.result?.trim()) throw invalid("complete() during IMPLEMENT requires 'result': a short summary of what you implemented");
        const existing = await this.service.implementations.find(task.id, this.me);
        if (!existing) await this.service.startImplementation(task.id);
        const checked = await this.checkProposal(task);
        const unreported = input.commits?.length ? undefined : await this.unreportedWork(task, existing?.commits ?? []);
        const commits = unreported?.head ? [unreported.head] : await this.realCommits(task, input.commits);
        const absent = Object.entries(await this.dependencyCommits(await this.service.agreements.find(task.id), await this.service.implementations.list(task.id)));
        if (absent.length) {
          throw new AppError(
            "DEPENDENCY_NOT_MERGED",
            `${absent.map(([a]) => a).join(", ")} reported, but your branch does not have that work yet: git merge ${absent.flatMap(([, c]) => c).join(" ")}, run your work against their code, fix what calls it wrongly, then complete() again.`,
            { notInYourBranch: Object.fromEntries(absent) },
          );
        }
        // in its own branch, what it changed is what its commits changed: ownership is checked on that, not on its list
        const changed = await this.changedInBranch(task);
        const unlisted = changed?.filter((f) => !(input.filesChanged ?? []).includes(f)) ?? [];
        const filesChanged = changed ? [...new Set([...(input.filesChanged ?? []), ...changed])] : input.filesChanged;
        const done = await this.service.completeImplementation({ taskId: task.id, summary: input.result, filesChanged, commits, tasksDone: input.tasksDone }).catch((e: unknown) => {
          if (isAppError(e) && e.code === "DEPENDENCY_NOT_READY") this.parkedOnDependency.add(`${task.id}:${task.syncRound}`); // wait for them, do not retry
          throw e;
        });
        warnings = [
          ...(done.warnings ?? []), ...(unreported ? [unreported.note] : []), ...(checked ? [checked] : []), ...this.ignoredFields(extra),
          ...(unlisted.length ? [`Your commits change files you did not list; they count as changed: ${unlisted.join(", ")}`] : []),
        ];
        action = "IMPLEMENTATION_COMPLETED";
        break;
      }
      case "SYNC": {
        const extra = given(["result", "filesChanged", "commits", "tasksDone", "followUps"]);
        if (input.status !== "PASS" && input.status !== "NEEDS_FIX") {
          throw invalid("complete() during SYNC requires 'status': \"PASS\" or \"NEEDS_FIX\" (with 'findings')");
        }
        await this.service.submitSync({ taskId: task.id, status: input.status, findings: this.findings(input.findings) });
        action = input.status === "PASS" ? "SYNC_PASS" : "SYNC_NEEDS_FIX";
        warnings = this.ignoredFields(extra);
        break;
      }
      case "INTEGRATE": {
        const extra = given(["filesChanged", "tasksDone"]);
        if (input.status !== "PASS" && input.status !== "NEEDS_FIX") {
          throw invalid("complete() during INTEGRATE requires 'status': \"PASS\" (merged, build and tests green) or \"NEEDS_FIX\" (with 'findings')");
        }
        if (!input.result?.trim()) throw invalid("complete() during INTEGRATE requires 'result': what you merged, where the result is, and the build/test outcome");
        const checked = input.status === "PASS" ? await this.checkProposal(task) : undefined;
        warnings = [...(checked ? [checked] : []), ...this.ignoredFields(extra)];
        const merged = await this.realCommits(task, input.commits);
        if (input.status === "PASS") await this.requireJobsMerged(task, merged?.[0]);
        const res = await this.service.submitIntegration({ taskId: task.id, status: input.status, result: input.result, commits: merged, findings: this.findings(input.findings), followUps: input.followUps });
        action = input.status === "PASS" ? "INTEGRATION_PASS" : "INTEGRATION_NEEDS_FIX";
        if (res.followUps.length) followUpsCreated = res.followUps.map((t) => ({ id: t.id, title: t.title, agents: t.agents }));
        break;
      }
      case "DONE":
        throw new AppError("INVALID_PHASE", "The task is already DONE; there is nothing to complete.");
    }
    const after = this.reply(await this.contextNow());
    const phaseChanged = (after.task as { phase: string } | null)?.phase !== task.phase ? { from: task.phase, to: (after.task as { phase: string }).phase } : undefined;
    return { ...after, ok: true, action, ...(phaseChanged ? { phaseChanged } : {}), ...(warnings?.length ? { warnings } : {}), ...(followUpsCreated ? { followUpsCreated } : {}) } as SwarmContext;
  }

  /** Fields complete() got that the current phase does not use: dropped, not fatal, named in a warning. */
  private ignoredFields(extra: string[]): string[] {
    return extra.length ? [`ignored fields not used in this phase: ${extra.join(", ")}`] : [];
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
    // an event that may change what the agent should do arrived while it waited (a part it depends on was reported, a
    // message, a new agreement...): then the same action is news again, not a repeat
    let woke = false;
    for (;;) {
      const current = await this.currentTask();
      if (current?.status === "BLOCKED" && current.handover) await this.service.escalateIfDue(current.id).catch(() => null); // nobody decided in time
      const ctx = await this.contextNow();
      const signature = this.signature(ctx);
      entry ??= signature;
      if ((ctx.pendingMessages as unknown[]).length > 0) return { ...this.reply(ctx), status: "MESSAGES" } as SwarmContext;
      if (ctx.nextAction === "done") return { ...this.reply(ctx), status: "DONE" } as SwarmContext;
      if (ctx.nextAction !== "wait") {
        // the agent was told this very action and calls wait() again with nothing changed: answering at once would make a
        // loop of model turns (a reviewer once spun 60 times in a minute); it waits for a change like any wait() instead
        const told = `${signature}|${ctx.nextAction}`; // not the hint: it carries the others' progress, which changes all the time
        if (told !== this.lastToldAction || woke) {
          this.lastToldAction = told;
          this.lastToldAt = Date.now();
          return { ...this.reply(ctx), status: "ACTION_REQUIRED" } as SwarmContext;
        }
      } else this.lastToldAction = null;
      if (signature !== entry) return { ...this.reply(ctx), status: "UPDATED" } as SwarmContext; // new task or phase change the agent should know about
      const left = deadline - Date.now();
      if (left <= 0 || signal?.aborted) {
        this.idleWaits++;
        // long enough: the next answer parks the session (the runner waits without a model)
        if (this.underRunner && this.idleWaits >= this.parkAfterWaits && !signal?.aborted) {
          const again = await this.contextNow();
          if (again.parked) return { ...this.reply(again), status: "DONE" } as SwarmContext;
        }
        return this.compact(ctx, "TIMEOUT");
      }
      // Consumes at most one event; the loop re-reads the (filesystem) state to decide whether it matters.
      // Waiting for the operator: look at the clock now and then, a question that timed out frees the agent.
      const operator = (ctx.waitingOn as string[] | undefined)?.includes(OPERATOR);
      const got = await this.service.waitForEvent({ timeoutMs: operator ? Math.min(left, OPERATOR_POLL_MS, this.operatorTimeoutMs) : left }, signal);
      // only what happened after the agent was told: older events it had not consumed yet are no news
      if (got.status === "EVENT" && (WAKES.has(got.event.type) || got.event.type === "MESSAGE_CREATED") && Date.parse(got.event.createdAt) > this.lastToldAt) woke = true;
    }
  }

  private signature(ctx: SwarmContext): string {
    const t = ctx.task as { id: string; phase: string; syncRound: number; status: string } | null;
    return t ? `${t.id}:${t.phase}:${t.syncRound}:${t.status}` : "none";
  }

  /**
   * What goes back to the agent. Every response stays in its context and is read again on every later turn, so a big
   * part it has already seen in this phase (the agreement, the OpenSpec task list, its ownership...) and that did not
   * change becomes "(unchanged)" instead of being repeated in each reply. swarm_context (fresh = true) always shows
   * everything of the phase; what it showed counts as seen.
   */
  private reply(ctx: SwarmContext, fresh = false): SwarmContext {
    const task = ctx.task as { id: string; phase: string; syncRound?: number } | null;
    if (!task) return ctx;
    const out: Record<string, unknown> = { ...ctx };
    let same = false;
    for (const key of SECTIONS) {
      if (!(key in out)) continue;
      const seen = `${task.id}:${task.phase}:${task.syncRound ?? 0}:${key}`; // a new phase or round shows everything once again
      const json = JSON.stringify(out[key]);
      if (!fresh && this.shownSections.get(seen) === json) {
        out[key] = UNCHANGED;
        same = true;
      } else this.shownSections.set(seen, json);
    }
    // the task's fixed fields (title, agents, lead, description...) once per session: they stay in the agent's context;
    // replies other than swarm_context then carry only what changes (phase, status, round, why it is blocked)
    if (out.task && typeof out.task === "object") {
      const t = out.task as Record<string, unknown>;
      if (!fresh && this.shownTaskFixed.has(task.id)) {
        const { id, phase, status, syncRound, maxFixRounds, blockedReason } = t;
        out.task = { id, phase, status, ...(syncRound !== undefined ? { syncRound, maxFixRounds } : {}), ...(blockedReason ? { blockedReason } : {}) };
        same = true;
      } else this.shownTaskFixed.add(task.id);
    }
    if (same) out.unchanged = UNCHANGED_NOTE;
    return out as SwarmContext;
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
  async errorBody(e: unknown, tool?: string): Promise<Record<string, unknown>> {
    const known = isAppError(e);
    // what the protocol refused, for the observer: one line per error in this agent's own file (one writer per file)
    if (tool) {
      const task = await this.currentTask().catch(() => null);
      await this.service.recordProtocolError({ tool, code: known ? e.code : "INTERNAL_ERROR", ...(task ? { taskId: task.id, phase: task.phase } : {}) }).catch(() => undefined);
    }
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
    // a runner's session stays with the task it was started for: done, it ends (nextAction done) instead of taking the next one
    if (this.sessionTask) {
      const own = await this.service.tasks.find(this.sessionTask);
      if (own?.status === "COMPLETED" || own?.status === "CANCELLED") return own;
    }
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
      myQuestions: messages.filter((m) => m.from === this.me && m.to === OPERATOR && m.type === "QUESTION" && !m.readAt),
      myLastMessageAt: messages.filter((m) => m.from === this.me && m.to !== OPERATOR).at(-1)?.createdAt,
      ...(task.phase === "INTEGRATE" ? { followUpBudget: await this.service.followUpBudget(task) } : {}),
      handoff: await this.handoffPhase(task),
      ...(task.phase === "SYNC" && task.syncRound > 1 ? { fixedFindings: await this.fixedFindings(task) } : {}),
      ...(task.phase === "IMPLEMENT" ? { ownBranch: await this.ownBranch(task) } : {}),
      ...(task.phase === "SYNC" ? { missingCommits: await this.missingCommits(task, impls) } : {}),
      ...(task.phase === "IMPLEMENT"
        ? { dependencyCommits: await this.dependencyCommits(agreement, impls), dependencyParked: this.parkedOnDependency.has(`${task.id}:${task.syncRound}`) }
        : {}),
      ...(task.openspec && task.phase !== "DONE" ? await this.readOpenspec(task.openspec.change) : {}),
      ...(task.phase === "DISCUSS" && task.agents[0] === this.me && !agreement ? await this.spawnableFor(task) : {}),
      ...((task.phase === "IMPLEMENT" || task.phase === "INTEGRATE") && task.agents[0] === this.me && !task.jobOf ? await this.delegableFor(task) : {}),
      ...(task.agents[0] === this.me && task.phase !== "DONE"
        ? await this.service.reviewComments(task.id).then((all) => {
            const open = all.filter((c) => c.status === "open").map(({ id, file, line, code, text }) => ({ id, file, ...(line !== undefined ? { line } : {}), ...(code ? { code } : {}), text }));
            return open.length ? { openReview: open } : {};
          })
        : {}),
      ...(task.planReview && task.phase === "DISCUSS" && !agreement
        ? await this.service.planState(task.id).then((st) => {
            const b = planBrief(st);
            return { plan: { status: b.status, version: b.version, approvedVersion: b.approvedVersion } };
          })
        : {}),
      ...(task.clarify && task.phase === "DISCUSS" && !agreement && !(task.grill ? grillConfirmed(messages, task.agents[0]!) : messages.some((m) => clarifies(m, task.agents[0]!))) ? { mustClarify: true } : {}),
      ...(task.proposes || task.grill
        ? {
            operatorAnswers: messages
              .filter((q) => q.to === OPERATOR && q.type === "QUESTION")
              .flatMap((q) => messages.filter((a) => a.from === OPERATOR && a.replyTo === q.id).map((a) => ({ question: q.content, askedBy: q.from, answer: a.content }))),
          }
        : {}),
    };
  }

  private async delegableFor(task: Task): Promise<Pick<Snapshot, "delegable" | "jobs">> {
    const { templates, maxPerTask } = await this.service.spawnTemplates();
    const jobs = await this.service.jobsOf(task.id);
    const left = maxPerTask - (task.spawned?.length ?? 0) - jobs.length;
    return {
      ...(templates.length && left > 0 ? { delegable: { templates, left } } : {}),
      ...(jobs.length ? { jobs: jobs.map((j) => ({ task: j.id, agent: j.agents[0]!, status: j.status === "COMPLETED" ? "done" : j.status === "CANCELLED" ? "cancelled" : j.status === "BLOCKED" ? "blocked" : "running", job: j.title.replace(/^task-\d+ job: /, ""), subtask: j.jobOf!.subtask })) } : {}),
    };
  }

  private async spawnableFor(task: Task): Promise<{ spawnable?: Snapshot["spawnable"] }> {
    if (!task.allowSpawn) return {};
    const { templates, maxPerTask } = await this.service.spawnTemplates();
    const left = maxPerTask - (task.spawned?.length ?? 0);
    const roles = (await this.service.roles()).map(({ name, description }) => ({ name, description }));
    return templates.length && left > 0 ? { spawnable: { templates, roles, left } } : {};
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
    return this.commitsNotHere(impls, this.service.phases.reviewees(task).filter((a) => a !== this.me));
  }

  /** IMPLEMENT: the commits of the agents this one depends on (dependsOn) that have reported, missing from its branch. */
  private async dependencyCommits(agreement: Agreement | null, impls: Implementation[]): Promise<Record<string, string[]>> {
    const deps = agreement?.assignments.find((a) => a.agentId === this.me)?.dependsOn ?? [];
    return deps.length ? this.commitsNotHere(impls.filter((i) => i.status === "READY_FOR_SYNC"), deps) : {};
  }

  /** agent -> its reported commits that this session's branch does not contain (empty when git cannot tell). */
  private async commitsNotHere(impls: Implementation[], targets: string[]): Promise<Record<string, string[]>> {
    this.workGit ??= readGitContext(this.workdir).catch(() => null);
    if (!(await this.workGit)) return {};
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
  /**
   * The commits an agent reports, checked against git: a short hash becomes the full one; a hash git does not know (made
   * up from a short one, mistyped) is refused, as is a commit outside its own branch. Outside a repository they pass as given.
   */
  private async realCommits(task: Task, commits: string[] | undefined): Promise<string[] | undefined> {
    if (!commits?.length || !task.git) return commits; // a task outside git: nothing to check them against
    const out: string[] = [];
    for (const c of commits) {
      const full = await resolveCommit(this.workdir, c.trim());
      if (full === undefined) return commits;
      if (full === null) {
        throw new AppError("INVALID_INPUT", `There is no commit ${c} in your repository (${this.workdir}). Copy the hash from git, never complete one: git log --oneline -3 shows your latest commits; pass the short hash as it is.`, { commit: c });
      }
      if ((await containsCommit(this.workdir, full)) === false) {
        throw new AppError("INVALID_INPUT", `Commit ${c} is not in your branch: report the commits your branch has (git log --oneline -5).`, { commit: c });
      }
      out.push(full);
    }
    return out;
  }

  /**
   * The lead's integration takes in the work it delegated: every commit a finished job reported must be in the merged
   * result. A job whose work the lead decides not to take is merged with "-s ours", which records the decision in git.
   */
  private async requireJobsMerged(task: Task, merged: string | undefined): Promise<void> {
    const jobs = (await this.service.jobsOf(task.id)).filter((j) => j.status === "COMPLETED");
    if (!jobs.length) return;
    const head = merged ?? (await readGitContext(this.workdir).catch(() => null))?.commit;
    if (!head) return;
    const missing: string[] = [];
    for (const job of jobs) {
      const impl = await this.service.implementations.find(job.id, job.agents[0]!);
      for (const c of impl?.commits ?? []) {
        const inIt = await this.ancestor(c, head);
        if (inIt === false || inIt === null) missing.push(`${c.slice(0, 7)} (${job.id}, ${job.agents[0]})`);
      }
    }
    if (missing.length) {
      throw new AppError(
        "JOBS_OPEN",
        `The work you delegated is not in the merged result: ${missing.join(", ")}. git merge <commit> each into your branch, run the build, then complete again; a job's work you decided not to take: git merge -s ours <commit> -m "<why>", which records that decision.`,
        { missing },
      );
    }
  }

  /** Is `commit` in the history of `head` (in this agent's repository)? null when git cannot tell. */
  private async ancestor(commit: string, head: string): Promise<boolean | null> {
    const full = await resolveCommit(this.workdir, commit);
    if (!full) return null;
    if (full === head || head.startsWith(full) || full.startsWith(head)) return true;
    const { execFile } = await import("node:child_process");
    return new Promise((done) => execFile("git", ["merge-base", "--is-ancestor", full, head], { cwd: this.workdir, timeout: 5000 }, (err) => done(!err ? true : (err as { code?: unknown }).code === 1 ? false : null)));
  }

  /** Files the commits of this agent's own branch changed since the task's base (others' merged work left out); null without one. */
  private async changedInBranch(task: Task): Promise<string[] | null> {
    if (!task.git || !(await this.ownBranch(task))) return null;
    return filesChangedSince(this.workdir, task.baseCommit ?? task.git.commit, await this.othersCommits(task), task.createdAt);
  }

  private async othersCommits(task: Task): Promise<string[]> {
    return (await this.service.implementations.list(task.id)).filter((i) => i.agentId !== this.me).flatMap((i) => [...i.commits, ...(i.commitsBeforeFix ?? [])]);
  }

  private async unreportedWork(task: Task, reported: string[]): Promise<{ head?: string; note: string } | undefined> {
    const branch = await this.ownBranch(task);
    if (!branch || !task.git || (await this.service.ownership(task.id)).reviewOnly) return undefined;
    const head = (await readGitContext(this.workdir).catch(() => null))?.commit;
    if (!head) return undefined;
    // no commit of its own for this task (an old head from an earlier task, or only merges, is not its work)
    const own = await ownCommitsSince(this.workdir, task.baseCommit ?? task.git.commit, await this.othersCommits(task), task.createdAt);
    if (head === (task.baseCommit ?? task.git.commit) || (own && !own.length)) {
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
    if (d.park) {
      await this.service.park(task);
      return { task: { id: task.id, title: task.title, phase: task.phase, status: task.status }, agent, parked: true, pendingMessages: [], waitingOn: d.waitingOn, allowedActions: d.allowedActions, nextAction: d.nextAction, hint: d.hint };
    }
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
    // the lead took over this round's fix of the stuck agents: their findings are its own
    const takenOver = task.takeover && task.takeover.round === task.syncRound && phases.integrator(task) === this.me ? task.takeover.from : [];
    const fixRequests =
      phase === "IMPLEMENT" && task.syncRound > 0
        ? [...reports, ...integrations]
            .filter((r) => r.status === "NEEDS_FIX")
            .flatMap((r) => r.findings.map((f) => ({ ...f, reportedBy: r.agentId, forYou: !f.relatedAgent || f.relatedAgent === this.me || takenOver.includes(f.relatedAgent) })))
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
        ...(task.proposes ? { proposes: { change: task.proposes.change, path: `${changePath(task.proposes.change)}/` } } : {}),
        ...(task.blockedReason ? { blockedReason: task.blockedReason } : {}),
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(task.baseCommit ? { baseCommit: task.baseCommit } : {}),
      },
      agent,
      ...(myAssignment ? { assignment: { responsibility: myAssignment.responsibility } } : {}),
      ...this.openspecView(snap, full),
      ...(snap.spawnable ? { spawnable: snap.spawnable } : {}),
      ...(snap.delegable ? { delegable: snap.delegable } : {}),
      ...(snap.jobs ? { jobs: snap.jobs } : {}),
      ...(snap.openReview ? { reviewComments: snap.openReview } : {}),
      ...(snap.plan ? { plan: snap.plan } : {}),
      ...(snap.operatorAnswers?.length && task.proposes && phase !== "DISCUSS" && phase !== "DONE" ? { operatorAnswers: snap.operatorAnswers } : {}),
      // a grilled task with a plan: the decisions the plan must carry, while the plan is written
      ...(snap.operatorAnswers?.length && task.grill && snap.plan && snap.plan.status !== "approved" ? { grillDecisions: snap.operatorAnswers } : {}),
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
      ...(show(["IMPLEMENT"]) && myAssignment?.dependsOn?.length
        ? {
            dependsOn: myAssignment.dependsOn.map((id) => {
              const i = impls.find((x) => x.agentId === id);
              const reported = i?.status === "READY_FOR_SYNC";
              return { agentId: id, reported, ...(reported ? nonEmpty("commits", i.commits) : {}), ...nonEmpty("notInYourBranch", snap.dependencyCommits?.[id] ?? []) };
            }),
          }
        : {}),
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
    // a question to the operator holds the asker for a while; with no answer it goes ahead with its own proposal and says so
    const dueAt = (m: Message) => Date.parse(m.createdAt) + this.operatorTimeoutMs;
    const minutes = Math.round(this.operatorTimeoutMs / 60_000);
    const asked = s.myQuestions.find((m) => dueAt(m) > Date.now());
    const timedOut = s.myQuestions.find((m) => dueAt(m) <= Date.now());
    if (asked && s.task.phase !== "DONE") {
      const waitingOn = [...new Set([...core.waitingOn, OPERATOR])];
      const what = `Your question to the operator (${asked.id}) has no answer yet.`;
      const left = `If none comes within ${minutes} min of asking, go ahead with the option you proposed in it.`;
      d =
        core.nextAction === "propose" || core.nextAction === "approve"
          ? { nextAction: "wait", allowedActions: [...new Set(["wait", ...core.allowedActions])], hint: `${what} Call wait(): the answer arrives in pendingMessages; propose or approve after it. ${left}`, waitingOn }
          : { ...core, hint: `${what} Continue with what does not depend on it. ${core.hint}`, waitingOn };
    } else if (timedOut && s.mustClarify && s.task.grill) {
      // a grilling waits for the operator: its answers are the point, so no going ahead on a recommendation
      d = { ...core, hint: `The operator has not answered your question ${timedOut.id} for ${minutes} min. This task is a grilling: do not go ahead on your recommendation; ask the rest of the round if any is left, then wait(). ${core.hint}` };
    } else if (timedOut && s.plan && s.plan.status !== "approved") {
      // a plan the operator approves: no answer in time is no licence to go ahead, the recommendation goes into the plan
      d = {
        ...core,
        hint: `The operator has not answered your question ${timedOut.id} for ${minutes} min. Do not go ahead past the plan: write your recommended option into it (plan({edits}), marked as your recommendation) and wait() — the operator decides when it reviews and approves the plan. ${core.hint}`,
      };
    } else if (timedOut && s.task.phase !== "DONE" && !(s.myLastMessageAt && Date.parse(s.myLastMessageAt) >= dueAt(timedOut))) {
      d = {
        ...core,
        hint:
          `The operator has not answered your question ${timedOut.id} for ${minutes} min: go ahead with ${timedOut.choices?.recommended ? `your recommended option "${timedOut.choices.recommended}"` : "the option you proposed in it (none proposed: the safest one)"} and say so, ` +
          `send_message to the other agents ("no answer from the operator on ${timedOut.id} in ${minutes} min, I go ahead with <option>") and in your result. ` +
          `If the answer still comes, it arrives in pendingMessages. ${core.hint}`,
      };
    }
    // the operator's comments on the diff come first: the lead cannot hand in its part or the integration while one is open
    if (s.openReview?.length) {
      d = {
        ...d,
        allowedActions: [...new Set([...d.allowedActions, "resolve_comments"])],
        hint: `The operator left ${s.openReview.length} review comment(s) on the diff ('reviewComments': ${s.openReview.map((c) => c.id).join(", ")}): fix each, or have the agent who owns the file fix it (send_message), then mark it resolve_comments({resolve: [{id, status: "fixed", note: "<what changed>"}]}); one you disagree with: status "declined" with the reason. complete() is refused while any is open. ${d.hint}`,
      };
    }
    // the lead may hand a self-contained piece to a new runner while it works or integrates
    if (s.delegable && d.nextAction !== "done" && d.nextAction !== "wait") {
      d = {
        ...d,
        allowedActions: [...new Set([...d.allowedActions, "delegate"])],
        hint: `${d.hint} A self-contained piece you would otherwise do yourself or skip (a load or concurrency test, a diagnosis, a migration dry run, a benchmark) can go to a new runner: commit your work, then delegate({template, job, files}) ('delegable': ${s.delegable.templates.map((t) => t.name).join(", ")}; ${s.delegable.left} left). It becomes your open subtask; its result and commits come back in pendingMessages.`,
      };
    }
    if (s.jobs?.some((j) => j.status === "running" || j.status === "blocked") && d.nextAction === "wait") {
      d = { ...d, hint: `${d.hint} Your delegated jobs still run: ${s.jobs.filter((j) => j.status === "running" || j.status === "blocked").map((j) => `${j.task} (${j.agent})`).join(", ")}.` };
    }
    // under a runner, waiting for the other agents costs a model turn per wait(): park instead (not while a question of
    // its own runs against the clock, and not with unread messages, which a fresh session must still see)
    if (d.nextAction !== "wait") this.idleWaits = 0;
    if (this.underRunner && d.nextAction === "wait" && this.idleWaits >= this.parkAfterWaits && s.task.status === "ACTIVE" && !s.myQuestions.length && !s.unread.length && !s.openFromMe.length) {
      return {
        nextAction: "done",
        allowedActions: [],
        hint: `Nothing for you to do until the others move (${d.waitingOn.filter((a) => a !== this.me).join(", ") || "the team"}): end your session now, with no more tool calls. The runner waits without a model and starts a fresh session as soon as something changes for you (a phase, a message, a report).`,
        waitingOn: d.waitingOn.filter((a) => a !== this.me),
        park: true,
      };
    }
    const example = this.example(s.task, d.nextAction, s.mustClarify || !d.allowedActions.includes("propose"));
    return example ? { ...d, exampleCall: example } : d;
  }

  /** A ready-to-copy call where the arguments have structure (the agreement); simpler calls are spelled out in the hint. */
  private example(task: Task, next: NextAction, clarifying = false): Decision["exampleCall"] {
    if (next !== "propose" || clarifying) return undefined;
    if (task.proposes) {
      const dir = `${changePath(task.proposes.change)}/**`;
      return { tool: "propose", args: { summary: `Write the OpenSpec change ${task.proposes.change}`, assignments: task.agents.map((agentId, i) => (i === 0 ? { agentId, responsibility: "writes the change", files: [dir] } : { agentId, responsibility: "reviews the change", files: [] })) } };
    }
    const tasks = task.openspec ? { tasks: ["<tasks.md numbers this agent implements; [] = review only>"] } : {};
    return { tool: "propose", args: { summary: "<what the team will build>", assignments: task.agents.map((agentId) => ({ agentId, responsibility: "<what this agent does>", files: ["<files or globs it changes; [] = review only>"], ...tasks })) } };
  }

  private decideCore(s: Snapshot): Decision {
    const { task, agreement, impls, reports } = s;
    const mine = impls.find((i) => i.agentId === this.me);
    const lead = task.agents[0];
    const done = (nextAction: NextAction, allowed: string[], hint: string, waitingOn: string[]): Decision => ({ nextAction, allowedActions: allowed, hint, waitingOn });

    if (task.status === "CANCELLED") return done("done", [], "The operator cancelled the task: end your session now, with no more tool calls. The runner starts your next task in a fresh session.", []);
    if (task.status === "BLOCKED") {
      const why = `BLOCKED: ${task.blockedReason ?? "the fix-round limit was reached"}. The operator decides`;
      return this.underRunner
        ? done("done", [], `${why}: end your session now; the runner starts a new one when the task is unblocked.`, [])
        : done("wait", ["send_message", "wait"], `${why}; call wait().`, ["operator"]);
    }
    const phases = this.service.phases;
    const spec = task.openspec ? changePath(task.openspec.change) : null;
    // a change-writing task: the lead writes openspec/changes/<name>/, the others review it; no code
    const writes = task.proposes ? changePath(task.proposes.change) : null;
    const name = task.proposes?.change;
    const planOnly = "This task writes an OpenSpec change, not code: your role instructions about code, tests and builds do not apply here. ";
    if (writes) {
      if (task.phase === "DISCUSS" && !agreement) {
        return this.me === lead
          ? done("propose", ["send_message", "propose", "wait"], `${planOnly}propose() right away (see exampleCall): you, the author, get files ["${writes}/**"], every other agent files [] (they review the change).`, [...task.agents])
          : done("wait", ["send_message", "propose", "wait"], `${planOnly}You review the change ${writes}/ that ${lead} writes (files: []). wait() for the proposal.`, [lead!]);
      }
      if (task.phase === "IMPLEMENT" && this.me === lead && mine?.status !== "READY_FOR_SYNC") {
        const how =
          `Write ${writes}/: use the openspec-propose skill if you have it (planning only), otherwise run \`openspec new change ${name}\`, then \`openspec instructions <proposal|specs|design|tasks> --change ${name}\` for each artifact and follow it. ` +
          `proposal.md: why and what changes. specs/<capability>/spec.md: requirements, each with "#### Scenario:" WHEN/THEN steps concrete enough to become a test (inputs, expected result, errors and edge cases too). design.md: how, decisions with their reasons. tasks.md: small numbered tasks "- [ ] 1.1 ...", every scenario covered by a task. ` +
          `Read the code the change touches, but change no code. A decision only the user can make (business rule, scope, compatibility): ask the operator with send_message({to: "operator", options, recommended}); write the other assumptions into proposal.md or design.md. ` +
          `Record every answer of the operator ('operatorAnswers') as a decision in design.md (the question, the answer, what it means for the change): the session that implements the change sees only its files, not this conversation. ` +
          `Run \`openspec validate ${name} --strict\` and fix what it reports; commit the folder; then complete({result: <capabilities, number of scenarios and tasks, open questions>}): complete() runs the validation itself.`;
        return task.syncRound > 0
          ? done("fix", ["send_message", "subtasks", "complete", "wait"], `${planOnly}Fix the change as 'fixRequests' (forYou) say; every answer in 'operatorAnswers' must be a decision in design.md. Validate (\`openspec validate ${name} --strict\`), commit, then complete({result}).`, [lead!])
          : done("implement", ["send_message", "subtasks", "complete", "wait"], `${planOnly}${how}`, [lead!]);
      }
      if (task.phase === "SYNC" && this.me !== lead && !reports.some((r) => r.agentId === this.me) && phases.reviewees(task).includes(lead!)) {
        const pending = phases.reviewers(task).filter((id) => !reports.some((r) => r.agentId === id));
        const absent = Object.entries(s.missingCommits ?? {});
        const fresh = absent.length ? `First bring the change into your folder: git merge ${absent.flatMap(([, cs]) => cs).join(" ")}. ` : "";
        return done(
          "sync",
          ["send_message", "complete", "wait"],
          `${planOnly}${fresh}Review the change ${writes}/ by ${lead}${task.syncRound > 1 ? " ('fixedFindings': check each fix)" : ""}: use the java-spec-review skill if you have it, but change no file and ask the user nothing directly. ` +
            `Check: each scenario says what the operator asked for in task.description — compare numbers, thresholds and boundaries word by word ("from the fifth order" means the 5th order gets it, not the 6th), and every answer in 'operatorAnswers' is recorded as a decision in design.md and followed by the specs (the implementing session sees only the files); every scenario can become a test (concrete inputs, expected result); every requirement has scenarios, errors and edge cases included; tasks.md covers every scenario; design.md matches the code as it is (read it); no decision is hidden or left open. ` +
            `Questions only the user can answer: send_message({to: "operator"}). Then complete({status: "PASS"}) (WARNING/INFO allowed) or complete({status: "NEEDS_FIX", findings}) with ERROR findings for ${lead}.`,
          pending,
        );
      }
      if (task.phase === "INTEGRATE" && this.me === lead) {
        return done(
          "integrate",
          ["send_message", "complete", "wait"],
          `${planOnly}Nothing to merge: the reviewers change nothing. Check that every answer in 'operatorAnswers' (also ones that came after the review) is a decision in design.md. Run \`openspec validate ${name} --strict\` once more, make sure ${writes}/ is committed, then complete({status: "PASS", result: <what the change covers, open questions>}). The operator reviews it, merges it and starts a task that implements it.`,
          [lead!],
        );
      }
    }
    switch (task.phase) {
      case "DISCUSS": {
        if (!agreement) {
          const base = ["send_message", "propose", "wait"];
          const split = spec
            ? `This task implements the OpenSpec change ${spec}/ ('openspec'): read its proposal.md, design.md and specs/, then split it without redesigning: every open task of tasks.md goes to exactly one agent (assignments[].tasks: ["1.1", ...]) together with the files those tasks change; ${spec}/ stays with you, the lead. If the design has to change, ask the operator. `
            : "";
          const grow = s.spawnable
            ? `If the work splits into more independent parts than the team has agents, or needs a specialist (architecture review, load tests, security...), add up to ${s.spawnable.left} agent(s) first with spawn_agent({template, reason, role?}) ('spawnable': templates ${s.spawnable.templates.map((t) => t.name).join(", ")}${s.spawnable.roles.length ? `; roles of the project's library: ${s.spawnable.roles.map((r) => r.name).join(", ")}` : ""}): the template is how it runs, the role what it does — a library role by name, or your own with role + instructions. Only when it really saves time, each agent costs tokens. `
            : "";
          if (s.mustClarify && task.grill) {
            return this.me === lead
              ? done(
                  "propose",
                  ["send_message", "wait", ...(s.spawnable ? ["spawn_agent"] : [])],
                  `The operator asked to be grilled about the task before anything else: reach a shared understanding, nothing silently assumed. Read task.description and the code it touches first: facts from the code are yours to find, never a question. Ground the options in the project as it is: read its build file (pom.xml, build.gradle, package.json...) and the code first, and recommend what fits what is there (its frameworks, its storage, no new dependency); a new framework, database or dependency may be an option, never your recommendation unless the task asks for it. ` +
                    `Map the decisions as a tree (scope, behaviour, edge cases and errors, data and compatibility, what counts as done, what must not change). Work it in rounds: ask every question whose prerequisites are settled, now — a separate send_message({to: "operator", message, options: [{label, description}], recommended}) for EACH question (never several questions in one message: the operator answers each with its own options), numbered "Q1", "Q2"... in the message, labels of 1-5 words (details go in description), your recommended answer in recommended; never ask again what the operator already answered; a question that depends on an open one waits for the next round. Then wait() for the answers; each answer reshapes the tree, ask the next round. ` +
                    `When no branch is left: send your summary as one question — send_message({to: "operator", message: "How I understand it: <every decision, short>. Is that right?", options: [{label: "Yes, that's it"}, {label: "No, I will correct it"}], recommended: "Yes, that's it"}). propose() is accepted after the operator's yes; a "no" with a correction is the next round. Use the grilling skill if you have it.`,
                  ["operator"],
                )
              : done("wait", base, `${lead} (the lead) grills the operator about the task first; tell it what is unclear to you (send_message), then wait().`, [lead!]);
          }
          if (s.mustClarify) {
            return this.me === lead
              ? done(
                  "propose",
                  ["send_message", "wait", ...(s.spawnable ? ["spawn_agent"] : [])],
                  `First check the task (the operator asked for it): read task.description and the code it touches. Anything unclear that would change the scope, the behaviour or what counts as done: ask the operator — send_message({to: "operator", message, options: [{label, description}], recommended}), one question per message, the options you see; then wait() for the answers. Ground the options in the project as it is: read its build file (pom.xml, build.gradle, package.json...) and the code first, and recommend what fits what is there (its frameworks, its storage, no new dependency); a new framework, database or dependency may be an option, never your recommendation unless the task asks for it. ` +
                    `Everything clear: tell the operator in a few lines how you understood it — send_message({to: "operator", fyi: true, message: "How I understand it: <what changes, where, what stays as it is>. No questions."}), starting with "How I understand it:". propose() is accepted after a question or that note; other notes (an error, a status) do not count.`,
                  ["operator"],
                )
              : done("wait", base, `${lead} (the lead) checks the task with the operator first; tell it what is unclear to you (send_message), then wait().`, [lead!]);
          }
          if (s.plan && s.plan.status !== "approved") {
            const tools = ["send_message", "plan", "wait", ...(s.spawnable ? ["spawn_agent"] : [])];
            if (this.me !== lead) return done("wait", ["send_message", "wait"], `${lead} (the lead) writes the plan for the operator, who approves it before the agreement. Tell ${lead} what you would take or what worries you (send_message), then wait().`, [lead!]);
            if (s.plan.status === "none") {
              return done(
                "propose",
                tools,
                `${split}${grow}The operator asked for a plan before the agreement. Read task.description and the code it touches, talk it over with the others if it helps (send_message), then write the plan as ONE self-contained HTML page: plan({html, note}). ` +
                  `What it shows: the goal in two lines; what changes, where (files, classes, endpoints); who of the team does what, with the files of each; contracts (method, path, body, status codes; types); the order of work and what depends on what; risks and how you check the result (tests, build). ` +
                  `A decision for the operator: <div data-question="<the question>"> with <label><input type="radio" name="q1" value="<option>"> <option></label> per option (checkboxes when several fit), your recommendation in the text. ` +
                  `Short and scannable: headings, lists, tables; inline <style> and inline <svg> only, no external files (a diagram may use <pre class="mermaid"> with <script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";m.initialize({startOnLoad:true})</script>). ` +
                  (task.grill ? `The grilling settled decisions ('grillDecisions'): put every one into the plan as a section "Decided in the grilling" (the question, the answer, what it means for the plan), and follow them everywhere else in it. ` : "") +
                  `The operator comments on it, edits it in place and approves it on the page; their feedback reaches you in pendingMessages. propose() is accepted after the approval.`,
                ["operator"],
              );
            }
            if (s.plan.status === "revising") {
              return done(
                "propose",
                tools,
                `The operator sent feedback on plan v${s.plan.version} (in pendingMessages or messages: comments, in-place edits, answers). Work it in: plan({edits: [{find, replace}], note: "<what changed>"}) for local changes (read the current page with plan({read: true}) first if the operator edited it), plan({html, note}) to rewrite it. Nothing to change after all? plan({note: "<why it stays as it is>"}) sends the same page again for the operator to approve. A question you cannot settle: send_message({to: "operator"}).`,
                ["operator"],
              );
            }
            return done("wait", tools, `The operator reviews plan v${s.plan.version} on the page. wait(): comments, edits or the approval arrive in pendingMessages; propose() after the approval.`, ["operator"]);
          }
          const approved = s.plan?.approvedVersion ? `The operator approved plan v${s.plan.approvedVersion}: the agreement follows it (assignments, files, contracts). ` : "";
          return this.me === lead
            ? done("propose", s.spawnable ? [...base, "spawn_agent"] : base, `${approved}${split}${grow}Split the work as task.description says who does what (an agent it gives tests gets its own test files: never take its part over and leave it files: []). Agree with the others who changes which files (send_message), then propose(): one assignment per agent, every file with ONE owner; an agent with nothing of its own to change gets files: [] (review only). Write the exact contracts into interfaces (method, path, headers, body, status codes); an agent whose work calls another agent's new code (e.g. API tests) gets dependsOn: [that agent].`, [...task.agents])
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
        const takeover = task.takeover?.round === task.syncRound ? task.takeover : undefined;
        if (mine?.status === "READY_FOR_SYNC") {
          const taken = takeover?.from.includes(this.me) ? `${lead} (the lead) took over your fix this round. ` : "";
          return done("wait", ["send_message", "wait"], `${taken}Your part is ready. Waiting for: ${pending.join(", ")}.`, pending);
        }
        const myAssignment = agreement?.assignments.find((a) => a.agentId === this.me);
        // parked on a dependency (its complete() was refused): it waits, whatever its assignment says it should do now
        const waitingDeps = (myAssignment?.dependsOn ?? []).filter((d) => !impls.some((i) => i.agentId === d && i.status === "READY_FOR_SYNC"));
        if (waitingDeps.length && s.dependencyParked) {
          return done("wait", ["send_message", "subtasks", "wait"], `Your part waits for ${waitingDeps.join(", ")} (dependsOn): call wait(), you are woken when ${waitingDeps.length > 1 ? "they report" : "it reports"}.`, waitingDeps);
        }
        if (task.syncRound === 0 && isReviewOnly(myAssignment, task)) {
          return done("implement", ["send_message", "complete", "wait"], 'Your assignment has no files: review only, you change nothing in this task. Mark your part ready now with complete({result: "review only: nothing to change"}); you review in SYNC.', pending);
        }
        // the lead's own steps are done and only its delegated jobs are open: it waits for them (wait() would return at
        // once with "implement" otherwise, a model turn each time)
        const running = (s.jobs ?? []).filter((j) => j.status === "running" || j.status === "blocked");
        const myOpen = (s.subtasks.find((l) => l.agentId === this.me)?.items ?? []).filter((i) => i.status === "TODO" || i.status === "DOING");
        if (running.length && myOpen.length && myOpen.every((i) => running.some((j) => j.subtask === i.id))) {
          return done("wait", ["send_message", "subtasks", "wait"], `Your own steps are done; your delegated jobs still run: ${running.map((j) => `${j.task} (${j.agent})`).join(", ")}. wait(): their results arrive in pendingMessages; then merge their commits and complete().`, running.map((j) => j.agent));
        }
        const deps = myAssignment?.dependsOn ?? [];
        const depsWaiting = deps.filter((d) => !impls.some((i) => i.agentId === d && i.status === "READY_FOR_SYNC"));
        if (depsWaiting.length && s.dependencyParked) {
          return done(
            "wait",
            ["send_message", "subtasks", "wait"],
            `Your part waits for ${depsWaiting.join(", ")} (dependsOn): call wait(), you are woken when ${depsWaiting.length > 1 ? "they report" : "it reports"}. Then merge their commits, run your work against their code and complete().`,
            depsWaiting,
          );
        }
        const toMerge = Object.entries(s.dependencyCommits ?? {});
        const dep = depsWaiting.length
          ? `Your work calls the new code of ${depsWaiting.join(", ")} (dependsOn): write it now from agreement.interfaces and the code as it is (read the controllers and request/response classes; never guess a path, header or field). complete() is accepted after ${depsWaiting.length > 1 ? "they report" : "it reports"} and you ran your work against that code. `
          : toMerge.length
            ? `${toMerge.map(([a]) => a).join(", ")} reported: git merge ${toMerge.flatMap(([, c]) => c).join(" ")} into your branch, run your work against their code and fix what calls it wrongly before complete(). `
            : deps.length
              ? `${deps.join(", ")} reported and your branch has that work: run your work against it before complete(). `
              : "";
        const base = (task.jobOf
          ? `A job ${task.jobOf.by} (the lead of ${task.jobOf.taskId}) delegated to you: you do it alone, nobody reviews it; your complete() ends it and sends your result to ${task.jobOf.by}. ${task.baseCommit ? `In your own git branch, first git merge ${task.baseCommit} (the lead's code). ` : ""}`
          : task.baseCommit ? `Follow-up of ${task.parentTaskId}: in your own git branch, first git merge ${task.baseCommit}. ` : "") + dep;
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
        const takeOver =
          takeover && this.me === lead
            ? `${takeover.by === "timeout" ? "The operator did not decide in time" : "The operator handed it to you"}: you take over the fix of ${takeover.from.join(", ")} this round. ` +
              `Their findings are in fixRequests (forYou), their files are granted to you (ownership.grantedToYou). If you cannot fix it either, say why in result: the task then goes to the operator. `
            : "";
        return task.syncRound > 0
          ? done("fix", ["send_message", "subtasks", "complete", "wait"], `${takeOver}${base}Fix what 'fixRequests' (forYou) name. ${plan}${commit}${finish}`, pending)
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
          `${fresh}Review ${scope} ('teamImplementations': their changed files and commits) against the task and the agreement: judge the code, not what its authors say about it. Work done in another branch is in its commits (git show <hash>); if a change listed in filesChanged is not visible to you, ask its author with send_message to commit it and wait() for the reply instead of reporting it missing. Look at the whole change, not only the listed files: git diff --stat ${(task.baseCommit ?? task.git?.commit ?? "<the task's base>").slice(0, 7)} <their last commit> — a file outside the agreement or unrelated to the task (pulled in by a merge, say) is an ERROR. Then read the diff one file at a time (git diff <base> <commit> -- <file>), not all of it at once: every line you read stays in your context.${task.syncRound > 1 ? " 'fixedFindings' lists what the fixes had to address: check each one." : ""}${spec ? ` Check each task in their tasksDone against its scenarios in ${spec}/specs/.` : ""} Then complete({status: "PASS"}) (WARNING/INFO findings allowed) or complete({status: "NEEDS_FIX", findings}) with an ERROR naming the agent to fix in relatedAgent.`,
          pending,
        );
      }
      case "INTEGRATE": {
        const lead = phases.integrator(task);
        if (this.me !== lead) return done("wait", ["send_message", "wait"], `${lead} is integrating. Waiting for: ${lead}.`, [lead]);
        const verify = task.verifyCommand
          ? `\`${task.verifyCommand}\` with build() (no command) after you committed the merged result — PASS is accepted only from that green run on the commit you report (commits: [HEAD])`
          : "the build and all tests (with the build tool)";
        const left = s.followUpBudget?.remaining ?? 0;
        const followUps = left ? ` With PASS, left-over work ('followUps.notes', things you noticed) can become up to ${left} follow-up task(s): followUps: [{title, description}], each concrete.` : "";
        return done(
          "integrate",
          ["send_message", "complete", "wait"],
          `Bring everyone's work together (merge their branches if they use worktrees; and the commits of your delegated jobs), check that git diff --stat ${(task.baseCommit ?? task.git?.commit ?? "<the task's base>").slice(0, 7)} HEAD holds only the task's files, run ${verify} on the result, ` +
            (spec
              ? `tick [x] in ${spec}/tasks.md the tasks reported done ('openspec.tasks') and run \`openspec validate ${task.openspec!.change} --strict\` if the openspec CLI is installed, then complete({status: "PASS", result}) naming the tasks left open, `
              : `then complete({status: "PASS", result}) `) +
            `or complete({status: "NEEDS_FIX", result, findings}) with an ERROR naming the agent.` + followUps,
          [lead],
        );
      }
      case "DONE":
        return done("done", [], this.sessionTask === task.id ? "The task is done: end your session now, with no more tool calls. The runner starts your next task in a fresh session." : "The task is done.", []);
    }
  }

  /**
   * A change-writing task: the author hands the change over only when it validates (openspec validate --strict in its
   * folder; without the CLI, its form). Returns a note when only the form could be checked; other agents: nothing.
   */
  private async checkProposal(task: Task): Promise<string | undefined> {
    if (!task.proposes || this.service.phases.integrator(task) !== this.me) return undefined;
    const name = task.proposes.change;
    const r = await validateChange(this.workdir, name, this.openspecExec);
    if (!r.ok) {
      throw new AppError("OPENSPEC_INVALID", `The change ${changePath(name)}/ is not ready${r.cli ? ` (openspec validate ${name} --strict)` : ""}: ${r.output}. Fix it, commit, then complete() again.`, { output: r.output });
    }
    return r.cli ? undefined : `openspec CLI not installed: only the form of ${changePath(name)}/ was checked`;
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
