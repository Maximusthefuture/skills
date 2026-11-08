import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE2_HTML } from "../../src/ui/page2.js";
import { RUNNER_PROFILES } from "../../src/runnerProfiles.js";

function setup() {
  class Node {
    children: Node[] = []; value = ""; disabled = false; onchange?: () => void; onclick?: () => Promise<void>;
    constructor(public textContent = "", public tag = "") {}
    append(...nodes: Node[]) { this.children.push(...nodes); }
    setAttribute() {}
  }
  const sent: unknown[] = [], notices: string[] = [];
  const context = vm.createContext({ S: { control: { runnerProfiles: RUNNER_PROFILES } },
    el: (tag: string, _cls: string, text: string) => new Node(text, tag),
    post: async (path: string, body: unknown) => { sent.push({ path, body }); if (context.fail) throw Error("Save failed"); },
    toast: (...args: string[]) => notices.push(args.join(" ")), tick: async () => {},
  });
  const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  vm.runInContext(script.slice(script.indexOf("function runnerProfileSelect("), script.indexOf("function renderAgents(")), context);
  const editor = vm.runInContext('runnerProfileEditor({id:"reviewer",profile:"reviewer"})', context) as { control: Node; info: Node };
  return { context, sent, notices, editor, select: editor.control.children[0]!, apply: editor.control.children[1]! };
}
describe("runner role profile controls", () => {
  it("keeps creation choices across redraws without sharing them with another project", () => {
    const script = PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const context = vm.createContext({ project: "one" });
    vm.runInContext(script.slice(script.indexOf("const runnerCreationDrafts="), script.indexOf("function runnerProfileSelect(")), context);
    vm.runInContext('Object.assign(runnerCreationDraft(),{id:"new-reviewer",profile:"reviewer",template:"codex",model:"chosen-model"})', context);
    expect(JSON.parse(JSON.stringify(vm.runInContext("runnerCreationDraft()", context)))).toMatchObject({ id: "new-reviewer", profile: "reviewer", model: "chosen-model" });
    vm.runInContext('project="two"', context);
    expect(vm.runInContext("runnerCreationDraft().id", context)).toBe("");
    vm.runInContext('project="one"', context);
    expect(vm.runInContext("runnerCreationDraft().profile", context)).toBe("reviewer");
  });
  it("offers built-in roles and previews a role without sending changes until Apply", async () => {
    const h = setup(); expect(h.select.value).toBe("reviewer");
    expect(h.select.children.map(n => n.textContent)).toEqual(["Без профиля", "Аналитик", "Разработчик", "Ревьюер"]);
    h.select.value = "analyst"; h.select.onchange!();
    expect(h.editor.info.textContent).toContain("требования"); expect(h.sent).toHaveLength(0);
    await h.apply.onclick!();
    expect(h.sent).toEqual([{ path: "/api/runners/reviewer/profile", body: { profile: "analyst" } }]);
    expect(h.notices[0]).toContain("следующей сессии");
  });
  it("clears a profile explicitly and preserves the selection after a save failure", async () => {
    const h = setup(); h.select.value = ""; h.context.fail = true;
    await h.apply.onclick!();
    expect(h.sent[0]).toMatchObject({ body: { profile: null } });
    expect(h.select.value).toBe(""); expect(h.apply.disabled).toBe(false);
    expect(h.notices[0]).toContain("Save failed");
  });
});
