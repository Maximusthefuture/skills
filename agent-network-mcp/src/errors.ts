export type ErrorCode =
  | "AGREEMENT_NOT_READY"
  | "AGENT_NOT_REGISTERED"
  | "AGENT_ALREADY_REGISTERED"
  | "TASK_NOT_FOUND"
  | "INVALID_PHASE"
  | "INVALID_TRANSITION"
  | "NOT_ASSIGNED"
  | "ALREADY_COMPLETED"
  | "NOT_STARTED"
  | "MESSAGE_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_CONFIG"
  | "NO_ACTIVE_TASK"
  | "HAS_ACTIVE_TASK"
  | "FILE_OVERLAP"
  | "FILE_NOT_OWNED"
  | "AGREEMENT_NOT_REVIEWED"
  | "TASK_BLOCKED"
  | "OPEN_SUBTASKS"
  | "FOLLOW_UP_LIMIT"
  | "LOCK_TIMEOUT"
  | "INTERNAL_ERROR";

/** Error that is safe to show to an agent: stable code + human readable message, no stack. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Extra machine-readable context returned to the agent next to the message. */
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (details) this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
