import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AppError } from "../errors.js";
import type { DeploySettings } from "./settings.js";

/**
 * The Jenkins step through the operator's Jenkins MCP server: the page's server starts it (command and env from the
 * settings, "${NAME}" values from its own environment), calls the trigger tool, then the status tool until the build
 * ends, and the log tool when it failed. Tool arguments come from the JSON templates in the settings. Jenkins MCP
 * servers answer in their own shapes, so the build number, state, result and link are read leniently: JSON fields
 * (number / buildNumber / build_number / id, building, result / status, url) or the same words in plain text.
 */

export interface ToolResult {
  text: string;
  json: unknown;
  isError: boolean;
}

export interface JenkinsSession {
  call(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export type OpenJenkins = (s: DeploySettings["jenkins"]) => Promise<JenkinsSession>;

/** "${NAME}" in an env value is read from the page server's environment, so the token never sits in the settings. */
export function expandEnv(env: Record<string, string>, from: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, n: string) => from[n] ?? "")]));
}

export const openJenkinsMcp: OpenJenkins = async (s) => {
  const [command, ...args] = s.mcpCommand;
  if (!command) throw new AppError("INVALID_CONFIG", "Jenkins MCP: no command");
  const base = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"));
  const transport = new StdioClientTransport({ command, args, env: { ...base, ...expandEnv(s.mcpEnv) }, stderr: "pipe" });
  const client = new Client({ name: "agent-network-deploy", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (e) {
    throw new AppError("INVALID_CONFIG", `Jenkins MCP did not start (${s.mcpCommand.join(" ")}): ${(e as Error).message}`);
  }
  return {
    async call(tool, a) {
      const r = (await client.callTool({ name: tool, arguments: a })) as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
      const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
      return { text, json: r.structuredContent ?? parseJson(text), isError: !!r.isError };
    },
    close: () => client.close().catch(() => undefined),
  };
};

function parseJson(text: string): unknown {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Fills a JSON template: "{x}" as a whole string becomes the JSON value, {x} inside a string its text, a bare {params} the object. */
export function renderArgs(template: string, vars: Record<string, unknown>): Record<string, unknown> {
  if (!template.trim()) return {};
  const filled = template
    .replace(/"\{(\w+)\}"/g, (m, n: string) => (n in vars ? JSON.stringify(vars[n]) : m))
    .replace(/\{(\w+)\}/g, (m, n: string, at: number, all: string) => {
      if (!(n in vars)) return m;
      const inString = (all.slice(0, at).match(/(?<!\\)"/g) ?? []).length % 2 === 1;
      return inString ? JSON.stringify(String(vars[n])).slice(1, -1) : JSON.stringify(vars[n]);
    });
  const v = JSON.parse(filled) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new AppError("INVALID_CONFIG", "Jenkins MCP tool arguments must be a JSON object");
  return v as Record<string, unknown>;
}

/** Job parameters with {branch} {commit} {env} {task} put in; the environment's own parameters win. */
export function jobParams(params: Record<string, string>, envParams: Record<string, string> | undefined, v: Record<string, string>): Record<string, string> {
  const put = (s: string) => s.replace(/\{(\w+)\}/g, (m, n: string) => v[n] ?? m);
  return Object.fromEntries(Object.entries({ ...params, ...(envParams ?? {}) }).map(([k, x]) => [k, put(x)]));
}

/** Depth-first search for the first field with one of these names. */
function field(obj: unknown, names: string[], depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 4) return undefined;
  for (const n of names) if (n in (obj as Record<string, unknown>) && (obj as Record<string, unknown>)[n] !== null) return (obj as Record<string, unknown>)[n];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const f = field(v, names, depth + 1);
    if (f !== undefined) return f;
  }
  return undefined;
}

export function buildNumberOf(r: ToolResult): string | undefined {
  const f = field(r.json, ["number", "buildNumber", "build_number", "buildId", "build_id"]);
  if (typeof f === "number" || (typeof f === "string" && /^\d+$/.test(f))) return String(f);
  return /(?:#|build(?:\s*(?:number|no\.?|id))?\s*[:#]?\s*)(\d+)/i.exec(r.text)?.[1];
}

export function buildUrlOf(r: ToolResult): string | undefined {
  const f = field(r.json, ["url", "buildUrl", "build_url"]);
  return typeof f === "string" && /^https?:\/\//.test(f) ? f : /(https?:\/\/\S+\/job\/\S+?\/\d+\/?)/.exec(r.text)?.[1];
}

export type BuildState = { done: false } | { done: true; result: "SUCCESS" | "FAILURE" | "ABORTED" | "UNSTABLE" | "NOT_BUILT" };

export function buildStateOf(r: ToolResult): BuildState {
  const building = field(r.json, ["building", "inProgress", "in_progress"]);
  const result = field(r.json, ["result", "status", "state"]);
  const word = (s: string) => /\b(SUCCESS|FAILURE|FAILED|ABORTED|UNSTABLE|NOT_BUILT)\b/i.exec(s)?.[1]?.toUpperCase().replace("FAILED", "FAILURE");
  if (building === true) return { done: false };
  const res = typeof result === "string" ? word(result) : undefined;
  if (res) return { done: true, result: res as "SUCCESS" };
  if (r.json && building === false && !res) return { done: false }; // finished but the result is not written yet
  if (/\b(building|in[_ ]progress|running|queued|pending)\b/i.test(r.text) && !word(r.text)) return { done: false };
  const t = word(r.text);
  return t ? { done: true, result: t as "SUCCESS" } : { done: false };
}

export interface JobRun {
  ok: boolean;
  build?: string;
  url?: string;
  summary: string;
  output: string;
}

/** Starts the job and waits for its result; `progress` gets each poll for the page. */
export async function runJob(
  open: OpenJenkins,
  s: DeploySettings["jenkins"],
  vars: { branch: string; commit: string; env: string; task: string; params: Record<string, string> },
  opts: { intervalMs?: number; signal?: AbortSignal; progress?: (text: string, link?: string) => Promise<void> | void } = {},
): Promise<JobRun> {
  const session = await open(s);
  try {
    const base = { job: s.job, branch: vars.branch, commit: vars.commit, env: vars.env, task: vars.task, params: vars.params };
    const trig = await session.call(s.triggerTool, s.triggerArgs ? renderArgs(s.triggerArgs, base) : { job: s.job, parameters: vars.params });
    if (trig.isError) return { ok: false, summary: `Jenkins не запустил job ${s.job}: ${trig.text.split("\n")[0]!.slice(0, 200)}`, output: trig.text.slice(0, 4000) };
    let build = buildNumberOf(trig);
    let url = buildUrlOf(trig);
    await opts.progress?.(`job ${s.job} запущен${build ? ` · сборка #${build}` : " · ждём номер сборки"}`, url);
    const deadline = Date.now() + s.timeoutMin * 60_000;
    let last: ToolResult = trig;
    let errors = 0;
    // a build number goes into the templates as a number: tools declare it so, and refuse "42"
    const buildVar = () => (build && /^\d+$/.test(build) ? Number(build) : build ?? "");
    for (;;) {
      if (opts.signal?.aborted) return { ok: false, summary: "отменено", output: "", ...(build ? { build } : {}) };
      await new Promise((r) => setTimeout(r, opts.intervalMs ?? 15_000));
      last = await session.call(s.statusTool, s.statusArgs ? renderArgs(s.statusArgs, { ...base, build: buildVar() }) : { job: s.job, ...(build ? { number: Number(build) } : {}) });
      // the status tool keeps refusing (wrong arguments, no rights): say why instead of waiting out the timeout
      errors = last.isError ? errors + 1 : 0;
      if (errors >= 3) return { ok: false, ...(build ? { build } : {}), ...(url ? { url } : {}), summary: `инструмент ${s.statusTool} отвечает ошибкой: ${last.text.split("\n")[0]!.slice(0, 200)}`, output: last.text.slice(0, 4000) };
      if (!last.isError) {
        build ??= buildNumberOf(last);
        url ??= buildUrlOf(last);
        const st = buildStateOf(last);
        if (st.done) {
          if (st.result === "SUCCESS") return { ok: true, ...(build ? { build } : {}), ...(url ? { url } : {}), summary: `job ${s.job}${build ? ` #${build}` : ""}: SUCCESS`, output: last.text.slice(0, 2000) };
          let log = "";
          if (s.logTool) {
            const l = await session.call(s.logTool, s.logArgs ? renderArgs(s.logArgs, { ...base, build: buildVar() }) : { job: s.job, ...(build ? { number: Number(build) } : {}) }).catch(() => null);
            log = l?.text.slice(-6000) ?? "";
          }
          return { ok: false, ...(build ? { build } : {}), ...(url ? { url } : {}), summary: `job ${s.job}${build ? ` #${build}` : ""}: ${st.result}`, output: log || last.text.slice(0, 4000) };
        }
      }
      await opts.progress?.(`job ${s.job}${build ? ` #${build}` : ""} идёт…`, url);
      if (Date.now() >= deadline) return { ok: false, ...(build ? { build } : {}), ...(url ? { url } : {}), summary: `job ${s.job} не закончился за ${s.timeoutMin} мин`, output: last.text.slice(0, 4000) };
    }
  } finally {
    await session.close();
  }
}
