import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Deployer, type DeployRun } from "../../src/deploy/deployer.js";
import { deployNotes, envVarOf, flattenYaml, javaProperties } from "../../src/deploy/notes.js";
import { branchName, branchWebUrl, pushTask } from "../../src/deploy/push.js";
import { checkSettings, saveSettings } from "../../src/deploy/settings.js";
import { preBashDecision } from "../../src/hook.js";
import { FileStore } from "../../src/storage/fileStore.js";
import type { Task } from "../../src/types.js";
import { tmpDir } from "../helpers/tmp.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

/** A project with a base commit, a merged task on top, and a bare repository standing in for Bitbucket. */
async function project() {
  const dir = await tmpDir();
  const remote = await tmpDir();
  git(remote, "init", "-q", "--bare");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  put(dir, "src/main/resources/application.yml", "orders:\n  topic: orders.events\nspring:\n  datasource:\n    password: ${DB_PASSWORD}\n");
  put(dir, "src/main/java/com/acme/orders/config/OrdersProperties.java", '@ConfigurationProperties(prefix = "orders")\npublic record OrdersProperties(String topic) {}\n');
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  git(dir, "remote", "add", "origin", remote);
  git(dir, "push", "-q", "origin", "main");
  put(dir, "src/main/java/com/acme/orders/config/OrdersProperties.java", '@ConfigurationProperties(prefix = "orders")\npublic record OrdersProperties(String topic, BigDecimal giftWrapPrice, @DefaultValue("200") int giftMessageMax, String partnerApiKey) {}\n');
  put(dir, "src/main/resources/application.yml", "orders:\n  topic: orders.events\n  partner-url: https://partner.example.com\nspring:\n  datasource:\n    password: ${DB_PASSWORD}\n");
  put(dir, "src/main/resources/db/changelog/2026-10-24-009-gift-wrap.yml", "databaseChangeLog: []\n");
  put(dir, "deploy/values-dev.yaml", "env:\n  ORDERS_GIFTWRAP_PRICE: \"150.00\"\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "task-001: Gift wrap");
  const commit = git(dir, "rev-parse", "HEAD");
  const task = { id: "task-001", title: "Подарочная упаковка: gift wrap", merged: { at: new Date().toISOString(), branch: "swarm-backend", into: "main", commit, already: false, strategy: "squash" } } as unknown as Task;
  return { dir, remote, commit, task };
}

describe("«Для раскатки»: what the environment must have", () => {
  it("flattens Spring YAML, reads @ConfigurationProperties and @Value, names the environment variables", () => {
    const y = flattenYaml("a:\n  b: 1 # note\n  list:\n    - x\n    - name: n\n      port: 2\nc: \"q\"\nd: |\n  text\n---\ne: 3\n");
    expect(Object.fromEntries(y)).toEqual({ "a.b": "1", "a.list[0]": "x", "a.list[1].name": "n", "a.list[1].port": "2", c: "q", d: "…", e: "3" });
    expect(javaProperties('@ConfigurationProperties("pay")\nclass PayProps {\n  private String url;\n  private Duration timeout = Duration.ofSeconds(5);\n  private static final int X = 1;\n  public String getUrl() { return url; }\n}\n@Value("${pay.retries:3}") int r;').map((p) => [p.key, p.defaultValue])).toEqual([
      ["pay.url", undefined],
      ["pay.timeout", "Duration.ofSeconds(5)"],
      ["pay.retries", "3"],
    ]);
    expect(envVarOf("orders.gift-wrap.price")).toBe("ORDERS_GIFTWRAP_PRICE");
    expect(envVarOf("orders.list[0].name")).toBe("ORDERS_LIST_0_NAME");
  });

  it("lists the new settings of the diff, which are required, which are secrets, and which each environment lacks", async () => {
    const { dir, commit } = await project();
    const n = await deployNotes(dir, `${commit}^1`, commit, [{ name: "dev", valuesFile: "deploy/values-dev.yaml" }, { name: "stage", provided: ["ORDERS_PARTNERAPIKEY"] }, { name: "prod" }]);
    const by = Object.fromEntries(n.properties.map((p) => [p.key, p]));
    expect(by["orders.gift-wrap-price"]).toMatchObject({ envVar: "ORDERS_GIFTWRAPPRICE", required: true, inEnv: { dev: false, stage: false, prod: null } });
    expect(by["orders.gift-message-max"]).toMatchObject({ required: false, defaultValue: "200" });
    expect(by["orders.partner-api-key"]).toMatchObject({ secret: true, required: true });
    expect(by["orders.partner-url"]).toMatchObject({ required: false, defaultValue: "https://partner.example.com" });
    expect(by["orders.topic"]).toBeUndefined(); // not new
    expect(n.migrations).toEqual(["src/main/resources/db/changelog/2026-10-24-009-gift-wrap.yml"]);
    expect(n.endpoints).toEqual([{ key: "orders.partner-url", value: "https://partner.example.com" }]);
    expect(n.missing).toContainEqual({ env: "dev", key: "orders.gift-wrap-price", envVar: "ORDERS_GIFTWRAPPRICE" });
    expect(n.missing.some((m) => m.env === "prod")).toBe(false); // nothing to check prod against
  });
});

describe("push to Bitbucket", () => {
  it("pushes the merged commit to the task's branch, lists what went, never forces", async () => {
    const { dir, remote, commit } = await project();
    const r = await pushTask(dir, { remote: "origin", branch: "feature/task-001-gift-wrap", commit });
    expect(git(remote, "rev-parse", "refs/heads/feature/task-001-gift-wrap")).toBe(commit);
    expect(r.commits.map((c) => c.subject)).toEqual(["task-001: Gift wrap"]);
    // someone pushed to the branch in between: refused, nothing forced
    git(dir, "commit", "-q", "--allow-empty", "-m", "other");
    git(dir, "push", "-q", "origin", "HEAD:refs/heads/feature/x");
    git(dir, "reset", "-q", "--hard", commit);
    await expect(pushTask(dir, { remote: "origin", branch: "feature/x", commit })).rejects.toMatchObject({ code: "PUSH_FAILED", message: expect.stringContaining("Nothing was forced") });
    await expect(pushTask(dir, { remote: "nope", branch: "b", commit })).rejects.toMatchObject({ code: "PUSH_FAILED", message: expect.stringContaining('No git remote "nope"') });
  });

  it("names the branch from the template and links it", () => {
    expect(branchName("feature/{task}-{slug}", { task: "task-007", title: "Add gift wrap to orders!", env: "dev" })).toBe("feature/task-007-add-gift-wrap-to-orders");
    expect(branchName("release/{change}/{env}", { task: "task-007", change: "order-gift-wrap", title: "x", env: "stage" })).toBe("release/order-gift-wrap/stage");
    expect(branchName("feature/{task}-{slug}", { task: "task-007", title: "Подарочная упаковка", env: "dev" })).toBe("feature/task-007-podarochnaya-upakovka");
    expect(branchName("feature/{task}-{slug}", { task: "task-007", title: "日本", env: "dev" })).toBe("feature/task-007-task-007");
    expect(branchWebUrl("git@bitbucket.org:acme/orders.git", "feature/a")).toBe("https://bitbucket.org/acme/orders/branch/feature%2Fa");
    expect(branchWebUrl("ssh://git@bb.corp:7999/ord/svc.git", "f")).toBeNull();
    expect(branchWebUrl("ssh://git@bb.corp:7999/ord/svc.git", "f/1", "https://bb.corp/projects/ORD/repos/svc/browse?at=refs/heads/{branch}")).toBe("https://bb.corp/projects/ORD/repos/svc/browse?at=refs/heads/f%2F1");
  });
});

describe("a deploy run", () => {
  it("notes, push, then Jenkins and Kubernetes skipped with the reason; kept on disk", async () => {
    const { dir, remote, commit, task } = await project();
    const fs = await FileStore.open(join(dir, ".agent-network"));
    await saveSettings(fs, { bitbucket: { remote: "origin", branch: "feature/{task}-{slug}" }, environments: [{ name: "dev", valuesFile: "deploy/values-dev.yaml" }] });
    const d = new Deployer(fs, dir);
    const started = await d.start(task, "dev");
    expect(started).toMatchObject({ id: "dep-001", status: "running", branch: "feature/task-001-podarochnaya-upakovka-gift-wrap", commit });
    await expect(d.start(task, "dev")).rejects.toMatchObject({ code: "DEPLOY_RUNNING" });
    let run: DeployRun = started;
    for (let i = 0; i < 100 && run.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      run = await d.get(started.id);
    }
    expect(run.status).toBe("ok");
    expect(run.steps.map((s) => [s.name, s.status])).toEqual([["notes", "ok"], ["push", "ok"], ["jenkins", "skipped"], ["kubernetes", "skipped"]]);
    expect(run.steps[0]!.summary).toContain("в dev не задано: ORDERS_GIFTWRAPPRICE");
    expect(run.steps[2]!.summary).toContain("MCP-сервер Jenkins");
    expect(git(remote, "rev-parse", "refs/heads/feature/task-001-podarochnaya-upakovka-gift-wrap")).toBe(commit);
    expect((await new Deployer(fs, dir).list()).map((r) => r.id)).toEqual(["dep-001"]);
    await expect(d.start(task, "prod")).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining('No environment "prod"') });
    await expect(d.start({ ...task, merged: undefined } as Task, "dev")).rejects.toMatchObject({ message: expect.stringContaining("not merged") });
  });

  it("a run left running by a stopped server is marked interrupted", async () => {
    const { dir, task } = await project();
    const fs = await FileStore.open(join(dir, ".agent-network"));
    await fs.writeJson(["deploys", "dep-001.json"], { id: "dep-001", taskId: task.id, status: "running", createdAt: new Date().toISOString(), steps: [{ name: "notes", status: "ok" }, { name: "push", status: "running" }, { name: "jenkins", status: "pending" }] });
    const [run] = await new Deployer(fs, dir).list();
    expect(run!.status).toBe("failed");
    expect(run!.steps.map((s) => s.status)).toEqual(["ok", "failed", "skipped"]);
  });
});

