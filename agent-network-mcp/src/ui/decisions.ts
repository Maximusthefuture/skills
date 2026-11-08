import type { PlanState } from "../plan.js";
import type { Agreement, Message } from "../types.js";
import type { BrainstormState } from "../brainstorm/index.js";

export interface DecisionRecord {
  id: string; at: string; label: string; text: string;
  source: "plan" | "message" | "agreement" | "brainstorm";
  version?: number; question?: string;
}

/** A view of recorded facts; an operator answer never becomes an approval. */
export function decisionRecords(plan: PlanState | null, messages: Message[], agreement: Agreement | null, brainstorm: BrainstormState | null): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  const approvals = [...(plan?.approvals ?? []), ...(plan?.approved ? [plan.approved] : []), ...(plan?.inputViewed ? [plan.inputViewed] : [])];
  const seen = new Set<number>();
  for (const a of approvals) {
    if (seen.has(a.version)) continue;
    const v = plan?.versions.find(v => v.n === a.version);
    if (!v) continue;
    seen.add(a.version);
    const input = v.stage === "input";
    out.push({ id: `plan:${a.version}`, at: a.at, label: input ? "Просмотрено оператором" : "Утверждено оператором", text: `${input ? "Спека аналитиков" : v.stage === "change" ? "Change" : "План"} · v${a.version}`, source: "plan", version: a.version });
  }
  for (const m of messages) {
    if (m.from !== "operator" || !m.replyTo) continue;
    const question = messages.find(q => q.id === m.replyTo && q.type === "QUESTION" && q.to === "operator");
    if (question) out.push({ id: m.id, at: m.createdAt, label: "Ответ оператора", text: m.content, question: question.content, source: "message" });
  }
  if (agreement?.decisions.length) for (const [i, text] of agreement.decisions.entries()) out.push({ id: `agreement:${agreement.version}:${i}`, at: agreement.createdAt, label: agreement.approvedBy.length >= agreement.assignments.length ? "Согласовано агентами" : "Предложено агентами", text, source: "agreement", version: agreement.version });
  const approved = brainstorm?.approvedDecision;
  const decision = brainstorm?.decisions.find(d => d.version === approved?.version && d.hash === approved?.hash);
  if (approved && decision && brainstorm?.stage === "approved") out.push({ id: `brainstorm:${approved.version}`, at: approved.at, label: "Утверждено оператором", text: decision.recommendation.rationale, source: "brainstorm", version: approved.version });
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
