import { AppError } from "./errors.js";
import type { FileStore } from "./storage/fileStore.js";

/**
 * The lead's plan of a task as one HTML page (task.planReview): the lead writes it in DISCUSS, the operator comments on
 * blocks, edits the text in place and answers its questions on the page; propose() waits for the operator's approval.
 * Kept in tasks/<id>/plan/: v<N>.html per version and state.json.
 */

export interface PlanVersion { n: number; by: string; at: string; note?: string; bytes: number }
/** A note on a block of the plan (target: its tag and first words), on selected words of it when quote is set. */
export interface PlanComment { target: string; quote?: string; text: string }
/** Text the operator changed in place: before "" = added (after the block "near"), after "" = removed; kind diagram: a Mermaid diagram's source. */
export interface PlanEdit { before: string; after: string; near?: string; kind?: "diagram" }
/** A question of the plan (an element with data-question) and what the operator picked or wrote. */
export interface PlanAnswer { question: string; value: string[] }
export interface PlanFeedback {
  round: number; at: string;
  /** The version the operator looked at. */
  onVersion: number;
  /** The operator's edits were saved as this version. */
  savedAs?: number;
  comments: PlanComment[]; edits: PlanEdit[]; answers: PlanAnswer[];
  /** Sent with the approval: notes to take into account, not a reason to rewrite. */
  withApproval?: true;
}
export interface PlanState { versions: PlanVersion[]; feedback: PlanFeedback[]; approved?: { version: number; at: string } }
/** none: no plan yet; awaiting: the operator reviews the latest version; revising: the lead has feedback to work in; approved. */
export type PlanStatus = "none" | "awaiting" | "revising" | "approved";

export const MAX_PLAN_BYTES = 300_000;
/** plan({read: true}) returns a page up to this size whole; a bigger one stays out of the lead's context (read by parts). */
export const PLAN_READ_WHOLE = 24_000;

/** The parts of a page around each occurrence of a text (the lead copies the exact text for its edits from them). */
export function planAround(html: string, text: string, pad = 400): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  for (let at = html.indexOf(text); at >= 0 && out.length < 5; at = html.indexOf(text, at + text.length)) {
    out.push({ at, text: html.slice(Math.max(0, at - pad), at + text.length + pad) });
  }
  return out;
}

/** The headings of a page in order: what a big page holds, without the page. */
export function planOutline(html: string): string[] {
  return [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `${"  ".repeat(Number(m[1]) - 1)}${m[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}`).filter((h) => h.trim());
}

export async function readPlanState(fs: FileStore, taskId: string): Promise<PlanState> {
  return (await fs.readJson<PlanState>(["tasks", taskId, "plan", "state.json"])) ?? { versions: [], feedback: [] };
}

export function planStatus(s: PlanState): PlanStatus {
  if (s.approved) return "approved";
  const last = s.versions.at(-1);
  if (!last) return "none";
  // feedback on the latest version (or one the operator's edits produced) is the lead's to work in
  const fb = s.feedback.at(-1);
  return fb && !fb.withApproval && (fb.onVersion === last.n || fb.savedAs === last.n) ? "revising" : "awaiting";
}

/** The plan in brief for the page and the agents. */
export function planBrief(s: PlanState): { status: PlanStatus; version: number | null; by: string | null; at: string | null; approvedVersion: number | null; versions: number; rounds: number } {
  const last = s.versions.at(-1);
  return { status: planStatus(s), version: last?.n ?? null, by: last?.by ?? null, at: last?.at ?? null, approvedVersion: s.approved?.version ?? null, versions: s.versions.length, rounds: s.feedback.filter((f) => !f.withApproval).length };
}

/** find/replace edits on the current version: each find must occur exactly once (like an editor's Edit tool). */
export function applyEdits(html: string, edits: { find: string; replace: string }[]): string {
  let out = html;
  edits.forEach((e, i) => {
    if (typeof e.find !== "string" || !e.find) throw new AppError("INVALID_INPUT", `edits[${i}].find must be the exact text to replace`);
    if (typeof e.replace !== "string") throw new AppError("INVALID_INPUT", `edits[${i}].replace must be a string ("" removes the text)`);
    const at = out.indexOf(e.find);
    if (at < 0) throw new AppError("INVALID_INPUT", `edits[${i}].find is not in the current plan (${JSON.stringify(e.find.slice(0, 80))}): read it with plan({read: true}) (or plan({read: true, around: "<a few words>"}) for a big page) and copy the text exactly, or send the whole page as html`);
    if (out.indexOf(e.find, at + 1) >= 0) throw new AppError("INVALID_INPUT", `edits[${i}].find occurs more than once (${JSON.stringify(e.find.slice(0, 80))}): include more of the surrounding text`);
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  });
  return out;
}

