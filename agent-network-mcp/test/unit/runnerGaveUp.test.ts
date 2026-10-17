import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunnerOptions } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

describe("a runner that gave up", () => {
  it("blocks the task for the operator; trying again unblocks it without touching the fix rounds", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"] });
    const backend = await NetworkService.create(dir, { id: "backend", type: "test" });
    await expect(backend.blockForRunner(task.id, "reviewer", "x")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const blocked = await operator.blockForRunner(task.id, "reviewer", "4 sessions ended before its part was done (last exit 1)");
    expect(blocked).toMatchObject({ status: "BLOCKED", blockedBy: "runner", blockedReason: expect.stringContaining("reviewer's runner gave up: 4 sessions") });
    expect(await operator.blockForRunner(task.id, "reviewer", "again")).toBeNull(); // blocked already
    const event = (await operator.events.list(task.id)).map((e) => e.event).find((e) => e.type === "TASK_BLOCKED")!;
    expect(event.payload).toMatchObject({ kind: "runner", agentId: "reviewer" });

    const back = await operator.unblockTask(task.id, 1);
    expect(back).toMatchObject({ status: "ACTIVE", maxFixRounds: 3 });
    expect(back.blockedBy).toBeUndefined();
  });

  it("the pool hands the give-up to the page with the agent's id", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const calls: string[] = [];
    const pool = new RunnerPool(dir, [{ id: "reviewer", command: ["x"], autostart: false }], {
      run: async (o: RunnerOptions) => {
        await o.onGiveUp?.("task-001", "4 sessions ended");
        return 0;
      },
      onGiveUp: async (agentId, taskId, reason) => {
        calls.push(`${agentId}/${taskId}: ${reason}`);
      },
    });
    pool.start("reviewer");
    await new Promise((d) => setTimeout(d, 50));
    expect(calls).toEqual(["reviewer/task-001: 4 sessions ended"]);
  });
});
