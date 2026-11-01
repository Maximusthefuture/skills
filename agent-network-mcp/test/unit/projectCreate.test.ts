import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { ProjectStore } from "../../src/project/store.js";
import { ProjectCommandService } from "../../src/project/commands.js";
import { tmpDir } from "../helpers/tmp.js";
it("creates only approved payloads and recovers task membership without duplicates", async () => {
  const dir = await tmpDir(), fs = await FileStore.open(dir);
  const operator = await NetworkService.create(dir, { id: "operator", type: "ui" });
  try {
    const store = new ProjectStore(fs);
    const run = await store.enqueue("m1", "request");await store.claim("owner");
    const proposal = await store.propose({ runId: run.runId, ownerToken: "owner", operationId: "create1", summary: "Task", payload: { title: "Task", description: "Goal", agents: ["a", "b"], maxCostUsd: 4, verifyCommand: "npm test" } });
    const commands = new ProjectCommandService(fs, operator);
    await expect(commands.createFromProposal(proposal.proposalId, proposal.hash, async () => {})).rejects.toThrow("approval");
    await store.decideProposal(proposal.proposalId, proposal.hash, true, async () => {});
    let checks = 0;
    const results = await Promise.all([1, 2].map(() => commands.createFromProposal(proposal.proposalId, proposal.hash, async () => { checks++; })));
    expect(results[0]!.id).toBe(results[1]!.id);
    expect(checks).toBe(1);
    expect(await operator.tasks.list()).toHaveLength(1);
    expect(results[0]).toMatchObject({ maxCostUsd: 4, verifyCommand: "npm test" });
    expect((await store.read()).tasks).toEqual([{ taskId: results[0]!.id, operationId: "create1", origin: "created" }]);
    expect((await store.read()).proposals[0]!.status).toBe("executed");
  } finally { operator.close(); }
});
