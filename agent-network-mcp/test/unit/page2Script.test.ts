import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE2_HTML } from "../../src/ui/page2.js";

describe("the v2 page's script", () => {
  it("keeps brainstorm disclosures open across refreshes and tabs without reusing another task or epoch", () => {
    class Details {
      open = false;
      isConnected = true;
      toggle?: () => void;
      addEventListener(_event: string, handler: () => void) { this.toggle = handler; }
    }
    const task = { id: "task-001", brainstorm: { epoch: 1 } };
    const context = vm.createContext({ project: "project-a", el: () => new Details(), task });
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const start = script.indexOf("const brainstormDrafts="), end = script.indexOf("function brainstormKittens(", start);
    vm.runInContext(script.slice(start, end), context);
    const create = () => vm.runInContext('brainstormDisclosure(task,"option:1")', context) as Details;
    const first = create();
    first.open = true; first.toggle!();
    const refreshed = create();
    expect(refreshed.open).toBe(true);
    first.isConnected = false; first.open = false; first.toggle!();
    expect(create().open).toBe(true); // A removed element's queued toggle cannot overwrite the user's choice.
    refreshed.open = false; refreshed.toggle!();
    expect(create().open).toBe(false);
    refreshed.open = true; refreshed.toggle!();
    task.brainstorm.epoch = 2;
    expect(create().open).toBe(false);
    task.brainstorm.epoch = 1; task.id = "task-002";
    expect(create().open).toBe(false);
    task.id = "task-001"; context.project = "project-b";
    expect(create().open).toBe(false);
  });
  it("updates the selected sidebar task on navigation even when task data is unchanged", () => {
    class Node {
      children: Node[] = [];
      attrs: Record<string, string> = {};
      constructor(public className = "") {}
      get childElementCount() { return this.children.length; }
      append(...nodes: Node[]) { this.children.push(...nodes); }
      replaceChildren() { this.children = []; }
      setAttribute(key: string, value: string) { this.attrs[key] = value; }
    }
    const box = new Node(), route = { name: "tasks", task: "task-001" };
    const context = vm.createContext({
      S: { tasks: ["task-001", "task-002"].map((id, i) => ({ id, title: id, status: i ? "COMPLETED" : "ACTIVE", updatedAt: "2026-11-02T00:00:00Z" })) },
      ATT: null, project: "project", route,
      $: (id: string) => id === "tasklist" ? box : { value: "" },
      el: (_tag: string, cls: string) => new Node(cls), dot: () => new Node(),
      taskPreview: () => "Preview", taskDot: () => "ok", ago: () => "now",
    });
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const start = script.indexOf('let tasklistSig="";'), end = script.indexOf('/* ── «Нужно мне»', start);
    vm.runInContext(script.slice(start, end) + ";renderSidebar()", context);
    expect(box.children.map(node => node.attrs["aria-current"])).toEqual(["page", undefined]);
    route.task = "task-002";
    vm.runInContext("renderSidebar()", context);
    expect(box.children.map(node => node.attrs["aria-current"])).toEqual([undefined, "page"]);
    expect(box.children[1]!.className).toContain(" on");
    const selected = box.children[1];
    vm.runInContext("renderSidebar()", context);
    expect(box.children[1]).toBe(selected);
    route.name = "inbox";
    vm.runInContext("renderSidebar()", context);
    expect(box.children.every(node => !node.attrs["aria-current"])).toBe(true);
  });
  it("keeps every statically referenced control in the document", () => {
    const ids = new Set([...PAGE2_HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const missing = [...new Set([...script.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]))].filter(id => !ids.has(id));
    expect(missing).toEqual([]);
  });
  // the page is plain JavaScript in a string, out of reach of tsc: a typo would break the whole page at load
  it("parses", () => {
    const scripts = [...PAGE2_HTML.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new vm.Script(s)).not.toThrow();
  });
  it("updates task messages while the composer has focus and keeps the same composer", () => {
    class Node {
      children: Node[] = [];
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      parent: Node | null = null;
      constructor(public className = "", public textContent = "") {}
      append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
      insertBefore(node: Node, anchor: Node | null) {
        node.parent = this;
        const index = anchor ? this.children.indexOf(anchor) : -1;
        if (index < 0) this.children.push(node); else this.children.splice(index, 0, node);
      }
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
      querySelector(selector: string): Node | null {
        for (const child of this.children) {
          if (child.className === selector.slice(1)) return child;
          const found = child.querySelector(selector); if (found) return found;
        }
        return null;
      }
    }
    const main = new Node(), composer = new Node("composer"); composer.dataset.taskId = "task-test";
    const task = { id: "task-test", title: "Test", agents: ["lead"], phase: "DISCUSS", status: "ACTIVE", messages: [] as unknown[] };
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const source = script.slice(script.indexOf("function renderTask(){"), script.indexOf("function avLetter("));
    const context = vm.createContext({
      taskById: () => task, route: { name: "tasks", task: task.id }, $: () => main,
      document: { activeElement: { id: "composer-text", closest: () => main }, body: { scrollHeight: 1000 } },
      window: { innerHeight: 500, scrollY: 100, scrollTo: () => {} }, requestAnimationFrame: (fn: () => void) => fn(),
      el: (_tag: string, cls: string, text: string) => new Node(cls, text), badge: () => new Node(),
      phaseLabel: () => "Discussion", progressOf: () => ({ overall: 0 }), ctxLine: () => null, progressCard: () => null,
      composer: () => composer, dayOf: () => "Today", msgBubble: () => new Node("message", "new message"),
    });
    vm.runInContext(source + ";renderTask()", context);
    task.messages.push({ createdAt: "2026-11-02T17:00:00Z", content: "new message" });
    vm.runInContext("renderTask()", context);
    expect(main.querySelector(".message")?.textContent).toBe("new message");
    expect(main.querySelector(".composer")).toBe(composer);
    expect(main.children.filter(node => node === composer)).toHaveLength(1);
  });
});
