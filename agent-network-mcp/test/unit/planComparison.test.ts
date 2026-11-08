import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { reviewFileDiff } from "../../src/planComparison.js";
import { PAGE2_HTML } from "../../src/ui/page2.js";

describe("review comparison", () => {
  it("shows additions, removals and changed text while skipping identical files", () => {
    const file = (name: string, text: string) => ({ name, text, hash: text, bytes: text.length });
    const result = reviewFileDiff([file("same", "same"), file("gone", "old"), file("edit", "first\nold\nlast")], [file("same", "same"), file("new", "new"), file("edit", "first\nnew\nlast")]);
    expect(result.map(f => [f.name, f.status])).toEqual([["edit", "modified"], ["gone", "removed"], ["new", "added"]]);
    expect(result[0]!.lines).toContain("-old"); expect(result[0]!.lines).toContain("+new");
  });
  it("marks binary and oversized contents without inventing a text diff", () => {
    const result = reviewFileDiff([], [{ name: "blob", hash: "one", bytes: 20 }, { name: "huge", hash: "two", bytes: 300_000, textUnavailable: "size-limit" }]);
    expect(result.map(f => [f.binary, f.unavailable, f.lines])).toEqual([[true, "binary", []], [true, "size-limit", []]]);
  });
  it("compares v3 to the approved v1 rather than the unapproved v2 and keeps stages apart", () => {
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const context = vm.createContext({ PV: { version: 4, diffBase: "approved", plan: {
      versions: [{ n: 1, stage: "input" }, { n: 2, stage: "change" }, { n: 3, stage: "change" }, { n: 4, stage: "change" }],
      approvals: [{ version: 1, at: "input" }, { version: 2, at: "accepted" }],
    } } });
    vm.runInContext(script.slice(script.indexOf("function planApprovedBase("), script.indexOf("function planFilesView(")), context);
    expect(vm.runInContext("planPrev()", context)).toBe(2);
    vm.runInContext('PV.diffBase="previous"', context);
    expect(vm.runInContext("planPrev()", context)).toBe(3);
    vm.runInContext('PV.diffBase="approved";PV.version=2', context);
    expect(vm.runInContext("planApprovedBase()", context)).toBeNull();
  });
  it("limits large displayed diffs", () => {
    const result = reviewFileDiff([], [{ name: "large", hash: "x", bytes: 10000, text: "line\n".repeat(3000) }]);
    expect(result[0]!.truncated).toBe(true); expect(result[0]!.lines.length).toBe(2000);
  });
  it("does not paint an outdated comparison into another opened version", async () => {
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    let resolve!: (value: { html: string }) => void;
    const sent: unknown[] = [];
    const context = vm.createContext({ PV: { taskId: "task-001", version: 3, diff: true },
      planPrev: () => 1, q: (s: string) => s,
      getJSON: () => new Promise(r => { resolve = r; }), planSay: (m: unknown) => sent.push(m), renderPlanSide: () => {}, toast: () => {},
    });
    vm.runInContext(script.slice(script.indexOf("async function planDiff("), script.indexOf('addEventListener("message",ev=>', script.indexOf("async function planDiff("))), context);
    const pending = vm.runInContext("planDiff()", context);
    vm.runInContext("PV.version=4", context);
    resolve({ html: "old request" }); await pending;
    expect(sent).toEqual([]);
  });
});
