export type AgentStatus = "ONLINE" | "WORKING" | "WAITING" | "OFFLINE";

export interface Agent {
  id: string;
  type: string;
  role?: string;
  status: AgentStatus;
  registeredAt: string;
  lastSeenAt: string;
  /** Extension: pid of the MCP process that owns this identity (used to detect duplicate live agents). */
  pid?: number;
}

export type Phase = "DISCUSS" | "IMPLEMENT" | "SYNC" | "INTEGRATE" | "DONE";
/** BLOCKED: the fix-round limit was reached and reviews still fail, or its cost limit was reached (blockedBy "cost"); only the operator can unblock or cancel it. */
export type TaskStatus = "ACTIVE" | "BLOCKED" | "COMPLETED" | "CANCELLED";

export interface GitContext {
  repositoryRoot: string;
  branch: string;
  commit: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  phase: Phase;
  status: TaskStatus;
  agents: string[];
  createdAt: string;
  updatedAt: string;
  /** Extension: who created the task. */
  createdBy: string;
  /** Extension: git state at creation time, null when the project is not a git repository. */
  git: GitContext | null;
  /** Extension: number of the current/last SYNC round; incremented on every IMPLEMENT -> SYNC. */
  syncRound: number;
  /**
   * How many times reviews may send the task back to IMPLEMENT. A NEEDS_FIX in round maxFixRounds + 1 blocks
   * the task instead (status BLOCKED) until the operator unblocks or cancels it. Absent on old tasks (default 3).
   */
  maxFixRounds?: number;
  /** Agents whose work the next/current SYNC round reviews: the agents that just fixed. Absent = everyone. */
  reviewScope?: string[];
  /** The SYNC round in which the operator unblocked the task: that round's stalled fix does not block it again. */
  unblockedAtRound?: number;
  /**
   * BLOCKED with a fallback: unless the operator decides by dueAt, the lead takes over the fix of `from` for one round
   * (their findings, with their files granted to it). Absent when the lead itself has to fix, and after a takeover.
   */
  handover?: { dueAt: string; from: string[]; lead: string };
  /** The lead took over the fix of these agents in this round; if the task fails again, it stays BLOCKED for the operator. */
  takeover?: { from: string[]; round: number; by: "operator" | "timeout" };
  /** Legacy (tasks created before commits became optional); ignored. */
  requireCommits?: boolean;
  /** Build/test command the integrator runs on the merged result, e.g. "mvn -q verify". */
  verifyCommand?: string;
  /** Why the task is BLOCKED. */
  blockedReason?: string;
  /** BLOCKED by its cost limit (maxCostUsd: unblocking raises it) or by an agent's runner that gave up (unblocking retries). */
  blockedBy?: "cost" | "runner";
  /** Cost limit in USD over all agent sessions of this task: reached, the task is BLOCKED until the operator raises it. */
  maxCostUsd?: number;
  /** After DONE: the lead's branch merged into the project's branch by the operator (the page's "Влить в проект"). */
  merged?: {
    at: string; branch: string; into: string; commit: string; already: boolean;
    /** squash: the task is one commit; merge: a merge commit. */
    strategy?: "squash" | "merge";
    /** verifyCommand ran green on this very commit before it reached the project (the merge check). */
    verified?: { command: string; tests?: { total: number; failed: number } };
    /** Merged without that check: no verifyCommand, or the operator merged a red one anyway. */
    unverified?: true;
    /** "Откатить": the revert commit that undid it. */
    reverted?: { at: string; commit: string };
  };
  /** After DONE: the operator's verdict on the acceptance page (returned: the follow-up task with its comments). */
  acceptance?: { status: "accepted" | "returned"; at: string; followUp?: string };
  /** Follow-up: the task whose integration created this one. */
  parentTaskId?: string;
  /** Follow-up: the first task of the chain (the one the operator created). */
  rootTaskId?: string;
  /** Follow-up: merged HEAD of the parent. Agents merge it into their branch first; their commits must descend from it. */
  baseCommit?: string;
  /** Chain root only: how many follow-up tasks the leads of this chain may create in total. 0 / absent = none. */
  maxFollowUps?: number;
  /** Chain root only: follow-up tasks created so far in the chain. */
  followUpsUsed?: number;
  /** When the task entered each phase (for the time statistics). Absent on tasks created before it existed. */
  phaseHistory?: { phase: Phase; at: string }[];
  /**
   * The task implements this OpenSpec change (openspec/changes/<change>/ in the project folder): the agents split its
   * tasks.md by task number, report done numbers, the lead ticks them; the operator archives the change after DONE.
   */
  openspec?: { change: string; archivedAt?: string };
  /**
   * The task WRITES this OpenSpec change (openspec/changes/<change>/, which does not exist yet): the lead writes it, the
   * others review it; no code is changed. After DONE the operator merges it and starts a task that implements it.
   */
  proposes?: {
    change: string;
    /**
     * Analysts' artifacts the change is written from (files under tasks/<id>/input/, project-relative names): input, not
     * the change. The lead shows them to the operator as a page first (plan stage "input"), grills the operator, writes its
     * own change and shows it next to the input (plan stage "change"); complete() waits for the operator's acceptance.
     */
    input?: string[];
  };
  /**
   * The lead checks the task before anything else: it asks the operator what is unclear, or tells it how it understood
   * the task (fyi). propose() is refused until it has written to the operator.
   */
  clarify?: true;
  /**
   * With clarify: the lead grills the operator about the task in rounds of questions (each with its recommendation), then
   * asks it to confirm its summary ("How I understand it: ... Is that right?"); propose() waits for that "yes".
   */
  grill?: true;
  /**
   * The lead writes its plan as an HTML page first (tasks/<id>/plan/); the operator comments on it, edits it in place and
   * approves it on the page. propose() is refused until the plan is approved.
   */
  planReview?: true;
  /**
   * The operator lets the lead add agents from the spawn templates (spawn_agent). Without it the lead splits the work
   * among the team it was given: every added agent is a session of its own and costs as much as one of the team.
   */
  allowSpawn?: true;
  /**
   * A job the lead of another task delegated (delegate): one agent, no agreement, no review; it starts in IMPLEMENT, its
   * complete() ends it (DONE), and the result goes back to the lead as its subtask.
   */
  jobOf?: { taskId: string; by: string; subtask: string };
  /** Agents the lead added to the team from templates (spawn_agent); the page starts a runner for each. */
  spawned?: { id: string; template: string; by: string; at: string; reason: string; role?: SpawnRole }[];
}

