import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nextRun, parseCron } from "../../src/schedule/cron.js";
import { Scheduler } from "../../src/schedule/scheduler.js";
import { NetworkService } from "../../src/service.js";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

/** Local time, as cron reads it. */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);
const next = (cron: string, from: Date) => nextRun(parseCron(cron), from);

describe("cron", () => {
  it("finds the next run: fixed times, steps, ranges, lists, names, shorthands", () => {
    const mon = at(2026, 10, 12, 10, 7); // Monday 10:07
    expect(next("0 3 * * *", mon)).toEqual(at(2026, 10, 13, 3, 0));
    expect(next("*/15 * * * *", mon)).toEqual(at(2026, 10, 12, 10, 15));
    expect(next("0 9-18/3 * * *", mon)).toEqual(at(2026, 10, 12, 12, 0));
    expect(next("30 8 * * 1-5", at(2026, 10, 16, 9, 0))).toEqual(at(2026, 10, 19, 8, 30)); // Friday after 8:30 -> Monday
    expect(next("0 0 1,15 * *", mon)).toEqual(at(2026, 10, 15, 0, 0));
    expect(next("0 12 * jan,jul sun", mon)).toEqual(at(2027, 1, 3, 12, 0));
    expect(next("@daily", mon)).toEqual(at(2026, 10, 13, 0, 0));
    expect(next("@weekdays", at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 19, 9, 0)); // Saturday -> Monday 9:00
    expect(next("0 0 * * 7", mon)).toEqual(at(2026, 10, 18, 0, 0)); // 7 is Sunday too
    expect(next("0 0 13 * fri", mon)).toEqual(at(2026, 10, 13, 0, 0)); // day of month OR weekday, as in cron
    expect(next("0 3 * * *", at(2026, 10, 12, 3, 0))).toEqual(at(2026, 10, 13, 3, 0)); // strictly after
    expect(next("0 0 31 2 *", mon)).toBeNull(); // never
  });

  it("refuses what it cannot read, saying why", () => {
    expect(() => parseCron("0 3 * *")).toThrow(/5 fields/);
    expect(() => parseCron("60 * * * *")).toThrow(/minute "60": 60 is outside 0-59/);
    expect(() => parseCron("0 5-2 * * *")).toThrow(/goes backwards/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/step/);
    expect(() => parseCron("0 0 * * funday")).toThrow(/weekday/);
  });
});

