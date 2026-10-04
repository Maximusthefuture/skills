import { describe, expect, it } from "vitest";
import { PhaseManager, type PhaseSnapshot } from "../../src/phase/phaseManager.js";
import type { Agreement, Implementation, Phase, SyncReport, Task } from "../../src/types.js";

const pm = new PhaseManager();
const PHASES: Phase[] = ["DISCUSS", "IMPLEMENT", "SYNC", "DONE"];
const ALLOWED = new Set(["DISCUSS>IMPLEMENT", "IMPLEMENT>SYNC", "SYNC>DONE", "SYNC>IMPLEMENT"]);

const task = (phase: Phase, round = 0): Task => ({
  id: "task-001", title: "t", description: "d", phase, status: "ACTIVE", agents: ["backend", "reviewer"],
  createdAt: "", updatedAt: "", createdBy: "backend", git: null, syncRound: round,
});
const agreement = (approvedBy: string[]): Agreement => ({
  taskId: "task-001", summary: "s", assignments: [{ agentId: "backend", responsibility: "api" }, { agentId: "reviewer", responsibility: "tests" }],
  decisions: [], interfaces: [], approvedBy, createdAt: "", proposedBy: "backend", version: 1,
});
const impl = (agentId: string, status: Implementation["status"]): Implementation => ({ taskId: "task-001", agentId, status, summary: "", filesChanged: [], commits: [] });
const report = (agentId: string, status: SyncReport["status"], relatedAgent?: string): SyncReport => ({
  id: `sync-${agentId}`, taskId: "task-001", agentId, status, round: 1, createdAt: "",
  findings: status === "PASS" ? [] : [{ severity: "ERROR", description: "x", ...(relatedAgent ? { relatedAgent } : {}) }],
});
const snap = (p: Partial<PhaseSnapshot> & { task: Task }): PhaseSnapshot => ({ agreement: null, implementations: [], syncReports: [], ...p });

describe("PhaseManager transitions", () => {
  for (const from of PHASES) {
    for (const to of PHASES) {
      const allowed = ALLOWED.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${allowed ? "allowed" : "an INVALID_TRANSITION"}`, () => {
        expect(pm.canTransition(from, to)).toBe(allowed);
        if (allowed) expect(() => pm.assertTransition(from, to)).not.toThrow();
        else expect(() => pm.assertTransition(from, to)).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
      });
    }
  }

  it("apply refuses illegal edges (DISCUSS -> DONE)", () => {
    expect(() => pm.apply(task("DISCUSS"), { from: "DISCUSS", to: "DONE", reason: "" })).toThrow(/not allowed/);
  });

  it("apply counts sync rounds and completes the task on DONE", () => {
    expect(pm.apply(task("IMPLEMENT", 1), { from: "IMPLEMENT", to: "SYNC", reason: "" }).syncRound).toBe(2);
    expect(pm.apply(task("SYNC", 1), { from: "SYNC", to: "DONE", reason: "" })).toMatchObject({ phase: "DONE", status: "COMPLETED" });
  });
});

describe("PhaseManager.evaluate", () => {
  it("DISCUSS stays without an agreement or until everyone approved", () => {
    expect(pm.evaluate(snap({ task: task("DISCUSS") }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("DISCUSS"), agreement: agreement([]) }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("DISCUSS"), agreement: agreement(["backend"]) }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("DISCUSS"), agreement: agreement(["backend", "reviewer"]) }))?.to).toBe("IMPLEMENT");
  });

  it("IMPLEMENT -> SYNC only when every agent is READY_FOR_SYNC", () => {
    const t = task("IMPLEMENT");
    expect(pm.evaluate(snap({ task: t }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, implementations: [impl("backend", "READY_FOR_SYNC"), impl("reviewer", "IN_PROGRESS")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, implementations: [impl("backend", "READY_FOR_SYNC")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, implementations: [impl("backend", "READY_FOR_SYNC"), impl("reviewer", "READY_FOR_SYNC")] }))?.to).toBe("SYNC");
  });

  it("SYNC -> DONE needs a PASS from every agent", () => {
    const t = task("SYNC", 1);
    expect(pm.evaluate(snap({ task: t }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS"), report("reviewer", "PASS")] }))?.to).toBe("DONE");
  });

  it("any NEEDS_FIX sends SYNC back to IMPLEMENT, targeting relatedAgent", () => {
    const t = task("SYNC", 1);
    const tr = pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS"), report("reviewer", "NEEDS_FIX", "reviewer")] }));
    expect(tr).toMatchObject({ to: "IMPLEMENT", needsFix: ["reviewer"] });
  });

  it("NEEDS_FIX is immediate and does not wait for the other reports", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("reviewer", "NEEDS_FIX", "backend")] }))).toMatchObject({ to: "IMPLEMENT", needsFix: ["backend"] });
  });

  it("when nobody is named, every agent has to redo their part", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("reviewer", "NEEDS_FIX")] }))?.needsFix).toEqual(["backend", "reviewer"]);
  });

  it("ignores relatedAgent values that are not task agents", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("reviewer", "NEEDS_FIX", "stranger")] }))?.needsFix).toEqual(["backend", "reviewer"]);
  });

  it("DONE never transitions", () => {
    expect(pm.evaluate(snap({ task: task("DONE") }))).toBeNull();
  });
});
