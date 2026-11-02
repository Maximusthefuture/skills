/**
 * Страница v2 — «мессенджер с агентами» (рефакторинг UI по ui-mockups/PLAN.md).
 * Single-file, vanilla JS, тот же /api/*, что у v1 (src/ui/page.ts). Подаётся на /v2 (feature-flag);
 * v1 остаётся на /, пока v2 не закроет parity-матрицу.
 * Всё динамическое — через textContent (никогда innerHTML), как в v1.
 */
export const PAGE2_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Network</title>
<style>
/* Agent Network v2 — своя схема: чернильный сайдбар + лайм на костяном фоне (ui-mockups/style.css, ревизия 4) */
:root{
  --bg:#F7F7F4; --panel:#FFFFFF; --line:#E4E4DE;
  --text:#20211F; --muted:#8B8B83;
  --ink:#141518; --ink2:#1E2025; --ink3:#2A2C33; --ink-line:#2E3038;
  --ink-text:#EDEDE8; --ink-muted:#8E9098;
  --lime:#C8F169; --lime-deep:#9BC53D; --lime-soft:#EFF9D9; --lime-text:#5C7A1E;
  --ok:#3FA972; --ok-soft:#E3F3EA;
  --warn:#D29A2E; --warn-soft:#F8EFD9;
  --bad:#DC5A55; --bad-soft:#F9E6E4; --bad-text:#8F3A34;
  --violet:#8B7CF6;
  --radius:12px; --radius-s:8px;
  --shadow:0 1px 2px rgba(32,33,31,.05),0 6px 20px rgba(32,33,31,.05);
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14.5px/1.55 var(--font)}
a{color:var(--lime-text);text-decoration:none}
button{font:inherit;cursor:pointer;border:0;border-radius:10px;padding:8px 16px;background:var(--ink);color:var(--lime);font-weight:600}
button:hover{background:#000}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line);font-weight:500}
button.ghost:hover{border-color:var(--ink)}
button.small{padding:4px 12px;font-size:13px}
button.cta{background:var(--lime);color:var(--ink)}
button.cta:hover{background:var(--lime-deep);color:#fff}
button:disabled{opacity:.5;cursor:default}

.app{display:grid;grid-template-columns:272px minmax(0,1fr);min-height:100vh}

/* ── сайдбар: тёмный, один список ── */
aside{background:var(--ink);color:var(--ink-text);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
.side-top{display:flex;align-items:center;gap:10px;padding:16px 16px 10px}
.logo{width:28px;height:28px;border-radius:9px;background:var(--lime);color:var(--ink);display:grid;place-items:center;font:700 15px var(--mono);flex:none}
.projname{font-weight:650;font-size:14.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.projname small{display:block;font:11px var(--mono);color:var(--ink-muted);font-weight:400}
.icon-btn{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:transparent;color:var(--ink-muted);font-size:15px;flex:none;border:0;padding:0}
.icon-btn:hover{background:var(--ink3);color:var(--ink-text)}
.search{margin:2px 12px 10px;position:relative}
.search input{width:100%;background:var(--ink2);border:1px solid var(--ink-line);border-radius:9px;color:var(--ink-text);font:13px var(--font);padding:7px 10px 7px 30px;outline:0}
.search input::placeholder{color:var(--ink-muted)}
.search input:focus{border-color:var(--lime-deep)}
.search:before{content:"⌕";position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--ink-muted);font-size:14px}
.side-nav{padding:0 8px}
.side-nav a{display:flex;align-items:center;gap:10px;padding:7px 12px;margin:1px 0;border-radius:9px;color:var(--ink-text);font-size:13.5px}
.side-nav a:hover{background:var(--ink2)}
.side-nav a.on{background:var(--ink2);font-weight:600;box-shadow:inset 2px 0 0 var(--lime)}
.side-nav .ic{width:18px;text-align:center;flex:none;color:var(--ink-muted)}
.side-nav a.on .ic{color:var(--lime)}
.side-nav .c{margin-left:auto;font:700 10.5px var(--mono);background:var(--bad);color:#fff;min-width:17px;height:17px;border-radius:9px;display:grid;place-items:center;padding:0 5px}
.side-nav .c.mut{background:var(--ink3);color:var(--ink-muted);font-weight:500}
.side-label{display:flex;align-items:center;padding:16px 16px 5px;font:600 10.5px var(--font);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-muted)}
.side-label .plus{margin-left:auto;color:var(--ink-muted);font-size:14px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400}
.side-label .plus:hover{color:var(--lime)}
/* задача в сайдбаре — строка-чат */
.chat-item{display:flex;gap:10px;padding:8px 12px;margin:1px 8px;border-radius:9px;cursor:pointer;align-items:center;color:var(--ink-text)}
.chat-item:hover{background:var(--ink2)}
.chat-item.on{background:var(--ink3);box-shadow:inset 3px 0 0 var(--lime)}
.chat-item.on .nm{color:var(--lime)}
.chat-item .dot{flex:none}
.chat-item .col{flex:1;min-width:0}
.chat-item .nm{display:block;font-weight:550;font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-item .pv{display:block;color:var(--ink-muted);font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.chat-item .tm{font:10.5px var(--mono);color:var(--ink-muted);flex:none;align-self:flex-start;padding-top:3px}
.chat-item .nudge{font:700 10px var(--mono);background:var(--bad);color:#fff;border-radius:8px;padding:1px 6px;flex:none}
.chat-item.dim:not(.on){opacity:.55}
.dot{width:8px;height:8px;border-radius:50%;background:#5A5C66;display:inline-block;flex:none}
.dot.ok{background:var(--lime)} .dot.warn{background:var(--warn)} .dot.bad{background:var(--bad)} .dot.acc{background:var(--violet)}
.side-foot{margin-top:auto;padding:10px 14px;border-top:1px solid var(--ink-line);display:flex;align-items:center;gap:4px}
.side-foot .who{display:flex;align-items:center;gap:8px;flex:1;min-width:0;font-size:12.5px;color:var(--ink-muted)}
.side-foot .me{width:24px;height:24px;border-radius:8px;background:var(--violet);color:#fff;display:grid;place-items:center;font:600 11px var(--mono);flex:none}
.projpop{position:fixed;z-index:60;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:8px;min-width:240px}
.projpop a{display:flex;gap:8px;padding:7px 10px;border-radius:8px;color:var(--text);font-size:13px}
.projpop a:hover{background:var(--bg)}
.projpop a.on{font-weight:650}
.projpop .note{padding:6px 10px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line);margin-top:4px}

/* ── контент ── */
main{padding:0;min-width:0;display:flex;flex-direction:column}
.wrap{max-width:720px;width:100%;margin:0 auto;padding:36px 28px 80px}
.page-h{font:650 26px/1.25 var(--font);letter-spacing:-.02em;margin:0 0 4px}
.page-sub{color:var(--muted);margin:0 0 26px;font-size:13.5px}
.coord-wrap{display:flex;flex-direction:column;height:100vh;height:100dvh;padding-bottom:24px}
#coord-statusbar{flex:none;margin:0 0 12px}
.coord-guide-det{margin:0 0 4px;font-size:13px;flex:none}
.coord-guide-det>summary{cursor:pointer;color:var(--muted);font-size:12.5px;padding:5px 0;user-select:none}
.coord-guide-det>summary:hover{color:var(--text)}
.coord-guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 12px}
.coord-step{border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:12px 13px;min-width:0}
.coord-step b{display:block;font-size:12.5px;margin-bottom:4px}
.coord-step span{display:block;color:var(--muted);font-size:12px;line-height:1.45}
#project-chat-history{flex:1;min-height:140px;overflow-y:auto;padding:12px 2px 4px;scrollbar-gutter:stable}
.coord-compose{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:14px;margin-top:12px;flex:none}
.coord-compose label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}
.coord-compose textarea{min-height:76px}
.coord-status{font-size:12.5px;color:var(--muted);margin:0 0 12px}
.coord-proposal{border:1px solid var(--violet);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);padding:16px 18px;margin:0 0 12px}
.coord-proposal .coord-status{margin:10px 0}
.coord-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.coord-toolbar .coord-status{margin:0}
.coord-thread{display:grid;gap:14px;margin:0 0 14px}
.coord-turn{display:grid;gap:8px}
.coord-bubble{max-width:88%;border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:12px 15px;box-shadow:var(--shadow)}
.coord-bubble.user{justify-self:end;background:#F0F5E5;border-color:#D9E7BD;border-bottom-right-radius:4px;color:#20211F}
.coord-bubble.user .coord-meta{color:#667248}
.coord-bubble.assistant{justify-self:start;border-bottom-left-radius:4px}
.coord-meta{font-size:11px;font-weight:650;color:var(--muted);margin-bottom:4px}
.coord-message{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.coord-result{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.coord-error{border-left:3px solid var(--bad);background:var(--bad-soft);padding:9px 11px;border-radius:0 8px 8px 0;color:var(--bad-text)}
.coord-error p{margin:0}
.coord-error details{margin-top:6px;font-size:12px;color:var(--muted)}
.coord-error pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.45 var(--mono);margin:6px 0 0;color:var(--text)}
.coord-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.coord-section-title{font-size:14px;margin:22px 0 10px}
.coord-empty{padding:14px;border:1px dashed var(--line);border-radius:11px;color:var(--muted);background:rgba(255,255,255,.5)}
.coord-disclosure{border:1px solid var(--line);border-radius:11px;background:var(--panel);margin:10px 0;overflow:hidden;flex:none}
.coord-disclosure>summary{display:flex;align-items:center;gap:10px;list-style:none;cursor:pointer;padding:12px 14px;font-size:13px;font-weight:600;color:var(--text);user-select:none}
.coord-disclosure>summary::-webkit-details-marker{display:none}
.coord-disclosure>summary:before{content:"";width:7px;height:7px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;flex:none}
.coord-disclosure[open]>summary:before{transform:rotate(45deg)}
.coord-disclosure>summary:hover{background:var(--bg)}
.coord-disclosure>summary:focus-visible{outline:2px solid var(--violet);outline-offset:-3px}
.coord-disclosure[open]>summary{border-bottom:1px solid var(--line)}
.coord-disclosure>form,.coord-disclosure>pre,.coord-disclosure>.coord-guide{margin:0;padding:14px}
.coord-disclosure>pre{font:12px/1.6 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);max-height:280px;overflow:auto}
.coord-disclosure>form{display:grid;gap:10px}
.coord-disclosure>form label{font-size:12px;font-weight:600}
.coord-disclosure>form button{justify-self:start}
.coord-task-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--line)}
.coord-task-row:last-child{border-bottom:0}
.coord-task-info{flex:1;min-width:160px;display:grid;gap:4px}
.coord-task-info>a{font-size:13px;font-weight:600;color:var(--text);overflow-wrap:anywhere}
.coord-task-info .page-sub{font-size:11.5px;margin:0}
.coord-task-row button{flex:none}
.plugin-guide{padding:4px 16px 16px;font-size:13px;line-height:1.6}
.plugin-guide h3{font-size:14px;margin:18px 0 6px}
.plugin-guide p{margin:6px 0;color:var(--muted)}
.plugin-guide pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;font:12px/1.6 var(--mono);color:var(--text)}
@media(max-width:680px){.coord-guide{grid-template-columns:1fr}.coord-step{padding:10px 12px}}
.sect-h{font:650 15px var(--font);margin:34px 0 10px;display:flex;align-items:center;gap:8px}
.sect-h .n{font:600 11px var(--mono);color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:1px 7px}

/* карточка «нужно решение» — одна мысль, одно действие */
.need{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px;margin-bottom:12px;position:relative;overflow:hidden}
.need:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px}
.need.q:before{background:var(--warn)} .need.plan:before{background:var(--violet)}
.need.blocked:before{background:var(--bad)} .need.accept:before{background:var(--ok)} .need.merge:before{background:var(--bad)} .need.note2:before{background:var(--violet)}
.need .k{font:650 10.5px var(--font);letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px;color:var(--muted)}
.need h3{margin:0 0 3px;font-size:15px;font-weight:650;letter-spacing:-.01em}
.need .body{color:var(--muted);font-size:13px}
.need .opts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.need .meta{margin-top:10px;font-size:11.5px;color:var(--muted)}
.need .meta b{color:var(--bad);font-weight:600}

/* лента */
.feed-item{display:flex;gap:12px;padding:9px 4px;border-bottom:1px solid var(--line);font-size:13px;align-items:baseline}
.feed-item:last-child{border:0}
.feed-item .tm{font:11px var(--mono);color:var(--muted);flex:none;width:44px}
.feed-item .who{font-weight:600;flex:none;min-width:64px}

/* бейджи и прогресс */
.badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;border:1px solid var(--line);color:var(--muted);background:var(--panel)}
.badge.ok{color:var(--ok);border-color:#BFE0CE;background:var(--ok-soft)}
.badge.warn{color:var(--warn);border-color:#EAD9AE;background:var(--warn-soft)}
.badge.bad{color:var(--bad);border-color:#EFC4C1;background:var(--bad-soft)}
.badge.acc{color:var(--violet);border-color:#D5CDFB;background:#F1EEFE}
.badge.lime{color:var(--lime-text);border-color:var(--lime-deep);background:var(--lime-soft)}
.pbar{height:4px;border-radius:2px;background:var(--line);overflow:hidden;display:flex}
.pbar i{display:block;height:100%;background:var(--lime-deep)}
.pbar i.b{background:var(--violet)}
.pbar i.r{background:var(--bad)}

/* ── чат задачи ── */
.chat-head{position:sticky;top:0;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:12px 24px;z-index:5}
.chat-head .wrap2{max-width:720px;margin:0 auto;display:flex;align-items:center;gap:12px}
.chat-head .back{color:var(--muted);font-size:16px;flex:none;cursor:pointer}
.chat-head h1{font:650 15.5px var(--font);letter-spacing:-.01em;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-head .sub{font-size:11.5px;color:var(--muted);display:flex;gap:8px;align-items:center;margin-top:2px;flex-wrap:wrap}
.menu-btn{width:30px;height:30px;border-radius:8px;background:transparent;color:var(--muted);font-size:17px;border:0;padding:0;display:grid;place-items:center}
.menu-btn:hover{background:var(--panel);color:var(--text)}
.chat-head .pbar{margin-top:10px}
.chat-body{max-width:720px;margin:0 auto;width:100%;padding:24px 24px 12px;flex:1}
.daydiv{display:flex;align-items:center;gap:12px;color:var(--muted);font:650 10.5px var(--font);letter-spacing:.08em;text-transform:uppercase;margin:22px 0 14px}
.daydiv:before,.daydiv:after{content:"";flex:1;height:1px;background:var(--line)}
.sysline{text-align:center;color:var(--muted);font-size:11.5px;margin:10px 0}
.msg{display:flex;gap:10px;margin-bottom:14px;max-width:92%}
.msg.me{margin-left:auto;flex-direction:row-reverse}
.msg .av{width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;font:650 11.5px var(--mono);background:var(--ink);color:var(--lime)}
.msg .av.rv{background:var(--violet);color:#fff}
.msg.me .av{background:var(--lime);color:var(--ink)}
.msg .bubble{background:var(--panel);border:1px solid var(--line);border-radius:3px 13px 13px 13px;padding:11px 15px;box-shadow:var(--shadow);min-width:0}
.msg.me .bubble{background:var(--ink);color:var(--ink-text);border-color:transparent;border-radius:13px 3px 13px 13px}
.msg .who2{font-size:11.5px;color:var(--muted);margin-bottom:3px;font-weight:650}
.msg.me .who2{color:var(--lime);text-align:right}
.msg .txt{font-size:13.5px;white-space:pre-wrap;word-break:break-word}
.msg .tm2{font-size:10.5px;color:var(--muted);margin-top:5px}
.msg.me .tm2{color:var(--ink-muted)}
/* вопрос с вариантами — прямо в пузыре */
.qchips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.qchip{padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--bg);font-size:12.5px;color:var(--text);cursor:pointer}
.qchip:hover{border-color:var(--ink)}
.qchip.rec{background:var(--lime-soft);border-color:var(--lime-deep);color:var(--lime-text);font-weight:650}
.qcomment{width:100%;min-height:38px;margin-top:8px;font:12.5px var(--font);border:1px solid var(--line);border-radius:8px;padding:6px 9px;resize:vertical;background:var(--bg);color:var(--text)}
.qchip.sel{background:var(--lime-soft);border-color:var(--lime-deep);color:var(--lime-text);font-weight:650}
.qdismiss{margin-left:auto;background:transparent;border:0;color:var(--muted);font-size:11.5px;text-decoration:underline;padding:6px 4px}
/* карточки-действия и прогресс в чате */
.action-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin:0 0 14px 40px;max-width:calc(92% - 40px)}
.action-card h4{margin:0 0 5px;font-size:13.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.action-card p{margin:0 0 9px;color:var(--muted);font-size:12.5px}
.action-card .opts{display:flex;gap:7px;flex-wrap:wrap}
.action-card .tm2{font-size:10.5px;color:var(--muted);margin-top:6px}
.action-card .find-row{display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:12.5px;margin:0}
.action-card details summary{cursor:pointer;font-size:12px;color:var(--muted);margin-top:4px}
.progress-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px 16px;margin:0 0 14px 40px;max-width:calc(92% - 40px)}
.progress-card .prow{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:12.5px}
.progress-card .prow b{flex:none;min-width:72px}
.progress-card .pbar{flex:1}
.progress-card .cnt{flex:none;font:11px var(--mono);color:var(--muted)}
.ctxline{display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted);margin:0 0 12px 40px;max-width:calc(92% - 40px)}
.ctxline a{color:var(--violet);text-decoration:none;font-weight:600}
/* утилиты, которых не хватало из v1 */
.muted{color:var(--muted)}
.small{font-size:12px}
.note{font-size:12px;color:var(--muted)}
.note.bad{color:var(--bad)}

/* оверлеи: план и приёмка (полный экран; iframe + боковая панель; механика v1) */
.planov{position:fixed;inset:0;z-index:50;background:var(--bg);display:flex;flex-direction:column}
.planov[hidden]{display:none}
body.noscroll{overflow:hidden}
.planhead{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.planhead b{font-weight:650;overflow-wrap:anywhere;min-width:0;flex:1 1 200px}
.planhead select{width:auto;margin-left:auto;font:12.5px var(--font);border:1px solid var(--line);border-radius:8px;padding:4px 8px;background:var(--panel);color:var(--text)}
.planbody{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-rows:minmax(0,1fr);min-height:0}
.planbody iframe{width:100%;height:100%;border:0;background:#fff}
.planside{border-left:1px solid var(--line);padding:12px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:10px;background:var(--bg)}
.planside textarea{width:100%;font:13px var(--font);border:1px solid var(--line);border-radius:9px;padding:7px 10px}
.planside .small{font-size:12px}
.planside>*{flex-shrink:0}
.win{display:inline-flex;border:1px solid var(--line);border-radius:9px;overflow:hidden;align-self:flex-start}
.win button{background:none;border:0;border-radius:0;color:var(--muted);font:12px var(--font);padding:5px 12px;font-weight:500}
.win button.on{background:var(--lime-soft);color:var(--lime-text);font-weight:650}
.pnote{font-size:13px}
.pquote{font-style:italic;color:var(--muted);font-size:12.5px}
.plist b{font-size:13px}
.pitem{border:1px solid var(--line);border-radius:9px;padding:6px 8px;background:var(--panel);position:relative;margin-top:6px;font-size:13px}
.pitem>button{position:absolute;top:2px;right:2px}
.pdiag textarea{font:12px/1.4 var(--mono);white-space:pre;min-height:180px}
.pdiag .dst{font-size:12px;margin:4px 0}
.pdiag .dst.bad{color:var(--bad)}
.pconfirm{border:1px solid var(--violet);background:#F1EEFE;border-radius:9px;padding:8px 10px;font-size:13px}
.pconfirm div{margin-bottom:6px}
.pqs b{font-size:13px}
.pqs .qcard{border:1px solid var(--line);border-radius:9px;background:var(--panel);margin:6px 0 0;padding:8px;font-size:13px}
.pact summary{cursor:pointer;font-size:12.5px}
.pstep{font-size:12px;margin:3px 0;overflow-wrap:anywhere}
.pstep.err{color:var(--bad)}
.pcritic{border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--panel);font-size:13px}
.prisk{border-top:1px solid var(--line);padding:6px 0;margin-top:6px}
.prisk .psug{color:var(--violet)}
.prisk button{margin-top:4px}
.psent{border:1px solid var(--ok);background:var(--ok-soft);border-radius:9px;padding:8px 10px;font-size:13px}
.ppick{border:1px solid #D5CDFB;background:#F1EEFE;border-radius:9px;padding:8px}
.pdiff{display:flex;gap:6px;align-items:center;font-size:13px}
.pdiff input{width:auto;margin:0}
.pactions{padding-top:4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pfoot{position:sticky;bottom:-12px;margin-top:auto;background:var(--bg);padding:8px 0 12px;display:flex;flex-direction:column;gap:8px}
.phist summary{cursor:pointer;font-size:12.5px}
@media (max-width:860px){.planbody{grid-template-columns:1fr;grid-template-rows:55vh minmax(0,1fr)}.planside{border-left:0;border-top:1px solid var(--line)}}

/* drawer «Подробности» справа: фазы, расход, коммиты, OpenSpec, замечания, цепочка, активность */
.underlay{filter:blur(2px);opacity:.5;pointer-events:none;min-height:100vh}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(480px,100vw);background:var(--bg);border-left:1px solid var(--line);box-shadow:-12px 0 40px rgba(20,21,24,.12);z-index:45;display:flex;flex-direction:column}
.dhead{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
.dhead h2{font:650 16px var(--font);margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dhead .back{font-size:16px;color:var(--violet)}
.dbody{flex:1;overflow-y:auto;padding:6px 18px 60px}
.dsec{margin:18px 0}
.dsec h3{font:650 11px var(--font);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px;display:flex;align-items:center;gap:10px}
.dsec h3 a{font-weight:400;text-transform:none;letter-spacing:0}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:3px 0}
.kv .k{color:var(--muted)}
.kv .v{font-family:var(--mono);font-size:11.5px;text-align:right}
.phase-tl{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px}
.phase-tl .seg{font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--muted)}
.phase-tl .seg.past{background:var(--lime-soft);border-color:var(--lime-deep);color:var(--lime-text)}
.phase-tl .seg.now{background:var(--ink);border-color:var(--ink);color:var(--lime);font-weight:650}
.commit{display:grid;grid-template-columns:64px minmax(0,1fr) 40px;gap:10px;font-size:12px;padding:4px 0;align-items:baseline}
.commit .h{font-family:var(--mono);color:var(--violet);font-size:11px}
.commit .m{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.commit .t{font:10.5px var(--mono);color:var(--muted);text-align:right}
.review-item{border:1px solid var(--line);border-radius:9px;background:var(--panel);padding:7px 10px;font-size:12.5px;margin-top:6px}
.review-item .st2{font-weight:650}
.review-item.open .st2{color:var(--warn)}
.review-item.fixed .st2{color:var(--ok)}
.review-item.declined .st2{color:var(--muted)}
.review-item .rn{color:var(--muted);font-size:12px}
.costbar{height:5px;border-radius:3px;background:var(--line);overflow:hidden;margin:6px 0 2px}
.costbar i{display:block;height:100%;background:var(--lime-deep)}
.costbar.near i{background:var(--warn)}
.costbar.over i{background:var(--bad)}
.drawer .act-row{border-radius:8px;border:1px solid var(--line);margin-bottom:4px;cursor:default}
.logbox2{max-height:180px;overflow:auto;background:var(--ink);color:var(--ink-text);border-radius:9px;padding:8px 10px;font:11px/1.5 var(--mono);white-space:pre-wrap;word-break:break-word}
.progress-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px 16px;margin:0 0 14px 40px;max-width:calc(92% - 40px);font-size:12.5px}
.progress-card .row{display:flex;align-items:center;gap:10px;margin-top:7px}
.progress-card .row .nm{width:78px;font-weight:600;flex:none}
.progress-card .row .st{font-size:11.5px;color:var(--muted)}
/* поле ввода */
.composer{position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 35%);padding:12px 24px 20px}
.composer .box{max-width:720px;margin:0 auto;display:flex;gap:8px;align-items:flex-end;background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:8px 8px 8px 15px;box-shadow:var(--shadow)}
.composer .box:focus-within{border-color:var(--lime-deep)}
.composer textarea{flex:1;border:0;outline:0;resize:none;background:transparent;font:13.5px var(--font);color:var(--text);max-height:110px}
.composer button{border-radius:10px;padding:7px 13px;font-size:13px}
.composer .urgent.on{background:var(--warn-soft);border-color:var(--warn);color:var(--warn)}
.composer .note{margin:6px auto 0;max-width:720px;font-size:11px;color:var(--muted)}

/* агенты: компактные строки */
.agent-row{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:center}
.agent-row .av{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font:650 13px var(--mono);background:var(--ink);color:var(--lime);flex:none}
.agent-row .av.v{background:var(--violet);color:#fff}
.agent-row h3{margin:0;font-size:14px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.agent-row .now{color:var(--muted);font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}
.context-meter{display:flex;align-items:center;gap:8px;margin-top:7px;max-width:340px;color:var(--muted);font:11px var(--mono)}
.context-meter .pbar{flex:1;min-width:60px;height:5px}
.context-meter .pbar i.warn{background:var(--warn)}
.context-meter .pbar i.over{background:var(--bad)}
.context-meter .empty{font:11.5px var(--font)}
.agent-row .acts{margin-left:auto;display:flex;gap:6px;flex:none}
.agent-detail{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 18px;margin:-4px 0 12px;font-size:13px}
.agent-detail .row3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:10px}
.agent-detail label{display:grid;gap:4px;font-size:11.5px;color:var(--muted)}
.agent-detail select,.agent-detail input{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 9px}
.skill-tag{font:600 10px var(--mono);color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:0 5px;margin-left:6px}
.logbox{max-height:260px;overflow:auto;background:var(--ink);color:var(--ink-text);border-radius:10px;padding:10px 14px;font:11.5px/1.5 var(--mono);white-space:pre-wrap;word-break:break-word;margin-top:8px}

/* новая задача */
.newbox{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:18px;margin-bottom:14px}
.newbox:focus-within{border-color:var(--lime-deep)}
.newbox textarea{width:100%;border:0;outline:0;resize:vertical;min-height:110px;font:14.5px/1.6 var(--font);background:transparent;color:var(--text)}
.newbox .hint{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:11px;display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.hint-chip{border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12px;color:var(--muted);cursor:pointer;background:transparent}
.hint-chip:hover{border-color:var(--ink);color:var(--text)}
details.adv{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);margin-bottom:14px}
details.adv summary{padding:12px 16px;cursor:pointer;font-weight:600;font-size:13px;list-style:none;color:var(--muted)}
details.adv summary::-webkit-details-marker{display:none}
details.adv .in{padding:0 16px 14px;display:grid;gap:11px}
details.adv label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
details.adv input,details.adv select,details.adv textarea{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 10px;width:100%}
.drafter{border:1px dashed var(--violet);border-radius:12px;padding:14px 18px;margin-bottom:14px;background:var(--panel)}
.drafter .st{display:flex;align-items:center;gap:10px;font-size:13px}
.drafter .spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--violet);animation:sp 0.9s linear infinite;flex:none}
@keyframes sp{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.drafter .spin{animation:none}}

/* плагины: прототип */
.plugins-wrap{max-width:900px}
.plugin-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.plugin-demo-note{padding:10px 13px;border:1px solid var(--violet);border-radius:10px;background:color-mix(in srgb,var(--violet) 6%,var(--panel));color:var(--muted);font-size:12px;margin-bottom:16px}
.plugin-install{margin-bottom:18px}.plugin-install button{justify-self:start}
.plugin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.plugin-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow);display:flex;flex-direction:column;min-width:0}
.plugin-card.off{opacity:.72}.plugin-card:hover{border-color:var(--lime-deep)}
.plugin-top{display:flex;gap:11px;align-items:flex-start}.plugin-main{min-width:0;flex:1}
.plugin-icon{width:38px;height:38px;flex:none;display:grid;place-items:center;border-radius:11px;background:var(--ink);color:var(--lime);font:700 18px var(--mono)}
.plugin-title{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.plugin-title h3{font-size:14px;margin:0}.plugin-version{font:11px var(--mono);color:var(--muted)}
.plugin-desc{font-size:12.5px;line-height:1.5;color:var(--muted);margin:8px 0 10px}.plugin-meta{font-size:11px;color:var(--muted)}
.plugin-components{display:flex;gap:5px;flex-wrap:wrap;margin:14px 0}.plugin-components span{font:10.5px var(--mono);padding:3px 7px;border-radius:6px;background:var(--bg);border:1px solid var(--line);color:var(--muted)}
.plugin-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto}.plugin-actions .ghost:last-child{color:var(--bad);margin-left:auto}
.plugin-detail{width:min(620px,100%);max-height:85vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.3)}
.plugin-detail-head{display:flex;align-items:center;gap:12px}.plugin-detail-head>div{flex:1}.plugin-detail h2{margin:0;font-size:20px}.plugin-detail h3{font-size:13px;margin:24px 0 8px}
.plugin-file{border-top:1px solid var(--line);padding:10px 0;display:grid;gap:3px}.plugin-file code{font:12px var(--mono);color:var(--lime-text);overflow-wrap:anywhere}.plugin-file span{font-size:11.5px;color:var(--muted)}
.plugin-security{font-size:11.5px;line-height:1.5;color:var(--muted);padding:9px 11px;background:var(--bg);border-radius:8px}
@media(max-width:700px){.plugin-grid{grid-template-columns:1fr}.plugin-heading{display:block}}

/* простые таблицы и история */
.tbl{width:100%;border-collapse:collapse;font-size:13px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.tbl th{font:650 10.5px var(--font);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);text-align:left;padding:9px 14px;border-bottom:1px solid var(--line);background:var(--bg)}
.tbl td{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:last-child td{border-bottom:0}
.tbl tr:hover td{background:#FBFBF9}
.tbl .mono{font-family:var(--mono);font-size:12px}
.filters2{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.filters2 select,.filters2 input{font:13px var(--font);color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:6px 10px;width:auto;min-width:130px}
.act-row{display:grid;grid-template-columns:46px 90px minmax(0,1fr);gap:10px;padding:7px 14px;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer;background:var(--panel)}
.act-row:hover{background:#FBFBF9}
.act-row .tm{font:11px var(--mono);color:var(--muted)}
.act-row .kind{font:600 11px var(--mono)}
.act-row .kind.tool{color:var(--violet)} .act-row .kind.ok{color:var(--ok)} .act-row .kind.err{color:var(--bad)} .act-row .kind.think{color:var(--muted)}
.act-row .sum{font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.panel2{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);overflow:hidden}
.panel2 .ph2{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line);font-weight:650;font-size:13.5px}
.panel2 .ph2 .end{margin-left:auto;font:400 11px var(--mono);color:var(--muted)}
.tabs2{display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid var(--line);padding-bottom:0}
.tabs2 a{padding:8px 14px;font-size:13px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs2 a.on{color:var(--text);font-weight:650;border-bottom-color:var(--lime-deep)}
.count{font:700 11px var(--mono);color:var(--bad)}
.mergebar{display:flex;align-items:center;gap:10px;background:var(--lime-soft);border:1px solid var(--lime-deep);border-radius:10px;padding:10px 14px;margin-top:10px;font-size:13px;flex-wrap:wrap}
.mergebar .st{font-weight:650;color:var(--lime-text)}
.cat-note{max-width:720px;margin:18px auto 0;padding:10px 16px;border:1px dashed var(--lime-deep);border-radius:10px;font-size:12.5px;color:var(--muted)}
.kpi2{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.kpi2 .k2{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px}
.kpi2 .k2 .l{font:650 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.kpi2 .k2 .v{font:650 19px var(--mono);margin-top:3px}
.kpi2 .k2 .v small{font-size:11px;color:var(--muted);font-weight:400}

/* расписания и проекты (#28, #31) */
.sub-h{font-size:15px;margin:22px 0 10px}
.spad{padding:14px 4px}
.sched-head{display:flex;justify-content:flex-end;margin:4px 0 10px;min-height:28px}
.srow{display:grid;grid-template-columns:26px minmax(0,1.6fr) minmax(0,1fr) minmax(0,.9fr) minmax(0,1.4fr) auto;gap:12px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-s);padding:10px 14px;margin-bottom:8px}
.srow.off{opacity:.55}
.srow .nm b{display:block;font-size:13.5px}
.srow .nm span,.srow .sub2{display:block;font-size:11.5px;color:var(--muted)}
.srow .cr{font:12px var(--mono)}
.srow .last{font-size:12px}
.srow .last.err{color:var(--bad)}
.srow .last.skip{color:var(--muted)}
.srow .sacts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.sform{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px;display:grid;gap:10px;margin-bottom:14px}
.sform>label{display:grid;gap:4px;font-size:12.5px;color:var(--muted)}
.sform input,.sform select,.sform textarea{font:13px var(--font);color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 10px}
.sform textarea{min-height:70px;resize:vertical}
.sform .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sform .row3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px}
.chk{display:inline-flex;flex-direction:row;align-items:center;gap:6px}
.checks{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.checks .chk{font-size:13px}
@media(max-width:760px){.srow{grid-template-columns:26px 1fr}.srow .sacts{justify-content:flex-start}.sform .row2,.sform .row3{grid-template-columns:1fr}}
.tbl .path{font-size:11px;overflow-wrap:anywhere}
.tbl tr.sel td{background:var(--lime-soft)}
.tbl td .checks{margin-top:4px}
.addproj{display:flex;gap:10px;align-items:center;margin-top:18px;flex-wrap:wrap}
.addproj input{font:13px var(--font);color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:7px 10px;min-width:280px}
.nw{white-space:nowrap}

/* наблюдатель и раскатка (#28, #30) */
.obs-head{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;margin-bottom:14px}
.chip{padding:1px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--line);font-size:12px;display:inline-flex}
.kpi2 .k2 .h{font-size:11px;color:var(--muted);margin-top:3px}
.oprop{padding:12px 14px;border-top:1px solid var(--line)}.oprop.decided{opacity:.7}
.obs-card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}
.orow{display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px;margin-top:6px;font-size:13px}
.orow .lbl{font:10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding-top:2px}
.oissue{padding:8px 14px;border-top:1px solid var(--line);font-size:13px}.oissue .badge{margin-right:6px}
.orep{border-top:1px solid var(--line)}.orep summary{padding:8px 14px;cursor:pointer;font-size:13px}
.omd{white-space:pre-wrap;padding:6px 14px 12px;font-size:13px;line-height:1.55}
.note.ok{color:var(--ok)}
.more>summary{cursor:pointer;font-size:13px;color:var(--muted)}
.more .full{white-space:pre-wrap;font-size:13px;margin:4px 0 8px}
@media(max-width:820px){.orow{grid-template-columns:1fr}}
.akinds{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:12px 14px 0}
.akinds button.on{background:var(--ink);color:var(--lime)}
.akinds .kcount{font:700 10.5px var(--mono);margin-left:4px;opacity:.8}
.dcard{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-s);padding:12px 14px;margin:10px}
.dhead-row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
.dend{display:flex;gap:6px;align-items:center}
.step{padding:3px 0;font-size:13px}
.step.now{font-weight:650}
.step.past{color:var(--muted)}
.dsetform{display:grid;gap:10px;padding:14px}
.dsetform h3{font-size:13px;margin:14px 0 2px}
.dsetform>label{display:grid;gap:4px;font-size:12.5px;color:var(--muted)}
.dsetform input,.dsetform textarea{font:13px var(--font);color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 10px}
.dsetform textarea{min-height:60px;resize:vertical}
.dsetform .lead{font-size:12px;color:var(--muted)}
.dsetform td input{width:100%;font:12px var(--font);border:1px solid var(--line);border-radius:6px;padding:4px 6px}
.dsetform .tbl{margin-bottom:6px}
.dsetform details summary{cursor:pointer;font-size:13px;color:var(--muted);padding:6px 0}

/* надзор (#27) */
.need{border-left:3px solid var(--bad)}
.need .hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.need .rec{margin-top:6px;padding:6px 10px;background:var(--bg);border-radius:6px;font-size:12.5px}
.need .row2{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
.need textarea{width:100%;margin-top:8px;min-height:70px;font:13px var(--font);color:var(--text);border:1px solid var(--line);border-radius:9px;padding:8px 10px}
.jrow{display:grid;grid-template-columns:58px 90px 76px 74px minmax(0,1fr);gap:10px;align-items:baseline;padding:6px 12px;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer}
.jrow:hover{background:#FBFBF9}
.jrow .tm,.jrow .by{color:var(--muted);font:11px var(--mono);white-space:nowrap}
.jrow .tk{font:11px var(--mono);color:var(--lime-text);white-space:nowrap;cursor:pointer}
.jrow .txt{white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.jrow.open .txt{display:block}
.jk{font:11px var(--mono);white-space:nowrap}
.jk.incident{color:var(--warn)}.jk.action{color:var(--lime-text)}.jk.needs-you{color:var(--bad);font-weight:600}.jk.session{color:var(--violet)}.jk.note{color:var(--text)}
.jrow.resolved .txt{color:var(--muted)}.jrow.resolved .jk.needs-you{color:var(--muted);font-weight:400}
.jsess{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font:11px var(--mono);color:var(--muted);min-width:0}
.jsess span{overflow-wrap:anywhere}
pre.jlog{grid-column:1/-1;max-height:420px;margin:0;white-space:pre-wrap;font:11px/1.5 var(--mono);background:var(--ink);color:var(--ink-text);border-radius:9px;padding:8px 10px;overflow:auto;cursor:text}
.rules{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;font-size:12px;margin-top:8px}
.rules .rulecap{color:var(--muted)}
.rules b{font:12px var(--mono);font-weight:500;text-align:right;white-space:nowrap}
.rules input{width:64px;padding:2px 6px;font:12px var(--mono);text-align:right;border:1px solid var(--line);border-radius:6px;color:var(--text)}
.rules .row2{display:flex;gap:8px;align-items:center;margin-top:4px;grid-column:1/-1}
.tl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 10px;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer}
.tl:last-child{border:0}
.tl .nm{font:12px var(--mono)}
.tl .ds{grid-column:2;font-size:12px;color:var(--muted)}
.tl.off .nm{color:var(--muted);text-decoration:line-through}
.inst{display:flex;gap:8px;align-items:center;margin-top:6px}
.inst select{font:13px var(--font);border:1px solid var(--line);border-radius:9px;padding:6px 10px;background:var(--panel);color:var(--text)}
.ph2 .akinds{padding:0;margin:0 0 0 8px}
.sfeed{max-height:520px;overflow:auto}
.spad2{padding:12px 14px}
.sup-log{margin-top:16px;font-size:13px}
.sup-log summary{cursor:pointer;color:var(--muted)}
.sup-log .logbox2{margin-top:8px;max-height:420px}
@media(max-width:700px){.jrow{grid-template-columns:56px 74px minmax(0,1fr)}.jrow .by{display:none}.jrow .txt{grid-column:1/-1}}

/* diff-оверлей (#10) */
.diffov{position:fixed;inset:0;z-index:70;background:var(--bg);display:flex;flex-direction:column}
.dfo-head{display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
.dfo-head h2{margin:0;font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfo-body{flex:1;overflow:auto;padding:16px 20px 40px}
.diff{max-width:1100px}
.dbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.dbar select{width:auto;font:13px var(--font);border:1px solid var(--line);border-radius:9px;padding:6px 10px;background:var(--panel);color:var(--text)}
.dcommits{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px 12px;font:11.5px/1.6 var(--mono);margin:8px 0;max-height:180px;overflow:auto}
.dfile{background:var(--panel);border:1px solid var(--line);border-radius:9px;margin-bottom:8px}
.dfile summary{padding:8px 12px;cursor:pointer;font-size:13px;display:flex;gap:8px;align-items:center}
.dadd{color:var(--ok);font-weight:600}
.ddel{color:var(--bad);font-weight:600}
.dpad{padding:8px 12px}
.dpatch{display:block;font:12px/1.5 var(--mono);white-space:pre;overflow:auto;max-height:560px;padding:8px 0;margin:0}
.dpatch .dhunk{display:block;background:var(--bg);color:var(--muted)}
.dpatch .dln{display:inline-block;width:44px;text-align:right;margin-right:10px;color:var(--muted);user-select:none;font-style:normal}
.dpatch .dadd{background:var(--ok-soft)}
.dpatch .ddel{background:var(--bad-soft)}
.dpatch .dclick{cursor:pointer}
.dpatch .dclick:hover{outline:1px solid var(--lime-deep);outline-offset:-1px}
.dcm{display:block;background:var(--warn-soft);border-left:3px solid var(--warn);padding:4px 10px;margin:2px 0 2px 54px;font:12px/1.5 var(--font);white-space:normal}
.dcm.sent.fixed{background:var(--ok-soft);border-left-color:var(--ok)}
.dcm.sent.declined{background:var(--bg);border-left-color:var(--muted);color:var(--muted)}
.dcm button{float:right;padding:0 6px}
.dcomment{display:block;margin:4px 0 4px 54px}
.dcomment textarea{width:100%;min-height:52px;font:12.5px var(--font);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-bottom:4px}
.dcomment button{margin-right:6px}

/* тосты */
.toasts{position:fixed;top:12px;right:12px;z-index:80;display:flex;flex-direction:column;gap:8px;width:min(340px,calc(100vw - 24px));pointer-events:none}
.toast{pointer-events:auto;cursor:pointer;position:relative;background:var(--panel);color:var(--text);border:1px solid var(--line);border-left:4px solid var(--violet);border-radius:10px;padding:9px 30px 9px 12px;box-shadow:var(--shadow);font-size:13px;animation:tin .18s ease-out}
.toast.ok{border-left-color:var(--ok)}.toast.warn{border-left-color:var(--warn)}.toast.bad{border-left-color:var(--bad)}
.toast b{display:block;margin-bottom:2px}
.toast .x{position:absolute;top:4px;right:8px;border:0;background:none;color:var(--muted);font-size:16px;line-height:1;cursor:pointer;padding:2px}
@keyframes tin{from{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){.toast{animation:none}}

/* диалог */
.askov{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px}
.askbox{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;max-width:460px;white-space:pre-line;box-shadow:0 8px 30px rgba(0,0,0,.25);width:100%}
.askbox textarea{width:100%;margin-top:8px}
.askbox .row2{display:flex;gap:8px;margin-top:12px}

@media(max-width:820px){
  .app{grid-template-columns:1fr}
  aside{position:static;height:auto;max-height:45vh}
  .chat-item .tm{display:none}
  .msg{max-width:100%}
  .action-card,.progress-card{margin-left:0;max-width:100%}
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#17181A; --panel:#1E2023; --line:#2C2E33;
    --text:#E8E8E3; --muted:#9A9A90;
    --ink:#101114; --ink2:#1A1C20; --ink3:#26282E; --ink-line:#30333A;
    --ink-text:#EDEDE8; --ink-muted:#8E9098;
    --lime:#C8F169; --lime-deep:#A8D24E; --lime-soft:#2A3316; --lime-text:#BFE06A;
    --ok:#6CC48E; --ok-soft:#1E2E24;
    --warn:#E0B054; --warn-soft:#332A15;
    --bad:#E87B74; --bad-soft:#38211F; --bad-text:#F0A8A2;
    --violet:#A99BF8;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25);
  }
  .tbl tr:hover td,.act-row:hover{background:#232529}
  .projpop a:hover{background:#232529}
}
:focus-visible{outline:2px solid var(--lime-deep);outline-offset:2px;border-radius:6px}
</style>
</head>
<body>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="app">
<aside>
  <div class="side-top">
    <span class="logo">◆</span>
    <span class="projname"><span id="projname">…</span><small id="projsub"></small></span>
    <button class="icon-btn" id="proj-switch" title="Сменить проект">⇄</button>
  </div>
  <div class="search"><input id="search" placeholder="Поиск по задачам…" aria-label="Поиск по задачам"></div>
  <div class="side-nav">
    <a id="nav-project" href="#/project"><span class="ic">◇</span>Координатор проекта</a>
    <a id="nav-inbox" href="#/inbox"><span class="ic">◉</span>Нужно мне<span class="c" id="c-att" hidden></span></a>
  </div>
  <div class="side-label">Задачи<span class="plus" id="newtask-plus" title="Создать задачу вручную, без координатора" role="button" tabindex="0" aria-label="Создать задачу вручную, без координатора">＋</span></div>
  <div id="tasklist" role="list"></div>
  <div class="side-label">Ещё</div>
  <div class="side-nav">
    <a id="nav-agents" href="#/agents"><span class="ic">◐</span>Агенты<span class="c mut" id="c-agents" hidden></span></a>
    <a id="nav-history" href="#/history/activity"><span class="ic">▦</span>Архив и история</a>
  </div>
  <div class="side-foot">
    <span class="who"><span class="me" id="me-initial">О</span><span id="me-name">operator</span></span>
    <button class="icon-btn" id="bell" title="Уведомления">◔</button>
    <button class="icon-btn" id="settings-btn" title="Настройки">⚙</button>
  </div>
</aside>
<main>
  <div id="banner" class="cat-note" role="alert" hidden style="margin:18px 28px 0"></div>
  <div id="main"></div>
</main>
</div>
<script>
"use strict";
/* v2: «мессенджер с агентами». Тот же API, что v1: /api/state, /api/attention, /api/tasks… */
const PHASE_NAMES={DISCUSS:"Согласование",IMPLEMENT:"Выполнение",SYNC:"Проверка",INTEGRATE:"Сведение результата",DONE:"Готово"};
const PHASES=["DISCUSS","IMPLEMENT","SYNC","INTEGRATE","DONE"];
const ATT_KIND={question:"Вопрос",plan:"План",acceptance:"Приёмка",merge:"Вливание",blocked:"Остановлена",supervisor:"Надзор",observer:"Наблюдатель"};
const HINTS=["Отмена заказа через API","Миграция: новая таблица","Починить падающий тест","OpenSpec change по тикету"];
const $=id=>document.getElementById(id);
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function dot(cls){return el("span","dot"+(cls?" "+cls:""))}
function badge(v,text){return el("span","badge "+v,text===undefined?v:text)}
function plural(n,one,few,many){const a=n%10,b=n%100;return a===1&&b!==11?one:a>=2&&a<=4&&(b<12||b>14)?few:many}
function ago(iso){const s=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(s<60)return "только что";if(s<3600)return Math.round(s/60)+" мин назад";if(s<86400)return Math.round(s/3600)+" ч назад";return Math.round(s/86400)+" дн назад"}
function time(iso){return new Date(iso).toLocaleTimeString([],{hour12:false}).slice(0,5)}
function dayOf(iso){return new Date(iso).toLocaleDateString([],{day:"numeric",month:"long"})}
function fmtUsd(n,est){return (est?"≈ ":"")+"$"+n.toFixed(n<1?3:2)}
function mins(ms){return ms<60000?"<1 мин":ms<3600000?Math.round(ms/60000)+" мин":(ms/3600000).toFixed(1).replace(".0","")+" ч"}
function count(shown,total){return total>shown?"последние "+shown+" из "+total:String(shown)}
function td(text,cls){return el("td",cls,text)}
function theadRow(names){const r=el("tr");names.forEach(nm2=>r.append(el("th","",nm2)));return r}
function longText(text,key,limit){text=text||"";if(text.length<=limit)return el("div","txt",text);
  const d=el("details","more");d.dataset.key=key;const sm=el("summary");sm.append(el("span","pv",text.slice(0,limit).replace(/\s+\S*$/,"")+"… "),el("span","tg","раскрыть"));d.append(sm,el("div","full",text));return d}
function fmtTok(n){return n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+"M":n>=1e3?Math.round(n/1e3)+"k":String(n)}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
async function getJSON(path){const r=await fetch(path,{cache:"no-store"});if(!r.ok)throw new Error(r.status+"");return r.json()}
async function post(url,body){const r=await fetch(q(url),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})});const t=await r.text();let j;try{j=JSON.parse(t)}catch(e){j={message:t}}if(!r.ok)throw new Error(j.message||t);return j}
/* вопрос вместо confirm(): некоторые клиенты отвечают сами */
function ask(text,input){return new Promise(done=>{const o=el("div","askov");o.setAttribute("role","dialog");const b=el("div","askbox");b.append(el("div","",text));
  const f=input?document.createElement("textarea"):null;if(f){f.rows=2;f.placeholder=input;f.style.width="100%";b.append(f)}
  const r=el("div","row2");const yes=el("button","","Да");yes.type="button";const no=el("button","ghost","Отмена");no.type="button";
  const ok=()=>f?f.value.trim():true;
  const end=v=>{o.remove();removeEventListener("keydown",key,true);done(v)};const key=e=>{if(e.key==="Escape"){e.stopPropagation();end(false)}else if(e.key==="Enter"&&(!f||e.metaKey||e.ctrlKey)){e.preventDefault();end(ok())}};
  yes.onclick=()=>end(ok());no.onclick=()=>end(false);o.onclick=e=>{if(e.target===o)end(false)};addEventListener("keydown",key,true);
  r.append(yes,no);b.append(r);o.append(b);document.body.append(o);(f||yes).focus()})}
function toast(kind,title,text,taskId){const box=$("toasts");const d=el("div","toast "+kind);d.setAttribute("role","status");d.title="открыть задачу";
  d.append(el("b","",title),el("div","",text&&text.length>220?text.slice(0,220)+"…":text||""));
  const x=el("button","x","×");x.type="button";x.title="закрыть";x.onclick=e=>{e.stopPropagation();d.remove()};d.append(x);
  d.onclick=()=>{d.remove();if(taskId)go("tasks",taskId)};box.prepend(d);
  while(box.children.length>4){const all=[...box.children];(all.reverse().find(x2=>!x2.classList.contains("bad"))||all[0]).remove()}
  if(kind!=="bad")setTimeout(()=>d.remove(),8000);
  return d}

/* ── роутер: #/inbox · #/tasks/<id> · #/new · #/agents · #/history/<tab> · #/settings/<sub> ── */
const ROUTES=["project","inbox","tasks","new","agents","history","settings"];
let route=parseHash();
function parseHash(){const parts=location.hash.replace(/^#\/?/,"").split("/").map(x=>decodeURIComponent(x));
  const name=ROUTES.includes(parts[0])?parts[0]:"inbox";
  return {name,task:name==="tasks"&&parts[1]?parts[1]:null,
    tab:name==="history"?(["activity","runs","events"].includes(parts[1])?parts[1]:"activity"):null,
    sub:name==="settings"?(parts[1]||""):null}}
function go(name,task){let h="#/"+name;if(name==="tasks"&&task)h+="/"+encodeURIComponent(task);if(name==="history")h+="/"+(route.tab||"activity");location.hash=h;if(location.hash===h)render()}
addEventListener("hashchange",()=>{route=parseHash();if(DRAWER)closeDrawer();render();if(route.name==="new")CHANGES=null});

/* проект текущей страницы (?project=<id>, как в v1) */
let project=new URLSearchParams(location.search).get("project");
function q(path){return project?path+(path.includes("?")?"&":"?")+"project="+encodeURIComponent(project):path}
function switchProject(id){if(id===project)return;project=id;const u=new URL(location.href);u.searchParams.set("project",id);history.replaceState(null,"",u);
  ATT=null;seenTasks.clear();tasklistSig="";tick()}

/* ── состояние и опрос ── */
let S=null,ATT=null,PROJ=[],PROJK=[],PROJ_CAN=false,projBusy=null,CHANGES=null,RUNS=[],ACT=[],controlMode=false,n=0,actAfter=0;
async function tick(){try{
  const s=await getJSON(q("/api/state"));S=s;controlMode=!!s.control;
  const bb=$("banner");if(bb&&!bb.hidden&&bb.textContent==="нет связи с сервером")bb.hidden=true;
  if(!project&&s.project)project=s.project.id;
  ATT=await getJSON("/api/attention").catch(()=>ATT);
  if(!PROJ.length||n%3===0){const pj=await getJSON("/api/projects").catch(()=>null);if(pj){PROJ=pj.projects||[];PROJK=pj.known||[];PROJ_CAN=!!pj.canOpen}}
  if(route.name==="new"&&CHANGES===null)CHANGES=(await getJSON(q("/api/openspec/changes"))).changes||[];
  if(route.name==="history"&&route.tab==="runs"&&!RUNS.length)RUNS=(await getJSON(q("/api/runs"))).runs;
  if(route.name==="history"&&route.tab==="activity")await fetchActivity();
  if(route.name==="agents")await fetchActivity();
  if(route.name==="settings"&&route.sub==="observer")OBS=(await getJSON(q("/api/observer")).catch(()=>null))||OBS;
  if(route.name==="settings"&&route.sub==="deploy")DEP=(await getJSON(q("/api/deploys")).catch(()=>null))||DEP;
  if(route.name==="settings"&&route.sub==="supervisor")SUP=(await getJSON(q("/api/supervisor"+(supAll?"?all=1":""))).catch(()=>null))||SUP;
  watchSupervisor(s);
  n++;watchTransitions(s);render();planSync();if(DRAWER)renderDrawer();
}catch(e){const b=$("banner");b.hidden=false;b.textContent="нет связи с сервером"}}
async function fetchActivity(){const d=await getJSON(q("/api/activity?after="+actAfter+"&limit=300")).catch(()=>null);
  if(d){ACT=d.events&&d.events.length?ACT.concat(d.events):ACT;actAfter=d.lastSeq||actAfter;if(ACT.length>600)ACT=ACT.slice(-600)}}
setInterval(tick,3000);

/* смена фазы/статуса → тост (механика v1, визуал v2) */
const seenTasks=new Map();let seenProject=null;
function phaseName(t){return (PHASE_NAMES[t.phase]||t.phase)+(t.phase==="SYNC"&&t.syncRound?" #"+t.syncRound:"")}
function phaseLabel(t){return t.phase==="IMPLEMENT"&&t.syncRound>0?"Выполнение · исправления #"+t.syncRound:phaseName(t)}
function watchTransitions(s){if(seenProject!==s.project.id){seenProject=s.project.id;seenTasks.clear();s.tasks.forEach(t=>seenTasks.set(t.id,t));return}
  for(const t of s.tasks){const p=seenTasks.get(t.id);seenTasks.set(t.id,t);if(!p){toast("",t.id+": новая задача",t.title,t.id);continue}
    if(t.status!==p.status){
      if(t.status==="BLOCKED")toast("bad",t.id+": остановлена",(t.blockedReason||"")+(t.handover?" · ждём вас до "+time(t.handover.dueAt):""),t.id);
      else if(t.status==="COMPLETED")toast("ok",t.id+": готово",t.title,t.id);
      else if(t.status==="CANCELLED")toast("",t.id+": отменена",t.title,t.id);
      else if(p.status==="BLOCKED")toast("warn",t.id+": снова в работе",phaseName(t),t.id);
      continue}
    if(t.phase!==p.phase||t.syncRound!==p.syncRound){const back=t.phase==="IMPLEMENT"&&(p.phase==="SYNC"||p.phase==="INTEGRATE");
      toast(back?"warn":"",t.id+": "+phaseName(p)+" → "+phaseName(t),back?"Нашли ошибки: раунд исправлений "+t.syncRound+" из "+t.maxFixRounds:t.title,t.id)}}}

/* ── общие данные: прогресс и «ждёт вас» ── */
function progressOf(t){const subs=Object.values(t.subtasks||{}).flat().filter(x=>x.status!=="DROPPED");const done=subs.filter(x=>x.status==="DONE");
  const res={subs:{done:done.length,doing:subs.filter(x=>x.status==="DOING").length,total:subs.length},os:null};
  const o=t.openspec;if(o&&o.assigned&&o.assigned.length){const nums=new Set(o.assigned.flatMap(a=>a.tasks));const rep=new Set(o.assigned.flatMap(a=>a.done).filter(x2=>nums.has(x2)));
    res.os={total:nums.size,reported:rep.size}}
  res.share=res.os&&res.os.total?res.os.reported/res.os.total:res.subs.total?res.subs.done/res.subs.total:null;
  const ph=t.phase;res.overall=ph==="DONE"?1:ph==="INTEGRATE"?0.9:ph==="SYNC"?0.75:ph==="IMPLEMENT"?0.1+0.6*(t.syncRound>0?1:(res.share||0)):0.05;
  return res}
function attentionOf(id){if(!ATT)return[];const p=ATT.projects.find(x=>x.id===(project||""))||ATT.projects[0];return p?p.items.filter(i=>i.taskId===id):[]}
function needsYou(t){return attentionOf(t.id).some(i=>["question","blocked","plan","acceptance","merge"].includes(i.kind))}
function firstQuestion(t){const q2=(t.questions||[]).find(x2=>!x2.answered);return q2?q2.question.split("\n")[0]:""}
function taskPreview(t){
  if(t.status==="BLOCKED"){const why=t.blockedBy==="cost"?"лимит $"+t.maxCostUsd:(t.blockedBy==="rounds"?"кончились раунды исправлений":"остановлена");return "остановлена · "+why+(t.handover?" · решить до "+time(t.handover.dueAt):"")}
  if(t.status==="COMPLETED")return t.merged?"принята · влита в проект":(t.acceptance?"принята":(needsYou(t)?"приёмка: ждёт вас":"готово"));
  if(t.status==="CANCELLED")return "отменена";
  const pr=progressOf(t);const pct=pr.share!==null?Math.round(pr.share*100)+"%":null;
  const q2=firstQuestion(t);
  if(q2)return "ждёт ответа: "+(q2.length>42?q2.slice(0,42)+"…":q2);
  if(t.plan&&t.plan.status==="awaiting")return "план ждёт утверждения";
  if(t.queue==="queued")return phaseLabel(t).toLowerCase()+" · в очереди";
  return phaseLabel(t).toLowerCase()+(pct?" · "+pct:"")}
function taskDot(t){return t.status==="BLOCKED"?"bad":needsYou(t)?"warn":t.status==="COMPLETED"||t.status==="CANCELLED"?"":"ok"}

/* ── хром: шапка сайдбара, бейджи, баннер ── */
function renderChrome(){
  const s=S;if(!s)return;
  const p=PROJ.find(x=>x.id===(project||""));
  $("projname").textContent=s.project.name;
  $("projsub").textContent=[p&&p.git?p.git.branch+" · "+p.git.head:"не git",s.project.count+" "+plural(s.project.count,"проект","проекта","проектов")].join(" · ");
  const attTotal=ATT?ATT.projects.reduce((a2,x2)=>a2+x2.items.length,0):0;
  const ca=$("c-att");ca.hidden=!attTotal;ca.textContent=attTotal?String(attTotal):"";
  const rs=s.control?s.control.runners:[];
  const cg=$("c-agents");cg.hidden=!rs.length;cg.textContent=rs.length?rs.filter(r=>r.running).length+"/"+rs.length:"";
  const pe=$("banner");pe.hidden=!(s.prices&&s.prices.error);pe.textContent=s.prices&&s.prices.error?"prices в runners.json не читаются (действуют прежние): "+s.prices.error:"";
  document.title=(attTotal?"("+attTotal+") ":"")+s.project.name+" · Agent Network";
  for(const id of["nav-inbox","nav-agents","nav-history"]){const a=$(id);a.classList.toggle("on",(id==="nav-inbox"&&route.name==="inbox")||(id==="nav-agents"&&route.name==="agents")||(id==="nav-history"&&route.name==="history"))}}

/* ── сайдбар: лента задач как чаты ── */
let tasklistSig="";
function renderSidebar(){
  const s=S,box=$("tasklist"),search=$("search").value.trim().toLowerCase();
  const attIds=new Set(ATT?(ATT.projects.find(x=>x.id===(project||""))||{items:[]}).items.map(i=>i.taskId):[]);
  const rank=t=>{if(t.status==="BLOCKED"&&t.handover)return 0;if(t.status==="BLOCKED")return 1;if(attIds.has(t.id))return 2;
    if(t.status==="ACTIVE")return t.queue==="running"?3:4;if(t.status==="COMPLETED")return 5;return 6};
  const list=s.tasks.filter(t=>!search||t.title.toLowerCase().includes(search)||t.id.toLowerCase().includes(search))
    .sort((a,b)=>rank(a)-rank(b)||Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const sig=JSON.stringify([project,search,route.name,route.task,list.map(t=>[t.id,t.title,t.status,t.phase,t.syncRound,t.updatedAt,t.queue,taskPreview(t),rank(t)])]);
  if(sig===tasklistSig&&box.childElementCount)return;tasklistSig=sig; // не перестраиваем под мышью и при печати в поиске
  box.replaceChildren();
  if(!list.length){const e2=el("div","pv",search?"Ничего не найдено.":"Задач пока нет — создайте первую кнопкой ＋");e2.style.cssText="padding:8px 20px;color:var(--ink-muted);font-size:12.5px";box.append(e2);return}
  for(const t of list){const a=el("a","chat-item"+(route.name==="tasks"&&route.task===t.id?" on":"")+(t.status==="COMPLETED"||t.status==="CANCELLED"?" dim":""));
    a.href="#/tasks/"+encodeURIComponent(t.id);a.setAttribute("role","listitem");
    if(route.name==="tasks"&&route.task===t.id)a.setAttribute("aria-current","page");
    a.append(dot(taskDot(t)));
    const col=el("span","col");col.append(el("span","nm",t.title||t.id),el("span","pv",taskPreview(t)));a.append(col);
    if(attIds.has(t.id))a.append(el("span","nudge","вы"));
    a.append(el("span","tm",ago(t.updatedAt)));
    box.append(a)}}

/* ── «Нужно мне» (#/inbox) ── */
function openAttention(i){if(i.taskId)go("tasks",i.taskId);else render()}
function renderInbox(){
  const w=$("main");const wrap=el("div","wrap");
  const total=ATT?ATT.projects.reduce((a2,x2)=>a2+x2.items.length,0):0;
  wrap.append(el("h1","page-h","Нужно ваше решение"));
  wrap.append(el("p","page-sub",total?plural(total,"Ждёт %d вещь","Ждут %d вещи","Ждёт %d вещей").replace("%d",String(total))+". Остальное агенты делают сами.":"Ничего не ждёт вашего решения."));
  if(ATT){for(const p of ATT.projects){if(ATT.projects.length>1&&p.items.length)wrap.append(el("div","sect-h",p.name+" "+el("span","n",String(p.items.length)).textContent));
    for(const i of p.items)wrap.append(needCard(p.id,i))}}
  /* что происходит — живая лента событий */
  const evs=S.tasks.flatMap(t=>(t.events||[]).map(e2=>({...e2,taskId:t.id}))).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,8);
  wrap.append(el("div","sect-h","Что происходит "+el("span","n","живое").textContent));
  if(!evs.length)wrap.append(el("p","page-sub","Событий пока нет."));
  for(const e of evs){const r=el("div","feed-item");r.append(el("span","tm",time(e.createdAt)),el("span","who",e.sourceAgent||"система"),el("span","",e.taskId+" · "+e.type+(e.targetAgent?" → "+e.targetAgent:"")));wrap.append(r)}
  w.replaceChildren(wrap)}
/* одна карточка «нужно решение» по типу */
function needCard(projectId,i){
  const cls={question:"q",plan:"plan",blocked:"blocked",merge:"merge",acceptance:"accept",supervisor:"note2",observer:"note2"}[i.kind]||"q";
  const card=el("div","need "+cls);
  const task=i.taskId?String(i.taskId):"";
  const head=el("div","k",(ATT_KIND[i.kind]||i.kind)+(task?" · "+task:"")+(i.due?" · ждёт до "+time(i.due):""));card.append(head);
  const h3=el("h3","",i.title.replace(/^[^:]+:\s*/,""));card.append(h3);
  if(i.text)card.append(el("div","body",i.text));
  const meta=el("div","meta","ждёт с "+time(i.since)+(i.due?(i.kind==="question"?" · без ответа агент пойдёт по своему варианту в ":" · не решите к ")+time(i.due):""));
  const opts=el("div","opts");
  if(i.kind==="question")questionOpts(opts,i);
  else if(i.kind==="blocked")blockedOpts(opts,i);
  else if(i.kind==="acceptance"){const b=el("button","cta small","Принять");b.type="button";b.onclick=async()=>{b.disabled=true;try{const r=await post("/api/tasks/"+encodeURIComponent(task)+"/acceptance/accept",{});toast("ok",task+": приёмка",r.task&&r.task.merged?"влито в проект":"принято",task)}catch(e){toast("bad",task+": не принято",e.message,task)}await tick()};
    const open=el("button","ghost small","Критерии и замечания");open.type="button";open.onclick=()=>go("tasks",task);
    opts.append(b,open)}
  else if(i.kind==="plan"){const b=el("button","ghost small","Открыть план");b.type="button";b.onclick=()=>go("tasks",task);opts.append(b)}
  else{const b=el("button","ghost small","Открыть");b.type="button";b.onclick=()=>openAttention(i);opts.append(b)}
  if(opts.childElementCount)card.append(opts);
  card.append(meta);
  return card}
/* вопрос: чипы прямо в карточке (answer/dismiss/своё) */
function questionOpts(opts,i){
  const s=S;const q2=s&&s.openQuestions.find(x2=>x2.taskId===i.taskId&&!x2.answered);
  const done=el("span");opts.append(done);
  const finish=(label)=>{opts.replaceChildren(el("span","badge lime","вы выбрали: "+label))};
  if(!q2){const b=el("button","ghost small","Открыть");b.type="button";b.onclick=()=>go("tasks",i.taskId);opts.append(b);return}
  const answer=async(label)=>{try{await post("/api/questions/answer",{taskId:i.taskId,messageId:q2.messageId,answer:label});finish(label)}catch(e){toast("bad","Не отправлено",e.message,i.taskId)}await tick()};
  const ch=q2.choices;
  if(ch&&Array.isArray(ch.options)&&ch.options.length){for(const o of ch.options){const label=typeof o==="string"?o:o.label;
    const c=el("button","ghost small"+(ch.recommended===label?" rec":""),label);c.type="button";c.onclick=()=>answer(label);opts.append(c)}}
  else{const ta=el("input","qcomment");ta.placeholder="Ответ одной строкой…";ta.style.cssText="flex:1;min-width:180px;font:13px var(--font);border:1px solid var(--line);border-radius:9px;padding:7px 10px";
    const b=el("button","small","Ответить");b.type="button";b.onclick=()=>{const v=ta.value.trim();if(v)answer(v)};
    opts.append(ta,b)}
  const own=el("button","ghost small","Своё…");own.type="button";own.onclick=async()=>{const v=await ask("Свой ответ для "+q2.from+" («"+q2.question.slice(0,120)+"»)","ответ");if(v)answer(typeof v==="string"?v:"да")};opts.append(own);
  const dis=el("button","ghost small","Закрыть без ответа");dis.type="button";dis.onclick=async()=>{try{await post("/api/questions/dismiss",{taskId:i.taskId,messageId:q2.messageId});finish("закрыто без ответа")}catch(e){toast("bad","Не закрыто",e.message,i.taskId)}await tick()};opts.append(dis)}
/* blocked: три сценария — лимит денег / раунды / runner сдался */
function blockedOpts(opts,i){
  const s=S;const t=s&&s.tasks.find(x2=>x2.id===i.taskId);const task=i.taskId;
  if(!t){const b=el("button","ghost small","Открыть");b.type="button";b.onclick=()=>go("tasks",task);opts.append(b);return}
  const act=(body,label)=>{return async()=>{try{await post("/api/tasks/"+encodeURIComponent(task)+"/unblock",body);toast("ok",task+": снова в работе",label,task)}catch(e){toast("bad",task+": не вышло",e.message,task)}await tick()}};
  if(t.blockedBy==="cost"){for(const usd of[5,10,25]){const b=el("button","ghost small","+$"+usd);b.type="button";b.onclick=act({usd:usd},"лимит $"+(t.maxCostUsd+0)+" → +$"+usd);opts.append(b)}
    const custom=el("button","small","Своя сумма…");custom.type="button";custom.onclick=async()=>{const v=await ask("На сколько поднять лимит? Потрачено $"+((t.stats&&t.stats.costUsd)||0).toFixed(2)+", лимит $"+t.maxCostUsd+".","сумма, $");const usd=Number(v);if(usd>0)act({usd:usd},"лимит +$"+usd)()};opts.append(custom)}
  else if(t.blockedBy==="rounds"){const plus=el("button","cta small","+1 раунд");plus.type="button";plus.onclick=act({rounds:1},"раунд "+(t.maxFixRounds+1));opts.append(plus);
    for(const r of[2,3]){const b=el("button","ghost small","+"+r);b.type="button";b.onclick=act({rounds:r},"+ "+r+" раунда");opts.append(b)}
    const ho=el("button","ghost small","Отдать lead'у");ho.type="button";ho.onclick=async()=>{try{await post("/api/tasks/"+encodeURIComponent(task)+"/handover",{});toast("ok",task+": у lead'а","исправление передано "+t.agents[0],task)}catch(e){toast("bad","Не вышло",e.message,task)}await tick()};opts.append(ho)}
  else{const retry=el("button","cta small","Попробовать снова");retry.type="button";retry.onclick=act({rounds:1},"ещё один раунд");opts.append(retry)}
  const aside=el("button","ghost small","Отложить");aside.type="button";aside.onclick=async()=>{const v=await ask("Отложить "+task+"? Её агенты возьмут следующую задачу, вернутся, когда вы разберётесь.","причина");if(!v)return;
    try{await post("/api/tasks/"+encodeURIComponent(task)+"/set-aside",{reason:typeof v==="string"&&v?v:"отложено оператором"});toast("ok",task+": отложена","агенты взяли следующие задачи",task)}catch(e){toast("bad","Не вышло",e.message,task)}await tick()};
  const cancel=el("button","ghost small","Отменить задачу");cancel.type="button";cancel.onclick=async()=>{if(!await ask("Отменить "+task+" («"+t.title+"») совсем? Агенты прекратят работу."))return;
    try{await post("/api/tasks/"+encodeURIComponent(task)+"/cancel",{});toast("",task+": отменена",t.title,task)}catch(e){toast("bad","Не вышло",e.message,task)}await tick()};
  opts.append(aside,cancel)}

/* ── чат задачи (#/tasks/<id>) ── */
function taskById(id){return S&&S.tasks.find(t=>t.id===id)}
function renderTask(){
  const t=taskById(route.task);const main=$("main");
  if(!t){main.replaceChildren(el("div","wrap",el("p","page-sub","Нет такой задачи — возможно, её удалили.")));return}
  const lead=t.agents[0];
  const signature=JSON.stringify(t),previousHead=main.querySelector(".chat-head");
  if(previousHead?.dataset.taskSignature===signature)return;
  const previousComposer=main.querySelector(".composer"),keepComposer=previousComposer?.dataset.taskId===t.id?previousComposer:null;
  const scrollY=window.scrollY;
  const wasBottom=window.innerHeight+window.scrollY>=document.body.scrollHeight-40;
  for(const child of [...main.children])if(child!==keepComposer)child.remove();
  /* шапка: одна строка + тонкий прогресс; действия в «⋯» */
  const head=el("div","chat-head");head.dataset.taskSignature=signature;const w2=el("div","wrap2");
  const back=el("a","back","←");back.href="#/inbox";back.title="Нужно мне";w2.append(back);
  const mid=el("div","",);mid.style.cssText="flex:1;min-width:0";
  mid.append(el("h1","",t.title||t.id));
  const sub=el("div","sub");
  const stBadge=t.status==="BLOCKED"?badge("bad","остановлена"):t.status==="COMPLETED"?badge("ok","готово"):t.status==="CANCELLED"?badge("","отменена"):badge(t.phase==="DISCUSS"?"acc":t.phase==="SYNC"?"warn":"lime",phaseLabel(t));
  sub.append(stBadge,el("span","",t.agents.join(" · ")));
  if(t.stats&&t.stats.costUsd!==null&&t.stats.costUsd!==undefined)sub.append(el("span","",fmtUsd(t.stats.costUsd,t.stats.costEstimated)));
  if(t.status==="BLOCKED")sub.append(el("span","",t.blockedBy==="cost"?"лимит $"+t.maxCostUsd:(t.blockedReason||"")));
  mid.append(sub);w2.append(mid);
  const diffB=el("button","ghost small","Diff");diffB.type="button";diffB.title="изменения ветки задачи, замечания к строкам";diffB.onclick=()=>openDiff(t.id);w2.append(diffB);
  const menu=el("button","menu-btn","⋯");menu.title="Действия";menu.onclick=e=>{e.stopPropagation();taskMenu(menu,t)};w2.append(menu);
  head.append(w2);
  const w3=el("div","wrap2");const pr=progressOf(t);const pb=el("div","pbar");const fill=el("i",t.status==="BLOCKED"?"r":"");fill.style.width=Math.round(pr.overall*100)+"%";pb.append(fill);w3.append(pb);head.append(w3);
  main.insertBefore(head,keepComposer);
  const body=el("div","chat-body");main.insertBefore(body,keepComposer);
  /* DONE: заметная CTA вливания (3 состояния merge-check) */
  if(t.status==="COMPLETED"&&!t.merged)body.append(mergeCard(t));
  /* контекст: follow-up цепочка, поручения */
  const ctx=ctxLine(t);if(ctx)body.append(ctx);
  /* OpenSpec: прогресс change / change-writing задача */
  if(t.openspec)body.append(openspecCard(t));
  if(t.proposes)body.append(proposesCard(t));
  /* BLOCKED: карточка с теми же тремя сценариями, что во «входящих» */
  if(t.status==="BLOCKED")body.append(blockedCard(t));
  /* прогресс: подзадачи по агентам, мини-бары */
  const pc=progressCard(t);if(pc)body.append(pc);
  /* лента: сообщения + карточки (agreement, ревью, интеграция, spawned) по времени */
  let lastDay="";
  const items=[];
  for(const m of(t.messages||[]))items.push({at:m.createdAt,kind:"msg",m});
  if(t.agreement)items.push({at:t.agreement.createdAt,kind:"agreement"});
  for(const r of(t.syncReports||[]).filter(r2=>r2.round===t.syncRound))items.push({at:r.createdAt,kind:"review",r});
  for(const x of(t.integrations||[]).filter(x2=>x2.round===t.syncRound))items.push({at:x.createdAt,kind:"integration",x});
  for(const sp of(t.spawned||[]))items.push({at:sp.at,kind:"spawned",sp});
  if(t.plan)items.push({at:t.plan.at||t.phaseSince||t.updatedAt,kind:"plan"});
  if(t.status==="COMPLETED"&&!t.jobOf&&!t.proposes)items.push({at:t.phaseSince||t.updatedAt,kind:"acceptance"});
  items.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  for(const it of items){const d=dayOf(it.at);if(d!==lastDay){lastDay=d;body.append(el("div","daydiv",d))}
    if(it.kind==="msg"){const m=it.m;if(m.type==="QUESTION"&&m.to==="operator")body.append(questionBubble(t,m));else body.append(msgBubble(t,m,lead))}
    else if(it.kind==="agreement")body.append(agreementCard(t));
    else if(it.kind==="review")body.append(reviewCard(t,it.r));
    else if(it.kind==="integration")body.append(integrationCard(t,it.x));
    else if(it.kind==="spawned")body.append(spawnedCard(t,it.sp));
    else if(it.kind==="plan")body.append(planCard(t));
    else if(it.kind==="acceptance")body.append(accCard(t))}
  if(!items.length)body.append(el("div","sysline","Пока пусто — агенты напишут, как начнут."));
  /* composer */
  if(!keepComposer)main.append(composer(t));
  requestAnimationFrame(()=>{if(route.name==="tasks"&&route.task===t.id)window.scrollTo(0,wasBottom?document.body.scrollHeight:scrollY)})}
function avLetter(id,lead){return (id||"?").slice(0,1).toUpperCase()}
function msgBubble(t,m,lead){
  const mine=m.from==="operator";
  const wrap=el("div","msg"+(mine?" me":""));
  const av=el("span","av"+(m.from===lead?"":" rv"),mine?"Вы":avLetter(m.from,lead));wrap.append(av);
  const b=el("div","bubble");
  b.append(el("div","who2",mine?("Вы → lead'у "+lead):(m.from+(m.from===lead?" · ведёт задачу":""))));
  b.append(el("div","txt",m.content));
  const tm=el("div","tm2",time(m.createdAt));
  if(mine){const his=(t.messages||[]).find(x2=>x2.from===lead&&x2.replyTo===m.id);tm.append(his?" · ✓ получил "+lead:" · не прочитано")}
  b.append(tm);wrap.append(b);return wrap}
function questionBubble(t,m){
  const wrap=el("div","msg");wrap.append(el("span","av",avLetter(m.from)));
  const b=el("div","bubble");
  const answered=!!m.readAt;
  const ans=answered?(t.messages||[]).find(x2=>x2.replyTo===m.id):null;
  b.append(el("div","who2",m.from+" · вопрос"+(answered?" · отвечено":"")));
  b.append(el("div","txt",m.content));
  const chips=el("div","qchips");
  if(answered){chips.append(el("span","badge lime","вы выбрали: "+(ans?ans.content:"—")))}
  else{const ch=m.choices;
    if(ch&&Array.isArray(ch.options)){for(const o of ch.options){const label=typeof o==="string"?o:o.label;
      const c=el("button","qchip"+(ch.recommended===label?" rec":""),label);c.type="button";
      c.onclick=async()=>{c.disabled=true;try{await post("/api/questions/answer",{taskId:t.id,messageId:m.id,answer:label});toast("ok",t.id+": ответ отправлен",m.from+": "+label,t.id)}catch(e){toast("bad","Не отправлено",e.message,t.id)}await tick()};chips.append(c)}}
    const own=el("button","qchip","Своё…");own.type="button";own.onclick=async()=>{const v=await ask("Свой ответ ("+m.from+"): "+m.content.slice(0,140),"ответ");if(!v)return;
      try{await post("/api/questions/answer",{taskId:t.id,messageId:m.id,answer:typeof v==="string"?v:"да"});await tick()}catch(e){toast("bad","Не отправлено",e.message,t.id)}};chips.append(own)}
  b.append(chips);
  if(!answered){const tm=el("div","tm2","ждёт · без ответа выберет рекомендацию");
    const dis=el("button","qdismiss","закрыть без ответа");dis.type="button";dis.onclick=async()=>{try{await post("/api/questions/dismiss",{taskId:t.id,messageId:m.id});await tick()}catch(e){toast("bad","Не вышло",e.message,t.id)}};tm.append(" · ",dis);b.append(tm)}
  else b.append(el("div","tm2",time(m.createdAt)));
  wrap.append(b);return wrap}
function mergeCard(t){
  const card=el("div","action-card");const h=el("h4","",);h.append("Влить в проект");card.append(h);
  const check=t.mergeCheck||null;
  const p=el("p","");
  if(check&&check.status==="running"){h.append(badge("warn","проверяется"));p.textContent="Слитая сборка проходит проверку «"+t.verifyCommand+"» — влияние появится само."}
  else if(check&&check.status==="red"){h.append(badge("bad","упала"));p.textContent="Сборка слитого результата упала: "+(check.build?check.build.summary:"")+". Исправит follow-up "+(check.followUp||"— создайте из ветки.")}
  else if(check&&check.status==="conflict"){h.append(badge("bad","конфликт"));p.textContent="Конфликт с "+check.into+": "+(check.files||[]).join(", ")}
  else{h.append(badge("lime","можно"));p.textContent=(t.verifyCommand?"Сначала слитая сборка пройдёт «"+t.verifyCommand+"» отдельно от проекта, одним коммитом. ":"Влится одним коммитом, без проверки сборки. ")+(t.contract&&!t.contract.merged?"Контракт вольётся первым, в свой репозиторий.":"")}
  card.append(p);
  const opts=el("div","opts");
  const go2=el("button","cta small",check&&(check.status==="red"||check.status==="conflict")?"Посмотреть":"Влить в проект");go2.type="button";
  go2.onclick=async()=>{if(!await ask("Влить ветку lead'а ("+t.agents[0]+") в проект?"+(t.verifyCommand?" Сначала слитая сборка пройдёт «"+t.verifyCommand+"».":"")))return;
    go2.disabled=true;try{const r=await post("/api/tasks/"+encodeURIComponent(t.id)+"/merge",{});toast("ok",t.id+": вливание","check" in r?"проверка сборки запущена":"влито в проект",t.id)}catch(e){toast("bad",t.id+": не влито",e.message,t.id)}await tick()};
  opts.append(go2);
  if(check&&!check.followUp&&(check.status==="red"||check.status==="conflict")){const retry=el("button","ghost small","Проверить снова");retry.type="button";retry.onclick=async()=>{try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/merge/retry",{});await tick()}catch(e){toast("bad","Не вышло",e.message,t.id)}};opts.append(retry)}
  card.append(opts);return card}
/* контекстная строка под шапкой: follow-up цепочка, поручения, бюджет follow-up */
function ctxLine(t){
  const parts=[];
  if(t.parentTaskId)parts.push(taskLink(t.parentTaskId,"follow-up от"));
  if(t.followUps&&t.followUps.length)for(const id of t.followUps)parts.push(taskLink(id,"follow-up"));
  if(t.followUpBudget)parts.push(el("span","","бюджет follow-up: "+t.followUpBudget.used+"/"+t.followUpBudget.max));
  if(t.jobOf)parts.push(el("span","","поручение от "+t.jobOf.taskId+" (lead "+t.jobOf.by+" · подзадача "+t.jobOf.subtask+")"));
  const jobs=(S.tasks||[]).filter(x2=>x2.jobOf&&x2.jobOf.taskId===t.id);
  for(const j of jobs)parts.push(taskLink(j.id,(j.status==="COMPLETED"?"готово":j.status==="CANCELLED"?"отменено":j.status==="BLOCKED"?"остановлено":"в работе")+" · поручение"));
  if(!parts.length)return null;
  const line=el("div","ctxline");for(const p of parts)line.append(p);return line}
function taskLink(id,label){const a=el("a","",(label?label+" ":"")+id);a.href="#/tasks/"+encodeURIComponent(id);return a}
/* BLOCKED в чате: та же карточка со сценариями, что во «входящих» */
function blockedCard(t){
  const card=el("div","action-card");const h=el("h4","",);h.append("Задача остановлена",badge("bad",t.blockedBy==="cost"?"лимит денег":t.blockedBy==="rounds"?"раунды исправлений":"runner сдался"));card.append(h);
  card.append(el("p","",t.blockedReason||"Агенты ждут вашего решения."));
  if(t.handover)card.append(el("p","","Если не решите до "+time(t.handover.dueAt)+", исправление возьмёт на себя lead ("+t.handover.lead+")."));
  const opts=el("div","opts");blockedOpts(opts,{kind:"blocked",taskId:t.id});card.append(opts);return card}
/* подзадачи по агентам: мини-бары (пока задача жива) */
function progressCard(t){
  if(t.status!=="ACTIVE"&&t.status!=="BLOCKED")return null;
  const agents=t.agents.filter(id2=>{const l=((t.subtasks||{})[id2]||[]).filter(x2=>x2.status!=="DROPPED");return l.length});
  if(!agents.length)return null;
  const card=el("div","progress-card");
  for(const id2 of agents){const live=((t.subtasks||{})[id2]||[]).filter(x2=>x2.status!=="DROPPED");const done=live.filter(x2=>x2.status==="DONE").length;
    const row=el("div","prow");row.append(el("b","",id2));
    const pb=el("div","pbar");const f=el("i","");f.style.width=Math.round(done/Math.max(1,live.length)*100)+"%";pb.append(f);
    row.append(pb,el("span","cnt",done+"/"+live.length));card.append(row)}
  return card}
/* agreement: кто что делает, кто подтвердил */
function agreementCard(t){
  const a=t.agreement;const card=el("div","action-card");
  const h=el("h4","",);h.append("Соглашение v"+a.version);
  h.append(badge("acc","предложил "+a.proposedBy));
  h.append(badge(a.approvedBy.length>=(t.agents||[]).length?"lime":"warn","подтвердили "+a.approvedBy.length+"/"+(t.agents||[]).length));card.append(h);
  card.append(el("p","",a.summary));
  const det=el("details");det.append(el("summary","","Кто что делает ("+a.assignments.length+")"));
  for(const as of a.assignments){const row=el("div","find-row");row.append(el("b","",as.agentId),document.createTextNode(" — "+as.responsibility));
    const ok=a.approvedBy.includes(as.agentId);const st=el("span","badge "+(ok?"lime":""),ok?"✓ подтвердил":"ждёт подтверждения");st.style.marginLeft="6px";row.append(st);det.append(row)}
  if(a.decisions&&a.decisions.length)det.append(el("div","","Решения: "+a.decisions.join("; ")));
  if(a.interfaces&&a.interfaces.length)det.append(el("div","","Интерфейсы: "+a.interfaces.join("; ")));
  card.append(det);return card}
/* ревью раунда SYNC: PASS / замечания с виновниками */
function reviewCard(t,r){
  const card=el("div","action-card");const h=el("h4","",);h.append("Ревью · "+r.agentId);
  const errs=r.findings.filter(f=>f.severity==="ERROR").length;
  h.append(badge(r.status==="PASS"?"ok":"bad",r.status==="PASS"?"без замечаний":"надо исправить · "+errs));
  const db=el("button","ghost small","Diff");db.type="button";db.title="изменения ветки";db.onclick=()=>openDiff(t.id);h.append(db);card.append(h);
  for(const f of r.findings.slice(0,4)){const row=el("div","find-row");row.append(badge(f.severity==="ERROR"?"bad":f.severity==="WARNING"?"warn":"",f.severity),document.createTextNode(" "+f.description+(f.relatedAgent?" → "+f.relatedAgent:"")));card.append(row)}
  if(r.findings.length>4)card.append(el("div","tm2","ещё "+(r.findings.length-4)));
  card.append(el("div","tm2",time(r.createdAt)));return card}
/* интеграция: lead свёл результат и прогнал сборку */
function integrationCard(t,x){
  const card=el("div","action-card");const h=el("h4","",);h.append("Интеграция · "+x.agentId);
  h.append(badge(x.status==="PASS"?"ok":"bad",x.status==="PASS"?"принято":"надо исправить"));card.append(h);
  if(x.result)card.append(el("p","",x.result.slice(0,300)+(x.result.length>300?"…":"")));
  if(x.commits&&x.commits.length)card.append(el("div","tm2","коммиты: "+x.commits.join(", ")));
  for(const f of(x.findings||[]).slice(0,3)){const row=el("div","find-row");row.append(badge(f.severity==="ERROR"?"bad":"warn",f.severity),document.createTextNode(" "+f.description));card.append(row)}
  card.append(el("div","tm2",time(x.createdAt)));return card}
/* агент, добавленный lead'ом по ходу задачи */
function spawnedCard(t,sp){
  const card=el("div","action-card");const h=el("h4","",);h.append("К команде добавлен "+sp.id);
  h.append(badge("","шаблон "+sp.template));h.append(badge("acc","lead "+sp.by));card.append(h);
  card.append(el("p","",sp.reason||"добавил для помощи по задаче"));
  if(sp.role)card.append(el("div","tm2","роль сохранена: "+(sp.role.name||sp.role.id||"")));
  card.append(el("div","tm2",time(sp.at)));return card}
function taskMenu(anchor,t){
  document.querySelectorAll(".projpop").forEach(x2=>x2.remove());
  const pop=el("div","projpop");pop.style.position="fixed";
  const r=anchor.getBoundingClientRect();pop.style.top=r.bottom+6+"px";pop.style.right=Math.max(8,window.innerWidth-r.right)+"px";
  const item=(label,fn,danger)=>{const a=el("a","",label);a.href="#";if(danger)a.style.color="var(--bad)";a.onclick=e=>{e.preventDefault();pop.remove();fn()};pop.append(a)};
  if(t.status==="ACTIVE"||t.status==="BLOCKED")item("Отменить задачу…",async()=>{if(await ask("Отменить "+t.id+" («"+t.title+"»)?")){try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/cancel",{});await tick()}catch(e){toast("bad","Не вышло",e.message,t.id)}}},true);
  if(t.status==="COMPLETED"&&t.merged&&!t.merged.reverted)item("Откатить вливание…",async()=>{if(await ask("Откатить вливание "+t.id+" из проекта?")){try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/revert",{});toast("ok",t.id+": откат","вливание откачено",t.id);await tick()}catch(e){toast("bad","Не вышло",e.message,t.id)}}},true);
  item("Подробности (фазы, расход, коммиты)",()=>openDrawer(t.id));
  document.body.append(pop);
  setTimeout(()=>addEventListener("click",function h(e){if(!pop.contains(e.target)){pop.remove();removeEventListener("click",h)}}),0)}
function composer(t){
  const lead=t.agents[0];const box=el("div","composer");box.dataset.taskId=t.id;const b=el("div","box");
  const ta=el("textarea");ta.id="composer-text";ta.rows=1;ta.placeholder="Написать lead'у "+lead+"…";
  ta.value=store("an2.draft."+t.id)||"";
  ta.oninput=()=>{store("an2.draft."+t.id,ta.value);ta.style.height="auto";ta.style.height=Math.min(110,ta.scrollHeight)+"px"};
  const urgent=el("button","ghost small","⚡");urgent.type="button";urgent.title="Срочно: прервёт текущую сессию lead'а";urgent.onclick=()=>urgent.classList.toggle("on");
  const send=el("button","","Отправить");send.type="button";
  const doSend=async()=>{const text=ta.value.trim();if(!text){ta.focus();return}
    send.disabled=true;send.textContent="…";
    try{const j=await post("/api/tasks/"+encodeURIComponent(t.id)+"/message",{text:text,urgent:urgent.classList.contains("on")});
      if(ta.value.trim()===text){ta.value="";ta.style.height="auto";store("an2.draft."+t.id,"")}toast(urgent.classList.contains("on")?"warn":"ok",t.id+": отправлено lead'у "+lead,(j.interrupted?"сессия прервана, новая начнётся с сообщения. ":"")+text,t.id)}
    catch(e){toast("bad",t.id+": не отправлено",e.message,t.id)}
    await tick();send.disabled=false;send.textContent="Отправить"};
  send.onclick=doSend;
  ta.onkeydown=e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();doSend()}};
  b.append(ta,urgent,send);box.append(b);
  box.append(el("div","note","Пишется lead'у — остальные получают через него · черновик сохраняется сам · Ctrl+Enter — отправить · ⚡ — срочно, прерывает сессию"));
  return box}

/* ── новая задача (#/new): одно поле + вся форма v1 в «Настройках» ── */
let draft=null,draftTimer=null;
function renderNew(){
  const main=$("main");const previous=main.querySelector("[data-new-form]");const saved=new Map();
  if(previous)for(const node of previous.querySelectorAll("[data-new-key]"))saved.set(node.dataset.newKey,node.type==="checkbox"?node.checked:node.value);
  const active=previous&&previous.contains(document.activeElement)?document.activeElement:null;
  const activeKey=active?.dataset.newKey;const selectionStart=typeof active?.selectionStart==="number"?active.selectionStart:null;
  const selectionEnd=typeof active?.selectionEnd==="number"?active.selectionEnd:null;const selectionDirection=active?.selectionDirection;
  const priorScroll=main.scrollTop;const focusOnMount=!previous;const previousAdv=previous?.querySelector("details.adv");
  const wrap=el("div","wrap");wrap.dataset.newForm="true";
  wrap.append(el("h1","page-h","Новая задача вручную"));
  wrap.append(el("p","page-sub","Эта форма создаёт задачу напрямую. Чтобы сначала обсудить цель с Coordinator и проверить предложение, откройте «Координатор проекта»."));
  const runners=S&&S.control?S.control.runners:[];
  /* черновик от агента */
  if(controlMode&&S&&S.control.drafter){
    const db=el("div","drafter");const st=el("div","st");
    if(draft&&draft.status==="running"){st.append(el("span","spin"),el("b","","Агент читает код и заполняет форму…"),el("span","","~1 минута · можно продолжать работать"));
      const stop=el("button","ghost small","Остановить");stop.type="button";stop.style.marginLeft="auto";stop.onclick=async()=>{try{draft=await (await post("/api/drafts/"+encodeURIComponent(draft.id)+"/stop",{})).draft}catch(e){}render()};st.append(stop)}
    else{st.append(el("b","","Черновик от агента"));const note=el("span","","агент изучит код и заполнит форму ниже: название, описание, команду, сборку, контракт");note.style.cssText="color:var(--muted);font-size:12px";st.append(note)}
    db.append(st);
    if(draft&&(draft.status==="done"||draft.status==="error"||draft.status==="stopped")){
      const r=draft.result;
      if(draft.status==="done"&&r){const why=el("div","",);why.style.cssText="font-size:12px;color:var(--muted);margin-top:8px";
        why.textContent="Готово: "+(r.why?Object.keys(r.why).filter(k=>r.why[k]).map(k=>k+": "+r.why[k]).join(" · "):"форма заполнена");
        db.append(why);
        if(r.dropped&&r.dropped.length){const d2=el("div","",);d2.style.cssText="font-size:12px;color:var(--warn);margin-top:4px";d2.textContent="Не вошло: "+r.dropped.map(x2=>x2.field+" ("+x2.reason+")").join("; ");db.append(d2)}
        if(draftFill)draftFill(r)}
      else{const er=el("div","",);er.style.cssText="font-size:12px;color:var(--bad);margin-top:8px";er.textContent=draft.error||("черновик "+draft.status);db.append(er)}
      const again=el("button","ghost small","Составить заново");again.type="button";again.style.marginTop="8px";again.onclick=()=>{draft=null;render()};db.append(again)}
    wrap.append(db)}
  /* одно большое поле + примеры */
  const nb=el("div","newbox");const idea=el("textarea");idea.dataset.newKey="idea";idea.placeholder="Например: частичный возврат заказа по сумме; письмо клиенту после возврата…";
  const hint=el("div","hint");hint.append(el("span","","Примеры:"));
  for(const h of HINTS){const c=el("button","hint-chip",h);c.type="button";c.onclick=()=>{idea.value=h;idea.focus()};hint.append(c)}
  nb.append(idea,hint);wrap.append(nb);
  /* полная форма — все поля v1 */
  const adv=el("details","adv");adv.open=previousAdv?previousAdv.open:true;const sum=el("summary","","Форма задачи — проверьте и поправьте");adv.append(sum);
  const form=el("div","in");adv.append(form);
  const F=(label,node,title)=>{const l=el("label","",label);if(title)l.title=title;l.append(node);form.append(l);return node};
  const titleI=F("Название (можно оставить пустым)",document.createElement("input"));titleI.name="title";titleI.dataset.newKey="title";titleI.maxLength=200;titleI.placeholder="Отмена заказа: POST /orders/{id}/cancel";
  const descI=F("Описание — конкретно: что сделать, где, ожидаемое поведение, кто что делает",document.createElement("textarea"));descI.name="description";descI.dataset.newKey="description";descI.rows=4;
  const grid1=el("div");grid1.style.cssText="display:grid;grid-template-columns:1fr 1fr;gap:11px";form.append(grid1);
  const leadS=document.createElement("select");leadS.name="lead";leadS.dataset.newKey="lead";
  for(const r of runners){const o=el("option","",r.id);o.value=r.id;leadS.append(o)}
  if(!runners.length&&S)for(const a of S.agents){const o=el("option","",a.id);o.value=a.id;leadS.append(o)}
  const l1=el("label","","Ведёт задачу (lead)");l1.append(leadS);grid1.append(l1);
  const others=el("div");others.style.cssText="display:flex;gap:12px;padding-top:8px;font-size:13px;color:var(--text);flex-wrap:wrap";
  const othersById=new Map();
  for(const r of runners){if(leadS.options.length&&r.id===leadS.options[0].value)continue;
    const lb=el("label","",);lb.style.cssText="display:flex;gap:5px;align-items:center";const cb=el("input");cb.type="checkbox";cb.value=r.id;cb.dataset.newKey="agent:"+r.id;othersById.set(r.id,cb);
    lb.append(cb,document.createTextNode(r.id));others.append(lb)}
  const l2=el("label","","Участники");l2.append(others);grid1.append(l2);
  leadS.onchange=()=>{for(const[id2,cb]of othersById)cb.disabled=id2===leadS.value};
  const openS=F("OpenSpec change (необязательно): агенты делят его tasks.md по номерам — или пишут новый",document.createElement("select"));openS.dataset.newKey="openspec";
  openS.append(el("option","","— без OpenSpec —"));const oNew=el("option","","+ написать новый change…");oNew.value="__new__";openS.append(oNew);
  for(const c of CHANGES||[]){const o=el("option","",c.name||c);o.value=c.name||c;openS.append(o)}
  const folders=el("div");folders.style.cssText="font-size:11.5px;color:var(--warn)";form.append(folders);
  const proposesI=F("Имя нового change (латиница, цифры, -): lead пишет его, остальные ревьюят; код не меняется",document.createElement("input"));proposesI.name="proposes";proposesI.dataset.newKey="proposes";proposesI.maxLength=60;proposesI.placeholder="add-partial-refund";
  proposesI.parentElement.hidden=true;
  const fromI=F("Артефакты аналитиков (необязательно): путь к папке или .md-файлам, по одному на строку",document.createElement("textarea"));fromI.dataset.newKey="from";fromI.rows=2;fromI.placeholder="D:\\specs\\refund-draft\\";
  openS.onchange=()=>{proposesI.parentElement.hidden=openS.value!=="__new__";
    if(openS.value&&openS.value!=="__new__")checkSpecFolders(openS.value,folders,()=>[leadS.value,...[...othersById].filter(([id2,cb])=>cb.checked&&!cb.disabled).map(([id2])=>id2)]);
    else folders.textContent=""};
  if(pendingChange){if([...openS.options].some(o=>o.value===pendingChange)){openS.value=pendingChange;openS.onchange()}
    else{openS.value="__new__";openS.onchange();proposesI.value=pendingChange}pendingChange=null}
  const grid2=el("div");grid2.style.cssText="display:grid;grid-template-columns:1fr 1fr 1fr;gap:11px";form.append(grid2);
  const verifyI=document.createElement("input");verifyI.name="verifyCommand";verifyI.dataset.newKey="verifyCommand";verifyI.placeholder="без проверки сборки";grid2.append(el("label","","Сборка и тесты (--verify)",).appendChild(verifyI).parentElement);
  const fuI=document.createElement("input");fuI.name="maxFollowUps";fuI.dataset.newKey="maxFollowUps";fuI.type="number";fuI.min=0;fuI.max=20;fuI.value="0";grid2.append(el("label","","Follow-up задач на цепочку").appendChild(fuI).parentElement);
  const frI=document.createElement("input");frI.name="maxFixRounds";frI.dataset.newKey="maxFixRounds";frI.type="number";frI.min=0;frI.max=20;frI.value="3";grid2.append(el("label","","Раундов исправлений").appendChild(frI).parentElement);
  const costI=F("Лимит расхода, $ (достигнут — задача встанет, решите вы; пусто — без лимита)",document.createElement("input"));costI.name="maxCostUsd";costI.dataset.newKey="maxCostUsd";costI.type="number";costI.min=0;costI.step=0.5;costI.placeholder="без лимита";costI.style.maxWidth="200px";
  const depthS=F("Подготовка",document.createElement("select"));depthS.dataset.newKey="depth";
  for(const[d,label]of[["fast","быстро — сразу к соглашению"],["standard","стандарт — lead уточнит постановку"],["thorough","тщательно — допрос, план на утверждение, критик"],["custom","своя настройка (галочки ниже)"]]){const o=el("option","",label);o.value=d;if(d==="standard")o.selected=true;depthS.append(o)}
  const prep=el("div");prep.style.cssText="display:grid;gap:6px;font-size:13px;color:var(--text)";form.append(prep);
  const mkCheck=(name,label,on)=>{const lb=el("label","",);lb.style.cssText="display:flex;gap:8px;align-items:center";const cb=el("input");cb.type="checkbox";cb.name=name;cb.dataset.newKey="check:"+name;cb.checked=!!on;lb.append(cb,document.createTextNode(label));prep.append(lb);return cb};
  const clarifyC=mkCheck("clarify","Сначала уточнить постановку (вопросы с вариантами)",true);
  const grillC=mkCheck("grill","Допрос (grill-me): раунды вопросов, в конце подтверждаете понимание");
  const planC=mkCheck("planReview","План на утверждение: lead пишет план страницей, вы правите и утверждаете");
  const applyDepth=()=>{const v=depthS.value;clarifyC.checked=v!=="fast"&&v!=="custom";grillC.checked=v==="thorough";planC.checked=v==="thorough"};
  depthS.onchange=applyDepth;
  for(const cb of[clarifyC,grillC,planC])cb.onchange=()=>{depthS.value="custom"};
  const spawnC=mkCheck("allowSpawn","Lead может добавлять агентов (spawn, каждый — отдельная сессия по стоимости)");
  const contractI=F("Проект контракта OpenAPI (абсолютный путь к Maven-проекту со спекой)",document.createElement("input"));contractI.name="contract";contractI.dataset.newKey="contract";contractI.placeholder="D:\\Projects\\shop-api";contractI.autocomplete="off";
  const cnote=el("div");cnote.style.cssText="font-size:11.5px";form.append(cnote);
  contractI.onchange=async()=>{const v=contractI.value.trim();if(!v){cnote.textContent="";return}
    const d=await getJSON(q("/api/contract/inspect?path="+encodeURIComponent(v))).catch(e=>({error:e.message}));
    cnote.style.color=d.error||!d.coords?"var(--bad)":"var(--ok)";
    cnote.textContent=d.error?d.error||"не читается":d.coords?"✓ "+d.coords.groupId+":"+d.coords.artifactId+" "+d.coords.version+" · спек: "+(d.specs||[]).length:"путь есть, pom.xml не найден"};
  draftFill=r=>{if(r.title)titleI.value=r.title;if(r.description)descI.value=r.description;
    if(r.lead&&[...leadS.options].some(o=>o.value===r.lead))leadS.value=r.lead;
    for(const[id2,cb]of othersById)cb.checked=(r.agents||[]).includes(id2);
    if(r.depth&&["fast","standard","thorough"].includes(r.depth)){depthS.value=r.depth;applyDepth()}
    if(r.verifyCommand)verifyI.value=r.verifyCommand;
    if(r.contract)contractI.value=r.contract;
    if(r.openspec&&[...openS.options].some(o=>o.value===r.openspec)){openS.value=r.openspec;openS.onchange()}};
  wrap.append(adv);
  /* кнопки */
  const row=el("div");row.style.cssText="display:flex;gap:10px;align-items:center;margin-top:4px";
  const create=el("button","cta","Создать задачу");create.type="button";const note2=el("span");note2.style.cssText="font-size:12.5px";
  const draftBtn=el("button","","Сначала черновик от агента");draftBtn.type="button";
  draftBtn.onclick=async()=>{const text=idea.value.trim();if(!text){idea.focus();return}
    draftBtn.disabled=true;try{const r=await post("/api/drafts",{text:text});draft=r.draft;note2.textContent="";render();draftTimer=setInterval(pollDraft,2000)}catch(e){note2.textContent=e.message;note2.style.color="var(--bad)"}draftBtn.disabled=false};
  create.onclick=async()=>{
    const agents=[leadS.value,...[...othersById].filter(([id2,cb])=>cb.checked&&!cb.disabled).map(([id2])=>id2)].filter(Boolean);
    const body={title:titleI.value,description:descI.value.trim()||idea.value.trim(),agents:agents,depth:depthS.value,
      clarify:clarifyC.checked,grill:grillC.checked,planReview:planC.checked,allowSpawn:spawnC.checked,
      verifyCommand:verifyI.value,maxFollowUps:fuI.value,maxFixRounds:frI.value,maxCostUsd:costI.value};
    if(openS.value==="__new__"){if(proposesI.value.trim())body.proposes=proposesI.value.trim()}else if(openS.value)body.openspec=openS.value;
    if(fromI.value.trim())body.from=fromI.value.split("\n").map(x2=>x2.trim()).filter(Boolean);
    if(contractI.value.trim())body.contract=contractI.value.trim();
    create.disabled=true;note2.style.color="";note2.textContent="Создаю…";
    try{const r=await post("/api/tasks",body);clearInterval(draftTimer);draft=null;idea.value="";store("an2.new.idea","");toast("ok",r.task.id+": создана",r.task.title,r.task.id);go("tasks",r.task.id)}
    catch(e){note2.style.color="var(--bad)";note2.textContent=e.message;create.disabled=false}};
  if(controlMode&&S&&S.control.drafter)row.append(draftBtn);
  row.append(create,note2);wrap.append(row);
  for(const node of wrap.querySelectorAll("[data-new-key]")){if(!saved.has(node.dataset.newKey))continue;const value=saved.get(node.dataset.newKey);if(node.type==="checkbox")node.checked=value;else node.value=value}
  if(saved.has("lead"))leadS.onchange();if(saved.has("openspec"))openS.onchange();
  main.replaceChildren(wrap);main.scrollTop=priorScroll;
  const focusTarget=activeKey?[...wrap.querySelectorAll("[data-new-key]")].find(node=>node.dataset.newKey===activeKey):null;
  if(focusTarget){focusTarget.focus({preventScroll:true});if(selectionStart!==null&&typeof focusTarget.setSelectionRange==="function")focusTarget.setSelectionRange(selectionStart,selectionEnd??selectionStart,selectionDirection||"none")}
  else if(focusOnMount)idea.focus({preventScroll:true})}
async function pollDraft(){if(!draft||draft.status!=="running")return;
  try{const d=await getJSON(q("/api/drafts/"+encodeURIComponent(draft.id)));if(d.draft.status!=="running"){clearInterval(draftTimer);draft=d.draft;render()}}catch(e){clearInterval(draftTimer)}}
let draftFill=null;
async function checkSpecFolders(change,box,agentsFn){const agents=agentsFn().join(",");
  const d=await getJSON(q("/api/openspec/folders?change="+encodeURIComponent(change)+"&agents="+encodeURIComponent(agents))).catch(()=>null);
  box.textContent=d&&d.missing&&d.missing.length?"⚠ change нет в папке: "+d.missing.map(m=>m.id).join(", ")+" — сначала закоммитьте и влейте его в их ветки":""}

/* ── агенты (#/agents) ── */
const agentOpen=new Set();
function renderAgents(){
  const main=$("main");const wrap=el("div","wrap");main.replaceChildren(wrap);
  wrap.append(el("h1","page-h","Агенты"));
  wrap.append(el("p","page-sub","Runner'ы проекта: запуск, модель, инструкции, лог. Нажмите на строку, чтобы раскрыть."));
  const runners=S&&S.control?S.control.runners:null;
  if(!controlMode||!runners){wrap.append(el("p","page-sub","Страница запущена без runner'ов (read-only): управление агентами недоступно."));
    const tbl=el("table","tbl");tbl.append(el("tr","",),tr2("Агент","Статус","Задачи"));
    for(const a of S.agents){const tr=el("tr");const c=el("td");c.append(dot(a.effectiveStatus==="WORKING"||a.effectiveStatus==="ONLINE"?"ok":a.effectiveStatus==="WAITING"?"warn":a.effectiveStatus==="DEAD"?"bad":""),document.createTextNode(" "+a.id));
      tr.append(c,td2(a.effectiveStatus),td2((a.tasks||[]).join(", ")||"—"));tbl.append(tr)}
    wrap.append(tbl);return}
  for(const r of runners)wrap.append(agentRow(r));
  /* добавить агента из шаблона */
  const add=el("details","adv");add.id="addagent";add.style.marginTop="14px";add.append(el("summary","","Новый агент из шаблона"));
  const ain=el("div","in");const g=el("div");g.style.cssText="display:grid;grid-template-columns:1fr 1fr 1fr;gap:11px";
  const idI=el("input");idI.placeholder="kimi-2";g.append(el("label","","Имя (id)").appendChild(idI).parentElement);
  const tplS=el("select");const templates=(S.control.runnerTemplates)||[];
  for(const t of templates){const o=el("option","",t.name||t.id||JSON.stringify(t).slice(0,40));o.value=t.name||t.id;tplS.append(o)}
  g.append(el("label","","Шаблон CLI").appendChild(tplS).parentElement);
  const modelS=el("select");modelS.append(el("option","","— из шаблона —"));
  const fillModels=()=>{const t=templates.find(x2=>(x2.name||x2.id)===tplS.value);modelS.replaceChildren(el("option","","— из шаблона —"));
    for(const m of(t&&t.models)||[]){const o=el("option","",m);o.value=m;modelS.append(o)}};
  tplS.onchange=fillModels;fillModels();g.append(el("label","","Модель").appendChild(modelS).parentElement);
  ain.append(g);
  const note2=el("span");note2.style.cssText="font-size:12px;color:var(--muted);margin-left:8px";
  const go3=el("button","cta small","Добавить агента");go3.type="button";go3.onclick=async()=>{try{
    await post("/api/runners",{id:idI.value.trim(),template:tplS.value,...(modelS.value?{model:modelS.value}:{})});
    toast("ok","Агент добавлен",idI.value.trim()+" — запишется в runners.json");add.open=false;await tick()}catch(e){note2.style.color="var(--bad)";note2.textContent=e.message}};
  ain.append(el("div","",),go3,note2);add.append(ain);wrap.append(add);
  /* агенты в сети */
  const sectH=el("div","sect-h","Агенты в сети ");sectH.append(el("span","n","MCP-процессы"));wrap.append(sectH);
  const tbl=el("table","tbl");tbl.append(tr2("Агент","Статус","Задачи","Последний ответ"));
  for(const a of S.agents){const tr=el("tr");const c=el("td");c.append(dot(a.effectiveStatus==="WORKING"?"ok":a.effectiveStatus==="WAITING"?"warn":a.effectiveStatus==="DEAD"?"bad":""),document.createTextNode(" "+a.id));
    tr.append(c,td2(a.effectiveStatus),td2((a.tasks||[]).join(", ")||"—"),td2(a.lastSeenAt?ago(a.lastSeenAt):"—"));tbl.append(tr)}
  for(const id of S.notStarted||[]){const tr=el("tr");const st=el("td");st.append(el("span","badge","ещё не запускался"));tr.append(td2(id),st,td2("—"),td2("—"));tbl.append(tr)}
  wrap.append(tbl);
  /* скиллы, роли, worktree */
  wrap.append(skillsSection());
  wrap.append(rolesSection());
  wrap.append(worktreesSection())}
/* скиллы × агенты: чекбокс на агента, «без: change/код», массовые операции */
let SKILLS=null,skillsAt=0;
function skillsSection(){
  const box=el("div");box.style.marginTop="26px";
  box.append(el("div","sect-h","Скиллы"));
  const inner=el("div");box.append(inner);renderSkillsBox(inner);return box}
async function renderSkillsBox(box){
  if(Date.now()-skillsAt>15000){skillsAt=Date.now();try{SKILLS=await getJSON(q("/api/skills"))}catch(e){SKILLS={skills:[],agents:[]}}}
  const sig=JSON.stringify([SKILLS,!!S.control]);if(box.dataset.sig===sig)return;box.dataset.sig=sig;box.replaceChildren();
  const agents=(SKILLS.agents||[]).filter(a=>!a.spawned);
  if(!SKILLS.skills.length||!agents.length){box.append(el("div","page-sub",!agents.length?"Runner'ов нет: скиллы включаются по агентам из runners.json.":"Скиллов не нашлось: ищу в ~/.claude/skills, ~/.qwen/skills и .claude/skills проекта и агентов."));return}
  const t=el("table","tbl");t.style.fontSize="12.5px";
  const hd=el("tr");hd.append(el("th","","Скилл"));for(const a of agents)hd.append(el("th","",a.id));hd.append(el("th","",""));t.append(hd);
  const toggle=async(agent,name,enabled)=>{try{await post("/api/runners/"+encodeURIComponent(agent)+"/skills",{skill:name,enabled:enabled});skillsAt=0;if(box.isConnected)await renderSkillsBox(box)}catch(e){toast("bad","Скилл не переключён",e.message)}};
  for(const k of SKILLS.skills){const tr=el("tr");const nm=el("td");nm.append(el("b","",k.name));
    if(k.sources&&k.sources.length)nm.append(el("span","muted small"," "+k.sources.join(", ")));else nm.append(el("span","muted small"," не найден"));
    nm.title=k.description||"";tr.append(nm);
    for(const a of agents){const td=el("td");const cb=el("input");cb.type="checkbox";cb.checked=!(a.disabled||[]).includes(k.name);cb.disabled=!controlMode;
      cb.title=(cb.checked?"выключить ":"включить ")+k.name+" для "+a.id;
      cb.onchange=()=>{cb.disabled=true;toggle(a.id,k.name,cb.checked)};td.append(cb);
      const by=a.byTask||{};for(const[kind,word]of[["propose","change"],["code","код"]])if((by[kind]||[]).includes(k.name)){const m=el("span","muted small"," без: "+word);m.title="выключен в задачах типа «"+(kind==="propose"?"написать change":"код")+"» (runners.json disabledSkillsByTask)";td.append(m)}
      tr.append(td)}
    const all=el("td");if(controlMode){const anyOn=agents.some(a=>!(a.disabled||[]).includes(k.name));
      const b=el("button","ghost small",anyOn?"выкл. всем":"вкл. всем");b.type="button";
      b.onclick=async()=>{b.disabled=true;for(const a of agents)if(((a.disabled||[]).includes(k.name))===anyOn)await post("/api/runners/"+encodeURIComponent(a.id)+"/skills",{skill:k.name,enabled:!anyOn}).catch(e=>toast("bad","Не вышло",e.message));skillsAt=0;if(box.isConnected)await renderSkillsBox(box)};all.append(b)}
    tr.append(all);t.append(tr)}
  box.append(t);
  if(controlMode){const f=el("div");f.style.cssText="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap";
    const inp=el("input");inp.placeholder="имя скилла или плагин:* — например backend-design-java:*";inp.style.minWidth="300px";
    const b=el("button","small","Выключить всем");b.type="button";const say=el("span","muted small","");
    b.onclick=async()=>{const name=inp.value.trim();if(!name){say.textContent="Введите имя скилла";return}b.disabled=true;say.textContent="";
      try{for(const a of agents)if(!(a.disabled||[]).includes(name))await post("/api/runners/"+encodeURIComponent(a.id)+"/skills",{skill:name,enabled:false});inp.value="";skillsAt=0;if(box.isConnected)await renderSkillsBox(box)}catch(e){say.textContent=e.message}finally{b.disabled=false}};
    inp.oninput=()=>{say.textContent=""};f.append(inp,b,say);box.append(f)}}
/* библиотека ролей проекта: lead берёт их по имени для добавленных агентов */
let ROLES=null,rolesAt=0;
function rolesSection(){
  const box=el("div");box.style.marginTop="26px";
  box.append(el("div","sect-h","Библиотека ролей"));
  const inner=el("div");box.append(inner);renderRolesBox(inner);return box}
async function renderRolesBox(box){
  if(Date.now()-rolesAt>15000){rolesAt=Date.now();try{ROLES=(await getJSON(q("/api/roles"))).roles}catch(e){ROLES=[]}}
  const sig=JSON.stringify([ROLES,!!S.control]);if(box.dataset.sig===sig)return;box.dataset.sig=sig;box.replaceChildren();
  if(!ROLES||!ROLES.length){box.append(el("div","page-sub","Ролей пока нет: роль, которую lead написал для добавленного агента, сохраняется кнопкой «Сохранить роль» в «Подробностях» задачи."));return}
  for(const r of ROLES){const d=el("details","adv");d.append(el("summary","",r.name+" — "+r.description),el("div","logbox2",r.instructions));
    if(controlMode){const x=el("button","ghost small","Удалить");x.type="button";x.style.marginTop="6px";
      x.onclick=async()=>{if(!await ask("Удалить роль "+r.name+"?"))return;try{await post("/api/roles/"+encodeURIComponent(r.name)+"/delete",{});rolesAt=0;if(box.isConnected)await renderRolesBox(box)}catch(e){toast("bad","Роль не удалена",e.message)}};d.append(x)}
    box.append(d)}}
/* worktree: список и очистка */
let wtOutText="",wtPre=null;
function worktreesSection(){
  const box=el("div");box.style.marginTop="26px";
  box.append(el("div","sect-h","Worktree и обслуживание"));
  const wts=S.control&&S.control.worktrees||[];
  box.append(el("div","page-sub","Папки-витрины агентов рядом с проектом: "+(wts.length?wts.join(", "):"пока не созданы")+". Перед следующей задачей создадутся заново от HEAD проекта."));
  const r=el("div");r.style.cssText="display:flex;gap:8px;flex-wrap:wrap;align-items:center";
  const clean=el("button","ghost small","Убрать worktree агентов");clean.type="button";
  clean.onclick=async()=>{if(!await ask("Убрать worktree и ветки агентов ("+wts.join(", ")+")? Без --force: невлитые ветки и папки с правками останутся. Перед следующей задачей они создадутся заново от HEAD проекта."))return;
    clean.disabled=true;wtOutText="убираю…";drawWtOut();
    try{const res=await post("/api/worktrees/clean",{});wtOutText=(res.result||[]).map(x=>x.id+": "+(x.removed?"папка убрана":"папка осталась")+(x.branchDeleted?", ветка удалена":"")+(x.note?" — "+x.note:"")).join("\n")||"Убирать нечего."}catch(e){wtOutText=e.message}finally{clean.disabled=false}drawWtOut()};
  const all=el("button","ghost small","Убрать все worktree проекта");all.type="button";
  all.onclick=async()=>{if(!await ask("Убрать все worktree проекта: агентов, контрактов закрытых задач и брошенные проверками вливания? Невлитые ветки и папки с незакоммиченными правками останутся."))return;
    all.disabled=true;wtOutText="убираю…";drawWtOut();
    const KIND={agent:"агент",contract:"контракт","merge-check":"проверка вливания"};
    try{const res=await post("/api/worktrees/clean-all",{});wtOutText=(res.result||[]).map(x=>(x.removed?"✓ ":"· ")+KIND[x.kind]+" "+x.id+": "+(x.removed?"убран":"оставлен")+(x.branchDeleted?", ветка удалена":"")+(x.note?" — "+x.note:"")).join("\n")||"Убирать нечего."}catch(e){wtOutText=e.message}finally{all.disabled=false}drawWtOut()};
  r.append(clean,all);box.append(r);
  wtPre=el("div","logbox2",wtOutText);wtPre.hidden=!wtOutText;box.append(wtPre);
  return box}
function drawWtOut(){if(wtPre){wtPre.textContent=wtOutText;wtPre.hidden=!wtOutText}}
function tr2(){const tr=el("tr");for(const t of arguments)tr.append(el("th","",t));return tr}
function td2(v){return el("td","mono",v)}
function contextMeter(r){
  if(!r.session)return null;
  const box=el("div","context-meter");
  if(typeof r.contextTokens!=="number"){box.append(el("span","empty","Контекст: ждём данные CLI"));return box}
  const used=r.contextTokens,limit=typeof r.maxContextTokens==="number"?r.maxContextTokens:null;
  const pct=limit?Math.round(used/limit*100):null;
  box.append(el("span","", "Контекст "+fmtTok(used)+(limit?" / "+fmtTok(limit):"")+(pct!==null?" · "+pct+"%":"")));
  if(limit){const bar=el("div","pbar");const fill=el("i",pct>=100?"over":pct>=75?"warn":"");fill.style.width=Math.min(100,Math.max(0,pct))+"%";bar.append(fill);box.append(bar)}
  box.title=limit?"Входной контекст последнего ответа CLI. Предел — maxContextTokens: после него runner начнёт новую сессию.":"Входной контекст последнего ответа CLI. Задайте maxContextTokens, чтобы видеть процент заполнения.";
  return box}
function agentRow(r){
  const open=agentOpen.has(r.id);
  const row=el("div","agent-row");
  if(r.session)row.style.borderColor="var(--lime-deep)";
  row.append(el("span","av"+(r.id.length>4?" v":""),avLetter(r.id)));
  const mid=el("div");mid.style.minWidth="0";
  const h=el("h3","",r.id);
  h.append(badge(r.session?"lime":r.running?"warn":"",r.session?"работает · сессия #"+r.session.attempt:r.running?"ждёт задачу":"остановлен"));
  const cur=r.session?taskById(r.session.taskId):null;
  const now=el("div","now");
  now.textContent=r.session?(r.session.taskId+(cur?" · "+taskPreview(cur):"")+" · "+ago(r.session.startedAt)):r.running?"Нет задачи. Запустится сам, когда появится работа.":"Остановлен.";
  if(r.model){const m=el("span","","");m.style.cssText="font-family:var(--mono);font-size:11px";m.textContent=" · "+r.model;now.append(m)}
  mid.append(h,now);const ctx=contextMeter(r);if(ctx)mid.append(ctx);row.append(mid);
  const acts=el("div","acts");
  const toggle=el("button","ghost small",r.running?"Остановить":"Запустить");toggle.type="button";
  toggle.onclick=async e=>{e.stopPropagation();try{await post("/api/runners/"+encodeURIComponent(r.id)+"/"+(r.running?"stop":"start"),{});await tick()}catch(er){toast("bad",r.id+": не вышло",er.message)}};
  const exp=el("button","ghost small",open?"Свернуть":"Раскрыть");exp.type="button";exp.onclick=e=>{e.stopPropagation();agentOpen.has(r.id)?agentOpen.delete(r.id):agentOpen.add(r.id);render()};
  acts.append(toggle,exp);row.append(acts);
  if(!open)return row;
  const det=el("div","agent-detail");const g=el("div","row3");
  const models=r.models&&r.models.length?r.models:[r.model].filter(Boolean);
  if(models.length){const l=el("label","","Модель");const s=el("select");for(const m of models){const o=el("option","",m);o.value=m;if(m===r.model)o.selected=true;s.append(o)}
    const other=el("option","","другая…");other.value="__other__";s.append(other);const inp=el("input");inp.placeholder="модель";inp.style.display="none";
    s.onchange=()=>{inp.style.display=s.value==="__other__"?"":"none"};
    const apply=el("button","small","Применить модель");apply.type="button";apply.onclick=async()=>{const v=s.value==="__other__"?inp.value.trim():s.value;if(!v)return;
      try{await post("/api/runners/"+encodeURIComponent(r.id)+"/model",{model:v});toast("ok",r.id+": модель",v);await tick()}catch(e){toast("bad","Не вышло",e.message)}};
    l.append(s,inp,apply);g.append(l)}
  const li=el("label","","Файл инструкций");const ii=el("input");ii.value=r.instructionsFile||"";ii.placeholder="instructions/"+r.id+".md";
  const ib=el("button","small","Сохранить");ib.type="button";ib.onclick=async()=>{try{await post("/api/runners/"+encodeURIComponent(r.id)+"/instructions",{file:ii.value.trim()});toast("ok",r.id+": инструкции",ii.value.trim()||"сброшен")}catch(e){toast("bad","Не вышло",e.message)}};li.append(ii,ib);g.append(li);
  const lts=el("label","",);lts.style.cssText="display:flex;gap:8px;align-items:center;align-self:end";
  const tsc=el("input");tsc.type="checkbox";tsc.checked=!!r.tokenSaver;tsc.onchange=async()=>{try{await post("/api/runners/"+encodeURIComponent(r.id)+"/token-saver",{enabled:tsc.checked});await tick()}catch(e){toast("bad","Не вышло",e.message)}};
  lts.append(tsc,document.createTextNode("Экономить токены (сокращённые промпты)"));g.append(lts);
  det.append(g);
  const acts2=el("div");acts2.style.cssText="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px";
  const logB=el("button","ghost small","Сырой лог");logB.type="button";const logBox=el("pre","logbox");logBox.hidden=true;
  logB.onclick=async()=>{if(!logBox.hidden){logBox.hidden=true;return}
    const d=await getJSON(q("/api/runners/"+encodeURIComponent(r.id)+"/log")).catch(()=>({lines:[]}));
    logBox.textContent=(d.lines||[]).join("\n")||"(пусто)";logBox.hidden=false};
  acts2.append(logB);det.append(acts2,logBox);
  /* мини-лента активности агента */
  const mine=ACT.filter(e=>e.agentId===r.id).slice(-8);
  if(mine.length){const cap=el("div","",);cap.style.cssText="font:650 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px";cap.textContent="Активность";det.append(cap);
    const p2=el("div","panel2");for(const e of mine.slice().reverse()){const a=el("div","act-row");a.append(el("span","tm",time(e.at||e.createdAt||"")),el("span","kind "+(e.kind==="tool_use"?"tool":e.kind==="tool_result"?"ok":e.kind==="error"?"err":"think"),e.kind||""),el("span","sum",(e.tool?e.tool+" ":"")+(e.summary||"")));p2.append(a)}det.append(p2)}
  const frag=document.createDocumentFragment();frag.append(row,det);return frag}

/* ── архив и история (#/history/<activity|runs|events>) ── */
/* фильтры истории (#24–26): панель на вкладку, состояние — в module vars; панель не перестраивается, пока в ней фокус */
const HIST={act:{kind:"all",agent:"all",task:"all",q:""},run:{agent:"all",task:"all",model:"all",status:"all"},ev:{task:"all",type:"all"}};
let histBarEl=null,histBarTab="";
function hsel(value,options,allLabel,onch){const s=document.createElement("select");s.append(new Option(allLabel,"all"));options.forEach(o=>s.append(new Option(o,o)));s.value=value;s.onchange=()=>onch(s.value);return s}
function histFilters(tab,sig,build){if(histBarTab!==tab){histBarTab=tab;histBarEl=null}
  if(!histBarEl)histBarEl=el("div","filters2");
  if(histBarEl.dataset.sig!==sig&&!histBarEl.contains(document.activeElement)){histBarEl.dataset.sig=sig;histBarEl.replaceChildren();build(histBarEl)}
  return histBarEl}
function renderHistory(){
  const main=$("main");const wrap=el("div","wrap");
  const tabs=el("div","tabs2");
  for(const[t,label]of[["activity","Действия агентов"],["runs","Сессии и расход"],["events","События задач"]]){
    const a=el("a",route.tab===t?"on":"",label);a.href="#/history/"+t;tabs.append(a)}
  wrap.append(tabs);
  if(route.tab==="activity"){
    wrap.append(el("h1","page-h","Действия агентов"));
    const f=HIST.act;
    const agents=[...new Set(ACT.map(e=>e.agentId).filter(Boolean))].sort();
    const tasks=[...new Set(ACT.map(e=>e.taskId).filter(Boolean))].sort();
    const kinds=[...new Set(ACT.map(e=>e.kind||e.type).filter(Boolean))].sort();
    wrap.append(histFilters("activity",JSON.stringify([agents,tasks,kinds]),box=>{
      box.append(hsel(f.kind,kinds,"Все типы",v=>{f.kind=v;render()}),
        hsel(f.agent,agents,"Все агенты",v=>{f.agent=v;render()}),
        hsel(f.task,tasks,"Все задачи",v=>{f.task=v;render()}));
      const inp=el("input");inp.placeholder="поиск по тексту";inp.value=f.q;inp.oninput=()=>{f.q=inp.value;render()};box.append(inp)}));
    const list=ACT.filter(e=>(f.kind==="all"||e.kind===f.kind||e.type===f.kind)&&(f.agent==="all"||e.agentId===f.agent)&&(f.task==="all"||e.taskId===f.task)&&(!f.q||((e.summary||e.text||"")+" "+(e.tool||"")).toLowerCase().includes(f.q.toLowerCase()))).slice().reverse().slice(0,300);
    if(!list.length)wrap.append(el("p","page-sub","Ничего не нашлось — поправьте фильтры или начните задачу."));
    for(const e of list){const r=el("div","act-row");
      r.append(el("span","tm",time(e.at||e.createdAt||"")),el("span","kind "+(e.kind==="tool_use"?"tool":e.kind==="tool_result"?"ok":e.kind==="error"||e.kind==="err"?"err":"think"),e.kind||e.type||""),el("span","sum",(e.agentId?e.agentId+": ":"")+(e.tool?e.tool+" ":"")+(e.summary||e.text||"")));
      wrap.append(r)}}
  else if(route.tab==="runs"){
    wrap.append(el("h1","page-h","Сессии и расход"));
    const f=HIST.run;
    const agents=[...new Set(RUNS.map(r=>r.agentId).filter(Boolean))].sort();
    const tasks=[...new Set(RUNS.map(r=>r.taskId).filter(Boolean))].sort();
    const models=[...new Set(RUNS.map(r=>r.model).filter(Boolean))].sort();
    wrap.append(histFilters("runs",JSON.stringify([agents,tasks,models]),box=>{
      box.append(hsel(f.agent,agents,"Все агенты",v=>{f.agent=v;render()}),
        hsel(f.task,tasks,"Все задачи",v=>{f.task=v;render()}),
        hsel(f.model,models,"Все модели",v=>{f.model=v;render()}),
        hsel(f.status,["running","ok","failed"],"Все статусы",v=>{f.status=v;render()}))}));
    const rstat=r=>r.status==="running"?"running":r.exitCode===0?"ok":"failed";
    const list=RUNS.filter(r=>(f.agent==="all"||r.agentId===f.agent)&&(f.task==="all"||r.taskId===f.task)&&(f.model==="all"||r.model===f.model)&&(f.status==="all"||rstat(r)===f.status));
    const cost=list.reduce((a,r)=>a+(r.costUsd||0),0);
    wrap.append(el("p","page-sub","Показано "+list.length+" из "+RUNS.length+" · суммарно "+fmtUsd(cost,RUNS.some(r=>r.costEstimated))+"."));
    const tbl=el("table","tbl");tbl.append(tr2("Агент","Задача","Модель","Длительность","Статус","Стоимость"));
    for(const r of list){const tr=el("tr");
      const stTd=el("td");stTd.append(el("span","badge "+(r.status==="running"?"lime":r.exitCode===0?"ok":"bad"),r.status==="running"?"работает":r.exitCode===0?"ок":"код "+r.exitCode));
      tr.append(td2(r.agentId||"—"),td2(r.taskId||"—"),td2(r.model||"—"),td2(r.durationMs!==null&&r.durationMs!==undefined?Math.round(r.durationMs/60000)+" мин":"—"),
        stTd,
        td2(r.costUsd!==null&&r.costUsd!==undefined?fmtUsd(r.costUsd,r.costEstimated):"—"));
      tbl.append(tr)}
    if(!RUNS.length)wrap.append(el("p","page-sub","Сессий пока не было."));
    wrap.append(tbl)}
  else{
    wrap.append(el("h1","page-h","События задач"));
    const f=HIST.ev;
    const tasks=[...new Set(S.tasks.map(t=>t.id))].sort();
    const types=[...new Set(S.tasks.flatMap(t=>(t.events||[]).map(e=>e.type)))].sort();
    wrap.append(histFilters("events",JSON.stringify([tasks,types]),box=>{
      box.append(hsel(f.task,tasks,"Все задачи",v=>{f.task=v;render()}),
        hsel(f.type,types,"Все типы",v=>{f.type=v;render()}))}));
    const evs=S.tasks.flatMap(t=>(t.events||[]).map(e=>({...e,taskId:t.id}))).filter(e=>(f.task==="all"||e.taskId===f.task)&&(f.type==="all"||e.type===f.type)).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    for(const e of evs.slice(0,300)){const r=el("div","feed-item");
      r.append(el("span","tm",time(e.createdAt)),el("span","who",e.taskId),el("span","",e.type+(e.sourceAgent?" · "+e.sourceAgent:"")+(e.targetAgent?" → "+e.targetAgent:"")));
      wrap.append(r)}
    if(!evs.length)wrap.append(el("p","page-sub","Событий нет — поправьте фильтры."))}
  main.replaceChildren(wrap)}

/* ── плагины: серверный каталог Qwen extensions ── */
let pluginRequest=0;
function pluginInstallGuide(){
  const details=el("details","coord-disclosure"),guide=el("div","plugin-guide");details.append(el("summary","","Как добавить extension: подробная инструкция"),guide);
  const step=(title,text,code)=>{guide.append(el("h3","",title),el("p","",text));if(code)guide.append(el("pre","",code))};
  step("1. Проверьте Qwen CLI","Откройте терминал под тем же пользователем, который запускает Agent Network. Эти команды и установка плагина не требуют ответа модели.","qwen --version\nqwen extensions list");
  step("2. Создайте папку плагина","Пример для Windows: D:\\Plugins\\frontend-kit. Один extension может содержать несколько связанных skills. В корне должен лежать именно qwen-extension.json.","frontend-kit/\n├── qwen-extension.json\n└── skills/\n    └── ui-review/\n        ├── SKILL.md\n        └── references/\n            └── checklist.md");
  step("3. Заполните qwen-extension.json","Укажите уникальное имя: латиница, цифры, дефис, точка или подчёркивание; не используйте имя none. Описание должно объяснять назначение пакета — по нему координатор выбирает плагин.",JSON.stringify({name:"frontend-kit",version:"1.0.0",description:"Проверка интерфейсов: формы, адаптивность и доступность."},null,2));
  step("4. Добавьте обычный skill","Скопируйте всю папку существующего skill, включая references, scripts и assets. Сохраните относительные пути. Проверьте инструкции на команды и инструменты, доступные только в другом CLI. Минимальный skills/ui-review/SKILL.md:","---\nname: ui-review\ndescription: Проверять формы, адаптивность и доступность интерфейса.\n---\n\n# Проверка интерфейса\n\nПроверь состояния загрузки, ошибки и пустые данные.\nПроверь подписи полей и управление с клавиатуры.\nДля каждого замечания укажи шаги воспроизведения и ожидаемое поведение.");
  step("5. При необходимости добавьте MCP","Для пакета только со skills этот шаг пропустите. MCP объявляются в mcpServers внутри qwen-extension.json. Пример ниже — фрагмент манифеста: замените команду и путь на свой работающий сервер. Не помещайте секреты в description.",JSON.stringify({mcpServers:{"ui-tools":{command:"node",args:["D:/Plugins/my-mcp-server/index.js"]}}},null,2));
  step("6. Установите extension","Выполните команду с путём к вашей папке. Qwen устанавливает копию: простое редактирование исходной папки не обновляет установленный плагин. Затем проверьте список.",'qwen extensions install "D:\\Plugins\\frontend-kit"\nqwen extensions list');
  step("7. Проверьте плагин в Agent Network","На этой странице должна появиться карточка frontend-kit. Включите её, чтобы разрешить выбор координатору. Для назначения нужен настроенный Qwen runner; саму сессию для проверки каталога запускать не требуется. Skill внутри Qwen будет называться frontend-kit:ui-review.");
  step("8. Дайте задачу координатору","Например: «Подготовь задачу на проверку формы входа. Для Qwen-проверяющего выбери плагин frontend-kit». В предложении проверьте раздел «Плагины команды». После подтверждения выбранный набор применится к новым сессиям. Уже работающие сессии не изменятся.");
  step("Как обновить плагин","Измените исходную папку, обновите установленную копию и снова проверьте список. После изменения манифеста старое предложение может не пройти проверку — попросите координатора подготовить новую версию.","qwen extensions update frontend-kit\nqwen extensions list");
  step("Если карточка не появилась","Проверьте успешность установки, корректность JSON и наличие ~/.qwen/extensions/<папка>/qwen-extension.json у пользователя, запустившего сервер Agent Network. Каталог пока читает этот формат манифеста. Дубли имён, некорректные манифесты и плагины с MCP по имени agent-network не принимаются. Страница обновляет каталог автоматически; при необходимости обновите её вручную.");
  return details;
}
function renderPlugins(){
  const main=$("main"),key=String(project||"");let wrap=main.querySelector(".plugins-wrap");
  if(!wrap){wrap=el("div","wrap plugins-wrap");wrap.append(el("h1","page-h","Плагины"),el("p","page-sub","Загрузка установленных плагинов…"));main.replaceChildren(wrap)}
  const request=++pluginRequest;
  getJSON(q("/api/plugins")).then(data=>{
    if(request!==pluginRequest||route.name!=="settings"||route.sub!=="plugins"||String(project||"")!==key)return;
    const signature=JSON.stringify(data);if(wrap.dataset.signature===signature)return;wrap.dataset.signature=signature;
    const top=el("div","plugin-heading");top.append(el("h1","page-h","Плагины"),el("span","badge acc","Qwen extensions"));
    const note=el("p","page-sub","Координатор выбирает плагины для каждого агента. Их skills, MCP и инструкции подключаются только после подтверждения задачи.");
    const team=el("p","page-sub",data.qwenAgents.length?"Доступны Qwen runners: "+data.qwenAgents.join(", "):"Qwen runners пока не настроены. Назначение плагинов доступно только для Qwen.");
    const grid=el("div","plugin-grid");
    for(const p of data.plugins){
      const card=el("article","plugin-card"+(p.enabled?"":" off"));
      const title=el("div","plugin-title");title.append(el("h3","",p.name),el("span","plugin-version",p.version),badge(p.enabled?"lime":"",p.enabled?"доступен координатору":"отключён"));
      card.append(title,el("p","plugin-desc",p.description||"Описание не указано в манифесте."));
      const chips=el("div","plugin-components");chips.append(el("span","",p.skills.length+" skills"),el("span","",p.mcpServers.length+" MCP"));card.append(chips);
      const details=el("details","coord-disclosure");details.append(el("summary","","Состав плагина"),el("pre","","Skills: "+(p.skills.join(", ")||"нет")+"\nMCP: "+(p.mcpServers.join(", ")||"нет")));card.append(details);
      const toggle=el("button","ghost small",p.enabled?"Отключить":"Включить");toggle.disabled=!S.control;
      toggle.onclick=async()=>{toggle.disabled=true;try{await post("/api/plugins/enabled",{id:p.id,enabled:!p.enabled});renderPlugins()}catch(e){toast("bad","Не удалось изменить плагин",e.message);toggle.disabled=false}};
      card.append(toggle);grid.append(card);
    }
    if(!data.plugins.length)grid.append(el("div","coord-empty","Установленных Qwen-плагинов не найдено. Установите расширение через Qwen CLI — оно появится здесь автоматически."));
    const install=pluginInstallGuide();install.open=!data.plugins.length;
    wrap.replaceChildren(top,note,team,grid,install);
  }).catch(e=>{if(request===pluginRequest&&wrap.isConnected)toast("bad","Не удалось загрузить плагины",e.message)});
}

/* ── расписания (#/settings/schedules, #28): порт v1 — список, форма, превью cron ── */
const schedState=new Map();let schedForm=null,schedScreen=null;
function openScheduleForm(x){
  const s=S;const ids=s.control?s.control.runners.map(r=>r.id):[];const c=x?x.config:{enabled:true,agents:ids.slice(0,2)};
  const f=el("form","card sform");f.noValidate=true;
  const field=(label,name,value,attrs)=>{const l=el("label","",label);const i=document.createElement(attrs&&attrs.tag||"input");i.name=name;if(value!==undefined&&value!==null)i.value=String(value);Object.entries(attrs||{}).forEach(([k,v])=>{if(k!=="tag")i.setAttribute(k,v)});l.append(i);return l};
  f.append(el("b","",x?"Расписание "+x.id:"Новое расписание"));
  const r1=el("div","row2");r1.append(field("id (латиница, цифры, -)","id",c.id,{placeholder:"nightly-flaky-tests",required:""}),field("cron (местное время)","cron",c.cron||"0 3 * * 1-5",{placeholder:"0 3 * * 1-5 или @daily"}));f.append(r1);
  const prev=el("div","note","");f.append(prev);
  f.append(field("Название задачи ({date}, {time} подставятся)","title",c.title,{placeholder:"Flaky tests {date}"}),field("Описание — что сделать, кто что делает","description",c.description,{tag:"textarea"}));
  const ag=el("div","row2");const lead=document.createElement("select");lead.name="lead";ids.forEach(id=>lead.append(new Option(id,id)));if(c.agents&&c.agents[0])lead.value=c.agents[0];
  const ll=el("label","","Lead (интегрирует)");ll.append(lead);const ol=el("label","","Остальные агенты");const others=el("div","checks");ol.append(others);
  const drawOthers=()=>{const keep=new Set([...others.querySelectorAll("input:checked")].map(i=>i.value));const first=!others.children.length;others.replaceChildren();
    ids.forEach(id=>{const l=el("label","chk");const i=document.createElement("input");i.type="checkbox";i.value=id;i.checked=id!==lead.value&&(first?(c.agents||[]).slice(1).includes(id):keep.has(id));i.disabled=id===lead.value;l.append(i,id);others.append(l)})};
  lead.onchange=drawOthers;drawOthers();ag.append(ll,ol);f.append(ag);
  const r2=el("div","row3");r2.append(field("Сборка и тесты (verifyCommand)","verifyCommand",c.verifyCommand,{placeholder:s.control&&s.control.verifyCommand?"по умолчанию "+s.control.verifyCommand:"без проверки сборки"}),field("Раундов исправлений","maxFixRounds",c.maxFixRounds,{type:"number",min:"0",max:"20",placeholder:"3"}),field("Лимит стоимости, $","maxCostUsd",c.maxCostUsd,{type:"number",min:"0",step:"0.5",placeholder:s.control&&s.control.maxTaskCostUsd?"по умолчанию $"+s.control.maxTaskCostUsd:"без лимита"}));f.append(r2);
  const en=el("label","chk");const ei=document.createElement("input");ei.type="checkbox";ei.name="enabled";ei.checked=c.enabled!==false;en.append(ei,"включено");
  const note=el("span","note","");const save=el("button","",x?"Сохранить":"Добавить");save.type="submit";const cancel=el("button","ghost","Отмена");cancel.type="button";
  cancel.onclick=()=>{schedForm=null;render()};
  const bar=el("div","checks");bar.append(en,save,cancel,note);f.append(bar);
  let timer=null;const preview=()=>{clearTimeout(timer);timer=setTimeout(async()=>{const v=f.elements.namedItem("cron").value.trim();if(!v){prev.textContent="";return}
    try{const r=await fetch(q("/api/schedules/preview?cron="+encodeURIComponent(v)),{cache:"no-store"});const j=await r.json();prev.className="note"+(r.ok?"":" bad");
      prev.textContent=r.ok?(j.next.length?"ближайшие запуски: "+j.next.map(t=>new Date(t).toLocaleString([],{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})).join(" · "):"не наступит никогда"):j.message}catch(e){prev.textContent=e.message}},250)};
  f.elements.namedItem("cron").addEventListener("input",preview);preview();
  f.onsubmit=async ev=>{ev.preventDefault();const v=n=>f.elements.namedItem(n).value;
    const num=n=>v(n)===""?null:Number(v(n));
    const schedule={...(x?x.config:{}),id:v("id").trim(),cron:v("cron").trim(),title:v("title"),description:v("description"),agents:[lead.value,...[...others.querySelectorAll("input:checked")].map(i=>i.value)],
      verifyCommand:v("verifyCommand"),maxFixRounds:num("maxFixRounds"),maxCostUsd:num("maxCostUsd"),enabled:ei.checked};
    save.disabled=true;note.className="note";note.textContent="сохраняю…";
    try{await post(x?"/api/schedules/"+encodeURIComponent(x.id)+"/update":"/api/schedules",{schedule});schedForm=null;await tick()}
    catch(e){note.className="note bad";note.textContent=e.message;save.disabled=false}};
  schedForm={el:f,id:x?x.id:null};render();setTimeout(()=>f.elements.namedItem(x?"title":"id").focus(),0)}
function schedRow(x,s){
  const st=schedState.get(x.id);
  const r=el("div","srow"+(x.enabled?"":" off"));
  const sw=document.createElement("input");sw.type="checkbox";sw.checked=x.enabled;sw.disabled=!s.control;sw.title=x.enabled?"выключить":"включить";
  sw.onchange=async()=>{sw.disabled=true;try{await post("/api/schedules/"+encodeURIComponent(x.id)+"/enabled",{enabled:sw.checked});await tick()}catch(e){toast("bad","Не сохранилось",e.message);sw.checked=!sw.checked;sw.disabled=false}};
  const nm=el("div","nm");nm.append(el("b","",x.title),el("span","",x.id+" · "+x.agents.join(", ")+(x.openspec?" · OpenSpec "+x.openspec:"")));
  const nx=el("div","nx");if(x.nextRunAt){const d=new Date(x.nextRunAt);const same=d.toDateString()===new Date().toDateString();nx.append(el("div","",(same?"":d.toLocaleDateString([],{day:"numeric",month:"short"})+" ")+time(x.nextRunAt).slice(0,5)),el("div","sub2","через "+mins(Math.max(0,d-Date.now()))))}else nx.append(el("span","muted",x.enabled?"не наступит":"выключено"));
  const run=x.runs[0];
  const last=el("div","last"+(run&&run.error?" err":run&&run.skipped?" skip":""),!run?"ещё не запускалось":run.taskId?time(run.at).slice(0,5)+" → "+run.taskId+(x.openTask===run.taskId?" (идёт)":""):run.skipped?time(run.at).slice(0,5)+" пропуск: "+run.skipped:time(run.at).slice(0,5)+" ошибка: "+run.error);
  if(st&&st.note)last.append(el("div","sub2",st.note));
  const b=el("button","ghost small",st&&st.pending?"Ставлю…":"Запустить сейчас");b.type="button";b.disabled=!s.control||!!(st&&st.pending);b.title=x.openTask?"пропустится: "+x.openTask+" ещё открыта":"поставить задачу сейчас";
  b.onclick=async()=>{schedState.set(x.id,{pending:true});render();
    try{const j=await post("/api/schedules/"+encodeURIComponent(x.id)+"/run",{});schedState.set(x.id,{note:j.run.taskId?"создана "+j.run.taskId:j.run.skipped?"пропуск: "+j.run.skipped:"ошибка: "+j.run.error})}catch(e){schedState.set(x.id,{note:"ошибка: "+e.message})}await tick()};
  const acts=el("div","sacts");acts.append(b);
  if(s.control){const ed=el("button","ghost small","Изменить");ed.type="button";ed.disabled=!!schedForm;ed.onclick=()=>openScheduleForm(x);
    const del=el("button","ghost small","Удалить");del.type="button";del.disabled=!!schedForm;
    del.onclick=async()=>{if(!await ask("Удалить расписание "+x.id+" из runners.json? Уже созданные им задачи останутся."))return;try{await post("/api/schedules/"+encodeURIComponent(x.id)+"/delete",{});await tick()}catch(e){toast("bad","Не удалилось",e.message)}};acts.append(ed,del)}
  r.append(sw,nm,el("div","cr",x.cron),nx,last,acts);return r}
function renderSchedulesScreen(){
  const s=S;if(!s)return;const main=$("main");
  const list=s.schedules||[];
  const sig=JSON.stringify([list,Math.floor(Date.now()/60000),JSON.stringify([...schedState]),!!s.control,schedForm?schedForm.id||"new":""]);
  if(schedScreen&&schedScreen.dataset.sig===sig&&schedScreen.isConnected){main.replaceChildren(schedScreen);return}
  const wrap=el("div","wrap");schedScreen=wrap;wrap.dataset.sig=sig;
  wrap.append(el("h1","page-h","Расписания"),el("p","page-sub","Задачи по cron. Задача не ставится, пока предыдущая из того же расписания открыта."));
  const ph=el("div","sched-head");
  if(s.control&&!schedForm){const add=el("button","ghost small","+ Расписание");add.type="button";add.onclick=()=>openScheduleForm(null);ph.append(add)}
  wrap.append(ph);
  if(schedForm)wrap.append(schedForm.el);
  if(!list.length)wrap.append(el("div","muted spad","Расписаний нет. «+ Расписание» — задача по cron: например, каждую ночь искать и чинить нестабильные тесты."));
  for(const x of list)wrap.append(schedRow(x,s));
  main.replaceChildren(wrap)}

/* ── проекты (#/settings/projects, #31): порт v1 — открытые, известные, добавить ── */
let projErr=null;
function gotoProject(id){project=id;const u=new URL(location.href);u.searchParams.set("project",id);history.replaceState(null,"",u);
  ATT=null;seenTasks.clear();tasklistSig="";location.hash="#/inbox";tick()}
async function projAct(what,body,after){projBusy=what;if(projErr)projErr.hidden=true;render();
  try{const j=await post("/api/projects/"+what,body);if(after)after(j)}catch(e){if(projErr){projErr.textContent=e.message;projErr.hidden=false}}
  projBusy=null;await tick()}
function renderProjectsScreen(){
  const main=$("main");const wrap=el("div","wrap");schedScreen=null;
  wrap.append(el("h1","page-h","Проекты"),el("p","page-sub","Открыть, закрыть, добавить проект в страницу."));
  projErr=el("div","note bad");projErr.hidden=true;wrap.append(projErr);
  const t=el("table","tbl");
  t.append(theadRow(["Проект","Ветка","HEAD","Задачи","Runner'ы","OpenSpec","Вопросы","Расход 24ч","Активность"]));
  PROJ.forEach(p=>{const r=el("tr","click"+(p.id===project?" sel":""));r.onclick=e=>{if(e.target.closest("button")||e.target.closest("a"))return;if(p.id!==project)gotoProject(p.id)};
    const c1=el("td");const path=el("div","muted mono path",p.projectDir);path.title=p.projectDir;c1.append(el("b","",p.name),path);
    const k=p.tasks;const tasks=[k.running?k.running+" идёт":"",k.queued?k.queued+" в очереди":"",k.blocked?k.blocked+" BLOCKED":"",k.done?k.done+" готово":"",k.cancelled?k.cancelled+" отменено":""].filter(Boolean).join(" · ")||"нет задач";
    const c5=el("td","nw");if(p.runners){c5.append(dot(p.runners.working?"ok":p.runners.running?"warn":""),el("span","mono"," "+p.runners.running+"/"+p.runners.total))}else c5.append(el("span","muted","только чтение"));
    const c7=el("td","mono",String(p.openQuestions));if(p.openQuestions)c7.style.color="var(--warn)";
    if(PROJ_CAN&&PROJ.length>1&&p.control){const b=el("button","ghost small","Закрыть");b.type="button";b.disabled=!!projBusy;b.title="остановить runner'ы, надзор и расписания проекта и убрать его со страницы; в списке он останется";b.style.display="block";b.style.padding="2px 0";
      b.onclick=async()=>{if(!await ask(p.name+": закрыть? Его runner'ы, надзор и расписания остановятся (идущие сессии агентов тоже), проект останется в списке."))return;
        await projAct("close",{id:p.id},()=>{if(project===p.id){const other=PROJ.find(x=>x.id!==p.id);project=other?other.id:null;const u=new URL(location.href);if(other)u.searchParams.set("project",other);else u.searchParams.delete("project");history.replaceState(null,"",u);ATT=null;seenTasks.clear();tasklistSig="";location.hash="#/inbox"}})};c1.append(b)}
    const sp=p.spend24h;r.append(c1,td(p.git?p.git.branch:"—","mono"),td(p.git?p.git.head:"не git",p.git?"mono":"muted"),td(tasks,"mono"),c5,td(p.openspec?p.openspec+" change":"—",p.openspec?"mono":"muted"),c7,
      td(sp.usd!==null?fmtUsd(sp.usd,sp.estimated)+(sp.unpriced?" · без цены: "+sp.unpriced:""):sp.unpriced?"нет цены":"—",sp.usd!==null?"mono":"muted"),td(p.lastActivity?ago(p.lastActivity):"—","muted"));t.append(r)});
  wrap.append(t);
  if(PROJK.length){wrap.append(el("h2","sub-h","Известные из папки проектов"));
    const kt=el("table","tbl");kt.append(theadRow(["Проект","Открытые задачи","Активность","Где открыт"]));
    PROJK.forEach(k=>{const r=el("tr");const c1=el("td");const path=el("div","muted mono path",k.path);path.title=k.dir;c1.append(el("b","",k.name),path);
      const open=!k.exists?"папки нет":k.open?k.open+(k.blocked?" · "+k.blocked+" BLOCKED":""):"нет";
      const where=el("td");if(k.servedBy){const a=el("a","",k.servedBy);a.href=k.servedBy;a.target="_blank";a.rel="noopener";where.append(el("span","muted","на другой странице: "),a)}else where.append(el("span","muted","нигде"));
      const c5=el("div","checks");c1.append(c5);
      if(PROJ_CAN&&k.exists&&!k.servedBy){const b=el("button","small","Открыть");b.type="button";b.disabled=!!projBusy;b.title="загрузить проект в эту страницу: его runner'ы, надзор, расписания — как ui в его папке";
        b.onclick=()=>projAct("open",{dir:k.dir},j=>gotoProject(j.project.id));c5.append(b)}
      if(PROJ_CAN&&!k.servedBy){const f=el("button","ghost small","Убрать из списка");f.type="button";f.disabled=!!projBusy;f.title="только из списка: в проекте ничего не меняется; появится снова после ui в нём";
        f.onclick=()=>projAct("forget",{dir:k.dir});c5.append(f)}
      r.append(c1,td(open,k.open?"mono":"muted"),td(k.lastActivity?ago(k.lastActivity):"—","muted"),where);kt.append(r)});
    wrap.append(kt)}
  if(PROJ_CAN){const af=el("div","addproj");const inp=el("input");inp.placeholder="D:\\path\\to\\project";inp.setAttribute("aria-label","Папка проекта");
    const go=el("button","small","Открыть проект");go.type="button";go.disabled=!!projBusy;
    go.onclick=()=>{const dir=inp.value.trim();if(!dir)return;projAct("open",{dir},j=>gotoProject(j.project.id))};
    inp.onkeydown=e=>{if(e.key==="Enter")go.click()};
    af.append(el("span","muted","Добавить по папке:"),inp,go);wrap.append(af)}
  main.replaceChildren(wrap)}

/* ── наблюдатель (#/settings/observer, #28): порт v1 — KPI, предложения, проблемы, отчёты ── */
let OBS=null,obsScreen=null;const obsOpen=new Set(),obsReports=new Map(),obsState=new Map();
const OBS_PRIO={high:"bad",medium:"warn",low:""};
function renderObserverScreen(){
  const main=$("main");const o=OBS;
  if(!o||!o.observer){obsScreen=null;
    const w=el("div","wrap");w.append(el("h1","page-h","Наблюдатель"));
    w.append(el("div","cat-note",'Наблюдатель не настроен: добавьте секцию "observer" в runners.json (есть в примерах) и перезапустите ui.'));
    main.replaceChildren(w);return}
  const ob=o.observer;
  const sig=JSON.stringify([o.reports,o.proposals,o.issues,ob.running&&ob.running.at,ob.runs.length,ob.digests,[...obsState],[...obsOpen]]);
  if(obsScreen&&obsScreen.dataset.sig===sig&&obsScreen.isConnected){main.replaceChildren(obsScreen);return}
  const wrap=el("div","wrap");obsScreen=wrap;wrap.dataset.sig=sig;
  const top=el("div","obs-head");top.append(el("h1","page-h","Наблюдатель"));
  if(S&&S.control){const run=el("button","small",ob.running?"работает…":"Запустить сейчас");run.type="button";run.disabled=!!ob.running;
    run.onclick=async()=>{run.disabled=true;try{await post("/api/observer/run",{});await tick()}catch(e){toast("bad","Не запустился",e.message);run.disabled=false}};top.append(run)}
  wrap.append(top);
  const kpis=el("div","kpi2");const kpi=(label,value,sub)=>{const d=el("div","k2");d.append(el("div","l",label),el("div","v",value),el("div","h",sub||""));kpis.append(d)};
  const last=ob.runs[0];
  kpi("сейчас",ob.running?"работает":"ждёт",ob.running?"с "+time(ob.running.at).slice(0,5):ob.cron?"по cron "+ob.cron+(ob.nextRunAt?" · следующий "+new Date(ob.nextRunAt).toLocaleString([],{weekday:"short",hour:"2-digit",minute:"2-digit"}):""):"только кнопкой");
  kpi("новых закрытых задач",String(ob.digests.uncovered),"всего итогов: "+ob.digests.total);
  kpi("последний запуск",last?time(last.at).slice(0,5):"—",last?(last.reportId?last.reportId:"без отчёта")+(last.costUsd!==undefined?" · $"+last.costUsd:"")+" · "+ob.cli+(ob.model?" "+ob.model:""):ob.cli+(ob.model?" "+ob.model:""));
  wrap.append(kpis);
  const open=o.proposals.filter(p=>p.status==="open");
  const props=el("div","panel2");const ph1=el("div","ph2");ph1.append(el("span","","Предложения"),el("span","end",open.length+" ждут решения · всего "+o.proposals.length));props.append(ph1);
  const plist=el("div","");if(!o.proposals.length)plist.append(el("div","muted spad","Предложений пока нет."));
  [...open,...o.proposals.filter(p=>p.status!=="open")].forEach(p=>{const c=el("div","oprop"+(p.status==="open"?"":" decided"));const st=obsState.get(p.id)||{};
    const hd=el("div","obs-card-head");hd.append(el("b","",p.title),badge(OBS_PRIO[p.priority]||"",p.priority),el("span","chip",p.target==="agent-network"?"agent-network-mcp":"проект"),el("span","muted",p.id+" · "+p.reportId));c.append(hd);
    [["Проблема",p.problem],["Где видно",p.evidence],["Во что обходится",p.impact],["Что сделать",p.fix]].forEach(([l,v])=>{const r=el("div","orow");r.append(el("div","lbl",l),longText(v,"op-"+p.id+l,300));c.append(r)});
    if(p.status==="accepted")c.append(el("div","note ok","принято: задача "+p.taskId+(p.network?" · "+p.network:"")));
    else if(p.status==="rejected")c.append(el("div","note","отклонено: "+p.rejectReason));
    else if(S&&S.control){const r=el("div","checks");const ag=document.createElement("input");ag.value=st.agents||(p.target==="agent-network"?"backend,reviewer":S.control.runners.map(x=>x.id).slice(0,2).join(","));ag.title="агенты задачи через запятую, первый — lead";ag.style.maxWidth="220px";
      ag.oninput=()=>obsState.set(p.id,{...st,agents:ag.value});
      const acc=el("button","small","Принять → задача");acc.type="button";acc.disabled=!!st.pending;
      acc.onclick=async()=>{const where=p.target==="agent-network"?"в сети agent-network-mcp ("+o.agentNetworkNetwork+"): там должны работать runner'ы этих агентов":"в этом проекте";
        if(!await ask("Создать задачу «"+p.title+"» "+where+"? Агенты: "+ag.value))return;obsState.set(p.id,{pending:true});render();
        try{const r=await post("/api/observer/proposals/"+p.id+"/accept",{agents:ag.value.split(",").map(x=>x.trim()).filter(Boolean)});obsState.delete(p.id);toast("ok","Создана "+r.task.id,r.task.here?"в этом проекте":"в "+r.task.network)}catch(e){obsState.set(p.id,{error:e.message})}await tick()};
      const rej=el("button","ghost small","Отклонить");rej.type="button";rej.disabled=!!st.pending;
      rej.onclick=async()=>{const why=await ask("Почему? Наблюдатель прочтёт и больше это не предложит.","причина");if(!why)return;
        try{await post("/api/observer/proposals/"+p.id+"/reject",{reason:why})}catch(e){obsState.set(p.id,{error:e.message})}await tick()};
      r.append(el("span","muted","агенты:"),ag,acc,rej);c.append(r);if(st.error)c.append(el("pre","logbox2",st.error))}
    plist.append(c)});
  props.append(plist);wrap.append(props);
  const iss=el("div","panel2");const ph2=el("div","ph2");ph2.append(el("span","","Известные проблемы"),el("span","end",o.issues.filter(i=>i.status!=="fixed").length+" открыто"));iss.append(ph2);
  const ilist=el("div","");if(!o.issues.length)ilist.append(el("div","muted spad","Пока ничего не отслеживается."));
  o.issues.slice().reverse().forEach(i=>{const r=el("div","oissue");r.append(badge(i.status==="open"?"warn":i.status==="fixed"?"ok":"",i.status),el("b","",i.title),el("span","muted"," · "+i.id+" · задачи: "+i.seenIn.join(", ")),el("div","muted",i.note));ilist.append(r)});
  iss.append(ilist);wrap.append(iss);
  const reps=el("div","panel2");reps.append(el("div","ph2","Отчёты"));
  const rlist=el("div","");if(!o.reports.length)rlist.append(el("div","muted spad","Отчётов пока нет. Наблюдатель запустится по cron или кнопкой «Запустить сейчас»."));
  o.reports.forEach(r=>{const d=el("details","orep");d.dataset.id=r.id;d.open=obsOpen.has(r.id);d.append(el("summary","",r.id+" · "+new Date(r.at).toLocaleString([],{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" · "+r.title+" ("+r.covers.length+" задач)"));
    const body=el("div","omd",obsReports.get(r.id)||"загружаю…");d.append(body);
    const load=async()=>{if(obsReports.has(r.id))return;try{const j=await getJSON(q("/api/observer/reports/"+r.id));obsReports.set(r.id,j.report.markdown);body.textContent=j.report.markdown}catch(e){body.textContent=e.message}};
    d.addEventListener("toggle",()=>{if(d.open){obsOpen.add(r.id);load()}else obsOpen.delete(r.id)});if(d.open)load();rlist.append(d)});
  reps.append(rlist);wrap.append(reps);
  main.replaceChildren(wrap)}

/* ── раскатка (#/settings/deploy, #30): порт v1 — готовые задачи, прогоны, настройки ── */
let DEP=null,depForm=null,depSetDirty=false,depFilter="all",depSetEl=null,depSetSig="";const depOpen=new Set();
const STAGE_RU={merged:"не отправлена",branch:"в ветке, ждёт",running:"идёт раскатка",deployed:"на стенде",failed:"ошибка раскатки"};
const STAGE_FILTERS=[["all","Все"],["merged","Не отправлены"],["branch","В ветке"],["deployed","На стенде"],["running","Идёт"],["failed","Ошибка"]];
const STEP_RU={notes:"Для раскатки",push:"Push в Bitbucket",jenkins:"Job в Jenkins",kubernetes:"Kubernetes"};
const RUN_RU={running:"идёт",ok:"готово",failed:"ошибка",cancelled:"отменена"};
function depIcon(s){return s==="ok"?"✓":s==="failed"?"✗":s==="running"?"…":s==="skipped"?"–":"·"}
function linesToMap(t){const o={};for(const l of String(t||"").split("\n")){const i=l.indexOf("=");if(i>0)o[l.slice(0,i).trim()]=l.slice(i+1).trim()}return o}
function mapToLines(m){return Object.entries(m||{}).map(([k,v])=>k+"="+v).join("\n")}
function stageCell(st){const c=el("td","");const b=badge(st.stage==="deployed"?"ok":st.stage==="running"?"warn":st.stage==="failed"?"bad":"",STAGE_RU[st.stage]+(st.stage==="deployed"?": "+st.envs.join(", "):""));c.append(b);
  if(st.branch){const d=el("div","muted small","");if(st.branchUrl){const a=document.createElement("a");a.href=st.branchUrl;a.target="_blank";a.rel="noopener";a.textContent=st.branch;d.append(a)}else d.append(el("span","mono",st.branch));c.append(d)}
  if(st.lastRun)c.append(el("div","muted small","последняя: "+st.lastRun.id+" → "+st.lastRun.env+" · "+(RUN_RU[st.lastRun.status]||st.lastRun.status)));return c}
function notesView(n){const box=el("div","");const envs=(DEP.settings.environments||[]).map(e=>e.name);
  if(n.missing.length){const w=el("div","note bad");w.textContent="Не задано в окружении: "+n.missing.map(m=>m.env+": "+m.envVar+" ("+m.key+")").join(", ")+". Без них сервис не стартует.";box.append(w)}
  if(!n.properties.length)box.append(el("div","muted","Новых свойств нет ("+n.filesChanged+" файлов в diff)."));
  else{const t=el("table","tbl");t.append(theadRow(["Свойство","Переменная окружения","По умолчанию","Обязательно","Секрет",...envs]));
    for(const p of n.properties){const tr=document.createElement("tr");const k=el("td","");k.append(el("b","mono",p.key));k.append(el("div","muted small",p.source+(p.change==="changed"?" · изменено":"")));tr.append(k,td(p.envVar,"mono"),td(p.defaultValue===undefined?"—":String(p.defaultValue),"mono"),td(p.required?"да":"нет",""),td(p.secret?"да":"",""));
      for(const e of envs){const v=p.inEnv[e];const c=td(v===true?"✓ задано":v===false?(p.required?"✗ нет":"нет"):"?","");if(v===false&&p.required)c.style.color="var(--bad)";c.title=v===null?"нечего проверить: укажите values-файл или список заданных ключей окружения":"";tr.append(c)}
      t.append(tr)}const pn=el("div","");pn.style.overflow="auto";pn.append(t);box.append(pn)}
  const extra=[["Миграции",n.migrations],["Топики Kafka",n.topics.map(x=>x.key+" = "+x.value)],["Внешние адреса",n.endpoints.map(x=>x.key+" = "+x.value)]];
  for(const[h,list]of extra)if(list.length){const d=el("div","muted small",h+": ");d.append(el("span","mono",list.join(", ")));box.append(d)}
  return box}
function renderDeployScreen(){
  const main=$("main");
  if(!DEP){const w=el("div","wrap");w.append(el("h1","page-h","Раскатка"),el("div","muted","загружаю…"));main.replaceChildren(w);return}
  if(!renderDeployScreen.f){renderDeployScreen.f=1;try{depFilter=localStorage.getItem("depFilter")||"all"}catch(e){}}
  const wrap=el("div","wrap");wrap.append(el("h1","page-h","Раскатка"),el("p","page-sub","Влитые задачи → ветка → Jenkins → Kubernetes."));
  const ready=el("div","panel2");ready.append(el("div","ph2","Готовы к раскатке"));const rbody=el("div","");renderDeployReady(rbody);ready.append(rbody);wrap.append(ready);
  const runs=el("div","panel2");const rp=el("div","ph2");const runningN=DEP.runs.filter(r=>r.status==="running").length;rp.append(el("span","","Прогоны"),el("span","end",runningN?runningN+" идёт":""));runs.append(rp);const rlist=el("div","");renderDeployRuns(rlist);runs.append(rlist);wrap.append(runs);
  const set=el("div","panel2");set.append(el("div","ph2","Настройки раскатки"));renderDeploySettings(set);wrap.append(set);
  main.replaceChildren(wrap)}
function renderDeployReady(box){
  box.replaceChildren();
  if(!DEP.ready.length){box.append(el("div","muted spad","Нет влитых задач: после DONE нажмите в карточке задачи «Посмотреть изменения» → «Влить в проект»."));return}
  const fl=el("div","akinds");for(const[k,label]of STAGE_FILTERS){const n=k==="all"?DEP.ready.length:DEP.ready.filter(r=>r.state.stage===k).length;if(k!=="all"&&!n&&depFilter!==k)continue;const b=el("button",depFilter===k?"on":"ghost small",label+" ");b.type="button";b.append(el("span","kcount",String(n)));b.onclick=()=>{depFilter=k;try{localStorage.setItem("depFilter",k)}catch(e){}render()};fl.append(b)}box.append(fl);
  const rows=DEP.ready.filter(r=>depFilter==="all"||r.state.stage===depFilter);
  if(!rows.length){box.append(el("div","muted spad","Нет задач в этом состоянии."));return}
  const t=el("table","tbl");t.append(theadRow(["Задача","","Состояние","Коммит","Влита в",""]));
  for(const r of rows){const tr=document.createElement("tr");tr.append(td(r.id,"mono"),td(r.title,""),stageCell(r.state),td(r.commit.slice(0,7),"mono"),td(r.into+" · "+new Date(r.at).toLocaleString(),""));
    const tdB=document.createElement("td");if(DEP.control){const b=el("button","small",depForm&&depForm.taskId===r.id?"Скрыть":"Раскатить…");b.type="button";b.onclick=()=>{depForm=depForm&&depForm.taskId===r.id?null:{taskId:r.id,env:(DEP.settings.environments[0]||{}).name};render();if(depForm)loadDeployNotes()};tdB.append(b)}tr.append(tdB);
    t.append(tr);
    if(depForm&&depForm.taskId===r.id){const fr=document.createElement("tr");const fc=document.createElement("td");fc.colSpan=6;fc.append(deployForm(r));fr.append(fc);t.append(fr)}}
  const pn=el("div","");pn.style.overflow="auto";pn.append(t);box.append(pn)}
async function loadDeployNotes(){const f=depForm;if(!f)return;f.notes=null;f.err=null;try{f.notes=(await getJSON(q("/api/tasks/"+encodeURIComponent(f.taskId)+"/deploy-notes"))).notes}catch(e){f.err="не удалось прочитать diff задачи"}if(depForm===f)render()}
function deployForm(r){const f=depForm;const box=el("div","dcard");const row=el("div","checks");
  const sel=document.createElement("select");for(const e of DEP.settings.environments){const o=document.createElement("option");o.value=e.name;o.textContent=e.name;sel.append(o)}sel.value=f.env;sel.onchange=()=>{f.env=sel.value;render()};
  row.append(el("span","","Окружение"),sel);box.append(row);
  box.append(el("div","muted small","Ветка: по шаблону "+DEP.settings.bitbucket.branch+" → remote "+DEP.settings.bitbucket.remote+". В неё уйдёт коммит "+r.commit.slice(0,7)+" и всё, чего ещё нет в Bitbucket."));
  box.append(el("h3","sub-h","Для раскатки"));
  if(f.err)box.append(el("div","note bad",f.err));else if(!f.notes)box.append(el("div","muted","читаю diff…"));else box.append(notesView(f.notes));
  const go2=el("button","",f.busy?"Отправляю…":"Отправить в Bitbucket и раскатить на "+f.env);go2.type="button";go2.disabled=!f.notes||!!f.busy;
  go2.onclick=async()=>{const miss=(f.notes.missing||[]).filter(m=>m.env===f.env);
    if(!await ask("Отправить "+r.id+" в Bitbucket (remote "+DEP.settings.bitbucket.remote+") и раскатить на "+f.env+"?"+(miss.length?" В "+f.env+" не задано: "+miss.map(m=>m.envVar).join(", ")+" — сервис может не стартовать.":"")))return;
    f.busy=true;render();try{let res;try{res=await post("/api/tasks/"+encodeURIComponent(r.id)+"/deploy",{env:f.env})}catch(e){
      if(!/контракт|contract/i.test(e.message)||!await ask(e.message+"\n\nВсё равно отправить сервис?"))throw e;res=await post("/api/tasks/"+encodeURIComponent(r.id)+"/deploy",{env:f.env,contractUnreleased:true})}depOpen.add(res.run.id);depForm=null;DEP=await getJSON(q("/api/deploys"));render()}catch(e){f.busy=false;f.err=e.message;render()}};
  box.append(go2);return box}
function renderDeployRuns(box){
  box.replaceChildren();
  if(!DEP.runs.length){box.append(el("div","muted spad","Раскаток ещё не было."));return}
  for(const r of DEP.runs){const card=el("div","dcard");const head=el("div","dhead-row");const t=el("div","");t.append(el("b","mono",r.id+" "),el("span","",r.taskId+" · "+r.taskTitle),el("div","muted small",r.env+" · "+r.branch+" · "+new Date(r.createdAt).toLocaleString()+(r.endedAt?" — "+time(r.endedAt):"")));
    const st=badge(r.status==="ok"?"ok":r.status==="running"?"warn":r.status==="failed"?"bad":"",RUN_RU[r.status]||r.status);const end=el("div","dend");end.append(st);
    if(r.status==="running"&&DEP.control){const x=el("button","ghost small","Отменить");x.type="button";x.onclick=async()=>{if(!await ask("Отменить "+r.id+"? Уже сделанный push не откатится."))return;try{await post("/api/deploys/"+r.id+"/cancel",{});DEP=await getJSON(q("/api/deploys"));render()}catch(e){toast("bad","Не отменилось",e.message)}};end.append(" ",x)}
    head.append(t,end);card.append(head);
    for(const s of r.steps){const line=el("div","step"+(s.status==="running"?" now":s.status==="ok"?" past":""));line.append(el("span","mono",depIcon(s.status)+" "),el("b","",STEP_RU[s.name]||s.name),el("span","muted"," "+(s.summary||"")));
      if(s.link){const a=document.createElement("a");a.href=s.link;a.target="_blank";a.rel="noopener";a.textContent=" открыть";line.append(a)}
      if(s.status==="failed")line.style.color="var(--bad)";card.append(line)}
    const open=depOpen.has(r.id);const more=el("button","ghost small",open?"Свернуть":"Подробнее");more.type="button";more.onclick=()=>{if(open)depOpen.delete(r.id);else depOpen.add(r.id);render()};card.append(more);
    if(open){if(r.notes){card.append(el("h3","sub-h","Для раскатки"));card.append(notesView(r.notes))}
      if(r.push&&r.push.commits.length){card.append(el("h3","sub-h","Ушло в "+r.branch));card.append(el("div","logbox2",r.push.commits.map(c=>c.sha.slice(0,7)+" "+c.subject).join("\n")))}
      for(const s of r.steps)if(s.output){card.append(el("div","muted small",STEP_RU[s.name]+":"));card.append(el("div","logbox2",s.output))}}
    box.append(card)}}
function renderDeploySettings(box){
  const sig=JSON.stringify([DEP.settings,DEP.control]);
  if(depSetEl&&(depSetSig===sig||depSetDirty)&&depSetEl.isConnected){box.append(depSetEl);return}
  const S0=DEP.settings,ro=!DEP.control;const form=el("form","dsetform");form.oninput=()=>{depSetDirty=true};
  const field=(label,value,opts,parent)=>{parent=parent||form;const l=el("label","",label);const i=opts&&opts.area?document.createElement("textarea"):document.createElement("input");i.value=value==null?"":String(value);if(opts&&opts.ph)i.placeholder=opts.ph;if(opts&&opts.area)i.rows=opts.rows||3;i.disabled=ro;l.append(i);parent.append(l);return i};
  form.append(el("h3","","Bitbucket"));
  const fRemote=field("git remote (SSH-адрес репозитория в Bitbucket)",S0.bitbucket.remote,{ph:"origin"});
  const fBranch=field("Шаблон ветки: {task} {change} {slug} {env}",S0.bitbucket.branch,{ph:"feature/{task}-{slug}"});
  const fWeb=field("Ссылка на ветку ({branch}); пусто — для bitbucket.org сама",S0.bitbucket.webUrl||"",{ph:"https://bitbucket.example.com/projects/X/repos/svc/browse?at=refs/heads/{branch}"});
  form.append(el("h3","","Jenkins (через MCP)"),el("div","lead","Для стандартных инструментов trigger_build / get_build / get_build_log достаточно команды, переменных и job."));
  const fCmd=field("Команда MCP-сервера Jenkins, по аргументу на строку",(S0.jenkins.mcpCommand||[]).join("\n"),{area:true,ph:"npx\n-y\n<пакет MCP Jenkins>"});
  const fEnv=field("Переменные MCP: ИМЯ=значение, по строке (значение \${ИМЯ} — из окружения сервера)",mapToLines(S0.jenkins.mcpEnv),{area:true,ph:"JENKINS_URL=https://jenkins.example.com\nJENKINS_TOKEN=\${JENKINS_TOKEN}"});
  const fJob=field("Job",S0.jenkins.job,{ph:"orders-service/deploy"});
  const fParams=field("Параметры job: ИМЯ=значение ({branch} {commit} {env} {task})",mapToLines(S0.jenkins.params),{area:true});
  const fTo=field("Сколько ждать job, минут",S0.jenkins.timeoutMin,{});
  const advanced=el("details","");advanced.append(el("summary","","Нестандартный MCP: инструменты и JSON-аргументы"));form.append(advanced);
  const fTrig=field("Инструмент MCP: запуск job",S0.jenkins.triggerTool,{},advanced);const fTrigA=field("…его аргументы (JSON, плейсхолдеры {job} {params} {branch} {env})",S0.jenkins.triggerArgs,{area:true,ph:'{"jobName": "{job}", "parameters": {params}}'},advanced);
  const fStat=field("Инструмент MCP: статус сборки",S0.jenkins.statusTool,{},advanced);const fStatA=field("…его аргументы (JSON, {job} {build})",S0.jenkins.statusArgs,{area:true},advanced);
  const fLog=field("Инструмент MCP: лог сборки",S0.jenkins.logTool,{},advanced);const fLogA=field("…его аргументы (JSON, {job} {build})",S0.jenkins.logArgs,{area:true},advanced);
  form.append(el("h3","","Kubernetes (только чтение)"));
  const fKc=field("kubectl",S0.kubernetes.kubectl,{});const fCtx=field("Контекст kubeconfig",S0.kubernetes.context,{ph:"dev-cluster"});const fRt=field("Сколько ждать rollout, секунд",S0.kubernetes.rolloutTimeoutSec,{});
  form.append(el("h3","","Окружения"));const envBox=el("div","");form.append(envBox);let envs=S0.environments.map(e=>Object.assign({},e));
  const drawEnvs=()=>{envBox.replaceChildren();const t=el("table","tbl");t.append(theadRow(["Имя","Namespace","Deployment","Метки подов","Values-файл","Заданы там же (ключи или переменные)","Параметры job",""]));
    envs.forEach((e,i)=>{const tr=document.createElement("tr");const cell=(k,ph,toS,fromS)=>{const c=document.createElement("td");const inp=document.createElement("input");inp.value=toS?toS(e[k]):(e[k]||"");inp.placeholder=ph||"";inp.disabled=ro;inp.oninput=()=>{e[k]=fromS?fromS(inp.value):inp.value;depSetDirty=true};c.append(inp);tr.append(c)};
      cell("name","dev");cell("namespace","orders-dev");cell("deployment","orders-service");cell("selector","app=orders-service");cell("valuesFile","deploy/values-dev.yaml");
      cell("provided","DB_PASSWORD, orders.topic",v=>(v||[]).join(", "),v=>v.split(",").map(x=>x.trim()).filter(Boolean));
      cell("jobParams","CLUSTER=dev; REPLICAS=1",v=>Object.entries(v||{}).map(([k,x])=>k+"="+x).join("; "),v=>linesToMap(v.split(";").join("\n")));
      const c=document.createElement("td");if(!ro){const x=el("button","ghost small","×");x.type="button";x.title="убрать окружение";x.onclick=()=>{envs.splice(i,1);depSetDirty=true;drawEnvs()};c.append(x)}tr.append(c);t.append(tr)});
    const pn=el("div","");pn.style.overflow="auto";pn.append(t);envBox.append(pn);if(!ro){const a=el("button","ghost small","+ окружение");a.type="button";a.onclick=()=>{envs.push({name:""});depSetDirty=true;drawEnvs()};envBox.append(a)}};
  drawEnvs();
  const say=el("div","");form.append(say);
  if(!ro){const save=el("button","","Сохранить настройки");save.type="submit";const reset=el("button","ghost","Отменить правки");reset.type="button";reset.onclick=()=>{depSetDirty=false;depSetSig="";render()};form.append(save," ",reset)}
  else form.append(el("div","muted","Только просмотр: запустите страницу с --runners, чтобы менять настройки."));
  form.onsubmit=async ev=>{ev.preventDefault();const num=v=>{const n=Number(v);return Number.isFinite(n)?n:undefined};
    const settings={bitbucket:{remote:fRemote.value,branch:fBranch.value,webUrl:fWeb.value},
      jenkins:{mcpCommand:fCmd.value.split("\n").map(x=>x.trim()).filter(Boolean),mcpEnv:linesToMap(fEnv.value),job:fJob.value,params:linesToMap(fParams.value),triggerTool:fTrig.value,triggerArgs:fTrigA.value,statusTool:fStat.value,statusArgs:fStatA.value,logTool:fLog.value,logArgs:fLogA.value,timeoutMin:num(fTo.value)},
      kubernetes:{kubectl:fKc.value,context:fCtx.value,rolloutTimeoutSec:num(fRt.value)},environments:envs};
    say.className="note";say.textContent="сохраняю…";
    try{const r=await post("/api/deploy/settings",{settings});DEP.settings=r.settings;depSetDirty=false;depSetSig="";render()}catch(e){say.className="note bad";say.textContent=e.message}};
  box.append(form);depSetEl=form;depSetSig=sig}

/* ── надзор (#/settings/supervisor, #27): порт v1 — KPI, решения, журнал, пороги/лимиты/инструменты ── */
let SUP=null,supKind="all",supAll=false,supSetEl=null,supNeedsEl=null,supJournalEl=null,supToolsEl=null,supSet=null;const supSessions=new Map(),supOpen=new Set(),supSeen={project:null,ids:new Set(),needs:new Set()};
const RULES=[["questionAfterSec","вопрос оператору без ответа дольше","с"],["stallMin","нет прогресса у агента в сессии дольше","мин"],["repeatCount","одна и та же команда подряд, раз","×"],["testMin","тестовый процесс живёт дольше","мин"],["refusedCount","отказов в правах за 10 мин, раз","×"],["checkInMin","агент работает над фазой задачи дольше (чек-ин)","мин"]];
const KINDS_J=[["all","all"],["incident","incident"],["action","action"],["needs-you","needs-you"],["note","note"],["session","session"]];
function watchSupervisor(s){const sv=s.supervisor;if(!sv)return;
  if(supSeen.project!==s.project.id){supSeen.project=s.project.id;supSeen.ids=new Set(sv.recent.map(e=>e.id));supSeen.needs=new Set()}
  for(const e of sv.recent){if(supSeen.ids.has(e.id))continue;supSeen.ids.add(e.id);
    if(e.by==="supervisor"&&e.kind==="action")toast("","Надзор"+(e.taskId?" · "+e.taskId:""),e.text,e.taskId)}
  for(const e of sv.needsYou){if(supSeen.needs.has(e.id))continue;supSeen.needs.add(e.id);toast("bad","Надзор: нужно ваше решение"+(e.taskId?" · "+e.taskId:""),e.text,e.taskId).dataset.need=e.id}
  const open=new Set(sv.needsYou.map(e=>e.id));document.querySelectorAll("#toasts [data-need]").forEach(d=>{if(!open.has(d.dataset.need))d.remove()})}
function sessionBox(e){const id=e.data.session;const box=el("div","jsess");const b=el("button","ghost small",supSessions.has(id)?"Скрыть сессию":"Показать сессию");b.type="button";
  const where=el("span","",".agent-network/"+e.data.log+(e.data.transcript?" · транскрипт CLI: "+e.data.transcript:""));where.title=e.data.transcript||e.data.log;box.append(b,where);
  const pre=el("pre","jlog",supSessions.get(id)||"");pre.hidden=!supSessions.has(id);
  box.onclick=ev=>ev.stopPropagation();pre.onclick=ev=>ev.stopPropagation();
  b.onclick=async()=>{if(supSessions.has(id)){supSessions.delete(id);pre.hidden=true;b.textContent="Показать сессию";return}
    b.disabled=true;try{const j=await getJSON(q("/api/supervisor/sessions/"+id));supSessions.set(id,j.text);pre.textContent=j.text;pre.hidden=false;b.textContent="Скрыть сессию"}catch(err){toast("bad","Не удалось прочитать",String(id))}finally{b.disabled=false}};
  return [box,pre]}
function supState(st){return !st.enabled?["","выключен"]:st.session?["ok","работает"]:st.held?["warn","ждёт"]:["acc","следит"]}
function supKpi(label,value,hint,dotCls){const k=el("div","k2");const v=el("div","v");if(dotCls!==undefined)v.append(dot(dotCls)," ");v.append(value);k.append(el("div","l",label),v,el("div","h",hint));return k}
function supNeedsBlock(needs,ctl){
  if(!supNeedsEl)supNeedsEl=el("div","");
  const nsig=needs.map(e=>e.id).join(",")+(ctl?"#c":"");
  if(supNeedsEl.dataset.sig===nsig)return supNeedsEl;
  supNeedsEl.dataset.sig=nsig;supNeedsEl.replaceChildren();
  needs.slice().reverse().forEach(e=>{const c=el("div","need dcard");const hd=el("div","hd");hd.append(el("b","","Нужно ваше решение"),el("span","muted",(e.taskId?e.taskId+" · ":"")+time(e.at)));
    const parts=e.text.split("\nRecommendation: ");c.append(hd,el("div","",parts[0]));if(parts[1])c.append(el("div","rec","Рекомендация надзора: "+parts[1]));
    const r=el("div","row2");if(e.taskId){const o=el("button","ghost small","Открыть задачу");o.type="button";o.onclick=()=>go("tasks",e.taskId);r.append(o)}
    if(ctl){
      const asked=e.data&&e.data.messageId,whom=asked?"ответом на вопрос агента ("+asked+")":"lead'у задачи";
      const note=el("span","note","");const ta=document.createElement("textarea");ta.placeholder="Ваш ответ — уйдёт "+whom;ta.hidden=true;
      const resolve=async(answer,btn)=>{if(answer!==undefined&&!answer.trim()){note.className="note bad";note.textContent="Напишите ответ";return}
        btn.disabled=true;note.className="note";note.textContent="отправляю…";
        try{await post("/api/supervisor/resolve",answer===undefined?{id:e.id}:{id:e.id,answer:answer});supNeedsEl.dataset.sig="";await tick()}catch(err){note.className="note bad";note.textContent=err.message;btn.disabled=false}};
      if(parts[1]&&e.taskId){const a=el("button","small","Принять рекомендацию");a.type="button";a.title="отправит рекомендацию надзора "+whom;a.onclick=()=>resolve(parts[1],a);r.append(a)}
      if(e.taskId){const w=el("button","ghost small","Ответить по-своему");w.type="button";w.onclick=()=>{if(ta.hidden){ta.hidden=false;w.textContent="Отправить ответ";ta.focus()}else resolve(ta.value,w)};r.append(w)}
      const d=el("button","ghost small","Закрыть без ответа");d.type="button";d.title=asked?"агент ничего не получит; его вопрос "+asked+" тоже закроется":"агент ничего не получит";d.onclick=()=>resolve(undefined,d);r.append(d,note);
      c.append(ta)}
    c.append(r);supNeedsEl.append(c)});
  return supNeedsEl}
function supJournalBlock(st,journal){
  if(!supJournalEl)supJournalEl=el("div","sfeed");
  const shown=journal.filter(e=>supKind==="all"||e.kind===supKind).slice().reverse();
  const jsig=supKind+"|"+shown.map(e=>e.id+(e.resolvedAt?"r":"")).join(",")+"|"+!!(st&&st.enabled)+"|"+journal.length;
  if(supJournalEl.dataset.sig===jsig)return supJournalEl;
  supJournalEl.dataset.sig=jsig;supJournalEl.replaceChildren(...(shown.length?shown.map(e=>{const r=el("div","jrow"+(supOpen.has(e.id)?" open":"")+(e.resolvedAt?" resolved":""));r.title=new Date(e.at).toLocaleString([],{hour12:false});
    const tk=el("span","tk",e.taskId||"");if(e.taskId){tk.onclick=ev=>{ev.stopPropagation();go("tasks",e.taskId)}}
    r.append(el("span","tm",time(e.at)),el("span","jk "+e.kind,e.kind),el("span","by",e.by),tk,el("span","txt",e.text+(e.resolvedAt?"\n(решено "+time(e.resolvedAt)+")":"")));
    if(e.kind==="session"&&e.data&&e.data.session)r.append(...sessionBox(e));
    r.onclick=()=>{supOpen.has(e.id)?supOpen.delete(e.id):supOpen.add(e.id);r.classList.toggle("open")};return r}):[el("div","muted spad",st&&st.enabled?"Пока тихо: детектор ничего не нашёл.":"Журнал пуст.")]));
  return supJournalEl}
function supSettingsBlock(st,ctl){
  if(!supSetEl){supSetEl=el("div","");
    const modelState=el("div","note","");
    const form=el("form","inst");const sel=document.createElement("select");const btn=el("button","ghost small","Применить");btn.type="submit";form.append(sel,btn);
    const hint=el("div","muted","");
    const rules=el("div","rules");
    const limits=el("div","limits rules");
    supSetEl.append(el("h3","sub-h","Настройки"),modelState,form,hint,rules,limits,el("div","muted","Пороги меняются здесь или в supervisor.rules в runners.json; лимиты и свои команды — там же. Всё перечитывается на лету."));
    supSet={modelState,form,sel,hint,rules,limits};
    form.onsubmit=async ev=>{ev.preventDefault();let m=sel.value;
      if(m==="__other__"){m=await ask("Модель, как её называет CLI надзора (например sonnet или qwen/qwen3-coder-30b). Чтобы она всегда была в списке, добавьте её в supervisor.models в runners.json.","модель");if(!m){sel.dataset.server="";await tick();return}}
      btn.disabled=true;try{await post("/api/supervisor/model",{model:m});sel.dataset.server="";sel.blur();await tick()}catch(e){toast("bad","Не сохранилось",e.message)}finally{btn.disabled=false}}}
  const u=supSet;
  u.modelState.textContent=st.model?"модель следующей сессии: "+st.model+(st.session&&st.session.model&&st.session.model!==st.model?" (сейчас идёт "+st.session.model+")":""):"модель задана в command (поставьте {model} в command и \"model\" в секции supervisor, чтобы выбирать здесь)";
  u.form.hidden=!st.model||!ctl;u.hint.textContent=st.model&&st.models.length<2?"Список для выбора — supervisor.models в runners.json.":"";u.hint.hidden=!u.hint.textContent;
  const msig=st.models.join("|")+"#"+(st.model||"");
  if(st.model&&document.activeElement!==u.sel&&u.sel.dataset.server!==msig){u.sel.replaceChildren(...st.models.map(m=>new Option(m,m)),new Option("другая…","__other__"));u.sel.value=st.model;u.sel.dataset.server=msig}
  const rsig=JSON.stringify(st.rules)+(ctl?"#c":"");
  if(u.rules.dataset.sig!==rsig&&!u.rules.contains(document.activeElement)){u.rules.dataset.sig=rsig;u.rules.replaceChildren();u.rules.append(el("span","rulecap","задача стала BLOCKED, runner сдался"),el("b","",""));
    RULES.forEach(([k,label,unit])=>{const inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="any";inp.value=String(st.rules[k]);inp.dataset.k=k;inp.disabled=!ctl;inp.title=unit==="×"?"раз":unit;
      const v=el("b","");v.append(inp,el("span","muted"," "+(unit==="×"?"раз":unit)));u.rules.append(el("span","rulecap",label),v)});
    if(ctl){const save=el("button","ghost small","Сохранить пороги");save.type="button";const note=el("span","note","");
      save.onclick=async()=>{const rules={};let bad="";u.rules.querySelectorAll("input[data-k]").forEach(i=>{const n=Number(i.value);if(!(n>0))bad=i.dataset.k;rules[i.dataset.k]=n});
        if(bad){note.className="note bad";note.textContent="порог должен быть больше 0";return}
        save.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/rules",{rules:rules})};u.rules.dataset.sig="";note.className="note ok";note.textContent="сохранено в runners.json";render()}catch(e){note.className="note bad";note.textContent=e.message}finally{save.disabled=false}};
      const r=el("div","row2");r.style.gridColumn="1/-1";r.append(save,note);u.rules.append(r)}}
  const lsig=st.maxSessionsPerHour+"|"+st.budgetUsd+(ctl?"#c":"");
  if(u.limits.dataset.sig!==lsig&&!u.limits.contains(document.activeElement)){u.limits.dataset.sig=lsig;u.limits.replaceChildren();
    const num=(k,v,step,ph)=>{const i=document.createElement("input");i.type="number";i.min="0";i.step=step;i.dataset.k=k;i.value=v===null?"":String(v);i.placeholder=ph;i.disabled=!ctl;return i};
    const per=num("maxSessionsPerHour",st.maxSessionsPerHour,"1",""),bud=num("budgetUsd",st.budgetUsd,"any","нет");
    const b1=el("b","");b1.append(per,el("span","muted"," в час"));const b2=el("b","");b2.append(el("span","muted","$ "),bud,el("span","muted"," за сутки"));
    u.limits.append(el("span","","сессий надзора не больше"),b1,el("span","","расход надзора не больше (пусто — без бюджета)"),b2);
    if(ctl){const save=el("button","ghost small","Сохранить лимиты");save.type="button";const note=el("span","note","");
      save.onclick=async()=>{const p=Number(per.value);const bv=bud.value.trim();
        if(!Number.isInteger(p)||p<1||p>100){note.className="note bad";note.textContent="сессий в час: целое 1..100";return}
        if(bv!==""&&!(Number(bv)>=0)){note.className="note bad";note.textContent="бюджет: число ≥ 0 или пусто";return}
        save.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/limits",{maxSessionsPerHour:p,budgetUsd:bv===""?null:Number(bv)})};u.limits.dataset.sig="";render()}catch(e){note.className="note bad";note.textContent=e.message}finally{save.disabled=false}};
      const r=el("div","row2");r.style.gridColumn="1/-1";r.append(save,note);u.limits.append(r)}}
  return supSetEl}
function supToolsBlock(st,ctl){
  if(!supToolsEl){supToolsEl=el("div","");supToolsEl.append(el("h3","sub-h","Инструменты"),el("div","muted","Выключенный инструмент не попадёт в следующую сессию надзора."),el("div",""))}
  const tlist=supToolsEl.lastElementChild;
  const tsig=st.tools.map(t=>t.name+(t.enabled?"+":"-")).join(",")+(ctl?"#c":"");
  if(tlist.dataset.sig!==tsig){tlist.dataset.sig=tsig;tlist.replaceChildren(...st.tools.map(t=>{const r=el("label","tl"+(t.enabled?"":" off"));const cb=document.createElement("input");cb.type="checkbox";cb.checked=t.enabled;cb.disabled=!ctl;
    cb.onchange=async()=>{cb.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/tools",{name:t.name,enabled:cb.checked})};render()}catch(e){toast("bad","Не сохранилось",e.message);cb.checked=!cb.checked}finally{cb.disabled=false}};
    const nm=el("span","nm",t.name);if(!t.builtin)nm.append(" ",badge("","свой"));r.append(cb,nm,el("span","ds",t.description));return r}))}
  return supToolsEl}
function renderSupervisorScreen(){
  const main=$("main");
  const st=SUP&&SUP.status,journal=(SUP&&SUP.journal)||[],ctl=!!S.control;
  const wrap=el("div","wrap");
  const h=el("div","obs-head");const hd=el("div");hd.append(el("h1","page-h","Надзор"),el("p","page-sub","Помощник оператора. Детектор без модели раз в 10 с смотрит на рой; когда находит инцидент, запускает сессию надзора: она разбирается, чинит, что может, и отдаёт вам то, что решаете только вы."));
  h.append(hd);
  if(st&&ctl){const tg=el("button",st.enabled?"ghost":"small",st.enabled?"Выключить":"Включить");tg.type="button";
    tg.onclick=async()=>{tg.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/"+(st.enabled?"stop":"start"))};await tick()}catch(e){toast("bad","Не вышло",e.message)}finally{tg.disabled=false}};h.append(tg)}
  wrap.append(h);
  if(!st){wrap.append(el("div","cat-note",ctl?"Надзор не настроен. Добавьте секцию \"supervisor\" в runners.json и перезапустите UI. Готовые примеры: examples/runner/runners.claude.example.json (Claude, sonnet) и runners.qwen.example.json (Qwen, модель из LM Studio).":"Только чтение: надзор работает в UI, запущенном с --runners и секцией \"supervisor\" в runners.json."));main.replaceChildren(wrap);return}
  const needs=journal.filter(e=>e.kind==="needs-you"&&!e.resolvedAt);
  const [dc,label]=supState(st);
  const kpis=el("div","kpi2");
  kpis.append(
    supKpi("Состояние",label,st.session?"сессия с "+time(st.session.startedAt)+" · "+st.session.incidents.length+" "+plural(st.session.incidents.length,"инцидент","инцидента","инцидентов"):st.held?st.held:st.queued?"в очереди: "+st.queued:st.enabled?"инцидентов нет":"включите кнопкой «Включить»",dc),
    supKpi("Модель",st.model||"—","CLI: "+st.cli),
    supKpi("Сессии за час",st.sessionsLastHour+" / "+st.maxSessionsPerHour,"лимит maxSessionsPerHour"),
    supKpi("Расход 24ч",fmtUsd(st.spend24h.usd),(st.budgetUsd!==null?"бюджет $"+st.budgetUsd:"без бюджета")+(st.spend24h.unpriced?" · без цены: "+st.spend24h.unpriced:"")),
    supKpi("Ждут вас",String(needs.length),needs.length?"решения только для человека":"нет вопросов к вам"));
  wrap.append(kpis);
  if(needs.length){const np=el("div","panel2");np.append(el("div","ph2","Нужно ваше решение"));np.append(supNeedsBlock(needs,ctl));wrap.append(np)}
  else{supNeedsBlock(needs,ctl)}
  const jp=el("div","panel2");const jph=el("div","ph2");
  const kinds=el("span","akinds");
  KINDS_J.forEach(([k])=>{const b=el("button",k===supKind?"on":"ghost small","");b.type="button";const n=k==="all"?journal.length:journal.filter(e=>e.kind===k).length;b.textContent=k;if(n)b.append(el("span","kcount",String(n)));b.onclick=()=>{supKind=k;render()};kinds.append(b)});
  const jc=el("span","end","");const total=(SUP&&SUP.journalTotal)||journal.length;
  if(journal.length){jc.append(supAll?"все "+total:total>journal.length?"последние "+journal.length+" из "+total:String(total));
    if(total>100){const a=el("a","",supAll?" · только последние 100":" · показать все");a.href="#";a.onclick=async ev=>{ev.preventDefault();supAll=!supAll;await tick()};jc.append(a)}}
  jph.append(el("span","","Журнал"),kinds,jc);jp.append(jph);
  jp.append(supJournalBlock(st,journal));wrap.append(jp);
  const sp=el("div","panel2");sp.append(el("div","ph2","Настройки и инструменты"));
  const sbody=el("div","spad2");sbody.append(supSettingsBlock(st,ctl),supToolsBlock(st,ctl));sp.append(sbody);wrap.append(sp);
  const lg=el("details","sup-log");lg.append(el("summary","","Лог надзора"));const pre=el("div","logbox2","");lg.append(pre);wrap.append(lg);
  if(lg.open){const atEnd=pre.scrollTop+pre.clientHeight>=pre.scrollHeight-8;pre.textContent=st.log.length?st.log.join("\n"):"(пусто)";if(atEnd)pre.scrollTop=pre.scrollHeight}
  main.replaceChildren(wrap)}

/* ── настройки (#/settings[/<sub>]): меню; экраны переносятся (#27–31) ── */
function renderSettings(){
  const main=$("main");const wrap=el("div","wrap");
  if(route.sub==="plugins")return renderPlugins();
  if(route.sub==="schedules")return renderSchedulesScreen();
  if(route.sub==="projects")return renderProjectsScreen();
  if(route.sub==="observer")return renderObserverScreen();
  if(route.sub==="deploy")return renderDeployScreen();
  if(route.sub==="supervisor")return renderSupervisorScreen();
  if(route.sub){wrap.append(settingsStub(route.sub));main.replaceChildren(wrap);return}
  wrap.append(el("h1","page-h","Настройки"));
  wrap.append(el("p","page-sub","Надзор, наблюдатель, расписания, раскатка и проекты — каждый своим экраном."));
  const items=[["plugins","Плагины","Установка пакетов со skills, агентами, hooks и MCP. Интерактивный прототип."],
    ["supervisor","Надзор","Помощник оператора: детектор инцидентов, журнал, правила и лимиты."],
    ["observer","Наблюдатель","Смотрит на закрытые задачи и предлагает улучшения системы."],
    ["schedules","Расписания","Задачи по cron: создаются и запускаются сами."],
    ["deploy","Раскатка","Влитые задачи → ветка → Jenkins → Kubernetes."],
    ["projects","Проекты","Открыть, закрыть, добавить проект в страницу."]];
  for(const[id,title,sub]of items){
    const a=el("a","chat-item");a.style.cssText="background:var(--panel);border:1px solid var(--line);color:var(--text);margin:0 0 8px";
    a.href="#/settings/"+id;a.setAttribute("role","listitem");
    a.append(dot("acc"));
    const col=el("span","col");col.append(el("span","nm",title),el("span","pv",sub));a.append(col);
    wrap.append(a)}
  main.replaceChildren(wrap)}

/* ── диспетчер рендера ── */
let projectChatRequest=0;let coordStickBottom=true;
function renderProject(){
  const main=$("main");
  const key=String(project||"");
  let wrap=$("project-chat");
  if(!wrap||wrap.dataset.project!==key){
    wrap=el("div","wrap coord-wrap");wrap.id="project-chat";wrap.dataset.project=key;
    wrap.append(el("h1","page-h","Координатор проекта"),el("p","page-sub","Обсудите цель или попросите подготовить задачу для команды."));
    const statusbar=el("div");statusbar.id="coord-statusbar";wrap.append(statusbar);
    const guideDet=el("details","coord-guide-det coord-disclosure");guideDet.id="coord-guide-det";
    guideDet.append(el("summary","","Как это работает: 3 шага"));
    const guide=el("div","coord-guide");
    for(const [title,detail] of [["1. Опишите цель","Напишите, что нужно сделать. Например: «Создай задачу: добавь проверку файла…»"],["2. Проверьте предложение","Координатор покажет описание и выберет команду."],["3. Подтвердите создание","Задача появится только после нажатия «Подтвердить и создать задачу». До этого агенты не начинают работу."]]){
      const step=el("div","coord-step");step.append(el("b","",title),el("span","",detail));guide.append(step)}
    guideDet.append(guide);wrap.append(guideDet);
    const history=el("div");history.id="project-chat-history";history.setAttribute("aria-live","polite");
    history.onscroll=()=>{coordStickBottom=history.scrollHeight-history.scrollTop-history.clientHeight<90};wrap.append(history);
    const form=el("form","coord-compose");const label=el("label","","Сообщение координатору");label.htmlFor="project-chat-input";
    const input=el("textarea");input.id="project-chat-input";input.rows=4;input.style.width="100%";input.placeholder="Задайте вопрос или начните с «Создай задачу: …»";
    const draftKey="project-chat-draft:"+key;let pending;
    try{pending=JSON.parse(localStorage.getItem(draftKey)||"null")}catch(e){}
    input.value=pending?.content||"";
    input.oninput=()=>{pending={messageId:crypto.randomUUID(),content:input.value};localStorage.setItem(draftKey,JSON.stringify(pending))};
    input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form.requestSubmit()}};
    const error=el("p","bad");error.id="project-chat-error";error.setAttribute("role","alert");input.setAttribute("aria-describedby",error.id);
    const send=el("button","btn","Отправить координатору");send.type="submit";
    form.append(label,input,send,error);wrap.append(form);
    form.onsubmit=async e=>{e.preventDefault();if(!input.value.trim())return;
      if(!pending||pending.content!==input.value)pending={messageId:crypto.randomUUID(),content:input.value};
      localStorage.setItem(draftKey,JSON.stringify(pending));const submitted=pending;send.disabled=true;error.textContent="";
      try{await post("/api/project/messages",submitted);if(input.value===submitted.content){input.value="";pending=null;localStorage.removeItem(draftKey)}renderProject()}
      catch(e){error.textContent=e.message}finally{send.disabled=false}};
    const follow=el("details","coord-disclosure");follow.append(el("summary","","Отправить уточнение в задачу"));
    const followForm=el("form"),target=el("select"),text=el("textarea"),preview=el("pre"),notice=el("p","page-sub");
    target.id="project-follow-target";text.id="project-follow-text";text.rows=3;text.style.width="100%";
    const targetLabel=el("label","","Выберите задачу");targetLabel.htmlFor=target.id;
    const textLabel=el("label","","Точный текст уточнения");textLabel.htmlFor=text.id;
    const draftKeyFollow="project-follow-draft:"+key;let followDraft={operationId:crypto.randomUUID(),taskId:"",content:""};
    try{followDraft=JSON.parse(localStorage.getItem(draftKeyFollow)||"null")||followDraft}catch(e){}
    target.dataset.saved=followDraft.taskId;text.value=followDraft.content;
    const update=()=>{const option=target.selectedOptions[0];preview.textContent=(option?.value?"Адресат: "+option.textContent:"Выберите адресата")+"\\n\\n"+text.value};
    const edit=()=>{followDraft={operationId:crypto.randomUUID(),taskId:target.value,content:text.value};localStorage.setItem(draftKeyFollow,JSON.stringify(followDraft));update()};
    target.onchange=edit;text.oninput=edit;
    const submit=el("button","btn","Отправить в выбранную задачу");submit.type="submit";
    followForm.append(targetLabel,target,textLabel,text,preview,submit,notice);follow.append(followForm);wrap.append(follow);
    followForm.onsubmit=async e=>{e.preventDefault();if(!target.value||!text.value.trim()){notice.textContent="Выберите задачу и введите текст.";return}
      if(followDraft.taskId!==target.value||followDraft.content!==text.value)edit();
      if(!confirm("Отправить уточнение?\\n\\n"+preview.textContent))return;
      const submitted={...followDraft};submit.disabled=true;notice.textContent="Отправляется…";
      try{await post("/api/project/send-to-task",submitted);notice.textContent="Доставлено в очередь задачи. Исполнение ещё не подтверждено.";
        if(text.value===submitted.content&&target.value===submitted.taskId){text.value="";localStorage.removeItem(draftKeyFollow);followDraft={operationId:crypto.randomUUID(),taskId:target.value,content:""};update()}}
      catch(e){notice.textContent=e.message}finally{submit.disabled=false}};
    main.replaceChildren(wrap);
  }
  const request=++projectChatRequest;
  getJSON(q("/api/project")).then(state=>{
    if(request!==projectChatRequest||route.name!=="project"||String(project||"")!==key)return;
    const history=$("project-chat-history");if(!history)return;
    const target=$("project-follow-target");if(target){const value=target.value||target.dataset.saved||"";
      const available=S.tasks.filter(t=>state.tasks.some(link=>link.taskId===t.id)&&["ACTIVE","BLOCKED"].includes(t.status));
      const sig=JSON.stringify(available.map(t=>[t.id,t.title]));if(target.dataset.signature!==sig){target.dataset.signature=sig;
        const empty=el("option","","Выберите задачу");empty.value="";target.replaceChildren(empty);
        for(const task of available){const option=el("option","",task.title+" · "+task.id);option.value=task.id;target.append(option)}target.value=value;
        target.dataset.saved="";}}
    const signature=JSON.stringify(state);if(history.dataset.signature===signature)return;
    if(history.contains(document.activeElement)&&document.activeElement.closest("form"))return;
    history.dataset.signature=signature;
    const content=el("div");
    const queueNote=state.paused?"Обработка сообщений приостановлена.":state.coordinatorConfigured?"Координатор подключён. Сообщения обрабатываются по очереди.":"Координатор не подключён. Сообщения не будут обработаны, пока его не настроят.";
    const statusbar=$("coord-statusbar");if(statusbar){statusbar.replaceChildren();
      const toolbar=el("div","coord-toolbar");toolbar.append(el("p","coord-status",queueNote));
      const pause=el("button","ghost small",state.paused?"Продолжить":"Приостановить");
      pause.onclick=async()=>{try{await post("/api/project/pause",{paused:!state.paused});renderProject()}catch(e){$("project-chat-error").textContent=e.message}};toolbar.append(pause);statusbar.append(toolbar)}
    const guideDet=$("coord-guide-det");if(guideDet)guideDet.open=!state.messages.length;
    if(!state.messages.length)content.append(el("div","coord-empty","Напишите координатору ниже. Чтобы получить задачу на утверждение, начните сообщение с «Создай задачу:» и опишите результат."));
    const labels={queued:"В очереди",running:"Обрабатывает сообщение",succeeded:"Ответ",failed:"Не удалось ответить",cancelled:"Обработка отменена"};
    const thread=el("div","coord-thread");
    for(const message of state.messages){const turn=el("article","coord-turn");
      const user=el("section","coord-bubble user");user.append(el("div","coord-meta","Вы"),el("p","coord-message",message.content));turn.append(user);
      for(const run of state.runs.filter(r=>r.messageId===message.messageId)){const reply=el("section","coord-bubble assistant");
        const runLabel=run.cancelRequested&&run.state==="running"?"Останавливается":labels[run.state]||"Статус координатора";
        reply.append(el("div","coord-meta",run.state==="succeeded"?"Координатор":runLabel));
        if(run.state==="queued"||run.state==="running")reply.append(el("p","coord-status",run.state==="queued"?"Ответ появится здесь автоматически.":"Подготавливает ответ…"));
        if(run.result)reply.append(el("p","coord-result",run.result));
        if(run.error){const errorBox=el("div","coord-error"),friendly=run.error.includes("returned no answer")?"Координатор завершил работу без ответа. Попробуйте повторить запрос.":"Координатор не смог обработать сообщение.";
          errorBox.append(el("p","",friendly));const technical=el("details");technical.append(el("summary","","Технические подробности"),el("pre","",run.error));errorBox.append(technical);reply.append(errorBox)}
        const actions=el("div","coord-actions");
        if(run.state==="failed"){const retry=el("button","btn small","Повторить");retry.onclick=async()=>{retry.disabled=true;try{await post("/api/project/retry",{runId:run.runId,retryRunId:crypto.randomUUID()});renderProject()}catch(e){$("project-chat-error").textContent=e.message}finally{retry.disabled=false}};actions.append(retry)}
        if(run.state==="queued"||run.state==="running"){const cancel=el("button","ghost small",run.state==="queued"?"Убрать из очереди":"Остановить");
          cancel.onclick=async()=>{try{await post("/api/project/cancel",{runId:run.runId});renderProject()}catch(e){$("project-chat-error").textContent=e.message}};actions.append(cancel)}
        if(actions.childNodes.length)reply.append(actions);turn.append(reply)}thread.append(turn)}
    if(state.messages.length){content.append(el("h2","coord-section-title","Переписка"),thread,el("p","page-sub","Остановка ответа не останавливает уже запущенные задачи. Управляйте ими в списке задач."))}
    const proposalStates={pending:"Нужно ваше подтверждение",approved:"Подтверждено, создаём задачу",executed:"Задача создана",rejected:"Предложение отклонено",superseded:"Заменено новой версией",failed:"Предложение не удалось сохранить"};
    const proposals=state.proposals||[];
    if(proposals.length)content.append(el("h2","coord-section-title","Предложения задач"));
    for(const proposal of proposals){const card=el("section","card coord-proposal"),payload=proposal.payload;
      card.append(el("h3","","Предложение задачи: "+payload.title),el("p","",proposal.summary),el("p","",payload.description),el("p","page-sub","Команда: "+payload.agents.join(", ")),
        el("p","page-sub","Стоимость неизвестна. "+(payload.maxCostUsd===undefined?"Лимит не задан.":"Лимит: $"+payload.maxCostUsd+"; это не прогноз.")),el("p","coord-status",proposalStates[proposal.status]||"Статус: "+proposal.status));
      if(proposal.status==="pending")card.append(el("p","page-sub","Задача пока не создана. Проверьте описание и состав команды, затем подтвердите или измените предложение."));
      if(payload.pluginsByAgent){const resources=el("div","coord-disclosure");resources.append(el("h4","","Плагины команды"));
        for(const [agent,ids] of Object.entries(payload.pluginsByAgent))resources.append(el("p","coord-status",agent+": "+(ids.join(", ")||"Без дополнительных плагинов")));card.append(resources)}
      const settings=el("details","coord-disclosure");settings.dataset.disclosure="proposal-"+proposal.proposalId;settings.append(el("summary","","Подробные настройки"),el("pre","",JSON.stringify(payload,null,2)));card.append(settings);
      const result=el("p","page-sub");result.setAttribute("role","status");card.append(result);
      if(proposal.taskId)card.append(taskLink(proposal.taskId,"Создана задача"));
      if(proposal.status==="pending"||proposal.status==="approved"){
        const act=async(action,extra)=>{try{const answer=await post("/api/project/proposals/"+action,{proposalId:proposal.proposalId,hash:proposal.hash,...extra});
          result.textContent=answer.task?"Задача "+answer.task.id+" создана. Она появится в списке «Задачи».":action==="preflight"?"Проверки пройдены. Задача ещё не создана — нажмите «Подтвердить и создать задачу».":"Изменения сохранены.";if(action!=="preflight")renderProject();return answer}
          catch(e){result.textContent=e.message;return null}};
        const check=el("button","btn","Проверить предложение");check.onclick=()=>act("preflight");card.append(check);
        const approve=el("button","btn","Подтвердить и создать задачу");approve.onclick=async()=>{approve.disabled=true;await act("approve");approve.disabled=false};card.append(approve);
        if(proposal.status==="pending"){
          const reject=el("button","btn","Отклонить предложение");reject.onclick=()=>act("reject");card.append(reject);
          const edit=el("button","btn","Изменить предложение");edit.onclick=()=>{
            if(card.querySelector("form"))return;
            const form=el("form"),title=el("input"),description=el("textarea"),summary=el("textarea");title.value=payload.title;description.value=payload.description;summary.value=proposal.summary;
            for(const [label,input] of [["Название",title],["Ожидаемый результат и границы",description],["Описание предложения",summary]]){const field=el("label","",label);field.append(input);form.append(field)}
            const save=el("button","btn","Сохранить новую версию");save.type="submit";form.append(save);card.append(form);title.focus();
            form.onsubmit=async e=>{e.preventDefault();save.disabled=true;save.blur();await act("revise",{payload:{...payload,title:title.value,description:description.value},summary:summary.value});save.disabled=false};};card.append(edit);
        }
      }content.append(card)}
    const related=el("details","coord-disclosure");related.dataset.disclosure="tasks";const relatedTitle=el("summary","","Задачи в обсуждении");relatedTitle.append(el("span","badge",String(state.tasks.length)));related.append(relatedTitle);
    const attentionLabels={question:"Ждёт вашего ответа",blocked:"Нужно решение по блокировке",plan:"Ждёт утверждения плана",acceptance:"Ждёт приёмки",merge:"Ждёт проверки вливания",supervisor:"Ждёт решения",observer:"Ждёт решения"};
    if(!S.tasks.length)related.append(el("p","coord-status","Задач пока нет."));
    for(const task of S.tasks){const link=state.tasks.find(t=>t.taskId===task.id);const row=el("div","coord-task-row"),info=el("div","coord-task-info");info.append(taskLink(task.id,task.title),el("span","page-sub",task.id+" · "+(link?"В контексте координатора":"Не добавлена в обсуждение")));row.append(info);
      if(link){const items=(ATT?.projects.find(p=>p.id===project)?.items||[]).filter(item=>item.taskId===task.id);for(const item of items){const status=el("span","page-sub",attentionLabels[item.kind]||"Ждёт вас");row.append(status,taskLink(task.id,"Открыть"))}}
      const button=el("button","ghost small",link?"Отключить":"Добавить");button.setAttribute("aria-label",(link?"Отключить от обсуждения: ":"Добавить в обсуждение: ")+task.title);button.disabled=!!link&&["ACTIVE","BLOCKED"].includes(task.status);if(button.disabled)button.title="Активная задача остаётся в обсуждении до завершения";
      button.onclick=async()=>{if(link&&!confirm("Coordinator потеряет доступ к контексту этой задачи. Отключить?"))return;button.disabled=true;
        try{await post(link?"/api/project/detach":"/api/project/attach",{taskId:task.id,operationId:crypto.randomUUID()});renderProject()}catch(e){$("project-chat-error").textContent=e.message}finally{button.disabled=false}};row.append(button);related.append(row)}content.append(related);
    if(state.memory){const memory=el("details","coord-disclosure");memory.dataset.disclosure="memory";memory.append(el("summary","","Память проекта"),el("pre","",state.memory.content||"Договорённостей пока нет."));content.append(memory);
      for(const change of state.memory.changes.filter(c=>c.status==="pending")){const card=el("section","card");card.append(el("h3","","Предлагаемое изменение памяти"),el("pre","",change.content));
        for(const approve of [true,false]){const button=el("button","btn",approve?"Подтвердить память":"Отклонить изменение");button.onclick=async()=>{button.disabled=true;try{await post("/api/project/memory/decide",{changeId:change.changeId,approve});renderProject()}catch(e){$("project-chat-error").textContent=e.message}finally{button.disabled=false}};card.append(button)}content.append(card)}}
    const markFocusables=root=>{const counts=new Map();for(const node of root.querySelectorAll("button,input,textarea,select,a[href],[tabindex]")){const card=node.closest("section.card"),label=node.closest("label");const heading=card?.querySelector("h3")?.textContent||"";
      const title=label?.firstChild?.textContent?.trim()||node.textContent?.trim()||node.getAttribute("aria-label")||node.tagName;
      const base=[node.tagName,heading,title].join("|");const count=counts.get(base)||0;counts.set(base,count+1);node.dataset.pfocus=base+"|"+count}};
    markFocusables(history);const active=history.contains(document.activeElement)?document.activeElement:null;markFocusables(content);
    const priorKey=active?.dataset.pfocus;const priorStart=typeof active?.selectionStart==="number"?active.selectionStart:null;const priorEnd=typeof active?.selectionEnd==="number"?active.selectionEnd:null;const stick=coordStickBottom;
    const openSections=new Set([...history.querySelectorAll("details[data-disclosure][open]")].map(node=>node.dataset.disclosure));
    for(const section of content.querySelectorAll("details[data-disclosure]"))section.open=openSections.has(section.dataset.disclosure);
    history.replaceChildren(content);if(stick)history.scrollTop=history.scrollHeight;
    if(priorKey){const replacement=[...history.querySelectorAll("[data-pfocus]")].find(node=>node.dataset.pfocus===priorKey);
      if(replacement){replacement.focus({preventScroll:true});if(priorStart!==null&&typeof replacement.setSelectionRange==="function")replacement.setSelectionRange(priorStart,priorEnd??priorStart)}}
  }).catch(e=>{const error=$("project-chat-error");if(error&&String(project||"")===key)error.textContent=e.message});
}
function renderMain(){
  if(route.name==="project")return renderProject();
  if(route.name==="inbox")return renderInbox();
  if(route.name==="tasks")return renderTask();
  if(route.name==="new")return renderNew();
  if(route.name==="agents")return renderAgents();
  if(route.name==="history")return renderHistory();
  if(route.name==="settings")return renderSettings()}
function render(){if(!S)return;renderChrome();renderSidebar();renderMain();if(DIFFOV)drawDiff()}

/* ── переключатель проектов (⇄) ── */
function projectMenu(anchor){
  document.querySelectorAll(".projpop").forEach(x2=>x2.remove());
  const pop=el("div","projpop");pop.setAttribute("role","menu");
  for(const p of PROJ){const a=el("a",p.id===project?"on":"",(p.git?p.git.branch+" · "+p.git.head+" — ":"")+p.name);a.href="#";
    a.onclick=e=>{e.preventDefault();pop.remove();switchProject(p.id)};pop.append(a)}
  const note=el("div","note","Открыть и закрыть проекты — в «Настройки → Проекты».");pop.append(note);
  document.body.append(pop);
  const r=anchor.getBoundingClientRect();pop.style.position="fixed";pop.style.top=r.bottom+6+"px";pop.style.left=Math.min(r.left,window.innerWidth-260)+"px";
  setTimeout(()=>addEventListener("click",function h(e){if(!pop.contains(e.target)){pop.remove();removeEventListener("click",h)}}),0)}

/* ── уведомления (◔): состояние и запрос разрешения ── */
function bellState(){const perm=typeof Notification==="undefined"?"unsupported":Notification.permission;
  return perm==="granted"?"уведомления браузера включены":perm==="denied"?"уведомления запрещены в настройках браузера":perm==="unsupported"?"браузер не умеет уведомления":"уведомления выключены — нажмите, чтобы включить"}
function watchAttention(){if(!ATT||typeof Notification==="undefined"||Notification.permission!=="granted")return;
  for(const p of ATT.projects)for(const i of p.items){const k=p.id+"/"+i.key;if(seenAtt.has(k))continue;seenAtt.add(k);
    if(attFirst){continue}
    try{const n=new Notification(p.name+": "+i.title.replace(/^[^:]+:\s*/,""),{body:(i.text||"").slice(0,160),tag:p.id+"/"+i.key});
      n.onclick=()=>{window.focus();n.close();if(i.taskId)go("tasks",i.taskId)}}catch(e){}}
  attFirst=false}
const seenAtt=new Set();let attFirst=true;

/* ── план-оверлей и приёмка: та же механика v1 (iframe + postMessage), визуал v2 ── */
function fmtMs(ms){const s=Math.round(ms/1000);if(s<60)return s+" с";const m=Math.round(s/60);if(m<60)return m+" мин";const h=Math.round(m/60);if(h<48)return h+" ч";return Math.round(h/24)+" дн"}
const MC_STEP={merge:"собираю вливание",setup:"ставлю зависимости",build:"сборка",land:"вливаю в проект"};
const PLAN_STATUS={none:"lead пишет план…",awaiting:"план ждёт вас",revising:"lead дорабатывает план по вашему отзыву",approved:"план утверждён"};
const PAGE_WORDS={
  input:{name:"Спека аналитиков ",status:{none:"lead готовит страницу…",awaiting:"ждёт просмотра",revising:"lead смотрит ваши замечания",approved:"просмотрена"},approve:"Посмотрел",send:"Отправить замечания",ask:"Отметить спеку аналитиков просмотренной? Дальше lead проведёт допрос и напишет свой change.",sendAsk:" Замечания станут вопросами допроса.",phase:"DISCUSS",yes:"Да, посмотрел",done:"просмотрена",view:"Их спека как есть: отмечено, где она расходится с кодом и правилами проекта.",sent:"Lead смотрит ваши замечания — новая версия откроется здесь сама."},
  change:{name:"Change ",status:{none:"lead пишет change…",awaiting:"ждёт вас",revising:"lead дорабатывает",approved:"принят"},approve:"Принять change",send:"Вернуть на доработку",ask:"Принять change? Дальше ревьюер проверит его, и после DONE его можно реализовать.",sendAsk:" Lead поправит change и покажет новую версию.",phase:"IMPLEMENT",yes:"Да, принять",done:"принят",view:"Наш change рядом с их: что взято, что адаптировано, отброшено или добавлено — и почему.",sent:"Lead дорабатывает change — новая версия откроется здесь сама."}};
function planWords(t,stage){const w=stage&&PAGE_WORDS[stage];return w||{name:"План ",status:PLAN_STATUS,approve:"Утвердить план",send:"Отправить lead'у",ask:null,sendAsk:" Он посмотрит и пришлёт новую версию плана.",phase:"DISCUSS",yes:"Да, утвердить",done:"утверждён",view:"Вопросы плана отмечайте прямо на странице; ответы уйдут с отзывом.",sent:"Lead дорабатывает план — новая версия откроется здесь сама."}}
/* карточка плана в ленте чата */
function planCard(t){
  const p=t.plan;const w=planWords(t,p.stage);const card=el("div","action-card");
  const h=el("h4","",);h.append(w.name.trim());
  h.append(badge(p.status==="awaiting"?"warn":p.status==="approved"?"ok":"",w.status[p.status]||p.status));card.append(h);
  const bits=[];if(p.version)bits.push("v"+p.version);if(p.by)bits.push("от "+p.by);if(p.at)bits.push(time(p.at));if(p.rounds)bits.push("отзывов: "+p.rounds);if(p.approvedVersion)bits.push("утверждена v"+p.approvedVersion);
  card.append(el("p","",bits.join(" · ")||"Появится здесь, когда lead его напишет; соглашение — после вашего «Утвердить»."));
  const opts=el("div","opts");
  if(p.version){const b=el("button",p.status==="awaiting"&&controlMode?"cta small":"ghost small",p.status==="awaiting"&&controlMode?"Открыть и проверить":"Открыть план");b.type="button";b.onclick=()=>openPlan(t.id);opts.append(b)}
  card.append(opts);return card}
/* карточка приёмки в ленте чата */
function accCard(t){
  const v=t.acceptance;const can=!!S.control&&!v;const card=el("div","action-card");
  const h=el("h4","",);h.append("Пакет приёмки");
  h.append(badge(v?(v.status==="accepted"?"ok":"warn"):"acc",v?(v.status==="accepted"?"принят":"возвращён"+(v.followUp?" → "+v.followUp:"")):"ждёт вас"));card.append(h);
  if(v)card.append(el("p","",time(v.at)));
  const opts=el("div","opts");const b=el("button",can?"cta small":"ghost small",can?"Открыть и проверить":"Открыть");b.type="button";b.onclick=()=>openAcceptance(t.id);opts.append(b);
  card.append(opts);return card}

/* приёмка после DONE: iframe-отчёт + замечания к блокам + «Принять»/«Вернуть» */
let AV=null;let ACC_EL=null;
function accEl(){if(ACC_EL)return ACC_EL;const o=el("div","planov");o.setAttribute("role","dialog");o.setAttribute("aria-label","Пакет приёмки");
  const head=el("div","planhead");const title=el("b","");const x=el("button","ghost","Закрыть");x.type="button";x.onclick=()=>closeAcceptance();head.append(title,x);
  const body=el("div","planbody");const fr=document.createElement("iframe");fr.title="приёмка";const side=el("div","planside");body.append(fr,side);o.append(head,body);document.body.append(o);
  return ACC_EL={o:o,title:title,fr:fr,side:side}}
/* новый фрейм каждый раз: песочничная страница не может перейти на следующую (freshFrame) */
function accFrame(){const fr=document.createElement("iframe");fr.title="приёмка";AV.el.fr.replaceWith(fr);AV.el.fr=fr;fr.src=q("/api/tasks/"+encodeURIComponent(AV.taskId)+"/acceptance/view")}
async function accInfo(){try{AV.info=await getJSON(q("/api/tasks/"+encodeURIComponent(AV.taskId)+"/acceptance"))}catch(e){AV.error="Не удалось загрузить: "+e.message}}
async function openAcceptance(taskId){const e=accEl();AV={taskId:taskId,mode:"view",comments:[],pick:null,confirm:null,pending:false,error:null,info:null,el:e};
  e.o.hidden=false;document.body.classList.add("noscroll");accFrame();renderAccSide();await accInfo();renderAccSide()}
function closeAcceptance(force){if(!AV)return;clearTimeout(AV.poll);if(!force&&AV.comments.length&&!AV.closeArmed){AV.closeArmed=true;AV.error="Есть неотправленные замечания: «Закрыть» ещё раз — и они пропадут.";renderAccSide();return}
  AV.el.o.hidden=true;AV.el.fr.src="about:blank";document.body.classList.remove("noscroll");AV=null}
function accSay(m){if(AV&&AV.el.fr.contentWindow)AV.el.fr.contentWindow.postMessage(m,"*")}
async function accSend(kind){AV.confirm=null;AV.error=null;AV.pending=true;renderAccSide();
  try{const r=await post("/api/tasks/"+encodeURIComponent(AV.taskId)+"/acceptance/"+kind,kind==="return"?{comments:AV.comments}:{});
    if(r.check)toast("ok",r.check.status==="conflict"?"Вливание конфликтует":"Проверяю вливание",r.check.status==="conflict"?"не принято: "+(r.check.files||[]).join(", "):"задача примется, когда сборка вливания позеленеет",AV.taskId);
    else toast("ok",kind==="accept"?"Задача принята":"Задача возвращена",kind==="accept"?(r.merged?"влита: "+r.merged.branch+" → "+r.merged.into+" ("+r.merged.commit.slice(0,7)+")":"без вливания"):"follow-up "+r.followUp.id+" с вашими замечаниями",AV.taskId);
    AV.comments=[];AV.pick=null;AV.mode="view";AV.pending=false;await accInfo();accFrame();await tick()}
  catch(e){AV.pending=false;AV.error="Не получилось: "+e.message}renderAccSide()}
function renderAccSide(){if(!AV)return;const e=AV.el;const t=S&&S.tasks.find(x2=>x2.id===AV.taskId);e.title.textContent="Приёмка "+AV.taskId+(t?" · "+t.title:"");
  const side=e.side;side.replaceChildren();const i=AV.info;const foot=el("div","pfoot");
  if(!i){side.append(el("div","muted",AV.error||"загружаю…"));return}
  const mc=i.mergeCheck;const checking=mc&&mc.status==="running";
  const can=!!(S&&S.control)&&!i.verdict&&!checking;
  if(checking){side.append(el("div","note","Проверяю вливание: "+(MC_STEP[mc.step]||"")+(mc.step==="build"?" ("+i.verify+")":"")+". Задача примется, когда сборка позеленеет."));
    clearTimeout(AV.poll);AV.poll=setTimeout(async()=>{if(!AV)return;await accInfo();if(AV&&!(AV.info.mergeCheck&&AV.info.mergeCheck.status==="running"))accFrame();renderAccSide()},3000)}
  else if(mc&&(mc.status==="red"||mc.status==="conflict"))side.append(el("div","note bad",(mc.status==="red"?"Сборка вливания красная":"Вливание конфликтует")+(mc.followUp?": отдано в "+mc.followUp:": в карточке задачи — «Отдать команде» или «Проверить снова»")+"."));
  const bad=i.alerts.filter(a2=>a2.level==="bad").length;
  side.append(el("div","note"+(bad?" bad":""),i.alerts.length?"На что посмотреть: "+i.alerts.length+(bad?" (серьёзных "+bad+")":"")+" — первый раздел страницы.":"Ничего, что требует вас: можно принимать."));
  if(!i.table)side.append(el("div","muted small","Lead не прислал таблицу «требование → доказательство» (задача старше пакета приёмки)."));
  if(i.verdict)side.append(el("div","psent",(i.verdict.status==="accepted"?"✓ Принята ":"Возвращена ")+time(i.verdict.at).slice(0,5)+(i.verdict.followUp?": follow-up "+i.verdict.followUp:"")));
  if(can){const w=el("div","win");[["view","Просмотр"],["comment","Замечание"]].forEach(([m,l])=>{const b=el("button",AV.mode===m?"on":"",l);b.type="button";
      b.onclick=()=>{AV.mode=m;AV.pick=null;accSay({type:"mode",mode:m});renderAccSide()};w.append(b)});side.append(w);
    side.append(el("div","muted small",AV.mode==="comment"?"Кликните блок или выделите слова — и напишите, что поменять.":"Замечания к блокам страницы уйдут команде follow-up задачей. Замечания к строкам кода — «Посмотреть изменения» в карточке."))}
  if(AV.pick&&can){const f=el("div","ppick");f.append(el("div","muted","к "+AV.pick.target));if(AV.pick.quote)f.append(el("div","pquote","«"+AV.pick.quote+"»"));
    const ta=document.createElement("textarea");ta.rows=3;ta.placeholder="Что поменять…";ta.value=AV.pick.text;ta.oninput=()=>{AV.pick.text=ta.value};
    const add=el("button","small","Добавить");add.type="button";add.onclick=()=>{if(!ta.value.trim())return;AV.comments.push({target:AV.pick.target,...(AV.pick.quote?{quote:AV.pick.quote}:{}) ,text:ta.value.trim()});AV.pick=null;AV.closeArmed=false;accSay({type:"unpick"});renderAccSide()};
    const cancel=el("button","ghost small","Отмена");cancel.type="button";cancel.onclick=()=>{AV.pick=null;accSay({type:"unpick"});renderAccSide()};
    ta.onkeydown=ev=>{if(ev.key==="Enter"&&(ev.metaKey||ev.ctrlKey))add.click();if(ev.key==="Escape")cancel.click()};f.append(ta,add,cancel);side.append(f)}
  if(AV.comments.length){const l=el("div","plist");l.append(el("b","","Замечания ("+AV.comments.length+")"));
    AV.comments.forEach(c=>{const r=el("div","pitem");r.append(el("div","muted",c.target),...(c.quote?[el("div","pquote","«"+c.quote+"»")]:[]),el("div","",c.text));
      const x=el("button","ghost small","×");x.type="button";x.title="убрать";x.onclick=()=>{AV.comments=AV.comments.filter(y2=>y2!==c);renderAccSide()};r.append(x);l.append(r)});side.append(l)}
  if(AV.error)side.append(el("div","note bad",AV.error));
  if(AV.pending)side.append(el("div","muted small","Отправляю…"));
  if(can){const acceptLabel=i.ownBranch?(mc&&(mc.status==="red"||mc.status==="conflict")?"Проверить вливание снова":"Принять и влить"):"Принять";
    if(AV.confirm){const c=el("div","pconfirm");c.append(el("div","",AV.confirm==="accept"?(i.ownBranch?(i.verify?"Принять задачу и влить ветку lead'а? Вливание сначала соберётся на HEAD проекта и пройдёт «"+i.verify+"»: задача примется и вольётся, только если сборка зелёная.":"Принять задачу и влить ветку lead'а в текущую ветку проекта одним коммитом? У задачи нет verifyCommand: вливание сборкой не проверяется."):"Принять задачу?"):"Вернуть задачу? "+AV.comments.length+" замеч. уйдут команде новой follow-up задачей."));
      const yes=el("button","small",AV.confirm==="accept"?"Да, "+acceptLabel.toLowerCase():"Да, вернуть");yes.type="button";yes.onclick=()=>accSend(AV.confirm);
      const no=el("button","ghost small","Отмена");no.type="button";no.onclick=()=>{AV.confirm=null;renderAccSide()};c.append(yes," ",no);foot.append(c)}
    else{const r=el("div","pactions");const ok=el("button","",acceptLabel);ok.type="button";ok.disabled=AV.pending||AV.comments.length>0;ok.title=AV.comments.length?"Есть замечания: верните задачу или уберите их":"";ok.onclick=()=>{AV.confirm="accept";renderAccSide()};
      const back=el("button","ghost","Вернуть с замечаниями");back.type="button";back.disabled=AV.pending||!AV.comments.length;back.onclick=()=>{AV.confirm="return";renderAccSide()};r.append(ok," ",back);foot.append(r)}}
  side.append(foot)}

/* план: версии, diff, замечания к блокам, правки текста, вопросы, mermaid, критик */
let PV=null;let PLAN_EL=null;
function planEl(){if(PLAN_EL)return PLAN_EL;const o=el("div","planov");o.setAttribute("role","dialog");o.setAttribute("aria-label","План задачи");
  const head=el("div","planhead");const title=el("b","");const ver=document.createElement("select");const st=el("span","muted");const x=el("button","ghost","Закрыть");x.type="button";let armed=null;
  x.onclick=()=>{if(!planDirty()||armed){clearTimeout(armed);armed=null;x.textContent="Закрыть";closePlan(true);return}
    x.textContent="Закрыть без отправки? Ещё раз";armed=setTimeout(()=>{armed=null;x.textContent="Закрыть"},4000)};
  head.append(title,ver,st,x);const body=el("div","planbody");const fr=document.createElement("iframe");fr.title="план";
  const side=el("div","planside");body.append(fr,side);o.append(head,body);document.body.append(o);
  ver.onchange=()=>{if(!planDirty())loadPlanVersion(Number(ver.value));else{ver.value=String(PV.version);PV.error="Сначала отправьте или уберите свои замечания и правки: при переходе на другую версию они пропадут.";renderPlanSide()}};
  return PLAN_EL={o:o,title:title,ver:ver,st:st,fr:fr,side:side}}
function planDirty(){return PV&&(PV.comments.length>0||PV.edited)}
function planHasNotes(){return planDirty()||(PV&&PV.answered)}
async function openPlan(taskId){const e=planEl();PV={taskId:taskId,plan:null,version:0,mode:"view",comments:[],pick:null,edited:false,diff:false,diffCount:null,pending:false,el:e};
  e.o.hidden=false;document.body.classList.add("noscroll");await reloadPlan(true)}
function closePlan(force){if(!PV)return;if(!force&&planDirty())return;PV.el.o.hidden=true;PV.el.fr.src="about:blank";document.body.classList.remove("noscroll");PV=null}
async function reloadPlan(toLatest){const j=await getJSON(q("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan"));PV.plan=j.plan;PV.critiques=j.critiques||[];PV.critic=j.critic||{enabled:false};const last=j.plan.versions.at(-1);
  if(toLatest&&last)await loadPlanVersion(last.n);else renderPlanSide()}
function freshFrame(){const old=PLAN_EL.fr;const fr=document.createElement("iframe");fr.title=old.title;old.replaceWith(fr);PLAN_EL.fr=fr;return fr}
async function loadPlanVersion(v){PV.version=v;PV.confirm=null;PV.error=null;PV.comments=[];PV.pick=null;PV.edited=false;PV.answered=false;PV.diagram=null;PV.diffCount=null;PV.ready=false;
  freshFrame().src=q("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/"+v+"/view");renderPlanSide()}
function planSay(m){if(PV&&PV.el.fr.contentWindow)PV.el.fr.contentWindow.postMessage(m,"*")}
const planWaits=new Map();let planSeq=0;
function planCollect(){return new Promise((ok,fail)=>{const id=++planSeq;planWaits.set(id,ok);planSay({type:"collect",id:id});setTimeout(()=>{if(planWaits.delete(id))fail(new Error("страница плана не ответила"))},4000)})}
function planPrev(){const vs=PV&&PV.plan?PV.plan.versions:[];const cur=vs.find(x2=>x2.n===PV.version);const prev=vs.find(x2=>x2.n===PV.version-1);return prev&&(prev.stage||null)===(cur&&cur.stage||null)?prev.n:0}
async function planDiff(){if(!PV)return;const prev=planPrev();if(!PV.diff||prev<1){planSay({type:"diff",prev:null});PV.diffCount=null;renderPlanSide();return}
  try{const j=await getJSON(q("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/"+prev));planSay({type:"diff",prev:j.html})}catch(e){toast("bad","Не удалось загрузить v"+prev,e.message)}}
addEventListener("message",ev=>{const m=ev.data||{};if(!m.an)return;
  if(AV&&ev.source===AV.el.fr.contentWindow){
    if(m.type==="ready")accSay({type:"mode",mode:AV.mode});
    else if(m.type==="pick"){AV.pick={target:m.target,quote:m.quote||"",text:""};renderAccSide();setTimeout(()=>{const ta=AV&&AV.el.side.querySelector(".ppick textarea");if(ta)ta.focus()},0)}}
  if(PV&&ev.source===PV.el.fr.contentWindow){
    if(m.type==="ready"){PV.ready=true;planSay({type:"mode",mode:PV.mode});if(PV.diff)planDiff();renderPlanSide()}
    else if(m.type==="pick"){PV.pick={target:m.target,quote:m.quote||"",text:""};renderPlanSide();setTimeout(()=>{const ta=PV&&PV.el.side.querySelector(".ppick textarea");if(ta)ta.focus()},0)}
    else if(m.type==="answered"){if(!PV.answered){PV.answered=true;if(!PV.el.side.contains(document.activeElement))renderPlanSide()}}
    else if(m.type==="edited"){PV.edited=true;if(!PV.el.side.contains(document.activeElement))renderPlanSide()}
    else if(m.type==="diagram"){PV.diagram={index:m.index,source:m.source,original:m.original,error:null};renderPlanSide();setTimeout(()=>{const ta=PV&&PV.el.side.querySelector(".pdiag textarea");if(ta)ta.focus()},0)}
    else if(m.type==="diagram-ok"||m.type==="diagram-error"){if(PV.diagram&&PV.diagram.index===m.index){PV.diagram.error=m.type==="diagram-error"?m.message:null;const s2=PV.el.side.querySelector(".pdiag .dst");if(s2){s2.className="dst "+(PV.diagram.error?"bad":"muted");s2.textContent=PV.diagram.error?"ошибка: "+PV.diagram.error:"схема перерисована"}}}
    else if(m.type==="diffed"){PV.diffCount=m.count;renderPlanSide()}
    else if(m.type==="collected"){const ok=planWaits.get(m.id);if(ok){planWaits.delete(m.id);ok(m)}}}});
addEventListener("keydown",e=>{if(e.key!=="Escape")return;
  if(AV&&!AV.el.o.hidden&&!(document.activeElement&&document.activeElement.tagName==="TEXTAREA")){if(AV.confirm){AV.confirm=null;renderAccSide()}else closeAcceptance()}
  if(PV&&!PV.el.o.hidden&&!(document.activeElement&&document.activeElement.tagName==="TEXTAREA")){if(PV.confirm){PV.confirm=null;renderPlanSide()}else closePlan()}
  if(DRAWER&&!(document.activeElement&&document.activeElement.tagName==="TEXTAREA"))closeDrawer()});
function planWhat(c){const n=(k,a,b,d)=>k+" "+(k%10===1&&k%100!==11?a:k%10>=2&&k%10<=4&&(k%100<10||k%100>=20)?b:d);
  return [PV.comments.length?n(PV.comments.length,"замечание","замечания","замечаний"):"",c.edits.length?n(c.edits.length,"правка","правки","правок"):"",c.answers.length?n(c.answers.length,"ответ","ответа","ответов"):""].filter(Boolean).join(", ")}
async function planAsk(approve){PV.error=null;let c;try{c=await planCollect()}catch(e){PV.error=e.message;renderPlanSide();return}
  const notes=PV.comments.length+c.edits.length+c.answers.length;
  if(!approve&&!notes){PV.error="Нечего отправлять: кликните блок в режиме «Замечание», поправьте текст или ответьте на вопрос плана.";renderPlanSide();return}
  PV.confirm={approve:approve,what:planWhat(c)};renderPlanSide()}
async function planSend(approve){const v=PV.version;PV.confirm=null;PV.error=null;PV.pending=true;renderPlanSide();
  try{const c=await planCollect();const what=planWhat(c);
    const r=await post("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/"+(approve?"approve":"feedback"),{version:v,comments:PV.comments,edits:c.edits,answers:c.answers,...(c.html?{html:c.html}:{})});
    const st=(r.plan.versions.find(x2=>x2.n===v)||{}).stage;
    toast("ok",approve?(st==="input"?"Спека аналитиков просмотрена":st==="change"?"Change принят":"План утверждён"):"Отзыв отправлен "+(r.to||"lead'у"),approve?(st==="input"?"lead проведёт допрос и напишет свой change":st==="change"?"дальше ревью и DONE":"v"+r.plan.approved.version+": lead предложит соглашение по плану"):what,PV.taskId);
    PV.comments=[];PV.edited=false;PV.answered=false;PV.pick=null;PV.diagram=null;PV.plan=r.plan;PV.pending=false;
    const last=r.plan.versions.at(-1);if(last&&last.n!==v)await loadPlanVersion(last.n);else{PV.mode="view";planSay({type:"mode",mode:"view"});renderPlanSide()}await tick()}
  catch(e){PV.pending=false;PV.error="Не отправлено: "+e.message;renderPlanSide()}}
/* вопрос к вам внутри панели плана: те же чипы, что в чате */
function planQuestionCard(qq){
  const card=el("div","qcard");card.append(el("div","",qq.from+": "+qq.question));
  const chips=el("div","qchips");
  const done2=()=>{chips.replaceChildren(el("span","badge lime","ответ отправлен"))};
  const answer=async(label)=>{try{await post("/api/questions/answer",{taskId:qq.taskId,messageId:qq.messageId,answer:label});done2()}catch(e){toast("bad","Не отправлено",e.message,qq.taskId)}await tick()};
  if(qq.choices&&Array.isArray(qq.choices.options)&&qq.choices.options.length){for(const o of qq.choices.options){const label=typeof o==="string"?o:o.label;
      const c=el("button","qchip"+(qq.choices.recommended===label?" rec":""),label);c.type="button";c.onclick=()=>{[...chips.children].forEach(x2=>x2.disabled=true);answer(label)};chips.append(c)}}
  else{const ta=el("input");ta.placeholder="Ответ одной строкой…";ta.style.cssText="flex:1;min-width:120px;font:12.5px var(--font);border:1px solid var(--line);border-radius:8px;padding:5px 8px";
    const b=el("button","small","Ответить");b.type="button";b.onclick=()=>{const v=ta.value.trim();if(v)answer(v)};chips.append(ta,b)}
  const dis=el("button","qchip","закрыть без ответа");dis.type="button";dis.onclick=async()=>{try{await post("/api/questions/dismiss",{taskId:qq.taskId,messageId:qq.messageId});done2()}catch(e){toast("bad","Не закрыто",e.message,qq.taskId)}await tick()};chips.append(dis);
  card.append(chips);return card}
function renderPlanSide(){if(!PV)return;const e=PV.el;const p=PV.plan;const t=S&&S.tasks.find(x2=>x2.id===PV.taskId);
  e.title.textContent=PV.taskId+(t?" · "+t.title:"");
  const vs=p?p.versions:[];e.ver.replaceChildren(...vs.map(x2=>new Option("v"+x2.n+" · "+x2.by+" · "+time(x2.at).slice(0,5)+(p.approved&&p.approved.version===x2.n?" · "+(x2.stage==="input"?"просмотрена":x2.stage==="change"?"принята":"утверждена"):""),String(x2.n))));e.ver.value=String(PV.version);e.ver.hidden=vs.length<2;
  const last=vs.at(-1);const latest=last&&PV.version===last.n;const qs=(S&&S.openQuestions||[]).filter(q=>q.taskId===PV.taskId);
  const W=planWords(t,last&&last.stage);const live=t&&t.status==="ACTIVE"&&t.phase===W.phase;const can=!!(S&&S.control)&&latest&&live&&!p.approved;
  e.st.textContent=!vs.length?"плана ещё нет":p.approved?W.done+" v"+p.approved.version:!latest?"старая версия: только просмотр":!live?"задача уже не на этом шаге":t.plan&&t.plan.status==="revising"?W.status.revising:"";
  const steps=t&&typeof ACT!=="undefined"?ACT.filter(x2=>x2.agentId===t.agents[0]&&(!x2.taskId||x2.taskId===t.id)).slice(-6).map(x2=>x2.seq).join(","):"";
  const sig=JSON.stringify([PV.version,PV.mode,PV.comments,PV.pick,PV.diagram,PV.confirm,PV.pending,PV.error,PV.ready,PV.edited,PV.answered,PV.diff,PV.diffCount,PV.critiques,PV.critic,PV.criticAdded?[...PV.criticAdded]:null,PV.actOpen,
    p&&p.versions.length,p&&p.approved,p&&p.feedback&&p.feedback.length,t&&t.plan,t&&t.status,t&&t.phase,t&&t.queue,qs.map(q=>q.messageId),steps,can]);
  if(sig===PV.sideSig)return;PV.sideSig=sig;
  const side=e.side;side.replaceChildren();
  const foot=el("div","pfoot");
  const cur=vs.find(x2=>x2.n===PV.version);if(cur&&cur.note)side.append(el("div","pnote","v"+cur.n+": "+cur.note));
  if(can){const w=el("div","win");[["view","Просмотр"],["comment","Замечание"],["edit","Править текст"]].forEach(([m,l])=>{const b=el("button",PV.mode===m?"on":"",l);b.type="button";
      b.onclick=()=>{PV.mode=m;PV.pick=null;PV.diagram=null;planSay({type:"mode",mode:m});renderPlanSide()};w.append(b)});side.append(w);
    side.append(el("div","muted small",PV.mode==="comment"?"Кликните блок или выделите слова — и напишите, что не так.":PV.mode==="edit"?"Правьте текст прямо на странице: lead получит «было → стало». Клик по схеме — правка её кода Mermaid.":W.view))}
  if(PV.version>1&&planPrev()){const l=el("label","pdiff");const cb=document.createElement("input");cb.type="checkbox";cb.checked=PV.diff;cb.onchange=()=>{PV.diff=cb.checked;planDiff()};
    l.append(cb," подсветить новое с v"+planPrev()+(PV.diff&&PV.diffCount!==null?" ("+PV.diffCount+")":""));side.append(l)}
  if(PV.pick&&can){const f=el("div","ppick");f.append(el("div","muted","к "+PV.pick.target));if(PV.pick.quote)f.append(el("div","pquote","«"+PV.pick.quote+"»"));
    const ta=document.createElement("textarea");ta.rows=3;ta.placeholder="Что поменять…";ta.value=PV.pick.text;ta.oninput=()=>{PV.pick.text=ta.value};
    const add=el("button","small","Добавить");add.type="button";add.onclick=()=>{if(!ta.value.trim())return;PV.comments.push({target:PV.pick.target,...(PV.pick.quote?{quote:PV.pick.quote}:{}) ,text:ta.value.trim()});PV.pick=null;planSay({type:"unpick"});renderPlanSide()};
    const cancel=el("button","ghost small","Отмена");cancel.type="button";cancel.onclick=()=>{PV.pick=null;planSay({type:"unpick"});renderPlanSide()};
    ta.onkeydown=ev=>{if(ev.key==="Enter"&&(ev.metaKey||ev.ctrlKey))add.click();if(ev.key==="Escape")cancel.click()};f.append(ta,add,cancel);side.append(f)}
  if(PV.diagram&&can){const d=PV.diagram;const f=el("div","pdiag");f.append(el("b","","Схема "+(d.index+1)+": код Mermaid"));
    const ta=document.createElement("textarea");ta.rows=12;ta.spellcheck=false;ta.value=d.source;let timer=null;
    ta.oninput=()=>{d.source=ta.value;clearTimeout(timer);timer=setTimeout(()=>planSay({type:"diagram-set",index:d.index,source:d.source}),400)};
    const stl=el("div","dst "+(d.error?"bad":"muted"),d.error?"ошибка: "+d.error:"правьте код — схема перерисуется в плане");
    const done=el("button","small","Готово");done.type="button";done.onclick=()=>{PV.diagram=null;renderPlanSide()};
    const back=el("button","ghost small","Вернуть как было");back.type="button";back.onclick=()=>{d.source=d.original;ta.value=d.original;planSay({type:"diagram-set",index:d.index,source:d.original})};
    f.append(ta,stl,done,back);side.append(f)}
  if(PV.comments.length){const l=el("div","plist");l.append(el("b","","Замечания ("+PV.comments.length+")"));
    PV.comments.forEach(c=>{const r=el("div","pitem");r.append(el("div","muted",c.target),...(c.quote?[el("div","pquote","«"+c.quote+"»")]:[]),el("div","",c.text));
      const x=el("button","ghost small","×");x.type="button";x.title="убрать";x.onclick=()=>{PV.comments=PV.comments.filter(y2=>y2!==c);renderPlanSide()};r.append(x);l.append(r)});side.append(l)}
  if(PV.edited&&can)side.append(el("div","note","Есть правки: они уйдут lead'у и сохранятся новой версией плана."));
  if(can&&(last&&last.stage==="input"?PV.edited:planDirty()))side.append(el("div","muted small","«"+W.approve+"» станет доступно, когда lead посмотрит ваши "+(last&&last.stage==="input"?"правки":"замечания и правки")+" и пришлёт новую версию."));
  else if(can&&last&&last.stage==="input"&&PV.comments.length)side.append(el("div","muted small","Замечания уйдут lead'у вместе с «"+W.approve+"»: он задаст по ним вопросы на допросе."));
  const fb=p?p.feedback:[];if(fb.length){const d=el("details","phist");d.append(el("summary","muted","История отзывов ("+fb.length+")"));
    fb.slice().reverse().forEach(f=>{const r=el("div","pitem");r.append(el("div","muted",time(f.at).slice(0,5)+" · v"+f.onVersion+(f.withApproval?" · с утверждением":" · раунд "+f.round)+(f.savedAs?" → правки в v"+f.savedAs:"")));
      f.comments.forEach(c=>r.append(el("div","","• "+c.target+": "+c.text)));f.edits.forEach(x2=>r.append(el("div","",x2.kind==="diagram"?"схема изменена":!x2.before?"+ "+x2.after:!x2.after?"− "+x2.before:x2.before+" → "+x2.after)));f.answers.forEach(a2=>r.append(el("div","","? "+a2.question+": "+a2.value.join(", "))));d.append(r)});side.append(d)}
  const sent=p?p.feedback.filter(f=>!f.withApproval).at(-1):null;
  if(sent&&latest&&live&&!p.approved&&(sent.onVersion===PV.version||sent.savedAs===PV.version)){const n=(k,a,b,c)=>k+" "+(k%10===1&&k%100!==11?a:k%10>=2&&k%10<=4&&(k%100<10||k%100>=20)?b:c);
    const what=[sent.comments.length?n(sent.comments.length,"замечание","замечания","замечаний"):"",sent.edits.length?n(sent.edits.length,"правка","правки","правок"):"",sent.answers.length?n(sent.answers.length,"ответ","ответа","ответов"):""].filter(Boolean).join(", ");
    side.append(el("div","psent","✓ Отправлено lead'у "+(t?t.agents[0]:"")+" в "+time(sent.at).slice(0,5)+(what?": "+what:"")+". "+(qs.length?"Lead ждёт вашего ответа на вопрос — он ниже.":W.sent)))}
  if(PV.critic&&PV.critic.enabled&&cur&&cur.by!=="operator"){const cr=(PV.critiques||[]).find(c=>c.version===PV.version);const box=el("div","pcritic");
    if(PV.critic.running===PV.version)box.append(el("b","","Критик читает план v"+PV.version+"…"),el("div","muted small","ищет, что сломается в проде: данные, деплой и откат, контракты, гонки, нагрузка, безопасность"));
    else if(!cr)box.append(el("div","muted small","Критик возьмёт v"+PV.version+" в работу через несколько секунд."));
    else{const head=el("div","");head.append(el("b","",cr.error?"Критик не дал списка рисков":"Критик: "+(cr.risks.length?cr.risks.length+" "+(cr.risks.length===1?"риск":cr.risks.length<5?"риска":"рисков"):"рисков не нашёл")));
      head.append(el("span","muted small"," · "+time(cr.endedAt||cr.at).slice(0,5)+(cr.model?" · "+cr.model:"")+(cr.costUsd!==undefined?" · $"+cr.costUsd:"")));box.append(head);
      if(cr.skills&&cr.skills.length){const d=el("details","small");d.append(el("summary","muted","скиллы: "+(cr.skillSets||[]).join(", ")+" ("+cr.skills.length+")"),el("div","muted",cr.skills.join(", ")));box.append(d)}
      if(cr.error)box.append(el("div","note bad",cr.error));
      PV.criticAdded=PV.criticAdded||new Set();
      cr.risks.forEach((k,i)=>{const it=el("div","prisk");it.append(el("span","badge "+(k.severity==="high"?"bad":k.severity==="medium"?"warn":""),k.severity==="high"?"серьёзно":k.severity==="medium"?"важно":"мелочь"),el("b",""," "+k.title));
        if(k.where)it.append(el("div","",k.where));it.style.fontSize="13px";it.append(el("div","",k.why));if(k.suggest)it.append(el("div","psug","→ "+k.suggest));
        const key=PV.version+"/"+i;
        if(can){const b=el("button","ghost small",PV.criticAdded.has(key)?"✓ в замечаниях":"В замечания");b.type="button";b.disabled=PV.criticAdded.has(key);
          b.onclick=()=>{PV.comments.push({target:"риск от критика: "+k.title+(k.where?" ("+k.where+")":""),text:k.why+(k.suggest?"\nПредложение: "+k.suggest:"")});PV.criticAdded.add(key);renderPlanSide()};it.append(b)}
        box.append(it)});
      if(can&&S.control){const again=el("button","ghost small","Покритиковать ещё раз");again.type="button";
        again.onclick=async()=>{try{await post("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/critique",{version:PV.version});await reloadPlan(false)}catch(e){PV.error=e.message;renderPlanSide()}};box.append(again)}}
    side.append(box)}
  PV.qcards=PV.qcards||new Map();
  if(qs.length){const box=el("div","pqs");box.append(el("b","","Вопросы к вам ("+qs.length+")"));
    qs.forEach(qq=>{const key="plan/"+qq.taskId+"/"+qq.messageId;if(!PV.qcards.has(key))PV.qcards.set(key,planQuestionCard(qq));box.append(PV.qcards.get(key))});side.append(box)}
  for(const k of[...PV.qcards.keys()])if(!qs.some(q=>"plan/"+q.taskId+"/"+q.messageId===k))PV.qcards.delete(k);
  if(t&&typeof ACT!=="undefined"){const lead=t.agents[0];const steps=ACT.filter(e2=>e2.agentId===lead&&(!e2.taskId||e2.taskId===t.id)&&(e2.kind==="text"||e2.kind==="tool_use"||(e2.kind==="tool_result"&&e2.isError))).slice(-6).reverse();
    if(steps.length){const d=el("details","pact");d.open=PV.actOpen!==false;d.ontoggle=()=>{PV.actOpen=d.open};const live=t.queue==="running";
      d.append(el("summary","muted","Что делает lead "+lead+(live?" · работает":" · ждёт")));
      steps.forEach(e2=>{const row=el("div","pstep"+(e2.kind==="tool_result"?" err":""));row.append(el("span","muted",time(e2.at||e2.createdAt).slice(0,5)+" "),
        e2.kind==="text"?el("span","",e2.summary||""):el("span","",(e2.kind==="tool_result"?"✗ ":"")+(e2.tool||"").replace(/^mcp__agent-network__/,"")+(e2.summary?" — "+e2.summary:"")));d.append(row)});
      side.append(d)}}
  if(PV.pending)side.append(el("div","muted small","Отправляю…"));
  if(PV.error)side.append(el("div","note bad",PV.error));
  if(PV.confirm&&can){const q=el("div","pconfirm");const a=PV.confirm.approve;
    q.append(el("div","",a?(W.ask||"Утвердить план v"+PV.version+"?"+(PV.confirm.what?" Вместе с ним lead получит ваши ответы: "+PV.confirm.what+".":"")+" Дальше lead предложит соглашение по плану."):W.send+": "+PV.confirm.what+"?"+W.sendAsk));
    const yes=el("button","small",a?W.yes:"Да, отправить");yes.type="button";yes.onclick=()=>planSend(a);
    const no=el("button","ghost small","Отмена");no.type="button";no.onclick=()=>{PV.confirm=null;renderPlanSide()};q.append(yes," ",no);foot.append(q)}
  if(can){const bar=el("div","pactions");const send=el("button","",PV.pending?"…":W.send);send.type="button";send.disabled=PV.pending||!PV.ready||!planHasNotes();
    if(!planHasNotes())send.title="Нечего отправлять: добавьте замечание, правку или ответ на вопрос";send.onclick=()=>planAsk(false);
    const viewOnly=last&&last.stage==="input";const blocked2=viewOnly?PV.edited:planDirty();
    const revising=!viewOnly&&t&&t.plan&&t.plan.status==="revising";
    const ap=el("button",blocked2||revising?"ghost":"",PV.pending?"…":W.approve+" v"+PV.version);ap.type="button";ap.disabled=PV.pending||!PV.ready||blocked2||revising;
    if(revising)ap.title="Lead смотрит ваш отзыв: утвердите версию, которую он пришлёт (если менять нечего, он пришлёт ту же страницу с пояснением)";
    else if(planDirty())ap.title="Сначала отправьте замечания и правки lead'у: он посмотрит, доработает план и пришлёт новую версию — её и утвердите";ap.onclick=()=>planAsk(true);bar.append(send,ap);foot.append(bar)}
  if(foot.childElementCount)side.append(foot)}
/* обновление из тика: новая версия от lead открывается сама, если нет черновика замечаний */
function planSync(){if(!PV||!S)return;const t=S.tasks.find(x2=>x2.id===PV.taskId);if(!t||!t.plan||!PV.plan)return;
  const known=PV.plan.versions.at(-1);const newer=t.plan.version&&(!known||t.plan.version>known.n);const approved=!!t.plan.approvedVersion!==!!PV.plan.approved;
  const cur=PV.plan.versions.find(v=>v.n===PV.version);const waitCritic=PV.critic&&PV.critic.enabled&&cur&&cur.by!=="operator"&&!(PV.critiques||[]).some(c=>c.version===PV.version);
  if(PV.pending||(!newer&&!approved)){if(!PV.el.side.contains(document.activeElement)){if(waitCritic)reloadPlan(false);else renderPlanSide()}return}
  if(planDirty()){if(!PV.told){PV.told=true;toast("ok","Lead прислал v"+t.plan.version,"откройте её из списка версий, когда отправите свои замечания",PV.taskId)}reloadPlan(false);return}
  reloadPlan(true)}

/* ── OpenSpec: прогресс change в папке проекта + архивация ── */
const archiveState=new Map();
function openspecBody(t){
  const o=t.openspec;const box=el("div","");
  const state=o.archivedAt?"в архиве с "+time(o.archivedAt):o.progress?"в папке проекта отмечено "+o.progress.done+"/"+o.progress.total:o.error?"не читается: "+o.error:"";
  box.append(el("div","",o.path+" · "+state));
  for(const a of o.assigned)box.append(el("div","",a.agentId+": "+(a.tasks.length?a.tasks.join(", "):"только ревью")+(a.done.length?" · сделано: "+a.done.join(", "):"")));
  if(controlMode&&t.status==="COMPLETED"&&!o.archivedAt){
    const st=archiveState.get(t.id)||{};const ready=o.progress&&o.progress.done===o.progress.total;
    const r=el("div","opts");
    const b=el("button","ghost small",st.pending?"архивирую…":"Архивировать change");b.type="button";b.disabled=!ready||!!st.pending;
    b.onclick=async()=>{if(!await ask("openspec archive "+o.change+" в папке проекта? Change переедет в openspec/changes/archive, его спеки — в openspec/specs."))return;
      archiveState.set(t.id,{pending:true});render();
      try{const res=await post("/api/openspec/archive",{taskId:t.id});archiveState.set(t.id,{output:res.output||"готово"})}catch(e){archiveState.set(t.id,{error:e.message})}await tick()};
    r.append(b);if(!ready)r.append(el("span","note","сначала влейте ветку lead'а в папку проекта: lead отмечает задачи у себя"));
    box.append(r)}
  const st2=archiveState.get(t.id);if(st2&&(st2.output||st2.error))box.append(el("div","logbox2",st2.error||st2.output));
  return box}
/* карточка OpenSpec в чате */
function openspecCard(t){
  const card=el("div","action-card");const h=el("h4","",);h.append("OpenSpec: "+t.openspec.change);
  h.append(badge(t.openspec.archivedAt?"":"acc",t.openspec.archivedAt?"в архиве":t.openspec.progress?"отмечено "+t.openspec.progress.done+"/"+t.openspec.progress.total:""));card.append(h);
  card.append(openspecBody(t));return card}
/* change-writing задача: кто пишет change; после DONE — «Реализовать change» */
function proposesCard(t){
  const card=el("div","action-card");const h=el("h4","",);h.append("Пишет OpenSpec change "+t.proposes.change);card.append(h);
  card.append(el("p","",t.agents[0]+" пишет, "+t.agents.slice(1).join(", ")+" ревьюят; код не меняется"));
  if(t.status==="COMPLETED"&&controlMode){const opts=el("div","opts");
    if(t.proposedReady){const b=el("button","cta small","Реализовать change");b.type="button";b.onclick=()=>implementChange(t.proposes.change);opts.append(b,el("span","note","откроет форму новой задачи с этим change"))}
    else opts.append(el("span","note","влейте ветку lead'а: change появится в проекте, и его можно будет реализовать"));
    card.append(opts)}
  return card}
/* «Реализовать change»: открывает #/new и подставляет change в форму */
let pendingChange=null;
function implementChange(name){pendingChange=name;location.hash="#/new";if(location.hash==="#/new")render()}

/* ── diff-оверлей (#10): полноэкранный просмотр ветки задачи с построчными замечаниями ── */
const diffState=new Map();const DIFF_PAGE=50;let DIFFOV=null;
function diffKey(taskId){return (project||"")+"/"+taskId}
function diffErr(r,j){if(r.status===404&&!controlMode)return "Дифф недоступен в режиме просмотра: запустите UI с --runners (режим управления)";return (j&&j.message)||r.status}
async function loadDiff(t,key,agent){const prev=diffState.get(key)||{};diffState.set(key,{...prev,loading:true,open:true,agent});drawDiff();
  try{const r=await fetch(q("/api/tasks/"+encodeURIComponent(t.id)+"/diff"+(agent?"?agent="+encodeURIComponent(agent):"")),{cache:"no-store"});const j=await r.json().catch(()=>null);if(!r.ok||!j)throw new Error(diffErr(r,j));
    diffState.set(key,{open:true,data:j,agent,comments:prev.comments||[]})}
  catch(e){diffState.set(key,{open:true,error:e.message,agent,comments:prev.comments||[]})}drawDiff()}
function openDiff(taskId){DIFFOV=taskId;const t=taskById(taskId);const key=diffKey(taskId);const dv=diffState.get(key);
  if(!dv||!dv.data)loadDiff(t,key,dv&&dv.agent);drawDiff()}
function closeDiff(){DIFFOV=null;const d=$("diffov");if(d)d.remove();document.body.classList.remove("noscroll")}
function diffSig(dv,t){const ui=dv.ui||{};const x=dv.data;
  return JSON.stringify([!!x,x&&x.branch,x&&x.merged,x&&x.commitsTotal,x&&x.files.length,x&&x.commits.length,dv.agent,dv.loading,dv.error,
    (dv.comments||[]).map(c=>c.file+"|"+c.side+"|"+c.line+"|"+c.text).join(";"),ui.files,ui.commits,[...(ui.open||[])],
    Object.entries(ui.patches||{}).map(([p,v])=>p+(v.loading?"L":v.error?"E":"K")).join(","),
    ui.editing?[ui.editing.file,ui.editing.side,ui.editing.line]:null,
    t&&t.status,t&&(t.review||[]).map(c=>c.id+c.status+(c.note||"")).join(",")])}
function drawDiff(){
  if(!DIFFOV)return;const t=taskById(DIFFOV);const key=diffKey(DIFFOV);const dv=diffState.get(key)||{};
  const sig=diffSig(dv,t);let d=$("diffov");
  if(d&&d.dataset.sig===sig)return;
  let scroll=0;if(d){const b=d.querySelector(".dfo-body");if(b)scroll=b.scrollTop;d.remove()}
  d=el("div","diffov");d.id="diffov";
  const head=el("div","dfo-head");
  const back=el("a","back","←");back.href="#/tasks/"+encodeURIComponent(DIFFOV);back.title="назад к задаче";back.onclick=e=>{e.preventDefault();closeDiff()};head.append(back);
  head.append(el("h2","","Изменения · "+DIFFOV));
  const x=el("button","ghost small","×");x.type="button";x.onclick=()=>closeDiff();head.append(x);
  const body=el("div","dfo-body");
  if(dv.loading&&!dv.data)body.append(el("div","muted","загружаю…"));
  if(dv.error)body.append(el("div","logbox2",dv.error));
  if(dv.data)body.append(renderDiffBox(dv.data,DIFFOV,t));
  d.append(head,body);document.body.append(d);document.body.classList.add("noscroll");
  body.scrollTop=scroll}
function renderDiffBox(x,taskId,t){
  const key=diffKey(taskId);const dv=diffState.get(key);
  const ui=dv.ui||(dv.ui={files:DIFF_PAGE,commits:20,open:new Set(),patches:{},scroll:{}});
  const comments=dv.comments||(dv.comments=[]);
  const box=el("div","diff");
  const bar=el("div","checks dbar");
  if(!x.merged&&x.agents&&x.agents.length>1){const sel=document.createElement("select");x.agents.forEach(a=>sel.append(new Option("ветка "+a+(a===t.agents[0]?" (lead)":""),a)));sel.value=dv.agent||t.agents[0];
    sel.onchange=()=>{dv.ui=null;loadDiff(t,key,sel.value)};bar.append(sel)}
  if(controlMode){const done=t.status==="COMPLETED";bar.append(el("span","muted",comments.length?"замечаний: "+comments.length:"клик по строке — замечание"));
    if(comments.length){const send=el("button","small",done?"Создать задачу по замечаниям":"Отправить lead'у");send.type="button";
      send.onclick=async()=>{if(!await ask(done?"Создать задачу для роя «исправить по замечаниям» ("+comments.length+")?":"Отправить "+comments.length+" замечаний lead'у ("+t.agents[0]+")?"))return;send.disabled=true;
        try{const r=await post("/api/tasks/"+encodeURIComponent(taskId)+"/review",{comments:comments,branch:x.branch});dv.comments=[];toast("ok",r.sent==="task"?"Создана "+r.task.id:"Замечания отправлены "+r.to,r.sent==="task"?r.task.title:comments.length+" шт.",r.sent==="task"?r.task.id:taskId)}
        catch(e){toast("bad","Не отправлено",e.message,taskId);send.disabled=false}drawDiff()};
      const clr=el("button","ghost small","очистить");clr.type="button";clr.onclick=async()=>{if(await ask("Удалить все замечания?")){dv.comments=[];drawDiff()}};bar.append(send,clr)}}
  box.append(bar);
  box.append(el("div","muted",(x.merged?"влитые изменения ":"изменения ветки ")+x.branch+": "+x.commitsTotal+" коммит(ов), "+x.files.length+" файл(ов), +"+x.files.reduce((a,f)=>a+f.added,0)+" −"+x.files.reduce((a,f)=>a+f.deleted,0)));
  const more=(left,step,go)=>{const b=el("button","ghost small","ещё "+Math.min(left,step)+" из "+left);b.type="button";b.onclick=()=>{go();drawDiff()};return b};
  if(x.commits.length){const c=el("div","dcommits");x.commits.slice(0,ui.commits).forEach(l=>c.append(el("div","",l)));
    if(x.commits.length>ui.commits)c.append(more(x.commits.length-ui.commits,100,()=>ui.commits+=100));
    if(x.commitsTotal>x.commits.length)c.append(el("div","","… и ещё "+(x.commitsTotal-x.commits.length)+": git log в папке проекта"));box.append(c)}
  if(!x.files.length){box.append(el("div","muted","изменений нет: ветка уже в проекте"));return box}
  const load=async f=>{ui.patches[f.path]={loading:true};drawDiff();
    try{const r=await fetch(q("/api/tasks/"+encodeURIComponent(taskId)+"/diff?file="+encodeURIComponent(f.path)+(dv.agent?"&agent="+encodeURIComponent(dv.agent):"")),{cache:"no-store"});const j=await r.json().catch(()=>null);if(!r.ok||!j)throw new Error(diffErr(r,j));ui.patches[f.path]=j}
    catch(e){ui.patches[f.path]={error:e.message}}drawDiff()};
  x.files.slice(0,ui.files).forEach(f=>{const det=el("details","dfile");det.open=ui.open.has(f.path);
    const sm=el("summary","");sm.append(el("span","mono",f.path)," ",f.binary?el("span","muted","двоичный"):el("span","dadd","+"+f.added)," ",f.binary?"":el("span","ddel","−"+f.deleted));det.append(sm);
    det.addEventListener("toggle",()=>{if(det.open){ui.open.add(f.path);if(!ui.patches[f.path])load(f)}else ui.open.delete(f.path)});
    const pt=ui.patches[f.path];
    if(det.open&&pt){
      if(pt.loading)det.append(el("div","muted dpad","загружаю…"));
      else if(pt.error)det.append(el("div","logbox2",pt.error));
      else{const pre=el("pre","dpatch");let o=0,n=0;
        pt.patch.split("\n").forEach(l=>{if(/^(diff --git|index |--- |\+\+\+ )/.test(l))return;
          if(l.startsWith("@@")){const m=/@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);if(m){o=+m[1];n=+m[2]}pre.append(el("span","dhunk",l));return}
          const side=l.startsWith("-")?"old":"new";const no=side==="old"?o:n;if(l.startsWith("+"))n++;else if(l.startsWith("-"))o++;else{o++;n++}
          const row=el("span",l.startsWith("+")?"dadd":l.startsWith("-")?"ddel":"");
          row.append(el("i","dln",String(no)),l||" ");pre.append(row);
          const here=c=>c.file===f.path&&c.side===side&&c.line===no;
          (t&&t.review||[]).filter(c=>c.file===f.path&&side==="new"&&c.line===no).forEach(c=>{const cm=el("span","dcm sent "+c.status);cm.append(el("b","",c.id+" "+(c.status==="open"?"открыто":c.status==="fixed"?"исправлено":"отклонено")+": "),c.text+(c.note?" — lead: "+c.note:""));pre.append(cm)});
          comments.filter(here).forEach(c=>{const cm=el("span","dcm");cm.append(el("b","","замечание: "),c.text);const x2=el("button","ghost small","×");x2.type="button";x2.title="убрать";x2.onclick=e=>{e.stopPropagation();dv.comments=comments.filter(y=>y!==c);drawDiff()};cm.append(x2);pre.append(cm)});
          if(controlMode){row.classList.add("dclick");row.title="замечание к строке "+no;
            row.onclick=()=>{ui.editing={file:f.path,side:side,line:no,code:l.slice(1).trim()};if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();drawDiff();setTimeout(()=>{const ta=document.querySelector(".dcomment textarea");if(ta)ta.focus()},0)}}
          const ed=ui.editing;if(ed&&ed.file===f.path&&ed.side===side&&ed.line===no){const form=el("span","dcomment");const ta=document.createElement("textarea");ta.rows=2;ta.placeholder="Что поменять в этой строке…";ta.value=ed.text||"";ta.oninput=()=>{ed.text=ta.value};
            const add=el("button","small","Добавить");add.type="button";add.onclick=()=>{if(!ta.value.trim())return;comments.push({file:f.path,side:side,line:no,code:ed.code,text:ta.value.trim()});ui.editing=null;ta.blur();drawDiff()};
            const cancel=el("button","ghost small","Отмена");cancel.type="button";cancel.onclick=()=>{ui.editing=null;ta.blur();drawDiff()};
            ta.onkeydown=e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))add.click();if(e.key==="Escape")cancel.click()};form.append(ta,add,cancel);pre.append(form)}});
        const at=ui.scroll[f.path];pre.addEventListener("scroll",()=>{ui.scroll[f.path]={top:pre.scrollTop,left:pre.scrollLeft}},{passive:true});
        if(at)requestAnimationFrame(()=>{pre.scrollTop=at.top;pre.scrollLeft=at.left});
        det.append(pre);if(pt.truncated)det.append(el("div","note dpad","дифф файла большой и обрезан: полностью — git diff в папке проекта"))}}
    box.append(det)});
  if(x.files.length>ui.files)box.append(more(x.files.length-ui.files,DIFF_PAGE,()=>ui.files+=DIFF_PAGE));
  return box}

/* ── drawer «Подробности»: фазы, расход, коммиты, OpenSpec, замечания, цепочка, активность ── */
let DRAWER=null;
function openDrawer(taskId){DRAWER=taskId;renderDrawer()}
function closeDrawer(){DRAWER=null;const d=$("drawer");if(d)d.remove();document.body.classList.remove("noscroll");
  const app=document.querySelector(".app");if(app)app.classList.remove("underlay")}
function renderDrawer(){
  if(!DRAWER)return;const t=taskById(DRAWER);if(!t){closeDrawer();return}
  let d=$("drawer");let scroll=0;
  if(d){const b=d.querySelector(".dbody");if(b)scroll=b.scrollTop;d.remove();
    const app0=document.querySelector(".app");if(app0)app0.classList.remove("underlay")}
  d=el("aside","drawer");d.id="drawer";document.body.append(d);
  const app=document.querySelector(".app");if(app)app.classList.add("underlay");document.body.classList.add("noscroll");
  const head=el("div","dhead");
  const back=el("a","back","←");back.href="#/tasks/"+encodeURIComponent(t.id);back.title="назад к задаче";back.onclick=e=>{e.preventDefault();closeDrawer()};head.append(back);
  head.append(el("h2","","Подробности · "+t.id));
  const diffB=el("button","ghost small","Diff");diffB.type="button";diffB.title="изменения ветки задачи, замечания к строкам";diffB.onclick=()=>openDiff(t.id);head.append(diffB);
  const x=el("button","ghost small","×");x.type="button";x.onclick=()=>closeDrawer();head.append(x);
  const body=el("div","dbody");d.replaceChildren(head,body);
  /* Команда: назначенные агенты и реальные сессии именно этой задачи */
  {const sec=el("div","dsec"),runners=S.control?.runners;
   const agents=[...new Set([...t.agents,...(t.spawned||[]).map(agent=>agent.id)])];
   const working=Array.isArray(runners)?runners.filter(runner=>runner.running&&runner.session?.taskId===t.id):null;
   sec.append(el("h3","","Команда задачи"));
   sec.append(el("div","",working?"Работают сейчас: "+working.length+" · Назначено: "+agents.length:"Назначено: "+agents.length+" · Активность сессий недоступна"));
   for(const id of agents){const runner=runners?.find(item=>item.id===id),active=working?.some(item=>item.id===id);
     const status=active?"Работает":!runner?"Нет данных о сессии":runner.session?"Занят другой задачей":runner.running?"Ожидает":"Остановлен";
     const row=el("div","kv");row.append(el("span","k",id+(id===t.agents[0]?" · ведущий":"")),badge(active?"lime":"",status));sec.append(row)}
   if(t.pluginsByAgent)for(const [agent,ids] of Object.entries(t.pluginsByAgent))sec.append(el("div","note",agent+" · плагины: "+(ids.join(", ")||"без дополнительных плагинов")));
   if(working)sec.append(el("div","note","Счётчик показывает запущенные сессии этой задачи, включая ожидание ответов команды. Обновляется автоматически."));
   body.append(sec)}
  /* Фазы */
  {const sec=el("div","dsec");sec.append(el("h3","","Фазы"));
   const names={DISCUSS:"Согласование",IMPLEMENT:"Выполнение",SYNC:"Проверка",INTEGRATE:"Сведение",DONE:"Готово"};
   const durs={};if(t.stats)for(const p of t.stats.phases)durs[p.phase]=p.ms;
   const order=["DISCUSS","IMPLEMENT","SYNC","INTEGRATE","DONE"];const cur=order.indexOf(t.phase);
   const tl=el("div","phase-tl");
   order.forEach((p,i)=>{const cls=t.phase===p?" now":i<cur||durs[p]!==undefined?" past":"";
     tl.append(el("span","seg"+cls,(names[p]||p)+(durs[p]!==undefined?" "+fmtMs(durs[p]):"")+(p==="SYNC"&&t.phase==="SYNC"&&t.syncRound?" ▸ #"+t.syncRound:"")))});
   sec.append(tl);
   const bits=[];if(t.syncRound)bits.push("раунд проверки "+t.syncRound+" из "+t.maxFixRounds);
   if(t.takeover)bits.push("lead взял исправление "+t.takeover.from.join(", ")+" (раунд "+t.takeover.round+")");
   if(bits.length)sec.append(el("div","note",bits.join(" · ")));
   body.append(sec)}
  /* Расход */
  {const sec=el("div","dsec");sec.append(el("h3","","Расход"));const st=t.stats;
   if(!st)sec.append(el("div","","нет данных (задача создана до учёта времени)"));
   else{const kv=(k,v)=>{const r=el("div","kv");r.append(el("span","k",k),el("span","v",v));sec.append(r)};
    kv("время",fmtMs(st.elapsedMs));
    if(st.usage)kv("токены",fmtTok(st.usage.total)+" (вх "+fmtTok(st.usage.input)+", вых "+fmtTok(st.usage.output)+(st.usage.cacheRead?", кэш "+fmtTok(st.usage.cacheRead):"")+")");
    else if(st.countedIn&&st.countedIn.length)kv("токены","учтены в "+st.countedIn.join(", "));
    else kv("токены",st.sessions?"нет данных (CLI без JSON-вывода)":"нет данных (не через runner)");
    if(st.costUsd!==null&&st.costUsd!==undefined){kv("стоимость",fmtUsd(st.costUsd,st.costEstimated)+(t.maxCostUsd?" из $"+t.maxCostUsd:"")+(st.jobsCostUsd||st.criticCostUsd?" — в т.ч. "+[st.jobsCostUsd?"поручения "+fmtUsd(st.jobsCostUsd):"",st.criticCostUsd?"критик плана "+fmtUsd(st.criticCostUsd):""].filter(Boolean).join(", "):""));
     if(t.maxCostUsd){const pct=Math.min(100,st.costUsd/t.maxCostUsd*100);const bar=el("div","costbar"+(pct>=100?" over":pct>=80?" near":""));const f=el("i","");f.style.width=pct+"%";bar.append(f);bar.title=fmtUsd(st.costUsd,st.costEstimated)+" из $"+t.maxCostUsd;sec.append(bar)}}
    else if(t.maxCostUsd)kv("лимит","$"+t.maxCostUsd);
    if(st.unpricedModels&&st.unpricedModels.length)kv("нет цены для",st.unpricedModels.join(", ")+" — добавьте в prices в runners.json");
    kv("сессий",String(st.sessions||0)+(st.sessionsWithoutUsage&&st.usage?" ("+st.sessionsWithoutUsage+" без токенов)":""));
    for(const a of st.agents||[])kv(a.agentId+" · "+a.sessions+" сесс.",(a.costUsd!==null&&a.costUsd!==undefined?fmtUsd(a.costUsd,a.costEstimated):"—")+" · "+(a.usage?fmtTok(a.usage.total)+" ток.":"—")+(a.models&&a.models.length?" · "+a.models.join(", "):""))}
   body.append(sec)}
  /* Коммиты */
  {const sec=el("div","dsec");sec.append(el("h3","","Коммиты"));
   let n=0;outer:for(const im of(t.implementations||[]))for(const c of im.commits||[]){if(n++>=12)break outer;
     const r=el("div","commit");r.append(el("span","h",String(c).slice(0,7)),el("span","m",im.agentId),el("span","t",""));sec.append(r)}
   if(!n)sec.append(el("div","","пока нет — появятся, когда агенты сдадут свои части"));
   body.append(sec)}
  /* OpenSpec */
  if(t.openspec){const sec=el("div","dsec");sec.append(el("h3","","OpenSpec"));sec.append(openspecBody(t));body.append(sec)}
  /* Замечания к коду (review-checklist) */
  if(t.review&&t.review.length){const sec=el("div","dsec");const open=t.review.filter(c=>c.status==="open").length;
   sec.append(el("h3","","Замечания к коду · "+(open?open+" открыто из "+t.review.length:"все "+t.review.length+" обработаны")));
   [...t.review].sort((a,b)=>(a.status==="open"?0:1)-(b.status==="open"?0:1)).forEach(c=>{const row=el("div","review-item "+c.status);
     row.append(el("span","st2",c.status==="open"?"открыто":c.status==="fixed"?"исправлено":"отклонено"),el("span",""," · "),el("span","",c.id+" "+c.file+(c.line?":"+c.line:"")),el("div","",c.text));
     if(c.code)row.append(el("div","logbox2",c.code));if(c.note)row.append(el("div","rn","lead: "+c.note));sec.append(row)});
   if(open)sec.append(el("div","note","Lead не сдаст задачу, пока каждое не исправлено или не отклонено с причиной."));
   body.append(sec)}
  /* Добавлены lead'ом */
  if(t.spawned&&t.spawned.length){const sec=el("div","dsec");sec.append(el("h3","","Добавлены lead'ом · "+t.spawned.length));
   for(const sp of t.spawned){const row=el("div","commit");
     row.append(el("span","h","●"),el("span","m",(sp.id+" · шаблон "+sp.template+" · «"+sp.reason+"»")),el("span","t",time(sp.at)));
     if(sp.role){const rd=el("details");rd.append(el("summary","note","роль: "+(sp.role.name||sp.role.id||"")+(sp.role.source==="library"?" (из библиотеки)":" (написал lead)")),el("div","logbox2",sp.role.instructions));
       if(sp.role.source==="lead"&&controlMode){const sv=el("button","ghost small","Сохранить роль в библиотеку");sv.type="button";sv.style.marginTop="4px";
         sv.onclick=async()=>{const v=await ask("Имя роли в библиотеке проекта (.agent-network/roles/<имя>.md):",sp.role.name);if(v===null)return;
           const name=(typeof v==="string"&&v.trim())?v.trim():sp.role.name;
           try{const r=await post("/api/roles/save",{taskId:t.id,agentId:sp.id,name:name});toast("ok","Роль сохранена",r.role.name);rolesAt=0}
           catch(e){if(/exists already|has a role/.test(e.message)&&await ask(e.message+"\nПерезаписать?")){try{await post("/api/roles/save",{taskId:t.id,agentId:sp.id,name:name,overwrite:true});toast("ok","Роль перезаписана",name);rolesAt=0}catch(e2){toast("bad","Не сохранена",e2.message)}}else toast("bad","Не сохранена",e.message)}};
         rd.append(sv)}
       row.append(rd)}
     sec.append(row)}
   body.append(sec)}
  /* Цепочка */
  {const parts=[];if(t.parentTaskId)parts.push(taskLink(t.parentTaskId,"follow-up от"));
   if(t.followUps&&t.followUps.length)for(const id of t.followUps)parts.push(taskLink(id,"follow-up"));
   if(t.jobOf)parts.push(el("span","","поручение от "+t.jobOf.taskId));
   const jobs=(S.tasks||[]).filter(x2=>x2.jobOf&&x2.jobOf.taskId===t.id);for(const j of jobs)parts.push(taskLink(j.id,"поручение"));
   if(t.followUpBudget)parts.push(el("span","","бюджет follow-up: "+t.followUpBudget.used+"/"+t.followUpBudget.max));
   if(parts.length){const sec=el("div","dsec");sec.append(el("h3","","Цепочка"));
     for(const p of parts)sec.append(el("div","",p));body.append(sec)}}
  /* Последняя активность */
  {const evs=ACT.filter(e2=>e2.taskId===t.id||t.agents.includes(e2.agentId)).slice(-8).reverse();
   const sec=el("div","dsec");const h3=el("h3","","Последняя активность");const all=el("a","","вся лента →");all.href="#/history/activity";all.onclick=()=>closeDrawer();h3.append(all);sec.append(h3);
   if(!evs.length)sec.append(el("div","","пока пусто"));
   for(const e2 of evs){const r=el("div","act-row");r.append(el("span","tm",time(e2.at||e2.createdAt||"")),el("span","kind "+(e2.kind==="tool_use"?"tool":e2.kind==="tool_result"?"ok":e2.kind==="error"?"err":"think"),e2.kind||e2.type||""),el("span","sum",(e2.agentId?e2.agentId+": ":"")+(e2.tool?e2.tool+" ":"")+(e2.summary||e2.text||"")));sec.append(r)}
   body.append(sec)}
  body.scrollTop=scroll}

/* ── загрузка и события ── */
$("search").setAttribute("autocomplete","off");
$("search").oninput=()=>{tasklistSig="";renderSidebar()};
$("newtask-plus").onclick=()=>{location.hash="#/new"};
$("newtask-plus").onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();location.hash="#/new"}};
$("settings-btn").onclick=()=>{location.hash="#/settings"};
$("proj-switch").onclick=e=>{e.stopPropagation();projectMenu($("proj-switch"))};
$("bell").onclick=async()=>{if(typeof Notification!=="undefined"&&Notification.permission==="default"){try{await Notification.requestPermission()}catch(e){}}
  toast("",bellState(),ATT&&ATT.os?(ATT.os.enabled?"системные (notify-send) включены":ATT.os.reason):"",null)};
document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick()});
tick();
</script>
</body>
</html>`;
