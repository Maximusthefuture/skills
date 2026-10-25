import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkAcceptance, missingEvidence } from "../../src/acceptance.js";
import { collectAcceptance, acceptanceAlerts, renderAcceptancePage } from "../../src/acceptancePage.js";
import { bumpKind, diffSpec } from "../../src/apiDiff.js";
import { dependencyVersion, inspectContract, m2Origin, nextVersion, pomCoords, versionAtLeast } from "../../src/contract.js";
import { EventHub } from "../../src/events/eventHub.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { withExtraDir } from "../../src/runner.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { ensureWorktrees } from "../../src/worktrees.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const write = (dir: string, file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const commit = (dir: string, file: string, text: string) => {
  write(dir, file, text);
  git(dir, "add", file);
  git(dir, "commit", "-qm", file);
  return git(dir, "rev-parse", "HEAD");
};

beforeAll(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
});

const pom = (version: string, deps = "") => `<project><modelVersion>4.0.0</modelVersion>
  <groupId>com.shop</groupId><artifactId>orders-api</artifactId><version>${version}</version>${deps}</project>`;
const servicePom = (apiVersion: string) => `<project><groupId>com.shop</groupId><artifactId>orders</artifactId><version>1.0.0</version>
  <properties><orders-api.version>${apiVersion}</orders-api.version></properties>
  <dependencies><dependency><groupId>com.shop</groupId><artifactId>orders-api</artifactId><version>\${orders-api.version}</version></dependency></dependencies></project>`;
const SPEC = `openapi: 3.0.3
info:
  title: Orders
  version: 1.4.0
paths:
  '/orders/{id}':
    get:
      operationId: getOrder
      responses:
        '200':
          description: ok
components:
  schemas:
    Order:
      type: object
      required: [id]
      properties:
        id: { type: string }
        status:
          type: string
          enum: [PAID, REFUNDED]
`;
const SPEC_REFUND = SPEC.replace(`        '200':
          description: ok
components:`, `        '200':
          description: ok
  '/orders/{id}/refund':
    post:
      operationId: refundOrder
      responses:
        '200':
          description: refunded
components:`);

