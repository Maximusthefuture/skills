import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE2_HTML } from "../../src/ui/page2.js";

function harness(storage = new Map<string, string>()) {
  class Details {
    open = false;
    isConnected = true;
    dataset: Record<string, string> = {};
    children: Details[] = [];
    ontoggle?: () => void;
    private listener?: () => void;
    addEventListener(_event: string, fn: () => void) { this.listener = fn; }
    append(...nodes: Details[]) { this.children.push(...nodes); }
    toggle() { this.listener?.(); this.ontoggle?.(); }
    querySelectorAll() {
      const visit = (node: Details): Details[] => node.children.flatMap(child => [child, ...visit(child)]);
      return visit(this).filter(node => node.dataset.taskDisclosure);
    }
  }
  const context = vm.createContext({
    project: "project-a", task: { id: "task-a" },
    el: () => new Details(),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const start = script.indexOf("const taskDisclosureStates=");
  expect(start).toBeGreaterThanOrEqual(0);
  vm.runInContext(script.slice(start, script.indexOf("function taskById(", start)), context);
  const create = (key: string) => vm.runInContext(`taskDisclosure(task,${JSON.stringify(key)})`, context) as Details;
  const remember = (container: Details) => { context.container = container; vm.runInContext("rememberTaskDisclosures(container)", context); };
  return { create, remember, context, storage, container: () => new Details() };
}

describe("task disclosure state across live refresh", () => {
  it("preserves open nested discussion/messages/outcomes and decision sources after redraw and full reload", () => {
    const h = harness(), container = h.container();
    const discussion = h.create("discussion:question-1"), messages = h.create("discussion:question-1:messages"), outcomes = h.create("discussion:question-1:outcomes");
    const decisions = h.create("decisions"), source = h.create("decision:plan:3:source");
    discussion.append(messages, outcomes); decisions.append(source); container.append(discussion, decisions);
    // A refresh can occur before the browser dispatches the queued toggle events.
    for (const node of [discussion, messages, outcomes, decisions, source]) node.open = true;
    h.remember(container);
    for (const key of ["discussion:question-1", "discussion:question-1:messages", "discussion:question-1:outcomes", "decisions", "decision:plan:3:source"]) expect(h.create(key).open).toBe(true);
    const reloaded = harness(h.storage);
    for (const key of ["discussion:question-1", "discussion:question-1:messages", "discussion:question-1:outcomes", "decisions", "decision:plan:3:source"]) expect(reloaded.create(key).open).toBe(true);
  });

  it("persists collapsed choices and ignores detached nodes' queued toggle events", () => {
    const h = harness(), container = h.container(), old = h.create("discussion:question-1:messages");
    old.open = true; container.append(old); h.remember(container);
    const current = h.create("discussion:question-1:messages"); current.open = false; current.toggle();
    old.isConnected = false; old.open = true; old.toggle();
    expect(h.create("discussion:question-1:messages").open).toBe(false);
    expect(harness(h.storage).create("discussion:question-1:messages").open).toBe(false);
  });

  it("does not leak expanded state across projects, tasks or discussion roots", () => {
    const h = harness(), container = h.container(), node = h.create("discussion:question-1:messages");
    node.open = true; container.append(node); h.remember(container);
    expect(h.create("discussion:question-2:messages").open).toBe(false);
    h.context.task = { id: "task-b" }; expect(h.create("discussion:question-1:messages").open).toBe(false);
    h.context.task = { id: "task-a" }; h.context.project = "project-b"; expect(h.create("discussion:question-1:messages").open).toBe(false);
    h.context.project = "project-a"; expect(h.create("discussion:question-1:messages").open).toBe(true);
  });
});
