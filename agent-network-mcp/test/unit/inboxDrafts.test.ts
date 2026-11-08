import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE2_HTML } from "../../src/ui/page2.js";

function inbox() {
  class Node {
    children: Node[] = []; dataset: Record<string, string> = {}; style = { cssText: "" }; value = "";
    selectionStart = 0; selectionEnd = 0; selectionDirection = "forward";
    onclick?: () => Promise<void>; oninput?: () => void;
    constructor(public textContent = "", public tag = "") {}
    get childElementCount() { return this.children.length; }
    append(...nodes: Node[]) { this.children.push(...nodes); }
    replaceChildren(...nodes: Node[]) { this.children = nodes; doc.activeElement = null; }
    focus() { doc.activeElement = this; }
    setSelectionRange(start: number, end: number, direction: string) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  }
  const doc: { activeElement: Node | null } = { activeElement: null }, main = new Node();
  const storage = new Map<string, string>(), sent: unknown[] = [];
  const context = vm.createContext({ project: "a", document: doc, S: { tasks: [], openQuestions: ["q1", "q2"].map(messageId => ({ taskId: "t", messageId, question: messageId, from: "agent" })) },
    ATT: { projects: [{ id: "a", name: "a", items: ["q1", "q2"].map(messageId => ({ kind: "question", taskId: "t", title: messageId, since: "now", open: { messageId } })) }] },
    ATT_KIND: { question: "Вопрос" }, $: () => main, el: (tag: string, _cls: string, text = "") => new Node(text, tag), time: (x: string) => x,
    plural: (_n: number, x: string) => x, post: async (_url: string, body: unknown) => { sent.push(body); if (context.fail) throw new Error("network"); },
    tick: async () => vm.runInContext("renderInbox()", context), toast: () => {}, go: () => {}, switchProject: () => {},
    sessionStorage: { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
  });
  const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  vm.runInContext(script.slice(script.indexOf("const inboxReplyDrafts="), script.indexOf("/* blocked: три сценария")), context);
  const render = () => vm.runInContext("renderInbox()", context);
  const fields = () => [...(vm.runInContext("inboxReplyFields", context) as Map<string, Node>).values()];
  const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)];
  return { context, render, fields, doc, storage, sent, nodes: () => all(main) };
}

describe("inbox answer drafts", () => {
  it("preserves text, focus and selection through refresh and keeps simultaneous questions separate", () => {
    const h = inbox(); h.render();
    const first = h.fields()[0]!; first.value = "My unfinished answer"; first.oninput!(); first.focus(); first.setSelectionRange(3, 9, "backward");
    h.render(); const refreshed = h.fields()[0]!;
    expect(refreshed.value).toBe("My unfinished answer");
    expect(h.doc.activeElement).toBe(refreshed);
    expect([refreshed.selectionStart, refreshed.selectionEnd, refreshed.selectionDirection]).toEqual([3, 9, "backward"]);
    expect(h.fields()[1]!.value).toBe("");
    h.doc.activeElement = null;
    vm.runInContext("inboxReplyDrafts.clear()", h.context); h.render();
    expect(h.fields()[0]!.value).toBe("My unfinished answer"); // Reload from session storage.
    h.context.project = "b"; h.context.S = { tasks: [], openQuestions: [] }; h.render(); expect(h.fields()).toHaveLength(0);
    h.context.project = "a"; h.context.S = { tasks: [], openQuestions: [{ taskId: "t", messageId: "q1" }] }; h.render();
    expect(h.fields()[0]!.value).toBe("My unfinished answer");
  });
  it("answers the exact question and retains the draft after failure, clearing it only after success", async () => {
    const h = inbox(); h.render(); const field = h.fields()[1]!; field.value = "Second answer"; field.oninput!();
    h.context.fail = true; await h.nodes().filter(n => n.textContent === "Ответить")[1]!.onclick!();
    expect(h.sent[0]).toMatchObject({ messageId: "q2", answer: "Second answer" });
    expect(h.fields()[1]!.value).toBe("Second answer"); expect(h.storage.size).toBe(1);
    h.context.fail = false; await h.nodes().filter(n => n.textContent === "Ответить")[1]!.onclick!();
    expect(h.fields()[1]!.value).toBe(""); expect(h.storage.size).toBe(0);
  });
  it("retains draft after a failed dismissal and clears it after successful dismissal", async () => {
    const h = inbox(); h.render(); const field = h.fields()[0]!; field.value = "Keep until dismissed"; field.oninput!();
    h.context.fail = true; await h.nodes().filter(n => n.textContent === "Закрыть без ответа")[0]!.onclick!();
    expect(h.fields()[0]!.value).toBe("Keep until dismissed");
    h.context.fail = false; await h.nodes().filter(n => n.textContent === "Закрыть без ответа")[0]!.onclick!();
    expect(h.fields()[0]!.value).toBe(""); expect(h.storage.size).toBe(0);
  });
});
