import { execFile } from "node:child_process";
import type { FileStore } from "./storage/fileStore.js";
import { onPath } from "./stack.js";

/**
 * What waits for the operator, across a page's projects: a question of an agent, a page to review, a DONE task to accept,
 * a merge that did not pass its check, a BLOCKED task, the supervisor's "needs you", the observer's proposals. Built from
 * what the page already knows (no model); each item has a stable key, so the notifier tells about it once and reminds
 * once, and it leaves the list by itself when the operator has decided.
 */

export type AttentionKind = "question" | "plan" | "acceptance" | "merge" | "blocked" | "supervisor" | "observer";
/** In the order they come in the list (after what blocks the swarm, and what has a deadline). */
export const ATTENTION_KINDS: readonly AttentionKind[] = ["question", "blocked", "plan", "merge", "acceptance", "supervisor", "observer"];

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  taskId?: string;
  /** One line: what to decide. */
  title: string;
  text: string;
  /** Since when it waits. */
  since: string;
  /** A question: when the agent goes ahead with its own option without the operator. */
  due?: string;
  /** The swarm stands still until the operator acts (a question, a page, BLOCKED): these get a reminder. */
  blocking: boolean;
  /** Where the page opens it. */
  open: { tab: "tasks" | "supervisor" | "observer"; plan?: true; acceptance?: true; messageId?: string };
}

interface TaskView {
  id: string; title: string; status: string; phase: string; updatedAt: string; phaseSince?: string; syncRound?: number;
  grill?: boolean; jobOf?: unknown; merged?: unknown; acceptance?: unknown;
  /** A change-writing task, and whether its change is in the project folder (merged) after DONE. */
  proposes?: { change: string } | null; proposedReady?: boolean;
  /** A task that implements a change. */
  openspec?: { change: string } | null;
  blockedReason?: string | null; blockedBy?: string | null; handover?: { dueAt: string; lead: string } | null;
  setAside?: { next: Record<string, string> } | null;
  plan?: { status: string; stage?: string | null; version?: number | null; at?: string | null } | null;
  waitingOn?: string[];
  mergeCheck?: { status: string; into: string; startedAt: string; finishedAt?: string; followUp?: string; build?: { tests?: { total: number; failed: number } }; files?: string[] } | null;
  contractMergeCheck?: AttentionInput["tasks"][number]["mergeCheck"];
}

export interface AttentionInput {
  tasks: TaskView[];
  questions: { taskId: string; taskTitle: string; messageId: string; from: string; question: string; askedAt: string; choices?: { recommended?: string } | null }[];
  needsYou: { id: string; at: string; taskId?: string; text: string }[];
  proposals: { id: string; at: string; title: string; status: string }[];
  /** How long an agent waits for an answer before it goes ahead (AGENT_NETWORK_OPERATOR_TIMEOUT_MIN). */
  operatorTimeoutMs: number;
}

const firstLine = (s: string, n = 140) => {
  const l = (s.split("\n").find((x) => x.trim()) ?? "").trim();
  return l.length > n ? `${l.slice(0, n)}…` : l;
};
const PAGE: Record<string, string> = { input: "Спека аналитиков ждёт просмотра", change: "Change ждёт приёмки" };
const BAD_MERGE: Record<string, string> = { red: "сборка красная", conflict: "конфликт", stale: "проект сдвинулся во время проверки", error: "проверка не удалась", interrupted: "проверка прервана" };

