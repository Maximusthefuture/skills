import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE2_HTML } from "../../src/ui/page2.js";

const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
function group(messages: unknown[], mode = "threads") {
  const context = vm.createContext({ messages, mode });
  vm.runInContext(script.slice(script.indexOf("function taskMessageGroups("), script.indexOf("function taskMessageBubble(")), context);
  return JSON.parse(JSON.stringify(vm.runInContext("taskMessageGroups(messages,mode)", context)));
}
const message = (id: string, minute: number, replyTo?: string) => ({ id, createdAt: `2026-11-08T10:${String(minute).padStart(2, "0")}:00Z`, ...(replyTo ? { replyTo } : {}) });
describe("task message threads", () => {
  it("preserves chosen modes and expanded replies per project and task", () => {
    class Node {
      open = false;
      isConnected = true;
      style = {};
      toggle?: () => void;
      append() {}
      addEventListener(_name: string, handler: () => void) { this.toggle = handler; }
    }
    const task = { id: "one" };
    const context = vm.createContext({ project: "alpha", task, el: () => new Node(), msgBubble: () => new Node(), questionBubble: () => new Node() });
    vm.runInContext(script.slice(script.indexOf("const taskMessageModes="), script.indexOf("function msgBubble(")), context);
    vm.runInContext('taskMessageModes.set(taskMessageKey(task),"time")', context);
    expect(vm.runInContext("taskMessageMode(task)", context)).toBe("time");
    const create = () => vm.runInContext('taskMessageReplies(task,{id:"root"},[{type:"INFORMATION"}],"lead")', context) as Node;
    const first = create(); first.open = true; first.toggle!();
    expect(create().open).toBe(true);
    task.id = "two";
    expect(create().open).toBe(false);
    expect(vm.runInContext("taskMessageMode(task)", context)).toBe("threads");
    task.id = "one"; context.project = "beta";
    expect(create().open).toBe(false);
    expect(vm.runInContext("taskMessageMode(task)", context)).toBe("threads");
    context.project = "alpha";
    expect(create().open).toBe(true);
    expect(vm.runInContext("taskMessageMode(task)", context)).toBe("time");
    first.isConnected = false; first.open = false; first.toggle!();
    expect(create().open).toBe(true);
  });
  it("keeps nested answers together and parallel questions separate", () => {
    const a = message("a", 0), b = message("b", 1), answer = message("answer", 2, "a"), follow = message("follow", 3, "answer");
    expect(group([follow, answer, b, a])).toEqual([{ root: a, replies: [answer, follow] }, { root: b, replies: [] }]);
  });
  it("offers all messages in chronological order", () => {
    const a = message("a", 0), b = message("b", 1, "a");
    expect(group([b, a], "time")).toEqual([{ root: a, replies: [] }, { root: b, replies: [] }]);
  });
  it("preserves missing-parent messages and malformed cycles without duplicates", () => {
    const messages = [message("a", 0, "b"), message("b", 1, "a"), message("orphan", 2, "absent")];
    const result = group(messages);
    expect(result.flatMap((item: any) => [item.root, ...item.replies]).map((m: any) => m.id).sort()).toEqual(["a", "b", "orphan"]);
  });
});
