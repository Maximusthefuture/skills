import { AppError } from "../errors.js";
import type { Agreement, Implementation, Phase, SyncReport, Task } from "../types.js";

const ALLOWED: Readonly<Record<Phase, readonly Phase[]>> = {
  DISCUSS: ["IMPLEMENT"],
  IMPLEMENT: ["SYNC"],
  SYNC: ["DONE", "IMPLEMENT"],
  DONE: [],
};

export interface PhaseSnapshot {
  task: Task;
  agreement: Agreement | null;
  implementations: Implementation[];
  /** Reports of the current SYNC round only. */
  syncReports: SyncReport[];
}

export interface Transition {
  from: Phase;
  to: Phase;
  reason: string;
  /** SYNC -> IMPLEMENT: agents whose implementation has to be redone. */
  needsFix?: string[];
}

/**
 * The protocol state machine. It never mutates anything: `evaluate` decides whether the prerequisites
 * of the next transition are met, `assertTransition` / `apply` guard that only legal edges exist.
 * There is deliberately no public "transition" entry point — phases move only as a consequence of
 * protocol actions (approve, implementation_complete, sync_submit).
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

  /** Returns the transition that is due for the snapshot, or null if prerequisites are not met. */
  evaluate(s: PhaseSnapshot): Transition | null {
    const { task } = s;
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
        const failed = s.syncReports.filter((r) => r.status === "NEEDS_FIX");
        if (failed.length > 0) return { from: "SYNC", to: "IMPLEMENT", reason: "NEEDS_FIX reported", needsFix: this.fixTargets(task, failed) };
        const passed = (id: string) => s.syncReports.some((r) => r.agentId === id && r.status === "PASS");
        if (task.agents.every(passed)) return { from: "SYNC", to: "DONE", reason: "all agents submitted PASS" };
        return null;
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
    };
  }

  /**
   * Who has to fix: agents named in findings[].relatedAgent. When a report names nobody,
   * the owner of the problem is unknown, so every agent redoes (re-confirms) their part.
   */
  private fixTargets(task: Task, failed: SyncReport[]): string[] {
    const named = new Set<string>();
    let unnamed = false;
    for (const r of failed) {
      const related = r.findings.map((f) => f.relatedAgent).filter((x): x is string => !!x && task.agents.includes(x));
      if (related.length === 0) unnamed = true;
      related.forEach((x) => named.add(x));
    }
    return unnamed ? [...task.agents] : task.agents.filter((a) => named.has(a));
  }
}
