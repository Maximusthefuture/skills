import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AppError } from "./errors.js";
import { readPlanState } from "./plan.js";
import { buildArgv, FALLBACK_SYSTEM_PROMPT, isValidModel, runSession, usesModel, withModel, type SessionRun } from "./runner.js";
import type { ActivityItem } from "./sessionOutput.js";
import { sessionCost, type Prices } from "./stats.js";
import { FileStore } from "./storage/fileStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type { PlanCriticConfig, SkillSet } from "./ui/runners.js";

/** A risk the critic sees in a plan: what breaks in production if the plan is built as written. */
export interface PlanRisk {
  severity: "high" | "medium" | "low";
  title: string;
  /** The part of the plan or the code it is about, e.g. "PriceCalculator.applyPromo" or "the plan: Who does what". */
  where?: string;
  why: string;
  suggest?: string;
}

/** tasks/<id>/plan/critique-v<N>.json */
export interface PlanCritique {
  version: number;
  at: string;
  endedAt?: string;
  model?: string;
  costUsd?: number;
  risks: PlanRisk[];
  /** No JSON in the answer, or the session failed: what it said. */
  error?: string;
  /** The skill sets that matched the project, and the skills the critic had. */
  skillSets?: string[];
  skills?: string[];
}

/** A skill folder (dir, with SKILL.md) or a single instructions file (file: an agent definition such as critic.md). */
export interface CriticSkill { name: string; description: string; dir?: string; file?: string }

