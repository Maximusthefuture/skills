import { describe, expect, it } from "vitest";
import { decisionRecords } from "../../src/ui/decisions.js";
import type { PlanState } from "../../src/plan.js";
import type { Message } from "../../src/types.js";

describe("decision history", () => {
  it("keeps previous approvals and deduplicates current/legacy references without inventing missing history", () => {
    const plan = { versions: [{ n: 1, stage: "input", by: "lead", at: "2026-01-01", bytes: 10 }, { n: 2, stage: "change", by: "lead", at: "2026-01-02", bytes: 10 }, { n: 3, stage: "change", by: "lead", at: "2026-01-03", bytes: 10 }], feedback: [], approvals: [{ version: 2, at: "2026-01-02" }], inputViewed: { version: 1, at: "2026-01-01" }, approved: { version: 2, at: "2026-01-02" } } as PlanState;
    const records = decisionRecords(plan, [], null, null);
    expect(records.map(r => r.version)).toEqual([1, 2]);
    expect(records[0]!.label).toBe("Просмотрено оператором");
    expect(records[1]!.label).toBe("Утверждено оператором");
  });
  it("labels an answer as an answer, includes its original question, and ignores ordinary operator messages", () => {
    const messages = [
      { id: "q", from: "agent", to: "operator", type: "QUESTION", content: "Which behavior?", createdAt: "2026-01-01" },
      { id: "a", from: "operator", replyTo: "q", content: "Use the first", createdAt: "2026-01-02" },
      { id: "note", from: "operator", content: "Status?", createdAt: "2026-01-03" },
    ] as Message[];
    expect(decisionRecords(null, messages, null, null)).toEqual([{ id: "a", at: "2026-01-02", label: "Ответ оператора", text: "Use the first", question: "Which behavior?", source: "message" }]);
  });
});
