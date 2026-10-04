import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "../../src/events/eventHub.js";
import { tmpDir } from "../helpers/tmp.js";

async function eventsDir() {
  const root = await tmpDir();
  const dir = join(root, "tasks", "task-001", "events");
  await mkdir(dir, { recursive: true });
  return { root, dir };
}

describe("EventHub", () => {
  it("wakes a waiter when an event file appears", async () => {
    const { root, dir } = await eventsDir();
    const hub = new EventHub(root, { fallbackPollMs: 10_000 });
    let found = false;
    const waiting = hub.wait(async () => (found ? "got-it" : null), 5_000);
    await new Promise((r) => setTimeout(r, 100));
    found = true;
    const started = Date.now();
    await writeFile(join(dir, "event-001.json"), "{}");
    expect(await waiting).toBe("got-it");
    expect(Date.now() - started).toBeLessThan(2_000); // woken by fs.watch, not by the 10s poll
    hub.close();
  });

  it("returns null on timeout and releases the watcher", async () => {
    const { root } = await eventsDir();
    const hub = new EventHub(root);
    expect(await hub.wait(async () => null, 80)).toBeNull();
    expect(hub.activeWaiters).toBe(0);
    expect(hub.watching).toBe(false);
  });

  it("uses a single shared watcher for many waiters", async () => {
    const { root } = await eventsDir();
    const hub = new EventHub(root);
    const waiters = Array.from({ length: 25 }, () => hub.wait(async () => null, 150));
    expect(hub.activeWaiters).toBe(25);
    expect(hub.watching).toBe(true);
    await Promise.all(waiters);
    expect(hub.watching).toBe(false);
  });

  it("falls back to polling when the watcher is unavailable (lost OS events)", async () => {
    const hub = new EventHub(join(await tmpDir(), "does-not-exist"), { fallbackPollMs: 20 });
    let found = false;
    setTimeout(() => (found = true), 60);
    expect(await hub.wait(async () => (found ? "polled" : null), 2_000)).toBe("polled");
    expect(hub.watching).toBe(false);
  });

  it("notify() wakes waiters immediately", async () => {
    const { root } = await eventsDir();
    const hub = new EventHub(root, { fallbackPollMs: 60_000 });
    let found = false;
    const waiting = hub.wait(async () => (found ? 1 : null), 5_000);
    await new Promise((r) => setTimeout(r, 30));
    found = true;
    hub.notify();
    expect(await waiting).toBe(1);
    hub.close();
  });

  it("propagates check errors", async () => {
    const { root } = await eventsDir();
    const hub = new EventHub(root);
    await expect(hub.wait(async () => { throw new Error("disk on fire"); }, 1_000)).rejects.toThrow("disk on fire");
    expect(hub.activeWaiters).toBe(0);
  });

  it("stops on abort", async () => {
    const { root } = await eventsDir();
    const hub = new EventHub(root);
    const ac = new AbortController();
    const waiting = hub.wait(async () => null, 10_000, ac.signal);
    setTimeout(() => ac.abort(), 30);
    expect(await waiting).toBeNull();
    expect(hub.activeWaiters).toBe(0);
  });
});
