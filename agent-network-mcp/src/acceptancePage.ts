import { execFile } from "node:child_process";
import { deployNotes, type DeployNotes } from "./deploy/notes.js";
import type { DeployEnvironment } from "./deploy/settings.js";
import { creditedSessions } from "./observer/digest.js";
import { matches, normalizePath } from "./ownership.js";
import { esc, inline, markdown, page } from "./pageRender.js";
import { taskStats, type Prices } from "./stats.js";
import type { FileStore } from "./storage/fileStore.js";
import { AgreementStore } from "./stores/agreementStore.js";
import { IntegrationStore } from "./stores/integrationStore.js";
import { MessageStore } from "./stores/messageStore.js";
import { SubtaskStore } from "./stores/subtaskStore.js";
import { SyncStore } from "./stores/syncStore.js";
import { TaskStore } from "./stores/taskStore.js";
import type { Acceptance, ReviewComment, Severity, Task } from "./types.js";
import { branchDiff } from "./worktrees.js";

/**
 * The acceptance page of a DONE task: what the operator checks before it merges the result. The lead gave only its
 * acceptance table (acceptance.ts); the rest is the task's own data — the request and the operator's answers, the
 * reviews, the diff against the agreement, the deploy notes — and "what to look at" first: everything that needs a human.
 */

const OPERATOR = "operator";

export interface AcceptanceRange {
  /** The repository the range is read in and the branch shown. */
  project: string; branch: string;
  base: string; head: string; mode: "three-dot" | "two-dot";
}

export interface AcceptanceData {
  task: Pick<Task, "id" | "title" | "description" | "verifyCommand" | "syncRound" | "maxFixRounds" | "merged" | "acceptance" | "openspec">;
  branch: string | null;
  head: string | null;
  acceptance: Acceptance | null;
  result: string | null;
  build: { command: string; ok: boolean; head?: string; tests?: { total: number; failed: number } } | null;
  elapsedMin: number | null;
  costUsd: number | null;
  questions: { question: string; answer: string | null; recommended?: string }[];
  findings: { round: number; by: string; severity: Severity; description: string; relatedAgent?: string; files?: string[] }[];
  lastRound: number;
  reviewComments: ReviewComment[];
  files: { path: string; added: number; deleted: number; outside: boolean; test: boolean }[];
  /** No assignment declared files: nothing to check the diff against. */
  undeclared: boolean;
  notes: DeployNotes | null;
  notesError?: string;
  followUps: { id: string; title: string }[];
  dropped: { agent: string; title: string; note?: string }[];
}

export interface Alert { level: "bad" | "warn"; text: string }