/** A follow-up task the lead asks for when it integrates with PASS. */
export interface FollowUpRequest {
  title: string;
  description: string;
  /** Default: the agents of the parent task (same lead). The first one is the lead. */
  agents?: string[];
}

export type SubtaskStatus = "TODO" | "DOING" | "DONE" | "DROPPED";

/** One step of an agent's own plan for its part of a task. */
export interface Subtask {
  id: string;
  title: string;
  status: SubtaskStatus;
  /** DROPPED: why it is not needed; DONE: optional note. */
  note?: string;
  updatedAt: string;
}

/** An agent's own checklist for its part of a task; only that agent changes it, everybody can read it. */
export interface SubtaskList {
  taskId: string;
  agentId: string;
  items: Subtask[];
  /** Next number for an id "s<N>". */
  nextSeq: number;
}

export interface Assignment {
  agentId: string;
  responsibility: string;
  /** Files (paths or globs) this agent owns, i.e. will change. Declarations of different agents must not overlap. */
  files?: string[];
  /** OpenSpec task: the tasks.md numbers this agent implements. Every open task has exactly one agent. */
  tasks?: string[];
  /**
   * Agents whose new code this agent's work calls (e.g. the tester's API tests call the developer's endpoint). It works
   * in parallel, but its complete() in IMPLEMENT is accepted only after they reported their part and it merged their
   * commits: the tests run against the real code before the review, not against a guess.
   */
  dependsOn?: string[];
}

/** The owner of some files lets another agent change them. */
export interface Grant {
  id: string;
  taskId: string;
  from: string;
  to: string;
  files: string[];
  createdAt: string;
}

export interface Agreement {
  taskId: string;
  summary: string;
  assignments: Assignment[];
  decisions: string[];
  interfaces: string[];
  approvedBy: string[];
  createdAt: string;
  /** Extension: who proposed the (latest version of the) agreement. */
  proposedBy: string;
  /** Extension: incremented on every re-proposal; approvals are reset with each new version. */
  version: number;
}

export type ImplementationStatus = "IN_PROGRESS" | "READY_FOR_SYNC";

export interface Implementation {
  taskId: string;
  agentId: string;
  status: ImplementationStatus;
  summary: string;
  filesChanged: string[];
  commits: string[];
  completedAt?: string;
  /** OpenSpec task: the numbers of the agent's tasks it reports done. */
  tasksDone?: string[];
  /** The commits it had reported when a review sent it back to fix: a fix that adds none delivered nothing new. */
  commitsBeforeFix?: string[];
  /** Marked ready by the server as IMPLEMENT started (a review-only part); the agent's own report replaces it. */
  auto?: true;
}

export type SyncStatus = "PASS" | "NEEDS_FIX";
export type Severity = "INFO" | "WARNING" | "ERROR";

export interface SyncFinding {
  severity: Severity;
  description: string;
  relatedAgent?: string;
  files?: string[];
}

export interface SyncReport {
  id: string;
  taskId: string;
  agentId: string;
  status: SyncStatus;
  findings: SyncFinding[];
  createdAt: string;
  /** Extension: SYNC round this report belongs to (reports of older rounds are history). */
  round: number;
}

