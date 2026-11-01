import { expect, it } from "vitest";
import { normalizeProjectTask, payloadHash } from "../../src/project/payload.js";
const base = { title: "Task", description: "Goal", agents: ["a", "b"] };
it("preserves all task parameters and distinguishes absent grill from explicit false", () => {
  const input = { ...base, proposes: "change", from: ["input.md"], clarify: true, grill: false,
    parentTaskId: "task-001", baseCommit: "abc", contract: "/contract", allowSpawn: false,
    maxFixRounds: 2, maxFollowUps: 0, maxCostUsd: 3, verifyCommand: "npm test" };
  const effective = normalizeProjectTask(input, { maxTaskCostUsd: 5 });
  expect(effective).toEqual({ ...input, maxTaskCostUsd: 5 });
  const { grill: _, ...absent } = effective;
  expect(payloadHash(effective)).not.toBe(payloadHash(absent));
  expect(payloadHash(effective)).toBe(payloadHash({ ...effective }));
  expect(payloadHash(effective)).not.toBe(payloadHash({ ...effective, maxTaskCostUsd: 6 }));
});
it("rejects unknown fields, invalid modes and duplicate agents", () => {
  for (const extra of [{ unknown: true }, { openspec: "x", proposes: "y" }, { from: ["x"] },
    { proposes: "x", planReview: true }, { agents: ["a", "a"] }]) {
    expect(() => normalizeProjectTask({ ...base, ...extra }, {})).toThrow();
  }
});
