import { AppError } from "./errors.js";

/**
 * The two review pages of a change-writing task, built by the server from the files: the analysts' input page and the
 * change page. The agent sends only what it alone knows — where the input departs from the project, how each piece of
 * the input is covered, optional Mermaid diagrams — instead of writing a whole HTML page through a tool call (a small
 * model wrote a one-section page, and every page it wrote stayed in its context).
 */

export interface Departure {
  /** Where in the input: a file, a section, file:line. */
  where: string;
  what: string;
  /** The rule or code it departs from: java-conventions, CLAUDE.md, file:line… */
  rule: string;
}

export type CoverageOutcome = "taken" | "adapted" | "dropped" | "added";
export interface Coverage {
  /** The analysts' requirement, scenario or decision ("—" for one they did not have). */
  analyst: string;
  outcome: CoverageOutcome;
  /** Where it is in our change (file, section). */
  where?: string;
  /** Why: the question Qn, the rule, the code. */
  why?: string;
}

export interface PageFile {
  /** Shown as the file's name: openspec/changes/x/design.md, loyalty/proposal.md… */
  name: string;
  text: string;
}

const MAX_DIAGRAMS = 12;
const OUTCOMES: readonly CoverageOutcome[] = ["taken", "adapted", "dropped", "added"];
const OUTCOME_RU: Record<CoverageOutcome, string> = { taken: "взято", adapted: "адаптировано", dropped: "отброшено", added: "добавлено" };

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
}

