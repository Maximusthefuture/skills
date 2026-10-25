import { AppError } from "../errors.js";
import type { FileStore } from "../storage/fileStore.js";
import type { Task } from "../types.js";
import { deployNotes, type DeployNotes } from "./notes.js";
import { branchName, pushTask, runGit, type Git, type PushResult } from "./push.js";
import { jenkinsMissing, loadSettings, type DeploySettings } from "./settings.js";

/**
 * A deploy of one merged task to one environment, step by step: «Для раскатки» from the diff, the push to Bitbucket,
 * the Jenkins job, the rollout in Kubernetes. Each run is kept in <network>/deploys/dep-NNN.json with every step's
 * state, so the tab shows it after a restart. Only the operator starts one, from the page; the agents cannot.
 */

export type StepName = "notes" | "push" | "jenkins" | "kubernetes";
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface DeployStep {
  name: StepName;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  /** One line for the step's row. */
  summary?: string;
  /** The longer text: git's output, the job's log tail. */
  output?: string;
  link?: string;
}

export interface DeployRun {
  id: string;
  taskId: string;
  taskTitle: string;
  env: string;
  commit: string;
  base: string;
  branch: string;
  remote: string;
  status: "running" | "ok" | "failed" | "cancelled";
  createdAt: string;
  endedAt?: string;
  steps: DeployStep[];
  notes?: DeployNotes;
  push?: Omit<PushResult, "output">;
}

const DIR = ["deploys"];
const STEP_NAMES: StepName[] = ["notes", "push", "jenkins", "kubernetes"];

/** The commit a merged task is in, and the one before it: the diff «Для раскатки» reads. */
export function mergedCommits(task: Task): { commit: string; base: string } {
  const m = task.merged;
  if (!m) throw new AppError("INVALID_INPUT", `${task.id} is not merged into the project yet: «Влить в проект» first`);
  if (m.reverted) throw new AppError("INVALID_INPUT", `${task.id} was reverted (${m.reverted.commit.slice(0, 7)}): nothing to deploy`);
  return { commit: m.commit, base: m.already && task.baseCommit ? task.baseCommit : `${m.commit}^1` };
}

/**
 * Where a merged task stands on its way out: "merged" (not pushed), "branch" (in Bitbucket, on no stand yet),
 * "deployed" (the rollout check passed in `envs`), "running", or "failed" (the latest deploy failed and it is on no stand).
 */
export interface TaskDeployState {
  stage: "merged" | "branch" | "running" | "deployed" | "failed";
  /** Environments whose latest deploy of this task passed the Kubernetes check. */
  envs: string[];
  branch?: string;
  branchUrl?: string;
  lastRun?: { id: string; env: string; status: DeployRun["status"]; at: string };
}

