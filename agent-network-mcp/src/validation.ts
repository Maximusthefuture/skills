import { isAbsolute } from "node:path";
import { AppError } from "./errors.js";

const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^task-\d{1,9}$/;
const MESSAGE_ID_RE = /^msg-\d{1,9}$/;
const EVENT_ID_RE = /^event-\d{1,9}$/;
const SYNC_ID_RE = /^sync-\d{1,9}$/;
const COMMIT_RE = /^[0-9a-fA-F]{4,64}$/;

function check(re: RegExp, value: unknown, what: string): string {
  if (typeof value !== "string" || !re.test(value)) {
    throw new AppError("INVALID_INPUT", `Invalid ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}

export const assertAgentId = (v: unknown, what = "agentId") => check(AGENT_ID_RE, v, what);
export const assertTaskId = (v: unknown) => check(TASK_ID_RE, v, "taskId");
export const assertMessageId = (v: unknown) => check(MESSAGE_ID_RE, v, "messageId");
export const assertEventId = (v: unknown) => check(EVENT_ID_RE, v, "eventId");
export const assertSyncId = (v: unknown) => check(SYNC_ID_RE, v, "syncId");
export const assertCommit = (v: unknown) => check(COMMIT_RE, v, "commit hash");

/** A single path segment used to build a location inside the network directory. */
export function assertSafeSegment(segment: string): string {
  if (
    typeof segment !== "string" ||
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0")
  ) {
    throw new AppError("INVALID_INPUT", `Unsafe path segment: ${JSON.stringify(segment)}`);
  }
  return segment;
}

/** Project-relative file path reported by an agent (filesChanged, finding files). Never touched on disk. */
export function assertRelativeFilePath(p: unknown): string {
  if (typeof p !== "string" || p.length === 0 || p.length > 1024 || p.includes("\0")) {
    throw new AppError("INVALID_INPUT", `Invalid file path: ${JSON.stringify(p)}`);
  }
  const normalized = p.replace(/\\/g, "/");
  if (isAbsolute(p) || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new AppError("INVALID_INPUT", `Absolute paths are not allowed: ${p}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new AppError("INVALID_INPUT", `Path traversal is not allowed: ${p}`);
  }
  return p;
}

export function parseSeq(id: string, prefix: string): number {
  return Number(id.slice(prefix.length + 1));
}