const TEST_FILE = /(^|\/)(src\/test|tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.(java|kt)$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
export const isTestFile = (path: string): boolean => TEST_FILE.test(path);

function mergeBase(project: string, a: string, b: string): Promise<string | null> {
  return new Promise((done) => execFile("git", ["merge-base", a, b], { cwd: project, timeout: 15_000 }, (e, out) => done(e ? null : String(out).trim() || null)));
}

export async function collectAcceptance(fs: FileStore, taskId: string, range: AcceptanceRange | null, environments: DeployEnvironment[], prices?: Prices): Promise<AcceptanceData> {
  const tasks = new TaskStore(fs);
  const task = await tasks.get(taskId);
  const reports = (await new IntegrationStore(fs).list(task.id)).filter((r) => r.status === "PASS");
  const report = reports.at(-1) ?? null;
  const lead = task.agents[0]!;
  const build = await fs.readJson<{ command: string; ok: boolean; head?: string; tests?: { total: number; failed: number } }>(["tasks", task.id, "builds", `${lead}.json`]);
  const { sessions, countedIn } = await creditedSessions(fs, task.id);
  const stats = taskStats(task, sessions, countedIn, new Date(), prices);

  const messages = await new MessageStore(fs).list(task.id);
  const questions = messages
    .filter((m) => m.to === OPERATOR && m.type === "QUESTION" && !m.summary)
    .map((q) => {
      const answer = messages.find((m) => m.from === OPERATOR && m.replyTo === q.id);
      return { question: q.content, answer: answer?.content ?? null, ...(q.choices?.recommended ? { recommended: q.choices.recommended } : {}) };
    });

  const sync = await new SyncStore(fs).list(task.id);
  const findings = sync.flatMap((r) => r.findings.map((f) => ({ round: r.round, by: r.agentId, ...f })));
  const reviewComments = (await fs.readJson<ReviewComment[]>(["tasks", task.id, "review.json"])) ?? [];

  const agreement = await new AgreementStore(fs).find(task.id);
  const declared = (agreement?.assignments ?? []).flatMap((a) => a.files ?? []);
  if (task.openspec) declared.push(`openspec/changes/${task.openspec.change}/**`);
  let files: AcceptanceData["files"] = [];
  let notes: DeployNotes | null = null;
  let notesError: string | undefined;
  if (range) {
    const diff = await branchDiff(range.project, range.base, range.head, range.mode).catch(() => null);
    files = (diff?.files ?? []).map((f) => ({
      path: f.path, added: f.added, deleted: f.deleted, test: isTestFile(f.path),
      outside: declared.length > 0 && !declared.some((d) => matches(d, normalizePath(f.path))),
    }));
    const base = range.mode === "three-dot" ? await mergeBase(range.project, range.base, range.head) : range.base;
    if (base) notes = await deployNotes(range.project, base, range.head, environments).catch((e: Error) => ((notesError = e.message), null));
  }

  const followUps = (await tasks.list()).filter((t) => t.parentTaskId === task.id).map((t) => ({ id: t.id, title: t.title }));
  const subtasks = new SubtaskStore(fs);
  const dropped = (await Promise.all(task.agents.map(async (a) => (await subtasks.get(task.id, a)).items.filter((i) => i.status === "DROPPED").map((i) => ({ agent: a, title: i.title, ...(i.note ? { note: i.note } : {}) })))))
    .flat();

  return {
    task: { id: task.id, title: task.title, description: task.description, verifyCommand: task.verifyCommand, syncRound: task.syncRound, maxFixRounds: task.maxFixRounds, merged: task.merged, acceptance: task.acceptance, openspec: task.openspec },
    branch: range?.branch ?? null,
    head: report?.commits[0] ?? task.merged?.commit ?? null,
    acceptance: report?.acceptance ?? null,
    result: report?.result ?? null,
    build: build ? { command: build.command, ok: build.ok, ...(build.head ? { head: build.head } : {}), ...(build.tests ? { tests: build.tests } : {}) } : null,
    elapsedMin: stats ? Math.round(stats.elapsedMs / 60_000) : null,
    costUsd: stats?.costUsd ?? null,
    questions, findings, lastRound: task.syncRound, reviewComments,
    files, undeclared: declared.length === 0, notes, ...(notesError ? { notesError } : {}),
    followUps, dropped,
  };
}

/** What needs a human, worst first: the top of the page and the count on the task card. */
export function acceptanceAlerts(d: AcceptanceData): Alert[] {
  const out: Alert[] = [];
  if (!d.acceptance) out.push({ level: "warn", text: "Lead не прислал таблицу «требование → доказательство»: проверяйте по диффу и итогу интеграции." });
  for (const c of d.acceptance?.criteria ?? []) {
    if (c.status !== "done") out.push({ level: c.status === "not-done" ? "bad" : "warn", text: `${c.status === "not-done" ? "Не сделано" : "Сделано частично"}: ${c.requirement}${c.note ? ` — ${c.note}` : ""}` });
    else if (!c.tests.length) out.push({ level: "warn", text: `Без теста: ${c.requirement}` });
  }
  if (d.task.verifyCommand && !d.build?.ok) out.push({ level: "bad", text: `Последняя сборка lead'а не зелёная: ${d.build?.command ?? "не запускалась"}` });
  const outside = d.files.filter((f) => f.outside);
  if (outside.length) out.push({ level: "bad", text: `Файлы вне соглашения (${outside.length}): ${outside.slice(0, 5).map((f) => f.path).join(", ")}${outside.length > 5 ? " …" : ""}` });
  const code = d.files.filter((f) => !f.test);
  if (code.length && !d.files.some((f) => f.test)) out.push({ level: "warn", text: "Код изменён, а тесты — нет." });
  for (const m of d.notes?.missing ?? []) out.push({ level: "bad", text: `Для раскатки в ${m.env} не задано обязательное ${m.envVar} (${m.key})` });
  for (const q of d.questions.filter((x) => x.answer === null)) out.push({ level: "warn", text: `Решено без вас${q.recommended ? ` («${q.recommended}»)` : ""}: ${firstLine(q.question)}` });
  for (const c of d.reviewComments.filter((x) => x.status === "declined")) out.push({ level: "warn", text: `Lead отклонил ваше замечание к ${c.file}: ${c.text}${c.note ? ` — ${c.note}` : ""}` });
  const warnings = d.findings.filter((f) => f.severity === "WARNING");
  if (warnings.length) out.push({ level: "warn", text: `Предупреждения ревью, которые остались: ${warnings.length}` });
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
}

const firstLine = (s: string): string => {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};
const STATUS_RU = { done: "сделано", partial: "частично", "not-done": "не сделано" } as const;
const short = (c: string | null | undefined): string => (c ? c.slice(0, 7) : "—");

const STYLE = `<style>
.bad{background:#fff1f0}.warn{background:#fffbe6}.ok{background:#f6ffed}
ul.alerts{list-style:none;padding:0}ul.alerts li{padding:6px 10px;border-radius:6px;margin:4px 0}
.facts{display:flex;flex-wrap:wrap;gap:6px 18px;margin:8px 0}.facts span{white-space:nowrap}
td{overflow-wrap:anywhere}td.num{text-align:right;font-family:ui-monospace,monospace;white-space:nowrap}
</style>`;

function section(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

export function renderAcceptancePage(d: AcceptanceData, alerts = acceptanceAlerts(d)): string {
  const t = d.task;
  const facts = [
    d.branch ? `ветка <code>${esc(d.branch)}</code>` : "",
    `коммит <code>${esc(short(d.head))}</code>`,
    t.verifyCommand
      ? `<span class="${d.build?.ok ? "ok" : "bad"}">verify ${d.build?.ok ? "зелёный" : "не зелёный"}${d.build?.tests ? `: тестов ${d.build.tests.total}, упало ${d.build.tests.failed}` : ""}${d.build?.head ? ` на ${esc(short(d.build.head))}` : ""}</span>`
      : "verify не задан",
    `раундов исправлений ${Math.max(0, t.syncRound - 1)} из ${t.maxFixRounds ?? 3}`,
    d.elapsedMin !== null ? `${d.elapsedMin} мин` : "",
    d.costUsd !== null ? `$${d.costUsd.toFixed(2)}` : "",
    t.merged ? (t.merged.reverted ? "влита и откачена" : `влита в ${esc(t.merged.into)}`) : "не влита",
  ].filter(Boolean).map((f) => `<span>${f}</span>`).join("");

  const look = alerts.length
    ? `<ul class="alerts">${alerts.map((a) => `<li class="${a.level}">${inline(a.text)}</li>`).join("")}</ul>`
    : `<p class="ok" style="padding:6px 10px;border-radius:6px">Ничего, что требует вас: все требования сделаны и подтверждены тестами, сборка зелёная, файлы в рамках соглашения.</p>`;

  const asked = d.questions.length
    ? `<table><tr><th>Вопрос агента</th><th>Ответ</th></tr>${d.questions.map((q) => `<tr class="${q.answer === null ? "warn" : ""}"><td>${inline(firstLine(q.question))}</td><td>${q.answer === null ? `без ответа — агент пошёл по своему варианту${q.recommended ? ` «${inline(q.recommended)}»` : ""}` : inline(q.answer.slice(0, 600))}</td></tr>`).join("")}</table>`
    : `<p class="muted">Вопросов вам не было.</p>`;

  const criteria = d.acceptance?.criteria.length
    ? `<table><tr><th>Требование</th><th>Итог</th><th>Тесты</th><th>Код</th></tr>${d.acceptance.criteria.map((c) => `<tr class="${c.status === "done" ? (c.tests.length ? "ok" : "warn") : c.status === "partial" ? "warn" : "bad"}"><td>${inline(c.requirement)}${c.note ? `<br><span class="muted">${inline(c.note)}</span>` : ""}</td><td>${STATUS_RU[c.status]}</td><td>${c.tests.map((x) => `<code>${esc(x)}</code>`).join("<br>") || "—"}</td><td>${c.where.map((x) => `<code>${esc(x)}</code>`).join("<br>") || "—"}</td></tr>`).join("")}</table>`
    : `<p class="muted">Lead не прислал таблицу.</p>`;

  const fixedIn = (round: number) => (round < d.lastRound ? `исправлено в раунде ${round + 1}` : "");
  const reviews = d.findings.length
    ? `<table><tr><th>Раунд</th><th>Кто</th><th>Важность</th><th>Находка</th><th>Чья</th></tr>${d.findings.map((f) => `<tr class="${f.severity === "ERROR" ? (f.round < d.lastRound ? "ok" : "bad") : f.severity === "WARNING" ? "warn" : ""}"><td>${f.round}</td><td>${esc(f.by)}</td><td>${f.severity}${f.severity === "ERROR" && fixedIn(f.round) ? `<br><span class="muted">${fixedIn(f.round)}</span>` : ""}</td><td>${inline(f.description)}${f.files?.length ? `<br><span class="file">${esc(f.files.join(", "))}</span>` : ""}</td><td>${esc(f.relatedAgent ?? "")}</td></tr>`).join("")}</table>`
    : `<p class="muted">Ревьюеры ничего не нашли.</p>`;
  const comments = d.reviewComments.length
    ? `<h3>Ваши замечания к диффу</h3><table><tr><th>Где</th><th>Замечание</th><th>Ответ lead'а</th></tr>${d.reviewComments.map((c) => `<tr class="${c.status === "fixed" ? "ok" : "warn"}"><td><code>${esc(c.file)}${c.line ? `:${c.line}` : ""}</code></td><td>${inline(c.text)}</td><td>${c.status === "fixed" ? "исправлено" : c.status === "declined" ? "отклонено" : "открыто"}${c.note ? `: ${inline(c.note)}` : ""}</td></tr>`).join("")}</table>`
    : "";

  const add = d.files.reduce((n, f) => n + f.added, 0);
  const del = d.files.reduce((n, f) => n + f.deleted, 0);
  const changed = d.files.length
    ? `<p class="muted">Файлов ${d.files.length} (тестов ${d.files.filter((f) => f.test).length}), +${add} −${del}.${d.undeclared ? " В соглашении нет списка файлов: сверять не с чем." : " Красным — файлы, которых нет ни в одном assignment."}</p><table><tr><th>Файл</th><th>+</th><th>−</th></tr>${d.files.map((f) => `<tr class="${f.outside ? "bad" : ""}"><td><code>${esc(f.path)}</code>${f.test ? " <span class=\"muted\">тест</span>" : ""}</td><td class="num">${f.added}</td><td class="num">${f.deleted}</td></tr>`).join("")}</table>`
    : `<p class="muted">Дифф не прочитан: у lead'а нет своей ветки, или она уже удалена.</p>`;

  const n = d.notes;
  const deploy = n
    ? n.properties.length || n.migrations.length || n.topics.length || n.endpoints.length
      ? `${n.properties.length ? `<table><tr><th>Свойство</th><th>Переменная</th><th>По умолчанию</th><th>Окружения</th></tr>${n.properties.map((p) => `<tr class="${p.required && Object.values(p.inEnv).includes(false) ? "bad" : ""}"><td><code>${esc(p.key)}</code>${p.required ? " <b>обязательно</b>" : ""}${p.secret ? " секрет" : ""}</td><td><code>${esc(p.envVar)}</code></td><td>${p.secret ? "—" : esc(p.defaultValue ?? "—")}</td><td>${Object.entries(p.inEnv).map(([e, v]) => `${esc(e)}: ${v === true ? "задано" : v === false ? "нет" : "?"}`).join(", ") || "—"}</td></tr>`).join("")}</table>` : ""}` +
        `${n.migrations.length ? `<p>Миграции: ${n.migrations.map((m) => `<code>${esc(m)}</code>`).join(", ")}</p>` : ""}${n.topics.length ? `<p>Топики: ${n.topics.map((x) => `<code>${esc(x.value)}</code>`).join(", ")}</p>` : ""}${n.endpoints.length ? `<p>Внешние адреса: ${n.endpoints.map((x) => `<code>${esc(x.key)}</code>`).join(", ")}</p>` : ""}`
      : `<p class="muted">Новых свойств, миграций, топиков и внешних адресов нет.</p>`
    : `<p class="muted">Не посчитано${d.notesError ? `: ${esc(d.notesError)}` : ""}.</p>`;

  const checks = d.acceptance?.checks.length
    ? `<ol>${d.acceptance.checks.map((c) => `<li>${inline(c.step)}${c.command ? `<pre>${esc(c.command)}</pre>` : ""}${c.expect ? `<div>Ожидается: ${inline(c.expect)}</div>` : ""}</li>`).join("")}</ol>`
    : `<p class="muted">Lead не описал ручную проверку.</p>`;

  const left = [
    ...(d.acceptance?.risks ?? []).map((r) => `<li class="warn">Риск: ${inline(r.what)}${r.why ? ` — ${inline(r.why)}` : ""}</li>`),
    ...d.dropped.map((x) => `<li>Подзадачу «${inline(x.title)}» (${esc(x.agent)}) отбросили${x.note ? `: ${inline(x.note)}` : ""}</li>`),
    ...d.followUps.map((f) => `<li>Follow-up ${esc(f.id)}: ${inline(f.title)}</li>`),
  ];
  const rest = `${left.length ? `<ul>${left.join("")}</ul>` : `<p class="muted">Рисков, отброшенных подзадач и follow-up нет.</p>`}${d.result ? `<h3>Итог интеграции от lead'а</h3>${markdown(d.result, 3)}` : ""}`;

  const verdict = t.acceptance ? `<p class="muted">Вы ${t.acceptance.status === "accepted" ? "приняли" : "вернули"} задачу ${esc(t.acceptance.at.slice(0, 16).replace("T", " "))}${t.acceptance.followUp ? ` (follow-up ${esc(t.acceptance.followUp)})` : ""}.</p>` : "";

  return page(
    `Приёмка ${t.id}: ${t.title}`,
    `${STYLE}<h1>Приёмка ${esc(t.id)}: ${esc(t.title)}</h1><div class="facts">${facts}</div>${verdict}
${section("На что посмотреть", look)}
${section("Требования → доказательства", criteria)}
${section("Как проверить руками", checks)}
${section("Что просили", `${markdown(t.description, 2)}<h3>Вопросы и ответы</h3>${asked}`)}
${section("Ревью", reviews + comments)}
${section("Что изменилось", changed)}
${section("Для раскатки", deploy)}
${section("Риски и что осталось", rest)}`,
    false,
  );
}