describe("the pieces", () => {
  it("reads a pom's coordinates and a dependency's version, through a property", () => {
    expect(pomCoords(`<project><parent><groupId>p</groupId><version>9</version></parent><artifactId>a</artifactId><dependencies><dependency><version>x</version></dependency></dependencies></project>`)).toEqual({ groupId: "p", artifactId: "a", version: "9" });
    expect(pomCoords(pom("1.4.0"))).toEqual({ groupId: "com.shop", artifactId: "orders-api", version: "1.4.0" });
    expect(dependencyVersion(servicePom("1.5.0"), "com.shop", "orders-api")).toEqual({ version: "1.5.0", property: "orders-api.version" });
    expect(dependencyVersion(servicePom("1.5.0"), "com.other", "orders-api")).toBeNull();
  });

  it("knows the bump a change needs", () => {
    expect([nextVersion("1.4.2", "breaking"), nextVersion("1.4.2", "additive"), nextVersion("1.4.2", "patch"), nextVersion("1.4-SNAPSHOT", "patch")]).toEqual(["2.0.0", "1.5.0", "1.4.3", null]);
    expect([versionAtLeast("1.5.0", "1.5.0"), versionAtLeast("1.10.0", "1.9.0"), versionAtLeast("1.4.9", "1.5.0")]).toEqual([true, true, false]);
  });

  it("tells a version installed here from one downloaded from Nexus", async () => {
    const repo = await tmpDir();
    const dir = (v: string) => join(repo, "com", "shop", "orders-api", v);
    mkdirSync(dir("1.4.0"), { recursive: true });
    writeFileSync(join(dir("1.4.0"), "_remote.repositories"), "orders-api-1.4.0.jar>nexus=\norders-api-1.4.0.pom>nexus=\n");
    mkdirSync(dir("1.5.0"), { recursive: true });
    writeFileSync(join(dir("1.5.0"), "_remote.repositories"), "#NOTE\norders-api-1.5.0.jar>=\norders-api-1.5.0.pom>=\n");
    expect(await m2Origin("com.shop", "orders-api", "1.4.0", repo)).toBe("remote");
    expect(await m2Origin("com.shop", "orders-api", "1.5.0", repo)).toBe("local");
    expect(await m2Origin("com.shop", "orders-api", "1.6.0", repo)).toBe("missing");
  });

  it("sorts a spec's changes into breaking, additive and plain", () => {
    const added = diffSpec("api.yaml", SPEC, SPEC_REFUND);
    expect(added).toEqual([{ kind: "additive", where: "api.yaml: POST /orders/{id}/refund", what: "новая операция" }]);
    expect(bumpKind(added)).toBe("additive");
    const broke = diffSpec("api.yaml", SPEC, SPEC.replace("enum: [PAID, REFUNDED]", "enum: [PAID]").replace("required: [id]", "required: [id, status]").replace("        id: { type: string }\n", "        id: { type: integer }\n"));
    expect(broke.map((c) => `${c.kind} ${c.where} ${c.what}`)).toEqual(expect.arrayContaining([
      "breaking api.yaml: Order стали обязательными: status",
      "breaking api.yaml: Order.status убраны значения: REFUNDED",
      "breaking api.yaml: Order.id тип string → integer",
    ]));
    expect(bumpKind(broke)).toBe("breaking");
    expect(diffSpec("api.yaml", SPEC, SPEC.replace("getOrder\n      responses:\n        '200':\n          description: ok", "getOrder\n      responses:\n        '200':\n          description: the order"))).toEqual([{ kind: "changed", where: "api.yaml: спецификация", what: "правки описаний и примеров: 1" }]);
    expect(diffSpec("api.yaml", SPEC, null)).toEqual([{ kind: "breaking", where: "api.yaml", what: "файл спецификации удалён" }]);
  });

  it("gives the lead's CLI the contract's worktree", () => {
    expect(withExtraDir(["claude", "-p", "{prompt}"], "/c").command).toEqual(["claude", "--add-dir", "/c", "-p", "{prompt}"]);
    expect(withExtraDir(["/usr/local/bin/qwen", "{prompt}"], "/c").command).toEqual(["/usr/local/bin/qwen", "--include-directories", "/c", "{prompt}"]);
    expect(withExtraDir(["codex", "exec"], "/c")).toEqual({ command: ["codex", "exec"], added: false });
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
  delete process.env.AGENT_NETWORK_M2_REPO;
});

/** A service repository with two agents in auto worktrees, and a contract repository (Maven, a fake ./mvnw: red while BROKEN exists). */
async function stand() {
  const root = await tmpDir();
  const contract = join(root, "orders-api");
  mkdirSync(contract);
  git(contract, "init", "-q", "-b", "main");
  write(contract, "pom.xml", pom("1.4.0"));
  write(contract, "src/main/resources/openapi/orders.yaml", SPEC);
  write(contract, "mvnw", "#!/bin/sh\nif [ -f BROKEN ]; then echo 'BUILD FAILURE: the spec does not generate'; exit 1; fi\necho BUILD SUCCESS\n");
  chmodSync(join(contract, "mvnw"), 0o755);
  write(contract, ".gitignore", ".agent-network/\n");
  git(contract, "add", ".");
  git(contract, "commit", "-qm", "contract 1.4.0");

  const project = join(root, "orders");
  mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  write(project, "pom.xml", servicePom("1.4.0"));
  write(project, ".gitignore", ".agent-network/\n");
  git(project, "add", ".");
  git(project, "commit", "-qm", "service");
  const agents = ["backend", "reviewer"].map((id) => ({ id, cwd: `${project}-${id}`, worktree: { project, branch: `swarm-${id}` } }));
  await ensureWorktrees(agents);
  const networkDir = join(project, ".agent-network");
  const operator = await NetworkService.create(networkDir, { id: "operator", type: "cli" });
  const swarm = async (id: string, workdir: string) => new Swarm(await NetworkService.create(networkDir, { id, type: "test" }, { hub: new EventHub(networkDir, { fallbackPollMs: 50 }) }), undefined, { workdir });
  const m2 = await tmpDir();
  process.env.AGENT_NETWORK_M2_REPO = m2;
  return { root, contract, project, networkDir, operator, swarm, backendDir: agents[0]!.cwd, reviewerDir: agents[1]!.cwd, agents, m2 };
}

describe("a task that changes the API contract too", () => {
  it("is named a contract while designed; only the lead changes it; the server commits it; everyone reads it", async () => {
    const s = await stand();
    expect(await inspectContract(s.contract)).toMatchObject({ groupId: "com.shop", artifactId: "orders-api", version: "1.4.0", specs: ["src/main/resources/openapi/orders.yaml"] });
    await expect(inspectContract(join(s.contract, "src"))).rejects.toThrow(/inside the repository/);
    await expect(inspectContract("orders-api")).rejects.toThrow(/absolute path/);

    const task = await s.operator.createTaskAsOperator({ title: "Refunds", description: "POST /orders/{id}/refund, in the contract and the service", agents: ["backend", "reviewer"], contract: s.contract });
    expect(task.contract).toMatchObject({ project: s.contract, worktree: `${s.contract}-${task.id}`, branch: `swarm-${task.id}`, version: "1.4.0" });
    expect(existsSync(join(task.contract!.worktree, "src/main/resources/openapi/orders.yaml"))).toBe(true);

    const backend = await s.swarm("backend", s.backendDir);
    const reviewer = await s.swarm("reviewer", s.reviewerDir);
    const ctx = await backend.context();
    expect(ctx.contract).toMatchObject({ artifact: "com.shop:orders-api", baseVersion: "1.4.0", worktree: task.contract!.worktree });
    expect(ctx.hint).toContain("contract:<path>");
    expect((await reviewer.context()).contract).not.toHaveProperty("worktree");

    const lead = { agentId: "backend", responsibility: "contract and service", files: ["src/**", "pom.xml", "contract:src/main/resources/openapi/orders.yaml", "contract:pom.xml"] };
    const theirs = await backend.propose({ summary: "s", assignments: [lead, { agentId: "reviewer", responsibility: "review", files: ["contract:README.md"] }] }).catch((e) => backend.errorBody(e));
    expect(theirs).toMatchObject({ error: "CONTRACT_LEAD_ONLY" });
    await backend.propose({ summary: "s", assignments: [lead, { agentId: "reviewer", responsibility: "review", files: [] }] });
    await reviewer.context();
    await reviewer.complete({});
    expect((await backend.context()).hint).toContain("Bump <version> in its pom.xml from 1.4.0");

    // the lead changes the contract in its worktree and installs it; a file the agreement does not give it is refused
    const wt = task.contract!.worktree;
    write(wt, "src/main/resources/openapi/orders.yaml", SPEC_REFUND);
    write(wt, "pom.xml", pom("1.5.0"));
    write(wt, "NOTES.md", "not mine");
    expect(await backend.build({ command: "./mvnw -q install", in: "contract" })).toMatchObject({ status: "PASS" });
    expect(JSON.parse(readFileSync(join(s.networkDir, "tasks", task.id, "builds", "backend-contract.json"), "utf8"))).toMatchObject({ ok: true, in: "contract" });
    const api = commit(s.backendDir, "pom.xml", servicePom("1.5.0"));
    expect(await backend.complete({ result: "refund", commits: [api] }).catch((e) => backend.errorBody(e))).toMatchObject({ error: "FILE_NOT_OWNED", message: expect.stringContaining("NOTES.md") });
    execFileSync("rm", [join(wt, "NOTES.md")]);
    const done = await backend.complete({ result: "refund", commits: [api] });
    expect(done.warnings).toEqual(expect.arrayContaining([expect.stringContaining(`Your contract changes are committed in ${wt}`)]));
    expect(git(wt, "log", "-1", "--format=%s")).toBe(`${task.id}: Refunds (contract)`);
    expect(git(wt, "status", "--porcelain")).toBe("");

    // the acceptance table may prove a requirement by the contract's own files, checked at its branch
    const acc = checkAcceptance({ criteria: [{ requirement: "refund in the API", status: "done", tests: [], where: ["contract:src/main/resources/openapi/orders.yaml#refundOrder", "contract:missing.yaml", "contract:pom.xml#cancelOrder"] }] })!;
    const contractHead = git(wt, "rev-parse", "HEAD");
    expect(await missingEvidence(s.backendDir, api, acc, { cwd: wt, commit: contractHead })).toEqual([
      `contract:missing.yaml (no such file at the contract's ${contractHead.slice(0, 7)})`,
      'contract:pom.xml#cancelOrder (pom.xml has no "cancelOrder")',
    ]);
    expect(await missingEvidence(s.backendDir, api, acc)).toEqual(expect.arrayContaining(["contract:missing.yaml (this task changes no API contract)"]));

    const read = await reviewer.contract({ diff: true, file: "pom.xml" });
    expect(read).toMatchObject({ baseVersion: "1.4.0", version: "1.5.0", changedFiles: ["pom.xml", "src/main/resources/openapi/orders.yaml"], changedBy: "backend" });
    expect((read.diff as { text: string }).text).toContain("+  '/orders/{id}/refund':");
    expect((read.file as { text: string }).text).toContain("<version>1.5.0</version>");
  });

  it("the acceptance page: the API's changes, the version against them, the service on it, the release", async () => {
    const s = await stand();
    const task = await s.operator.createTaskAsOperator({ title: "Refunds", description: "d", agents: ["backend", "reviewer"], contract: s.contract });
    const wt = task.contract!.worktree;
    // a breaking change with a minor bump, the service still on 1.4.0, 1.5.0 installed only here
    write(wt, "src/main/resources/openapi/orders.yaml", SPEC.replace("enum: [PAID, REFUNDED]", "enum: [PAID]"));
    write(wt, "pom.xml", pom("1.5.0"));
    git(wt, "add", ".");
    git(wt, "commit", "-qm", "contract");
    mkdirSync(join(s.m2, "com", "shop", "orders-api", "1.5.0"), { recursive: true });
    writeFileSync(join(s.m2, "com", "shop", "orders-api", "1.5.0", "_remote.repositories"), "orders-api-1.5.0.pom>=\n");
    await s.operator.tasks.save({ ...(await s.operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE" });

    const d = await collectAcceptance(await FileStore.open(s.networkDir), task.id, { project: s.project, branch: "swarm-backend", base: "HEAD", head: "swarm-backend", mode: "three-dot" }, []);
    expect(d.contract).toMatchObject({ artifact: "com.shop:orders-api", fromVersion: "1.4.0", toVersion: "1.5.0", kind: "breaking", dependency: { version: "1.4.0" }, origin: "local" });
    const alerts = acceptanceAlerts(d).map((a) => `${a.level}: ${a.text}`);
    expect(alerts).toEqual(expect.arrayContaining([
      "bad: Ломающие изменения, а версия 1.4.0 → 1.5.0: нужна хотя бы 2.0.0",
      "bad: Сервис зависит от com.shop:orders-api 1.4.0, а контракт теперь 1.5.0",
      "warn: Контракт 1.5.0 есть только локально в ~/.m2, в Nexus его нет: выпустите контракт до пуша сервиса",
      expect.stringMatching(/^warn: Ломающие изменения API \(1\): orders\.yaml|^warn: Ломающие изменения API \(1\): src/),
      "warn: Сборка контракта (install) не запускалась",
    ]));
    expect(renderAcceptancePage(d)).toContain("Изменения API");
  });

  it("«Влить в проект»: the contract first, checked by its own build, then the service; a red contract stops there; revert undoes both", async () => {
    const s = await stand();
    const pool = new RunnerPool(s.networkDir, s.agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
    ui = await startUiServer([{ networkDir: s.networkDir, runners: pool, mergeSetup: [] }], { port: 0 });
    const url = ui.url;
    const post = async (path: string, body: unknown = {}) => {
      const r = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const state = async (id: string) => ((await (await fetch(`${url}/api/state`)).json()) as any).tasks.find((t: any) => t.id === id);
    const until = async (id: string, ok: (t: any) => boolean) => {
      for (let i = 0; i < 300; i++) {
        const t = await state(id);
        if (ok(t)) return t;
        await new Promise((d) => setTimeout(d, 50));
      }
      throw new Error(`${id} did not get there`);
    };

    // the contract named on the card while the task is designed
    const task = await s.operator.createTaskAsOperator({ title: "Refunds", description: "d", agents: ["backend", "reviewer"] });
    expect(await post(`/api/tasks/${task.id}/contract`, { path: join(s.root, "nowhere") })).toMatchObject({ status: 400 });
    const named = await post(`/api/tasks/${task.id}/contract`, { path: s.contract });
    expect(named).toMatchObject({ status: 200, body: { task: { contract: { project: s.contract, version: "1.4.0" } }, interrupted: "not-running" } });
    expect(await post(`/api/tasks/${task.id}/contract`, { path: s.contract })).toMatchObject({ status: 400, body: { error: "ALREADY_COMPLETED" } });

    const wt = `${s.contract}-${task.id}`;
    write(wt, "src/main/resources/openapi/orders.yaml", SPEC_REFUND);
    write(wt, "pom.xml", pom("1.5.0"));
    git(wt, "add", ".");
    git(wt, "commit", "-qm", "contract 1.5.0");
    commit(s.backendDir, "pom.xml", servicePom("1.5.0"));
    await s.operator.tasks.save({ ...(await s.operator.tasks.get(task.id)), status: "COMPLETED", phase: "DONE", verifyCommand: undefined });

    // red: the contract's build fails on its merge; the service is not touched
    const broken = commit(s.contract, "BROKEN", "x");
    const started = await post(`/api/tasks/${task.id}/merge`);
    expect(started).toMatchObject({ status: 202, body: { check: { scope: "contract", status: "running", command: "./mvnw -q -B verify -Dsurefire.timeout=900" } } });
    const red = await until(task.id, (t) => t.contractMergeCheck?.status !== "running");
    expect(red.contractMergeCheck).toMatchObject({ status: "red", build: { ok: false } });
    expect(red.merged).toBeNull();
    expect(git(s.contract, "rev-parse", "HEAD")).toBe(broken);
    expect(await post(`/api/tasks/${task.id}/merge/handoff`, { scope: "contract" })).toMatchObject({ status: 400, body: { message: expect.stringContaining("fixed in its repository") } });

    // fixed in the contract's repository, checked again: the contract lands, then the service (no verifyCommand: as it is)
    git(s.contract, "rm", "-q", "BROKEN");
    git(s.contract, "commit", "-qm", "fix");
    expect((await post(`/api/tasks/${task.id}/merge/retry`, { scope: "contract" })).status).toBe(202);
    const both = await until(task.id, (t) => !!t.merged);
    expect(both.contract.merged).toMatchObject({ into: "main", verified: { command: "./mvnw -q -B verify -Dsurefire.timeout=900" } });
    expect(git(s.contract, "show", "HEAD:pom.xml")).toContain("<version>1.5.0</version>");
    expect(both.merged).toMatchObject({ into: "main", unverified: true });
    expect(git(s.project, "show", "HEAD:pom.xml")).toContain("<orders-api.version>1.5.0</orders-api.version>");

    // the deploy waits for the contract's release: 1.5.0 is only local
    mkdirSync(join(s.m2, "com", "shop", "orders-api", "1.5.0"), { recursive: true });
    writeFileSync(join(s.m2, "com", "shop", "orders-api", "1.5.0", "_remote.repositories"), "orders-api-1.5.0.pom>=\n");
    expect(await post(`/api/tasks/${task.id}/deploy`, { env: "dev" })).toMatchObject({ status: 400, body: { error: "CONTRACT_NOT_RELEASED" } });

    const reverted = await post(`/api/tasks/${task.id}/revert`);
    expect(reverted.body.task).toMatchObject({ merged: { reverted: {} }, contract: { merged: { reverted: {} } } });
    expect(git(s.contract, "show", "HEAD:pom.xml")).toContain("<version>1.4.0</version>");
    expect(await post(`/api/tasks/${task.id}/revert`)).toMatchObject({ status: 400 });
  });
});

describe("removing every worktree of the project", () => {
  it("the agents' only with nothing open, the contracts' of closed and deleted tasks, the merge checks' left behind", async () => {
    const s = await stand();
    const pool = new RunnerPool(s.networkDir, s.agents.map((a) => ({ id: a.id, command: ["x"], cwd: a.cwd, worktree: a.worktree, autostart: false })));
    ui = await startUiServer([{ networkDir: s.networkDir, runners: pool, mergeSetup: [] }], { port: 0 });
    const post = async (path: string, body: unknown = {}, headers: Record<string, string> = {}) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const closed = await s.operator.createTaskAsOperator({ title: "Closed", description: "d", agents: ["backend", "reviewer"], contract: s.contract });
    write(closed.contract!.worktree, "pom.xml", pom("1.5.0"));
    git(closed.contract!.worktree, "commit", "-qam", "1.5.0");
    await s.operator.cancelTask(closed.id, "not needed");
    const gone = await s.operator.createTaskAsOperator({ title: "Gone", description: "d", agents: ["backend", "reviewer"], contract: s.contract });
    await s.operator.cancelTask(gone.id, "x");
    expect((await post(`/api/tasks/${gone.id}/delete`)).status).toBe(200);
    const open = await s.operator.createTaskAsOperator({ title: "Open", description: "d", agents: ["backend", "reviewer"], contract: s.contract });
    const stray = `${s.project}-merge-task-009`;
    git(s.project, "worktree", "add", "-q", "--detach", stray, "HEAD");

    expect(await post("/api/worktrees/clean-all", {}, { "x-agent-network-actor": "supervisor" })).toMatchObject({ status: 403 });
    const r = (await post("/api/worktrees/clean-all")).body.result as any[];
    const by = (kind: string, id: string) => r.find((x) => x.kind === kind && x.id === id);
    expect(by("agent", "backend")).toMatchObject({ removed: false, note: expect.stringContaining(open.id) });
    expect(by("contract", closed.id)).toMatchObject({ removed: true, branchDeleted: false, note: expect.stringContaining("not merged") });
    expect(by("contract", gone.id)).toMatchObject({ removed: true }); // found in deleted/
    expect(by("contract", open.id)).toMatchObject({ removed: false, note: `${open.id} is open` });
    expect(by("merge-check", "task-009")).toMatchObject({ removed: true });
    expect([existsSync(closed.contract!.worktree), existsSync(open.contract!.worktree), existsSync(stray), existsSync(s.backendDir)]).toEqual([false, true, false, true]);
    expect(git(s.contract, "branch", "--list", `swarm-${closed.id}`)).toContain(`swarm-${closed.id}`);
  });
});
