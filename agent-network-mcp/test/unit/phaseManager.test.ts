import { describe, expect, it } from "vitest";
import { PhaseManager, type PhaseSnapshot } from "../../src/phase/phaseManager.js";
import type { Agreement, Implementation, IntegrationReport, Phase, SyncReport, Task } from "../../src/types.js";

const pm = new PhaseManager();
const PHASES: Phase[] = ["DISCUSS", "IMPLEMENT", "SYNC", "INTEGRATE", "DONE"];
const ALLOWED = new Set(["DISCUSS>IMPLEMENT", "IMPLEMENT>SYNC", "SYNC>INTEGRATE", "SYNC>IMPLEMENT", "INTEGRATE>DONE", "INTEGRATE>IMPLEMENT"]);

const task = (phase: Phase, round = 0, extra: Partial<Task> = {}): Task => ({
  id: "task-001", title: "t", description: "d", phase, status: "ACTIVE", agents: ["backend", "reviewer"],
  createdAt: "", updatedAt: "", createdBy: "backend", git: null, syncRound: round, ...extra,
});
const three = (phase: Phase, round = 0, extra: Partial<Task> = {}) => task(phase, round, { agents: ["backend", "frontend", "qa"], ...extra });
const agreement = (approvedBy: string[]): Agreement => ({
  taskId: "task-001", summary: "s", assignments: [{ agentId: "backend", responsibility: "api" }, { agentId: "reviewer", responsibility: "tests" }],
  decisions: [], interfaces: [], approvedBy, createdAt: "", proposedBy: "backend", version: 1,
});
const impl = (agentId: string, status: Implementation["status"]): Implementation => ({ taskId: "task-001", agentId, status, summary: "", filesChanged: [], commits: [] });
const report = (agentId: string, status: SyncReport["status"], relatedAgent?: string): SyncReport => ({
  id: `sync-${agentId}`, taskId: "task-001", agentId, status, round: 1, createdAt: "",
  findings: status === "PASS" ? [] : [{ severity: "ERROR", description: "x", ...(relatedAgent ? { relatedAgent } : {}) }],
});
const integration = (status: IntegrationReport["status"], relatedAgent?: string): IntegrationReport => ({
  id: "integration-001", taskId: "task-001", agentId: "backend", status, result: "merged", commits: [], round: 1, createdAt: "",
  findings: status === "PASS" ? [] : [{ severity: "ERROR", description: "build fails", ...(relatedAgent ? { relatedAgent } : {}) }],
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
    expect(pm.apply(task("INTEGRATE", 1), { from: "INTEGRATE", to: "DONE", reason: "" })).toMatchObject({ phase: "DONE", status: "COMPLETED" });
  });

  it("apply narrows the next review to the agents that fix", () => {
    const fixed = pm.apply(task("SYNC", 1), { from: "SYNC", to: "IMPLEMENT", reason: "", needsFix: ["reviewer"] });
    expect(fixed.reviewScope).toEqual(["reviewer"]);
    expect(pm.apply(fixed, { from: "IMPLEMENT", to: "SYNC", reason: "" }).reviewScope).toEqual(["reviewer"]);
  });
});

