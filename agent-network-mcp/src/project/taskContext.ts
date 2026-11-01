import type { FileStore } from "../storage/fileStore.js";
import { IntegrationStore } from "../stores/integrationStore.js";
import { MessageStore } from "../stores/messageStore.js";
import { SyncStore } from "../stores/syncStore.js";
import { TaskStore } from "../stores/taskStore.js";
import { boundedText } from "./snapshot.js";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Server-owned, membership-gated task details. Each page stays within 16 KiB. */
export async function projectTaskContextPage(fs: FileStore, taskId: string, cursor: number) {
  const task = await new TaskStore(fs).get(taskId);
  const messages = await new MessageStore(fs).list(taskId);
  const questions = messages.filter(m => m.to === "operator" && m.type === "QUESTION" && !m.summary).map(question => ({
    kind: "question", at: question.createdAt, messageId: question.id,
    question: boundedText(question.content, 4096),
    answer: boundedText(messages.find(m => m.from === "operator" && m.replyTo === question.id)?.content ?? "", 4096),
  }));
  const integrations = (await new IntegrationStore(fs).list(taskId)).map(report => ({
    kind: "integration", at: report.createdAt, status: report.status, round: report.round,
    result: boundedText(report.result, 4096),
    findings: report.findings.slice(0, 8).map(f => ({ severity: f.severity, description: boundedText(f.description, 1024), files: f.files?.slice(0, 8) })),
    acceptance: report.acceptance ? {
      criteria: report.acceptance.criteria.slice(0, 12).map(c => ({ requirement: boundedText(c.requirement, 512), status: c.status, tests: c.tests.slice(0, 8).map(v => boundedText(v, 256)), where: c.where.slice(0, 8).map(v => boundedText(v, 256)), ...(c.note ? { note: boundedText(c.note, 512) } : {}) })),
      checks: report.acceptance.checks.slice(0, 8).map(c => ({ step: boundedText(c.step, 512), ...(c.command ? { command: boundedText(c.command, 512) } : {}), ...(c.expect ? { expect: boundedText(c.expect, 512) } : {}) })),
      risks: report.acceptance.risks.slice(0, 8).map(r => ({ what: boundedText(r.what, 512), ...(r.why ? { why: boundedText(r.why, 512) } : {}) })),
    } : undefined,
  }));
  const sync = (await new SyncStore(fs).list(taskId)).flatMap(report => report.findings.map(f => ({
    kind: "review", at: report.createdAt, round: report.round, by: report.agentId,
    severity: f.severity, description: boundedText(f.description, 1024), files: f.files?.slice(0, 8),
  })));
  const items = [...questions, ...integrations, ...sync].sort((a, b) => a.at.localeCompare(b.at));
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > items.length) throw new Error("Invalid task context cursor");
  const taskInfo = {
    id: task.id, title: boundedText(task.title, 512), description: boundedText(task.description, 4096),
    phase: task.phase, status: task.status, ...(task.blockedReason ? { blockedReason: boundedText(task.blockedReason, 2048) } : {}),
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}), ...(task.baseCommit ? { baseCommit: task.baseCommit } : {}),
    ...(task.projectInput ? { inputSnapshotHash: task.projectInput.inputSnapshotHash, inputState: task.projectInput.state } : {}),
    ...(task.acceptance ? { operatorAcceptance: task.acceptance } : {}),
    ...(task.merged ? { merged: { commit: task.merged.commit, into: task.merged.into, at: task.merged.at } } : {}),
  };
  const selected = items.slice(cursor, cursor + 20);
  let result = { task: taskInfo, items: selected, nextCursor: cursor + selected.length < items.length ? cursor + selected.length : null };
  while (selected.length && bytes(result) > 16384) {
    selected.pop();
    result = { task: taskInfo, items: selected, nextCursor: cursor + selected.length < items.length ? cursor + selected.length : null };
  }
  if (bytes(result) > 16384) throw new Error("Task context metadata exceeds page limit");
  return result;
}
