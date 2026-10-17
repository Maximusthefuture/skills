import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { tmpDir } from "../helpers/tmp.js";

async function setup() {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const backend = await NetworkService.create(dir, { id: "backend", type: "test" });
  await backend.registerAgent();
  const first = await operator.createTaskAsOperator({ title: "first", description: "d", agents: ["backend", "reviewer"] });
  const next = await operator.createTaskAsOperator({ title: "next", description: "d", agents: ["backend", "reviewer"] });
  return { operator, backend, first, next };
}

describe("a runner's session stays with its own task", () => {
  it("its task done, the session ends instead of taking the next one; a session without a task of its own goes on", async () => {
    const { operator, backend, first, next } = await setup();
    await operator.tasks.save({ ...(await operator.tasks.get(first.id)), status: "COMPLETED", phase: "DONE" });

    const pinned = await new Swarm(backend, undefined, { underRunner: true, sessionTask: first.id }).context();
    expect(pinned).toMatchObject({ nextAction: "done", allowedActions: [] });
    expect(String(pinned.hint)).toContain("fresh session");
    expect((pinned.task as { id: string }).id).toBe(first.id);

    // interactive (not a runner): the agent simply goes on with its next task
    const free = await new Swarm(backend, undefined, { sessionTask: first.id }).context();
    expect((free.task as { id: string }).id).toBe(next.id);
    expect(free.nextAction).not.toBe("done");
  });

  it("a cancelled task ends the session too; while its task runs nothing changes", async () => {
    const { operator, backend, first } = await setup();
    const running = await new Swarm(backend, undefined, { underRunner: true, sessionTask: first.id }).context();
    expect((running.task as { id: string }).id).toBe(first.id);
    expect(running.nextAction).not.toBe("done");
    await operator.cancelTask(first.id, "not needed");
    const ended = await new Swarm(backend, undefined, { underRunner: true, sessionTask: first.id }).context();
    expect(ended).toMatchObject({ nextAction: "done" });
    expect(String(ended.hint)).toContain("cancelled");
  });
});
