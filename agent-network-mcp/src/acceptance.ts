import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./errors.js";
import { changePath } from "./openspec.js";
import type { Acceptance, AcceptanceCriterion, CriterionStatus, Task } from "./types.js";

/**
 * The lead's half of the acceptance page: with PASS in INTEGRATE it says, for every requirement of the task, whether it
 * is done and what proves it (tests, code), how to see it work by hand, and what it is unsure of. The server checks that
 * the proof exists at the merged commit; acceptancePage.ts builds the page around it from the task's own data.
 */

/** Code tasks hand in acceptance with PASS; a delegated job reports to its lead, a change-writing task has its change page. */
export const needsAcceptance = (task: Pick<Task, "jobOf" | "proposes">): boolean => !task.jobOf && !task.proposes;

const STATUSES: readonly CriterionStatus[] = ["done", "partial", "not-done"];
const MAX_CRITERIA = 60;
const MAX_ITEMS = 12;

const str = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");
const strings = (v: unknown, field: string, n = 20): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new AppError("INVALID_INPUT", `${field}: a list of strings`);
  return (v as string[]).map((x) => x.trim().slice(0, 300)).filter(Boolean).slice(0, n);
};

export function checkAcceptance(raw: unknown): Acceptance | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_INPUT", "acceptance: {criteria: [{requirement, status, tests, where, note?}], checks?: [{step, command?, expect?}], risks?: [{what, why?}]}");
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.criteria)) throw new AppError("INVALID_INPUT", "acceptance.criteria: one entry per requirement of the task");
  if (o.criteria.length > MAX_CRITERIA) throw new AppError("INVALID_INPUT", `acceptance.criteria: at most ${MAX_CRITERIA}`);
  const criteria = o.criteria.map((c, i): AcceptanceCriterion => {
    const x = (c ?? {}) as Record<string, unknown>;
    const requirement = str(x.requirement, 400);
    if (!requirement) throw new AppError("INVALID_INPUT", `acceptance.criteria[${i}].requirement: the requirement in a sentence`);
    if (!STATUSES.includes(x.status as CriterionStatus)) throw new AppError("INVALID_INPUT", `acceptance.criteria[${i}].status: one of ${STATUSES.join(", ")}`);
    const status = x.status as CriterionStatus;
    const note = str(x.note, 600);
    if (status !== "done" && !note) throw new AppError("INVALID_INPUT", `acceptance.criteria[${i}].note: say what is missing (status ${status})`);
    const tests = strings(x.tests, `acceptance.criteria[${i}].tests`);
    const where = strings(x.where, `acceptance.criteria[${i}].where`);
    for (const p of [...tests, ...where]) {
      const path = splitRef(p).path;
      if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new AppError("INVALID_INPUT", `acceptance.criteria[${i}]: "${p}" must be a project-relative path (path, path#method or path:line)`);
    }
    return { requirement, status, tests, where, ...(note ? { note } : {}) };
  });
  const list = (v: unknown, field: string) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new AppError("INVALID_INPUT", `acceptance.${field}: a list`);
    return v.slice(0, MAX_ITEMS).map((x) => (x ?? {}) as Record<string, unknown>);
  };
  const checks = list(o.checks, "checks").map((c, i) => {
    const step = str(c.step, 300);
    if (!step) throw new AppError("INVALID_INPUT", `acceptance.checks[${i}].step: what to do`);
    const command = str(c.command, 600);
    const expect = str(c.expect, 300);
    return { step, ...(command ? { command } : {}), ...(expect ? { expect } : {}) };
  });
  const risks = list(o.risks, "risks").map((r, i) => {
    const what = str(r.what, 400);
    if (!what) throw new AppError("INVALID_INPUT", `acceptance.risks[${i}].what: the risk`);
    const why = str(r.why, 400);
    return { what, ...(why ? { why } : {}) };
  });
  return { criteria, checks, risks };
}

/** "src/A.java#refunds409" → path and method; "src/A.java:42" → path. */
export function splitRef(ref: string): { path: string; method?: string } {
  const hash = ref.indexOf("#");
  if (hash >= 0) {
    const method = ref.slice(hash + 1).trim();
    return { path: ref.slice(0, hash).trim(), ...(method ? { method } : {}) };
  }
  return { path: ref.replace(/:\d+(-\d+)?$/, "").trim() };
}

function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((done) => execFile("git", args, { cwd, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => done({ ok: !e, out: String(out) })));
}

/** References the merged commit does not have: a file that is not there, or a method name its file does not contain. */
export async function missingEvidence(cwd: string, commit: string, acceptance: Acceptance): Promise<string[]> {
  const refs = new Set(acceptance.criteria.flatMap((c) => [...c.tests, ...c.where]));
  const missing: string[] = [];
  const files = new Map<string, string | null>();
  for (const ref of refs) {
    const { path, method } = splitRef(ref);
    if (!files.has(path)) {
      const r = await git(cwd, ["show", `${commit}:${path}`]);
      files.set(path, r.ok ? r.out : null);
    }
    const text = files.get(path);
    if (text === null) missing.push(`${ref} (no such file at ${commit.slice(0, 7)})`);
    else if (method && !text!.includes(method)) missing.push(`${ref} (${path} has no "${method}")`);
  }
  return missing;
}

/** The scenario names of a change's specs ("#### Scenario: Refund twice"). */
export async function specScenarios(dir: string, change: string): Promise<string[]> {
  const root = join(dir, changePath(change), "specs");
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else if (e.name === "spec.md") {
        for (const m of (await readFile(join(d, e.name), "utf8").catch(() => "")).matchAll(/^#{2,6}\s+Scenario:\s*(.+?)\s*$/gim)) out.push(m[1]!);
      }
    }
  };
  await walk(root);
  return [...new Set(out)];
}

const norm = (s: string): string => s.toLowerCase().replace(/[`*_"«»]/g, "").replace(/\s+/g, " ").trim();

/** Scenarios no criterion names in its requirement. */
export function uncoveredScenarios(acceptance: Acceptance, scenarios: string[]): string[] {
  const reqs = acceptance.criteria.map((c) => norm(c.requirement));
  return scenarios.filter((s) => !reqs.some((r) => r.includes(norm(s))));
}
