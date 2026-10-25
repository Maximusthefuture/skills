import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Deployer, taskDeployState, type DeployRun } from "../../src/deploy/deployer.js";
import { checkRollout } from "../../src/deploy/kube.js";
import { deployNotes, envVarOf, flattenYaml, javaProperties, type DeployNotes } from "../../src/deploy/notes.js";
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

describe("where a merged task stands", () => {
  const run = (id: string, env: string, status: DeployRun["status"], push: string, kube: string, at: string): DeployRun =>
    ({ id, taskId: "task-001", env, status, createdAt: at, branch: "feature/a", push: { webUrl: "https://bb/a" }, steps: [{ name: "push", status: push }, { name: "kubernetes", status: kube }] }) as unknown as DeployRun;
  it("not pushed, in a branch, on a stand (per environment, latest deploy wins), running, failed", () => {
    expect(taskDeployState("task-001", [])).toEqual({ stage: "merged", envs: [] });
    expect(taskDeployState("task-001", [run("dep-001", "dev", "ok", "ok", "skipped", "1")])).toMatchObject({ stage: "branch", branch: "feature/a", branchUrl: "https://bb/a", envs: [] });
    const onDev = [run("dep-002", "dev", "ok", "ok", "ok", "2"), run("dep-001", "dev", "ok", "ok", "skipped", "1")];
    expect(taskDeployState("task-001", onDev)).toMatchObject({ stage: "deployed", envs: ["dev"] });
    expect(taskDeployState("task-001", [run("dep-003", "dev", "failed", "ok", "failed", "3"), ...onDev])).toMatchObject({ stage: "failed", envs: [] });
    expect(taskDeployState("task-001", [run("dep-003", "stage", "failed", "ok", "failed", "3"), ...onDev])).toMatchObject({ stage: "deployed", envs: ["dev"], lastRun: { id: "dep-003", status: "failed" } });
    expect(taskDeployState("task-001", [run("dep-003", "stage", "running", "ok", "pending", "3"), ...onDev]).stage).toBe("running");
    expect(taskDeployState("task-002", onDev).stage).toBe("merged");
  });
});

/** A cluster that answers kubectl get/logs from plain objects, and remembers every call. */
function fakeCluster(o: { revision: string; rsCreated: string; ready: number; replicas?: number; reason?: string; restarts?: number; logs?: string }) {
  const calls: string[][] = [];
  const state = { ...o };
  const kubectl = async (args: string[]) => {
    calls.push(args);
    const want = state.replicas ?? 2;
    const rs = { metadata: { name: `svc-${state.revision}`, creationTimestamp: state.rsCreated, annotations: { "deployment.kubernetes.io/revision": state.revision }, ownerReferences: [{ kind: "Deployment", name: "orders-service" }] } };
    const pod = (i: number) => ({ metadata: { name: `svc-${state.revision}-p${i}`, ownerReferences: [{ kind: "ReplicaSet", name: rs.metadata.name }] }, status: { containerStatuses: [{ ready: i < state.ready, restartCount: state.restarts ?? 0, ...(state.reason ? { state: { waiting: { reason: state.reason } } } : {}) }] } });
    const verb = args[args.indexOf("--request-timeout=20s") + 1];
    const kind = args[args.indexOf("--request-timeout=20s") + 2];
    if (verb === "get" && kind === "deployment") return { ok: true, err: "", out: JSON.stringify({ metadata: { name: "orders-service", generation: 3, annotations: { "deployment.kubernetes.io/revision": state.revision } }, spec: { replicas: want, selector: { matchLabels: { app: "orders" } } }, status: { observedGeneration: 3, replicas: want, updatedReplicas: want, readyReplicas: state.ready, availableReplicas: state.ready } }) };
    if (verb === "get" && kind === "rs") return { ok: true, err: "", out: JSON.stringify({ items: [rs] }) };
    if (verb === "get" && kind === "pods") return { ok: true, err: "", out: JSON.stringify({ items: Array.from({ length: want }, (_, i) => pod(i)) }) };
    if (verb === "get" && kind === "events") return { ok: true, err: "", out: JSON.stringify({ items: [{ involvedObject: { name: "svc-7-p0" }, reason: "BackOff", message: "Back-off restarting failed container" }] }) };
    if (verb === "logs") return { ok: true, err: "", out: state.logs ?? "" };
    return { ok: false, out: "", err: `unexpected kubectl ${args.join(" ")}` };
  };
  return { kubectl, calls, state };
}

