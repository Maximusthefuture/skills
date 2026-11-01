import { AppError } from "../errors.js";
import type { Task, Message } from "../types.js";

/** Never recover a mutation by title/content: only a durable exact marker is evidence. */
export function correlatedRecord<T extends Pick<Task | Message, "projectOrigin">>(records: T[], projectId: string, operationId: string): T | null {
  const matches = records.filter(record => record.projectOrigin?.projectId === projectId && record.projectOrigin.operationId === operationId);
  if (matches.length > 1) throw new AppError("INVALID_INPUT", "Ambiguous project operation; manual recovery required");
  return matches[0] ?? null;
}
