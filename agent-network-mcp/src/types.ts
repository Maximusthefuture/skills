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

export type Phase = "DISCUSS" | "IMPLEMENT" | "SYNC" | "DONE";
export type TaskStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

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
}

export interface Assignment {
  agentId: string;
  responsibility: string;
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

export const MESSAGE_TYPES = ["QUESTION", "PROPOSAL", "INFORMATION", "REQUEST", "BLOCKER", "FIX_REQUEST"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface Message {
  id: string;
  taskId: string;
  from: string;
  to: string;
  type: MessageType;
  content: string;
  replyTo?: string;
  createdAt: string;
  readAt?: string;
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
  "TASK_COMPLETED",
  "TASK_CANCELLED",
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