export function attentionItems(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const byId = new Map(i.tasks.map((t) => [t.id, t]));
  for (const q of i.questions) {
    const grill = byId.get(q.taskId)?.grill;
    const due = grill ? undefined : new Date(Date.parse(q.askedAt) + i.operatorTimeoutMs).toISOString();
    out.push({
      key: `question:${q.taskId}:${q.messageId}`, kind: "question", taskId: q.taskId, blocking: true, since: q.askedAt, ...(due ? { due } : {}),
      title: `${q.taskId}: вопрос от ${q.from}`, text: firstLine(q.question) + (q.choices?.recommended ? ` (рекомендует «${q.choices.recommended}»)` : ""),
      open: { tab: "tasks", messageId: q.messageId },
    });
  }
  for (const t of i.tasks) {
    if (t.plan && t.status === "ACTIVE" && t.waitingOn?.includes("operator") && t.plan.status === "awaiting") {
      out.push({
        key: `plan:${t.id}:v${t.plan.version ?? 0}`, kind: "plan", taskId: t.id, blocking: true, since: t.plan.at ?? t.updatedAt,
        title: `${t.id}: ${PAGE[t.plan.stage ?? ""] ?? "План ждёт утверждения"}`, text: t.title, open: { tab: "tasks", plan: true },
      });
    }
    if (t.status === "BLOCKED") {
      out.push({
        key: `blocked:${t.id}:${t.syncRound ?? 0}:${t.blockedBy ?? "rounds"}`, kind: "blocked", taskId: t.id, blocking: !t.setAside, since: t.phaseSince ?? t.updatedAt,
        ...(t.handover ? { due: t.handover.dueAt } : {}),
        title: `${t.id}: BLOCKED`, text: (t.blockedReason ?? t.title) + (t.handover ? ` — потом исправление возьмёт ${t.handover.lead}` : "") + (t.setAside ? ` — отложена: агенты пока делают ${[...new Set(Object.values(t.setAside.next))].join(", ")}` : ""), open: { tab: "tasks" },
      });
    }
    if (t.status === "COMPLETED" && t.proposes) {
      // a written change waits too: to be merged into the project, then to be implemented by a task of its own
      const name = t.proposes.change;
      const implemented = i.tasks.some((x) => x.openspec?.change === name && x.status !== "CANCELLED");
      if (!t.proposedReady && !t.merged) {
        out.push({ key: `change:${t.id}:merge`, kind: "acceptance", taskId: t.id, blocking: false, since: t.updatedAt, title: `${t.id}: change ${name} ждёт вливания`, text: "Посмотрите изменения и влейте ветку lead'а: тогда change можно реализовать", open: { tab: "tasks" } });
      } else if (t.proposedReady && !implemented) {
        out.push({ key: `change:${t.id}:implement`, kind: "acceptance", taskId: t.id, blocking: false, since: t.updatedAt, title: `${t.id}: change ${name} готов к реализации`, text: "«Реализовать change» в карточке задачи откроет форму с ним", open: { tab: "tasks" } });
      }
      continue;
    }
    if (t.status !== "COMPLETED" || t.merged) continue;
    // a merge that did not pass: the contract's first (the service waits for it), then the service's
    const bad = [t.contractMergeCheck && { c: t.contractMergeCheck, scope: "contract" }, t.mergeCheck && { c: t.mergeCheck, scope: "" }].find(
      (x): x is { c: NonNullable<TaskView["mergeCheck"]>; scope: string } => !!x && !!BAD_MERGE[x.c.status] && !x.c.followUp,
    );
    if (bad) {
      out.push({
        key: `merge:${t.id}:${bad.scope}:${bad.c.status}:${bad.c.startedAt}`, kind: "merge", taskId: t.id, blocking: false, since: bad.c.finishedAt ?? bad.c.startedAt,
        title: `${t.id}: вливание${bad.scope ? " контракта" : ""} — ${BAD_MERGE[bad.c.status]}`,
        text: `${t.title}${bad.c.build?.tests ? ` · упало ${bad.c.build.tests.failed} из ${bad.c.build.tests.total}` : ""}${bad.c.files?.length ? ` · ${bad.c.files.join(", ")}` : ""}`, open: { tab: "tasks" },
      });
      continue;
    }
    // being checked, or handed to a follow-up whose merge brings this work: nothing to accept here yet
    const checking = [t.mergeCheck, t.contractMergeCheck].some((c) => c?.status === "running" || !!c?.followUp);
    if (!t.acceptance && !t.jobOf && !checking) {
      out.push({ key: `acceptance:${t.id}`, kind: "acceptance", taskId: t.id, blocking: false, since: t.updatedAt, title: `${t.id}: ждёт приёмки`, text: t.title, open: { tab: "tasks", acceptance: true } });
    }
  }
  for (const e of i.needsYou) {
    out.push({ key: `supervisor:${e.id}`, kind: "supervisor", ...(e.taskId ? { taskId: e.taskId } : {}), blocking: false, since: e.at, title: `Надзор: нужно ваше решение${e.taskId ? ` (${e.taskId})` : ""}`, text: firstLine(e.text), open: { tab: "supervisor" } });
  }
  for (const p of i.proposals.filter((x) => x.status === "open")) {
    out.push({ key: `observer:${p.id}`, kind: "observer", blocking: false, since: p.at, title: "Наблюдатель предлагает", text: firstLine(p.title), open: { tab: "observer" } });
  }
  // what stops the swarm first, then the oldest
  const order = (x: string | undefined, y: string | undefined) => (x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1);
  const rank = (k: AttentionKind) => ATTENTION_KINDS.indexOf(k);
  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking) || order(a.due, b.due) || rank(a.kind) - rank(b.kind) || order(a.since, b.since));
}