/** A project with runners.json (two agents and a nightly schedule) and a clock the test moves. */
async function setup(schedule: Record<string, unknown> = {}) {
  const dir = join(await tmpDir(), "shop");
  mkdirSync(dir, { recursive: true });
  const networkDir = join(dir, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const configPath = join(dir, "runners.json");
  await writeFile(
    configPath,
    JSON.stringify({
      networkDir,
      defaults: { command: ["x", "{prompt}"] },
      agents: [{ id: "backend" }, { id: "reviewer" }],
      schedules: [{ id: "nightly-flaky", cron: "0 3 * * *", title: "Flaky tests {date}", description: "Find and fix flaky tests ({date} {time}).", agents: ["backend", "reviewer"], maxFixRounds: 1, ...schedule }],
    }),
  );
  const config = await loadRunnersConfig(configPath);
  let now = at(2026, 10, 12, 2, 0).getTime();
  const scheduler = new Scheduler({ networkDir, schedules: config.schedules!, configPath, now: () => now });
  return { operator, networkDir, configPath, config, scheduler, setNow: (d: Date) => (now = d.getTime()) };
}

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("scheduler", () => {
  it("creates the task at its time, fills {date}, and skips a run while the previous task is still open", async () => {
    const { operator, scheduler, setNow } = await setup();
    await scheduler.tick();
    expect(await operator.tasks.list()).toEqual([]); // 02:00, next run at 03:00
    expect((await scheduler.status())[0]).toMatchObject({ id: "nightly-flaky", enabled: true, nextRunAt: at(2026, 10, 12, 3, 0).toISOString(), runs: [] });

    setNow(at(2026, 10, 12, 3, 0));
    await scheduler.tick();
    const [task] = await operator.tasks.list();
    expect(task).toMatchObject({ title: "Flaky tests 2026-10-12", description: "Find and fix flaky tests (2026-10-12 03:00).", agents: ["backend", "reviewer"], status: "ACTIVE" });
    await scheduler.tick();
    expect(await operator.tasks.list()).toHaveLength(1); // once per run

    setNow(at(2026, 10, 13, 3, 0)); // the first one is still running
    await scheduler.tick();
    expect(await operator.tasks.list()).toHaveLength(1);
    expect((await scheduler.status())[0]).toMatchObject({ openTask: task!.id, runs: [{ skipped: `${task!.id} of the previous run is still ACTIVE` }, { taskId: task!.id }] });

    await operator.cancelTask(task!.id, "done by hand");
    setNow(at(2026, 10, 14, 3, 0));
    await scheduler.tick();
    expect((await operator.tasks.list()).map((t) => t.title)).toEqual(["Flaky tests 2026-10-12", "Flaky tests 2026-10-14"]);
  });

  it("run now, on/off written back to runners.json, history kept across a restart, a broken task recorded as an error", async () => {
    const { operator, networkDir, configPath, config, scheduler, setNow } = await setup({ openspec: "no-such-change", title: "" });
    const run = await scheduler.runNow("nightly-flaky");
    expect(run.error).toMatch(/no-such-change/);
    await expect(scheduler.runNow("nope")).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await scheduler.setEnabled("nightly-flaky", false);
    expect(JSON.parse(await readFile(configPath, "utf8")).schedules[0].enabled).toBe(false);
    setNow(at(2026, 10, 12, 3, 0));
    await scheduler.tick();
    expect((await scheduler.status())[0]).toMatchObject({ enabled: false, nextRunAt: null, runs: [{ error: expect.any(String), manual: true }] });

    const again = new Scheduler({ networkDir, schedules: config.schedules!, configPath });
    expect((await again.status())[0]!.runs).toHaveLength(1); // the history is on disk
    expect(await operator.tasks.list()).toEqual([]);
  });

  it("the page shows the schedules and runs one now", async () => {
    const { operator, networkDir, config, scheduler } = await setup();
    ui = await startUiServer([{ networkDir, runners: new RunnerPool(networkDir, config.agents), scheduler }], { port: 0 });
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.schedules).toEqual([expect.objectContaining({ id: "nightly-flaky", cron: "0 3 * * *", title: "Flaky tests {date}", agents: ["backend", "reviewer"] })]);
    const res = (await (await fetch(`${ui.url}/api/schedules/nightly-flaky/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()) as any;
    expect(res.run.taskId).toBe("task-001");
    expect((await operator.tasks.list()).map((t) => t.id)).toEqual(["task-001"]);
  });
});

describe("schedules in runners.json", () => {
  it("are checked at start: id, cron, agents of this config, a title or an OpenSpec change", async () => {
    const dir = await tmpDir();
    const load = async (schedules: unknown) => {
      const p = join(dir, `c${Math.random()}.json`);
      await writeFile(p, JSON.stringify({ defaults: { command: ["x", "{prompt}"] }, agents: [{ id: "backend" }, { id: "reviewer" }], schedules }));
      return loadRunnersConfig(p);
    };
    const ok = { id: "nightly", cron: "@daily", title: "t", agents: ["backend"] };
    expect((await load([ok])).schedules).toEqual([{ id: "nightly", cron: "@daily", title: "t", description: "", agents: ["backend"], enabled: true }]);
    const refused = (schedules: unknown, text: string) => expect(load(schedules)).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining(text) });
    await refused([{ ...ok, id: "Nightly Run" }], '"id"');
    await refused([ok, ok], "listed twice");
    await refused([{ ...ok, cron: "0 3 * *" }], "5 fields");
    await refused([{ ...ok, agents: ["tester"] }], "tester are not agents of this config");
    await refused([{ ...ok, title: "" }], 'needs "title"');
    await refused({ ...ok }, "must be a list");
  });
});