export function taskDeployState(taskId: string, runs: DeployRun[]): TaskDeployState {
  const mine = runs.filter((r) => r.taskId === taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const step = (r: DeployRun, n: StepName) => r.steps.find((s) => s.name === n)?.status;
  const envs: string[] = [];
  const seen = new Set<string>();
  for (const r of mine) {
    if (seen.has(r.env) || r.status === "running" || r.status === "cancelled") continue;
    seen.add(r.env); // only the latest finished deploy of each environment counts
    if (step(r, "kubernetes") === "ok") envs.push(r.env);
  }
  const pushed = mine.find((r) => step(r, "push") === "ok");
  const last = mine[0];
  const stage: TaskDeployState["stage"] = mine.some((r) => r.status === "running") ? "running" : envs.length ? "deployed" : last?.status === "failed" ? "failed" : pushed ? "branch" : "merged";
  return {
    stage,
    envs: envs.sort(),
    ...(pushed ? { branch: pushed.branch, ...(pushed.push?.webUrl ? { branchUrl: pushed.push.webUrl } : {}) } : {}),
    ...(last ? { lastRun: { id: last.id, env: last.env, status: last.status, at: last.createdAt } } : {}),
  };
}

export class Deployer {
  private readonly active = new Map<string, AbortController>();
  private recovered = false;

  constructor(
    private readonly fs: FileStore,
    private readonly projectDir: string,
    private readonly git: Git = runGit,
  ) {}

  settings(): Promise<DeploySettings> {
    return loadSettings(this.fs);
  }

  async list(): Promise<DeployRun[]> {
    await this.recover();
    const names = await this.fs.listJsonNames(DIR);
    const runs = (await Promise.all(names.map((n) => this.fs.readJson<DeployRun>([...DIR, `${n}.json`])))).filter((r): r is DeployRun => !!r);
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<DeployRun> {
    if (!/^dep-\d{3,}$/.test(id)) throw new AppError("INVALID_INPUT", `No deploy ${id}`);
    const run = await this.fs.readJson<DeployRun>([...DIR, `${id}.json`]);
    if (!run) throw new AppError("INVALID_INPUT", `No deploy ${id}`);
    return run;
  }

  /** «Для раскатки» of a merged task for the page's preview, before anything is pushed. */
  async notes(task: Task): Promise<DeployNotes> {
    const { commit, base } = mergedCommits(task);
    return deployNotes(this.projectDir, base, commit, (await this.settings()).environments);
  }

  /** Starts a deploy and returns it at once; the steps go on in the background (and are written as they go). */
  async start(task: Task, env: string): Promise<DeployRun> {
    await this.recover();
    const settings = await this.settings();
    const environment = settings.environments.find((e) => e.name === env);
    if (!environment) throw new AppError("INVALID_INPUT", `No environment "${env}" in the settings (${settings.environments.map((e) => e.name).join(", ")})`);
    const { commit, base } = mergedCommits(task);
    const running = (await this.list()).find((r) => r.taskId === task.id && r.status === "running");
    if (running) throw new AppError("DEPLOY_RUNNING", `${running.id} of ${task.id} to ${running.env} is still running`);
    const run: DeployRun = {
      id: await this.nextId(),
      taskId: task.id,
      taskTitle: task.title,
      env,
      commit,
      base,
      branch: branchName(settings.bitbucket.branch, { task: task.id, ...(task.openspec?.change ? { change: task.openspec.change } : task.proposes?.change ? { change: task.proposes.change } : {}), title: task.title, env }),
      remote: settings.bitbucket.remote,
      status: "running",
      createdAt: new Date().toISOString(),
      steps: STEP_NAMES.map((name) => ({ name, status: "pending" })),
    };
    await this.save(run);
    const stop = new AbortController();
    this.active.set(run.id, stop);
    void this.execute(run, settings, stop.signal).finally(() => this.active.delete(run.id));
    return run;
  }

  async cancel(id: string): Promise<DeployRun> {
    const run = await this.get(id);
    if (run.status !== "running") return run;
    this.active.get(id)?.abort();
    for (const s of run.steps) if (s.status === "pending" || s.status === "running") Object.assign(s, { status: "skipped", summary: "отменено", endedAt: new Date().toISOString() });
    run.status = "cancelled";
    run.endedAt = new Date().toISOString();
    await this.save(run);
    return run;
  }

  private async execute(run: DeployRun, settings: DeploySettings, signal: AbortSignal): Promise<void> {
    const step = async (name: StepName, fn: (s: DeployStep) => Promise<void>): Promise<boolean> => {
      if (signal.aborted) return false;
      const s = run.steps.find((x) => x.name === name)!;
      Object.assign(s, { status: "running", startedAt: new Date().toISOString() });
      await this.save(run);
      try {
        await fn(s);
        if (s.status === "running") s.status = "ok";
      } catch (e) {
        s.status = "failed";
        s.summary = (e as Error).message.split("\n")[0]!.slice(0, 300);
        s.output = (e as Error).message.slice(0, 4000);
      }
      s.endedAt = new Date().toISOString();
      if (signal.aborted) return false; // cancelled while the step ran: cancel() wrote the run
      await this.save(run);
      return s.status !== "failed";
    };
    const ok =
      (await step("notes", async (s) => {
        run.notes = await deployNotes(this.projectDir, run.base, run.commit, settings.environments);
        const missing = run.notes.missing.filter((m) => m.env === run.env);
        s.summary = `свойств: ${run.notes.properties.length}, миграций: ${run.notes.migrations.length}` + (missing.length ? ` · в ${run.env} не задано: ${missing.map((m) => m.envVar).join(", ")}` : "");
      })) &&
      (await step("push", async (s) => {
        const r = await pushTask(this.projectDir, { remote: run.remote, branch: run.branch, commit: run.commit, ...(settings.bitbucket.webUrl ? { webUrlTemplate: settings.bitbucket.webUrl } : {}) }, this.git);
        const { output, ...rest } = r;
        run.push = rest;
        s.summary = `${run.branch} → ${run.remote} · коммитов: ${r.commits.length}`;
        s.output = output;
        if (r.webUrl) s.link = r.webUrl;
      })) &&
      (await step("jenkins", async (s) => {
        s.status = "skipped";
        s.summary = jenkinsMissing(settings) ?? "запуск job через MCP Jenkins появится на следующем этапе";
      })) &&
      (await step("kubernetes", async (s) => {
        s.status = "skipped";
        const e = settings.environments.find((x) => x.name === run.env);
        s.summary = !e?.namespace || !e.deployment ? `Kubernetes для ${run.env} не настроен: namespace и deployment в настройках` : "проверка раскатки появится на следующем этапе";
      }));
    if (signal.aborted) return;
    run.status = ok ? "ok" : "failed";
    run.endedAt = new Date().toISOString();
    await this.save(run);
  }

  /** A deploy that was running when the page's server stopped cannot go on: it is marked as interrupted. */
  private async recover(): Promise<void> {
    if (this.recovered) return;
    this.recovered = true;
    for (const n of await this.fs.listJsonNames(DIR)) {
      const run = await this.fs.readJson<DeployRun>([...DIR, `${n}.json`]);
      if (!run || run.status !== "running" || this.active.has(run.id)) continue;
      for (const s of run.steps) if (s.status === "running" || s.status === "pending") Object.assign(s, { status: s.status === "running" ? "failed" : "skipped", summary: "прервано: сервер страницы перезапускался" });
      run.status = "failed";
      run.endedAt = new Date().toISOString();
      await this.save(run);
    }
  }

  private async nextId(): Promise<string> {
    const n = Math.max(0, ...(await this.fs.listJsonNames(DIR)).map((x) => Number(/^dep-(\d+)$/.exec(x)?.[1] ?? 0))) + 1;
    return `dep-${String(n).padStart(3, "0")}`;
  }

  private save(run: DeployRun): Promise<void> {
    return this.fs.writeJson([...DIR, `${run.id}.json`], run);
  }
}
