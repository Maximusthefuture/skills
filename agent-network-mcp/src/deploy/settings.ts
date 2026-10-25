import { AppError } from "../errors.js";
import type { FileStore } from "../storage/fileStore.js";

/**
 * Settings of the «Раскатка» tab, per project, edited on the page and kept in <network>/deploy/settings.json: where the
 * merged work of a task is pushed (Bitbucket over SSH, the operator's own git credentials), which Jenkins job deploys it
 * (through a Jenkins MCP server the operator names), and where Kubernetes runs it. The page never shows a secret it did
 * not get: an MCP env value may be "${NAME}", read from the environment of the page's server when the MCP starts.
 */

export interface DeployEnvironment {
  /** dev, stage…: the name in the job parameters ({env}) and on the page. */
  name: string;
  /** Kubernetes namespace, deployment and pod label selector of the service in this environment. */
  namespace?: string;
  deployment?: string;
  selector?: string;
  /** The environment's values file (Helm values, an env file), relative to the project: the keys in it count as set. */
  valuesFile?: string;
  /** Keys or environment variables this environment already has elsewhere (Vault, a ConfigMap kept by hand). */
  provided?: string[];
  /** Extra Jenkins job parameters for this environment. */
  jobParams?: Record<string, string>;
}

export interface DeploySettings {
  bitbucket: {
    /** The git remote to push to (its URL is the SSH address of the Bitbucket repository). */
    remote: string;
    /** The branch the task goes to: {task} task-001, {change} its OpenSpec change (else the slug), {slug} of the title, {env}. */
    branch: string;
    /** A link to the pushed branch: {branch} is put in; empty — made from the remote URL when it is bitbucket.org. */
    webUrl?: string;
  };
  jenkins: {
    /** The Jenkins MCP server: its command line, one argument per entry. Empty — no Jenkins step yet. */
    mcpCommand: string[];
    mcpEnv: Record<string, string>;
    job: string;
    /** Job parameters; values may hold {branch} {commit} {env} {task}. */
    params: Record<string, string>;
    /** The MCP tools that start the job, read its state and its log, each with a JSON template of its arguments. */
    triggerTool: string;
    triggerArgs: string;
    statusTool: string;
    statusArgs: string;
    logTool: string;
    logArgs: string;
    timeoutMin: number;
  };
  kubernetes: {
    kubectl: string;
    /** The kubeconfig context with read-only rights in the environments' namespaces. */
    context: string;
    rolloutTimeoutSec: number;
  };
  environments: DeployEnvironment[];
}

export const DEFAULT_SETTINGS: DeploySettings = {
  bitbucket: { remote: "origin", branch: "feature/{task}-{slug}" },
  jenkins: { mcpCommand: [], mcpEnv: {}, job: "", params: { BRANCH: "{branch}", ENV: "{env}" }, triggerTool: "", triggerArgs: "", statusTool: "", statusArgs: "", logTool: "", logArgs: "", timeoutMin: 30 },
  kubernetes: { kubectl: "kubectl", context: "", rolloutTimeoutSec: 300 },
  environments: [{ name: "dev" }],
};

const SEGMENTS = ["deploy", "settings.json"];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_TEMPLATE = /^[A-Za-z0-9._/{}-]+$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PLACEHOLDERS = ["branch", "commit", "env", "task", "change", "slug", "job", "build", "params"];

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** A value that ends up in an argv or a URL: no leading "-", no control characters. */
function safe(v: string, what: string): string {
  if (v.startsWith("-") || /[\0-\x1f]/.test(v)) throw new AppError("INVALID_INPUT", `${what}: ${JSON.stringify(v)} must not start with "-" or hold control characters`);
  return v;
}
function map(v: unknown, what: string): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new AppError("INVALID_INPUT", `${what}: an object of names to values`);
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!KEY.test(k)) throw new AppError("INVALID_INPUT", `${what}: ${JSON.stringify(k)} is not a name`);
    out[k] = safe(String(x ?? "").slice(0, 500), `${what}.${k}`);
  }
  return out;
}
function template(v: unknown, what: string): string {
  const s = str(v, 2000);
  if (!s) return "";
  try {
    JSON.parse(s.replace(/\{(\w+)\}/g, (m, name: string) => (PLACEHOLDERS.includes(name) ? "0" : m)));
  } catch {
    throw new AppError("INVALID_INPUT", `${what}: a JSON object, placeholders in strings, e.g. {"job": "{job}", "parameters": {params}}`);
  }
  return s;
}
const int = (v: unknown, min: number, max: number, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt);

