import { watch, type FSWatcher } from "node:fs";

export interface EventHubOptions {
  /** Safety net in case the OS drops fs.watch notifications. */
  fallbackPollMs?: number;
  debounceMs?: number;
  log?: (msg: string) => void;
}

interface Waiter<T> {
  check: () => Promise<T | null>;
  resolve: (v: T | null) => void;
  reject: (e: unknown) => void;
  running: boolean;
  dirty: boolean;
  done: boolean;
  timer: NodeJS.Timeout;
  cleanup?: () => void;
}

const EVENT_FILE_RE = /(^|[\\/])events[\\/]event-\d+\.json$/;

/**
 * Wake-up machinery for wait_for_event. The filesystem stays the source of truth; this class only
 * decides *when* to look again. One shared fs.watch per process (started while someone waits),
 * plus a slow poll as a fallback for lost OS events. Waiters are re-checked on every wake-up,
 * and `notify()` lets code in this process wake waiters without waiting for the OS.
 */
export class EventHub {
  private readonly waiters = new Set<Waiter<unknown>>();
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly opts: EventHubOptions = {},
  ) {}

  get activeWaiters(): number {
    return this.waiters.size;
  }

  get watching(): boolean {
    return this.watcher !== null;
  }

  /** Resolve with the first non-null result of `check`, or null on timeout/abort. */
  wait<T>(check: () => Promise<T | null>, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise<T | null>((resolve, reject) => {
      const waiter: Waiter<T> = {
        check,
        resolve,
        reject,
        running: false,
        dirty: false,
        done: false,
        timer: setTimeout(() => this.finish(waiter, null), timeoutMs),
      };
      if (signal) {
        const onAbort = () => this.finish(waiter, null);
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.cleanup = () => signal.removeEventListener("abort", onAbort);
      }
      this.waiters.add(waiter as Waiter<unknown>);
      this.ensureWatching();
      void this.run(waiter); // re-check right away: closes the gap between the caller's check and registration
    });
  }

  /** Re-check every waiter now (e.g. after this process wrote an event itself). */
  notify(): void {
    for (const w of [...this.waiters]) void this.run(w);
  }

  close(): void {
    for (const w of [...this.waiters]) this.finish(w, null);
    this.stopWatching();
  }

  private async run<T>(w: Waiter<T>): Promise<void> {
    if (w.done) return;
    if (w.running) {
      w.dirty = true;
      return;
    }
    w.running = true;
    try {
      do {
        w.dirty = false;
        const result = await w.check();
        if (result !== null) return this.finish(w, result);
      } while (w.dirty && !w.done);
    } catch (e) {
      this.finish(w, null, e, true);
    } finally {
      w.running = false;
    }
  }

  private finish<T>(w: Waiter<T>, value: T | null, error?: unknown, failed = false): void {
    if (w.done) return;
    w.done = true;
    clearTimeout(w.timer);
    w.cleanup?.();
    this.waiters.delete(w as Waiter<unknown>);
    if (this.waiters.size === 0) this.stopWatching();
    if (failed) w.reject(error);
    else w.resolve(value);
  }

  private ensureWatching(): void {
    if (!this.poll) {
      this.poll = setInterval(() => this.notify(), this.opts.fallbackPollMs ?? 1000);
    }
    if (this.watcher) return;
    try {
      const watcher = watch(this.rootDir, { recursive: true }, (_type, filename) => {
        if (filename && !EVENT_FILE_RE.test(String(filename))) return;
        this.scheduleNotify();
      });
      watcher.on("error", (err) => {
        this.opts.log?.(`fs.watch error, falling back to polling: ${err.message}`);
        this.watcher?.close();
        this.watcher = null;
      });
      this.watcher = watcher;
    } catch (e) {
      this.opts.log?.(`fs.watch unavailable, polling only: ${(e as Error).message}`);
    }
  }

  private scheduleNotify(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.notify();
    }, this.opts.debounceMs ?? 10);
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
  }
}