describe("settings and the agents' push", () => {
  it("checks the settings and refuses what would break an argv or a branch", () => {
    const s = checkSettings({});
    expect(s.bitbucket).toEqual({ remote: "origin", branch: "feature/{task}-{slug}" });
    expect(s.environments).toEqual([{ name: "dev" }]);
    expect(checkSettings({ jenkins: { mcpEnv: { JENKINS_TOKEN: "${JENKINS_TOKEN}" }, triggerArgs: '{"job": "{job}", "parameters": {params}}' } }).jenkins.mcpEnv).toEqual({ JENKINS_TOKEN: "${JENKINS_TOKEN}" });
    expect(() => checkSettings({ bitbucket: { remote: "--upload-pack=x" } })).toThrow(/remote/);
    expect(() => checkSettings({ bitbucket: { branch: "feature/../x" } })).toThrow(/branch/);
    expect(() => checkSettings({ jenkins: { triggerArgs: "{not json" } })).toThrow(/triggerArgs/);
    expect(() => checkSettings({ environments: [{ name: "dev", valuesFile: "../secrets.yaml" }] })).toThrow(/valuesFile/);
    expect(() => checkSettings({ environments: [{ name: "dev" }, { name: "dev" }] })).toThrow(/twice/);
    expect(() => checkSettings({ kubernetes: { context: "--kubeconfig=/x" } })).toThrow(/context/);
  });

  it("an agent's git push is refused by the pre-bash hook", () => {
    expect(preBashDecision("git push origin HEAD")).not.toBeNull();
    expect(preBashDecision("git -c x=y push")).not.toBeNull();
    expect(preBashDecision("git commit -m push")).toBeNull();
    expect(preBashDecision("git log --oneline")).toBeNull();
  });
});
