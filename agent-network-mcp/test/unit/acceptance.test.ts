import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkAcceptance, missingEvidence, specScenarios, uncoveredScenarios } from "../../src/acceptance.js";
import { acceptanceAlerts, collectAcceptance, renderAcceptancePage, type AcceptanceData } from "../../src/acceptancePage.js";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { ensureWorktrees } from "../../src/worktrees.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const commit = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), body);
  git(dir, "add", file);
  git(dir, "commit", "-qm", file);
  return git(dir, "rev-parse", "HEAD");
};

beforeAll(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
});

/** A project on main and a worktree with its own branch per agent. */
async function repo() {
  const root = await tmpDir();
  const main = join(root, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, ".gitignore"), ".agent-network/\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  const tree = (id: string) => {
    const dir = join(root, id);
    git(main, "worktree", "add", "-q", dir, "-b", id);
    return dir;
  };
  return { main, tree };
}

describe("the lead's acceptance table", () => {
  it("is checked for its form: a requirement, a known status, a note when not done, project-relative paths", () => {
    expect(checkAcceptance(undefined)).toBeUndefined();
    expect(() => checkAcceptance({})).toThrow(/criteria/);
    expect(() => checkAcceptance({ criteria: [{ status: "done" }] })).toThrow(/requirement/);
    expect(() => checkAcceptance({ criteria: [{ requirement: "r", status: "maybe" }] })).toThrow(/done, partial, not-done/);
    expect(() => checkAcceptance({ criteria: [{ requirement: "r", status: "partial" }] })).toThrow(/what is missing/);
    expect(() => checkAcceptance({ criteria: [{ requirement: "r", status: "done", tests: ["/etc/passwd"] }] })).toThrow(/project-relative/);
    expect(() => checkAcceptance({ criteria: [{ requirement: "r", status: "done", where: ["../x.java"] }] })).toThrow(/project-relative/);
    expect(() => checkAcceptance({ criteria: [], checks: [{}] })).toThrow(/step/);
    expect(checkAcceptance({ criteria: [{ requirement: "  r  ", status: "done", tests: ["a.ts#x", " "] }], checks: [{ step: "s", command: "curl x" }] })).toEqual({
      criteria: [{ requirement: "r", status: "done", tests: ["a.ts#x"], where: [] }], checks: [{ step: "s", command: "curl x" }], risks: [],
    });
  });

  it("names only tests and files the merged commit has", async () => {
    const r = await repo();
    const head = commit(r.main, "test/ApiTest.java", "class ApiTest { void returns409() {} }");
    const acc = checkAcceptance({ criteria: [
      { requirement: "a", status: "done", tests: ["test/ApiTest.java#returns409", "test/ApiTest.java#ghost", "test/Nope.java"], where: [".gitignore:1"] },
    ] })!;
    expect(await missingEvidence(r.main, head, acc)).toEqual([
      'test/ApiTest.java#ghost (test/ApiTest.java has no "ghost")',
      `test/Nope.java (no such file at ${head.slice(0, 7)})`,
    ]);
  });

  it("with OpenSpec: every scenario of the specs is named by a requirement", async () => {
    const dir = await tmpDir();
    mkdirSync(join(dir, "openspec/changes/refunds/specs/refund"), { recursive: true });
    writeFileSync(join(dir, "openspec/changes/refunds/specs/refund/spec.md"), "## Requirement: Refund\n#### Scenario: Refund twice\n- WHEN …\n#### Scenario: Refund a paid order\n");
    const scenarios = await specScenarios(dir, "refunds");
    expect(scenarios).toEqual(["Refund twice", "Refund a paid order"]);
    expect(uncoveredScenarios(checkAcceptance({ criteria: [{ requirement: "Refund twice: 409", status: "done" }] })!, scenarios)).toEqual(["Refund a paid order"]);
  });
});

