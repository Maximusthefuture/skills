import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDraft, parseDraft, type DraftContext } from "../../src/drafter.js";
import type { SessionRun } from "../../src/runner.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

const ctx: DraftContext = {
  projectDir: "/p", stack: "npm", verifyCommand: "npm test",
  agents: [{ id: "backend", model: "sonnet", role: null }, { id: "reviewer", model: "haiku", role: null }, { id: "tester", model: "haiku", role: null }],
  openspecChanges: ["add-refunds"], contracts: [{ project: "/api", artifact: "com.shop:orders-api" }],
};
const DESCRIPTION = "Partial refunds: refundOrder(id, amount) refunds a part of a paid order; amount over the rest is INVALID_AMOUNT. backend: src/orders.js; tester: test/refunds.test.js.";

describe("a drafted task", () => {
  it("is read from the last message, alone or in a json block", () => {
    expect(parseDraft('Here it is:\n```json\n{"title": "Refunds"}\n```')).toEqual({ title: "Refunds" });
    expect(parseDraft('{"title": "Refunds"}')).toEqual({ title: "Refunds" });
    expect(parseDraft("I could not read the project")).toBeNull();
  });

  it("keeps the fields that fit the project and drops the rest with why", async () => {
    const inspect = async (path: string) => {
      if (path !== "/api") throw new Error(`${path} is not a git repository`);
      return { project: "/api", specs: [], groupId: "com.shop", artifactId: "orders-api", version: "1.4.0" };
    };
    const good = await checkDraft({
      title: "Partial refunds", description: DESCRIPTION, lead: "backend", agents: ["tester", "reviewer", "backend"], depth: "thorough",
      verifyCommand: "npm test", contract: "/api", openspec: "add-refunds",
      why: { depth: "money is involved", agents: "the tester writes the edge cases" },
      questions: [{ question: "Refund to the card or to a balance?", options: ["card", "balance"], recommended: "card" }],
    }, ctx, inspect);
    expect(good).toEqual({
      title: "Partial refunds", description: DESCRIPTION, lead: "backend", agents: ["tester", "reviewer"], depth: "thorough", verifyCommand: "npm test", contract: "/api", openspec: "add-refunds",
      why: { depth: "money is involved", agents: "the tester writes the edge cases" },
      questions: [{ question: "Refund to the card or to a balance?", options: ["card", "balance"], recommended: "card" }], dropped: [],
    });
    const bad = await checkDraft({ title: "x", description: "short", lead: "backend", agents: ["ghost"], depth: "deep", verifyCommand: "rm -rf /", contract: "/elsewhere", openspec: "nope" }, ctx, inspect);
    expect(bad).toMatchObject({ title: "x", why: {}, questions: [] });
    expect(bad.dropped.map((d) => d.field)).toEqual(["description", "agents", "depth", "verifyCommand", "contract", "openspec"]);
    expect(bad.dropped.find((d) => d.field === "agents")!.reason).toContain("ghost");
    expect(bad).not.toHaveProperty("lead");
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("«Составить черновик» on the page", () => {
  it("gives the session the project and fills a checked draft; one at a time", async () => {
    const root = await tmpDir();
    const project = join(root, "shop");
    mkdirSync(project);
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "shop", scripts: { test: "node --test" } }));
    const networkDir = join(project, ".agent-network");
    const role = join(root, "backend.md");
    writeFileSync(role, "You write the service code and its unit tests.");
    const prompt = join(root, "drafter-prompt.md");
    writeFileSync(prompt, "Draft the task.");
    const pool = new RunnerPool(networkDir, [
      { id: "backend", command: ["x"], cwd: project, autostart: false, instructionsFile: role },
      { id: "reviewer", command: ["x"], cwd: project, autostart: false },
    ]);
    let seen = "";
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const run = async (argv: string[]): Promise<SessionRun> => {
      seen = argv.join(" ");
      await gate;
      return { code: 0, result: { text: "```json\n" + JSON.stringify({ title: "Partial refunds", description: DESCRIPTION, lead: "backend", agents: ["reviewer"], depth: "standard", why: { depth: "a clear rule" } }) + "\n```", costUsd: 0.07 } as SessionRun["result"] };
    };
    ui = await startUiServer([{ networkDir, runners: pool, verifyCommand: "npm test", drafter: { command: ["claude", "-p", "{prompt}", "--add-dir", "{projectDir}"], promptFile: prompt } }], { port: 0, draftRun: run });
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    expect(((await (await fetch(`${ui.url}/api/state`)).json()) as any).control.drafter).toEqual({ model: null });
    expect(await post("/api/drafts", { text: "" })).toMatchObject({ status: 400 });
    const started = await post("/api/drafts", { text: "нужен частичный возврат заказа" });
    expect(started).toMatchObject({ status: 202, body: { draft: { id: "draft-001", status: "running" } } });
    expect(await post("/api/drafts", { text: "another idea" })).toMatchObject({ status: 400, body: { message: expect.stringContaining("draft-001") } });
    for (let i = 0; i < 50 && !seen; i++) await new Promise((d) => setTimeout(d, 20));
    expect(seen).toContain(`--add-dir ${project}`);
    expect(seen).toContain('"answerLanguage": "Russian"');
    expect(seen).toContain("You write the service code and its unit tests.");
    expect(seen).toContain('"verifyCommand": "npm test"');
    release();
    let draft: any;
    for (let i = 0; i < 100; i++) {
      draft = ((await (await fetch(`${ui.url}/api/drafts/draft-001`)).json()) as any).draft;
      if (draft.status !== "running") break;
      await new Promise((d) => setTimeout(d, 20));
    }
    expect(draft).toMatchObject({ status: "done", costUsd: 0.07, result: { title: "Partial refunds", lead: "backend", agents: ["reviewer"], depth: "standard", dropped: [] } });
  });
});
