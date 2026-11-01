import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { FileStore } from "../storage/fileStore.js";
import { ProjectStore, type ProjectMessage, type ProjectRun } from "./store.js";

export interface CoordinatorInput {
  message: ProjectMessage;
  run: ProjectRun;
  signal: AbortSignal;
  retryContext?: unknown;
}
/** Resolves only once the CLI and its output streams have closed, including after abort. */
export type CoordinatorExecutor = (input: CoordinatorInput) => Promise<string>;
interface Owner { pid: number; token: string }
const ownerPath = ["project", "coordinator-owner.json"];

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/** Ownership has no time-based expiry: a suspended live process must not lose its lease. */
export class ProjectCoordinator {
  private readonly store: ProjectStore;
  private readonly token = randomUUID();
  private stopped = false;
  private active?: AbortController;
  private loop?: Promise<void>;

  constructor(private readonly fs: FileStore, private readonly execute: CoordinatorExecutor,
    private readonly pollMs = 250,
  private readonly reconcileRetry?: (previousRunId: string) => Promise<unknown>) { this.store = new ProjectStore(fs); }

  async start(): Promise<boolean> {
    if (this.loop) return true;
    const acquired = await this.fs.withLock(["project", ".owner-lock"], async () => {
      const owner = await this.fs.readJson<Owner>(ownerPath);
      if (owner && alive(owner.pid)) return false;
      await this.fs.writeJson(ownerPath, { pid: process.pid, token: this.token });
      return true;
    });
    if (!acquired) return false;
    this.stopped = false;
    try { await this.store.recoverInterrupted(); }
    catch (error) { await this.release(); throw error; }
    this.loop = this.work().finally(() => this.release());
    // Callers can await stop() to receive errors; avoid an unhandled rejection while idle.
    void this.loop.catch(() => undefined);
    return true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.active?.abort();
    try { await this.loop; } finally { this.loop = undefined; }
  }

  private async release(): Promise<void> {
    await this.fs.withLock(["project", ".owner-lock"], async () => {
      const owner = await this.fs.readJson<Owner>(ownerPath);
      if (owner?.token === this.token) await rm(this.fs.resolve(ownerPath), { force: true });
    });
  }

  private async work(): Promise<void> {
    while (!this.stopped) {
      const run = await this.store.claim(this.token);
      if (!run) { await delay(this.pollMs); continue; }
      this.active = new AbortController();
      const controller = this.active;
      if (this.stopped) controller.abort();
      let exited = false;
      const watch = (async () => {
        while (!exited) {
          const current = (await this.store.read()).runs.find(r => r.runId === run.runId);
          if (current?.cancelRequested || this.stopped) controller.abort();
          if (!exited) await delay(this.pollMs);
        }
      })();
      let monitorError: unknown;
      void watch.catch(error => { monitorError = error; controller.abort(); });
      let outcome: { result?: string; error?: string };
      let retryContext: unknown;
      try {
        if (run.retryOfRunId) {
          if (!this.reconcileRetry) throw new Error("Retry requires operation reconciliation");
          retryContext = await this.reconcileRetry(run.retryOfRunId);
        }
        const state = await this.store.read();
        const message = state.messages.find(m => m.messageId === run.messageId)!;
        outcome = { result: await this.execute({ message, run, signal: controller.signal, ...(retryContext !== undefined ? { retryContext } : {}) }) };
      } catch (error) { outcome = { error: error instanceof Error ? error.message : String(error) }; }
      finally { exited = true; await watch.catch(() => undefined); this.active = undefined; }
      if (monitorError) throw monitorError;
      if (this.stopped) outcome = { error: "interrupted" };
      await this.store.finish(run.runId, this.token, outcome);
    }
  }
}