describe("PASS in INTEGRATE", () => {
  it("needs the table, refuses proof that is not there, and the protocol's own errors come first; the page shows what needs a human", async () => {
    const r = await repo();
    const networkDir = join(r.main, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const swarm = async (id: string, workdir: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }), undefined, { workdir, operatorTimeoutMs: 60_000 });
    const backendDir = r.tree("backend");
    const testerDir = r.tree("tester");
    const backend = await swarm("backend", backendDir);
    const tester = await swarm("tester", testerDir);
    await operator.createTaskAsOperator({ title: "Refunds", description: "POST /refunds returns 409 when the order is refunded already", agents: ["backend", "tester"] });
    await backend.propose({ summary: "api", assignments: [{ agentId: "backend", responsibility: "api", files: ["src/**"] }, { agentId: "tester", responsibility: "tests", files: ["test/**"] }] });
    await tester.context();
    await tester.complete({});

    await backend.sendMessage({ to: "operator", message: "Q1: 409 or 422 for a second refund?", options: [{ label: "409" }, { label: "422" }], recommended: "409" });
    const api = commit(backendDir, "src/Refunds.java", "class Refunds {}");
    await backend.complete({ result: "api", filesChanged: ["src/Refunds.java"], commits: [api] });
    git(testerDir, "merge", "-q", "--no-edit", api);
    commit(testerDir, "test/RefundsTest.java", "class RefundsTest { void secondRefundIs409() {} }");
    const tests = commit(testerDir, "docs/notes.md", "notes nobody agreed on");
    await tester.complete({ result: "tests", filesChanged: ["test/RefundsTest.java", "docs/notes.md"], commits: [tests] });
    await backend.context();
    await backend.complete({ status: "PASS" });
    await tester.context();
    await tester.complete({ status: "PASS", findings: [{ severity: "WARNING", description: "the 409 body has no code" }] });

    git(backendDir, "merge", "-q", "--no-edit", tests);
    const head = git(backendDir, "rev-parse", "HEAD");
    // the integrator's own checks first: the tester is no integrator, whatever it sends
    expect(await tester.complete({ status: "PASS", result: "m" }).catch((e) => tester.errorBody(e))).toMatchObject({ error: "NOT_ASSIGNED" });
    expect((await backend.context()).hint).toContain("name every test whole");
    const missing = await backend.complete({ status: "PASS", result: "merged", commits: [head] }).catch((e) => backend.errorBody(e));
    expect(missing).toMatchObject({ error: "ACCEPTANCE_MISSING" });
    const ghost = await backend.complete({ status: "PASS", result: "merged", commits: [head], acceptance: { criteria: [{ requirement: "second refund is 409", status: "done", tests: ["test/RefundsTest.java#refundsTwice"] }] } }).catch((e) => backend.errorBody(e));
    expect(ghost).toMatchObject({ error: "ACCEPTANCE_EVIDENCE", message: expect.stringContaining('has no "refundsTwice"') });
    expect(await operator.integrations.list("task-001")).toEqual([]); // a refusal writes nothing

    const acceptance = {
      criteria: [
        { requirement: "Second refund is 409", status: "done", tests: ["test/RefundsTest.java#secondRefundIs409"], where: ["src/Refunds.java"] },
        { requirement: "The 409 body names the code", status: "not-done", note: "left for a follow-up" },
      ],
      checks: [{ step: "Refund twice", command: "curl -X POST localhost:8080/refunds/1", expect: "409" }],
    };
    const done = await backend.complete({ status: "PASS", result: "merged, tests green", commits: [head], acceptance });
    expect(done).toMatchObject({ task: { phase: "DONE" } });
    expect((await operator.integrations.list("task-001"))[0]!.acceptance!.criteria).toHaveLength(2);

    const d = await collectAcceptance(await FileStore.open(networkDir), "task-001", { project: r.main, branch: "backend", base: "HEAD", head: "backend", mode: "three-dot" }, []);
    expect(d.files.find((f) => f.path === "docs/notes.md")).toMatchObject({ outside: true, test: false });
    expect(d.files.find((f) => f.path === "test/RefundsTest.java")).toMatchObject({ outside: false, test: true });
    expect(d.questions).toEqual([{ question: expect.stringContaining("Q1"), answer: null, recommended: "409" }]);
    expect(d.findings).toEqual([expect.objectContaining({ severity: "WARNING", by: "tester" })]);
    const alerts = acceptanceAlerts(d).map((a) => `${a.level}: ${a.text}`);
    expect(alerts).toEqual(expect.arrayContaining([
      "bad: Не сделано: The 409 body names the code — left for a follow-up",
      expect.stringMatching(/^bad: Файлы вне соглашения \(1\): docs\/notes\.md/),
      expect.stringMatching(/^warn: Решено без вас \(«409»\): Q1/),
      "warn: Предупреждения ревью, которые остались: 1",
    ]));
    expect(alerts.findIndex((a) => a.startsWith("warn"))).toBeGreaterThan(alerts.findLastIndex((a) => a.startsWith("bad"))); // worst first
    const html = renderAcceptancePage(d);
    expect(html).toContain("Приёмка task-001: Refunds");
    expect(html).toContain("test/RefundsTest.java#secondRefundIs409");
    expect(html).toContain("curl -X POST localhost:8080/refunds/1");
  });
});