/** Enough Markdown for OpenSpec artifacts: headings, lists, task checkboxes, tables, code blocks, paragraphs. */
export function markdown(md: string, headingShift = 2): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      closeList();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push(`<pre>${esc(code.join("\n"))}</pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = Math.min(6, h[1]!.length + headingShift);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) {
        const cells = lines[i]!.trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      i--;
      const [head, ...body] = rows;
      out.push(`<table>${head ? `<tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>` : ""}${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    const item = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      const box = /^\[( |x|X)\]\s+(.*)$/.exec(item[3]!);
      out.push(`<li>${box ? `${box[1]!.trim() ? "☑" : "☐"} ${inline(box[2]!)}` : inline(item[3]!)}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

const STYLE = `<style>
body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:1100px;color:#1d1d1f}
h1{font-size:24px;margin:0 0 4px}h2{font-size:20px;margin:30px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
h3{font-size:17px;margin:20px 0 6px}h4,h5,h6{font-size:15px;margin:14px 0 4px}
.muted{color:#666}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f5f5f7}code{background:#f3f3f5;padding:0 3px;border-radius:3px}pre{background:#fafafa;border:1px solid #eee;padding:8px;overflow:auto}
.off{background:#fff1f0}.taken{background:#f6ffed}.adapted{background:#fffbe6}.dropped{background:#fff1f0}.added{background:#e6f4ff}
details{border:1px solid #eee;border-radius:6px;padding:6px 10px;margin:8px 0}summary{cursor:pointer;font-weight:600}
.file{color:#888;font-size:12px;font-family:ui-monospace,monospace}
</style>`;
const MERMAID = `<script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";m.initialize({startOnLoad:true});</script>`;

export function page(title: string, body: string, diagrams: boolean): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>${STYLE}</head><body>${body}${diagrams ? MERMAID : ""}</body></html>`;
}

function diagramsHtml(diagrams: string[] | undefined): string {
  if (!diagrams?.length) return "";
  return diagrams.slice(0, MAX_DIAGRAMS).map((d) => `<pre class="mermaid">${esc(d.trim())}</pre>`).join("\n");
}

export function checkDepartures(raw: unknown): Departure[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new AppError("INVALID_INPUT", "departures: [{where, what, rule}]");
  return raw.map((d, i) => {
    const o = (d ?? {}) as Record<string, unknown>;
    if (typeof o.what !== "string" || !o.what.trim()) throw new AppError("INVALID_INPUT", `departures[${i}].what: what departs from the project`);
    return { where: String(o.where ?? "").slice(0, 200), what: o.what.slice(0, 600), rule: String(o.rule ?? "").slice(0, 300) };
  });
}

export function checkCoverage(raw: unknown): Coverage[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new AppError("INVALID_INPUT", "coverage: [{analyst, outcome: taken|adapted|dropped|added, where, why}]");
  return raw.map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    if (!OUTCOMES.includes(o.outcome as CoverageOutcome)) throw new AppError("INVALID_INPUT", `coverage[${i}].outcome: one of ${OUTCOMES.join(", ")}`);
    return {
      analyst: String(o.analyst ?? "—").slice(0, 300), outcome: o.outcome as CoverageOutcome,
      ...(o.where ? { where: String(o.where).slice(0, 200) } : {}), ...(o.why ? { why: String(o.why).slice(0, 400) } : {}),
    };
  });
}

export function checkDiagrams(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((d) => typeof d === "string")) throw new AppError("INVALID_INPUT", "diagrams: Mermaid sources, e.g. [\"sequenceDiagram\\n  Client->>OrderController: PUT …\"]");
  return (raw as string[]).filter((d) => d.trim()).slice(0, MAX_DIAGRAMS).map((d) => d.slice(0, 6000));
}

/** Page 1: the analysts' artifacts as they are, the departures marked first. */
export function renderInputPage(o: { change: string; input: PageFile[]; departures: Departure[]; diagrams: string[]; note?: string }): string {
  const deps = o.departures.length
    ? `<table><tr><th>Где у них</th><th>Что расходится</th><th>Правило или код</th></tr>${o.departures.map((d) => `<tr class="off"><td>${inline(d.where)}</td><td>${inline(d.what)}</td><td>${inline(d.rule)}</td></tr>`).join("")}</table>`
    : `<p class="muted">Расхождений с кодом и правилами проекта lead не нашёл.</p>`;
  const files = o.input.map((f) => `<section><h2>${esc(f.name)}</h2>${markdown(f.text)}</section>`).join("\n");
  return page(
    `Спека аналитиков: ${o.change}`,
    `<h1>Спека аналитиков: ${esc(o.change)}</h1><p class="muted">Их артефакты как есть. Сначала — где они расходятся с кодом и правилами проекта; вопросы будут на допросе.${o.note ? ` ${inline(o.note)}` : ""}</p>
<h2>Расхождения</h2>${deps}${o.diagrams.length ? `<h2>Поток сценариев (как у них)</h2>${diagramsHtml(o.diagrams)}` : ""}${files}`,
    o.diagrams.length > 0,
  );
}

/** Page 2: our change from its files, next to the analysts' input, with the grilling's decisions and the coverage table. */
export function renderChangePage(o: {
  change: string; files: PageFile[]; input: PageFile[]; coverage: Coverage[]; diagrams: string[];
  decisions: { question: string; answer: string }[]; note?: string;
}): string {
  const order = (n: string) => (/proposal\.md$/.test(n) ? 0 : /\/spec\.md$/.test(n) ? 1 : /design\.md$/.test(n) ? 2 : /tasks\.md$/.test(n) ? 3 : 4);
  const files = [...o.files].sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  const decisions = o.decisions.length
    ? `<table><tr><th>Вопрос</th><th>Ответ оператора</th></tr>${o.decisions.map((d) => `<tr><td>${inline(d.question.split("\n")[0]!.replace(/\*\*/g, "").slice(0, 200))}</td><td>${inline(d.answer.slice(0, 400))}</td></tr>`).join("")}</table>`
    : `<p class="muted">Вопросов оператору не было.</p>`;
  const coverage = o.coverage.length
    ? `<table><tr><th>У аналитиков</th><th>Итог</th><th>Где у нас</th><th>Почему</th></tr>${o.coverage.map((c) => `<tr class="${c.outcome}"><td>${inline(c.analyst)}</td><td>${OUTCOME_RU[c.outcome]}</td><td>${inline(c.where ?? "")}</td><td>${inline(c.why ?? "")}</td></tr>`).join("")}</table>`
    : `<p class="muted">Таблицы покрытия нет.</p>`;
  const counts = OUTCOMES.map((k) => `${OUTCOME_RU[k]} ${o.coverage.filter((c) => c.outcome === k).length}`).join(" · ");
  const ours = files.map((f) => `<section><h2>${esc(f.name)}</h2>${markdown(f.text)}</section>`).join("\n");
  const theirs = o.input.length ? `<h2>Вход аналитиков</h2>${o.input.map((f) => `<details><summary>${esc(f.name)}</summary>${markdown(f.text, 3)}</details>`).join("\n")}` : "";
  return page(
    `Change ${o.change}`,
    `<h1>Change ${esc(o.change)}</h1><p class="muted">Наш change из его файлов рядом со спекой аналитиков.${o.note ? ` ${inline(o.note)}` : ""}</p>
<h2>Решения допроса</h2>${decisions}
<h2>Покрытие спеки аналитиков</h2><p class="muted">${counts}</p>${coverage}${o.diagrams.length ? `<h2>Поток сценариев</h2>${diagramsHtml(o.diagrams)}` : ""}
${ours}${theirs}`,
    o.diagrams.length > 0,
  );
}