export type Sender = (title: string, body: string) => Promise<void>;

/** Linux desktop notifications (notify-send, libnotify); null elsewhere or when it is not installed. */
export async function linuxSender(platform = process.platform): Promise<Sender | null> {
  if (platform !== "linux" || !(await onPath("notify-send"))) return null;
  return (title, body) =>
    new Promise((done) => execFile("notify-send", ["--app-name=Agent Network", title, body], { timeout: 10_000 }, () => done()));
}

export interface NotifyConfig {
  /** Desktop notifications (Linux: notify-send). Default true. */
  os?: boolean;
  /** One reminder for a blocking item that waits this long. Default 30; 0 = none. */
  remindAfterMin?: number;
  /** What is notified (the page lists everything). Default all. */
  kinds?: AttentionKind[];
}

interface NotifyState { notified: Record<string, string>; reminded: Record<string, string> }
const STATE = ["attention.json"];
/** Before a question times out, the operator hears once that the agent is about to go ahead without it. */
const WARN_BEFORE_MS = 2 * 60_000;

/**
 * Tells the operator about new items once (several at a tick in one notification), reminds once of a blocking item that
 * waits long, warns once before a question times out. What it told is kept in <network>/attention.json, so a restart of
 * the page does not tell it again; items that left the list are forgotten.
 */
export class Notifier {
  constructor(private readonly send: Sender | null, private readonly cfg: NotifyConfig = {}) {}

  get enabled(): boolean {
    return !!this.send && this.cfg.os !== false;
  }

  async tick(project: string, fs: FileStore, all: AttentionItem[], now = Date.now()): Promise<string[]> {
    const kinds = new Set(this.cfg.kinds ?? ATTENTION_KINDS);
    const items = all.filter((i) => kinds.has(i.kind));
    const st = (await fs.readJson<NotifyState>(STATE)) ?? { notified: {}, reminded: {} };
    const before = JSON.stringify(st); // st is changed below: what to write is decided against this
    const at = new Date(now).toISOString();
    const messages: { title: string; body: string }[] = [];
    const fresh = items.filter((i) => !st.notified[i.key]);
    if (fresh.length === 1) messages.push({ title: `${project}: ${fresh[0]!.title}`, body: fresh[0]!.text });
    else if (fresh.length > 1) messages.push({ title: `${project}: ждут вашего решения — ${fresh.length}`, body: fresh.slice(0, 5).map((i) => `• ${i.title}`).join("\n") + (fresh.length > 5 ? `\n… и ещё ${fresh.length - 5}` : "") });
    for (const i of fresh) st.notified[i.key] = at;

    const remindMs = (this.cfg.remindAfterMin ?? 30) * 60_000;
    for (const i of items) {
      if (fresh.includes(i)) continue;
      if (i.due && !st.reminded[`due:${i.key}`]) {
        const left = Date.parse(i.due) - now;
        if (left > 0 && left <= WARN_BEFORE_MS) {
          st.reminded[`due:${i.key}`] = at;
          messages.push({ title: `${project}: ${i.title}`, body: `${i.kind === "question" ? "Агент пойдёт по своему варианту" : "Решение уйдёт само"} через ${Math.max(1, Math.round(left / 60_000))} мин: ${i.text}` });
          continue;
        }
      }
      if (remindMs > 0 && i.blocking && !st.reminded[i.key] && now - Date.parse(i.since) >= remindMs) {
        st.reminded[i.key] = at;
        messages.push({ title: `${project}: всё ещё ждёт вас — ${i.title}`, body: `${Math.round((now - Date.parse(i.since)) / 60_000)} мин: ${i.text}` });
      }
    }
    // forget what left the list: a key that comes back (a new round, say) is news again
    const keys = new Set(items.map((i) => i.key));
    const prune = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => keys.has(k.replace(/^due:/, ""))));
    const next = { notified: prune(st.notified), reminded: prune(st.reminded) };
    if (JSON.stringify(next) !== before) await fs.writeJson(STATE, next);
    if (this.enabled) for (const m of messages) await this.send!(m.title, m.body);
    return messages.map((m) => m.title);
  }
}
