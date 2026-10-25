import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTools, parseBuildCommand } from "./build.js";
import { inspectContract } from "./contract.js";
import { AppError } from "./errors.js";
import { buildArgv, FALLBACK_SYSTEM_PROMPT, runSession, withModel, type SessionRun } from "./runner.js";
import type { ActivityItem } from "./sessionOutput.js";
import { sessionCost, type Prices } from "./stats.js";
import type { FileStore } from "./storage/fileStore.js";
import type { ObserverConfig } from "./ui/runners.js";

/**
 * A task drafted by an agent: the operator writes the idea in its own words (a line, a paragraph, a ticket pasted
 * whole); one read-only session reads the project and fills the task form — the title, a concrete description (the
 * problem, the expected behaviour, the files, who does what, what not to touch, how to check), the team, the
 * preparation, the build, the contract project, an OpenSpec change — with why for each, and the questions it could not
 * settle from the code. The server checks every field; the operator edits the form and creates the task itself.
 */

export type Depth = "fast" | "standard" | "thorough";
export interface DraftQuestion { question: string; options: string[]; recommended?: string }

export interface DraftResult {
  title?: string;
  description?: string;
  lead?: string;
  agents?: string[];
  depth?: Depth;
  verifyCommand?: string;
  contract?: string;
  openspec?: string;
  /** Why each field is what it is, in a sentence. */
  why: Record<string, string>;
  questions: DraftQuestion[];
  /** Fields the server would not take, and why: the form keeps what it had. */
  dropped: { field: string; reason: string }[];
}

export interface Draft {
  id: string;
  at: string;
  text: string;
  status: "running" | "done" | "error" | "stopped";
  endedAt?: string;
  model?: string;
  costUsd?: number;
  result?: DraftResult;
  error?: string;
}

/** What the drafting session is told about the project. */
export interface DraftContext {
  projectDir: string;
  stack: string | null;
  verifyCommand: string | null;
  agents: { id: string; model: string | null; role: string | null }[];
  openspecChanges: string[];
  /** Contract projects of earlier tasks: the ones the operator has named before. */
  contracts: { project: string; artifact: string }[];
}

const DEPTHS: readonly Depth[] = ["fast", "standard", "thorough"];