const header = (text: string, fallback: string) => ({
  name: /^name:\s*["']?([^"'\n]+)/m.exec(text)?.[1]?.trim() || fallback,
  description: (/^description:\s*["']?([^\n]+?)["']?\s*$/m.exec(text)?.[1] ?? "").slice(0, 300),
});

const isFile = (p: string) => stat(p).then((x) => x.isFile(), () => false);

/** The sets whose "when" files are in the project's root (several may match), and their skills, each once. */
export async function pickSkills(projectDir: string, sets: SkillSet[], log?: (l: string) => void): Promise<{ sets: string[]; skills: CriticSkill[] }> {
  const files = await readdir(projectDir).catch(() => [] as string[]);
  const matches = (pattern: string) => {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
    return files.some((f) => re.test(f));
  };
  const picked = sets.filter((x) => x.when.some(matches));
  const skills = new Map<string, CriticSkill>();
  for (const set of picked) {
    for (const path of set.skills) {
      if (path.endsWith(".md") && (await isFile(path))) {
        const h = header(await readFile(path, "utf8"), basename(path, ".md"));
        if (!skills.has(h.name)) skills.set(h.name, { ...h, file: path });
        continue;
      }
      // a skill folder, or a folder of skills (a plugin: skills/<name>/SKILL.md, or <name>/SKILL.md)
      const dirs = (await isFile(join(path, "SKILL.md")))
        ? [path]
        : [
            ...(await readdir(join(path, "skills")).catch(() => [] as string[])).map((d) => join(path, "skills", d)),
            ...(await readdir(path).catch(() => [] as string[])).map((d) => join(path, d)),
          ];
      let found = 0;
      for (const dir of dirs) {
        const text = await readFile(join(dir, "SKILL.md"), "utf8").catch(() => null);
        if (text === null) continue;
        found++;
        const h = header(text, basename(dir));
        if (!skills.has(h.name)) skills.set(h.name, { ...h, dir });
      }
      if (!found) log?.(`[plan critic] skill set ${set.name}: no SKILL.md (or .md file) at ${path}; skipped`);
    }
  }
  return { sets: picked.map((x) => x.name), skills: [...skills.values()] };
}

const SEVERITIES = new Set(["high", "medium", "low"]);

/** The risks from the critic's last message: a JSON object {risks: [...]}, alone or in a ```json block. */
export function parseRisks(text: string): PlanRisk[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const body = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const list = Array.isArray(raw) ? raw : (raw as { risks?: unknown })?.risks;
  if (!Array.isArray(list)) return null;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return list
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
    .map((r) => ({
      severity: (SEVERITIES.has(String(r.severity).toLowerCase()) ? String(r.severity).toLowerCase() : "medium") as PlanRisk["severity"],
      title: str(r.title, 200),
      ...(str(r.where, 300) ? { where: str(r.where, 300) } : {}),
      why: str(r.why, 2000),
      ...(str(r.suggest, 1000) ? { suggest: str(r.suggest, 1000) } : {}),
    }))
    .filter((r) => r.title && r.why)
    .slice(0, 20);
}

export async function readCritiques(fs: FileStore, taskId: string): Promise<PlanCritique[]> {
  const s = await readPlanState(fs, taskId);
  const out: PlanCritique[] = [];
  for (const v of s.versions) {
    const c = await fs.readJson<PlanCritique>(["tasks", taskId, "plan", `critique-v${v.n}.json`]);
    if (c) out.push(c);
  }
  return out;
}

/** The operator's answers to the lead's questions of a grilled task: what the plan must carry. */
async function grillDecisions(fs: FileStore, taskId: string): Promise<{ question: string; answer: string }[]> {
  const all = await new MessageStore(fs).list(taskId);
  return all
    .filter((q) => q.to === "operator" && q.type === "QUESTION")
    .flatMap((q) => all.filter((a) => a.from === "operator" && a.replyTo === q.id).map((a) => ({ question: q.content.slice(0, 600), answer: a.content.slice(0, 600) })));
}

export interface PlanCriticOptions {
  networkDir: string;
  projectDir: string;
  config: PlanCriticConfig;
  prices?: () => Promise<{ prices?: Prices }>;
  log?: (line: string) => void;
  /** Tests: the CLI session. */
  run?: (argv: string[], env: NodeJS.ProcessEnv, cwd: string, sink: ((t: string) => void) | null, signal?: AbortSignal, onEvent?: (e: ActivityItem) => void) => Promise<SessionRun>;
  onActivity?: (e: ActivityItem) => void;
  /** How often plans are looked at. Default 3 s. */
  pollMs?: number;
  /** The folder an agent works in (its worktree): the critic reads the lead's code, the one the plan was written from. */
  folderOf?: (agentId: string) => string | undefined;
}

/**
 * The critic of plans (runners.json "planCritic"): every version of a plan the lead writes (task.planReview, still in
 * DISCUSS, not approved) gets one read-only session that looks for what breaks in production if it is built as written:
 * existing data, deploy and rollback, consumers, retries and races, load, security. Its risks show next to the plan on the
 * page; the operator turns the ones that matter into comments for the lead. One session at a time.
 */
export class PlanCritic {
  private timer?: NodeJS.Timeout;
  private looping = false;
  private current: { taskId: string; version: number; done: Promise<void>; abort: AbortController } | null = null;
  private model: string | undefined;

  constructor(private readonly opts: PlanCriticOptions) {
    this.model = opts.config.model;
  }

  start(): void {
    if (this.looping) return;
    this.looping = true;
    const loop = () => {
      if (!this.looping) return;
      void this.tick()
        .catch((e: Error) => this.opts.log?.(`[plan critic] ${e.message}`))
        .finally(() => {
          if (this.looping) this.timer = setTimeout(loop, this.opts.pollMs ?? 3000);
        });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.looping = false;
    clearTimeout(this.timer);
    this.current?.abort.abort();
    await this.current?.done;
  }

  /** Waits for the running session (tests). */
  async idle(): Promise<void> {
    await this.current?.done;
  }

  running(taskId: string): number | null {
    return this.current?.taskId === taskId ? this.current.version : null;
  }

  get modelName(): string | null {
    return usesModel(this.opts.config.command) ? (this.model ?? null) : null;
  }

  setModel(model: string): void {
    if (!isValidModel(model)) throw new AppError("INVALID_INPUT", `Not a model name: ${model}`);
    if (!usesModel(this.opts.config.command)) throw new AppError("INVALID_INPUT", "The critic's command has no {model}");
    this.model = model;
  }

  /** The operator asks for another look at a version (after a failed run, say): its critique goes, the next tick runs it. */
  async again(taskId: string, version: number): Promise<void> {
    if (this.running(taskId) === version) throw new AppError("INVALID_INPUT", `The critic is reading v${version} already`);
    await rm(join(this.opts.networkDir, "tasks", taskId, "plan", `critique-v${version}.json`), { force: true });
  }

  /** The first plan version the lead wrote that has no critique yet: start a session on it. Public for tests. */
  async tick(): Promise<void> {
    if (this.current) return;
    const fs = await FileStore.open(this.opts.networkDir);
    for (const task of await new TaskStore(fs).list()) {
      if (!task.planReview || task.status !== "ACTIVE" || task.phase !== "DISCUSS") continue;
      const s = await readPlanState(fs, task.id);
      const last = s.versions.at(-1);
      // the operator's own edits are not the lead's plan; an approved plan is past criticism
      if (!last || last.by === "operator" || s.approved) continue;
      if (await fs.exists(["tasks", task.id, "plan", `critique-v${last.n}.json`])) continue;
      const abort = new AbortController();
      const done = this.session(task.id, task.title, task.description, last.n, abort.signal, !!task.grill, task.agents[0]!)
        .catch((e: Error) => this.opts.log?.(`[plan critic] ${task.id} v${last.n}: ${e.message}`))
        .finally(() => {
          this.current = null;
        });
      this.current = { taskId: task.id, version: last.n, done, abort };
      return;
    }
  }

  private async session(taskId: string, title: string, description: string, version: number, signal: AbortSignal, grilled = false, lead = ""): Promise<void> {
    const cfg = this.opts.config;
    // the lead's own folder: its branch may hold work the project's branch has not got yet
    const codeDir = this.opts.folderOf?.(lead) ?? this.opts.projectDir;
    const fs = await FileStore.open(this.opts.networkDir);
    const planFile = join(this.opts.networkDir, "tasks", taskId, "plan", `v${version}.html`);
    // the latest critique before this version (the operator's edits in between have none)
    const previous = (await readCritiques(fs, taskId)).filter((c) => c.version < version).at(-1);
    const at = new Date().toISOString();
    const instructions = (await readFile(cfg.promptFile, "utf8").catch(() => "")).trim() || "You criticise a plan before it is built: what breaks in production. Answer with JSON {\"risks\": [...]}.";
    // its own empty folder: a CLI started in the project would load the project's CLAUDE.md and hooks; the skills of the
    // project's kind go in there, as skills Claude loads (.claude/skills) and as files any CLI can read (skills/)
    const cwd = join(tmpdir(), "agent-network-critic", createHash("sha1").update(this.opts.networkDir).digest("hex").slice(0, 12));
    const { sets, skills } = await pickSkills(codeDir, cfg.skillSets ?? [], this.opts.log);
    await rm(join(cwd, ".claude"), { recursive: true, force: true });
    await rm(join(cwd, "skills"), { recursive: true, force: true });
    await mkdir(join(cwd, ".claude", "skills"), { recursive: true });
    await mkdir(join(cwd, "skills"), { recursive: true });
    const where = (k: CriticSkill) => join(cwd, "skills", k.name.replace(/[^\w.-]/g, "-") + (k.file ? ".md" : ""));
    for (const k of skills) {
      if (k.dir) await symlink(k.dir, join(cwd, ".claude", "skills", k.name.replace(/[^\w.-]/g, "-")), "dir").catch(() => undefined);
      await symlink(k.dir ?? k.file!, where(k), k.dir ? "dir" : "file").catch(() => undefined);
    }
    const brief = {
      task: { id: taskId, title, description }, planFile, projectDir: codeDir, version,
      // the operator reads the risks: in the task's language (a weak model misses "the language of the description")
      answerLanguage: /[а-яё]/i.test(`${title} ${description}`) ? "Russian" : "English",
      ...(previous?.risks.length ? { risksOfThePreviousVersion: previous.risks.map((r) => r.title) } : {}),
      ...(grilled ? { grillDecisions: await grillDecisions(fs, taskId) } : {}),
      ...(skills.length ? { skills: skills.map((k) => ({ name: k.name, description: k.description, file: k.dir ? join(where(k), "SKILL.md") : where(k) })) } : {}),
    };
    const useSkills = skills.length
      ? `\n\nSkills for this kind of project ('skills' below: ${sets.join(", ")}): pick the ones whose description fits the plan, read their file (and the references it points to only when needed), and judge the plan by their rules. A risk you found through a skill names it in "why".`
      : "";
    const prompt = `${instructions}${useSkills}\n\nThis plan (JSON):\n${JSON.stringify(brief, null, 2)}`;
    const system = cfg.command.some((a) => a.includes("{systemPrompt}")) ? (cfg.systemPromptFile ? (await readFile(cfg.systemPromptFile, "utf8").catch(() => "")).trim() : "") || FALLBACK_SYSTEM_PROMPT : undefined;
    const fill = (a: string) => a.replaceAll("{projectDir}", codeDir).replaceAll("{planDir}", dirname(planFile)).replaceAll("{networkDir}", this.opts.networkDir);
    const argv = buildArgv(withModel(cfg.command, this.model).map(fill), prompt, system);
    this.opts.log?.(`[plan critic] ${taskId}: reading plan v${version}${this.model ? `, model ${this.model}` : ""}${skills.length ? `, skills: ${skills.map((k) => k.name).join(", ")}` : ""}`);
    let res: SessionRun;
    try {
      res = await (this.opts.run ?? runSession)(argv, { ...process.env, NETWORK_DIR: this.opts.networkDir }, cwd, null, signal, this.opts.onActivity);
    } catch (e) {
      res = { code: 1, result: { text: (e as Error).message } as SessionRun["result"] };
    }
    if (signal.aborted) return; // stopped with the page: the next start reads it again
    const text = res.result?.text ?? "";
    const risks = parseRisks(text);
    const cost = sessionCost({ id: "", taskId, agentId: "plan-critic", attempt: 1, startedAt: at, endedAt: new Date().toISOString(), durationMs: 0, exitCode: res.code, ...(res.result?.usage ? { usage: res.result.usage } : {}), ...(res.result?.costUsd !== undefined ? { costUsd: res.result.costUsd } : {}), ...(this.model ? { model: this.model } : {}) }, (await this.opts.prices?.())?.prices);
    const critique: PlanCritique = {
      version, at, endedAt: new Date().toISOString(), risks: risks ?? [],
      ...(this.model ? { model: this.model } : {}),
      ...(cost.usd !== undefined ? { costUsd: Math.round(cost.usd * 1000) / 1000 } : {}),
      ...(risks === null ? { error: (text || `the session ended with exit code ${res.code}`).slice(0, 600) } : {}),
      ...(sets.length ? { skillSets: sets } : {}),
      ...(skills.length ? { skills: skills.map((k) => k.name) } : {}),
    };
    await fs.writeJson(["tasks", taskId, "plan", `critique-v${version}.json`], critique);
    this.opts.log?.(`[plan critic] ${taskId} v${version}: ${risks === null ? "no risks list in the answer" : `${risks.length} risk(s)`}${critique.costUsd !== undefined ? `, $${critique.costUsd}` : ""}`);
  }
}
