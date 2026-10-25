import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attentionItems, linuxSender, Notifier, type AttentionInput, type AttentionItem } from "../../src/attention.js";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

const T0 = "2026-10-25T10:00:00.000Z";
const task = (over: Record<string, unknown>) => ({ id: "task-001", title: "Refunds", status: "ACTIVE", phase: "DISCUSS", updatedAt: T0, ...over });
const input = (over: Partial<AttentionInput>): AttentionInput => ({ tasks: [], questions: [], needsYou: [], proposals: [], operatorTimeoutMs: 10 * 60_000, ...over });

describe("what waits for the operator", () => {
  it("one item per decision, blocking ones first, gone once decided", () => {
    const items = attentionItems(input({
      tasks: [
        task({ id: "task-001", plan: { status: "awaiting", stage: null, version: 2, at: T0 }, waitingOn: ["operator"] }),
        task({ id: "task-002", status: "BLOCKED", phase: "SYNC", syncRound: 4, blockedReason: "fix rounds are used up", handover: { dueAt: "2026-10-25T10:30:00.000Z", lead: "backend" } }),
        task({ id: "task-003", status: "COMPLETED", phase: "DONE" }),
        task({ id: "task-004", status: "COMPLETED", phase: "DONE", mergeCheck: { status: "red", into: "main", startedAt: T0, build: { tests: { total: 6, failed: 1 } } } }),
        task({ id: "task-005", status: "COMPLETED", phase: "DONE", mergeCheck: { status: "running", into: "main", startedAt: T0 } }),
        task({ id: "task-006", status: "COMPLETED", phase: "DONE", merged: { commit: "abc" } }),
        task({ id: "task-007", status: "COMPLETED", phase: "DONE", acceptance: { status: "accepted" } }),
        task({ id: "task-008", status: "COMPLETED", phase: "DONE", jobOf: { taskId: "task-001" } }),
        task({ id: "task-009", status: "COMPLETED", phase: "DONE", mergeCheck: { status: "red", into: "main", startedAt: T0, followUp: "task-010" } }),
        task({ id: "task-011", grill: true }),
      ],
      questions: [
        { taskId: "task-001", taskTitle: "Refunds", messageId: "msg-003", from: "backend", question: "Q1: 409 or 422?\nmore", askedAt: T0, choices: { recommended: "409" } },
        { taskId: "task-011", taskTitle: "Grilled", messageId: "msg-001", from: "backend", question: "Q1: scope?", askedAt: T0 },
      ],
      needsYou: [{ id: "entry-012", at: T0, taskId: "task-002", text: "Raise the cost limit?" }],
      proposals: [{ id: "prop-001", at: T0, title: "Shorter hints", status: "open" }, { id: "prop-002", at: T0, title: "x", status: "rejected" }],
    }));
    expect(items.map((i) => [i.key, i.blocking])).toEqual([
      ["question:task-001:msg-003", true], // due first
      ["blocked:task-002:4:rounds", true],
      ["question:task-011:msg-001", true], // a grilling waits for the operator: no due
      ["plan:task-001:v2", true],
      ["merge:task-004::red:" + T0, false],
      ["acceptance:task-003", false],
      ["supervisor:entry-012", false],
      ["observer:prop-001", false],
    ]);
    const q = items[0]!;
    expect(q).toMatchObject({ due: "2026-10-25T10:10:00.000Z", title: "task-001: вопрос от backend", text: "Q1: 409 or 422? (рекомендует «409»)", open: { tab: "tasks", messageId: "msg-003" } });
    expect(items.find((i) => i.kind === "merge")).toMatchObject({ title: "task-004: вливание — сборка красная", text: "Refunds · упало 1 из 6" });
    expect(items.find((i) => i.kind === "acceptance")!.open).toEqual({ tab: "tasks", acceptance: true });
  });

  it("a red contract merge is the item, the service's waits behind it", () => {
    const items = attentionItems(input({ tasks: [task({ status: "COMPLETED", phase: "DONE", contractMergeCheck: { status: "conflict", into: "main", startedAt: T0, files: ["orders.yaml"] } })] }));
    expect(items).toEqual([expect.objectContaining({ kind: "merge", title: "task-001: вливание контракта — конфликт", text: "Refunds · orders.yaml" })]);
  });
});