/** A plan is a whole HTML page; anything the review script put into it is taken out before it is saved. */
export function checkPlanHtml(html: string): string {
  const clean = stripSdk(html).trim();
  if (!/<(html|body|h1|h2|section|main|div|p)\b/i.test(clean)) throw new AppError("INVALID_INPUT", "html must be an HTML page (<!doctype html><html>…), self-contained: inline CSS, inline SVG");
  if (Buffer.byteLength(clean) > MAX_PLAN_BYTES) throw new AppError("INVALID_INPUT", `The plan is over ${MAX_PLAN_BYTES / 1000} KB: keep it to what the operator has to decide and check`);
  return clean;
}

export function stripSdk(html: string): string {
  return html.replace(/<(script|style)\b[^>]*\bdata-an-sdk\b[^>]*>[\s\S]*?<\/\1>/gi, "");
}

/** Lines of the feedback message to the lead. */
export function feedbackText(fb: PlanFeedback): string {
  const q = (s: string, n = 160) => JSON.stringify(s.length > n ? `${s.slice(0, n)}…` : s);
  const out: string[] = [];
  if (fb.comments.length) {
    out.push("Comments:");
    fb.comments.forEach((c, i) => out.push(`${i + 1}. on ${c.target}${c.quote ? ` — ${q(c.quote)}` : ""}: ${c.text}`));
  }
  if (fb.edits.length) {
    out.push(`Edited in place${fb.savedAs ? ` (saved as v${fb.savedAs}, the current version: read it with plan({read: true}) before you edit it)` : ""}:`);
    for (const e of fb.edits) {
      if (e.kind === "diagram") {
        out.push(`- the diagram (Mermaid), ${e.before.split("\n").length} lines before, now:\n\`\`\`mermaid\n${e.after}\n\`\`\``);
        continue;
      }
      out.push(!e.before ? `- added${e.near ? ` after ${q(e.near, 60)}` : ""}: ${q(e.after)}` : !e.after ? `- removed: ${q(e.before)}` : `- ${q(e.before)} → ${q(e.after)}`);
    }
  }
  if (fb.answers.length) {
    out.push("Answers:");
    for (const a of fb.answers) out.push(`- ${a.question}: ${a.value.join(", ")}`);
  }
  return out.join("\n");
}

/** What the page posts: the operator's notes, edits and answers, checked and cut to size. */
export function checkFeedback(b: { comments?: unknown; edits?: unknown; answers?: unknown }): Pick<PlanFeedback, "comments" | "edits" | "answers"> {
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 100).map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {})) : []);
  const comments = list(b.comments).map((c) => ({ target: str(c.target, 200) || "the plan", ...(str(c.quote, 600) ? { quote: str(c.quote, 600) } : {}), text: str(c.text, 4000) })).filter((c) => c.text);
  const edits = list(b.edits)
    .map((e) => (e.kind === "diagram" ? { before: str(e.before, 8000), after: str(e.after, 8000), kind: "diagram" as const } : { before: str(e.before, 2000), after: str(e.after, 2000), ...(str(e.near, 200) ? { near: str(e.near, 200) } : {}) }))
    .filter((e) => e.before !== e.after);
  const answers = list(b.answers)
    .map((a) => ({ question: str(a.question, 300), value: (Array.isArray(a.value) ? a.value : [a.value]).map((v) => str(v, 1000)).filter(Boolean).slice(0, 20) }))
    .filter((a) => a.question && a.value.length);
  return { comments, edits, answers };
}

/** The plan page is the lead's HTML: it runs sandboxed, cannot call the page's API, and loads nothing but Mermaid. */
export const PLAN_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts";

export function injectSdk(html: string): string {
  const tag = `<script data-an-sdk>${PLAN_SDK}</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tag}</body>`) : `${html}${tag}`;
}

/**
 * Runs inside the plan's iframe and talks to the page with postMessage (the frame has no origin of its own).
 * Modes: view; comment (a click picks a block, selected words become its quote); edit (the text is contenteditable).
 * collect returns the edits (text of each block before/after), the answers ([data-question]) and the edited page.
 */