/** The JSON object of the session's last message, alone or in a ```json block. */
export function parseDraft(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const body = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const raw = JSON.parse(body) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Every field as the form would take it; what does not fit the project is dropped with the reason. */
export async function checkDraft(raw: Record<string, unknown>, ctx: DraftContext, inspect = inspectContract): Promise<DraftResult> {
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const dropped: DraftResult["dropped"] = [];
  const out: DraftResult = { why: {}, questions: [], dropped };
  const title = str(raw.title, 200);
  if (title) out.title = title;
  else dropped.push({ field: "title", reason: "no title" });
  const description = str(raw.description, 8000);
  if (description.length >= 40) out.description = description;
  else dropped.push({ field: "description", reason: "too short to be a task description" });

  const ids = ctx.agents.map((a) => a.id);
  const lead = str(raw.lead, 64);
  const others = (Array.isArray(raw.agents) ? raw.agents : []).map((a) => str(a, 64)).filter((a) => a && a !== lead);
  const unknown = [lead, ...others].filter((a) => a && !ids.includes(a));
  if (!lead || unknown.length || !others.length) {
    dropped.push({ field: "agents", reason: unknown.length ? `not agents of this project: ${unknown.join(", ")}` : "a task needs a lead and at least one more agent" });
  } else {
    out.lead = lead;
    out.agents = [...new Set(others)];
  }
  if (DEPTHS.includes(raw.depth as Depth)) out.depth = raw.depth as Depth;
  else if (raw.depth !== undefined) dropped.push({ field: "depth", reason: `one of ${DEPTHS.join(", ")}` });

  const verify = str(raw.verifyCommand, 400);
  if (verify) {
    try {
      parseBuildCommand(verify, buildTools());
      out.verifyCommand = verify;
    } catch (e) {
      dropped.push({ field: "verifyCommand", reason: (e as Error).message });
    }
  }
  const contract = str(raw.contract, 1000);
  if (contract) {
    try {
      out.contract = (await inspect(contract)).project;
    } catch (e) {
      dropped.push({ field: "contract", reason: (e as Error).message });
    }
  }
  const openspec = str(raw.openspec, 200);
  if (openspec) {
    if (ctx.openspecChanges.includes(openspec)) out.openspec = openspec;
    else dropped.push({ field: "openspec", reason: `no change "${openspec}" in openspec/changes/` });
  }
  if (raw.why && typeof raw.why === "object" && !Array.isArray(raw.why)) {
    for (const [k, v] of Object.entries(raw.why as Record<string, unknown>).slice(0, 20)) if (typeof v === "string" && v.trim()) out.why[k.slice(0, 40)] = v.trim().slice(0, 600);
  }
  if (Array.isArray(raw.questions)) {
    out.questions = raw.questions.slice(0, 8).flatMap((q) => {
      const o = (q ?? {}) as Record<string, unknown>;
      const question = str(o.question, 600);
      if (!question) return [];
      const options = (Array.isArray(o.options) ? o.options : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 6);
      const recommended = str(o.recommended, 200);
      return [{ question, options, ...(recommended ? { recommended } : {}) }];
    });
  }
  return out;
}

export interface DrafterOptions {
  networkDir: string;
  fs: FileStore;
  config: ObserverConfig;
  context: () => Promise<DraftContext>;
  prices?: () => Promise<{ prices?: Prices }>;
  log?: (line: string) => void;
  onActivity?: (e: ActivityItem) => void;
  /** Tests: the CLI session and the contract check. */
  run?: (argv: string[], env: NodeJS.ProcessEnv, cwd: string, sink: ((t: string) => void) | null, signal?: AbortSignal, onEvent?: (e: ActivityItem) => void) => Promise<SessionRun>;
  inspect?: typeof inspectContract;
}

const DIR = ["drafts"];

/** One drafting session at a time per project; drafts are kept in <network>/drafts/draft-NNN.json. */
export class Drafter {
  private current: { id: string; abort: AbortController; done: Promise<void> } | null = null;

  constructor(private readonly opts: DrafterOptions) {}

  get model(): string | undefined {
    return this.opts.config.model;
  }

  async get(id: string): Promise<Draft | null> {
    if (!/^draft-\d+$/.test(id)) return null;
    const d = await this.opts.fs.readJson<Draft>([...DIR, `${id}.json`]);
    // a running draft this process is not running was cut off by a restart of the page
    return d?.status === "running" && this.current?.id !== id ? { ...d, status: "stopped", error: "the page was restarted while it ran" } : d;
  }

  async idle(): Promise<void> {
    await this.current?.done;
  }

  async stop(id: string): Promise<void> {
    if (this.current?.id === id) {
      this.current.abort.abort();
      await this.current.done;
    }
  }

  async start(text: string): Promise<Draft> {
    const idea = text.trim();
    if (idea.length < 5) throw new AppError("INVALID_INPUT", "Write the idea in a few words: what should change, for whom");
    if (idea.length > 20_000) throw new AppError("INVALID_INPUT", "The idea is over 20000 characters: keep what the task is about");
    if (this.current) throw new AppError("INVALID_INPUT", `A draft is being written (${this.current.id}): wait for it, or stop it`);
    const draft = await this.opts.fs.createNumbered<Draft>(DIR, "draft", (id) => ({ id, at: new Date().toISOString(), text: idea, status: "running", ...(this.model ? { model: this.model } : {}) }));
    const abort = new AbortController();
    const done = this.session(draft, abort.signal)
      .catch(async (e: Error) => {
        await this.save({ ...draft, status: "error", endedAt: new Date().toISOString(), error: e.message.slice(0, 600) });
      })
      .finally(() => {
        this.current = null;
      });
    this.current = { id: draft.id, abort, done };
    return draft;
  }

  private async save(d: Draft): Promise<void> {
    await this.opts.fs.writeJson([...DIR, `${d.id}.json`], d);
  }

  private async session(draft: Draft, signal: AbortSignal): Promise<void> {
    const cfg = this.opts.config;
    const ctx = await this.opts.context();
    const instructions = (await readFile(cfg.promptFile, "utf8").catch(() => "")).trim() || "You draft a task for an AI swarm from the operator's idea: read the project, answer with the JSON the brief describes.";
    const brief = {
      idea: draft.text,
      project: { dir: ctx.projectDir, stack: ctx.stack, verifyCommand: ctx.verifyCommand },
      agents: ctx.agents,
      openspecChanges: ctx.openspecChanges,
      contractProjects: ctx.contracts,
      // the operator reads it: in the idea's language
      answerLanguage: /[а-яё]/i.test(draft.text) ? "Russian" : "English",
    };
    const prompt = `${instructions}\n\nThe idea and the project (JSON):\n${JSON.stringify(brief, null, 2)}`;
    const system = cfg.command.some((a) => a.includes("{systemPrompt}")) ? (cfg.systemPromptFile ? (await readFile(cfg.systemPromptFile, "utf8").catch(() => "")).trim() : "") || FALLBACK_SYSTEM_PROMPT : undefined;
    // its own empty folder (no project CLAUDE.md or hooks to load); the project is read through {projectDir}
    const cwd = join(tmpdir(), "agent-network-drafter", createHash("sha1").update(this.opts.networkDir).digest("hex").slice(0, 12));
    await mkdir(cwd, { recursive: true });
    const fill = (a: string) => a.replaceAll("{projectDir}", ctx.projectDir).replaceAll("{networkDir}", this.opts.networkDir);
    const argv = buildArgv(withModel(cfg.command, this.model).map(fill), prompt, system);
    this.opts.log?.(`[drafter] ${draft.id}: drafting${this.model ? `, model ${this.model}` : ""}`);
    let res: SessionRun;
    try {
      res = await (this.opts.run ?? runSession)(argv, { ...process.env, NETWORK_DIR: this.opts.networkDir }, cwd, null, signal, this.opts.onActivity);
    } catch (e) {
      res = { code: 1, result: { text: (e as Error).message } as SessionRun["result"] };
    }
    const endedAt = new Date().toISOString();
    if (signal.aborted) {
      await this.save({ ...draft, status: "stopped", endedAt });
      return;
    }
    const text = res.result?.text ?? "";
    const raw = parseDraft(text);
    const cost = sessionCost({ id: "", taskId: "", agentId: "drafter", attempt: 1, startedAt: draft.at, endedAt, durationMs: 0, exitCode: res.code, ...(res.result?.usage ? { usage: res.result.usage } : {}), ...(res.result?.costUsd !== undefined ? { costUsd: res.result.costUsd } : {}), ...(this.model ? { model: this.model } : {}) }, (await this.opts.prices?.())?.prices);
    const costUsd = cost.usd !== undefined ? { costUsd: Math.round(cost.usd * 1000) / 1000 } : {};
    if (!raw) {
      await this.save({ ...draft, status: "error", endedAt, ...costUsd, error: (text || `the session ended with exit code ${res.code}`).slice(0, 600) });
      return;
    }
    const result = await checkDraft(raw, ctx, this.opts.inspect);
    await this.save({ ...draft, status: "done", endedAt, ...costUsd, result });
    this.opts.log?.(`[drafter] ${draft.id}: done${result.dropped.length ? `, dropped: ${result.dropped.map((d) => d.field).join(", ")}` : ""}${costUsd.costUsd !== undefined ? `, $${costUsd.costUsd}` : ""}`);
  }
}