describe("the notifier", () => {
  const item = (key: string, over: Partial<AttentionItem> = {}): AttentionItem => ({ key, kind: "acceptance", title: key, text: `about ${key}`, since: T0, blocking: false, open: { tab: "tasks" }, ...over });
  const at = (min: number) => Date.parse(T0) + min * 60_000;

  it("tells once — several in one notification — reminds once of what blocks, warns before a question times out", async () => {
    const fs = await FileStore.open(await tmpDir());
    const sent: string[] = [];
    const n = new Notifier(async (t, b) => void sent.push(`${t} | ${b}`), { remindAfterMin: 30 });
    await n.tick("shop", fs, [item("a"), item("b")], at(0));
    expect(sent).toEqual(["shop: ждут вашего решения — 2 | • a\n• b"]);
    await n.tick("shop", fs, [item("a"), item("b")], at(1));
    expect(sent).toHaveLength(1);
    const q = item("q", { kind: "question", blocking: true, due: new Date(at(10)).toISOString(), title: "task-001: вопрос" });
    await n.tick("shop", fs, [item("a"), q], at(2));
    expect(sent.at(-1)).toBe("shop: task-001: вопрос | about q");
    await n.tick("shop", fs, [item("a"), q], at(9));
    expect(sent.at(-1)).toBe("shop: task-001: вопрос | Агент пойдёт по своему варианту через 1 мин: about q");
    await n.tick("shop", fs, [item("a"), q], at(31));
    expect(sent.at(-1)).toBe("shop: всё ещё ждёт вас — task-001: вопрос | 31 мин: about q");
    await n.tick("shop", fs, [item("a"), q], at(60));
    expect(sent).toHaveLength(4); // reminded once

    // a restart of the page: nothing again; an item that left and came back is news
    const again = new Notifier(async (t) => void sent.push(t), { remindAfterMin: 30 });
    await again.tick("shop", fs, [item("a"), q], at(61));
    expect(sent).toHaveLength(4);
    await again.tick("shop", fs, [q], at(62));
    await again.tick("shop", fs, [item("a"), q], at(63));
    expect(sent.at(-1)).toBe("shop: a");
  });

  it("switched off or narrowed in runners.json; no sender off Linux", async () => {
    const fs = await FileStore.open(await tmpDir());
    const sent: string[] = [];
    const off = new Notifier(async (t) => void sent.push(t), { os: false });
    expect(await off.tick("shop", fs, [item("a")], at(0))).toEqual(["shop: a"]); // known, not sent
    expect(sent).toEqual([]);
    const only = new Notifier(async (t) => void sent.push(t), { kinds: ["question"] });
    await only.tick("shop", await FileStore.open(await tmpDir()), [item("a"), item("q", { kind: "question" })], at(0));
    expect(sent).toEqual(["shop: q"]);
    expect(await linuxSender("darwin")).toBeNull();
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("the page", () => {
  it("lists every project's items and notifies of a new question at once", async () => {
    const networkDir = join(await tmpDir(), ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, ["backend", "reviewer"].map((id) => ({ id, command: ["x"], cwd: networkDir, autostart: false })));
    const sent: string[] = [];
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0, notifySend: async (t, b) => void sent.push(`${t} | ${b}`), attentionMs: 50 });
    await operator.createTaskAsOperator({ title: "Refunds", description: "a concrete description of the refunds", agents: ["backend", "reviewer"] });
    const backend = new Swarm(await NetworkService.create(networkDir, { id: "backend", type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }));
    await backend.context();
    await backend.sendMessage({ to: "operator", message: "Q1: 409 or 422?", options: [{ label: "409" }, { label: "422" }], recommended: "409" });
    for (let i = 0; i < 100 && !sent.length; i++) await new Promise((d) => setTimeout(d, 50));
    expect(sent).toEqual([expect.stringMatching(/: task-001: вопрос от backend \| Q1: 409 or 422\? \(рекомендует «409»\)$/)]);
    const a = (await (await fetch(`${ui.url}/api/attention`)).json()) as any;
    expect(a.projects[0].items).toEqual([expect.objectContaining({ kind: "question", taskId: "task-001", blocking: true })]);
    expect(a.os).toEqual({ enabled: true, reason: null });
  });
});