const PLAN_SDK = String.raw`(()=>{
const INLINE=new Set("A ABBR B BDI BDO BR CITE CODE DATA DFN EM I KBD MARK Q S SAMP SMALL SPAN STRONG SUB SUP TIME U VAR LABEL IMG INPUT SELECT TEXTAREA BUTTON TSPAN".split(" "));
const norm=s=>(s||"").replace(/\s+/g," ").trim();
let mode="view",picked=null,base=null,edited=false;
// Mermaid diagrams: their source as written (the script runs before Mermaid draws them) and as the operator edits it
const diagrams=[...document.querySelectorAll(".mermaid")];const src0=diagrams.map(e=>e.textContent.replace(/^\n+|\s+$/g,""));const src=[...src0];
const skip=n=>!n.parentElement||n.parentElement.closest("script,style,svg,.mermaid,[data-an-sdk]"); // a diagram is redrawn on load: not text to compare
const blockOf=n=>{let e=n.parentElement;while(e&&e!==document.body&&INLINE.has(e.tagName.toUpperCase()))e=e.parentElement;return e||document.body};
function blocks(doc){const m=new Map();const w=doc.createTreeWalker(doc.body||doc.documentElement,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())){if(!n.nodeValue.trim()||skip(n))continue;const b=blockOf(n);m.set(b,(m.get(b)||"")+n.nodeValue)}
  return [...m].map(([e,t])=>[e,norm(t)]).filter(x=>x[1])}
const st=document.createElement("style");st.setAttribute("data-an-sdk","");
st.textContent=".an-hover{outline:2px solid #6c8cff!important;outline-offset:2px;cursor:pointer!important}.an-picked{outline:2px solid #e8a33d!important;outline-offset:2px}.an-new{box-shadow:inset 3px 0 0 #e8a33d!important;background-color:rgba(232,163,61,.12)!important}body[contenteditable=true]{outline:none}"+
  "svg .an-hover{outline:none!important;filter:drop-shadow(0 0 2px #6c8cff) drop-shadow(0 0 2px #6c8cff)}svg .an-picked{outline:none!important;filter:drop-shadow(0 0 2px #e8a33d) drop-shadow(0 0 3px #e8a33d)}body[contenteditable=true] .mermaid{cursor:pointer}body[contenteditable=true] .mermaid:hover{outline:2px dashed #6c8cff}";
(document.head||document.documentElement).append(st);
const say=m=>parent.postMessage(Object.assign({an:1},m),"*");
// a part of a drawn diagram: a node, an arrow or a label, named by its text
const ARROW=/message|edge|link|flowchart-link|transition|relation/i;
const cls=e=>(e.getAttribute&&e.getAttribute("class"))||"";
function shapeText(e){const own=norm(e.textContent);if(own)return own;
  for(const s of [e.previousElementSibling,e.nextElementSibling])if(s&&s.tagName.toLowerCase()==="text"&&norm(s.textContent))return norm(s.textContent);return ""}
function part(e){const svg=e.closest("svg");if(!svg)return null;
  const g=e.closest("g.node,g.cluster,g.edgeLabel,g.actor-man,g.note,g.statediagram-state");if(g&&svg.contains(g))return g;
  const t=e.closest("text");if(t)return t;
  return shapeText(e)?e:svg}
const describe=e=>{const svg=e.closest&&e.closest("svg");
  if(svg&&e!==svg){const t=shapeText(e).slice(0,80);const c=cls(e)+" "+cls(e.parentElement||e);const arrow=ARROW.test(c)||(e.tagName.toLowerCase()==="line");return "схема: "+(arrow?"стрелка":"узел")+(t?" «"+t+"»":"")}
  if(svg)return "схема"+(norm(svg.textContent)?" «"+norm(svg.textContent).slice(0,60)+"…»":"");
  const t=norm(e.innerText||e.textContent).slice(0,80);return e.tagName.toLowerCase()+(t?" «"+t+"»":"")};
const target=e=>{const p=part(e);if(p)return p;const b=e.closest("h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,pre,blockquote,figcaption,summary,caption,tr,figure,section,article,div");return b&&b!==document.body?b:e};
const ctl=e=>e.closest("input,select,textarea,button,label,[data-question] *");
const unpick=()=>{if(picked)picked.classList.remove("an-picked");picked=null};
document.addEventListener("mouseover",e=>{if(mode!=="comment"||ctl(e.target))return;const b=target(e.target);b.classList.add("an-hover");b.addEventListener("mouseout",()=>b.classList.remove("an-hover"),{once:true})});
document.addEventListener("click",e=>{const a=e.target.closest("a[href]");if(a&&!a.getAttribute("href").startsWith("#"))e.preventDefault();
  const dg=e.target.closest(".mermaid");
  if(mode==="edit"&&dg){e.preventDefault();const i=diagrams.indexOf(dg);if(i>=0)say({type:"diagram",index:i,source:src[i],original:src0[i]});return}
  if(mode!=="comment"||ctl(e.target))return;e.preventDefault();const sel=getSelection();const quote=sel&&!sel.isCollapsed?norm(sel.toString()).slice(0,600):"";
  const b=quote?target(sel.getRangeAt(0).commonAncestorContainer.nodeType===1?sel.getRangeAt(0).commonAncestorContainer:sel.getRangeAt(0).commonAncestorContainer.parentElement):target(e.target);
  unpick();picked=b;b.classList.remove("an-hover");b.classList.add("an-picked");say({type:"pick",target:describe(b),quote})},true);
const mark=()=>{if(!edited){edited=true;say({type:"edited"})}};
document.addEventListener("input",()=>{if(mode==="edit")mark()});
document.addEventListener("change",e=>{if(e.target.closest&&e.target.closest("[data-question]"))say({type:"answered"})});
// redraw a diagram from new source: Mermaid from the CDN the plan may load, errors go back to the editor
let mm=null,seq=0;
async function draw(i,source){const el=diagrams[i];if(!el)return;src[i]=source;mark();
  try{mm=mm||(await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
    const r=await mm.render("an-d"+i+"-"+(++seq),source);el.innerHTML=r.svg;el.setAttribute("data-processed","true");say({type:"diagram-ok",index:i})}
  catch(err){say({type:"diagram-error",index:i,message:String(err&&err.message||err).slice(0,400)});document.querySelectorAll("[id^=dan-d],[id^=an-d]").forEach(x=>{if(!diagrams.some(d=>d.contains(x)))x.remove()})}}
function snapshot(){base=blocks(document)}
function edits(){if(!base)return [];const out=[];const now=blocks(document);const was=new Map(base);const cur=new Map(now);
  for(const [e,t] of base){const n=cur.get(e);if(n===undefined){if(e.isConnected||!now.some(x=>x[1]===t))out.push({before:t,after:""})}else if(n!==t)out.push({before:t,after:n})}
  now.forEach(([e,t],i)=>{if(!was.has(e)&&!base.some(x=>x[1]===t))out.push({before:"",after:t,near:i?now[i-1][1].slice(0,120):""})});
  src.forEach((s,i)=>{if(s!==src0[i])out.push({before:src0[i],after:s,kind:"diagram"})});return out}
function answers(){return [...document.querySelectorAll("[data-question]")].map(q=>{const v=[];
  q.querySelectorAll("input,select,textarea").forEach(i=>{if(i.type==="radio"||i.type==="checkbox"){if(i.checked){const l=i.closest("label");v.push(i.value&&i.value!=="on"?i.value:norm(l?l.innerText:""))}}else if(i.value&&i.value.trim())v.push(i.value.trim())});
  return {question:q.getAttribute("data-question")||norm(q.innerText).slice(0,120),value:v}}).filter(a=>a.value.length)}
function page(){const c=document.documentElement.cloneNode(true);c.querySelectorAll("[data-an-sdk]").forEach(x=>x.remove());
  c.querySelectorAll(".an-hover,.an-picked,.an-new").forEach(x=>x.classList.remove("an-hover","an-picked","an-new"));c.querySelectorAll("[class]").forEach(x=>{if(!x.classList.length&&!/\S/.test(x.getAttribute("class")))x.removeAttribute("class")});
  c.querySelectorAll(".mermaid").forEach((x,i)=>{if(src[i]!==undefined){x.textContent="\n"+src[i]+"\n";x.removeAttribute("data-processed");x.removeAttribute("contenteditable")}});
  const b=c.querySelector("body");if(b)b.removeAttribute("contenteditable");return "<!doctype html>\n"+c.outerHTML}
function diff(prev){document.querySelectorAll(".an-new").forEach(x=>x.classList.remove("an-new"));if(!prev)return 0;
  const doc=new DOMParser().parseFromString(prev,"text/html");const old=new Set(blocks(doc).map(x=>x[1]));let n=0;
  blocks(document).forEach(([e,t])=>{if(!old.has(t)){e.classList.add("an-new");n++}});
  const was=[...doc.querySelectorAll(".mermaid")].map(e=>norm(e.textContent));diagrams.forEach((d,i)=>{if(norm(src0[i])!==(was[i]||"")){d.classList.add("an-new");n++}});return n}
addEventListener("message",ev=>{if(ev.source!==parent)return;const m=ev.data||{};
  if(m.type==="mode"){mode=m.mode;unpick();document.body.contentEditable=mode==="edit"?"true":"false";diagrams.forEach(d=>d.contentEditable=mode==="edit"?"false":"inherit");if(mode==="edit"&&!base)snapshot()}
  else if(m.type==="unpick")unpick();
  else if(m.type==="diagram-set")draw(m.index,String(m.source||""));
  else if(m.type==="diff")say({type:"diffed",count:diff(m.prev)});
  else if(m.type==="collect"){const ed=edits();say({type:"collected",id:m.id,edits:ed,answers:answers(),html:ed.length?page():null})}});
const ready=()=>setTimeout(()=>{snapshot();say({type:"ready",questions:document.querySelectorAll("[data-question]").length,diagrams:diagrams.length})},400);
if(document.readyState==="complete")ready();else addEventListener("load",ready);
})();`;