/** Checks what the page sent and fills in the defaults; what fails is refused with the field named. */
export function checkSettings(raw: unknown): DeploySettings {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | unknown[] | undefined>;
  const b = (r.bitbucket ?? {}) as Record<string, unknown>;
  const j = (r.jenkins ?? {}) as Record<string, unknown>;
  const k = (r.kubernetes ?? {}) as Record<string, unknown>;
  const remote = str(b.remote) || DEFAULT_SETTINGS.bitbucket.remote;
  if (!NAME.test(remote)) throw new AppError("INVALID_INPUT", `bitbucket.remote: ${JSON.stringify(remote)} is not a git remote name`);
  const branch = str(b.branch) || DEFAULT_SETTINGS.bitbucket.branch;
  if (!BRANCH_TEMPLATE.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new AppError("INVALID_INPUT", `bitbucket.branch: ${JSON.stringify(branch)} — letters, digits, / . _ - and {task} {change} {slug} {env}`);
  const webUrl = str(b.webUrl, 500);
  if (webUrl && !/^https?:\/\/\S+$/.test(webUrl)) throw new AppError("INVALID_INPUT", "bitbucket.webUrl: an http(s) address with {branch} in it");
  const mcpCommand = Array.isArray(j.mcpCommand) ? j.mcpCommand.map((a) => String(a ?? "").slice(0, 500)).filter((a) => a.trim()) : [];
  if (mcpCommand[0]) safe(mcpCommand[0], "jenkins.mcpCommand[0]");
  const tool = (v: unknown, what: string) => {
    const s = str(v, 120);
    if (s && !NAME.test(s)) throw new AppError("INVALID_INPUT", `${what}: ${JSON.stringify(s)} is not an MCP tool name`);
    return s;
  };
  const kubectl = safe(str(k.kubectl) || "kubectl", "kubernetes.kubectl");
  const context = str(k.context, 200);
  if (context) safe(context, "kubernetes.context");
  const envs = Array.isArray(r.environments) ? r.environments : DEFAULT_SETTINGS.environments;
  const environments: DeployEnvironment[] = [];
  for (const [i, e] of envs.entries()) {
    const o = (e ?? {}) as Record<string, unknown>;
    const name = str(o.name, 60);
    if (!NAME.test(name)) throw new AppError("INVALID_INPUT", `environments[${i}].name: ${JSON.stringify(name)} — letters, digits, . _ -`);
    if (environments.some((x) => x.name === name)) throw new AppError("INVALID_INPUT", `environments: ${name} twice`);
    const field = (f: string) => {
      const s = str(o[f], 300);
      return s ? safe(s, `environments.${name}.${f}`) : "";
    };
    const valuesFile = field("valuesFile");
    if (valuesFile && (valuesFile.startsWith("/") || valuesFile.split("/").includes(".."))) throw new AppError("INVALID_INPUT", `environments.${name}.valuesFile: a path inside the project`);
    const provided = (Array.isArray(o.provided) ? o.provided : []).map((p) => str(p, 200)).filter(Boolean);
    const jobParams = map(o.jobParams, `environments.${name}.jobParams`);
    environments.push({
      name,
      ...(field("namespace") ? { namespace: field("namespace") } : {}),
      ...(field("deployment") ? { deployment: field("deployment") } : {}),
      ...(field("selector") ? { selector: field("selector") } : {}),
      ...(valuesFile ? { valuesFile } : {}),
      ...(provided.length ? { provided } : {}),
      ...(Object.keys(jobParams).length ? { jobParams } : {}),
    });
  }
  if (!environments.length) throw new AppError("INVALID_INPUT", "environments: at least one, e.g. dev");
  return {
    bitbucket: { remote, branch, ...(webUrl ? { webUrl } : {}) },
    jenkins: {
      mcpCommand,
      mcpEnv: map(j.mcpEnv, "jenkins.mcpEnv"),
      job: str(j.job, 200),
      params: j.params === undefined ? { ...DEFAULT_SETTINGS.jenkins.params } : map(j.params, "jenkins.params"),
      triggerTool: tool(j.triggerTool, "jenkins.triggerTool"),
      triggerArgs: template(j.triggerArgs, "jenkins.triggerArgs"),
      statusTool: tool(j.statusTool, "jenkins.statusTool"),
      statusArgs: template(j.statusArgs, "jenkins.statusArgs"),
      logTool: tool(j.logTool, "jenkins.logTool"),
      logArgs: template(j.logArgs, "jenkins.logArgs"),
      timeoutMin: int(j.timeoutMin, 1, 240, DEFAULT_SETTINGS.jenkins.timeoutMin),
    },
    kubernetes: { kubectl, context, rolloutTimeoutSec: int(k.rolloutTimeoutSec, 10, 3600, DEFAULT_SETTINGS.kubernetes.rolloutTimeoutSec) },
    environments,
  };
}

export async function loadSettings(fs: FileStore): Promise<DeploySettings> {
  const saved = await fs.readJson<unknown>(SEGMENTS);
  if (!saved) return structuredClone(DEFAULT_SETTINGS);
  try {
    return checkSettings(saved);
  } catch {
    return structuredClone(DEFAULT_SETTINGS); // a file edited by hand into something invalid: the page shows the defaults and saves over it
  }
}

export async function saveSettings(fs: FileStore, raw: unknown): Promise<DeploySettings> {
  const settings = checkSettings(raw);
  await fs.writeJson(SEGMENTS, settings);
  return settings;
}

/** What the Jenkins step needs to run at all; the step is skipped with this reason otherwise. */
export function jenkinsMissing(s: DeploySettings): string | null {
  const j = s.jenkins;
  if (!j.mcpCommand.length) return "Jenkins не настроен: укажите MCP-сервер Jenkins в настройках";
  if (!j.job) return "Jenkins: не указан job";
  if (!j.triggerTool || !j.statusTool) return "Jenkins: не указаны инструменты MCP для запуска и статуса job";
  return null;
}
