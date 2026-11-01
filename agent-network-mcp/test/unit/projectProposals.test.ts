import { expect, it } from "vitest";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
it("serializes supersession and approval and refuses cancelled run writes", async () => {
  const store = new ProjectStore(await FileStore.open(await tmpDir()));
  const run = await store.enqueue("m1", "request");
  await store.claim("owner");
  const input = { runId: run.runId, ownerToken: "owner", operationId: "op1", summary: "Goal", payload: { title: "Title", description: "Description", agents: ["a", "b"] } };
  const old = await store.propose(input);
  expect((await store.propose(input)).proposalId).toBe(old.proposalId);
  const next = await store.propose({ ...input, operationId: "op2", supersedes: old.proposalId });
  await expect(store.decideProposal(old.proposalId, old.hash, true, async () => {})).rejects.toThrow("pending");
  await expect(store.decideProposal(next.proposalId, "tampered", true, async () => {})).rejects.toThrow("mismatch");
  await expect(store.decideProposal(next.proposalId, next.hash, true, async () => { throw new Error("blocked"); })).rejects.toThrow("blocked");
  expect((await store.read()).proposals[1]!.status).toBe("pending");
  await store.decideProposal(next.proposalId, next.hash, true, async () => {});
  await expect(store.propose({ ...input, operationId: "op3", supersedes: next.proposalId })).rejects.toThrow("pending");
  await store.cancel(run.runId);
  await expect(store.propose({ ...input, operationId: "op4" })).rejects.toThrow("cannot write");
});

it("allows user revisions after run exit and serializes revision against approval", async () => {
  const store = new ProjectStore(await FileStore.open(await tmpDir()));
  const run = await store.enqueue("m1", "request"); await store.claim("owner");
  const payload = { title: "Task", description: "Goal", agents: ["a", "b"] };
  const old = await store.propose({ runId: run.runId, ownerToken: "owner", operationId: "op1", summary: "Goal", payload });
  await store.finish(run.runId, "owner", { result: "Proposal saved" });
  const outcomes = await Promise.allSettled([
    store.reviseProposal(old.proposalId, old.hash, { ...payload, description: "Revised" }, "Revised goal"),
    store.decideProposal(old.proposalId, old.hash, true, async () => {}),
  ]);
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const state = await store.read();
  if (state.proposals[0]!.status === "superseded") {
    expect(state.proposals[1]!.supersedes).toBe(old.proposalId);
    expect(state.proposals[1]!.operationId).not.toBe(old.operationId);
    expect(state.proposals[0]!.payload.description).toBe("Goal");
    expect(state.proposals[1]!.payload.description).toBe("Revised");
  } else expect(state.proposals[0]!.status).toBe("approved");
});