describe("the rollout check in Kubernetes (read-only kubectl)", () => {
  const target = { context: "dev-cluster", namespace: "orders-dev", deployment: "orders-service" };
  const readOnly = (calls: string[][]) => calls.every((a) => a.slice(0, 4).join(" ") === "--context dev-cluster -n orders-dev" && ["get", "logs"].includes(a[a.indexOf("--request-timeout=20s") + 1]!));

  it("waits for a ReplicaSet newer than the deploy, then for every replica ready", async () => {
    const since = "2026-10-25T10:00:00.000Z";
    const c = fakeCluster({ revision: "6", rsCreated: "2026-10-24T09:00:00Z", ready: 2 });
    const seen: string[] = [];
    let n = 0;
    const r = await checkRollout(c.kubectl, target, {
      since, timeoutSec: 10, intervalMs: 1,
      progress: (t) => {
        seen.push(t);
        if (++n === 1) Object.assign(c.state, { revision: "7", rsCreated: "2026-10-25T10:01:00Z", ready: 1 }); // the job rolled out
        else Object.assign(c.state, { ready: 2 });
      },
    });
    expect(seen[0]).toContain("ждём новую раскатку");
    expect(seen[1]).toContain("раскатывается");
    expect(r).toMatchObject({ ok: true, replicaSet: { name: "svc-7", revision: "7" } });
    expect(r.summary).toContain("готово 2/2");
    expect(readOnly(c.calls)).toBe(true);
  });

  it("pods that do not start fail at once, with the missing setting named from «Для раскатки»", async () => {
    const c = fakeCluster({ revision: "7", rsCreated: "2026-10-25T10:01:00Z", ready: 0, reason: "CrashLoopBackOff", restarts: 3, logs: "APPLICATION FAILED TO START\nCould not resolve placeholder 'ORDERS_PARTNERAPIKEY' in value \"${ORDERS_PARTNERAPIKEY}\"" });
    const notes = { properties: [{ key: "orders.partner-api-key", envVar: "ORDERS_PARTNERAPIKEY" }] } as unknown as DeployNotes;
    const r = await checkRollout(c.kubectl, target, { since: "2026-10-25T10:00:00.000Z", timeoutSec: 60, intervalMs: 1, notes });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("поды не стартуют: CrashLoopBackOff");
    expect(r.summary).toContain("не задано ORDERS_PARTNERAPIKEY (orders.partner-api-key) — оно было в «Для раскатки»");
    expect(r.output).toContain("Back-off restarting failed container");
    expect(c.calls.some((a) => a.includes("logs") && a.includes("--previous"))).toBe(true);
    expect(readOnly(c.calls)).toBe(true);
  });

  it("no new rollout in time, and a cluster it cannot read, are failures with the reason", async () => {
    const c = fakeCluster({ revision: "6", rsCreated: "2026-10-24T09:00:00Z", ready: 2 });
    const r = await checkRollout(c.kubectl, target, { since: "2026-10-25T10:00:00.000Z", timeoutSec: 0, intervalMs: 1 });
    expect(r).toMatchObject({ ok: false });
    expect(r.summary).toContain("новой раскатки не было");
    const down = await checkRollout(async () => ({ ok: false, out: "", err: "error: context \"dev-cluster\" does not exist" }), target, { since: "2026-10-25T10:00:00.000Z", timeoutSec: 5, intervalMs: 1 });
    expect(down.summary).toContain('context "dev-cluster" does not exist');
  });

  it("a deploy with Kubernetes set up ends on the stand", async () => {
    const { dir, task } = await project();
    const fs = await FileStore.open(join(dir, ".agent-network"));
    await saveSettings(fs, { kubernetes: { context: "dev-cluster" }, environments: [{ name: "dev", namespace: "orders-dev", deployment: "orders-service" }] });
    const c = fakeCluster({ revision: "7", rsCreated: new Date(Date.now() + 60_000).toISOString(), ready: 2 });
    const d = new Deployer(fs, dir, undefined, { kubectl: c.kubectl, intervalMs: 1 });
    let run = await d.start(task, "dev");
    for (let i = 0; i < 100 && run.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      run = await d.get(run.id);
    }
    expect(run.steps.map((s) => s.status)).toEqual(["ok", "ok", "skipped", "ok"]);
    expect(run.steps[3]!.summary).toContain("раскатилось");
    expect(taskDeployState(task.id, await d.list())).toMatchObject({ stage: "deployed", envs: ["dev"] });
  });
});