describe("PhaseManager.evaluate", () => {
  it("DISCUSS stays without an agreement or until everyone approved", () => {
    expect(pm.evaluate(snap({ task: task("DISCUSS") }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("DISCUSS"), agreement: agreement([]) }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("DISCUSS"), agreement: agreement(["backend"]) }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("DISCUSS"), agreement: agreement(["backend", "reviewer"]) }))).toMatchObject({ to: "IMPLEMENT" });
  });

  it("IMPLEMENT -> SYNC only when every agent is READY_FOR_SYNC", () => {
    const t = task("IMPLEMENT");
    expect(pm.evaluate(snap({ task: t }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, implementations: [impl("backend", "READY_FOR_SYNC"), impl("reviewer", "IN_PROGRESS")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, implementations: [impl("backend", "READY_FOR_SYNC")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, implementations: [impl("backend", "READY_FOR_SYNC"), impl("reviewer", "READY_FOR_SYNC")] }))).toMatchObject({ to: "SYNC" });
  });

  it("SYNC -> INTEGRATE needs a PASS from every agent", () => {
    const t = task("SYNC", 1);
    expect(pm.evaluate(snap({ task: t }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS"), report("reviewer", "PASS")] }))).toMatchObject({ to: "INTEGRATE" });
  });

  it("any NEEDS_FIX sends SYNC back to IMPLEMENT, targeting relatedAgent", () => {
    const t = task("SYNC", 1);
    const tr = pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS"), report("reviewer", "NEEDS_FIX", "reviewer")] }));
    expect(tr).toMatchObject({ to: "IMPLEMENT", needsFix: ["reviewer"] });
  });

  it("NEEDS_FIX waits for the round's other reviews, so none is thrown away", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("reviewer", "NEEDS_FIX", "backend")] }))).toBeNull();
  });

  it("when nobody is named, every agent has to redo their part", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("backend", "PASS"), report("reviewer", "NEEDS_FIX")] }))).toMatchObject({ needsFix: ["backend", "reviewer"] });
  });

  it("ignores relatedAgent values that are not task agents, and relatedAgent of non-ERROR findings", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("backend", "PASS"), report("reviewer", "NEEDS_FIX", "stranger")] }))).toMatchObject({ needsFix: ["backend", "reviewer"] });
    const mixed: SyncReport = { ...report("reviewer", "NEEDS_FIX"), findings: [{ severity: "ERROR", description: "x", relatedAgent: "backend" }, { severity: "WARNING", description: "y", relatedAgent: "reviewer" }] };
    expect(pm.evaluate(snap({ task: task("SYNC", 1), syncReports: [report("backend", "PASS"), mixed] }))).toMatchObject({ needsFix: ["backend"] });
  });

  it("after a fix only the fixers' work is reviewed, by everyone else", () => {
    const t = three("SYNC", 2, { reviewScope: ["frontend"] });
    expect(pm.reviewees(t)).toEqual(["frontend"]);
    expect(pm.reviewers(t)).toEqual(["backend", "qa"]);
    expect(pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS")] }))).toBeNull();
    expect(pm.evaluate(snap({ task: t, syncReports: [report("backend", "PASS"), report("qa", "PASS")] }))).toMatchObject({ to: "INTEGRATE" });
    // with two agents the fixer has nobody to review
    expect(pm.reviewers(task("SYNC", 2, { reviewScope: ["reviewer"] }))).toEqual(["backend"]);
    // everyone fixed: everyone reviews everyone
    expect(pm.reviewers(three("SYNC", 2, { reviewScope: ["backend", "frontend", "qa"] }))).toEqual(["backend", "frontend", "qa"]);
  });

  it("INTEGRATE: PASS completes, NEEDS_FIX goes back to IMPLEMENT", () => {
    expect(pm.evaluate(snap({ task: task("INTEGRATE", 1) }))).toBeNull();
    expect(pm.evaluate(snap({ task: task("INTEGRATE", 1), integrations: [integration("PASS")] }))).toMatchObject({ to: "DONE" });
    expect(pm.evaluate(snap({ task: task("INTEGRATE", 1), integrations: [integration("NEEDS_FIX", "reviewer")] }))).toMatchObject({ to: "IMPLEMENT", needsFix: ["reviewer"] });
    expect(pm.evaluate(snap({ task: task("INTEGRATE", 1), integrations: [integration("NEEDS_FIX")] }))).toMatchObject({ needsFix: ["backend", "reviewer"] });
  });

  it("a fix beyond maxFixRounds halts the task instead of looping", () => {
    const failing = [report("backend", "PASS"), report("reviewer", "NEEDS_FIX", "backend")];
    expect(pm.evaluate(snap({ task: task("SYNC", 2, { maxFixRounds: 2 }), syncReports: failing }))).toMatchObject({ to: "IMPLEMENT" });
    expect(pm.evaluate(snap({ task: task("SYNC", 3, { maxFixRounds: 2 }), syncReports: failing }))).toMatchObject({ halt: true, needsFix: ["backend"] });
    expect(pm.evaluate(snap({ task: task("INTEGRATE", 1, { maxFixRounds: 0 }), integrations: [integration("NEEDS_FIX")] }))).toMatchObject({ halt: true });
    expect(pm.evaluate(snap({ task: task("SYNC", 4), syncReports: failing }))).toMatchObject({ halt: true }); // default limit 3
  });

  it("a BLOCKED task never transitions", () => {
    expect(pm.evaluate(snap({ task: task("SYNC", 1, { status: "BLOCKED" }), syncReports: [report("backend", "PASS"), report("reviewer", "PASS")] }))).toBeNull();
  });

  it("DONE never transitions", () => {
    expect(pm.evaluate(snap({ task: task("DONE") }))).toBeNull();
  });
});