/** INTEGRATE: the lead merged everyone's work and ran the build/tests on the result. */
export interface IntegrationReport {
  id: string;
  taskId: string;
  agentId: string;
  status: SyncStatus;
  /** What was merged, where the result is, build/test outcome. */
  result: string;
  commits: string[];
  findings: SyncFinding[];
  createdAt: string;
  /** SYNC round this integration follows. */
  round: number;
  /** PASS of a code task: the lead's half of the acceptance page (acceptance.ts builds the rest from the task's data). */
  acceptance?: Acceptance;
}

export type CriterionStatus = "done" | "partial" | "not-done";
/** A requirement of the task and what proves it: tests (path or path#method) and code at the merged commit. */
export interface AcceptanceCriterion {
  requirement: string;
  status: CriterionStatus;
  tests: string[];
  where: string[];
  /** Required for partial / not-done: what is missing. */
  note?: string;
}
/** A step the operator can take by hand to see it work. */
export interface AcceptanceCheck { step: string; command?: string; expect?: string }
export interface AcceptanceRisk { what: string; why?: string }
export interface Acceptance { criteria: AcceptanceCriterion[]; checks: AcceptanceCheck[]; risks: AcceptanceRisk[] }

export const MESSAGE_TYPES = ["QUESTION", "PROPOSAL", "INFORMATION", "REQUEST", "BLOCKER", "FIX_REQUEST", "FILE_REQUEST", "FILE_GRANT"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface Message {
  id: string;
  taskId: string;
  from: string;
  to: string;
  type: MessageType;
  content: string;
  replyTo?: string;
  /** FILE_REQUEST / FILE_GRANT: the files in question. */
  files?: string[];
  createdAt: string;
  readAt?: string;
  /** The operator sent it urgently: the agent's session was stopped and the next one started with it. */
  urgent?: true;
  /** A question to the operator with choices (the form of Claude's AskUserQuestion): the page shows them as buttons. */
  choices?: QuestionChoices;
  /**
   * A note that needs no answer (fyi to an agent, a copy of the operator's answer to the lead): it wakes nobody — no
   * wait() returns for it, a parked agent stays parked — and comes with the agent's next reply.
   */
  quiet?: true;
  /** The lead's summary of a grilling ("How I understand it … Is that right?"): the operator's yes to it closes the grilling. */
  summary?: true;
}

/** The operator's comment on a line of the diff: the lead fixes it (or has it fixed) or declines it with a reason. */
export interface ReviewComment {
  id: string;
  file: string;
  line?: number;
  code?: string;
  text: string;
  at: string;
  status: "open" | "fixed" | "declined";
  /** The lead's note: what was done, or why not. */
  note?: string;
  resolvedAt?: string;
}

/** What a spawned agent does: a role from the project's library, or one the lead wrote for this task. */
export interface SpawnRole {
  name: string;
  instructions: string;
  source: "library" | "lead";
}

export interface QuestionChoices {
  options: { label: string; description?: string }[];
  /** The label of the option the agent would take; the one it goes ahead with when nobody answers in time. */
  recommended?: string;
  /** Several options may be picked (checkboxes) instead of one. */
  multiSelect?: true;
}

export const EVENT_TYPES = [
  "AGENT_REGISTERED",
  "TASK_CREATED",
  "MESSAGE_CREATED",
  "AGREEMENT_UPDATED",
  "AGREEMENT_APPROVED",
  "PHASE_CHANGED",
  "IMPLEMENTATION_STARTED",
  "IMPLEMENTATION_COMPLETED",
  "SYNC_REQUIRED",
  "SYNC_REPORT_CREATED",
  "INTEGRATION_REQUIRED",
  "INTEGRATION_REPORT_CREATED",
  "TASK_COMPLETED",
  "TASK_CANCELLED",
  "TASK_BLOCKED",
  "TASK_UNBLOCKED",
  "TASK_HANDED_OVER",
  "OPENSPEC_ARCHIVED",
  "BUILD_RAN",
  "TASK_MERGED",
  "TASK_REVERTED",
  "TASK_ACCEPTANCE",
  "AGENT_SPAWNED",
  "REVIEW_COMMENTS",
  "REVIEW_RESOLVED",
  "PLAN_UPDATED",
  "PLAN_FEEDBACK",
  "PLAN_APPROVED",
  "JOB_DELEGATED",
  "JOB_FINISHED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface NetworkEvent {
  id: string;
  type: EventType;
  taskId?: string;
  /** Recipient. null/absent = broadcast to every agent of the task (or every agent for global events). */
  targetAgent?: string | null;
  /** Extension: agent whose action produced the event; that agent is not woken up by its own event. */
  sourceAgent?: string;
  payload: unknown;
  createdAt: string;
}

export interface AgentIdentity {
  id: string;
  type: string;
  role?: string;
}