describe("the page", () => {
  const base: AcceptanceData = {
    task: { id: "task-009", title: "<b>x</b>", description: "d", syncRound: 1 }, branch: "swarm-backend", head: "abc1234", acceptance: null, result: null, build: null,
    elapsedMin: null, costUsd: null, questions: [], findings: [], lastRound: 1, reviewComments: [], files: [], undeclared: true, notes: null, followUps: [], dropped: [],
  };
  it("escapes what agents wrote, and says when the lead sent no table", () => {
    const html = renderAcceptancePage({ ...base, acceptance: { criteria: [{ requirement: "<script>alert(1)</script>", status: "done", tests: [], where: [] }], checks: [], risks: [] } });
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(acceptanceAlerts(base)[0]!.text).toContain("Lead не прислал таблицу");
    expect(acceptanceAlerts({ ...base, acceptance: { criteria: [{ requirement: "r", status: "done", tests: ["a#b"], where: [] }], checks: [], risks: [] } })).toEqual([]);
  });

  it("flags a done requirement whose tests are only files: which test proves it is not said", () => {
    const table = (tests: string[]) => ({ ...base, acceptance: { criteria: [{ requirement: "Refund twice is 409", status: "done" as const, tests, where: [] }], checks: [], risks: [] } });
    expect(acceptanceAlerts(table(["test/refunds.test.js", "test/orders.test.js"]))).toEqual([
      { level: "warn", text: "Тест назван только файлом, без имени: Refund twice is 409 (test/refunds.test.js, test/orders.test.js) — какой тест это доказывает, не видно" },
    ]);
    expect(renderAcceptancePage(table(["test/refunds.test.js"]))).toContain("только файл: какой тест — не сказано");
    // one test named whole is enough
    expect(acceptanceAlerts(table(["test/refunds.test.js", "test/refunds.test.js#refuses a second refund"]))).toEqual([]);
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("the acceptance routes", () => {
  it("show the page of a DONE task; accept merges the lead's branch; return makes a follow-up with the comments", async () => {
    const root = await tmpDir();
    const project = join(root, "shop");
    mkdirSync(project);
    git(project, "init", "-q", "-b", "main");
    commit(project, "a.txt", "a");
    const agents = ["backend", "reviewer"].map((id) => ({ id, cwd: `${project}-${id}`, worktree: { project, branch: `swarm-${id}` } }));
    await ensureWorktrees(agents);
    const networkDir = join(project, ".agent-network");
    const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
    const pool = new RunnerPool(networkDir, agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
    ui = await startUiServer([{ networkDir, runners: pool }], { port: 0 });
    const post = async (path: string, body: unknown = {}) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const done = async (title: string) => {
      const task = await operator.createTaskAsOperator({ title, description: "d", agents: ["backend", "reviewer"] });
      await operator.integrations.create({ taskId: task.id, agentId: "backend", status: "PASS", result: "merged", commits: [], findings: [], round: 1, acceptance: { criteria: [{ requirement: `${title} works`, status: "done", tests: ["b.txt"], where: [] }], checks: [], risks: [] } });
      await operator.tasks.save({ ...(await operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });
      return task;
    };

    const open = await operator.createTaskAsOperator({ title: "Open", description: "d", agents: ["backend", "reviewer"] });
    expect((await (await fetch(`${ui.url}/api/tasks/${open.id}/acceptance`)).json()) as any).toMatchObject({ error: "INVALID_PHASE" });
    await operator.cancelTask(open.id, "not needed");

    commit(agents[0]!.cwd, "b.txt", "feature");
    const first = await done("Feature");
    const info = (await (await fetch(`${ui.url}/api/tasks/${first.id}/acceptance`)).json()) as any;
    expect(info).toMatchObject({ table: true, verdict: null, ownBranch: true, alerts: [
      { level: "warn", text: "Тест назван только файлом, без имени: Feature works (b.txt) — какой тест это доказывает, не видно" },
      { level: "warn", text: "Код изменён, а тесты — нет." },
    ] });
    const view = await fetch(`${ui.url}/api/tasks/${first.id}/acceptance/view`);
    expect(view.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    const html = await view.text();
    expect(html).toContain("Feature works");
    expect(html).toContain("b.txt");
    expect(html).toContain("data-an-sdk"); // the review script: comments on blocks

    expect(await post(`/api/tasks/${first.id}/acceptance/return`, { comments: [] })).toMatchObject({ status: 400, body: { error: "INVALID_INPUT" } });
    const back = await post(`/api/tasks/${first.id}/acceptance/return`, { comments: [{ target: "td «Feature works»", quote: "works", text: "also for a cancelled order" }] });
    expect(back).toMatchObject({ status: 201, body: { task: { acceptance: { status: "returned", followUp: back.body.followUp.id } } } });
    expect(back.body.followUp.description).toContain("also for a cancelled order");
    expect(await operator.reviewComments(back.body.followUp.id)).toEqual([expect.objectContaining({ file: "acceptance page", code: "td «Feature works»: works", status: "open" })]);

    const accepted = await post(`/api/tasks/${first.id}/acceptance/accept`);
    expect(accepted).toMatchObject({ status: 200, body: { task: { acceptance: { status: "accepted" } }, merged: { branch: "swarm-backend", into: "main" } } });
    expect(git(project, "log", "-1", "--format=%s")).toBe(`${first.id}: Feature`);
    const state = (await (await fetch(`${ui.url}/api/state`)).json()) as any;
    expect(state.tasks.find((t: any) => t.id === first.id).acceptance).toMatchObject({ status: "accepted" });

    // merged already: accepting merges nothing
    const second = await done("Again");
    expect(await post(`/api/tasks/${second.id}/merge`)).toMatchObject({ status: 200 });
    expect(await post(`/api/tasks/${second.id}/acceptance/accept`)).toMatchObject({ status: 200, body: { merged: null, task: { acceptance: { status: "accepted" } } } });
  });
});
