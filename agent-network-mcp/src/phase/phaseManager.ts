import { AppError } from "../errors.js";
import type { Agreement, Implementation, IntegrationReport, Phase, SyncFinding, SyncReport, Task } from "../types.js";

export const DEFAULT_MAX_FIX_ROUNDS = 3;

const ALLOWED: Readonly<Record<Phase, readonly Phase[]>> = {
  DISCUSS: ["IMPLEMENT"],
  IMPLEMENT: ["SYNC"],
  SYNC: ["INTEGRATE", "IMPLEMENT"],
  INTEGRATE: ["DONE", "IMPLEMENT"],
  DONE: [],
};

export interface PhaseSnapshot {
  task: Task;
  agreement: Agreement | null;
  implementations: Implementation[];
  /** Reports of the current SYNC round only. */
  syncReports: SyncReport[];
  /** Integration reports of the current round only. */
  integrations?: IntegrationReport[];
}

export interface Transition {
  from: Phase;
  to: Phase;
  reason: string;
  /** SYNC/INTEGRATE -> IMPLEMENT: agents whose implementation has to be redone. */
  needsFix?: string[];
}

/** A fix is due but the task used up its fix rounds: it stops (status BLOCKED) instead of going back to IMPLEMENT. */
export interface Halt {
  halt: true;
  phase: Phase;
  reason: string;
  needsFix: string[];
}

export const isHalt = (o: Transition | Halt): o is Halt => "halt" in o;

/**
 * The protocol state machine. It never mutates anything: `evaluate` decides whether the prerequisites
 * of the next transition are met, `assertTransition` / `apply` guard that only legal edges exist.
 * There is deliberately no public "transition" entry point — phases move only as a consequence of
 * protocol actions (approve, implementation_complete, sync_submit, integration).
 */
export class PhaseManager {
  canTransition(from: Phase, to: Phase): boolean {
    return ALLOWED[from].includes(to);
  }

  assertTransition(from: Phase, to: Phase): void {
    if (!this.canTransition(from, to)) {
      throw new AppError("INVALID_TRANSITION", `Transition ${from} -> ${to} is not allowed`);
    }
  }

  /** Agents whose work the current SYNC round reviews: after a fix only the agents that fixed. */
  reviewees(task: Task): string[] {
    const scope = task.reviewScope?.filter((a) => task.agents.includes(a));
    return scope?.length ? scope : [...task.agents];
  }

  /** Agents who must submit a review this round: everyone with someone else's work to review. */
  reviewers(task: Task): string[] {
    const under = this.reviewees(task);
    return task.agents.filter((a) => under.some((r) => r !== a));
  }

  /** The lead merges everyone's work and runs the build in INTEGRATE. */
  integrator(task: Task): string {
    return task.agents[0]!;
  }

  maxFixRounds(task: Task): number {
    return task.maxFixRounds ?? DEFAULT_MAX_FIX_ROUNDS;
  }

  /** Returns the transition (or halt) that is due for the snapshot, or null if prerequisites are not met. */
  evaluate(s: PhaseSnapshot): Transition | Halt | null {
    const { task } = s;
    if (task.status !== "ACTIVE") return null;
    switch (task.phase) {
      case "DISCUSS": {
        const a = s.agreement;
        if (!a) return null;
        const assigned = a.assignments.map((x) => x.agentId);
        if (assigned.length > 0 && assigned.every((id) => a.approvedBy.includes(id))) {
          return { from: "DISCUSS", to: "IMPLEMENT", reason: "agreement approved by all assigned agents" };
        }
        return null;
      }
      case "IMPLEMENT": {
        const ready = (id: string) => s.implementations.some((i) => i.agentId === id && i.status === "READY_FOR_SYNC");
        if (task.agents.length > 0 && task.agents.every(ready)) {
          return { from: "IMPLEMENT", to: "SYNC", reason: "all agents are READY_FOR_SYNC" };
        }
        return null;
      }
      case "SYNC": {
        // collect every review of the round first: fixers get all findings at once and no review is thrown away
        const reported = (id: string) => s.syncReports.some((r) => r.agentId === id);
        if (!this.reviewers(task).every(reported)) return null;
        const failed = s.syncReports.filter((r) => r.status === "NEEDS_FIX");
        if (failed.length > 0) return this.fixOrHalt(task, "NEEDS_FIX reported in sync review", failed.map((r) => r.findings));
        return { from: "SYNC", to: "INTEGRATE", reason: "all reviews passed" };
      }
      case "INTEGRATE": {
        const report = s.integrations?.at(-1);
        if (!report) return null;
        if (report.status === "PASS") return { from: "INTEGRATE", to: "DONE", reason: "integrated build and tests passed" };
        return this.fixOrHalt(task, "integration failed", [report.findings]);
      }
      case "DONE":
        return null;
    }
  }

  /** Apply a transition to a task (pure). */
  apply(task: Task, t: Transition): Task {
    this.assertTransition(task.phase, t.to);
    return {
      ...task,
      phase: t.to,
      status: t.to === "DONE" ? "COMPLETED" : task.status,
      syncRound: t.to === "SYNC" ? task.syncRound + 1 : task.syncRound,
      reviewScope: t.to === "IMPLEMENT" ? t.needsFix : task.reviewScope,
    };
  }

  private fixOrHalt(task: Task, reason: string, findings: SyncFinding[][]): Transition | Halt {
    const needsFix = this.fixTargets(task, findings);
    const max = this.maxFixRounds(task);
    if (task.syncRound > max) {
      return { halt: true, phase: task.phase, needsFix, reason: `${reason}, but the limit of ${max} fix round(s) is used up` };
    }
    return { from: task.phase, to: "IMPLEMENT", reason, needsFix };
  }

  /**
   * Who has to fix: agents named in relatedAgent of the ERROR findings. When a report names nobody,
   * the owner of the problem is unknown, so every agent redoes (re-confirms) their part.
   */
  private fixTargets(task: Task, reports: SyncFinding[][]): string[] {
    const named = new Set<string>();
    let unnamed = false;
    for (const findings of reports) {
      const related = findings.filter((f) => f.severity === "ERROR").map((f) => f.relatedAgent).filter((x): x is string => !!x && task.agents.includes(x));
      if (related.length === 0) unnamed = true;
      related.forEach((x) => named.add(x));
    }
    return unnamed ? [...task.agents] : task.agents.filter((a) => named.has(a));
  }
}
