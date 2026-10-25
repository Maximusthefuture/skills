/** Single-file page: vanilla JS, no dependencies. All dynamic text goes through textContent (never innerHTML). */
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Network</title>
<style>
:root{--bg:#f6f7f9;--side:#eef0f3;--card:#fff;--card2:#f2f4f7;--text:#1c2128;--muted:#667085;--line:#e3e6eb;--accent:#2f6fed;--ok:#16a34a;--warn:#b45309;--bad:#dc2626;--idle:#98a2b3;--violet:#7c3aed;--qbg:#fff8e6;--qline:#f0cf86;--okbg:#e9f7ef;--accbg:#e9f0fe;--badbg:#fdeded;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0d1014;--side:#11151a;--card:#151a20;--card2:#1a2027;--text:#e6e9ee;--muted:#8b95a3;--line:#262d36;--accent:#6b9bff;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--idle:#5d6673;--violet:#a78bfa;--qbg:#1d1a10;--qline:#5a4614;--okbg:#122419;--accbg:#151f36;--badbg:#2a1616}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.app{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}
aside{background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:8px;padding:16px 16px 12px;font-weight:600}
.proj{margin:0 10px 12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:pointer}
.proj b{display:flex;align-items:center;font-weight:600;overflow-wrap:anywhere}.proj span.s{display:block;color:var(--muted);font:11px var(--mono);margin-top:2px}
.grp{padding:10px 16px 4px;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
nav a{display:flex;align-items:center;gap:10px;padding:7px 16px;color:var(--muted);text-decoration:none;border-left:2px solid transparent}
nav a .n{font:11px var(--mono);color:var(--idle);width:16px}nav a .c{margin-left:auto;font:11px var(--mono)}
nav a.on{color:var(--text);background:var(--card);border-left-color:var(--accent)}nav a:hover{color:var(--text)}
.foot{margin-top:auto;padding:12px 16px;border-top:1px solid var(--line);color:var(--muted);font:11px var(--mono);word-break:break-all}
.top{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:10px 24px;border-bottom:1px solid var(--line);font:11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:var(--bg);position:sticky;top:0;z-index:2}
.top b{color:var(--text);font-weight:500;margin-left:4px}.top .link{cursor:pointer}.top .link:hover b{text-decoration:underline}.top .r{margin-left:auto;text-transform:none}.top .warnq b{color:var(--warn)}
main{padding:20px 24px 40px;min-width:0}
h1{font-size:22px;font-weight:600;margin:0}.lead{color:var(--muted);margin:2px 0 16px}
h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:22px 0 8px}
.hrow{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}.hrow>.end{margin-left:auto}
.muted{color:var(--muted)}.mono{font-family:var(--mono);font-size:12px}
.win{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}.win button{background:none;border:0;border-radius:0;color:var(--muted);font:11px var(--mono);padding:4px 10px}.win button.on{background:var(--card2);color:var(--text)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));border:1px solid var(--line);border-radius:8px;background:var(--card);margin-bottom:16px}
.kpi{padding:12px 14px;border-right:1px solid var(--line)}.kpi:last-child{border-right:0}
.kpi .l{font:11px var(--mono);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}.kpi .v{font:500 24px var(--mono);margin:6px 0 2px}.kpi .v small{font-size:11px;color:var(--muted);margin-left:6px}.kpi .h{font-size:12px;color:var(--muted)}
.cols{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px;margin-bottom:16px}
.panel{border:1px solid var(--line);border-radius:8px;background:var(--card);overflow-x:auto}.ph{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);font-weight:600;font-size:13px}.ph .end{margin-left:auto;font:11px var(--mono);color:var(--muted);font-weight:400}
.panel table th,.panel table td{padding:8px 14px}.panel table th{font:11px var(--mono);text-transform:uppercase;letter-spacing:.05em}
.ev{display:grid;grid-template-columns:64px 74px minmax(0,1fr);gap:8px;padding:6px 14px;border-bottom:1px solid var(--line);font:12px var(--mono)}.ev:last-child{border:0}.ev .t{color:var(--muted)}.ev .k{color:var(--accent)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--idle);margin-right:6px;flex:none}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}.dot.acc{background:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.agent .top2,.runner .top2{display:flex;align-items:center;gap:8px;font-weight:600}.runner .top2 button{margin-left:auto}.runner .line{overflow-wrap:anywhere}
.ONLINE .dot,.WORKING .dot{background:var(--ok)}.WAITING .dot{background:var(--warn)}.DEAD .dot{background:var(--bad)}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid var(--line);color:var(--muted);font-weight:400}
.badge.ONLINE,.badge.WORKING,.badge.PASS,.badge.READY_FOR_SYNC,.badge.RUNNING,.badge.running{color:var(--ok);border-color:var(--ok)}.badge.WAITING,.badge.IN_PROGRESS,.badge.queued{color:var(--warn);border-color:var(--warn)}.badge.DEAD,.badge.NEEDS_FIX,.badge.ERROR,.badge.BLOCKED,.badge.blocked{color:var(--bad);border-color:var(--bad)}.badge.STOPPED{color:var(--idle)}
.task{margin-bottom:12px}.task.done{opacity:.75}.task h3{margin:0 0 2px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.steps{display:flex;gap:4px;margin:10px 0}.step{flex:1;text-align:center;font:11px var(--mono);padding:4px 0;border-radius:5px;background:var(--bg);color:var(--muted);border:1px solid var(--line)}
.step.past{color:var(--ok)}.step.now{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.chip{padding:1px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--line);font-size:12px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:5px 8px 5px 0;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:400;font-size:12px}tr:last-child td{border-bottom:0}
tr.click{cursor:pointer}tr.click:hover td{background:var(--card2)}tr.sel td:first-child{box-shadow:inset 2px 0 var(--accent)}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted)}
.msg{padding:4px 0;border-bottom:1px solid var(--line)}.msg:last-child{border:0}
.empty{color:var(--muted);padding:12px 14px}
form.card{display:grid;gap:10px;margin-bottom:14px}form label.inline{display:flex;gap:8px;align-items:center;color:var(--text);font-size:13px}form label.inline input{width:auto;margin:0}form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
input,textarea,select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:6px 8px;width:100%}
textarea{min-height:90px;resize:vertical}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.checks{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;color:var(--text);font-size:13px}.checks input{width:auto}
button{font:inherit;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:7px;padding:6px 14px;cursor:pointer}
button.ghost{background:transparent;color:var(--accent)}button:disabled{opacity:.5;cursor:default}
.note{font-size:13px}.note.err{color:var(--bad)}.note.ok{color:var(--ok)}
.banner{padding:10px 14px;margin-bottom:14px;border:1px solid var(--line);border-left:3px solid var(--bad);background:var(--card)}
.openspec{margin-top:6px;padding:6px 10px;border-left:3px solid var(--accent);background:var(--bg)}.mcheck{margin:6px 0;overflow-wrap:anywhere}.draftbox{border:1px dashed var(--accent);border-radius:6px;padding:10px;margin-bottom:12px}.draftbox ul{margin:4px 0 8px;padding-left:18px}.draftbox li.err{color:var(--bad)}.taskback{margin:0 0 10px;font-size:14px}.taskback a{color:var(--accent);text-decoration:none}h3.link{cursor:pointer}h3.link:hover{color:var(--accent)}.inboxrow{margin:8px 0;padding:10px 12px}.inboxrow.blocking{border-left:3px solid var(--bad)}.inboxrow button{margin-top:6px}button.danger{color:var(--bad);border-color:var(--bad)}
.toasts{position:fixed;top:12px;right:12px;z-index:50;display:flex;flex-direction:column;gap:8px;width:min(340px,calc(100vw - 24px));pointer-events:none}
.toast{pointer-events:auto;cursor:pointer;position:relative;background:var(--card);color:var(--text);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:9px 30px 9px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:13px;animation:tin .18s ease-out}
.planov{position:fixed;inset:0;z-index:50;background:var(--bg);display:flex;flex-direction:column}.planov[hidden]{display:none}body.noscroll{overflow:hidden}
.planhead{display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}.planhead b{font-weight:600;overflow-wrap:anywhere;min-width:0;flex:1 1 200px}.planhead .pver{width:auto}.planhead button{margin-left:auto}
.planbody{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 340px;grid-template-rows:minmax(0,1fr);min-height:0}.planbody iframe{width:100%;height:100%;border:0;background:#fff}
.planside{border-left:1px solid var(--line);padding:12px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:10px;background:var(--side)}.planside textarea{width:100%}.planside .small{font-size:12px}
.pmode{align-self:flex-start}.pnote{font-size:13px}.pquote{font-style:italic;color:var(--muted)}.pitem{border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:var(--card);position:relative;margin-top:6px;font-size:13px}.pitem>button{position:absolute;top:2px;right:2px}
.pdiag textarea{font:12px/1.4 var(--mono);white-space:pre;min-height:180px}.pdiag .dst{font-size:12px;margin:4px 0}.pdiag .dst.bad{color:var(--bad)}.pconfirm{border:1px solid var(--accent);background:var(--accbg);border-radius:6px;padding:8px 10px;font-size:13px}.pconfirm div{margin-bottom:6px}.pqs .card{margin:6px 0 0;padding:8px;font-size:13px}.pqs textarea{min-height:44px}.pact summary{cursor:pointer}.pstep{font-size:12px;margin:3px 0;overflow-wrap:anywhere}.pstep.err{color:var(--bad)}.pcritic{border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--card);font-size:13px}.prisk{border-top:1px solid var(--line);padding:6px 0;margin-top:6px}.prisk .psug{color:var(--accent)}.prisk button{margin-top:4px}.psent{border:1px solid var(--ok);background:var(--okbg);border-radius:6px;padding:8px 10px;font-size:13px}.ppick{border:1px solid var(--qline);background:var(--qbg);border-radius:6px;padding:8px}.planside>*{flex-shrink:0}.pdiff{display:flex;gap:6px;align-items:center;font-size:13px}.pdiff input{width:auto;margin:0}.pactions{padding-top:4px}.pfoot{position:sticky;bottom:-12px;margin-top:auto;background:var(--side);padding:8px 0 12px;display:flex;flex-direction:column;gap:8px}.phist summary{cursor:pointer}.planline button{vertical-align:baseline}
@media (max-width:860px){.planbody{grid-template-columns:1fr;grid-template-rows:55vh minmax(0,1fr)}.planside{border-left:0;border-top:1px solid var(--line)}}
.askov{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px}.askbox{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;max-width:460px;white-space:pre-line;box-shadow:0 8px 30px rgba(0,0,0,.25)}.askbox .checks{margin-top:12px}
.prep{margin:6px 0}.prep .prepmore{margin-top:4px}.prep .prepmore label{display:block;margin:4px 0}
.toast.ok{border-left-color:var(--ok)}.toast.warn{border-left-color:var(--warn)}.toast.bad{border-left-color:var(--bad)}
.toast b{display:block;margin-bottom:2px}.toast .x{position:absolute;top:4px;right:8px;border:0;background:none;color:var(--muted);font-size:16px;line-height:1;cursor:pointer;padding:2px}
@keyframes tin{from{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){.toast{animation:none}}
.blocked{margin-top:6px;padding:6px 10px;border-left:3px solid var(--bad);background:var(--bg)}.blocked .checks{margin:6px 0 4px}
pre.log{max-height:280px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px;margin:6px 0 0;font:11px/1.4 var(--mono);white-space:pre-wrap;word-break:break-word}pre.log.err{color:var(--bad)}
.stats{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0;font-size:12px;color:var(--muted)}.stats b{color:var(--text);font-weight:600}
.q{border:1px solid var(--qline);border-left:3px solid var(--warn);background:var(--qbg)}.q .who{font-weight:600}.q textarea{min-height:60px;margin-top:8px}.q .row2{display:flex;gap:8px;align-items:center;margin-top:6px}
.inst{display:flex;gap:6px;margin-top:6px}.inst[hidden]{display:none}.inst input,.inst select{flex:1;min-width:0}.inst button{padding:4px 10px}
.sub{font-size:12px}.sub .DONE{color:var(--ok)}.sub .DOING{color:var(--accent);font-weight:600}.sub .DROPPED{color:var(--idle);text-decoration:line-through}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters select,.filters input{width:auto;min-width:140px}
.total{margin-top:10px;font-size:12px;color:var(--muted)}
.scroll.subs{max-height:150px;min-width:170px;margin-top:4px;padding:2px 6px}.scroll{max-height:300px;overflow-y:auto;margin-top:6px;padding:0 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg)}
.feed{max-height:calc(100vh - 230px);min-height:200px;overflow-y:auto}
.act{max-height:calc(100vh - 250px);min-height:240px;overflow-y:auto}.act.mini{max-height:320px;min-height:0;margin-top:8px;border:1px solid var(--line);border-radius:7px}
.arow{display:grid;grid-template-columns:52px 62px 84px 96px minmax(0,1fr);gap:10px;align-items:baseline;padding:5px 12px;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer}
.act.mini .arow{grid-template-columns:62px 96px minmax(0,1fr)}.act.mini .arow .seq,.act.mini .arow .who{display:none}
.arow:hover{background:var(--card2)}.arow.open{background:var(--card2)}
.arow .seq,.arow .tm{color:var(--muted);font:11px var(--mono);white-space:nowrap}
.arow .who{font-weight:600;overflow-wrap:anywhere}
.arow .more2{color:var(--muted);display:none}.arow:hover .more2{display:inline}.arow .sum{font:12px/1.45 var(--mono);overflow-wrap:anywhere}
.arow.text .sum{font-family:inherit;font-size:13px}.arow.thinking .sum{font-style:italic;color:var(--muted);font-family:inherit}
.arow .tool{display:inline-block;padding:0 6px;margin-right:6px;border:1px solid var(--line);border-radius:5px;font:11px var(--mono);color:var(--text);background:var(--card)}
.kind{font:11px var(--mono);white-space:nowrap}
.kind.tool_use{color:var(--accent)}.kind.tool_result{color:var(--ok)}.kind.err{color:var(--bad)}.kind.thinking{color:var(--violet)}.kind.result{color:var(--accent);font-weight:600}.kind.runner,.kind.session{color:var(--idle)}.kind.stderr{color:var(--warn)}.kind.text{color:var(--text)}
.arow.err .sum{color:var(--bad)}.arow.subag{background:color-mix(in srgb,var(--violet) 5%,transparent)}.arow .subm{color:var(--violet);font-size:11px;margin-right:4px}
.adetail{padding:6px 12px 12px;border-bottom:1px solid var(--line);background:var(--bg);font-size:12px}.adetail pre.log{max-height:380px}
.akinds{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:6px;overflow:hidden}.akinds button{background:none;border:0;border-radius:0;color:var(--muted);font:11px var(--mono);padding:5px 10px}.akinds button.on{background:var(--card2);color:var(--text)}
.akinds button .k{opacity:.7;margin-left:4px}
.follow{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}.filters .follow input{width:auto;min-width:0}
.newpill{display:block;width:100%;border:0;border-bottom:1px solid var(--line);background:var(--card2);color:var(--accent);font-size:12px;padding:6px;cursor:pointer}
@media (max-width:700px){.arow{grid-template-columns:84px 74px minmax(0,1fr)}.arow .seq,.arow .tm{display:none}}
.sfeed{max-height:calc(100vh - 330px);min-height:240px;overflow-y:auto}
.jrow{display:grid;grid-template-columns:58px 74px 76px 74px minmax(0,1fr);gap:10px;align-items:baseline;padding:6px 12px;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer}.jrow:hover{background:var(--card2)}
.jrow .tm,.jrow .by{color:var(--muted);font:11px var(--mono);white-space:nowrap}.jrow .tk{font:11px var(--mono);color:var(--accent);white-space:nowrap}
.jrow .txt{white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.jrow.open .txt{display:block}
.jk{font:11px var(--mono);white-space:nowrap}.jk.incident{color:var(--warn)}.jk.action{color:var(--accent)}.jk.needs-you{color:var(--bad);font-weight:600}.jk.session{color:var(--violet)}.jk.note{color:var(--text)}
.jrow.resolved .txt{color:var(--muted)}
.jsess{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font:11px var(--mono);color:var(--muted);min-width:0}.jsess span{overflow-wrap:anywhere}.jsess button{padding:2px 10px;font-size:12px;flex:none}
pre.jlog{grid-column:1/-1;max-height:420px;cursor:text;margin:0}
.ph .end a{color:var(--accent);text-decoration:none}.jrow.resolved .jk.needs-you{color:var(--muted);font-weight:400}
.ph .sk{margin-left:12px;font-weight:400}.ph .sk button{padding:3px 8px}
.need{border-left:3px solid var(--bad);margin-bottom:10px}.need textarea{margin-top:8px;min-height:70px}.need .row2{flex-wrap:wrap}.need .hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.need .rec{margin-top:6px;padding:6px 10px;background:var(--bg);border-radius:6px}.need .row2{display:flex;gap:8px;margin-top:8px}.need .row2 button{padding:4px 12px}
.scol{display:grid;gap:12px;align-content:start}.scol h3{margin:0 0 6px;font-size:13px}
.tl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:0 10px;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer}.tl:last-child{border:0}.tl input{width:auto;margin:3px 0 0}.tl .nm{font:12px var(--mono)}.tl .ds{grid-column:2;font-size:12px;color:var(--muted)}.tl.off .nm{color:var(--muted);text-decoration:line-through}
.rules{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;font-size:12px;margin-top:8px}.rules b{font:12px var(--mono);font-weight:500;text-align:right;white-space:nowrap}.rules input{width:64px;padding:2px 6px;font:12px var(--mono);text-align:right}.rules .row2{display:flex;gap:8px;align-items:center;margin-top:4px}.rules .row2 button{padding:3px 10px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.runner .row2{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:12px}.runner .row2 a{font-size:12px;color:var(--muted)}.runner .row2 a:hover{color:var(--accent)}
.mail{display:inline-flex;align-items:center;justify-content:center;width:32px;height:30px;margin-left:8px;padding:0;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--accent);font-size:17px;line-height:1;vertical-align:middle;cursor:pointer}.mail:hover{border-color:var(--accent);background:var(--accbg)}
.fyi{border:1px solid var(--line);border-left:3px solid var(--accent);background:var(--card)}.fyi .who{font-weight:600}.fyi .tag{font:11px var(--mono);color:var(--accent);margin-left:6px}.fyi .row2{display:flex;gap:8px;align-items:center;margin-top:8px}.fyi .row2 button{padding:3px 12px}
.compose .hist .from{color:var(--accent);font-weight:600;margin-right:4px}.compose .hist .rd.warn{color:var(--warn)}
.compose .urgent{display:flex;gap:10px;align-items:flex-start;margin-top:10px;padding:8px 12px;border:1px solid var(--qline);border-radius:8px;background:var(--qbg);font-size:12px;color:var(--muted);cursor:pointer}.compose .urgent input{width:18px;height:18px;margin:1px 0 0;flex:none;accent-color:var(--warn);cursor:pointer}.compose .urgent b{color:var(--warn);font-size:13px;margin-right:2px}.compose .urgent.on{border-color:var(--warn);box-shadow:0 0 0 1px var(--warn) inset}
button.warnbtn{background:var(--warn);border-color:var(--warn);color:#fff}
#schedules{margin-bottom:14px}.srow{display:grid;grid-template-columns:auto minmax(0,1.6fr) 110px minmax(0,1fr) minmax(0,1.3fr) auto;gap:12px;align-items:center;padding:9px 14px;border-top:1px solid var(--line);font-size:13px}
.srow input{width:auto;margin:0}.srow .nm b{display:block}.srow .nm span,.srow .sub2{font-size:12px;color:var(--muted)}.srow .cr{font:12px var(--mono)}.srow .last.err{color:var(--bad)}.srow .last.skip{color:var(--warn)}.srow button{padding:4px 12px;white-space:nowrap}.srow.off .nm,.srow.off .cr{opacity:.55}.ph button.small{white-space:nowrap;flex:none}.sacts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.sform{margin:10px 14px}.spad{padding:10px 14px}.note.bad{color:var(--bad)}
@media (max-width:820px){.srow{grid-template-columns:auto minmax(0,1fr) auto}.srow .cr,.srow .nx,.srow .last{grid-column:2}}
.compose{margin:6px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}.compose.open{border-color:var(--accent)}
.compose .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.compose .hd button{padding:4px 12px}.compose .hd .muted{font-size:12px}
.compose textarea{min-height:76px;margin-top:8px;background:var(--card)}.compose .row2{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.compose .row2 button{padding:5px 14px}
.compose .who{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--muted)}.compose .who button{padding:1px 9px;font-size:12px;border-radius:999px}
.compose .hist{margin-top:8px;font-size:12px}.compose .hist div{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:8px;padding:4px 0;border-top:1px solid var(--line)}.compose .hist .tm{color:var(--muted);font-family:var(--mono)}.compose .hist .rd{color:var(--muted);white-space:nowrap}.compose .hist .rd.ok{color:var(--ok)}
@media (max-width:700px){.jrow{grid-template-columns:56px 74px minmax(0,1fr)}.jrow .by{display:none}.jrow .txt{grid-column:1/-1}}
.ptl{display:flex;gap:3px;min-height:26px;margin:10px 0}
.ptl .seg{min-width:84px;display:block;line-height:16px;padding:4px 8px;text-align:center;font:11px var(--mono);overflow-wrap:anywhere;background:var(--bg);color:var(--muted);border:1px solid var(--line);border-radius:5px}
.ptl .seg.past,.ptl .seg.now,.ptl .seg.bad{min-width:140px}
.ptl .seg .rd{display:inline-flex;gap:2px;margin-left:6px;vertical-align:1px}.ptl .seg .rd i{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.45}.ptl .seg .rd i.last{opacity:1}
.ptl .seg.past{background:var(--okbg);color:var(--ok);border-color:transparent}.ptl .seg.now{background:var(--accbg);color:var(--accent);border-color:var(--accent);font-weight:600}.ptl .seg.bad{background:var(--badbg);color:var(--bad);border-color:var(--bad);font-weight:600}
.pbar{height:8px;border-radius:4px;background:var(--card2);border:1px solid var(--line);overflow:hidden;display:flex}.pbar>span{height:100%}.pbar .g{background:var(--ok)}.pbar .q{background:var(--muted);opacity:.6}.pbar .b{background:var(--accent)}.pbar .r{background:var(--bad)}
.pbar.wait{background:repeating-linear-gradient(45deg,var(--card2) 0 6px,var(--line) 6px 8px)}
.pkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:4px 0 10px}
.pk{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 12px}.pk .l{font-size:12px;color:var(--muted)}.pk .v{font:500 18px var(--mono);margin:2px 0 6px}.pk .v small{font-size:12px;color:var(--muted);margin-left:6px;font-weight:400}.pk .h{font-size:12px;color:var(--muted);margin-top:5px}
.pagents{margin:2px 0 10px}.prow{display:grid;grid-template-columns:130px minmax(0,1fr) 56px;gap:12px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}
.prow .nm b{display:block;font-size:13px}.prow .nm span{font:11px var(--mono);color:var(--muted)}
.prow .st{font-size:12px;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}.prow .st.ok{color:var(--ok)}.prow .st.warn{color:var(--warn)}.prow .st.now{color:var(--text)}.prow .st.bad{color:var(--bad)}
.prow .cnt{font:12px var(--mono);text-align:right;color:var(--muted)}.prow .cnt b{color:var(--text);font-weight:500}
.plegend{display:flex;gap:14px;font-size:11px;color:var(--muted);margin-top:6px}.plegend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.ovp{display:grid;grid-template-columns:minmax(0,1.5fr) 168px minmax(0,2fr) 60px;gap:12px;align-items:center;padding:8px 14px;border-top:1px solid var(--line);cursor:pointer;font-size:13px}.ovp:hover{background:var(--card2)}
.ovp .tt{overflow-wrap:anywhere}.ovp .tt span{color:var(--muted);font:11px var(--mono);margin-right:6px}.ovp .badge{text-align:center}.ovp .pct{font:12px var(--mono);text-align:right}
@media (max-width:700px){.ptl .seg,.ptl .seg.past,.ptl .seg.now,.ptl .seg.bad{min-width:0;padding:0 4px;font-size:10px}.ovp{grid-template-columns:minmax(0,1fr) auto}.ovp .pbar{grid-column:1/-1}.ovp .pct{grid-row:1;grid-column:2}.ovp .badge{display:none}.prow{grid-template-columns:90px minmax(0,1fr) 44px}}
.tscroll{overflow-x:auto}
.acards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:10px;margin:10px 0}
.acard{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:10px 12px;min-width:0}
.acard .ah{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.acard .ah b{font-size:14px}.acard .tag{font:11px var(--mono);color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:0 7px}
.acard .stats2{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.acard .stats2 .chip{font:11px var(--mono)}
.acard .ag{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:14px;margin-top:8px}
.acard .lbl{font:10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px}
.acard .txt{font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.acard .asec{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)}
.acard .find{display:flex;gap:8px;align-items:flex-start;margin-top:5px;font-size:13px}.acard .find .badge{flex:none;margin-top:1px}.acard .find>*:last-child{min-width:0;flex:1}
.acard .scroll.subs{margin-top:0;max-height:170px}
.chip.bok{color:var(--ok);border-color:var(--ok)}
.oprop{padding:10px 14px;border-top:1px solid var(--line)}.oprop.decided{opacity:.7}.oprop .ah{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.oprop .orow{display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px;margin-top:6px;font-size:13px}
.oprop .lbl{font:10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.oissue{padding:8px 14px;border-top:1px solid var(--line);font-size:13px}.oissue .badge{margin-right:6px}
.orep{border-top:1px solid var(--line)}.orep summary{padding:8px 14px;cursor:pointer;font-size:13px}.omd{white-space:pre-wrap;padding:6px 14px 12px;font-size:13px;line-height:1.55}
#o-body .panel{margin-top:14px}@media (max-width:820px){.oprop .orow{grid-template-columns:1fr}}.tag.spawned{color:var(--violet);border-color:var(--violet)}.spawnbox{margin:8px 0;padding:8px 12px;border-left:3px solid var(--violet);background:var(--bg);font-size:13px}.spawnbox .srow2{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}.spawnbox .why{margin-left:16px}
.qopts{display:grid;gap:6px;margin:8px 0}.qopt{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--card);color:var(--text);font-size:13px}
.qopt:has(input:checked){border-color:var(--accent);background:var(--accbg)}.qopt input{width:auto;margin:3px 0 0}.qopt .tag{margin-left:8px;font:11px var(--mono);color:var(--accent)}.qopt .muted{margin-top:2px}
.diff{margin-top:8px}.diff .dcommits{font-size:12px;color:var(--muted);margin:4px 0 6px}.dfile{border:1px solid var(--line);border-radius:6px;margin:4px 0;background:var(--card)}
.dfile summary{cursor:pointer;padding:4px 8px;font-size:12.5px}.dpatch{margin:0;padding:6px 8px;font:12px/1.45 var(--mono);overflow-x:auto;max-height:480px;border-top:1px solid var(--line);white-space:pre}
.dpatch span{display:block}.dpatch .dln{display:inline-block;width:3.2em;color:var(--muted);font-style:normal;user-select:none;opacity:.7}.dpatch .dclick{cursor:pointer}.dpatch .dclick:hover{outline:1px dashed var(--accent)}
.dpatch .dcm{white-space:pre-wrap;background:var(--qbg);border-left:3px solid var(--warn);padding:4px 8px;margin:2px 0 2px 3.2em;font-family:inherit}.dpatch .dcm button{margin-left:8px;padding:0 6px}
.dpatch .dcm.sent.fixed{background:var(--okbg);border-color:var(--ok)}.dpatch .dcm.sent.declined{background:var(--card2);border-color:var(--idle)}
.reviewbox{margin:8px 0;padding:8px 12px;border-left:3px solid var(--warn);background:var(--bg);font-size:13px}.reviewbox .rrow{margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)}.reviewbox .rrow.fixed,.reviewbox .rrow.declined{opacity:.75}.reviewbox .rnote{color:var(--accent);margin-top:2px}
.dpatch .dcomment{white-space:normal;display:flex;gap:6px;align-items:flex-start;margin:4px 0 4px 3.2em}.dpatch .dcomment textarea{min-height:44px;flex:1;font:12px var(--mono)}.dbar{margin:4px 0 6px}.dpad{padding:4px 8px}button.small{padding:2px 8px;font-size:12px;margin-top:4px}.dadd{color:var(--ok)}.ddel{color:var(--bad)}.dhunk{color:var(--accent)}.dpatch .dadd{background:var(--okbg)}.dpatch .ddel{background:var(--badbg)}
.costbar{height:4px;border-radius:2px;background:var(--line);margin:4px 0 2px;max-width:320px;overflow:hidden}.costbar i{display:block;height:100%;background:var(--accent)}.costbar.near i{background:var(--warn)}.costbar.over i{background:var(--bad)}.chip.bbad{color:var(--bad);border-color:var(--bad)}
.icard{border-left:3px solid var(--accent);margin-bottom:10px}
details.more{margin:0}details.more>summary{list-style:none;cursor:pointer;color:var(--text);font-size:13px;line-height:1.5}details.more>summary::-webkit-details-marker{display:none}
details.more>summary .tg::after{content:"ещё ▾";color:var(--accent);font-size:12px;white-space:nowrap}details.more[open]>summary .tg::after{content:"свернуть ▴"}details.more[open]>summary .pv{display:none}
@media (max-width:820px){.acard .ag{grid-template-columns:1fr}.acard .stats2{margin-left:0}}
tr.exp td{background:var(--bg)}.detail{display:grid;gap:4px;font-size:13px;padding:4px 0 6px 18px}
[hidden]{display:none!important}.nw{white-space:nowrap}.path{max-width:420px;overflow-wrap:anywhere}
.app>div{min-width:0}
@media (max-width:820px){.app{grid-template-columns:minmax(0,1fr)}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}nav{display:flex;overflow-x:auto}.grp,.foot{display:none}nav a{border-left:0;border-bottom:2px solid transparent;white-space:nowrap;padding:8px 12px}nav a.on{border-bottom-color:var(--accent)}.cols{grid-template-columns:1fr}.top{position:static;padding:8px 16px}main{padding:16px}.kpi{border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="app">
<aside>
  <div class="brand">◆ agent network</div>
  <div class="proj" id="projcard" title="Проекты"><b><span class="dot" id="projdot"></span><span id="projname">…</span></b><span class="s" id="projsub"></span></div>
  <nav id="nav">
    <div class="grp">Работа</div>
    <a href="#/inbox" data-tab="inbox"><span class="n">00</span>Входящие<span class="c" id="c-inbox"></span></a>
    <a href="#/overview" data-tab="overview"><span class="n">01</span>Обзор</a>
    <a href="#/tasks" data-tab="tasks"><span class="n">02</span>Задачи<span class="c" id="c-tasks"></span></a>
    <a href="#/runs" data-tab="runs"><span class="n">03</span>Запуски<span class="c" id="c-runs"></span></a>
    <a href="#/activity" data-tab="activity"><span class="n">04</span>Активность<span class="c" id="c-activity"></span></a>
    <a href="#/deploy" data-tab="deploy"><span class="n">05</span>Раскатка<span class="c" id="c-deploy"></span></a>
    <div class="grp">Инфраструктура</div>
    <a href="#/supervisor" data-tab="supervisor"><span class="n">06</span>Надзор<span class="c" id="c-supervisor"></span></a>
    <a href="#/observer" data-tab="observer"><span class="n">07</span>Наблюдатель<span class="c" id="c-observer"></span></a>
    <a href="#/runners" data-tab="runners"><span class="n">08</span>Runner'ы<span class="c" id="c-runners"></span></a>
    <a href="#/projects" data-tab="projects"><span class="n">09</span>Проекты<span class="c" id="c-projects"></span></a>
    <a href="#/events" data-tab="events"><span class="n">10</span>События</a>
  </nav>
  <div class="foot">сеть<br><span id="dir"></span></div>
</aside>
<div>
  <div class="top" id="topbar"></div>
  <main>
    <div class="banner note err" id="priceerr" hidden></div>
    <section id="questions" hidden><div class="grid" id="qlist"></div><div style="height:14px"></div></section>
    <section id="notes" hidden><div class="grid" id="nlist"></div><div style="height:14px"></div></section>

    <section data-panel="inbox" hidden>
      <h1>Входящие</h1><div class="lead">Всё, что ждёт вашего решения, во всех проектах страницы: вопросы агентов, планы и change'и, задачи на приёмку, вливания, которые не прошли проверку, BLOCKED-задачи, решения надзора, предложения наблюдателя. Сверху — то, без чего рой стоит. Пункт уходит сам, когда вы решили.</div>
      <div class="checks"><button type="button" class="ghost" id="notif-on">Включить уведомления браузера</button><span class="muted" id="notif-state"></span></div>
      <div id="inbox"></div>
    </section>
    <section data-panel="overview">
      <div class="hrow"><div><h1>Обзор</h1><div class="lead">Что делают агенты сейчас и сколько это стоит.</div></div><div class="end win" id="win"><button data-w="24h">24ч</button><button data-w="7d">7д</button><button data-w="30d">30д</button></div></div>
      <div class="kpis" id="kpis"></div>
      <div class="panel" id="ov-progress" style="margin-bottom:16px" hidden></div>
      <div class="cols"><div class="panel" id="ov-runners"></div><div class="panel" id="ov-phases"></div></div>
      <div class="panel" id="ov-events"></div>
    </section>

    <section data-panel="tasks" hidden>
      <div class="hrow"><div><h1>Задачи</h1><div class="lead" id="tasks-lead">Текущие и завершённые задачи проекта.</div></div><button class="end" id="newbtn" type="button" hidden>+ Новая задача</button></div>
      <form class="card" id="newtask" hidden>
        <div class="draftbox" id="draftbox" hidden><label>Опишите своими словами — агент изучит код и заполнит форму ниже: название, конкретное описание, команду, подготовку, сборку, контракт. Можно вставить тикет целиком<textarea id="draftidea" placeholder="Нужен частичный возврат заказа, по сумме; письмо клиенту после возврата"></textarea></label>
          <div class="checks"><button type="button" class="ghost" id="draftgo">Составить черновик</button><button type="button" class="ghost" id="draftstop" hidden>Остановить</button><span class="muted" id="draftstate"></span></div>
          <div id="draftwhy" hidden></div></div>
        <label>OpenSpec change (необязательно): агенты делят его tasks.md по номерам задач — или пишут новый<select name="openspec" id="openspec"><option value="">— без OpenSpec —</option><option value="__new__">+ написать новый change…</option></select></label>
        <div id="specfolders" class="note" hidden></div>
        <label id="proposes-row" hidden>Имя нового change (латиница, цифры, -): lead пишет его, остальные ревьюят; код не меняется<input name="proposes" placeholder="add-loyalty-discount" maxlength="60"></label>
        <label id="from-row" hidden>Артефакты аналитиков (необязательно): путь к папке или .md-файлам, по одному на строку. Это вход, а не change: lead покажет их страницей, проведёт допрос и напишет свой change по правилам проекта, а вы примете его на второй странице<textarea name="from" rows="2" placeholder="/Users/me/Downloads/loyalty-discount/"></textarea></label>
        <label>Название<input name="title" maxlength="200" placeholder="Отмена заказа: POST /orders/{id}/cancel"></label>
        <label>Описание — конкретно: что сделать, где, ожидаемое поведение, кто что делает (с OpenSpec change — необязательно)<textarea name="description" placeholder="Отменять можно NEW и PAID; при PAID писать событие OrderCancelled. backend — API и сервис, reviewer — тесты."></textarea></label>
        <div class="row"><label>Lead (интегрирует)<select name="lead" id="lead"></select></label><label>Остальные агенты<div class="checks" id="others"></div></label></div>
        <div class="row">
          <label title="Lead сдаёт задачу только после зелёного прогона этой команды на слитом результате. По умолчанию — verifyCommand из runners.json; пусто — без проверки.">Сборка и тесты (--verify)<input name="verifyCommand" placeholder="без проверки сборки"></label>
          <label>Follow-up задач на цепочку<input name="maxFollowUps" type="number" min="0" max="20" value="0"></label>
          <label>Раундов исправлений<input name="maxFixRounds" type="number" min="0" max="20" value="3"></label>
          <label title="Сумма всех сессий агентов задачи. Достигнута — задача встаёт в BLOCKED, решаете вы: добавить денег или отменить. Пусто — без лимита.">Лимит стоимости, $<input name="maxCostUsd" type="number" min="0" step="0.5" placeholder="без лимита"></label>
        </div>
        <div class="prep"><label class="inline">Подготовка: <select name="depth" style="width:auto">
          <option value="fast">быстро — сразу к соглашению</option>
          <option value="standard" selected>стандарт — lead уточняет постановку</option>
          <option value="thorough">тщательно — допрос, план на утверждение, критик</option>
          <option value="custom" hidden>своя настройка</option></select></label>
        <span class="muted small" id="depthnote"></span>
        <details class="prepmore"><summary class="muted">настроить вручную</summary>
        <label class="inline" title="Lead сначала читает задачу и код и либо задаёт вам вопросы (с вариантами), либо пишет, как понял задачу; соглашение — только после этого"><input type="checkbox" name="clarify" checked> Сначала уточнить постановку: lead задаст вопросы или напишет, как понял задачу</label>
        <label class="inline" title="По методу grill-me: lead разбирает задачу раундами вопросов — объём, поведение, граничные случаи, данные, что считать готовым, что не трогать — каждый с вариантами и рекомендацией; факты из кода выясняет сам. В конце спрашивает «Как я понял: … Всё так?»; план и соглашение — только после вашего «да», а решения допроса lead переносит в план"><input type="checkbox" name="grill"> Допрос (grill-me): раунды вопросов, в конце вы подтверждаете, как lead понял задачу</label>
        <label class="inline" title="Lead пишет план HTML-страницей: кто что делает, файлы, контракты, риски, вопросы к вам. Вы оставляете замечания к блокам, правите текст прямо в плане и утверждаете; соглашение и код — только после утверждения"><input type="checkbox" name="planReview"> План на утверждение: lead пишет план страницей, вы правите и утверждаете его</label>
        </details></div>
        <div class="prep"><label class="inline" title="Lead может добавить агентов из шаблонов spawn (runners.json), если решит, что работы больше, чем людей в команде. Каждый добавленный агент — отдельная сессия, примерно как ещё один участник по стоимости. Без галочки lead делит работу между выбранными агентами."><input type="checkbox" name="allowSpawn"> Lead может добавлять агентов</label></div>
        <div class="prep"><label>Проект контракта OpenAPI <span class="muted">(если задача меняет API: абсолютный путь к Maven-проекту со спекой; lead поменяет её в своём worktree и поднимет версию)</span>
          <input name="contract" placeholder="/Users/me/projects/orders-api" autocomplete="off"></label><div class="muted small" id="contractnote"></div></div>
        <div class="checks"><button type="submit">Создать задачу</button><span class="note" id="formnote"></span></div>
      </form>
      <div class="panel" id="schedules" hidden></div>
      <div class="taskback" id="taskback" hidden><a href="#" id="taskback-link">← Все задачи</a><span class="muted"> · открыта <span id="taskback-id"></span></span></div>
      <div id="tasks"></div>
    </section>

    <section data-panel="runs" hidden>
      <h1>Запуски</h1><div class="lead">Каждая сессия агента: сколько шла, сколько токенов и денег.</div>
      <div class="filters"><select id="f-agent"></select><select id="f-task"></select><select id="f-model"></select><select id="f-status"></select></div>
      <div class="panel"><table id="runs"></table></div>
      <div class="total" id="runtotal"></div>
    </section>

    <section data-panel="activity" hidden>
      <h1>Активность</h1><div class="lead">Что делают агенты: вызовы инструментов, результаты, их текст и мысли. Новые сверху; нажмите на строку, чтобы раскрыть.</div>
      <div class="filters"><div class="akinds" id="a-kinds"></div><select id="a-agent"></select><select id="a-task"></select><input id="a-q" placeholder="поиск: команда, файл, текст"><label class="follow"><input type="checkbox" id="a-follow" checked>следить</label></div>
      <div class="panel act" id="activity"></div>
      <div class="total" id="a-total"></div>
    </section>

    <section data-panel="deploy" hidden>
      <h1>Раскатка</h1><div class="lead">Влитая задача → её ветка в Bitbucket (push по SSH вашим ключом) → job в Jenkins (через MCP) → проверка раскатки в Kubernetes. Перед push — «Для раскатки»: какие свойства нужны сервису и заданы ли они в окружении. Агенты ничего отсюда не запускают: только вы.</div>
      <h2>Влитые задачи</h2><div class="lead">Задачи, влитые в проект кнопкой «Влить в проект» и не откаченные: какая уже на стенде в Kubernetes, а какая лежит в ветке и ждёт своего часа.</div><div id="dready"></div>
      <h2>Раскатки</h2><div id="druns"></div>
      <h2>Настройки</h2><div class="lead">Хранятся в .agent-network/deploy/settings.json проекта. Секреты сюда не пишите: в переменных MCP пишите <span class="mono">&#36;{ИМЯ}</span> — значение возьмётся из окружения сервера страницы.</div><div id="dsettings"></div>
    </section>

    <section data-panel="observer" hidden>
      <div class="hrow"><div><h1>Наблюдатель</h1><div class="lead">Смотрит на закрытые задачи и ищет проблемы самой системы: отказы протокола, лимиты ходов, сдавшиеся runner'ы, долгие ответы, дорогие фазы. Пишет отчёт с предложениями; принятое предложение становится задачей для роя.</div></div><button class="end" id="o-run" type="button" hidden>Запустить сейчас</button></div>
      <div class="card" id="o-none" hidden>Наблюдатель не настроен: добавьте секцию "observer" в runners.json (есть в примерах) и перезапустите ui.</div>
      <div id="o-body" hidden>
        <div class="kpis" id="o-kpis"></div>
        <div class="panel"><div class="ph">Предложения<span class="end" id="o-pcount"></span></div><div id="o-props"></div></div>
        <div class="panel"><div class="ph">Известные проблемы<span class="end" id="o-icount"></span></div><div id="o-issues"></div></div>
        <div class="panel"><div class="ph">Отчёты</div><div id="o-reports"></div></div>
      </div>
    </section>
    <section data-panel="supervisor" hidden>
      <div class="hrow"><div><h1>Надзор</h1><div class="lead">Помощник оператора. Детектор без модели раз в 10 с смотрит на рой; когда находит инцидент, запускает сессию надзора: она разбирается, чинит, что может, и отдаёт вам то, что решаете только вы.</div></div><button class="end" id="s-toggle" type="button" hidden></button></div>
      <div class="card" id="s-none" hidden></div>
      <div id="s-body" hidden>
        <div class="kpis" id="s-kpis"></div>
        <div id="s-needs"></div>
        <div class="cols">
          <div class="panel"><div class="ph">Журнал<span class="akinds sk" id="s-kinds"></span><span class="end" id="s-jcount"></span></div><div class="sfeed" id="s-journal"></div></div>
          <div class="scol"><div class="card" id="s-settings"></div><div class="card" id="s-tools"></div></div>
        </div>
        <details id="s-logd"><summary>Лог надзора</summary><pre class="log" id="s-log"></pre></details>
      </div>
    </section>

    <section data-panel="runners" hidden>
      <h1>Runner'ы</h1><div class="lead" id="runners-lead">Агенты проекта: запуск, модель, инструкции, лог.</div>
      <div class="grid" id="runners"></div>
      <h2>Скиллы агентов</h2><div class="lead">Какие скиллы агент может загружать. Выключенный скилл runner называет агенту в промпте, а хук pre-skill отклоняет его загрузку (Skill или чтение SKILL.md). Действует со следующей сессии и пишется в runners.json (disabledSkills). «без: change» и «без: код» — скилл выключен только в задачах этого типа (disabledSkillsByTask в runners.json). Claude Code выключенных скиллов не видит вовсе: их описания не тратят токены.</div><div id="skills"></div>
      <h2>Роли проекта</h2><div class="lead">Что делают агенты, которых lead добавляет сам: роль по имени из библиотеки (.agent-network/roles) или своя, написанная под задачу. На чём агент работает (CLI, модель, права), решает шаблон в runners.json.</div><div class="grid" id="roles"></div>
      <h2>Агенты в сети</h2><div class="grid" id="agents"></div>
      <h2>Worktree проекта</h2><div class="lead">Убрать разом все worktree проекта: агентов (если у них нет открытых задач), контрактов API закрытых и удалённых задач, брошенные проверками вливания. Без --force: папка с незакоммиченными правками и невлитая ветка остаются, ответ скажет почему. Нужные worktree создадутся заново перед следующей задачей.</div>
      <div class="checks"><button type="button" class="ghost" id="wt-clean">Убрать все worktree проекта</button></div><pre class="log" id="wt-out" hidden></pre>
    </section>

    <section data-panel="projects" hidden>
      <h1>Проекты</h1><div class="lead">Репозитории на этой странице. Нажмите на строку, чтобы перейти к проекту.</div>
      <div class="panel"><table id="projects"></table></div>
      <div class="total">Добавить проект: ещё один --runners при запуске, например <span class="mono">ui --runners shop.json --runners blog.json</span>.</div>
    </section>

    <section data-panel="events" hidden>
      <h1>События</h1><div class="lead">Что происходило в задачах проекта, новые сверху (последние 50 на задачу).</div>
      <div class="filters"><select id="e-task"></select><select id="e-type"></select></div>
      <div class="panel feed" id="events"></div>
    </section>
  </main>
</div>
</div>
<script>
const PHASES=["DISCUSS","IMPLEMENT","SYNC","INTEGRATE","DONE"];
const TABS=["inbox","overview","tasks","runs","activity","deploy","supervisor","observer","runners","projects","events"];
const WIN={"24h":864e5,"7d":7*864e5,"30d":30*864e5};
const $=id=>document.getElementById(id);
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function badge(v,text){return el("span","badge "+v,text===undefined?v:text)}
function dot(cls){return el("span","dot"+(cls?" "+cls:""))}
function ago(iso){const s=Math.max(0,(Date.now()-new Date(iso))/1000);if(s<60)return Math.round(s)+" с назад";if(s<3600)return Math.round(s/60)+" мин назад";if(s<86400)return Math.round(s/3600)+" ч назад";return Math.round(s/86400)+" дн назад"}
function since(iso){return ago(iso).replace(" назад","")}
function time(iso){return new Date(iso).toLocaleTimeString([],{hour12:false})}
function fmtMs(ms){const s=Math.round(ms/1000);if(s<60)return s+" с";const m=Math.floor(s/60);if(m<60)return m+" мин"+(s%60?" "+(s%60)+" с":"");return Math.floor(m/60)+" ч"+(m%60?" "+(m%60)+" мин":"")}
function fmtTok(n){return n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+"M":n>=1e3?Math.round(n/1e3)+"k":String(n)}
function fmtUsd(n,est){return (est?"≈ ":"")+"$"+n.toFixed(n<1?3:2)}
function plural(n,one,few,many){const a=n%10,b=n%100;return a===1&&b!==11?one:a>=2&&a<=4&&(b<12||b>14)?few:many}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function td(text,cls){return el("td",cls,text)}
function row(cells){const r=el("tr");cells.forEach(c=>r.append(c instanceof Node?c:td(c)));return r}
function head(names){const r=el("tr");names.forEach(n=>r.append(el("th","",n)));return r}

let route=parseHash();
function parseHash(){const m=location.hash.replace(/^#\/?/,"").split("/");const tab=TABS.includes(m[0])?m[0]:"overview";return {tab,project:m[1]?decodeURIComponent(m[1]):null,task:tab==="tasks"&&m[2]?decodeURIComponent(m[2]):null}}
function go(tab,project,task){location.hash="#/"+tab+(project?"/"+encodeURIComponent(project):"")+(project&&task?"/"+encodeURIComponent(task):"")}
// one task on its own: #/tasks/<project>/<task> shows its card alone, at the top, with the way back to the list
function openTask(taskId,project){go("tasks",project||route.project,taskId);window.scrollTo(0,0)}
function q(path){return path+(route.project?(path.includes("?")?"&":"?")+"project="+encodeURIComponent(route.project):"")}
async function getJSON(path){const r=await fetch(path,{cache:"no-store"});if(!r.ok)throw new Error(r.status+"");return r.json()}
// a question in the page instead of confirm(): some browsers (the desktop app's own) answer confirm() with "cancel" by themselves
// a yes/no question; with input (its placeholder) also a line of text: then "Да" gives that text ("" when left empty), "Отмена" false
function ask(text,input){return new Promise(done=>{const o=el("div","askov");o.setAttribute("role","dialog");const b=el("div","askbox");b.append(el("div","",text));
  const f=input?document.createElement("textarea"):null;if(f){f.rows=2;f.placeholder=input;f.style.width="100%";f.style.marginTop="8px";b.append(f)}
  const r=el("div","checks");const yes=el("button","","Да");yes.type="button";const no=el("button","ghost","Отмена");no.type="button";
  const ok=()=>f?f.value.trim():true;
  const end=v=>{o.remove();removeEventListener("keydown",key,true);done(v)};const key=e=>{if(e.key==="Escape"){e.stopPropagation();end(false)}else if(e.key==="Enter"&&(!f||e.metaKey||e.ctrlKey)){e.preventDefault();end(ok())}};
  yes.onclick=()=>end(ok());no.onclick=()=>end(false);o.onclick=e=>{if(e.target===o)end(false)};addEventListener("keydown",key,true);
  r.append(yes,no);b.append(r);o.append(b);document.body.append(o);(f||yes).focus()})}
async function post(url,body){const r=await fetch(q(url),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})});const t=await r.text();let j;try{j=JSON.parse(t)}catch(e){j={message:t}}if(!r.ok)throw new Error(j.message||t);return j}
window.addEventListener("hashchange",()=>{const r=parseHash();const switched=r.project&&r.project!==route.project;route.tab=r.tab;route.task=r.task;if(r.project)route.project=r.project;if(switched)resetProject();showTab();tick()});
document.querySelectorAll("nav a").forEach(a=>a.addEventListener("click",ev=>{ev.preventDefault();go(a.dataset.tab,route.project)}));
$("projcard").onclick=()=>go("projects",route.project);
function showTab(){document.querySelectorAll("[data-panel]").forEach(s=>s.hidden=s.dataset.panel!==route.tab);document.querySelectorAll("nav a").forEach(a=>a.classList.toggle("on",a.dataset.tab===route.tab))}

let win=WIN[store("an.win")]?store("an.win"):"24h";
document.querySelectorAll("#win button").forEach(b=>b.onclick=()=>{win=b.dataset.w;store("an.win",win);render()});
function inWin(iso,w){return !!iso&&Date.now()-Date.parse(iso)<=WIN[w||win]}

let S=null,RUNS=[],PROJ=[],controlMode=false,n=0;
async function tick(){
  try{
    const s=await getJSON(q("/api/state"));S=s;controlMode=!!s.control;watchTransitions(s);watchSupervisor(s);watchNotes(s);
    if(!route.project)route.project=s.project.id;
    if(["overview","runs","runners"].includes(route.tab)||!n)RUNS=(await getJSON(q("/api/runs"))).runs;
    if(route.tab==="projects"||n%3===0)PROJ=(await getJSON("/api/projects")).projects;
    if(["activity","runners","tasks","overview"].includes(route.tab))await fetchActivity();
    if(route.tab==="supervisor")SUP=await getJSON(q("/api/supervisor"+(supAll?"?all=1":"")));
    if(route.tab==="observer")OBS=await getJSON(q("/api/observer"));
    if(route.tab==="deploy")DEP=await getJSON(q("/api/deploys"));
    ATT=await getJSON("/api/attention").catch(()=>ATT);watchAttention(ATT);
    n++;render();planSync();
  }catch(e){$("topbar").textContent="нет связи с сервером"}
}
function render(){if(!S)return;const y=window.scrollY;renderChrome();renderQuestions(S);renderNotes(S);
  if(route.tab==="overview")renderOverview();if(route.tab==="tasks")renderTasks();if(route.tab==="runs")renderRuns();
  if(route.tab==="runners"){renderControl(S);renderAgents(S);renderSkills();renderRoles()}if(route.tab==="projects")renderProjects();if(route.tab==="events")renderEvents();if(route.tab==="activity")renderActivity();if(route.tab==="supervisor")renderSupervisor();if(route.tab==="observer")renderObserver();if(route.tab==="deploy")renderDeploy();if(route.tab==="inbox")renderInbox();if(route.tab==="tasks"&&!DRAFT)draftShow();
  if(Math.abs(window.scrollY-y)>1)window.scrollTo(0,y)} // a refresh never moves the page

function current(){return PROJ.find(p=>p.id===route.project)}
function renderChrome(){
  const s=S,p=current(),tasks=s.tasks,rs=s.control?s.control.runners:[];
  $("projname").textContent=s.project.name;
  $("projsub").textContent=[p&&p.git?p.git.branch+" · "+p.git.head:"не git",s.project.count+" "+plural(s.project.count,"проект","проекта","проектов")].join(" · ");
  const otherQ=PROJ.filter(x=>x.id!==route.project).reduce((a,x)=>a+x.openQuestions,0);
  $("projdot").className="dot "+((s.openQuestions||[]).length||otherQ?"warn":rs.some(r=>r.session)?"ok":"");
  $("dir").textContent=s.project.networkDir;$("dir").title=s.networkDir;
  const active=tasks.filter(t=>t.queue==="running"||t.queue==="queued"||t.queue==="blocked").length;
  $("c-tasks").textContent=active?String(active):"";$("c-runs").textContent=RUNS.length?String(RUNS.length):"";
  $("c-runners").textContent=rs.length?rs.filter(r=>r.running).length+"/"+rs.length:"";$("c-projects").textContent=PROJ.length?String(PROJ.length):"";
  const bar=$("topbar");bar.replaceChildren();const item=(label,value,cls)=>{const sp=el("span",cls||"");sp.append(label,el("b","",value));bar.append(sp)};
  if(rs.length){const sp=el("span","");sp.append(dot(rs.some(r=>r.session)?"ok":rs.some(r=>r.running)?"warn":""),"runner'ы",el("b","",rs.filter(r=>r.running).length+"/"+rs.length));bar.append(sp)}
  const sv=s.supervisor;
  if(sv&&sv.available){const st=sv.working?["ok","работает"]:!sv.enabled?["","выкл"]:sv.held?["warn","ждёт"]:["acc","следит"];const sp=el("span","link"+(sv.needsYou.length?" warnq":""));sp.title="вкладка «Надзор»";sp.onclick=()=>go("supervisor",route.project);
    sp.append(dot(st[0]),"надзор",el("b","",st[1]+(sv.needsYou.length?" · решить: "+sv.needsYou.length:"")));bar.append(sp)}
  $("c-supervisor").textContent=sv&&sv.needsYou.length?"!"+sv.needsYou.length:sv&&sv.available?(sv.enabled?"вкл":"выкл"):"";$("c-supervisor").style.color=sv&&sv.needsYou.length?"var(--bad)":"";
  item("идёт",String(tasks.filter(t=>t.queue==="running").length));item("очередь",String(tasks.filter(t=>t.queue==="queued").length));
  const oq=(s.openQuestions||[]).length;item("вопросы",oq+(otherQ?" (+"+otherQ+" в других)":""),oq||otherQ?"warnq":"");
  const day=RUNS.filter(r=>r.costUsd!==null&&inWin(r.endedAt,"24h"));item("расход 24ч",day.length?fmtUsd(day.reduce((a,r)=>a+r.costUsd,0),day.some(r=>r.costEstimated)):"—");
  const right=el("span","r");right.append("проект",el("b","",s.project.name),el("span","muted"," · обновлено "+time(s.generatedAt)));bar.append(right);
  const pe=$("priceerr");pe.hidden=!(s.prices&&s.prices.error);pe.textContent=s.prices&&s.prices.error?"prices в runners.json не читаются (действуют прежние): "+s.prices.error:"";
  const waiting=attCount();$("c-inbox").textContent=waiting?String(waiting):"";
  document.title=(waiting?"("+waiting+") ":"")+s.project.name+" · Agent Network";
}

/* ---------- overview ---------- */
function events(s){return s.tasks.flatMap(t=>t.events.map(e=>({...e,taskId:t.id}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
function evRow(e){const r=el("div","ev");r.append(el("span","t",time(e.createdAt)),el("span","k",e.taskId),el("span","",e.type+(e.sourceAgent?" · "+e.sourceAgent:"")+(e.targetAgent?" → "+e.targetAgent:"")));return r}
function renderOverview(){
  const s=S;document.querySelectorAll("#win button").forEach(b=>b.classList.toggle("on",b.dataset.w===win));
  const running=s.tasks.filter(t=>t.queue==="running"),queued=s.tasks.filter(t=>t.queue==="queued");
  const done=RUNS.filter(r=>r.status!=="running"&&inWin(r.endedAt));const priced=done.filter(r=>r.costUsd!==null);
  const usd=priced.reduce((a,r)=>a+r.costUsd,0),est=priced.some(r=>r.costEstimated),unpriced=done.filter(r=>r.usage&&r.costUsd===null).length,toks=done.reduce((a,r)=>a+(r.usage?r.usage.total:0),0);
  const finished=s.tasks.filter(t=>t.status==="COMPLETED"&&t.stats&&inWin(t.stats.finishedAt));
  const rs=s.control?s.control.runners:[];const working=s.control?rs.filter(r=>r.session).length:s.agents.filter(a=>a.effectiveStatus==="WORKING").length;
  const k=$("kpis");k.replaceChildren();
  const kpi=(l,v,unit,h)=>{const d=el("div","kpi");const vv=el("div","v",v);vv.append(el("small","",unit));d.append(el("div","l",l),vv,el("div","h",h));k.append(d)};
  kpi("Идёт",String(running.length),plural(running.length,"задача","задачи","задач"),working+" "+plural(working,"агент работает","агента работают","агентов работают")+(running[0]?" · "+running[0].id+" в "+running[0].phase:""));
  kpi("Очередь",String(queued.length),plural(queued.length,"задача","задачи","задач"),queued[0]?"следующая: "+queued[0].id+" «"+queued[0].title+"»":"пусто");
  kpi("Расход · "+win.replace("h","ч").replace("d","д"),priced.length?fmtUsd(usd,est):"—","USD",done.length+" "+plural(done.length,"сессия","сессии","сессий")+" · "+fmtTok(toks)+" токенов"+(est?" · ≈ по вашим ценам":"")+(unpriced?" · без цены: "+unpriced:""));
  const fu=finished.filter(t=>t.parentTaskId).length,arch=finished.filter(t=>t.openspec&&t.openspec.archivedAt).length;
  kpi("Сделано",String(finished.length),plural(finished.length,"задача","задачи","задач"),[fu?fu+" follow-up":"",arch?arch+" change в архиве":""].filter(Boolean).join(" · ")||"за выбранный период");

  const rp=$("ov-runners");rp.replaceChildren();
  if(s.control){const ph=el("div","ph","Runner'ы");ph.append(el("span","end",rs.filter(r=>r.session).length+" работают · "+rs.filter(r=>!r.running).length+" остановлено"));rp.append(ph);
    const t=el("table");t.append(head(["Агент","Модель","Сейчас","Расход · "+win.replace("h","ч").replace("d","д")]));
    rs.forEach(r=>{const cur=r.session?s.tasks.find(x=>x.id===r.session.taskId):null;const subs=cur&&cur.subtasks&&cur.subtasks[r.id]||[];const live=subs.filter(x=>x.status!=="DROPPED");
      const skillNow=cur?skillsOf(r.id,cur,true).now:null;
      const nowTxt=r.session?(r.session.taskId+(cur?" · "+cur.phase:"")+(live.length?" · "+live.filter(x=>x.status==="DONE").length+"/"+live.length+" подзадач":"")+(skillNow?" · скилл "+skillNow:"")):r.running?"ждёт задачу":"остановлен";
      const mine=done.filter(x=>x.agentId===r.id&&x.costUsd!==null);const c1=el("td","nw");c1.append(dot(r.session?"ok":r.running?"warn":""),r.id);
      t.append(row([c1,td(r.model||"из command","mono"),td(nowTxt,r.session?"":"muted"),td(mine.length?fmtUsd(mine.reduce((a,x)=>a+x.costUsd,0),mine.some(x=>x.costEstimated)):"—","mono")]))});
    rp.append(t);if(!rs.length)rp.append(el("div","empty","В runners.json нет агентов."))}
  else{rp.append(el("div","ph","Агенты"));const t=el("table");t.append(head(["Агент","Статус","Задачи"]));s.agents.forEach(a=>{const c1=el("td","nw");c1.append(dot(a.effectiveStatus==="WORKING"||a.effectiveStatus==="ONLINE"?"ok":a.effectiveStatus==="WAITING"?"warn":a.effectiveStatus==="DEAD"?"bad":""),a.id);t.append(row([c1,td(a.effectiveStatus,"mono"),td(a.tasks.join(", ")||"—","muted")]))});rp.append(t);if(!s.agents.length)rp.append(el("div","empty","Агентов пока нет."))}

  renderOvProgress();
  const pp=$("ov-phases");pp.replaceChildren();const ph2=el("div","ph","Задачи по фазам");ph2.append(el("span","end","все задачи проекта"));pp.append(ph2);
  const t2=el("table");t2.append(head(["Фаза","Сколько","Самая старая"]));
  const act=s.tasks.filter(x=>x.status==="ACTIVE");
  const line=(label,cls,list,showAge)=>{const c=el("td","nw");c.append(dot(cls),label);const old=list.map(x=>x.phaseSince).sort()[0];t2.append(row([c,td(String(list.length),"mono"),td(showAge&&old?since(old):"—","mono muted")]))};
  ["DISCUSS","IMPLEMENT","SYNC","INTEGRATE"].forEach(ph=>line(ph,ph==="IMPLEMENT"?"ok":"acc",act.filter(x=>x.phase===ph),true));
  line("BLOCKED","bad",s.tasks.filter(x=>x.status==="BLOCKED"),true);line("DONE","ok",s.tasks.filter(x=>x.status==="COMPLETED"),false);line("отменено","",s.tasks.filter(x=>x.status==="CANCELLED"),false);
  pp.append(t2);

  const ep=$("ov-events");ep.replaceChildren();const ph3=el("div","ph","Последние события");const all=el("a","end","все события →");all.href="#/events";all.onclick=ev=>{ev.preventDefault();go("events",route.project)};ph3.append(all);ep.append(ph3);
  const evs=events(s).slice(0,8);evs.forEach(e=>ep.append(evRow(e)));if(!evs.length)ep.append(el("div","empty","Событий пока нет."));
}

/* ---------- inbox: what waits for the operator, every project of the page ---------- */
let ATT=null;const attSeen=new Set();let attFirst=true;
const ATT_KIND={question:"вопрос",plan:"страница",acceptance:"приёмка",merge:"вливание",blocked:"BLOCKED",supervisor:"надзор",observer:"наблюдатель"};
function attCount(){return ATT?ATT.projects.reduce((n,p)=>n+p.items.length,0):0}
// a browser notification for what is new while the page is open (in any tab): the first look only remembers
function watchAttention(a){if(!a)return;const fresh=[];
  for(const p of a.projects)for(const i of p.items){const k=p.id+"/"+i.key;if(attSeen.has(k))continue;attSeen.add(k);if(!attFirst)fresh.push({p,i})}
  attFirst=false;if(!fresh.length||typeof Notification==="undefined"||Notification.permission!=="granted")return;
  const one=fresh.length===1?fresh[0]:null;
  const n=new Notification(one?one.p.name+": "+one.i.title:"Ждут вашего решения: "+fresh.length,{body:one?one.i.text:fresh.slice(0,5).map(x=>x.p.name+": "+x.i.title).join("\n"),tag:one?one.p.id+"/"+one.i.key:"agent-network-batch"});
  n.onclick=()=>{window.focus();n.close();if(one)openAttention(one.p.id,one.i);else go("inbox",route.project)}}
function openAttention(projectId,i){const o=i.open||{tab:"tasks"};const switching=projectId!==route.project;route.project=projectId;go(o.tab,projectId);
  setTimeout(async()=>{if(switching)await tick();
    if(o.plan&&i.taskId)openPlan(i.taskId);else if(o.acceptance&&i.taskId)openAcceptance(i.taskId);
    else if(o.tab==="tasks"&&i.taskId&&!o.messageId)openTask(i.taskId,projectId)
    else if(o.messageId)window.scrollTo({top:0,behavior:"smooth"})},switching?50:300)}
function renderInbox(){const box=$("inbox");box.replaceChildren();const st=$("notif-state");
  const perm=typeof Notification==="undefined"?"unsupported":Notification.permission;$("notif-on").hidden=perm!=="default";
  st.textContent=(perm==="granted"?"уведомления браузера включены":perm==="denied"?"уведомления браузера запрещены в настройках браузера":perm==="unsupported"?"браузер не умеет уведомления":"")+(ATT&&ATT.os?" · системные: "+(ATT.os.enabled?"notify-send":ATT.os.reason):"");
  if(!ATT){box.append(el("div","empty","загружаю…"));return}
  if(!attCount()){box.append(el("div","empty","Ничего не ждёт вашего решения."));return}
  for(const p of ATT.projects){if(!p.items.length)continue;if(ATT.projects.length>1)box.append(el("h2","",p.name+" ("+p.items.length+")"));
    for(const i of p.items){const r=el("div","card inboxrow"+(i.blocking?" blocking":""));
      const head=el("div","");head.append(el("span","badge "+(i.blocking?"FAIL":"WARNING"),ATT_KIND[i.kind]||i.kind),el("b",""," "+i.title));r.append(head);
      if(i.text)r.append(el("div","",i.text));
      r.append(el("div","muted small","ждёт с "+time(i.since).slice(0,5)+(i.due?" · "+(i.kind==="question"?"агент пойдёт по своему варианту в ":"решение уйдёт само в ")+time(i.due).slice(0,5):"")));
      const b=el("button","small","Открыть");b.type="button";b.onclick=()=>openAttention(p.id,i);r.append(b);box.append(r)}}}
$("taskback-link").onclick=ev=>{ev.preventDefault();go("tasks",route.project)};
$("notif-on").onclick=async()=>{try{await Notification.requestPermission()}catch(e){}renderInbox()};

/* ---------- pop-ups: a task changed its phase or status ---------- */
const seenTasks=new Map();let seenProject=null;
const phaseName=t=>t.phase+(t.phase==="SYNC"&&t.syncRound?" #"+t.syncRound:"");
// the phase with its round, for lists: SYNC #2 is the second review, IMPLEMENT after a review is a fix round
const phaseLabel=t=>t.phase==="IMPLEMENT"&&t.syncRound>0?"IMPLEMENT · исправления #"+t.syncRound:phaseName(t);
function watchTransitions(s){
  // the first look at a project only remembers: pop-ups are for changes while the page is open
  if(seenProject!==s.project.id){seenProject=s.project.id;seenTasks.clear();s.tasks.forEach(t=>seenTasks.set(t.id,t));return}
  for(const t of s.tasks){const p=seenTasks.get(t.id);seenTasks.set(t.id,t);
    if(!p){toast("",t.id+": новая задача",t.title,t.id);continue}
    if(t.status!==p.status){
      if(t.status==="BLOCKED")toast("bad",t.id+": BLOCKED",(t.handover?"Ждём вас до "+time(t.handover.dueAt)+", потом исправление возьмёт lead "+t.handover.lead+". ":"")+(t.blockedReason||""),t.id);
      else if(t.status==="COMPLETED")toast("ok",t.id+": DONE",t.title,t.id);
      else if(t.status==="CANCELLED")toast("",t.id+": отменена",t.title,t.id);
      else if(p.status==="BLOCKED")toast("warn",t.id+": снова в работе",t.takeover&&!p.takeover?"Lead взял исправление "+t.takeover.from.join(", ")+" ("+(t.takeover.by==="timeout"?"вы не ответили вовремя":"передали вы")+")":phaseName(t),t.id);
      continue}
    if(t.phase!==p.phase||t.syncRound!==p.syncRound){
      const back=t.phase==="IMPLEMENT"&&(p.phase==="SYNC"||p.phase==="INTEGRATE");
      toast(back?"warn":"",t.id+": "+phaseName(p)+" → "+phaseName(t),back?"Нашли ошибки: раунд исправлений "+t.syncRound+" из "+t.maxFixRounds:t.title,t.id)}
  }
}
function toast(kind,title,text,taskId,tab){
  const box=$("toasts");const d=el("div","toast "+kind);d.setAttribute("role","status");d.title="открыть задачу";
  d.append(el("b","",title),el("div","muted",text.length>220?text.slice(0,220)+"…":text));
  const x=el("button","x","×");x.type="button";x.title="закрыть";x.onclick=e=>{e.stopPropagation();d.remove()};d.append(x);
  d.onclick=()=>{d.remove();if(tab){go(tab,route.project);return}if(taskId)openTask(taskId);else go("tasks",route.project)};
  box.prepend(d);
  // at most four: the oldest ordinary one goes first, a BLOCKED one only when nothing else is left
  while(box.children.length>4){const all=[...box.children];(all.reverse().find(x=>!x.classList.contains("bad"))||all[0]).remove()}
  if(kind!=="bad")setTimeout(()=>d.remove(),8000); // BLOCKED and the supervisor's "needs you" stay until closed
  return d;
}

/* ---------- progress ---------- */
function mins(ms){return ms<60000?"<1 мин":ms<3600000?Math.round(ms/60000)+" мин":(ms/3600000).toFixed(1).replace(".0","")+" ч"}
function pbar(parts,cls){const b=el("div","pbar"+(cls?" "+cls:""));parts.forEach(([v,c])=>{if(v>0){const x=el("span",c);x.style.width=Math.min(100,v*100).toFixed(1)+"%";b.append(x)}});return b}
/** How far a task is: the OpenSpec tasks its agents reported done, and their subtasks. */
function progressOf(t){
  const subs=Object.values(t.subtasks||{}).flat().filter(x=>x.status!=="DROPPED");const done=subs.filter(x=>x.status==="DONE");
  const res={subs:{done:done.length,doing:subs.filter(x=>x.status==="DOING").length,total:subs.length,last:done.map(x=>x.updatedAt).sort().pop()||null},os:null};
  const o=t.openspec;if(o&&o.assigned&&o.assigned.length){const nums=new Set(o.assigned.flatMap(a=>a.tasks));const rep=new Set(o.assigned.flatMap(a=>a.done).filter(n=>nums.has(n)));
    res.os={total:nums.size,reported:rep.size,folder:o.progress}}
  // one number for lists: the change's tasks if there are any, else the subtasks
  res.share=res.os&&res.os.total?res.os.reported/res.os.total:res.subs.total?res.subs.done/res.subs.total:null;
  res.doingShare=res.os&&res.os.total?0:res.subs.total?res.subs.doing/res.subs.total:0;
  // the whole task as one share: the phase it is in, and within IMPLEMENT how far its subtasks (or OpenSpec tasks) are
  const ph=t.phase;
  res.overall=ph==="DONE"?1:ph==="INTEGRATE"?0.9:ph==="SYNC"?0.75:ph==="IMPLEMENT"?0.1+0.6*(t.syncRound>0?1:(res.share||0)):0.05;
  res.overallDoing=ph==="IMPLEMENT"&&!t.syncRound?0.6*res.doingShare:0;
  return res}
/** The phases as one bar: how long each took (fix rounds summed), the current one highlighted. */
function phaseBar(t){
  const st=t.stats,idx=PHASES.indexOf(t.phase),over=t.status==="COMPLETED",stopped=t.status==="CANCELLED";
  const ms=p=>{const r=st.phases.find(x=>x.phase===p);return r?r.ms:0};const total=PHASES.slice(0,4).reduce((a,p)=>a+ms(p),0)||60000;
  const bar=el("div","ptl");
  PHASES.forEach((p,i)=>{const m=ms(p),past=over||(!stopped&&i<idx),now=!over&&!stopped&&i===idx;
    const seg=el("div","seg"+(past?" past":now?(t.status==="BLOCKED"?" bad":" now"):""));
    seg.style.flex=String(p==="DONE"?total*0.07:Math.max(m,total*0.09)); // time-proportional, every phase still readable
    // a phase entered again (fix rounds: IMPLEMENT → SYNC → IMPLEMENT …) is one segment: its total time, ×N and a dot per stay
    const row=st.phases.find(x=>x.phase===p),visits=row&&row.visits?row.visits:[];
    seg.append((visits.length>1?p+" ×"+visits.length:p)+((past||now)&&p!=="DONE"&&m?" · "+mins(m):"")+(now?(t.status==="BLOCKED"?" ■":" ▸"):""));
    if(visits.length>1&&visits.length<=8){const rd=el("span","rd");visits.forEach((v,j)=>rd.append(el("i",j===visits.length-1?"last":"")));seg.append(rd)}
    seg.title=p+(m?": "+fmtMs(m):"")+(visits.length>1?"\n"+visits.map((v,j)=>(p==="SYNC"?"раунд ":"заход ")+(j+1)+": "+fmtMs(v)).join("\n"):"")+(now?"\n— сейчас":"");bar.append(seg)});
  return bar}
// the skills an agent loaded on a task: its finished sessions (stats) and the running one (the feed); the latest one of a busy agent is "now"
function skillsOf(agent,t,busy){const seen=[...((t.stats&&(t.stats.agents.find(a=>a.agentId===agent)||{}).skills)||[])];let now=null;
  for(const e of ACT)if(e.agentId===agent&&e.taskId===t.id&&e.kind==="tool_use"&&e.skill){if(!seen.includes(e.skill))seen.push(e.skill);now=e.skill}
  return{all:seen,now:busy?now:null}}
function lastCall(agent,taskId){for(let i=ACT.length-1;i>=0;i--){const e=ACT[i];if(e.agentId===agent&&e.kind==="tool_use"&&(!e.taskId||e.taskId===taskId))return e}return null}
/** What each agent of an open task is doing: its subtasks as a bar, its current step or why it waits, its last call. */
function progressBlock(t){
  const box=el("div");const pr=progressOf(t);const k=el("div","pkpis");
  if(pr.os){const o=pr.os;const d=el("div","pk");const v=el("div","v",o.reported+" / "+o.total);v.append(el("small","",o.total?Math.round(o.reported/o.total*100)+"%":""));
    d.append(el("div","l","Задачи OpenSpec — сданы агентами"),v,pbar([[o.total?o.reported/o.total:0,"g"]]),el("div","h",o.folder?"в папке проекта отмечено "+o.folder.done+"/"+o.folder.total+" (отмечает lead после слияния)":"номера из tasks.md, о которых агенты отчитались в complete"));k.append(d)}
  if(pr.subs.total){const sb=pr.subs;const d=el("div","pk");const v=el("div","v",sb.done+" / "+sb.total);v.append(el("small","",Math.round(sb.done/sb.total*100)+"%"+(sb.doing?" · в работе "+sb.doing:"")));
    d.append(el("div","l","Подзадачи агентов"),v,pbar([[sb.done/sb.total,"g"],[sb.doing/sb.total,"b"]]),el("div","h",sb.last?"последняя галочка "+ago(sb.last):"галочек пока нет"));k.append(d)}
  if(k.childElementCount)box.append(k);
  const list=el("div","pagents");const rs=S.control?S.control.runners:[];const lead=t.agents[0];
  for(const id of t.agents){
    const subs=((t.subtasks&&t.subtasks[id])||[]).filter(x=>x.status!=="DROPPED");const d=subs.filter(x=>x.status==="DONE").length;const doing=subs.find(x=>x.status==="DOING");
    const as=t.agreement&&t.agreement.assignments.find(a=>a.agentId===id);const im=t.implementations.find(i=>i.agentId===id);
    const r=rs.find(x=>x.id===id);const busy=!!(r&&r.session&&r.session.taskId===t.id);
    const deps=((as&&as.dependsOn)||[]).filter(dep=>{const di=t.implementations.find(i=>i.agentId===dep);return !di||di.status!=="READY_FOR_SYNC"});
    const rep=t.syncReports.filter(x=>x.agentId===id&&x.round===t.syncRound).pop();const waits=t.waitingOn.includes(id);
    let st="",cls="",wait=false;
    if(t.status==="BLOCKED"){st=t.takeover&&t.takeover.from.includes(id)?"исправление у lead'а":"задача BLOCKED";cls="bad"}
    else if(t.phase==="DISCUSS"){const ok=t.agreement&&t.agreement.approvedBy.includes(id);st=!t.agreement?(id===lead?"готовит предложение":"ждёт предложения lead'а"):ok?"✓ одобрил agreement":"смотрит agreement";cls=ok?"ok":waits?"now":""}
    else if(t.phase==="IMPLEMENT"){
      if(im&&im.status==="READY_FOR_SYNC"){st="✓ сдал работу · ждёт остальных";cls="ok"}
      else if(deps.length&&!doing){st="ждёт "+deps.join(", ")+" (dependsOn)"+(subs.length-d?" · "+(subs.length-d)+" "+plural(subs.length-d,"подзадача","подзадачи","подзадач")+" наготове":"");cls="warn";wait=true}
      else if(doing){st="▶ "+doing.id+" "+doing.title;cls="now"}
      else{st=busy?"работает":subs.length?"между подзадачами":"ещё не начал";cls=busy?"now":""}}
    else if(t.phase==="SYNC"){st=rep?"✓ ревью раунда "+t.syncRound+": "+rep.status:waits?"ревьюит":"ждёт ревью";cls=rep?(rep.status==="PASS"?"ok":"warn"):waits?"now":""}
    else if(t.phase==="INTEGRATE"){st=id===lead?"собирает и проверяет результат":"ждёт lead'а";cls=id===lead?"now":""}
    const last=busy?lastCall(id,t.id):null;
    const row=el("div","prow");const nm=el("div","nm");const model=r&&r.model||(t.stats&&(t.stats.agents.find(a=>a.agentId===id)||{models:[]}).models[0])||"";
    nm.append(el("b","",id),el("span","",[id===lead?"lead":"",model].filter(Boolean).join(" · ")));
    const mid=el("div");mid.append(wait&&!d?pbar([],"wait"):pbar(subs.length?[[d/subs.length,"g"],[doing?1/subs.length:0,"b"]]:[]));
    const line=el("div","st "+cls,st+(last?" · "+(last.tool||"")+" "+last.summary+" · "+ago(last.at):""));line.title=line.textContent;mid.append(line);
    const sk=skillsOf(id,t,busy);if(sk.all.length){const sl=el("div","st muted small","скиллы: "+sk.all.map(k=>k===sk.now?"▶ "+k:k).join(" · "));sl.title="Скиллы, которые агент загрузил в этой задаче"+(sk.now?"; ▶ — последний в идущей сессии":"");mid.append(sl)}
    const cnt=el("div","cnt");if(subs.length){cnt.append(el("b","",String(d)),"/"+subs.length)}else cnt.append("—");
    row.append(nm,mid,cnt);list.append(row)}
  box.append(list);
  const lg=el("div","plegend");[["var(--ok)","готово"],["var(--accent)","в работе"],["var(--line)","ждёт"]].forEach(([c,l])=>{const sp=el("span");const i=el("i");i.style.background=c;sp.append(i,l);lg.append(sp)});box.append(lg);
  return box}
/** Overview: every open task on one line with how far it is. */
function renderOvProgress(){
  const box=$("ov-progress");const open=S.tasks.filter(t=>t.queue==="running"||t.queue==="blocked"||t.queue==="queued").sort((a,b)=>["running","blocked","queued"].indexOf(a.queue)-["running","blocked","queued"].indexOf(b.queue)||a.id.localeCompare(b.id));
  // rebuilt only when a row would change: a row replaced under the mouse between press and release takes no click
  const sig=route.project+JSON.stringify(open.map(t=>{const pr=progressOf(t);return [t.id,t.title,t.queue,t.status,t.phase,t.syncRound,t.blockedBy,pr.overall,pr.overallDoing]}));
  if(box.dataset.sig===sig&&box.childElementCount)return;box.dataset.sig=sig;
  box.hidden=!open.length;box.replaceChildren();if(!open.length)return;
  const ph=el("div","ph","Прогресс задач");ph.append(el("span","end","по фазам; в IMPLEMENT — по подзадачам агентов или задачам OpenSpec"));box.append(ph);
  for(const t of open){const pr=progressOf(t);const row=el("div","ovp");row.title="открыть задачу";
    row.onclick=()=>openTask(t.id);
    const tt=el("div","tt");tt.append(el("span","",t.id),t.title);
    const blocked=t.status==="BLOCKED",queued=t.queue==="queued";
    // where it stands even while it waits for its agents: the phase and round, then "в очереди"
    const pill=badge(blocked?"BLOCKED":queued?"queued":"running",blocked?"BLOCKED · "+phaseLabel(t):queued?phaseLabel(t)+" · в очереди":phaseLabel(t));
    const bar=blocked?pbar([[pr.overall,"r"]]):pbar([[pr.overall,queued?"q":"g"],[queued?0:pr.overallDoing,"b"]]);
    const pct=el("div","pct",blocked?(t.blockedBy==="cost"?"$ лимит":"р. "+t.syncRound+"/"+t.maxFixRounds):Math.round(pr.overall*100)+"%");
    row.append(tt,pill,bar,pct);box.append(row)}
}

/* ---------- tasks ---------- */
const QUEUE={running:"идёт",queued:"в очереди",blocked:"BLOCKED",done:"DONE",cancelled:"отменена"};
const archiveState=new Map();
function renderOpenspec(t){
  const o=t.openspec;const box=el("div","openspec");const key=route.project+"/"+t.id;
  const state=o.archivedAt?"в архиве с "+time(o.archivedAt):o.progress?"в папке проекта отмечено "+o.progress.done+"/"+o.progress.total:o.error?"не читается: "+o.error:"";
  const line=el("div","");line.append(el("b","","OpenSpec: "),el("span","mono",o.path),el("span","muted"," · "+state));box.append(line);
  o.assigned.forEach(a=>box.append(el("div","muted",a.agentId+": "+(a.tasks.length?a.tasks.join(", "):"только ревью")+(a.done.length?" · сделано: "+a.done.join(", "):""))));
  if(controlMode&&t.status==="COMPLETED"&&!o.archivedAt){
    const ready=o.progress&&o.progress.done===o.progress.total;const st=archiveState.get(key)||{};
    const r=el("div","checks");const b=el("button","ghost",st.pending?"архивирую…":"Архивировать change");b.type="button";b.disabled=!ready||!!st.pending;
    b.onclick=async()=>{if(!await ask("openspec archive "+o.change+" в папке проекта? Change переедет в openspec/changes/archive, его спеки — в openspec/specs."))return;
      archiveState.set(key,{pending:true});render();
      try{const res=await post("/api/openspec/archive",{taskId:t.id});archiveState.set(key,{output:res.output||"готово"})}catch(e){archiveState.set(key,{error:e.message})}await tick()};
    r.append(b);if(!ready)r.append(el("span","note","сначала влейте ветку lead'а в папку проекта: lead отмечает задачи у себя"));box.append(r);
  }
  const st=archiveState.get(key);if(st&&(st.output||st.error))box.append(el("pre","log"+(st.error?" err":""),st.error||st.output));
  return box;
}
// agents the lead added to the team (spawn_agent): who, from which template, why, and what their runner does now
function renderSpawned(t){
  const box=el("div","spawnbox");box.append(el("b","","Добавлены lead'ом ("+t.spawned.length+")"));const rs=S.control?S.control.runners:[];
  t.spawned.forEach(x=>{const r=rs.find(y=>y.id===x.id);const row=el("div","srow2");
    const state=!r?"runner не запущен (нет шаблона «"+x.template+"» в runners.json?)":r.session?"работает · сессия #"+r.session.attempt:r.running?"ждёт":"runner остановлен";
    row.append(dot(r&&r.session?"ok":r&&r.running?"warn":""),el("b","",x.id),el("span","muted mono"," "+x.template+(r&&r.model?" · "+r.model:"")),el("span","muted"," · добавил "+x.by+" "+time(x.at).slice(0,5)+" · "+state));
    const why=el("div","muted why",x.reason);box.append(row,why);
    if(x.role){const rd=el("details","why role");rd.dataset.key="role-"+t.id+"-"+x.id;rd.append(el("summary","","роль: "+x.role.name+(x.role.source==="library"?" (из библиотеки)":" (написал lead)")),el("pre","log",x.role.instructions));
      if(x.role.source==="lead"&&S.control){const sv=el("button","ghost small","Сохранить роль в библиотеку");sv.type="button";
        sv.onclick=async()=>{const name=prompt("Имя роли в библиотеке проекта (.agent-network/roles/<имя>.md):",x.role.name);if(!name)return;
          try{const r=await post("/api/roles/save",{taskId:t.id,agentId:x.id,name});toast("ok","Роль сохранена",r.role.name)}
          catch(e){if(/exists already|has a role/.test(e.message)&&await ask(e.message+"\nПерезаписать?")){try{await post("/api/roles/save",{taskId:t.id,agentId:x.id,name,overwrite:true});toast("ok","Роль перезаписана",name)}catch(e2){alert(e2.message)}}else alert(e.message)}};rd.append(sv)}
      box.append(rd)}});
  return box;
}
// the operator's review comments as a checklist: open ones first, the lead's answer under each
function renderReview(t){
  const open=t.review.filter(c=>c.status==="open").length;const box=el("div","reviewbox");
  box.append(el("b","","Замечания к диффу: "+(open?open+" открыто из "+t.review.length:"все "+t.review.length+" обработаны")));
  [...t.review].sort((a,b)=>(a.status==="open"?0:1)-(b.status==="open"?0:1)).forEach(c=>{const row=el("div","rrow "+c.status);
    row.append(el("span","badge "+(c.status==="open"?"WARNING":c.status==="fixed"?"PASS":"INFO"),c.status==="open"?"открыто":c.status==="fixed"?"исправлено":"отклонено"),el("span","mono"," "+c.id+" "+c.file+(c.line?":"+c.line:"")),el("div","",c.text));
    if(c.code)row.append(el("div","mono muted",c.code));if(c.note)row.append(el("div","rnote","lead: "+c.note));box.append(row)});
  if(open)box.append(el("div","muted","Lead не сдаст задачу, пока каждое не исправлено или не отклонено с причиной."));
  return box;
}
// the project's role library on the Runners tab: what leads can give spawned agents by name
// «Раскатка»: merged tasks → Bitbucket → Jenkins → Kubernetes
let DEP=null,depForm=null,depSetDirty=false,depFilter="all";
const STAGE_RU={merged:"не отправлена",branch:"в ветке, ждёт",running:"идёт раскатка",deployed:"на стенде",failed:"ошибка раскатки"};
const STAGE_FILTERS=[["all","Все"],["merged","Не отправлены"],["branch","В ветке"],["deployed","На стенде"],["running","Идёт"],["failed","Ошибка"]];const depOpen=new Set();
const STEP_RU={notes:"Для раскатки",push:"Push в Bitbucket",jenkins:"Job в Jenkins",kubernetes:"Kubernetes"};
const RUN_RU={running:"идёт",ok:"готово",failed:"ошибка",cancelled:"отменена"};
function depIcon(s){return s==="ok"?"✓":s==="failed"?"✗":s==="running"?"…":s==="skipped"?"–":"·"}
function renderDeploy(){if(!DEP)return;if(!renderDeploy.f){renderDeploy.f=1;try{depFilter=localStorage.getItem("depFilter")||"all"}catch(e){}}renderDeployReady();renderDeployRuns();renderDeploySettings()}
function linesToMap(t){const o={};for(const l of String(t||"").split("\n")){const i=l.indexOf("=");if(i>0)o[l.slice(0,i).trim()]=l.slice(i+1).trim()}return o}
function mapToLines(m){return Object.entries(m||{}).map(([k,v])=>k+"="+v).join("\n")}
function notesView(n){const box=el("div","");const envs=(DEP.settings.environments||[]).map(e=>e.name);
  if(n.missing.length){const w=el("div","note err");w.textContent="Не задано в окружении: "+n.missing.map(m=>m.env+": "+m.envVar+" ("+m.key+")").join(", ")+". Без них сервис не стартует.";box.append(w)}
  if(!n.properties.length)box.append(el("div","muted","Новых свойств нет ("+n.filesChanged+" файлов в diff)."));
  else{const t=document.createElement("table");const hd=document.createElement("tr");for(const h of ["Свойство","Переменная окружения","По умолчанию","Обязательно","Секрет",...envs])hd.append(el("th","",h));t.append(hd);
    for(const p of n.properties){const tr=document.createElement("tr");const k=el("td","");k.append(el("b","mono",p.key));k.append(el("div","muted small",p.source+(p.change==="changed"?" · изменено":"")));tr.append(k,el("td","mono",p.envVar),el("td","mono",p.defaultValue===undefined?"—":p.defaultValue),el("td","",p.required?"да":"нет"),el("td","",p.secret?"да":""));
      for(const e of envs){const v=p.inEnv[e];const td=el("td","",v===true?"✓ задано":v===false?(p.required?"✗ нет":"нет"):"?");if(v===false&&p.required)td.style.color="var(--bad, #c0392b)";td.title=v===null?"нечего проверить: укажите values-файл или список заданных ключей окружения":"";tr.append(td)}
      t.append(tr)}const pn=el("div","panel");pn.append(t);box.append(pn)}
  const extra=[["Миграции",n.migrations],["Топики Kafka",n.topics.map(x=>x.key+" = "+x.value)],["Внешние адреса",n.endpoints.map(x=>x.key+" = "+x.value)]];
  for(const[h,list]of extra)if(list.length){box.append(el("div","",""));const d=el("div","muted small",h+": ");d.append(el("span","mono",list.join(", ")));box.append(d)}
  return box}
function stageCell(st){const td=el("td","");const b=el("span","badge "+(st.stage==="deployed"?"PASS":st.stage==="running"?"IN_PROGRESS":st.stage==="failed"?"ERROR":st.stage==="branch"?"WAITING":"STOPPED"),STAGE_RU[st.stage]+(st.stage==="deployed"?": "+st.envs.join(", "):""));td.append(b);
  if(st.branch){const d=el("div","muted small","");if(st.branchUrl){const a=document.createElement("a");a.href=st.branchUrl;a.target="_blank";a.rel="noopener";a.textContent=st.branch;d.append(a)}else d.append(el("span","mono",st.branch));td.append(d)}
  if(st.lastRun)td.append(el("div","muted small","последняя: "+st.lastRun.id+" → "+st.lastRun.env+" · "+(RUN_RU[st.lastRun.status]||st.lastRun.status)));return td}
function renderDeployReady(){const box=$("dready");if(!box)return;const sig=JSON.stringify([DEP.ready,DEP.control,DEP.settings.environments,depFilter,depForm&&[depForm.taskId,depForm.env,!!depForm.notes,depForm.err,depForm.busy]]);if(box.dataset.sig===sig)return;box.dataset.sig=sig;box.replaceChildren();
  if(!DEP.ready.length){box.append(el("div","muted","Нет влитых задач: после DONE нажмите в карточке задачи «Посмотреть изменения» → «Влить в проект»."));return}
  const fl=el("div","akinds");for(const[k,label]of STAGE_FILTERS){const n=k==="all"?DEP.ready.length:DEP.ready.filter(r=>r.state.stage===k).length;if(k!=="all"&&!n&&depFilter!==k)continue;const b=el("button",depFilter===k?"on":"",label+" ");b.type="button";b.append(el("span","k",String(n)));b.onclick=()=>{depFilter=k;try{localStorage.setItem("depFilter",k)}catch(e){}renderDeployReady()};fl.append(b)}box.append(fl);
  const rows=DEP.ready.filter(r=>depFilter==="all"||r.state.stage===depFilter);
  if(!rows.length){box.append(el("div","muted","Нет задач в этом состоянии."));return}
  const pn=el("div","panel");const t=document.createElement("table");const hd=document.createElement("tr");for(const h of ["Задача","","Состояние","Коммит","Влита в",""])hd.append(el("th","",h));t.append(hd);
  for(const r of rows){const tr=document.createElement("tr");tr.append(el("td","mono",r.id),el("td","",r.title),stageCell(r.state),el("td","mono",r.commit.slice(0,7)),el("td","",r.into+" · "+new Date(r.at).toLocaleString()));
    const td=document.createElement("td");if(DEP.control){const b=el("button","small",depForm&&depForm.taskId===r.id?"Скрыть":"Раскатить…");b.type="button";b.onclick=()=>{depForm=depForm&&depForm.taskId===r.id?null:{taskId:r.id,env:(DEP.settings.environments[0]||{}).name};renderDeployReady();if(depForm)loadDeployNotes()};td.append(b)}tr.append(td);t.append(tr);
    if(depForm&&depForm.taskId===r.id){const fr=document.createElement("tr");const fc=document.createElement("td");fc.colSpan=6;fc.append(deployForm(r));fr.append(fc);t.append(fr)}}
  pn.append(t);box.append(pn)}
async function loadDeployNotes(){const f=depForm;if(!f)return;f.notes=null;f.err=null;try{f.notes=(await getJSON(q("/api/tasks/"+encodeURIComponent(f.taskId)+"/deploy-notes"))).notes}catch(e){f.err="не удалось прочитать diff задачи"}if(depForm===f)renderDeployReady()}
function deployForm(r){const f=depForm;const box=el("div","card");const row=el("div","checks");
  const sel=document.createElement("select");for(const e of DEP.settings.environments){const o=document.createElement("option");o.value=e.name;o.textContent=e.name;sel.append(o)}sel.value=f.env;sel.onchange=()=>{f.env=sel.value;renderDeployReady()};
  row.append(el("span","","Окружение"),sel);box.append(row);
  box.append(el("div","muted small","Ветка: по шаблону "+DEP.settings.bitbucket.branch+" → remote "+DEP.settings.bitbucket.remote+". В неё уйдёт коммит "+r.commit.slice(0,7)+" и всё, чего ещё нет в Bitbucket."));
  box.append(el("h3","","Для раскатки"));
  if(f.err)box.append(el("div","note err",f.err));else if(!f.notes)box.append(el("div","muted","читаю diff…"));else box.append(notesView(f.notes));
  const go2=el("button","",f.busy?"Отправляю…":"Отправить в Bitbucket и раскатить на "+f.env);go2.type="button";go2.disabled=!f.notes||!!f.busy;
  go2.onclick=async()=>{const miss=(f.notes.missing||[]).filter(m=>m.env===f.env);
    if(!await ask("Отправить "+r.id+" в Bitbucket (remote "+DEP.settings.bitbucket.remote+") и раскатить на "+f.env+"?"+(miss.length?" В "+f.env+" не задано: "+miss.map(m=>m.envVar).join(", ")+" — сервис может не стартовать.":"")))return;
    f.busy=true;renderDeployReady();try{let res;try{res=await post("/api/tasks/"+encodeURIComponent(r.id)+"/deploy",{env:f.env})}catch(e){
      // the service depends on a contract version that is not released yet: only on the operator's explicit yes
      if(!/контракт|contract/i.test(e.message)||!await ask(e.message+"\n\nВсё равно отправить сервис?"))throw e;res=await post("/api/tasks/"+encodeURIComponent(r.id)+"/deploy",{env:f.env,contractUnreleased:true})}depOpen.add(res.run.id);depForm=null;DEP=await getJSON(q("/api/deploys"));renderDeploy()}catch(e){f.busy=false;f.err=e.message;renderDeployReady()}};
  box.append(go2);return box}
function renderDeployRuns(){const box=$("druns");if(!box)return;const sig=JSON.stringify([DEP.runs,[...depOpen],DEP.control]);if(box.dataset.sig===sig)return;box.dataset.sig=sig;box.replaceChildren();
  const running=DEP.runs.filter(r=>r.status==="running").length;const c=$("c-deploy");if(c)c.textContent=running?String(running):"";
  if(!DEP.runs.length){box.append(el("div","muted","Раскаток ещё не было."));return}
  for(const r of DEP.runs){const card=el("div","card");const head=el("div","hrow");const t=el("div","");t.append(el("b","mono",r.id+" "),el("span","",r.taskId+" · "+r.taskTitle),el("div","muted small",r.env+" · "+r.branch+" · "+new Date(r.createdAt).toLocaleString()+(r.endedAt?" — "+time(r.endedAt):"")));
    const st=el("span","badge "+(r.status==="ok"?"PASS":r.status==="running"?"IN_PROGRESS":r.status==="failed"?"ERROR":"STOPPED"),RUN_RU[r.status]||r.status);const end=el("div","end");end.append(st);
    if(r.status==="running"&&DEP.control){const x=el("button","ghost small","Отменить");x.type="button";x.onclick=async()=>{if(!await ask("Отменить "+r.id+"? Уже сделанный push не откатится."))return;try{await post("/api/deploys/"+r.id+"/cancel",{});DEP=await getJSON(q("/api/deploys"));renderDeploy()}catch(e){alert(e.message)}};end.append(" ",x)}
    head.append(t,end);card.append(head);
    for(const s of r.steps){const line=el("div","step"+(s.status==="running"?" now":s.status==="ok"?" past":""));line.append(el("span","mono",depIcon(s.status)+" "),el("b","",STEP_RU[s.name]||s.name),el("span","muted"," "+(s.summary||"")));
      if(s.link){const a=document.createElement("a");a.href=s.link;a.target="_blank";a.rel="noopener";a.textContent=" открыть";line.append(a)}
      if(s.status==="failed")line.style.color="var(--bad, #c0392b)";card.append(line)}
    const open=depOpen.has(r.id);const more=el("button","ghost small",open?"Свернуть":"Подробнее");more.type="button";more.onclick=()=>{if(open)depOpen.delete(r.id);else depOpen.add(r.id);renderDeployRuns()};card.append(more);
    if(open){if(r.notes){card.append(el("h3","","Для раскатки"));card.append(notesView(r.notes))}
      if(r.push&&r.push.commits.length){card.append(el("h3","","Ушло в "+r.branch));const pre=el("pre","log",r.push.commits.map(c=>c.sha.slice(0,7)+" "+c.subject).join("\n"));card.append(pre)}
      for(const s of r.steps)if(s.output){card.append(el("div","muted small",STEP_RU[s.name]+":"));card.append(el("pre","log"+(s.status==="failed"?" err":""),s.output))}}
    box.append(card)}}
function renderDeploySettings(){const box=$("dsettings");if(!box)return;const sig=JSON.stringify([DEP.settings,DEP.control]);if(box.dataset.sig===sig||depSetDirty)return;box.dataset.sig=sig;box.replaceChildren();
  const S0=DEP.settings,ro=!DEP.control;const form=document.createElement("form");form.className="card";form.oninput=()=>{depSetDirty=true};
  const field=(label,value,opts)=>{const l=el("label","",label);const i=opts&&opts.area?document.createElement("textarea"):document.createElement("input");i.value=value==null?"":String(value);if(opts&&opts.ph)i.placeholder=opts.ph;if(opts&&opts.area)i.rows=opts.rows||3;i.disabled=ro;l.append(i);form.append(l);return i};
  form.append(el("h3","","Bitbucket"));
  const fRemote=field("git remote (SSH-адрес репозитория в Bitbucket)",S0.bitbucket.remote,{ph:"origin"});
  const fBranch=field("Шаблон ветки: {task} {change} {slug} {env}",S0.bitbucket.branch,{ph:"feature/{task}-{slug}"});
  const fWeb=field("Ссылка на ветку ({branch}); пусто — для bitbucket.org сама",S0.bitbucket.webUrl||"",{ph:"https://bitbucket.example.com/projects/X/repos/svc/browse?at=refs/heads/{branch}"});
  form.append(el("h3","","Jenkins (через MCP)"));
  const fCmd=field("Команда MCP-сервера Jenkins, по аргументу на строку",(S0.jenkins.mcpCommand||[]).join("\n"),{area:true,ph:"npx\n-y\n<пакет MCP Jenkins>"});
  const fEnv=field("Переменные MCP: ИМЯ=значение, по строке (значение \${ИМЯ} — из окружения сервера)",mapToLines(S0.jenkins.mcpEnv),{area:true,ph:"JENKINS_URL=https://jenkins.example.com\nJENKINS_TOKEN=\${JENKINS_TOKEN}"});
  const fJob=field("Job",S0.jenkins.job,{ph:"orders-service/deploy"});
  const fParams=field("Параметры job: ИМЯ=значение ({branch} {commit} {env} {task})",mapToLines(S0.jenkins.params),{area:true});
  const fTrig=field("Инструмент MCP: запуск job",S0.jenkins.triggerTool,{});const fTrigA=field("…его аргументы (JSON, плейсхолдеры {job} {params} {branch} {env})",S0.jenkins.triggerArgs,{area:true,ph:'{"jobName": "{job}", "parameters": {params}}'});
  const fStat=field("Инструмент MCP: статус сборки",S0.jenkins.statusTool,{});const fStatA=field("…его аргументы (JSON, {job} {build})",S0.jenkins.statusArgs,{area:true});
  const fLog=field("Инструмент MCP: лог сборки",S0.jenkins.logTool,{});const fLogA=field("…его аргументы (JSON, {job} {build})",S0.jenkins.logArgs,{area:true});
  const fTo=field("Сколько ждать job, минут",S0.jenkins.timeoutMin,{});
  form.append(el("h3","","Kubernetes (только чтение)"));
  const fKc=field("kubectl",S0.kubernetes.kubectl,{});const fCtx=field("Контекст kubeconfig",S0.kubernetes.context,{ph:"dev-cluster"});const fRt=field("Сколько ждать rollout, секунд",S0.kubernetes.rolloutTimeoutSec,{});
  form.append(el("h3","","Окружения"));const envBox=el("div","");form.append(envBox);let envs=S0.environments.map(e=>Object.assign({},e));
  const drawEnvs=()=>{envBox.replaceChildren();const t=document.createElement("table");const hd=document.createElement("tr");for(const h of ["Имя","Namespace","Deployment","Метки подов","Values-файл","Заданы там же (ключи или переменные)","Параметры job",""])hd.append(el("th","",h));t.append(hd);
    envs.forEach((e,i)=>{const tr=document.createElement("tr");const cell=(k,ph,toS,fromS)=>{const td=document.createElement("td");const inp=document.createElement("input");inp.value=toS?toS(e[k]):(e[k]||"");inp.placeholder=ph||"";inp.disabled=ro;inp.oninput=()=>{e[k]=fromS?fromS(inp.value):inp.value;depSetDirty=true};td.append(inp);tr.append(td)};
      cell("name","dev");cell("namespace","orders-dev");cell("deployment","orders-service");cell("selector","app=orders-service");cell("valuesFile","deploy/values-dev.yaml");
      cell("provided","DB_PASSWORD, orders.topic",v=>(v||[]).join(", "),v=>v.split(",").map(x=>x.trim()).filter(Boolean));
      cell("jobParams","CLUSTER=dev; REPLICAS=1",v=>Object.entries(v||{}).map(([k,x])=>k+"="+x).join("; "),v=>linesToMap(v.split(";").join("\n")));
      const td=document.createElement("td");if(!ro){const x=el("button","ghost small","×");x.type="button";x.title="убрать окружение";x.onclick=()=>{envs.splice(i,1);depSetDirty=true;drawEnvs()};td.append(x)}tr.append(td);t.append(tr)});
    const pn=el("div","panel");pn.append(t);envBox.append(pn);if(!ro){const a=el("button","ghost small","+ окружение");a.type="button";a.onclick=()=>{envs.push({name:""});depSetDirty=true;drawEnvs()};envBox.append(a)}};
  drawEnvs();
  const say=el("div","");form.append(say);
  if(!ro){const save=el("button","","Сохранить настройки");save.type="submit";const reset=el("button","ghost","Отменить правки");reset.type="button";reset.onclick=()=>{depSetDirty=false;box.dataset.sig="";renderDeploySettings()};form.append(save," ",reset)}
  else form.append(el("div","muted","Только просмотр: запустите страницу с --runners, чтобы менять настройки."));
  form.onsubmit=async ev=>{ev.preventDefault();const num=v=>{const n=Number(v);return Number.isFinite(n)?n:undefined};
    const settings={bitbucket:{remote:fRemote.value,branch:fBranch.value,webUrl:fWeb.value},
      jenkins:{mcpCommand:fCmd.value.split("\n").map(x=>x.trim()).filter(Boolean),mcpEnv:linesToMap(fEnv.value),job:fJob.value,params:linesToMap(fParams.value),triggerTool:fTrig.value,triggerArgs:fTrigA.value,statusTool:fStat.value,statusArgs:fStatA.value,logTool:fLog.value,logArgs:fLogA.value,timeoutMin:num(fTo.value)},
      kubernetes:{kubectl:fKc.value,context:fCtx.value,rolloutTimeoutSec:num(fRt.value)},environments:envs};
    say.className="note";say.textContent="сохраняю…";
    try{const r=await post("/api/deploy/settings",{settings});DEP.settings=r.settings;depSetDirty=false;box.dataset.sig="";renderDeploySettings();renderDeployReady();const n=$("dsettings").querySelector("form");const ok=el("div","note ok","Сохранено");if(n)n.append(ok)}catch(e){say.className="note err";say.textContent=e.message}};
  box.append(form)}
let ROLES=null,rolesAt=0;
// skills × agents: a checkbox per agent (checked = it may load the skill); "всем" switches the row for every agent
let SKILLS=null,skillsAt=0;
async function renderSkills(force){const box=$("skills");if(!box)return;if(force||Date.now()-skillsAt>15000){skillsAt=Date.now();try{SKILLS=await getJSON(q("/api/skills"))}catch(e){SKILLS={skills:[],agents:[]}}}
  const sig=JSON.stringify([SKILLS,!!S.control]);if(box.dataset.sig===sig)return;box.dataset.sig=sig;box.replaceChildren();
  const agents=(SKILLS.agents||[]).filter(a=>!a.spawned);
  if(!SKILLS.skills.length||!agents.length){box.append(el("div","muted",!agents.length?"Runner'ов нет: скиллы включаются по агентам из runners.json.":"Скиллов не нашлось: ищу в ~/.claude/skills, ~/.qwen/skills и .claude/skills проекта и агентов."));return}
  const t=document.createElement("table");t.className="skills";const hd=document.createElement("tr");
  hd.append(el("th","","Скилл"),...agents.map(a=>el("th","",a.id)),el("th",""));t.append(hd);
  const toggle=async(agent,name,enabled)=>{try{await post("/api/runners/"+encodeURIComponent(agent)+"/skills",{skill:name,enabled});await renderSkills(true)}catch(e){alert(e.message)}};
  for(const k of SKILLS.skills){const tr=document.createElement("tr");const nm=el("td","");nm.append(el("b","",k.name));if(k.sources.length)nm.append(el("span","muted small"," "+k.sources.join(", ")));else nm.append(el("span","muted small"," не найден"));nm.title=k.description||"";tr.append(nm);
    for(const a of agents){const td=document.createElement("td");const cb=document.createElement("input");cb.type="checkbox";cb.checked=!a.disabled.includes(k.name);cb.disabled=!S.control;cb.title=(cb.checked?"выключить ":"включить ")+k.name+" для "+a.id;cb.onchange=()=>{cb.disabled=true;toggle(a.id,k.name,cb.checked)};td.append(cb);const by=a.byTask||{};for(const[kind,word]of[["propose","change"],["code","код"]])if((by[kind]||[]).includes(k.name)){const m=el("span","muted small"," без: "+word);m.title="выключен в задачах «"+(kind==="propose"?"написать change":"код")+"» (runners.json disabledSkillsByTask)";td.append(m)}tr.append(td)}
    const all=document.createElement("td");if(S.control){const anyOn=agents.some(a=>!a.disabled.includes(k.name));const b=el("button","ghost small",anyOn?"выкл. всем":"вкл. всем");b.type="button";
      b.onclick=async()=>{b.disabled=true;for(const a of agents)if(a.disabled.includes(k.name)===anyOn)await post("/api/runners/"+encodeURIComponent(a.id)+"/skills",{skill:k.name,enabled:!anyOn}).catch(e=>alert(e.message));await renderSkills(true)};all.append(b)}
    tr.append(all);t.append(tr)}
  box.append(t);
  // a skill that is not on disk here (a plugin's, one installed later): off for every agent by its name; plugin:* takes the whole plugin
  if(S.control){const f=el("div","checks");const inp=document.createElement("input");inp.placeholder="имя скилла или плагин:* — например backend-design-java:*";inp.style.minWidth="320px";
    const b=el("button","small","Выключить всем");b.type="button";const say=el("span","muted small","");
    b.onclick=async()=>{const name=inp.value.trim();if(!name){say.textContent="Введите имя скилла";return}b.disabled=true;say.textContent="";
      try{for(const a of agents)if(!a.disabled.includes(name))await post("/api/runners/"+encodeURIComponent(a.id)+"/skills",{skill:name,enabled:false});inp.value="";await renderSkills(true)}catch(e){say.textContent=e.message}finally{b.disabled=false}};
    inp.oninput=()=>{say.textContent=""};f.append(inp,b,say);box.append(f)}}
async function renderRoles(){const box=$("roles");if(!box)return;if(Date.now()-rolesAt>15000){rolesAt=Date.now();try{ROLES=(await getJSON(q("/api/roles"))).roles}catch(e){ROLES=[]}}
  const sig=JSON.stringify(ROLES);if(box.dataset.sig===sig)return;box.dataset.sig=sig;box.replaceChildren();
  if(!ROLES||!ROLES.length){box.append(el("div","muted","Ролей пока нет. Роль, которую lead написал для добавленного агента, сохраняется кнопкой в карточке задачи; дальше lead берёт её по имени."));return}
  ROLES.forEach(r=>{const d=el("details","card");d.append(el("summary","",r.name+" — "+r.description),el("pre","log",r.instructions));
    if(S.control){const x=el("button","ghost small","Удалить");x.type="button";x.onclick=async()=>{if(!await ask("Удалить роль "+r.name+"?"))return;try{await post("/api/roles/"+r.name+"/delete",{});rolesAt=0;renderRoles()}catch(e){alert(e.message)}};d.append(x)}
    box.append(d)})}
// a change-writing task: what it writes, and after DONE + merge the way to implement it
function renderProposes(t){
  const box=el("div","openspec");box.append(el("b","","Пишет OpenSpec change "),el("span","mono","openspec/changes/"+t.proposes.change+"/"),el("span","muted"," · "+t.agents[0]+" пишет, "+t.agents.slice(1).join(", ")+" ревьюят; код не меняется"));
  if(t.status==="COMPLETED"&&controlMode){const r=el("div","checks");
    if(t.proposedReady){const b=el("button","","Реализовать change");b.type="button";b.onclick=()=>implementChange(t.proposes.change);r.append(b,el("span","muted","откроет форму задачи с этим change"))}
    else r.append(el("span","muted","Посмотрите изменения и влейте ветку lead'а: change появится в проекте, и его можно будет реализовать."));
    box.append(r)}
  return box;
}
// a task that implements a change needs it in every agent's folder: say who lacks it and bring it there in one click
let specSeq=0;
async function checkSpecFolders(){const box=$("specfolders");const f=$("newtask");const change=f.elements.namedItem("openspec").value;
  if(!change||change==="__new__"||!S||!S.control){box.hidden=true;return}
  const agents=[f.elements.namedItem("lead").value,...[...$("others").querySelectorAll("input:checked")].map(i=>i.value)];const seq=++specSeq;
  try{const j=await getJSON(q("/api/openspec/folders?change="+encodeURIComponent(change)+"&agents="+encodeURIComponent(agents.join(","))));if(seq!==specSeq)return;
    box.replaceChildren();box.hidden=!j.missing.length;box.className="note";if(!j.missing.length)return;
    box.className="note bad";box.append("Change'а нет в папке: "+j.missing.map(m=>m.id).join(", ")+". ");
    if(!j.inProject){box.append("Сначала влейте ветку с ним в проект.");return}
    const b=el("button","ghost small","Подтянуть change");b.type="button";b.title="git merge текущей ветки проекта в ветки этих агентов (без --force; при конфликте ничего не меняется)";
    b.onclick=async()=>{b.disabled=true;b.textContent="подтягиваю…";
      try{const r=await post("/api/openspec/sync",{change,agents:j.missing.map(m=>m.id)});const bad=r.result.filter(x=>!x.ok);
        if(bad.length){box.replaceChildren(...bad.map(x=>el("div","",x.id+": "+x.text)))}else await checkSpecFolders()}catch(e){box.replaceChildren(e.message)}};
    box.append(b)}catch(e){box.hidden=true}}
$("newtask").elements.namedItem("contract").addEventListener("change",checkContract);
$("wt-clean").onclick=async()=>{const out=$("wt-out");if(!S||!S.control){out.hidden=false;out.textContent="Страница только для просмотра: запустите ui с runner'ами.";return}
  if(!await ask("Убрать все worktree проекта: агентов, контрактов закрытых задач и брошенные проверками вливания? Невлитые ветки и папки с незакоммиченными правками останутся."))return;
  const b=$("wt-clean");b.disabled=true;out.hidden=false;out.textContent="убираю…";
  const KIND={agent:"агент",contract:"контракт","merge-check":"проверка вливания"};
  try{const r=await post("/api/worktrees/clean-all",{});out.textContent=r.result.length?r.result.map(x=>(x.removed?"✓ ":"· ")+KIND[x.kind]+" "+x.id+": "+(x.removed?"убран":"оставлен")+(x.branchDeleted?", ветка удалена":"")+(x.note?" — "+x.note:"")+"\n   "+x.path).join("\n"):"Убирать нечего."}
  catch(e){out.textContent=e.message}finally{b.disabled=false}};$("others").addEventListener("change",checkSpecFolders);$("lead").addEventListener("change",()=>setTimeout(checkSpecFolders,0));
async function implementChange(name){const f=$("newtask");f.hidden=false;taskDefaults(f);await loadChanges();const sel=$("openspec");sel.value=name;sel.dispatchEvent(new Event("change"));
  f.elements.namedItem("title").value="";f.elements.namedItem("description").value="";f.scrollIntoView({behavior:"smooth",block:"start"});f.elements.namedItem("description").focus({preventScroll:true})}
// after DONE: the lead's branch into the project, then the agents' worktrees away (they come back from HEAD for the next task)
const branchState=new Map();
function renderBranch(t){
  const key=route.project+"/"+t.id;const st=branchState.get(key)||{};const lead=t.agents[0];const wts=S.control.worktrees;
  const box=el("div","openspec");const done=t.status==="COMPLETED";box.append(el("b","",done?"Ветка lead'а":"Изменения в работе"));
  const m=t.merged;
  if(!done){ // while the task runs: only the diff (any agent's branch) and comments to the lead
    box.append(el("div","muted","Что агенты уже закоммитили в своих ветках. Клик по строке — замечание; замечания уходят lead'у одним сообщением."));
    const r=el("div","checks");r.append(diffButton(t,key));box.append(r);appendDiff(box,t,key);return box}
  if(m)box.append(el("div","muted",(m.already?"уже была в ":"влита в ")+m.into+(m.strategy==="squash"?" одним коммитом ":m.strategy==="merge"?" коммитом слияния ":" · ")+m.commit.slice(0,7)+" · "+time(m.at)+(m.reverted?" · откачена "+m.reverted.commit.slice(0,7)+" "+time(m.reverted.at):"")+(m.verified?" · сборка после вливания зелёная ("+m.verified.command+(m.verified.tests?", тестов "+m.verified.tests.total:"")+")":m.unverified?" · без проверки сборки":"")));
  else box.append(el("div","muted","Итог задачи — в ветке "+(wts.includes(lead)?"swarm-"+lead:lead)+". Влить её в текущую ветку проекта (без push)."));
  const r=el("div","checks");
  const run=async(url,body,question,done)=>{if(!await ask(question))return;branchState.set(key,{pending:true});render();
    try{const res=await post(url,body);branchState.set(key,{output:done(res)})}catch(e){branchState.set(key,{error:e.message})}await tick()};
  if(m&&!m.already&&!m.reverted){const rv=el("button","ghost",st.pending?"…":"Откатить");rv.type="button";rv.disabled=!!st.pending;rv.title="git revert "+m.commit.slice(0,7)+": новый коммит, который отменяет изменения задачи; при конфликте ничего не меняется";
    rv.onclick=()=>run("/api/tasks/"+encodeURIComponent(t.id)+"/revert",{},"Откатить изменения задачи "+t.id+" в "+m.into+"? Будет новый коммит «Revert "+t.id+"», история не переписывается.",res=>"откачено: "+res.task.merged.reverted.commit.slice(0,7));r.append(rv)}
  const cmc=t.contract&&!t.contract.merged&&t.contractMergeCheck;
  if(cmc)box.append(renderMergeCheck(t,cmc,run,"contract"));
  const mc=!m&&t.mergeCheck;const checking=(mc&&mc.status==="running")||(cmc&&cmc.status==="running");
  if(mc)box.append(renderMergeCheck(t,mc,run));
  const done2=res=>res.check?(res.check.status==="conflict"?"конфликт"+(res.check.scope?" в контракте":"")+": "+(res.check.files||[]).join(", "):res.check.scope?"проверяю вливание контракта ("+res.check.command+"), потом сервиса":"проверяю вливание: собираю его на HEAD проекта и запускаю "+t.verifyCommand):"влито: "+res.task.merged.branch+" → "+res.task.merged.into+" ("+res.task.merged.commit.slice(0,7)+")"+(t.verifyCommand?"":" без проверки сборки");
  if(!m&&!mc&&!(cmc&&cmc.status!=="green")){const b=el("button","",st.pending?"…":"Влить в проект");b.type="button";b.disabled=!!st.pending;
    b.onclick=()=>run("/api/tasks/"+encodeURIComponent(t.id)+"/merge",{},t.verifyCommand?"Влить ветку lead'а ("+lead+") в текущую ветку проекта? Сначала вливание соберётся отдельно от проекта на его текущем HEAD и пройдёт «"+t.verifyCommand+"»: в проект попадёт только зелёное, одним коммитом «"+t.id+": …».":"Влить ветку lead'а ("+lead+") в текущую ветку проекта одним коммитом «"+t.id+": …»? У задачи нет verifyCommand: вливание не проверяется сборкой. При конфликте ничего не изменится.",done2);r.append(b)}
  if(checking)r.append(el("span","muted"," вливание проверяется…"));
  const c=el("button","ghost",st.pending?"…":"Убрать worktree агентов");c.type="button";c.disabled=!!st.pending;
  c.title="git worktree remove и git branch -d для "+wts.join(", ")+": без --force, невлитая ветка и папка с изменениями останутся. Перед следующей задачей worktree создадутся заново от HEAD проекта.";
  c.onclick=()=>run("/api/worktrees/clean",{},"Убрать worktree и ветки агентов ("+wts.join(", ")+")?"+(m?"":" Ветка lead'а ещё не влита: git её не удалит.")+" Перед следующей задачей они создадутся заново от текущего HEAD проекта.",
    res=>res.result.map(x=>x.id+": "+(x.removed?"папка убрана":"папка осталась")+(x.branchDeleted?", ветка удалена":"")+(x.note?" — "+x.note:"")).join("\n"));
  r.prepend(diffButton(t,key));
  r.append(c);box.append(r);
  if(st.output||st.error)box.append(el("pre","log"+(st.error?" err":""),st.error||st.output));
  appendDiff(box,t,key);
  return box;
}
// the API contract the task changes too: its repository and this task's worktree; named while the task is designed
function renderContract(t,control){const c=t.contract;const box=el("div","openspec");box.append(el("b","","Контракт API "));
  if(c){box.append(el("span","mono",c.groupId+":"+c.artifactId+" "+c.version),el("div","muted","репозиторий "+c.project+" · worktree задачи "+c.worktree+" (ветка "+c.branch+") · меняет lead "+t.agents[0]+(c.merged?" · влит в "+c.merged.into+" "+c.merged.commit.slice(0,7)+(c.merged.reverted?" · откачен":""):"")));return box}
  box.append(el("span","muted","задача его не меняет. Если на проектировании выяснилось, что API надо поменять, укажите проект со спекой: lead получит его worktree."));
  const b=el("button","ghost small","Указать проект контракта");b.type="button";
  b.onclick=async()=>{const path=await ask("Проект контракта OpenAPI для "+t.id+": абсолютный путь к Maven-проекту со спекой. Lead поменяет спеку в своём worktree, поднимет версию контракта, а сервис перейдёт на неё; «Принять и влить» вольёт сначала контракт, потом сервис.","/Users/me/projects/orders-api");if(!path)return;
    b.disabled=true;try{const r=await post("/api/tasks/"+encodeURIComponent(t.id)+"/contract",{path});toast("ok","Контракт указан",r.task.contract.groupId+":"+r.task.contract.artifactId+" "+r.task.contract.version+" — lead начнёт новую сессию с ним",t.id)}catch(e){b.disabled=false;toast("bad","Не указан",e.message,t.id)}await tick()};
  box.append(" ",b);return box}
// a closed task off the page: its folder moves to deleted/<id>/ for the observer, the code in branches stays
function renderDelete(t){const r=el("div","checks");const b=el("button","ghost danger small","Удалить задачу");b.type="button";
  b.onclick=async()=>{const reason=await ask("Удалить "+t.id+" «"+t.title+"» со страницы? Её папка (переписка, отчёты ревью, план, сборки, логи сессий) переедет в .agent-network/deleted/"+t.id+"/: там её прочитает наблюдатель, а расход уйдёт из статистики страницы. Код в ветках агентов и влитые коммиты останутся. Номер "+t.id+" новой задаче не достанется.","Почему удаляете? Необязательно — наблюдатель учтёт это (например: агент придумал задачу)");if(reason===false)return;
    b.disabled=true;try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/delete",reason?{reason}:{});toast("ok","Задача удалена",t.id+": "+t.title+" → deleted/"+t.id)}catch(e){b.disabled=false;toast("bad","Не удалено",e.message,t.id)}await tick()};
  r.append(b);return r}
// the merge check of a DONE task: the merge built on the project's HEAD and its verifyCommand, apart from the project
const MC_WORDS={running:"идёт",green:"зелёная",red:"красная",conflict:"конфликт",stale:"проект сдвинулся во время проверки",error:"не удалась",interrupted:"прервана перезапуском страницы"};
const MC_STEP={merge:"собираю вливание",setup:"ставлю зависимости",build:"сборка",land:"вливаю в проект"};
function renderMergeCheck(t,mc,run,scope){const box=el("div","mcheck");const u="/api/tasks/"+encodeURIComponent(t.id)+"/merge/";const body=scope?{scope}:{};
  box.append(el("b","",scope?"Проверка вливания контракта: ":"Проверка вливания: "),el("span","badge "+(mc.status==="green"?"PASS":mc.status==="running"?"WAITING":mc.status==="red"||mc.status==="conflict"?"FAIL":"WARNING"),MC_WORDS[mc.status]||mc.status));
  box.append(el("span","muted"," · в "+mc.into+" на "+mc.base.slice(0,7)+(mc.status==="running"&&mc.step?" · "+MC_STEP[mc.step]+(mc.step==="build"?" ("+(mc.command||t.verifyCommand)+")":""):"")+" · "+time(mc.startedAt).slice(0,5)));
  if(mc.build&&!mc.build.ok){box.append(el("div","",mc.build.command+(mc.build.timedOut?": тайм-аут":mc.build.tests?": упало "+mc.build.tests.failed+" из "+mc.build.tests.total:": код "+mc.build.exitCode)+(mc.build.log?" · лог: .agent-network/"+mc.build.log:"")));
    const d=el("details","");d.append(el("summary","muted","что упало"),el("pre","log err",mc.build.summary));box.append(d)}
  if(mc.status==="conflict")box.append(el("div","","Конфликтующие файлы: "+(mc.files||[]).join(", ")));
  if(mc.error)box.append(el("div","muted",mc.error));
  (mc.setup||[]).filter(x=>!x.ok).forEach(x=>{const d=el("details","");d.append(el("summary","muted",x.command+" не прошла"),el("pre","log err",x.summary||""));box.append(d)});
  if(mc.followUp)box.append(el("div","","Отдано команде: "+mc.followUp));
  if(mc.status==="running"||mc.status==="green")return box;
  const r=el("div","checks");
  const btn=(label,cls,act,q,done)=>{const b=el("button",cls,label);b.type="button";b.onclick=()=>run(u+act,body,q,done);r.append(b)};
  if(scope&&(mc.status==="red"||mc.status==="conflict"))box.append(el("div","muted","Чинится в репозитории контракта ("+t.contract.project+"): поправьте там и «Проверить снова»."));
  if(!scope&&(mc.status==="red"||mc.status==="conflict")&&!mc.followUp)btn("Отдать команде","","handoff","Создать follow-up задачу той же команде: "+(mc.status==="red"?"она начнёт с проверенного вливания и сделает «"+t.verifyCommand+"» зелёной":"она вольёт HEAD проекта в свои ветки и разрешит конфликты")+"?",res=>"follow-up "+res.followUp.id+": "+res.followUp.title);
  btn("Проверить снова","ghost","retry","Проверить вливание ещё раз на текущем HEAD "+(scope?"репозитория контракта":"проекта")+"?",res=>res.check?"проверяю снова":"влито");
  if(mc.status!=="conflict")btn("Влить всё равно","ghost danger","force",scope?"Влить контракт без зелёной сборки? Он будет помечен «без проверки», дальше пойдёт вливание сервиса.":"Влить ветку lead'а в проект без зелёной сборки? Задача будет помечена «без проверки сборки», а пакет приёмки это покажет.",res=>res.check?"контракт влит без проверки, проверяю сервис":"влито без проверки: "+res.task.merged.commit.slice(0,7));
  box.append(r);return box}
const diffState=new Map();
// the diff list of a task: the lead's branch (or ?agent=), after the merge what the merge brought
async function loadDiff(t,key,agent){const prev=diffState.get(key)||{};diffState.set(key,{...prev,loading:true,open:true,agent});render();
  try{const r=await fetch(q("/api/tasks/"+encodeURIComponent(t.id)+"/diff"+(agent?"?agent="+encodeURIComponent(agent):"")),{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.message||r.status);
    diffState.set(key,{open:true,data:j,agent,comments:prev.comments||[]})}
  catch(e){diffState.set(key,{open:true,error:e.message,agent,comments:prev.comments||[]})}render()}
function diffButton(t,key){const dv=diffState.get(key)||{};const d=el("button","ghost",dv.loading?"загружаю…":dv.open?"Скрыть изменения":"Посмотреть изменения");d.type="button";
  d.onclick=()=>{if(dv.open){diffState.set(key,{...dv,open:false});render();return}loadDiff(t,key,dv.agent)};return d}
function appendDiff(box,t,key){const dv=diffState.get(key)||{};
  if(dv.open&&dv.error)box.append(el("pre","log err",dv.error));
  if(dv.open&&dv.data)box.append(renderDiff(dv.data,t.id,t))}
// the lead's branch against the project: commits and files with +/- (50 at a time), a file's diff loaded when it is opened
const DIFF_PAGE=50;
function renderDiff(x,taskId,t){
  const key=route.project+"/"+taskId;const dv=diffState.get(key);
  const ui=dv.ui||(dv.ui={files:DIFF_PAGE,commits:20,open:new Set(),patches:{},scroll:{}});
  const comments=dv.comments||(dv.comments=[]);
  const box=el("div","diff");
  // whose branch (while the task runs) and the comments waiting to be sent
  const bar=el("div","checks dbar");
  if(!x.merged&&x.agents&&x.agents.length>1){const sel=document.createElement("select");x.agents.forEach(a=>sel.append(new Option("ветка "+a+(a===t.agents[0]?" (lead)":""),a)));sel.value=dv.agent||t.agents[0];sel.style.width="auto";
    sel.onchange=()=>{dv.ui=null;loadDiff(t,key,sel.value)};bar.append(sel)}
  if(S.control){const done=t.status==="COMPLETED";bar.append(el("span","muted",comments.length?"замечаний: "+comments.length:"клик по строке — замечание"));
    if(comments.length){const send=el("button","",done?"Создать задачу по замечаниям":"Отправить lead'у");send.type="button";
      send.onclick=async()=>{if(!await ask(done?"Создать задачу для роя «исправить по замечаниям» ("+comments.length+")?":"Отправить "+comments.length+" замечаний lead'у ("+t.agents[0]+")?"))return;send.disabled=true;
        try{const r=await post("/api/tasks/"+encodeURIComponent(taskId)+"/review",{comments,branch:x.branch});dv.comments=[];toast("ok",r.sent==="task"?"Создана "+r.task.id:"Замечания отправлены "+r.to,r.sent==="task"?r.task.title:comments.length+" шт.",r.sent==="task"?r.task.id:taskId)}
        catch(e){alert(e.message);send.disabled=false}render()};
      const clr=el("button","ghost small","очистить");clr.type="button";clr.onclick=async()=>{if(await ask("Удалить все замечания?")){dv.comments=[];render()}};bar.append(send,clr)}}
  box.append(bar);
  box.append(el("div","muted",(x.merged?"влитые изменения ":"изменения ветки ")+x.branch+": "+x.commitsTotal+" коммит(ов), "+x.files.length+" файл(ов), +"+x.files.reduce((a,f)=>a+f.added,0)+" −"+x.files.reduce((a,f)=>a+f.deleted,0)));
  const more=(left,step,go)=>{const b=el("button","ghost small","ещё "+Math.min(left,step)+" из "+left);b.type="button";b.onclick=()=>{go();render()};return b};
  if(x.commits.length){const c=el("div","mono dcommits");x.commits.slice(0,ui.commits).forEach(l=>c.append(el("div","",l)));
    if(x.commits.length>ui.commits)c.append(more(x.commits.length-ui.commits,100,()=>ui.commits+=100));
    if(x.commitsTotal>x.commits.length)c.append(el("div","","… и ещё "+(x.commitsTotal-x.commits.length)+": git log в папке проекта"));box.append(c)}
  if(!x.files.length){box.append(el("div","muted","изменений нет: ветка уже в проекте"));return box}
  const load=async f=>{ui.patches[f.path]={loading:true};render();
    try{const r=await fetch(q("/api/tasks/"+encodeURIComponent(taskId)+"/diff?file="+encodeURIComponent(f.path)+(dv.agent?"&agent="+encodeURIComponent(dv.agent):"")),{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.message||r.status);ui.patches[f.path]=j}
    catch(e){ui.patches[f.path]={error:e.message}}render()};
  x.files.slice(0,ui.files).forEach(f=>{const det=el("details","dfile");det.open=ui.open.has(f.path);
    const sm=el("summary","");sm.append(el("span","mono",f.path)," ",f.binary?el("span","muted","двоичный"):el("span","dadd","+"+f.added)," ",f.binary?"":el("span","ddel","−"+f.deleted));det.append(sm);
    det.addEventListener("toggle",()=>{if(det.open){ui.open.add(f.path);if(!ui.patches[f.path])load(f)}else ui.open.delete(f.path)});
    const pt=ui.patches[f.path];
    if(det.open&&pt){
      if(pt.loading)det.append(el("div","muted dpad","загружаю…"));
      else if(pt.error)det.append(el("pre","log err",pt.error));
      else{const pre=el("pre","dpatch");let o=0,n=0;
        pt.patch.split("\n").forEach(l=>{if(/^(diff --git|index |--- |\+\+\+ )/.test(l))return;
          if(l.startsWith("@@")){const m=/@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);if(m){o=+m[1];n=+m[2]}pre.append(el("span","dhunk",l));return}
          const side=l.startsWith("-")?"old":"new";const no=side==="old"?o:n;if(l.startsWith("+"))n++;else if(l.startsWith("-"))o++;else{o++;n++}
          const row=el("span",l.startsWith("+")?"dadd":l.startsWith("-")?"ddel":"");row.append(el("i","dln",String(no)),l||" ");pre.append(row);
          const here=c=>c.file===f.path&&c.side===side&&c.line===no;
          (t&&t.review||[]).filter(c=>c.file===f.path&&side==="new"&&c.line===no).forEach(c=>{const cm=el("span","dcm sent "+c.status);cm.append(el("b","",c.id+" "+(c.status==="open"?"открыто":c.status==="fixed"?"исправлено":"отклонено")+": "),c.text+(c.note?" — lead: "+c.note:""));pre.append(cm)});
          comments.filter(here).forEach(c=>{const cm=el("span","dcm");cm.append(el("b","","замечание: "),c.text);const x2=el("button","ghost small","×");x2.type="button";x2.title="убрать";x2.onclick=e=>{e.stopPropagation();dv.comments=comments.filter(y=>y!==c);render()};cm.append(x2);pre.append(cm)});
          if(S.control){row.classList.add("dclick");row.title="замечание к строке "+no;
            row.onclick=()=>{ui.editing={file:f.path,side,line:no,code:l.slice(1).trim()};if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();render();setTimeout(()=>{const ta=document.querySelector(".dcomment textarea");if(ta)ta.focus()},0)}}
          const ed=ui.editing;if(ed&&ed.file===f.path&&ed.side===side&&ed.line===no){const form=el("span","dcomment");const ta=document.createElement("textarea");ta.rows=2;ta.placeholder="Что поменять в этой строке…";ta.value=ed.text||"";ta.oninput=()=>{ed.text=ta.value};
            const add=el("button","small","Добавить");add.type="button";add.onclick=()=>{if(!ta.value.trim())return;comments.push({file:f.path,side,line:no,code:ed.code,text:ta.value.trim()});ui.editing=null;ta.blur();render()};
            const cancel=el("button","ghost small","Отмена");cancel.type="button";cancel.onclick=()=>{ui.editing=null;ta.blur();render()};
            ta.onkeydown=e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))add.click();if(e.key==="Escape")cancel.click()};form.append(ta,add,cancel);pre.append(form)}});
        // the card is rebuilt on every refresh: the file's diff keeps where you scrolled it (down and sideways)
        const at=ui.scroll[f.path];pre.addEventListener("scroll",()=>{ui.scroll[f.path]={top:pre.scrollTop,left:pre.scrollLeft}},{passive:true});
        if(at)requestAnimationFrame(()=>{pre.scrollTop=at.top;pre.scrollLeft=at.left});
        det.append(pre);if(pt.truncated)det.append(el("div","note dpad","дифф файла большой и обрезан: полностью — git diff в папке проекта"))}}
    box.append(det)});
  if(x.files.length>ui.files)box.append(more(x.files.length-ui.files,DIFF_PAGE,()=>ui.files+=DIFF_PAGE));
  return box;
}
// the lead's HTML plan (task.planReview): a line in the card, the review in a full-window view (one iframe that the refresh never rebuilds)
const PLAN_STATUS={none:"lead пишет план…",awaiting:"план ждёт вас",revising:"lead дорабатывает план по вашему отзыву",approved:"план утверждён"};
// a change-writing task with analysts' input shows two pages instead of a plan: their spec (you look), our change (you accept or return it)
const PAGE_WORDS={
  input:{name:"Спека аналитиков ",status:{none:"lead готовит страницу…",awaiting:"ждёт просмотра",revising:"lead смотрит ваши замечания",approved:"просмотрена"},approve:"Посмотрел",send:"Отправить замечания",ask:"Отметить спеку аналитиков просмотренной? Дальше lead проведёт допрос и напишет свой change.",sendAsk:" Замечания станут вопросами допроса.",phase:"DISCUSS",yes:"Да, посмотрел",done:"просмотрена",view:"Их спека как есть: отмечено, где она расходится с кодом и правилами проекта.",sent:"Lead смотрит ваши замечания — новая версия откроется здесь сама."},
  change:{name:"Change ",status:{none:"lead пишет change…",awaiting:"ждёт вас",revising:"lead дорабатывает",approved:"принят"},approve:"Принять change",send:"Вернуть на доработку",ask:"Принять change? Дальше ревьюер проверит его, и после DONE его можно реализовать.",sendAsk:" Lead поправит change и покажет новую версию.",phase:"IMPLEMENT",yes:"Да, принять",done:"принят",view:"Наш change рядом с их: что взято, что адаптировано, отброшено или добавлено — и почему.",sent:"Lead дорабатывает change — новая версия откроется здесь сама."}};
function planWords(t,stage){const w=stage&&PAGE_WORDS[stage];return w||{name:"План ",status:PLAN_STATUS,approve:"Утвердить план",send:"Отправить lead'у",ask:null,sendAsk:" Он посмотрит и пришлёт новую версию плана.",phase:"DISCUSS",yes:"Да, утвердить",done:"утверждён",view:"Вопросы плана отмечайте прямо на странице; ответы уйдут с отзывом.",sent:"Lead дорабатывает план — новая версия откроется здесь сама."}}
function renderPlan(t){const p=t.plan;const w=planWords(t,p.stage);const box=el("div","openspec planline");box.append(el("b","",w.name),el("span",p.status==="awaiting"?"badge WARNING":p.status==="approved"?"badge PASS":"badge",w.status[p.status]));
  if(p.version){box.append(el("span","muted"," · v"+p.version+(p.by?" от "+p.by:"")+(p.at?" "+time(p.at).slice(0,5):"")+(p.rounds?" · отзывов: "+p.rounds:"")+(p.approvedVersion?" · утверждена v"+p.approvedVersion:"")));
    const b=el("button",p.status==="awaiting"&&S.control?"small":"ghost small",p.status==="awaiting"&&S.control?"Открыть и проверить":"Открыть план");b.type="button";b.onclick=()=>openPlan(t.id);box.append(" ",b)}
  else box.append(el("span","muted"," · появится здесь, когда lead его напишет; соглашение — после вашего «Утвердить»"));
  return box}
// after DONE: the acceptance page (the lead's table, reviews, diff against the agreement, deploy notes): accept it — the
// lead's branch merges into the project — or return it with comments on its blocks, which become a follow-up task
function renderAcceptance(t){const box=el("div","openspec planline");const v=t.acceptance;const can=!!S.control&&!v;
  box.append(el("b","","Пакет приёмки "),el("span","badge "+(v&&v.status==="accepted"?"PASS":"WARNING"),v?(v.status==="accepted"?"принят":"возвращён"+(v.followUp?" → "+v.followUp:"")):"ждёт вас"));
  if(v)box.append(el("span","muted"," · "+time(v.at).slice(0,5)));
  const b=el("button",can?"small":"ghost small",can?"Открыть и проверить":"Открыть");b.type="button";b.onclick=()=>openAcceptance(t.id);box.append(" ",b);return box}
let AV=null;let ACC_EL=null;
function accEl(){if(ACC_EL)return ACC_EL;const o=el("div","planov");o.setAttribute("role","dialog");o.setAttribute("aria-label","Пакет приёмки");
  const head=el("div","planhead");const title=el("b","");const x=el("button","ghost","Закрыть");x.type="button";x.onclick=()=>closeAcceptance();head.append(title,x);
  const body=el("div","planbody");const fr=document.createElement("iframe");fr.title="приёмка";const side=el("div","planside");body.append(fr,side);o.append(head,body);document.body.append(o);
  return ACC_EL={o,title,fr,side}}
// a new frame each time: a sandboxed page may not navigate to the next one (see freshFrame)
function accFrame(){const fr=document.createElement("iframe");fr.title="приёмка";AV.el.fr.replaceWith(fr);AV.el.fr=fr;fr.src=q("/api/tasks/"+encodeURIComponent(AV.taskId)+"/acceptance/view")}
async function accInfo(){try{AV.info=await getJSON(q("/api/tasks/"+encodeURIComponent(AV.taskId)+"/acceptance"))}catch(e){AV.error="Не удалось загрузить: "+e.message}}
async function openAcceptance(taskId){const e=accEl();AV={taskId,mode:"view",comments:[],pick:null,confirm:null,pending:false,error:null,info:null,el:e};
  e.o.hidden=false;document.body.classList.add("noscroll");accFrame();renderAccSide();await accInfo();renderAccSide()}
function closeAcceptance(force){if(!AV)return;clearTimeout(AV.poll);if(!force&&AV.comments.length&&!AV.closeArmed){AV.closeArmed=true;AV.error="Есть неотправленные замечания: «Закрыть» ещё раз — и они пропадут.";renderAccSide();return}
  AV.el.o.hidden=true;AV.el.fr.src="about:blank";document.body.classList.remove("noscroll");AV=null}
function accSay(m){if(AV&&AV.el.fr.contentWindow)AV.el.fr.contentWindow.postMessage(m,"*")}
addEventListener("message",ev=>{if(!AV||ev.source!==AV.el.fr.contentWindow)return;const m=ev.data||{};if(!m.an)return;
  if(m.type==="ready")accSay({type:"mode",mode:AV.mode});
  else if(m.type==="pick"){AV.pick={target:m.target,quote:m.quote||"",text:""};renderAccSide();setTimeout(()=>{const ta=AV&&AV.el.side.querySelector(".ppick textarea");if(ta)ta.focus()},0)}});
addEventListener("keydown",e=>{if(e.key!=="Escape"||!AV||AV.el.o.hidden||(document.activeElement&&document.activeElement.tagName==="TEXTAREA"))return;if(AV.confirm){AV.confirm=null;renderAccSide()}else closeAcceptance()});
async function accSend(kind){AV.confirm=null;AV.error=null;AV.pending=true;renderAccSide();
  try{const r=await post("/api/tasks/"+encodeURIComponent(AV.taskId)+"/acceptance/"+kind,kind==="return"?{comments:AV.comments}:{});
    if(r.check)toast("ok",r.check.status==="conflict"?"Вливание конфликтует":"Проверяю вливание",r.check.status==="conflict"?"не принято: "+(r.check.files||[]).join(", "):"задача примется, когда сборка вливания позеленеет",AV.taskId);
    else toast("ok",kind==="accept"?"Задача принята":"Задача возвращена",kind==="accept"?(r.merged?"влита: "+r.merged.branch+" → "+r.merged.into+" ("+r.merged.commit.slice(0,7)+")":"без вливания"):"follow-up "+r.followUp.id+" с вашими замечаниями",AV.taskId);
    AV.comments=[];AV.pick=null;AV.mode="view";AV.pending=false;await accInfo();accFrame();await tick()}
  catch(e){AV.pending=false;AV.error="Не получилось: "+e.message}renderAccSide()}
function renderAccSide(){if(!AV)return;const e=AV.el;const t=S&&S.tasks.find(x=>x.id===AV.taskId);e.title.textContent="Приёмка "+AV.taskId+(t?" · "+t.title:"");
  const side=e.side;side.replaceChildren();const i=AV.info;const foot=el("div","pfoot");
  if(!i){side.append(el("div","muted",AV.error||"загружаю…"));return}
  const mc=i.mergeCheck;const checking=mc&&mc.status==="running";
  const can=!!(S&&S.control)&&!i.verdict&&!checking;
  if(checking){side.append(el("div","note","Проверяю вливание: "+(MC_STEP[mc.step]||"")+(mc.step==="build"?" ("+i.verify+")":"")+". Задача примется, когда сборка позеленеет."));
    clearTimeout(AV.poll);AV.poll=setTimeout(async()=>{if(!AV)return;await accInfo();if(AV&&!(AV.info.mergeCheck&&AV.info.mergeCheck.status==="running"))accFrame();renderAccSide()},3000)}
  else if(mc&&(mc.status==="red"||mc.status==="conflict"))side.append(el("div","note bad",(mc.status==="red"?"Сборка вливания красная":"Вливание конфликтует")+(mc.followUp?": отдано в "+mc.followUp:": в карточке задачи — «Отдать команде» или «Проверить снова»")+"."));
  const bad=i.alerts.filter(a=>a.level==="bad").length;
  side.append(el("div","note"+(bad?" bad":""),i.alerts.length?"На что посмотреть: "+i.alerts.length+(bad?" (серьёзных "+bad+")":"")+" — первый раздел страницы.":"Ничего, что требует вас: можно принимать."));
  if(!i.table)side.append(el("div","muted small","Lead не прислал таблицу «требование → доказательство» (задача старше пакета приёмки)."));
  if(i.verdict)side.append(el("div","psent",(i.verdict.status==="accepted"?"✓ Принята ":"Возвращена ")+time(i.verdict.at).slice(0,5)+(i.verdict.followUp?": follow-up "+i.verdict.followUp:"")));
  if(can){const w=el("div","win pmode");[["view","Просмотр"],["comment","Замечание"]].forEach(([m,l])=>{const b=el("button",AV.mode===m?"on":"",l);b.type="button";
      b.onclick=()=>{AV.mode=m;AV.pick=null;accSay({type:"mode",mode:m});renderAccSide()};w.append(b)});side.append(w);
    side.append(el("div","muted small",AV.mode==="comment"?"Кликните блок или выделите слова — и напишите, что поменять.":"Замечания к блокам страницы уйдут команде follow-up задачей. Замечания к строкам кода — «Посмотреть изменения» в карточке."))}
  if(AV.pick&&can){const f=el("div","ppick");f.append(el("div","muted","к "+AV.pick.target));if(AV.pick.quote)f.append(el("div","pquote","«"+AV.pick.quote+"»"));
    const ta=document.createElement("textarea");ta.rows=3;ta.placeholder="Что поменять…";ta.value=AV.pick.text;ta.oninput=()=>{AV.pick.text=ta.value};
    const add=el("button","small","Добавить");add.type="button";add.onclick=()=>{if(!ta.value.trim())return;AV.comments.push({target:AV.pick.target,...(AV.pick.quote?{quote:AV.pick.quote}:{}),text:ta.value.trim()});AV.pick=null;AV.closeArmed=false;accSay({type:"unpick"});renderAccSide()};
    const cancel=el("button","ghost small","Отмена");cancel.type="button";cancel.onclick=()=>{AV.pick=null;accSay({type:"unpick"});renderAccSide()};
    ta.onkeydown=ev=>{if(ev.key==="Enter"&&(ev.metaKey||ev.ctrlKey))add.click();if(ev.key==="Escape")cancel.click()};f.append(ta,add,cancel);side.append(f)}
  if(AV.comments.length){const l=el("div","plist");l.append(el("b","","Замечания ("+AV.comments.length+")"));
    AV.comments.forEach(c=>{const r=el("div","pitem");r.append(el("div","muted",c.target),...(c.quote?[el("div","pquote","«"+c.quote+"»")]:[]),el("div","",c.text));
      const x=el("button","ghost small","×");x.type="button";x.title="убрать";x.onclick=()=>{AV.comments=AV.comments.filter(y=>y!==c);renderAccSide()};r.append(x);l.append(r)});side.append(l)}
  if(AV.error)side.append(el("div","note bad",AV.error));
  if(AV.pending)side.append(el("div","muted small","Отправляю…"));
  if(can){const acceptLabel=i.ownBranch?(mc&&(mc.status==="red"||mc.status==="conflict")?"Проверить вливание снова":"Принять и влить"):"Принять";
    if(AV.confirm){const c=el("div","pconfirm");c.append(el("div","",AV.confirm==="accept"?(i.ownBranch?(i.verify?"Принять задачу и влить ветку lead'а? Вливание сначала соберётся на HEAD проекта и пройдёт «"+i.verify+"»: задача примется и вольётся, только если сборка зелёная.":"Принять задачу и влить ветку lead'а в текущую ветку проекта одним коммитом? У задачи нет verifyCommand: вливание сборкой не проверяется."):"Принять задачу?"):"Вернуть задачу? "+AV.comments.length+" замеч. уйдут команде новой follow-up задачей."));
      const yes=el("button","small",AV.confirm==="accept"?"Да, "+acceptLabel.toLowerCase():"Да, вернуть");yes.type="button";yes.onclick=()=>accSend(AV.confirm);
      const no=el("button","ghost small","Отмена");no.type="button";no.onclick=()=>{AV.confirm=null;renderAccSide()};c.append(yes," ",no);foot.append(c)}
    else{const r=el("div","pactions");const ok=el("button","",acceptLabel);ok.type="button";ok.disabled=AV.pending||AV.comments.length>0;ok.title=AV.comments.length?"Есть замечания: верните задачу или уберите их":"";ok.onclick=()=>{AV.confirm="accept";renderAccSide()};
      const back=el("button","ghost","Вернуть с замечаниями");back.type="button";back.disabled=AV.pending||!AV.comments.length;back.onclick=()=>{AV.confirm="return";renderAccSide()};r.append(ok," ",back);foot.append(r)}}
  side.append(foot)}
let PV=null; // the open plan: {taskId, plan, version, mode, comments, pick, edited, diff, pending, el:{...}}
let PLAN_EL=null;
function planEl(){if(PLAN_EL)return PLAN_EL;const o=el("div","planov");o.setAttribute("role","dialog");o.setAttribute("aria-label","План задачи");
  const head=el("div","planhead");const title=el("b","");const ver=document.createElement("select");ver.className="pver";const st=el("span","muted");const x=el("button","ghost","Закрыть");x.type="button";let armed=null;
  x.onclick=()=>{if(!planDirty()||armed){clearTimeout(armed);armed=null;x.textContent="Закрыть";closePlan(true);return}
    x.textContent="Закрыть без отправки? Ещё раз";armed=setTimeout(()=>{armed=null;x.textContent="Закрыть"},4000)};
  head.append(title,ver,st,x);const body=el("div","planbody");const fr=document.createElement("iframe");fr.title="план"; // sandboxed by its own CSP (sandbox allow-scripts): an opaque origin, no calls to this page
  const side=el("div","planside");body.append(fr,side);o.append(head,body);document.body.append(o);
  ver.onchange=()=>{if(!planDirty())loadPlanVersion(Number(ver.value));else{ver.value=String(PV.version);PV.error="Сначала отправьте или уберите свои замечания и правки: при переходе на другую версию они пропадут.";renderPlanSide()}};
  return PLAN_EL={o,title,ver,st,fr,side}}
function planDirty(){return PV&&(PV.comments.length>0||PV.edited)}
function planHasNotes(){return planDirty()||(PV&&PV.answered)}
async function openPlan(taskId){const e=planEl();PV={taskId,plan:null,version:0,mode:"view",comments:[],pick:null,edited:false,diff:false,diffCount:null,pending:false,el:e};
  e.o.hidden=false;document.body.classList.add("noscroll");await reloadPlan(true)}
function closePlan(force){if(!PV)return;if(!force&&planDirty())return;PV.el.o.hidden=true;PV.el.fr.src="about:blank";document.body.classList.remove("noscroll");PV=null}
async function reloadPlan(toLatest){const j=await getJSON(q("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan"));PV.plan=j.plan;PV.critiques=j.critiques||[];PV.critic=j.critic||{enabled:false};const last=j.plan.versions.at(-1);
  if(toLatest&&last)await loadPlanVersion(last.n);else renderPlanSide()}
// a new frame for every version: a frame whose page is sandboxed by its CSP may not navigate to the next one when its
// src changes (no request, an empty load, no "ready"), which left a lead's new version blank when it opened by itself
function freshFrame(){const old=PLAN_EL.fr;const fr=document.createElement("iframe");fr.title=old.title;old.replaceWith(fr);PLAN_EL.fr=fr;return fr}
async function loadPlanVersion(v){PV.version=v;PV.confirm=null;PV.error=null;PV.comments=[];PV.pick=null;PV.edited=false;PV.answered=false;PV.diagram=null;PV.diffCount=null;PV.ready=false;
  freshFrame().src=q("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/"+v+"/view");renderPlanSide()}
function planSay(m){if(PV&&PV.el.fr.contentWindow)PV.el.fr.contentWindow.postMessage(m,"*")}
const planWaits=new Map();let planSeq=0;
function planCollect(){return new Promise((ok,fail)=>{const id=++planSeq;planWaits.set(id,ok);planSay({type:"collect",id});setTimeout(()=>{if(planWaits.delete(id))fail(new Error("страница плана не ответила"))},4000)})}
// the version before this one on the same page (an input page is no "before" of a change page)
function planPrev(){const vs=PV&&PV.plan?PV.plan.versions:[];const cur=vs.find(x=>x.n===PV.version);const prev=vs.find(x=>x.n===PV.version-1);return prev&&(prev.stage||null)===(cur&&cur.stage||null)?prev.n:0}
async function planDiff(){if(!PV)return;const prev=planPrev();if(!PV.diff||prev<1){planSay({type:"diff",prev:null});PV.diffCount=null;renderPlanSide();return}
  try{const j=await getJSON(q("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/"+prev));planSay({type:"diff",prev:j.html})}catch(e){toast("bad","Не удалось загрузить v"+prev,e.message)}}
addEventListener("message",ev=>{if(!PV||ev.source!==PV.el.fr.contentWindow)return;const m=ev.data||{};if(!m.an)return;
  if(m.type==="ready"){PV.ready=true;planSay({type:"mode",mode:PV.mode});if(PV.diff)planDiff();renderPlanSide()}
  else if(m.type==="pick"){PV.pick={target:m.target,quote:m.quote||"",text:""};renderPlanSide();setTimeout(()=>{const ta=PV&&PV.el.side.querySelector(".ppick textarea");if(ta)ta.focus()},0)}
  else if(m.type==="answered"){if(!PV.answered){PV.answered=true;if(!PV.el.side.contains(document.activeElement))renderPlanSide()}}
  else if(m.type==="edited"){PV.edited=true;if(!PV.el.side.contains(document.activeElement))renderPlanSide()}
  else if(m.type==="diagram"){PV.diagram={index:m.index,source:m.source,original:m.original,error:null};renderPlanSide();setTimeout(()=>{const ta=PV&&PV.el.side.querySelector(".pdiag textarea");if(ta)ta.focus()},0)}
  else if(m.type==="diagram-ok"||m.type==="diagram-error"){if(PV.diagram&&PV.diagram.index===m.index){PV.diagram.error=m.type==="diagram-error"?m.message:null;const s2=PV.el.side.querySelector(".pdiag .dst");if(s2){s2.className="dst "+(PV.diagram.error?"bad":"muted");s2.textContent=PV.diagram.error?"ошибка: "+PV.diagram.error:"схема перерисована"}}}
  else if(m.type==="diffed"){PV.diffCount=m.count;renderPlanSide()}
  else if(m.type==="collected"){const ok=planWaits.get(m.id);if(ok){planWaits.delete(m.id);ok(m)}}});
addEventListener("keydown",e=>{if(e.key!=="Escape"||!PV||PV.el.o.hidden||(document.activeElement&&document.activeElement.tagName==="TEXTAREA"))return;if(PV.confirm){PV.confirm=null;renderPlanSide()}else closePlan()});
// no browser dialogs here (some browsers answer them by themselves): the panel asks, the second click sends
function planWhat(c){const n=(k,a,b,d)=>k+" "+(k%10===1&&k%100!==11?a:k%10>=2&&k%10<=4&&(k%100<10||k%100>=20)?b:d);
  return [PV.comments.length?n(PV.comments.length,"замечание","замечания","замечаний"):"",c.edits.length?n(c.edits.length,"правка","правки","правок"):"",c.answers.length?n(c.answers.length,"ответ","ответа","ответов"):""].filter(Boolean).join(", ")}
async function planAsk(approve){PV.error=null;let c;try{c=await planCollect()}catch(e){PV.error=e.message;renderPlanSide();return}
  const notes=PV.comments.length+c.edits.length+c.answers.length;
  if(!approve&&!notes){PV.error="Нечего отправлять: кликните блок в режиме «Замечание», поправьте текст или ответьте на вопрос плана.";renderPlanSide();return}
  PV.confirm={approve,what:planWhat(c)};renderPlanSide()}
async function planSend(approve){const v=PV.version;PV.confirm=null;PV.error=null;PV.pending=true;renderPlanSide();
  try{const c=await planCollect();const what=planWhat(c);
    const r=await post("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/"+(approve?"approve":"feedback"),{version:v,comments:PV.comments,edits:c.edits,answers:c.answers,...(c.html?{html:c.html}:{})});
    const st=(r.plan.versions.find(x=>x.n===v)||{}).stage;
    toast("ok",approve?(st==="input"?"Спека аналитиков просмотрена":st==="change"?"Change принят":"План утверждён"):"Отзыв отправлен "+(r.to||"lead'у"),approve?(st==="input"?"lead проведёт допрос и напишет свой change":st==="change"?"дальше ревью и DONE":"v"+r.plan.approved.version+": lead предложит соглашение"):what,PV.taskId);
    PV.comments=[];PV.edited=false;PV.answered=false;PV.pick=null;PV.diagram=null;PV.plan=r.plan;PV.pending=false;
    const last=r.plan.versions.at(-1);if(last&&last.n!==v)await loadPlanVersion(last.n);else{PV.mode="view";planSay({type:"mode",mode:"view"});renderPlanSide()}await tick()}
  catch(e){PV.pending=false;PV.error="Не отправлено: "+e.message;renderPlanSide()}}
function renderPlanSide(){if(!PV)return;const e=PV.el;const p=PV.plan;const t=S&&S.tasks.find(x=>x.id===PV.taskId);
  e.title.textContent=PV.taskId+(t?" · "+t.title:"");
  const vs=p?p.versions:[];e.ver.replaceChildren(...vs.map(x=>new Option("v"+x.n+" · "+x.by+" · "+time(x.at).slice(0,5)+(p.approved&&p.approved.version===x.n?" · "+(x.stage==="input"?"просмотрена":x.stage==="change"?"принята":"утверждена"):""),String(x.n))));e.ver.value=String(PV.version);e.ver.hidden=vs.length<2;
  const last=vs.at(-1);const latest=last&&PV.version===last.n;const qs=(S&&S.openQuestions||[]).filter(q=>q.taskId===PV.taskId);
  const W=planWords(t,last&&last.stage);const live=t&&t.status==="ACTIVE"&&t.phase===W.phase;const can=!!(S&&S.control)&&latest&&live&&!p.approved;
  e.st.textContent=!vs.length?"плана ещё нет":p.approved?W.done+" v"+p.approved.version:!latest?"старая версия: только просмотр":!live?"задача уже не на этом шаге":t.plan&&t.plan.status==="revising"?W.status.revising:"";
  // the refresh calls this every few seconds: rebuild only when something shown changed, so a click lands where it was aimed
  const steps=t&&typeof ACT!=="undefined"?ACT.filter(x=>x.agentId===t.agents[0]&&(!x.taskId||x.taskId===t.id)).slice(-6).map(x=>x.seq).join(","):"";
  const sig=JSON.stringify([PV.version,PV.mode,PV.comments,PV.pick,PV.diagram,PV.confirm,PV.pending,PV.error,PV.ready,PV.edited,PV.answered,PV.diff,PV.diffCount,PV.critiques,PV.critic,PV.criticAdded?[...PV.criticAdded]:null,PV.actOpen,
    p&&p.versions.length,p&&p.approved,p&&p.feedback&&p.feedback.length,t&&t.plan,t&&t.status,t&&t.phase,t&&t.queue,qs.map(q=>q.messageId),steps,can]);
  if(sig===PV.sideSig)return;PV.sideSig=sig;
  const side=e.side;side.replaceChildren();
  // the confirmation and the buttons stay at the bottom of the panel, whatever grows above them
  const foot=el("div","pfoot");
  const cur=vs.find(x=>x.n===PV.version);if(cur&&cur.note)side.append(el("div","pnote","v"+cur.n+": "+cur.note));
  if(can){const w=el("div","win pmode");[["view","Просмотр"],["comment","Замечание"],["edit","Править текст"]].forEach(([m,l])=>{const b=el("button",PV.mode===m?"on":"",l);b.type="button";
      b.onclick=()=>{PV.mode=m;PV.pick=null;PV.diagram=null;planSay({type:"mode",mode:m});renderPlanSide()};w.append(b)});side.append(w);
    side.append(el("div","muted small",PV.mode==="comment"?"Кликните блок или выделите слова — и напишите, что не так.":PV.mode==="edit"?"Правьте текст прямо на странице: lead получит «было → стало». Клик по схеме — правка её кода Mermaid.":W.view))}
  if(PV.version>1&&planPrev()){const l=el("label","pdiff");const cb=document.createElement("input");cb.type="checkbox";cb.checked=PV.diff;cb.onchange=()=>{PV.diff=cb.checked;planDiff()};
    l.append(cb," подсветить новое с v"+planPrev()+(PV.diff&&PV.diffCount!==null?" ("+PV.diffCount+")":""));side.append(l)}
  if(PV.pick&&can){const f=el("div","ppick");f.append(el("div","muted","к "+PV.pick.target));if(PV.pick.quote)f.append(el("div","pquote","«"+PV.pick.quote+"»"));
    const ta=document.createElement("textarea");ta.rows=3;ta.placeholder="Что поменять…";ta.value=PV.pick.text;ta.oninput=()=>{PV.pick.text=ta.value};
    const add=el("button","small","Добавить");add.type="button";add.onclick=()=>{if(!ta.value.trim())return;PV.comments.push({target:PV.pick.target,...(PV.pick.quote?{quote:PV.pick.quote}:{}),text:ta.value.trim()});PV.pick=null;planSay({type:"unpick"});renderPlanSide()};
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
      const x=el("button","ghost small","×");x.type="button";x.title="убрать";x.onclick=()=>{PV.comments=PV.comments.filter(y=>y!==c);renderPlanSide()};r.append(x);l.append(r)});side.append(l)}
  if(PV.edited&&can)side.append(el("div","note","Есть правки: они уйдут lead'у и сохранятся новой версией плана."));
  if(can&&(last&&last.stage==="input"?PV.edited:planDirty()))side.append(el("div","muted small","«"+W.approve+"» станет доступно, когда lead посмотрит ваши "+(last&&last.stage==="input"?"правки":"замечания и правки")+" и пришлёт новую версию."));
  else if(can&&last&&last.stage==="input"&&PV.comments.length)side.append(el("div","muted small","Замечания уйдут lead'у вместе с «"+W.approve+"»: он задаст по ним вопросы на допросе."));
  const fb=p?p.feedback:[];if(fb.length){const d=el("details","phist");d.append(el("summary","muted","История отзывов ("+fb.length+")"));
    fb.slice().reverse().forEach(f=>{const r=el("div","pitem");r.append(el("div","muted",time(f.at).slice(0,5)+" · v"+f.onVersion+(f.withApproval?" · с утверждением":" · раунд "+f.round)+(f.savedAs?" → правки в v"+f.savedAs:"")));
      f.comments.forEach(c=>r.append(el("div","","• "+c.target+": "+c.text)));f.edits.forEach(x=>r.append(el("div","mono",x.kind==="diagram"?"схема изменена":!x.before?"+ "+x.after:!x.after?"− "+x.before:x.before+" → "+x.after)));f.answers.forEach(a=>r.append(el("div","","? "+a.question+": "+a.value.join(", "))));d.append(r)});side.append(d)}
  // what was sent last and that the lead has it: no second send by mistake
  const sent=p?p.feedback.filter(f=>!f.withApproval).at(-1):null;
  if(sent&&latest&&live&&!p.approved&&(sent.onVersion===PV.version||sent.savedAs===PV.version)){const n=(k,a,b,c)=>k+" "+(k%10===1&&k%100!==11?a:k%10>=2&&k%10<=4&&(k%100<10||k%100>=20)?b:c);
    const what=[sent.comments.length?n(sent.comments.length,"замечание","замечания","замечаний"):"",sent.edits.length?n(sent.edits.length,"правка","правки","правок"):"",sent.answers.length?n(sent.answers.length,"ответ","ответа","ответов"):""].filter(Boolean).join(", ");
    side.append(el("div","psent","✓ Отправлено lead'у "+(t?t.agents[0]:"")+" в "+time(sent.at).slice(0,5)+(what?": "+what:"")+". "+(qs.length?"Lead ждёт вашего ответа на вопрос — он ниже.":W.sent)))}
  // the critic's risks for this version: what breaks in production if it is built as written; one click makes a risk a comment
  if(PV.critic&&PV.critic.enabled&&cur&&cur.by!=="operator"){const cr=(PV.critiques||[]).find(c=>c.version===PV.version);const box=el("div","pcritic");
    if(PV.critic.running===PV.version)box.append(el("b","","Критик читает план v"+PV.version+"…"),el("div","muted small","ищет, что сломается в проде: данные, деплой и откат, контракты, гонки, нагрузка, безопасность"));
    else if(!cr)box.append(el("div","muted small","Критик возьмёт v"+PV.version+" в работу через несколько секунд."));
    else{const head=el("div","");head.append(el("b","",cr.error?"Критик не дал списка рисков":"Критик: "+(cr.risks.length?cr.risks.length+" "+(cr.risks.length===1?"риск":cr.risks.length<5?"риска":"рисков"):"рисков не нашёл")));
      head.append(el("span","muted small"," · "+time(cr.endedAt||cr.at).slice(0,5)+(cr.model?" · "+cr.model:"")+(cr.costUsd!==undefined?" · $"+cr.costUsd:"")));box.append(head);
      if(cr.skills&&cr.skills.length){const d=el("details","small");d.append(el("summary","muted","скиллы: "+(cr.skillSets||[]).join(", ")+" ("+cr.skills.length+")"),el("div","muted",cr.skills.join(", ")));box.append(d)}
      if(cr.error)box.append(el("div","note bad",cr.error));
      PV.criticAdded=PV.criticAdded||new Set();
      cr.risks.forEach((k,i)=>{const it=el("div","prisk "+k.severity);it.append(el("span","badge "+(k.severity==="high"?"FAIL":k.severity==="medium"?"WARNING":"INFO"),k.severity==="high"?"серьёзно":k.severity==="medium"?"важно":"мелочь"),el("b",""," "+k.title));
        if(k.where)it.append(el("div","mono muted",k.where));it.append(el("div","",k.why));if(k.suggest)it.append(el("div","psug","→ "+k.suggest));
        const key=PV.version+"/"+i;
        if(can){const b=el("button","ghost small",PV.criticAdded.has(key)?"✓ в замечаниях":"В замечания");b.type="button";b.disabled=PV.criticAdded.has(key);
          b.onclick=()=>{PV.comments.push({target:"риск от критика: "+k.title+(k.where?" ("+k.where+")":""),text:k.why+(k.suggest?"\nПредложение: "+k.suggest:"")});PV.criticAdded.add(key);renderPlanSide()};it.append(b)}
        box.append(it)});
      if(can&&S.control){const again=el("button","ghost small","Покритиковать ещё раз");again.type="button";
        again.onclick=async()=>{try{await post("/api/tasks/"+encodeURIComponent(PV.taskId)+"/plan/critique",{version:PV.version});await reloadPlan(false)}catch(e){PV.error=e.message;renderPlanSide()}};box.append(again)}}
    side.append(box)}
  // the lead's open questions on this task: answered here, the same form as on top of the Tasks tab
  PV.qcards=PV.qcards||new Map();
  if(qs.length){const box=el("div","pqs");box.append(el("b","","Вопросы к вам ("+qs.length+")"));
    qs.forEach(qq=>{const key="plan/"+qq.taskId+"/"+qq.messageId;if(!PV.qcards.has(key))PV.qcards.set(key,questionCard(qq,S,key));box.append(PV.qcards.get(key))});side.append(box)}
  for(const k of [...PV.qcards.keys()])if(!qs.some(q=>"plan/"+q.taskId+"/"+q.messageId===k))PV.qcards.delete(k);
  // what the lead is doing right now: its last steps from the activity feed
  if(t&&typeof ACT!=="undefined"){const lead=t.agents[0];const steps=ACT.filter(e=>e.agentId===lead&&(!e.taskId||e.taskId===t.id)&&(e.kind==="text"||e.kind==="tool_use"||(e.kind==="tool_result"&&e.isError))).slice(-6).reverse();
    if(steps.length){const d=el("details","pact");d.open=PV.actOpen!==false;d.ontoggle=()=>{PV.actOpen=d.open};const live=t.queue==="running";
      d.append(el("summary","muted","Что делает lead "+lead+(live?" · работает":" · ждёт")));
      steps.forEach(e=>{const row=el("div","pstep"+(e.kind==="tool_result"?" err":""));row.append(el("span","muted mono",time(e.at).slice(0,5)+" "),
        e.kind==="text"?el("span","",e.summary||""):el("span","mono",(e.kind==="tool_result"?"✗ ":"")+(e.tool||"").replace(/^mcp__agent-network__/,"")+(e.summary?" — "+e.summary:"")));d.append(row)});
      side.append(d)}}
  if(PV.pending)side.append(el("div","muted small","Отправляю…"));
  if(PV.error)side.append(el("div","note bad",PV.error));
  if(PV.confirm&&can){const q=el("div","pconfirm");const a=PV.confirm.approve;
    q.append(el("div","",a?(W.ask||"Утвердить план v"+PV.version+"?"+(PV.confirm.what?" Вместе с ним lead получит ваши ответы: "+PV.confirm.what+".":"")+" Дальше lead предложит соглашение по плану."):W.send+": "+PV.confirm.what+"?"+W.sendAsk));
    const yes=el("button","small",a?W.yes:"Да, отправить");yes.type="button";yes.onclick=()=>planSend(a);
    const no=el("button","ghost small","Отмена");no.type="button";no.onclick=()=>{PV.confirm=null;renderPlanSide()};q.append(yes," ",no);foot.append(q)}
  if(can){const bar=el("div","checks pactions");const send=el("button","",PV.pending?"…":W.send);send.type="button";send.disabled=PV.pending||!PV.ready||!planHasNotes();
    if(!planHasNotes())send.title="Нечего отправлять: добавьте замечание, правку или ответ на вопрос";send.onclick=()=>planAsk(false);
    // the analysts' input page: notes are grilling questions, they go along with «Посмотрел» (only in-place edits wait for the lead)
    const viewOnly=last&&last.stage==="input";const blocked=viewOnly?PV.edited:planDirty();
    const revising=!viewOnly&&t&&t.plan&&t.plan.status==="revising";
    const ap=el("button",blocked||revising?"ghost":"",PV.pending?"…":W.approve+" v"+PV.version);ap.type="button";ap.disabled=PV.pending||!PV.ready||blocked||revising;
    if(revising)ap.title="Lead смотрит ваш отзыв: утвердите версию, которую он пришлёт (если менять нечего, он пришлёт ту же страницу с пояснением)";
    else if(planDirty())ap.title="Сначала отправьте замечания и правки lead'у: он посмотрит, доработает план и пришлёт новую версию — её и утвердите";ap.onclick=()=>planAsk(true);bar.append(send,ap);foot.append(bar)}
  if(foot.childElementCount)side.append(foot)}

// the state refresh: a new version from the lead opens by itself unless you have notes or edits in progress
function planSync(){if(!PV||!S)return;const t=S.tasks.find(x=>x.id===PV.taskId);if(!t||!t.plan||!PV.plan)return;
  const known=PV.plan.versions.at(-1);const newer=t.plan.version&&(!known||t.plan.version>known.n);const approved=!!t.plan.approvedVersion!==!!PV.plan.approved;
  const cur=PV.plan.versions.find(v=>v.n===PV.version);const waitCritic=PV.critic&&PV.critic.enabled&&cur&&cur.by!=="operator"&&!(PV.critiques||[]).some(c=>c.version===PV.version);
  if(PV.pending||(!newer&&!approved)){if(!PV.el.side.contains(document.activeElement)){if(waitCritic)reloadPlan(false);else renderPlanSide()}return}
  if(planDirty()){if(!PV.told){PV.told=true;toast("ok","Lead прислал v"+t.plan.version,"откройте её из списка версий, когда отправите свои замечания",PV.taskId)}reloadPlan(false);return}
  reloadPlan(true)}
const unblockState=new Map();
function renderBlocked(t){
  const box=el("div","blocked");box.append(badge("BLOCKED")," "+(t.blockedReason||"лимит раундов исправлений исчерпан"));
  if(!controlMode){box.append(el("span","muted"," — нужен оператор: task unblock / task cancel"));return box}
  const key=route.project+"/"+t.id;const st=unblockState.get(key)||{};
  const act=async(what,body,question)=>{if(!await ask(question))return;unblockState.set(key,{pending:true});render();
    try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/"+what,body);unblockState.delete(key)}catch(e){unblockState.set(key,{error:e.message})}await tick()};
  if(t.blockedBy==="runner"){
    box.append(el("div","","Сессии агента подряд заканчивались, не доделав его часть, и runner сдался — без него остальные ждали бы вечно. Посмотрите лог runner'а на вкладке «Runner'ы» (причина обычно там), поправьте и попробуйте снова: runner начнёт с новой сессии."));
    const r=el("div","checks");const again=el("button","","Попробовать снова");again.type="button";again.disabled=!!st.pending;
    again.onclick=()=>act("unblock",{rounds:1},t.id+": вернуть задачу в работу? Runner, который сдался, начнёт заново.");r.append(again);
    const c=el("button","ghost","Отменить задачу");c.type="button";c.disabled=!!st.pending;
    c.onclick=()=>act("cancel",{reason:"cancelled on the page (a runner gave up)"},t.id+": отменить задачу? Агенты перейдут к следующей.");r.append(c);
    box.append(r);if(st.error)box.append(el("pre","log err",st.error));
    return box;
  }
  if(t.blockedBy==="cost"){
    const spent=t.stats&&t.stats.costUsd!==null?t.stats.costUsd:null;
    box.append(el("div","","Задача потратила "+(spent!==null?fmtUsd(spent,t.stats.costEstimated):"?")+" при лимите $"+t.maxCostUsd+". Агенты остановились; надзор такие решения не принимает."));
    const r=el("div","checks");r.append(el("span","muted",st.pending?"выполняю…":"Добавить к лимиту:"));
    [2,5,10].forEach(n=>{const b=el("button","ghost","+$"+n);b.type="button";b.disabled=!!st.pending;
      b.onclick=()=>act("unblock",{usd:n},t.id+": поднять лимит до $"+(Math.round((t.maxCostUsd+n)*100)/100)+"? Агенты продолжат с того места, где остановились.");r.append(b)});
    const c=el("button","ghost","Отменить задачу");c.type="button";c.disabled=!!st.pending;
    c.onclick=()=>act("cancel",{reason:"cancelled on the page (cost limit)"},t.id+": отменить задачу? Агенты перейдут к следующей.");r.append(c);
    box.append(r);if(st.error)box.append(el("pre","log err",st.error));
    return box;
  }
  const h=t.handover;
  if(h)box.append(el("div","","Если вы не решите до "+time(h.dueAt)+", исправление "+h.from.join(", ")+" возьмёт lead "+h.lead+": один раунд, с их находками и файлами. Не справится и он — задача останется BLOCKED."));
  const r=el("div","checks");r.append(el("span","muted",st.pending?"выполняю…":"Ещё раундов исправлений:"));
  [1,2,3].forEach(n=>{const b=el("button","ghost","+"+n);b.type="button";b.disabled=!!st.pending;
    b.onclick=()=>act("unblock",{rounds:n},t.id+": дать ещё "+n+" раунд(а) исправлений? Задача вернётся в работу, отложенное исправление начнётся сразу.");r.append(b)});
  if(h){const b=el("button","ghost","Отдать lead'у сейчас");b.type="button";b.disabled=!!st.pending;
    b.onclick=()=>act("handover",{},t.id+": "+h.lead+" (lead) берёт исправление "+h.from.join(", ")+" сейчас, их файлы на этот раунд переходят к нему?");r.append(b)}
  const c=el("button","ghost","Отменить задачу");c.type="button";c.disabled=!!st.pending;
  c.onclick=()=>act("cancel",{reason:"cancelled on the page"},t.id+": отменить задачу? Агенты перейдут к следующей.");r.append(c);
  box.append(r);if(st.error)box.append(el("pre","log err",st.error));
  box.append(el("div","muted","Раунд — ещё один цикл исправлений и ревью (IMPLEMENT → SYNC)."));
  return box;
}
function renderStats(t){
  const box=el("div","");const st=t.stats;
  if(!st){box.append(el("div","stats","статистика: нет данных (задача создана до учёта времени)"));return box}
  const line=el("div","stats");const item=(label,value)=>{const s=el("span","");s.append(label+" ",el("b","",value));line.append(s)};
  item(st.finishedAt?"время":"идёт",fmtMs(st.elapsedMs));
  st.phases.forEach(p=>item(p.phase,fmtMs(p.ms)));
  if(st.usage)item("токены",fmtTok(st.usage.total)+" (вход "+fmtTok(st.usage.input)+", выход "+fmtTok(st.usage.output)+(st.usage.cacheRead?", из кэша "+fmtTok(st.usage.cacheRead):"")+")");
  else if(st.countedIn.length)item("токены","учтены в "+st.countedIn.join(", ")+" (та же сессия)");
  else item("токены",st.sessions?"нет данных (CLI без JSON-вывода)":"нет данных (не через runner)");
  if(st.costUsd!==null)item("стоимость",fmtUsd(st.costUsd,st.costEstimated)+(t.maxCostUsd?" из $"+t.maxCostUsd:"")+(st.costEstimated?" (по ценам из runners.json)":"")+(st.jobsCostUsd||st.criticCostUsd?" — в т.ч. "+[st.jobsCostUsd?"поручения "+fmtUsd(st.jobsCostUsd):"",st.criticCostUsd?"критик плана "+fmtUsd(st.criticCostUsd):""].filter(Boolean).join(", "):""));
  else if(t.maxCostUsd)item("лимит","$"+t.maxCostUsd);
  if(st.unpricedModels&&st.unpricedModels.length)item("нет цены для",st.unpricedModels.join(", ")+" — добавьте в \"prices\" в runners.json");
  if(st.sessions)item("сессий",String(st.sessions)+(st.sessionsWithoutUsage&&st.usage?" ("+st.sessionsWithoutUsage+" без токенов)":""));
  box.append(line);
  if(t.maxCostUsd&&st.costUsd!==null){const pct=Math.min(100,st.costUsd/t.maxCostUsd*100);const bar=el("div","costbar"+(pct>=100?" over":pct>=80?" near":""));const f=el("i","");f.style.width=pct+"%";bar.append(f);bar.title=fmtUsd(st.costUsd,st.costEstimated)+" из $"+t.maxCostUsd;box.append(bar)}
  if(st.agents.length){const d=el("details");d.append(el("summary","","Статистика по агентам"));const tb=el("table");tb.append(head(["Агент","Модель","Сессий","Время сессий","Токены","Вход / выход","Стоимость"]));
    st.agents.forEach(a=>tb.append(row([a.agentId,a.models&&a.models.length?a.models.join(", "):"—",String(a.sessions),fmtMs(a.ms),a.usage?fmtTok(a.usage.total):"—",a.usage?fmtTok(a.usage.input)+" / "+fmtTok(a.usage.output):"—",a.costUsd!==null?fmtUsd(a.costUsd,a.costEstimated):"—"])));
    d.append(tb);box.append(d)}
  return box;
}
/** Text that may be long: in full when short, else a preview that opens on click (the open state survives the refresh by its key). */
function longText(text,key,limit){text=text||"";if(text.length<=limit)return el("div","txt",text);
  const d=el("details","more");d.dataset.key=key;const sm=el("summary");sm.append(el("span","pv",text.slice(0,limit).replace(/\s+\S*$/,"")+"… "),el("span","tg"));d.append(sm,el("div","txt full",text));return d}
function renderTask(t){
  const c=el("div","card task"+(t.status!=="ACTIVE"&&t.status!=="BLOCKED"?" done":""));
  const hd=el("div");const h3=el("h3","",t.id+" · "+t.title);
  // on the press, not the click: the list is rebuilt every refresh, and a title replaced between press and release takes no click
  if(route.task!==t.id){h3.classList.add("link");h3.title="открыть задачу отдельно";h3.onmousedown=e=>{if(e.button===0&&!e.shiftKey&&!e.metaKey&&!e.ctrlKey)openTask(t.id)}}const sch=scheduleOf(t);if(sch)h3.append(badge("","по расписанию "+sch));h3.append(badge(t.queue,QUEUE[t.queue]||t.queue));if(t.openspec)h3.append(badge("","OpenSpec"));hd.append(h3);hd.append(el("div","muted",t.description));
  const chain=[];if(t.parentTaskId)chain.push("follow-up от "+t.parentTaskId);if(t.followUps&&t.followUps.length)chain.push("follow-up задачи: "+t.followUps.join(", "));if(t.followUpBudget)chain.push("бюджет follow-up: "+t.followUpBudget.used+"/"+t.followUpBudget.max);
  if(chain.length)hd.append(el("div","muted",chain.join(" · ")));
  if(t.openspec)hd.append(renderOpenspec(t));
  if(t.proposes)hd.append(renderProposes(t));
  if(t.plan)hd.append(renderPlan(t));
  if(t.contract||(controlMode&&t.status==="ACTIVE"&&t.phase==="DISCUSS"&&!t.proposes&&!t.openspec))hd.append(renderContract(t,controlMode));
  if(t.jobOf)hd.append(el("div","muted","Поручение от "+t.jobOf.taskId+" (lead "+t.jobOf.by+", его подзадача "+t.jobOf.subtask+"): один агент, без ревью; результат уходит lead'у."));
  {const jobs=(S.tasks||[]).filter(x=>x.jobOf&&x.jobOf.taskId===t.id);if(jobs.length){const box=el("div","openspec");box.append(el("b","","Поручения ("+jobs.length+")"));
    jobs.forEach(j=>{const r=el("div","srow2");r.append(badge(j.status==="COMPLETED"?"PASS":j.status==="CANCELLED"?"INFO":j.status==="BLOCKED"?"FAIL":"WAITING",j.status==="COMPLETED"?"готово":j.status==="CANCELLED"?"отменено":j.status==="BLOCKED"?"BLOCKED":"в работе"),el("span","mono"," "+j.id+" · "+j.agents[0]),el("span",""," "+j.title.replace(/^task-\d+ job: /,"")));
      const im=(j.implementations||[]).find(i=>i.agentId===j.agents[0]);if(im&&im.summary)r.append(el("div","muted why","итог: "+im.summary));box.append(r)});hd.append(box)}}
  if(t.status==="COMPLETED"&&!t.jobOf&&!t.proposes)hd.append(renderAcceptance(t));
  if(t.status!=="CANCELLED"&&controlMode&&S.control.worktrees&&S.control.worktrees.length)hd.append(renderBranch(t));
  hd.append(renderStats(t));
  if(controlMode&&(t.status==="COMPLETED"||t.status==="CANCELLED"))hd.append(renderDelete(t));
  if(t.status==="BLOCKED")hd.append(renderBlocked(t));
  if(t.takeover&&t.status!=="BLOCKED")hd.append(el("div","muted","Lead взял исправление "+t.takeover.from.join(", ")+" в раунде "+t.takeover.round+" ("+(t.takeover.by==="timeout"?"оператор не ответил вовремя":"передал оператор")+")."));
  c.append(hd);
  if(t.stats)c.append(phaseBar(t));
  else{const steps=el("div","steps");const idx=PHASES.indexOf(t.phase);
    PHASES.forEach((p,i)=>steps.append(el("div","step"+(i<idx?" past":i===idx?" now":""),p+(p==="SYNC"&&t.syncRound&&idx>=2?" #"+t.syncRound:""))));
    c.append(steps)}
  if(t.status==="ACTIVE"||t.status==="BLOCKED")c.append(progressBlock(t));
  if(S.control&&(t.status==="ACTIVE"||t.status==="BLOCKED"))c.append(renderCompose(t));
  if(t.spawned&&t.spawned.length)c.append(renderSpawned(t));
  if(t.review&&t.review.length)c.append(renderReview(t));
  if(t.waitingOn.length){const w=el("div","chips");w.append(el("span","muted","ждём:"));t.waitingOn.forEach(x=>w.append(el("span","chip",x)));c.append(w)}
  // one card per agent: who, statuses at a glance, its part and its plan side by side, its report and the review short (full on click)
  const cards=el("div","acards");const lead=t.agents[0];const rs=S.control?S.control.runners:[];
  for(const id of t.agents){
    const card=el("div","acard");const hd=el("div","ah");
    const as=t.agreement&&t.agreement.assignments.find(a=>a.agentId===id);const ap=t.agreement&&t.agreement.approvedBy.includes(id);
    const im=t.implementations.find(i=>i.agentId===id);const rep=t.syncReports.filter(x=>x.agentId===id&&x.round===t.syncRound).pop();
    const subs=(t.subtasks&&t.subtasks[id])||[];const live=subs.filter(x=>x.status!=="DROPPED");const r=rs.find(x=>x.id===id);
    const model=r&&r.model||(t.stats&&(t.stats.agents.find(a=>a.agentId===id)||{models:[]}).models[0])||"";
    hd.append(el("b","",id));if(id===lead)hd.append(el("span","tag","lead"));
    const sp=(t.spawned||[]).find(x=>x.id===id);if(sp){const g=el("span","tag spawned","добавлен lead'ом · "+sp.template);g.title=sp.reason;hd.append(g)}if(model)hd.append(el("span","muted mono",model));
    if(S.control&&id===t.agents[0]&&(t.status==="ACTIVE"||t.status==="BLOCKED")){const m=el("button","mail");m.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';m.type="button";m.title="написать lead'у "+id+": он передаст остальным";m.setAttribute("aria-label",m.title);
      m.onclick=()=>{const key=route.project+"/"+t.id;composeOpen.add(key);render();const ta=document.querySelector('[data-compose="'+key+'"] textarea');if(ta){ta.scrollIntoView({block:"center",behavior:"smooth"});ta.focus({preventScroll:true})}};hd.append(m)}
    const st=el("span","stats2");
    if(t.agreement)st.append(badge(ap?"PASS":"WAITING",ap?"agreement ✓":"agreement ждёт"));
    if(live.length)st.append(el("span","chip",live.filter(x=>x.status==="DONE").length+"/"+live.length+" подзадач"));
    st.append(im?badge(im.status):badge("","не сдавал"));
    if(rep)st.append(badge(rep.status,"ревью #"+t.syncRound+": "+rep.status));
    const b=t.builds&&t.builds[id];if(b){const ch=el("span","chip "+(b.ok?"bok":"bbad"),"сборка "+(b.ok?"✓":b.timedOut?"⏱":"✗")+(b.tests?" "+(b.tests.failed?b.tests.failed+"/"+b.tests.total+" упало":b.tests.total+" тестов"):"")+" · "+fmtMs(b.durationMs));ch.title=b.command+"\n"+b.logPath+"\n"+new Date(b.at).toLocaleString();st.append(ch)}
    hd.append(st);card.append(hd);
    const grid=el("div","ag");const left=el("div");left.append(el("div","lbl","Задача"),longText(as?as.responsibility:"—","resp-"+id,240));
    if(as&&as.files&&as.files.length){const fd=el("details","files");fd.dataset.key="files-"+id;fd.append(el("summary","muted","файлы ("+as.files.length+")"),el("div","muted mono",as.files.join(", ")));left.append(fd)}
    if(as&&as.dependsOn&&as.dependsOn.length)left.append(el("div","muted","сдаёт после: "+as.dependsOn.join(", ")+" (dependsOn)"));
    const right=el("div","sub");right.append(el("div","lbl","Подзадачи"+(subs.find(x=>x.status==="DOING")?" · ▶ "+subs.find(x=>x.status==="DOING").id:"")));
    if(!subs.length)right.append(el("span","muted","—"));
    else{const sl=el("div","scroll subs");sl.dataset.scroll="subs-"+id; // a long plan scrolls in its own box, opened at the step in progress
      const icon={DONE:"✓",DOING:"▶",TODO:"·",DROPPED:"✕"};subs.forEach(x=>{const d=el("div",x.status,icon[x.status]+" "+x.id+" "+x.title);if(x.note)d.title=x.note;sl.append(d)});right.append(sl)}
    grid.append(left,right);card.append(grid);
    if(im&&(im.summary||im.filesChanged.length)){const sec=el("div","asec");sec.append(el("div","lbl","Итог агента"));if(im.summary)sec.append(longText(im.summary,"impl-"+id,280));
      if(im.filesChanged.length){const fd=el("details","files");fd.dataset.key="changed-"+id;fd.append(el("summary","muted","изменённые файлы ("+im.filesChanged.length+")"),el("div","muted mono",im.filesChanged.join(", ")));sec.append(fd)}card.append(sec)}
    if(rep&&rep.findings.length){const sec=el("div","asec");sec.append(el("div","lbl","Ревью раунда "+t.syncRound));
      rep.findings.forEach((f,i)=>{const row=el("div","find");row.append(el("span","badge "+f.severity,f.severity),longText(f.description+(f.relatedAgent?" → "+f.relatedAgent:""),"find-"+id+"-"+i,200));sec.append(row)});card.append(sec)}
    cards.append(card);
  }
  c.append(cards);
  t.integrations.filter(x=>x.round===t.syncRound).slice(-1).forEach(x=>{const d=el("div","acard icard");const hd=el("div","ah");hd.append(el("b","","Интеграция"),el("span","muted",x.agentId),el("span","stats2"));hd.lastChild.append(badge(x.status));d.append(hd);
    d.append(longText(x.result,"integ",360));if(x.commits.length)d.append(el("div","muted mono","commits: "+x.commits.join(", ")));
    x.findings.forEach((f,i)=>{const row=el("div","find");row.append(el("span","badge "+f.severity,f.severity),longText(f.description+(f.relatedAgent?" → "+f.relatedAgent:""),"ifind-"+i,200));d.append(row)});c.append(d)});
  if(t.agreement){const d=el("details");d.append(el("summary","","Agreement v"+t.agreement.version+" — "+t.agreement.summary));
    t.agreement.assignments.forEach(a=>d.append(el("div","",a.agentId+": "+a.responsibility)));
    t.grants.forEach(g=>d.append(el("div","muted mono","доступ: "+g.from+" → "+g.to+": "+g.files.join(", "))));
    if(t.agreement.decisions.length)d.append(el("div","muted","решения: "+t.agreement.decisions.join("; ")));
    if(t.agreement.interfaces.length)d.append(el("div","muted mono","interfaces: "+t.agreement.interfaces.join("; ")));c.append(d)}
  const md=el("details");md.append(el("summary","","Сообщения ("+count(t.messages.length,t.messagesTotal)+")"));const ml=scrollBox(md,"msgs");
  t.messages.forEach(m=>{const r=el("div","msg");r.append(el("span","muted mono",time(m.createdAt)+" "),el("b","",m.from+" → "+m.to+": "),el("span","",m.content),m.readAt?el("span","muted"," ✓"):el("span","muted"," •"));ml.append(r)});c.append(md);
  const ed=el("details");ed.append(el("summary","","События ("+count(t.events.length,t.eventsTotal)+")"));const el2=scrollBox(ed,"events");
  t.events.slice().reverse().forEach(e=>{const r=el("div","msg mono");r.textContent=time(e.createdAt)+"  "+e.type+(e.sourceAgent?"  от "+e.sourceAgent:"")+(e.targetAgent?"  → "+e.targetAgent:"");el2.append(r)});c.append(ed);
  return c;
}
function count(shown,total){return total>shown?"последние "+shown+" из "+total:String(shown)}
/** A list that scrolls inside its details instead of stretching the page: messages open at the newest (bottom), events (newest first) at the top. */
function scrollBox(details,kind){const box=el("div","scroll");box.dataset.scroll=kind;details.append(box);
  details.addEventListener("toggle",()=>{if(!details.open)return;if(box.dataset.top!==undefined)box.scrollTop=+box.dataset.top;else if(kind==="msgs")box.scrollTop=box.scrollHeight});return box}
const openDetails=new Set();
/** Tasks the page creates on a cron (runners.json "schedules"): on/off, when next, what the last run did, run now. */
const schedState=new Map();
// the schedule form: built once when opened and kept as it is while the list refreshes (what you typed stays)
let schedForm=null;
function openScheduleForm(x){
  const s=S;const ids=s.control?s.control.runners.map(r=>r.id):[];const c=x?x.config:{enabled:true,agents:ids.slice(0,2)};
  const f=document.createElement("form");f.className="card sform";f.noValidate=true;
  const field=(label,name,value,attrs)=>{const l=el("label","",label);const i=document.createElement(attrs&&attrs.tag||"input");i.name=name;if(value!==undefined&&value!==null)i.value=String(value);Object.entries(attrs||{}).forEach(([k,v])=>{if(k!=="tag")i.setAttribute(k,v)});l.append(i);return l};
  f.append(el("b","",x?"Расписание "+x.id:"Новое расписание"));
  const r1=el("div","row");r1.append(field("id (латиница, цифры, -)","id",c.id,{placeholder:"nightly-flaky-tests",required:""}),field("cron (местное время)","cron",c.cron||"0 3 * * 1-5",{placeholder:"0 3 * * 1-5 или @daily"}));f.append(r1);
  const prev=el("div","note","");f.append(prev);
  f.append(field("Название задачи ({date}, {time} подставятся)","title",c.title,{placeholder:"Flaky tests {date}"}),field("Описание — что сделать, кто что делает","description",c.description,{tag:"textarea"}));
  const ag=el("div","row");const lead=document.createElement("select");lead.name="lead";ids.forEach(id=>lead.append(new Option(id,id)));if(c.agents&&c.agents[0])lead.value=c.agents[0];
  const ll=el("label","","Lead (интегрирует)");ll.append(lead);const ol=el("label","","Остальные агенты");const others=el("div","checks");ol.append(others);
  const drawOthers=()=>{const keep=new Set([...others.querySelectorAll("input:checked")].map(i=>i.value));const first=!others.children.length;others.replaceChildren();
    ids.forEach(id=>{const l=el("label","");l.style.display="inline-flex";l.style.gap="4px";const i=document.createElement("input");i.type="checkbox";i.value=id;i.checked=id!==lead.value&&(first?(c.agents||[]).slice(1).includes(id):keep.has(id));i.disabled=id===lead.value;l.append(i,id);others.append(l)})};
  lead.onchange=drawOthers;drawOthers();ag.append(ll,ol);f.append(ag);
  const r2=el("div","row");r2.append(field("Сборка и тесты (verifyCommand)","verifyCommand",c.verifyCommand,{placeholder:s.control&&s.control.verifyCommand?"по умолчанию "+s.control.verifyCommand:"без проверки сборки"}),field("Раундов исправлений","maxFixRounds",c.maxFixRounds,{type:"number",min:"0",max:"20",placeholder:"3"}),field("Лимит стоимости, $","maxCostUsd",c.maxCostUsd,{type:"number",min:"0",step:"0.5",placeholder:s.control&&s.control.maxTaskCostUsd?"по умолчанию $"+s.control.maxTaskCostUsd:"без лимита"}));f.append(r2);
  const en=el("label","");en.style.display="inline-flex";en.style.gap="6px";const ei=document.createElement("input");ei.type="checkbox";ei.name="enabled";ei.checked=c.enabled!==false;en.append(ei,"включено");
  const note=el("span","note","");const save=el("button","",x?"Сохранить":"Добавить");save.type="submit";const cancel=el("button","ghost","Отмена");cancel.type="button";
  cancel.onclick=()=>{schedForm=null;$("schedules").dataset.sig="";render()};
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
    try{await post(x?"/api/schedules/"+encodeURIComponent(x.id)+"/update":"/api/schedules",{schedule});schedForm=null;$("schedules").dataset.sig="";await tick()}
    catch(e){note.className="note bad";note.textContent=e.message;save.disabled=false}};
  schedForm={el:f,id:x?x.id:null};$("schedules").dataset.sig="";render();setTimeout(()=>f.elements.namedItem(x?"title":"id").focus(),0);
}
function renderSchedules(s){
  const box=$("schedules");const list=s.schedules||[];box.hidden=!list.length&&!(s.control&&s.schedules);if(box.hidden){box.replaceChildren();return}
  const sig=JSON.stringify(list)+"|"+Math.floor(Date.now()/60000)+"|"+JSON.stringify([...schedState])+"|"+!!s.control+"|"+(schedForm?schedForm.id||"new":"");if(box.dataset.sig===sig)return;box.dataset.sig=sig;
  const ph=el("div","ph","По расписанию");ph.append(el("span","end","задача не ставится, пока предыдущая из того же расписания открыта"));
  if(s.control&&!schedForm){const add=el("button","ghost small","+ Расписание");add.type="button";add.onclick=()=>openScheduleForm(null);ph.append(add)}
  const rows=list.map(x=>{const r=el("div","srow"+(x.enabled?"":" off"));
    const sw=document.createElement("input");sw.type="checkbox";sw.checked=x.enabled;sw.disabled=!s.control;sw.title=x.enabled?"выключить":"включить";
    sw.onchange=async()=>{sw.disabled=true;try{await post("/api/schedules/"+encodeURIComponent(x.id)+"/enabled",{enabled:sw.checked});await tick()}catch(e){alert(e.message);sw.checked=!sw.checked;sw.disabled=false}};
    const nm=el("div","nm");nm.append(el("b","",x.title),el("span","",x.id+" · "+x.agents.join(", ")+(x.openspec?" · OpenSpec "+x.openspec:"")));
    const nx=el("div","nx");if(x.nextRunAt){const d=new Date(x.nextRunAt);const same=d.toDateString()===new Date().toDateString();nx.append(el("div","",(same?"":d.toLocaleDateString([],{day:"numeric",month:"short"})+" ")+time(x.nextRunAt).slice(0,5)),el("div","sub2","через "+mins(Math.max(0,d-Date.now()))))}else nx.append(el("span","muted",x.enabled?"не наступит":"выключено"));
    const run=x.runs[0];const st=schedState.get(x.id);
    const last=el("div","last"+(run&&run.error?" err":run&&run.skipped?" skip":""),!run?"ещё не запускалось":run.taskId?time(run.at).slice(0,5)+" → "+run.taskId+(x.openTask===run.taskId?" (идёт)":""):run.skipped?time(run.at).slice(0,5)+" пропуск: "+run.skipped:time(run.at).slice(0,5)+" ошибка: "+run.error);
    if(st&&st.note)last.append(el("div","sub2",st.note));
    const b=el("button","ghost",st&&st.pending?"Ставлю…":"Запустить сейчас");b.type="button";b.disabled=!s.control||!!(st&&st.pending);b.title=x.openTask?"пропустится: "+x.openTask+" ещё открыта":"поставить задачу сейчас";
    b.onclick=async()=>{schedState.set(x.id,{pending:true});render();
      try{const j=await post("/api/schedules/"+encodeURIComponent(x.id)+"/run",{});schedState.set(x.id,{note:j.run.taskId?"создана "+j.run.taskId:j.run.skipped?"пропуск: "+j.run.skipped:"ошибка: "+j.run.error})}catch(e){schedState.set(x.id,{note:"ошибка: "+e.message})}await tick()};
    const acts=el("div","sacts");acts.append(b);
    if(s.control){const ed=el("button","ghost","Изменить");ed.type="button";ed.disabled=!!schedForm;ed.onclick=()=>openScheduleForm(x);
      const del=el("button","ghost","Удалить");del.type="button";del.disabled=!!schedForm;
      del.onclick=async()=>{if(!await ask("Удалить расписание "+x.id+" из runners.json? Уже созданные им задачи останутся."))return;try{await post("/api/schedules/"+encodeURIComponent(x.id)+"/delete",{});box.dataset.sig="";await tick()}catch(e){alert(e.message)}};acts.append(ed,del)}
    r.append(sw,nm,el("div","cr",x.cron),nx,last,acts);return r});
  const empty=!list.length?[el("div","muted spad","Расписаний нет. «+ Расписание» — задача по cron: например, каждую ночь искать и чинить нестабильные тесты.")]:[];
  box.replaceChildren(ph,...(schedForm?[schedForm.el]:[]),...empty,...rows)}
function scheduleOf(t){for(const x of (S.schedules||[]))if(x.runs.some(r=>r.taskId===t.id))return x.id;return null}
function renderTasks(){
  renderSchedules(S);
  if(document.activeElement&&document.activeElement.matches&&document.activeElement.matches("#tasks .compose textarea, #tasks .dcomment textarea"))return; // you are writing to a lead: the refresh waits
  const s=S;$("newbtn").hidden=!s.control;if(!s.control)$("newtask").hidden=true;
  $("tasks-lead").textContent="Текущие и завершённые задачи проекта "+s.project.name+"."+(s.control?"":" Только чтение: чтобы ставить задачи, запустите UI с --runners.");
  updateForm(s);
  const box=$("tasks");
  // the cards are rebuilt on every refresh: keep which details are open and where their lists are scrolled
  if(box.querySelector("[data-id]")){openDetails.clear();box.querySelectorAll("details[open]").forEach(d=>{const card=d.closest("[data-id]");if(card)openDetails.add(card.dataset.id+"|"+(d.dataset.key||d.firstChild.textContent.split(" ")[0]))})}
  const scrolls=new Map();box.querySelectorAll("[data-scroll]").forEach(b=>{if(b.closest("details:not([open])"))return;const card=b.closest("[data-id]");if(card)scrolls.set(card.dataset.id+"|"+b.dataset.scroll,{top:b.scrollTop,atEnd:b.scrollTop+b.clientHeight>=b.scrollHeight-8})});
  // build every card first and swap them in at once: measuring a half-built list would shrink the page and reset its scroll
  // what goes on first, then what is stuck, what waits, what is over; within each the newest on top; one task alone when opened
  const RANK={running:0,blocked:1,queued:2,done:3,cancelled:4};
  const one=route.task;$("taskback").hidden=!one;$("taskback-id").textContent=one?one:"";
  const newest=s.tasks.filter(t=>!one||t.id===one).sort((a,b)=>(RANK[a.queue]??5)-(RANK[b.queue]??5)||(b.createdAt||"").localeCompare(a.createdAt||"")||b.id.localeCompare(a.id,undefined,{numeric:true}));
  const cards=newest.map(t=>{const c=renderTask(t);c.dataset.id=t.id;
    c.querySelectorAll("[data-scroll]").forEach(b=>{const sv=scrolls.get(t.id+"|"+b.dataset.scroll);if(sv&&!(b.dataset.scroll==="msgs"&&sv.atEnd))b.dataset.top=String(sv.top)}); // at the bottom of messages: stay at the newest
    c.querySelectorAll("details").forEach(d=>{if(openDetails.has(t.id+"|"+(d.dataset.key||d.firstChild.textContent.split(" ")[0])))d.open=true});return c});
  box.replaceChildren(...(cards.length?cards:[el("div","empty",one?"Задачи "+one+" нет на странице (удалена или в другом проекте).":s.control?"Задач нет. Нажмите «+ Новая задача».":"Задач нет. Создайте: agent-network-mcp task create --title … --agents a,b")]));
  cards.forEach(c=>c.querySelectorAll("[data-scroll]").forEach(b=>{if(b.closest("details"))return;const sv=scrolls.get(c.dataset.id+"|"+b.dataset.scroll);
    if(sv)b.scrollTop=sv.top;else{const cur=b.querySelector(".DOING");if(cur)b.scrollTop+=cur.getBoundingClientRect().top-b.getBoundingClientRect().top-b.clientHeight/3}}));
}
// the config's defaults for a new task: its cost limit and its build and test command
// the contract project named in the form: checked at once — its specs and the version the service is on
async function checkContract(){const f=$("newtask");const path=f.elements.namedItem("contract").value.trim();const n=$("contractnote");if(!path){n.textContent="";return}
  n.className="muted small";n.textContent="проверяю…";
  try{const r=await fetch(q("/api/contract/inspect?path="+encodeURIComponent(path)),{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.message||r.status);n.className="muted small";n.textContent=j.groupId+":"+j.artifactId+" "+j.version+" · спецификации: "+j.specs.join(", ")}
  catch(e){n.className="small err";n.textContent="не подходит: "+e.message}}
function taskDefaults(f){const c=(S&&S.control)||{};f.elements.namedItem("maxCostUsd").value=c.maxTaskCostUsd?String(c.maxTaskCostUsd):"";f.elements.namedItem("verifyCommand").value=c.verifyCommand||""}
$("newbtn").onclick=()=>{const f=$("newtask");f.hidden=!f.hidden;if(!f.hidden){loadChanges();taskDefaults(f);f.elements.namedItem("title").focus()}};
let knownIds="";
function updateForm(s){
  const ids=[...new Set([...(s.control?s.control.runners.map(r=>r.id):[]),...s.agents.map(a=>a.id).filter(id=>id!=="operator")])];
  if(ids.join(",")!==knownIds){knownIds=ids.join(",");const lead=$("lead");const keep=lead.value;lead.replaceChildren();ids.forEach(id=>lead.append(new Option(id,id)));if(ids.includes(keep))lead.value=keep;renderOthers(ids)}
}
function renderOthers(ids){const box=$("others");const checked=new Set([...box.querySelectorAll("input:checked")].map(i=>i.value));const lead=$("lead").value;box.replaceChildren();
  ids.forEach(id=>{const l=el("label","");l.style.display="inline-flex";l.style.gap="4px";const i=document.createElement("input");i.type="checkbox";i.value=id;i.checked=checked.size?checked.has(id):id!==lead;i.disabled=id===lead;if(id===lead)i.checked=false;l.append(i,id);box.append(l)})}
$("lead").addEventListener("change",()=>renderOthers(knownIds.split(",")));
async function loadChanges(){try{const j=await getJSON(q("/api/openspec/changes"));const sel=$("openspec");const keep=sel.value;
  sel.replaceChildren(new Option("— без OpenSpec —",""),new Option("+ написать новый change…","__new__"),...j.changes.map(c=>{const o=new Option(c.name+(c.error?" (не читается: "+c.error+")":" ("+c.done+"/"+c.total+" задач отмечено)"),c.name);o.disabled=!!c.error;return o}));
  if([...sel.options].some(o=>o.value===keep))sel.value=keep;sel.title=j.changes.length?"":"в "+j.projectDir+"/openspec/changes нет change'ей"}catch(e){}}
$("openspec").addEventListener("focus",loadChanges);
$("openspec").addEventListener("change",ev=>{const f=$("newtask");const isNew=ev.target.value==="__new__";$("proposes-row").hidden=!isNew;$("from-row").hidden=!isNew;
  f.elements.namedItem("title").placeholder=isNew?"(необязательно) OpenSpec change <имя>":ev.target.value||"Отмена заказа: POST /orders/{id}/cancel";
  f.elements.namedItem("description").placeholder=isNew?"Что нужно — вашими словами: зачем, что меняется для пользователя, ограничения. Lead напишет proposal, specs, design и tasks; вопросы о решениях придут вам.":"Отменять можно NEW и PAID; при PAID писать событие OrderCancelled. backend — API и сервис, reviewer — тесты.";
  if(isNew)f.elements.namedItem("proposes").focus();checkSpecFolders()});
// presets of the preparation before the agreement: the checkboxes under "настроить вручную" follow them, a change of one makes it "своя"
const DEPTH={fast:{clarify:false,grill:false,planReview:false,note:"мелкие понятные задачи: никаких вопросов и плана"},standard:{clarify:true,grill:false,planReview:false,note:"lead задаёт вопросы или пишет, как понял задачу"},thorough:{clarify:true,grill:true,planReview:true,note:"раунды вопросов с вашим «да», план страницей на утверждение (и критик плана, если он настроен)"}};
function applyDepth(){const f=$("newtask");const d=DEPTH[f.elements.namedItem("depth").value];if(!d)return;["clarify","grill","planReview"].forEach(k=>f.elements.namedItem(k).checked=d[k]);$("depthnote").textContent=d.note}
function syncDepth(){const f=$("newtask");const cur={clarify:f.elements.namedItem("clarify").checked,grill:f.elements.namedItem("grill").checked,planReview:f.elements.namedItem("planReview").checked};
  const hit=Object.keys(DEPTH).find(k=>["clarify","grill","planReview"].every(x=>DEPTH[k][x]===cur[x]));const sel=f.elements.namedItem("depth");sel.value=hit||"custom";$("depthnote").textContent=hit?DEPTH[hit].note:"своя настройка"}
$("newtask").elements.namedItem("depth").addEventListener("change",applyDepth);
["clarify","grill","planReview"].forEach(k=>$("newtask").elements.namedItem(k).addEventListener("change",()=>setTimeout(syncDepth,0)));
applyDepth();
$("newtask").elements.namedItem("grill").addEventListener("change",e=>{if(e.target.checked)$("newtask").elements.namedItem("clarify").checked=true});
// analysts' input is grilled by default: filling the path turns the grilling on (it can be turned off again)
$("newtask").elements.namedItem("from").addEventListener("input",e=>{const f=$("newtask");if(e.target.value.trim()&&!e.target.dataset.grilled){e.target.dataset.grilled="1";f.elements.namedItem("clarify").checked=true;f.elements.namedItem("grill").checked=true;syncDepth()}if(!e.target.value.trim())delete e.target.dataset.grilled});
$("newtask").elements.namedItem("clarify").addEventListener("change",e=>{if(!e.target.checked)$("newtask").elements.namedItem("grill").checked=false});
$("newtask").addEventListener("submit",async ev=>{ev.preventDefault();const f=ev.target;const note=$("formnote");const btn=f.querySelector("button");
  const others=[...$("others").querySelectorAll("input:checked")].map(i=>i.value);const v=n=>f.elements.namedItem(n);
  if(!v("openspec").value&&(!v("title").value.trim()||!v("description").value.trim())){note.className="note err";note.textContent="Нужны название и описание (или выберите OpenSpec change).";return}
  btn.disabled=true;note.className="note";note.textContent="создаю…";
  try{const r=await post("/api/tasks",{title:v("title").value,description:v("description").value,agents:[v("lead").value,...others],verifyCommand:v("verifyCommand").value,maxFollowUps:v("maxFollowUps").value,maxFixRounds:v("maxFixRounds").value,maxCostUsd:v("maxCostUsd").value,...(v("contract").value.trim()?{contract:v("contract").value.trim()}:{}),clarify:v("clarify").checked||v("grill").checked,grill:v("grill").checked,allowSpawn:v("allowSpawn").checked,planReview:v("planReview").checked&&v("openspec").value!=="__new__",...(v("openspec").value==="__new__"?{proposes:v("proposes").value,from:v("from").value.split("\n").map(x=>x.trim()).filter(Boolean)}:{openspec:v("openspec").value})});
    note.className="note ok";note.textContent="Создана "+r.task.id+": "+r.task.title+". Runner'ы подхватят её за пару секунд.";v("title").value="";v("description").value="";v("contract").value="";$("contractnote").textContent="";v("openspec").value="";v("proposes").value="";v("from").value="";delete v("from").dataset.grilled;$("proposes-row").hidden=true;$("from-row").hidden=true;await tick()}
  catch(e){note.className="note err";note.textContent=e.message}finally{btn.disabled=false}});

/* ---------- the task drafted by an agent: the idea → the form, with why and the open questions ---------- */
let DRAFT=null;let draftPoll=null;
const DRAFT_FIELD={title:"название",description:"описание",agents:"команда",lead:"lead",depth:"подготовка",verifyCommand:"сборка",contract:"контракт",openspec:"OpenSpec change"};
function draftShow(){const box=$("draftbox");box.hidden=!(S&&S.control&&S.control.drafter);if(box.hidden)return;
  const d=DRAFT;const st=$("draftstate");const go=$("draftgo");const stop=$("draftstop");
  go.disabled=!!(d&&d.status==="running");stop.hidden=!(d&&d.status==="running");
  st.textContent=!d?"модель "+(S.control.drafter.model||"по команде"):d.status==="running"?"агент изучает проект…":d.status==="done"?"готово — проверьте поля и создайте задачу"+(d.costUsd!==undefined?" · $"+d.costUsd:""):d.status==="stopped"?"остановлено":"не вышло: "+(d.error||"");
  const why=$("draftwhy");why.replaceChildren();why.hidden=!(d&&d.status==="done"&&d.result);if(why.hidden)return;const r=d.result;
  const w=Object.entries(r.why||{});if(w.length){why.append(el("b","","Почему так"));const ul=el("ul","");w.forEach(([k,v])=>ul.append(el("li","",(DRAFT_FIELD[k]||k)+": "+v)));why.append(ul)}
  if(r.dropped&&r.dropped.length){const ul=el("ul","");r.dropped.forEach(x=>ul.append(el("li","err",(DRAFT_FIELD[x.field]||x.field)+" не подставлено: "+x.reason)));why.append(el("b","","Что не подошло"),ul)}
  if(r.questions&&r.questions.length){why.append(el("b","","Открытые вопросы — решите их правкой описания"));const ul=el("ul","");r.questions.forEach(q=>{const li=el("li","",q.question);if(q.options&&q.options.length)li.append(el("div","muted","варианты: "+q.options.join(" · ")+(q.recommended?" — агент советует «"+q.recommended+"»":"")));ul.append(li)});why.append(ul)}}
// the checked draft into the form: only the fields the server took; the rest stays as it was
function draftFill(r){const f=$("newtask");const set=(n,v)=>{if(v!==undefined&&v!==null){f.elements.namedItem(n).value=v}};
  set("title",r.title);set("description",r.description);set("verifyCommand",r.verifyCommand);
  if(r.depth){set("depth",r.depth);applyDepth()}
  if(r.lead){const lead=$("lead");lead.value=r.lead;lead.dispatchEvent(new Event("change"))}
  if(r.agents)setTimeout(()=>{$("others").querySelectorAll("input").forEach(i=>{i.checked=r.agents.includes(i.value)})},0);
  if(r.contract){set("contract",r.contract);checkContract()}
  if(r.openspec){const sel=$("openspec");sel.value=r.openspec;sel.dispatchEvent(new Event("change"))}}
async function draftWatch(id){clearTimeout(draftPoll);try{const j=await getJSON(q("/api/drafts/"+id));DRAFT=j.draft}catch(e){}
  if(DRAFT&&DRAFT.status==="running"){draftPoll=setTimeout(()=>draftWatch(id),2000)}else if(DRAFT&&DRAFT.status==="done"&&DRAFT.result&&!DRAFT.filled){DRAFT.filled=true;draftFill(DRAFT.result)}draftShow()}
$("draftgo").onclick=async()=>{const text=$("draftidea").value.trim();if(!text){$("draftstate").textContent="напишите идею хотя бы парой слов";return}
  try{const r=await post("/api/drafts",{text});DRAFT=r.draft;draftShow();draftWatch(r.draft.id)}catch(e){$("draftstate").textContent=e.message}};
$("draftstop").onclick=async()=>{if(!DRAFT)return;try{const r=await post("/api/drafts/"+DRAFT.id+"/stop",{});DRAFT=r.draft}catch(e){}draftShow()};

/* ---------- runs ---------- */
function fillSelect(id,label,values,fmt){const sel=$(id);const keep=sel.value;const sig=values.join("|");if(sel.dataset.sig===sig)return;sel.dataset.sig=sig;
  sel.replaceChildren(new Option(label,""),...values.map(v=>new Option(fmt?fmt(v):v,v)));if(values.includes(keep))sel.value=keep}
["f-agent","f-task","f-model","f-status","e-task","e-type"].forEach(id=>$(id).addEventListener("change",render));
const STATUS={running:"идёт",ok:"ок",turns:"лимит ходов",stopped:"остановлена",failed:"ошибка"};
const ENDED={"task-done":"задача готова",parked:"запаркована",handoff:"передана свежей сессии","turn-limit":"лимит ходов","context-limit":"большой контекст",blocked:"задача BLOCKED",interrupted:"срочное сообщение",ended:"завершилась",failed:"ошибка"};
const expandedRuns=new Set();
const runKey=r=>r.id?r.taskId+"/"+r.id:"live/"+r.agentId;
function renderRuns(){
  const uniq=f=>[...new Set(RUNS.flatMap(f).filter(Boolean))].sort();
  fillSelect("f-agent","Все агенты",uniq(r=>[r.agentId]));fillSelect("f-task","Все задачи",uniq(r=>[r.taskId,...r.alsoFinished.map(x=>x.id)]));fillSelect("f-model","Все модели",uniq(r=>[r.model]));fillSelect("f-status","Все статусы",uniq(r=>[r.status]),v=>STATUS[v]||v);
  const f={agent:$("f-agent").value,task:$("f-task").value,model:$("f-model").value,status:$("f-status").value};
  const list=RUNS.filter(r=>(!f.agent||r.agentId===f.agent)&&(!f.task||r.taskId===f.task||r.alsoFinished.some(x=>x.id===f.task))&&(!f.model||r.model===f.model)&&(!f.status||r.status===f.status));
  const t=$("runs");t.replaceChildren(head(["","Сессия","Статус","Агент","Модель","Задача","Начало","Длит.","Токены","Стоимость"]));
  list.forEach(r=>{const key=runKey(r);const open=expandedRuns.has(key);
    const tr=el("tr","click"+(open?" sel":""));tr.onclick=()=>{if(expandedRuns.has(key))expandedRuns.delete(key);else expandedRuns.add(key);renderRuns()};
    const st=el("td","nw");st.append(dot({running:"acc",ok:"ok",turns:"ok",failed:"bad"}[r.status]||""),r.status==="failed"?"exit "+r.exitCode:STATUS[r.status]);
    if(r.endedBy&&r.endedBy!=="failed"){st.append(el("div","muted small",(ENDED[r.endedBy]||r.endedBy)+(r.phase?" · "+r.phase+(r.endPhase&&r.endPhase!==r.phase?"→"+r.endPhase:""):"")))}
    const task=el("td","mono nw",r.taskId+(r.alsoFinished.length?" +"+r.alsoFinished.length:""));task.title=[r.taskTitle,...r.alsoFinished.map(x=>x.title)].join(", ");
    tr.append(td(open?"▾":"▸","muted"),td(r.seq?"С-"+r.seq:"—","mono nw"),st,td(r.agentId),td(r.model||"—","mono"),task,td(ago(r.startedAt),"muted nw"),td(fmtMs(r.durationMs),"mono nw"),
      td(r.usage?fmtTok(r.usage.total):r.status==="running"?"—":"нет данных",r.usage?"mono":"muted"),td(r.costUsd!==null?fmtUsd(r.costUsd,r.costEstimated):r.usage?"нет цены":"—",r.costUsd!==null?"mono nw":"muted"));
    t.append(tr);
    if(open){const dr=el("tr","exp");const cell=el("td");cell.colSpan=10;cell.append(runDetail(r));dr.append(cell);t.append(dr)}});
  if(!list.length){const r=el("tr");const c=el("td","empty",RUNS.length?"Нет запусков под этот фильтр.":"Запусков пока нет: они появятся, когда runner'ы начнут сессии.");c.colSpan=10;r.append(c);t.append(r)}
  const ended=list.filter(r=>r.status!=="running");const priced=ended.filter(r=>r.costUsd!==null);
  $("runtotal").textContent="итого: "+ended.length+" "+plural(ended.length,"сессия","сессии","сессий")+" · "+fmtMs(ended.reduce((a,r)=>a+r.durationMs,0))+" · "+fmtTok(ended.reduce((a,r)=>a+(r.usage?r.usage.total:0),0))+" токенов · "+(priced.length?fmtUsd(priced.reduce((a,r)=>a+r.costUsd,0),priced.some(r=>r.costEstimated)):"стоимость неизвестна")+(list.length>ended.length?" · идёт сейчас: "+(list.length-ended.length):"")+" · номера С-N идут в порядке завершения сессий";
}
/** What one session did: its tasks, attempt, turns, tokens by kind, how it ended, where the cost comes from. */
function runDetail(r){
  const d=el("div","detail");const line=(label,...parts)=>{const x=el("div","");x.append(el("span","muted",label+": "),...parts);d.append(x)};
  const taskRef=(id,title,state,note)=>{const a=el("a","",id);a.href="#/tasks/"+encodeURIComponent(route.project);a.onclick=ev=>{ev.preventDefault();ev.stopPropagation();go("tasks",route.project)};
    const sp=el("span","");sp.append(a," «"+title+"»"+(state?" · "+state:"")+" — "+note);return sp};
  const tasks=el("span","");tasks.append(taskRef(r.taskId,r.taskTitle,r.taskState,"сессия запущена для неё"));
  r.alsoFinished.forEach(x=>tasks.append(el("br"),taskRef(x.id,x.title,x.status,"закончена в этой же сессии")));
  line(r.alsoFinished.length?"задачи":"задача",tasks);
  line("сессия",(r.attempt>1?"попытка #"+r.attempt+" агента над задачей":"первая попытка агента над задачей")+(r.numTurns!==null?" · "+r.numTurns+" "+plural(r.numTurns,"ход","хода","ходов"):"")+" · начало "+new Date(r.startedAt).toLocaleString([],{hour12:false})+(r.endedAt?" · конец "+time(r.endedAt):" · идёт")+" · "+fmtMs(r.durationMs));
  const u=r.usage;
  line("токены",u?"всего "+fmtTok(u.total)+" · вход "+fmtTok(u.input)+(u.cacheRead||u.cacheCreation?" (из кэша "+fmtTok(u.cacheRead)+", запись в кэш "+fmtTok(u.cacheCreation)+")":"")+" · выход "+fmtTok(u.output):r.status==="running"?"будут известны, когда сессия закончится":"нет: CLI не сообщил их (сессию остановили до конца или CLI без JSON-вывода)");
  line("стоимость",r.costUsd!==null?(r.costEstimated?fmtUsd(r.costUsd,true)+" по вашей цене для "+r.model+" (prices в runners.json)":fmtUsd(r.costUsd,false)+" — сообщил CLI"):u?"нет цены для "+(r.model||"модели")+": добавьте её в \"prices\" в runners.json":"—");
  line("завершение",r.status==="running"?"сессия идёт":r.status==="ok"?"код выхода 0":r.status==="turns"?"упёрлась в лимит ходов, успев продвинуться: плановый конец, работу продолжила свежая сессия (exit "+r.exitCode+")":r.status==="stopped"?"остановлена сигналом (кнопка «Стоп» или Ctrl+C)":"ошибка: код выхода "+r.exitCode);
  if(r.recordPath)line("запись",el("span","mono",r.recordPath));
  return d;
}

/* ---------- runners ---------- */
const runnerCards=new Map();
function renderControl(s){
  $("runners-lead").textContent=s.control?"Агенты проекта "+s.project.name+" из runners.json: запуск, модель, инструкции, лог.":"Только чтение: runner'ов нет. Запустите UI с --runners runners.json, чтобы управлять агентами отсюда.";
  const box=$("runners");if(!s.control){box.replaceChildren();runnerCards.clear();return}
  if(!s.control.runners.length&&!box.childElementCount)box.append(el("div","empty","В runners.json нет агентов."));
  const live=new Set(s.control.runners.map(r=>r.id)); // the UI restarted with another runners.json: drop the old cards
  for(const [id,c] of runnerCards)if(!live.has(id)){c.root.remove();runnerCards.delete(id)}
  const day=RUNS.filter(r=>r.costUsd!==null&&inWin(r.endedAt,"24h"));
  for(const r of s.control.runners){
    let c=runnerCards.get(r.id);
    if(!c){c=makeRunnerCard(r.id);runnerCards.set(r.id,c);box.append(c.root)}
    c.dot.className="dot "+(r.session?"ok":r.running?"warn":"");
    c.badge.className="badge "+(r.running?"RUNNING":"STOPPED");c.badge.textContent=r.running?"RUNNING":"STOPPED";
    c.btn.textContent=r.running?"Стоп":"Старт";c.btn.className=r.running?"ghost":"";c.btn.dataset.action=r.running?"stop":"start";
    const mine=day.filter(x=>x.agentId===r.id);
    c.info.textContent=(r.session?"сейчас: "+r.session.taskId+" · сессия #"+r.session.attempt+" · "+since(r.session.startedAt):r.running&&r.startedAt?"ждёт задачу · запущен "+ago(r.startedAt):r.stoppedAt?"остановлен "+ago(r.stoppedAt):"не запускался")+(mine.length?" · за 24ч "+fmtUsd(mine.reduce((a,x)=>a+x.costUsd,0),mine.some(x=>x.costEstimated)):"")+(r.spawned?" · добавлен lead'ом для "+r.spawned.taskId+" (шаблон "+r.spawned.template+"), нет в runners.json":"");
    c.cwd.textContent=r.cwd?"папка: "+r.cwd:"папка: текущая";c.cwd.title=r.cwd||"";
    c.cmd.textContent=r.command;c.cmd.title=r.command;
    miniFeed(r.id,c.feed);
    c.modelHint.textContent=r.model&&r.models.length<2?"Список моделей для выбора — поле \"models\" в runners.json (в defaults или у агента).":"";c.modelHint.hidden=!c.modelHint.textContent;
    c.modelState.textContent=r.model?"модель: "+r.model+(r.proposeModel&&r.proposeModel!==r.model?" · в задачах «написать change»: "+r.proposeModel:""):"модель: задана в command (поставьте {model} в command и \"model\" в runners.json, чтобы выбирать здесь)";c.modelForm.hidden=!r.model;
    const msig=r.models.join("|")+"#"+(r.model||"");
    if(r.model&&document.activeElement!==c.modelSel&&c.modelSel.dataset.server!==msig){c.modelSel.replaceChildren(...r.models.map(m=>new Option(m,m)),new Option("другая…","__other__"));c.modelSel.value=r.model;c.modelSel.dataset.server=msig}
    c.instState.className="note line"+(r.instructions&&r.instructions.error?" err":"");
    c.instState.textContent=!r.instructionsFile?"инструкции: нет (только стандартный промпт)":r.instructions&&r.instructions.error?"инструкции: не читается "+r.instructionsFile+" ("+r.instructions.error+")":"инструкции: "+r.instructionsFile;
    c.instState.title=r.instructionsFile||"";
    c.instPre.textContent=r.instructions&&r.instructions.preview!==undefined?r.instructions.preview:"";c.instDetails.hidden=!(r.instructions&&r.instructions.preview);
    if(document.activeElement!==c.instInput&&c.instInput.dataset.server!==(r.instructionsFile||"")){c.instInput.value=r.instructionsFile||"";c.instInput.dataset.server=r.instructionsFile||""}
    if(c.details.open)loadLog(r.id,c);
  }
}
function makeRunnerCard(id){
  const root=el("div","card runner");const top=el("div","top2");const dt=dot("");const badgeEl=el("span","badge","");const btn=el("button","","");
  btn.type="button";btn.onclick=async()=>{btn.disabled=true;try{await post("/api/runners/"+encodeURIComponent(id)+"/"+btn.dataset.action);await tick()}catch(e){alert(e.message)}finally{btn.disabled=false}};
  top.append(dt,el("span","",id),badgeEl,btn);const info=el("div","muted","");const cwd=el("div","muted line","");const cmd=el("div","muted mono line","");
  const modelState=el("div","note line","");const modelHint=el("div","muted","");modelHint.hidden=true;
  const modelForm=el("form","inst");const modelSel=document.createElement("select");const modelBtn=el("button","ghost","Применить");modelBtn.type="submit";modelForm.append(modelSel,modelBtn);
  modelForm.onsubmit=async ev=>{ev.preventDefault();let m=modelSel.value;
    if(m==="__other__"){m=(prompt("Модель, как её называет CLI агента (например qwen/qwen3.5-9b или haiku). Чтобы она всегда была в списке, добавьте её в \"models\" в runners.json.")||"").trim();if(!m){modelSel.dataset.server="";await tick();return}}
    modelBtn.disabled=true;try{await post("/api/runners/"+encodeURIComponent(id)+"/model",{model:m});modelSel.dataset.server="";modelSel.blur();await tick()}catch(e){alert(e.message)}finally{modelBtn.disabled=false}};
  const instState=el("div","note line","");
  const instDetails=el("details");instDetails.append(el("summary","","Текст инструкций"));const instPre=el("pre","log","");instDetails.append(instPre);
  const inst=el("form","inst");const instInput=document.createElement("input");instInput.placeholder="файл инструкций, напр. instructions/backend.md";
  const instBtn=el("button","ghost","Сохранить");instBtn.type="submit";inst.append(instInput,instBtn);
  inst.onsubmit=async ev=>{ev.preventDefault();instBtn.disabled=true;
    try{await post("/api/runners/"+encodeURIComponent(id)+"/instructions",{file:instInput.value});instInput.dataset.server="";instInput.blur();await tick()}catch(e){alert(e.message)}finally{instBtn.disabled=false}};
  const details=el("details");details.append(el("summary","","Сырой лог"));const pre=el("pre","log","");details.append(pre);
  details.addEventListener("toggle",()=>{if(details.open)loadLog(id,c)});
  const feedHead=el("div","row2");const feedTitle=el("b","","Активность");const feedLink=el("a","","вся лента агента →");feedLink.href="#";
  feedLink.onclick=ev=>{ev.preventDefault();$("a-agent").dataset.sig="";go("activity",route.project);setTimeout(()=>{$("a-agent").value=id;render()},0)};
  feedHead.append(feedTitle,feedLink);const feed=el("div","act mini");
  root.append(top,info,cwd,cmd,modelState,modelForm,modelHint,instState,inst,instDetails,feedHead,feed,details);
  const c={root,dot:dt,badge:badgeEl,btn,info,cwd,cmd,details,pre,modelState,modelForm,modelSel,modelHint,instState,instInput,instPre,instDetails,feed};return c}
async function loadLog(id,c){try{const j=await getJSON(q("/api/runners/"+encodeURIComponent(id)+"/log"));
  const atEnd=c.pre.scrollTop+c.pre.clientHeight>=c.pre.scrollHeight-8;c.pre.textContent=j.lines.length?j.lines.join("\n"):"(пусто)";if(atEnd)c.pre.scrollTop=c.pre.scrollHeight}catch(e){}}
function renderAgents(s){
  const box=$("agents");box.replaceChildren();
  if(!s.agents.length&&!s.notStarted.length)box.append(el("div","empty","Агентов пока нет. Они появятся, когда запустятся их MCP-процессы."));
  for(const a of s.agents){
    const c=el("div","card agent "+a.effectiveStatus);const top=el("div","top2");top.append(el("span","dot"),el("span","",a.id),badge(a.effectiveStatus));c.append(top);
    c.append(el("div","muted",[a.type,a.role&&a.role!==a.id?a.role:null].filter(Boolean).join(" · ")));
    c.append(el("div","muted","активность: "+ago(a.lastSeenAt)+(a.pid?" · pid "+a.pid:"")));
    c.append(el("div","muted","задачи: "+(a.tasks.length?a.tasks.join(", "):"—")));
    if(a.effectiveStatus==="DEAD")c.append(el("div","muted","процесс не найден (упал?)"));
    box.append(c);
  }
  for(const id of s.notStarted){const c=el("div","card agent");const top=el("div","top2");top.append(el("span","dot"),el("span","",id),badge("","не запущен"));c.append(top,el("div","muted","назначен на задачу, но ещё не зарегистрировался"));box.append(c)}
}

/* ---------- projects ---------- */
function renderProjects(){
  const t=$("projects");t.replaceChildren(head(["Проект","Ветка","HEAD","Задачи","Runner'ы","OpenSpec","Вопросы","Расход 24ч","Активность"]));
  PROJ.forEach(p=>{const r=el("tr","click"+(p.id===route.project?" sel":""));r.onclick=()=>go("overview",p.id);
    const c1=el("td");const path=el("div","muted mono path",p.projectDir);path.title=p.projectDir;c1.append(el("b","",p.name),path);
    const k=p.tasks;const tasks=[k.running?k.running+" идёт":"",k.queued?k.queued+" в очереди":"",k.blocked?k.blocked+" BLOCKED":"",k.done?k.done+" готово":"",k.cancelled?k.cancelled+" отменено":""].filter(Boolean).join(" · ")||"нет задач";
    const c5=el("td","nw");if(p.runners){c5.append(dot(p.runners.working?"ok":p.runners.running?"warn":""),el("span","mono",p.runners.running+"/"+p.runners.total))}else c5.append(el("span","muted","только чтение"));
    const c7=el("td","mono",String(p.openQuestions));if(p.openQuestions)c7.style.color="var(--warn)";
    const sp=p.spend24h;r.append(c1,td(p.git?p.git.branch:"—","mono"),td(p.git?p.git.head:"не git",p.git?"mono":"muted"),td(tasks,"mono"),c5,td(p.openspec?p.openspec+" change":"—",p.openspec?"mono":"muted"),c7,
      td(sp.usd!==null?fmtUsd(sp.usd,sp.estimated)+(sp.unpriced?" · без цены: "+sp.unpriced:""):sp.unpriced?"нет цены":"—",sp.usd!==null?"mono":"muted"),td(p.lastActivity?ago(p.lastActivity):"—","muted"));t.append(r)});
}

/* ---------- events ---------- */
function renderEvents(){
  const all=events(S);fillSelect("e-task","Все задачи",[...new Set(all.map(e=>e.taskId))].sort());fillSelect("e-type","Все типы",[...new Set(all.map(e=>e.type))].sort());
  const ft=$("e-task").value,fy=$("e-type").value;const list=all.filter(e=>(!ft||e.taskId===ft)&&(!fy||e.type===fy));
  const box=$("events");const top=box.scrollTop;box.replaceChildren();list.slice(0,300).forEach(e=>box.append(evRow(e)));if(!list.length)box.append(el("div","empty","Событий нет."));box.scrollTop=top;
}

/* ---------- activity: what the agents call, what comes back ---------- */
let ACT=[],actSeq=0,actProject=null,actShown=0,actKind="all";const actOpen=new Set();
const KINDS=[["all","all"],["tool_use","tool_use"],["tool_result","tool_result"],["err","errors"],["text","text"],["thinking","thinking"],["runner","runner"]];
async function fetchActivity(){
  if(actProject!==route.project){actProject=route.project;ACT=[];actSeq=0;actShown=0;actOpen.clear()}
  try{const j=await getJSON(q("/api/activity?after="+actSeq));if(j.events.length){ACT.push(...j.events);if(ACT.length>3000)ACT.splice(0,ACT.length-3000)}actSeq=j.lastSeq||actSeq}catch(e){}
}
const isErr=e=>!!e.isError||e.kind==="stderr";
function matchKind(e,k){return k==="all"||(k==="err"?isErr(e):k==="runner"?e.kind==="runner"||e.kind==="session"||e.kind==="stderr":e.kind===k||(k==="text"&&e.kind==="result"))}
function secs(ms){return ms<1000?ms+" мс":ms<60000?(ms/1000).toFixed(1)+" с":Math.round(ms/60000)+" мин"}
function actRow(e,mini){
  const r=el("div","arow "+e.kind+(isErr(e)?" err":"")+(actOpen.has(e.seq)?" open":""));
  const kind=el("span","kind "+(e.kind==="tool_result"&&e.isError?"err":e.kind),e.kind);
  const sum=el("span","sum");
  if(e.tool){const t=el("span","tool",(e.kind==="tool_result"?(e.isError?"✗ ":"✓ "):"")+e.tool.replace(/^mcp__agent-network__/,"swarm·").replace(/^mcp__supervisor__/,"supervisor·"));sum.append(t)}
  sum.append((e.durationMs!==undefined?secs(e.durationMs)+" · ":"")+(e.summary||""));sum.title=e.summary||"";
  if(e.detail&&!actOpen.has(e.seq))sum.append(el("span","more2"," · целиком — клик"));
  if(e.sub){r.classList.add("subag");sum.prepend(el("span","subm","↳ сабагент "))}
  r.append(el("span","seq","#"+e.seq),el("span","tm",time(e.at)),el("span","who",e.agentId),kind,sum);
  const wrap=el("div");wrap.dataset.seq=String(e.seq);wrap.append(r);
  if(actOpen.has(e.seq)){const d=el("div","adetail");d.append(el("div","muted",[e.agentId,e.taskId?e.taskId+(e.attempt?" · сессия #"+e.attempt:""):null,new Date(e.at).toLocaleString([],{hour12:false}),"#"+e.seq].filter(Boolean).join(" · ")));
    if(e.detail)d.append(el("pre","log",e.detail));else d.append(el("div","muted","подробностей нет"));wrap.append(d)}
  r.onclick=()=>{if(actOpen.has(e.seq))actOpen.delete(e.seq);else actOpen.add(e.seq);render()};
  return wrap}
/** Rebuild a scrolled list without moving what you are reading: the first visible row stays where it was (at the very top, the list shows the newest). */
function keepAnchor(box,rebuild){const top=box.scrollTop;let anchor=null,off=0;const bt=()=>box.getBoundingClientRect().top;
  if(top>0)for(const r of box.querySelectorAll("[data-seq]")){const rt=r.getBoundingClientRect();if(rt.bottom>bt()+1){anchor=r.dataset.seq;off=rt.top-bt();break}}
  rebuild();
  if(top>0){const r=anchor&&box.querySelector('[data-seq="'+anchor+'"]');box.scrollTop=top;if(r)box.scrollTop+=r.getBoundingClientRect().top-bt()-off}}
function renderActivity(){
  const agents=[...new Set(ACT.map(e=>e.agentId))].sort();fillSelect("a-agent","Все агенты",agents);fillSelect("a-task","Все задачи",[...new Set(ACT.map(e=>e.taskId).filter(Boolean))].sort());
  const fa=$("a-agent").value,ft=$("a-task").value,fq=$("a-q").value.trim().toLowerCase(),follow=$("a-follow").checked;
  const base=ACT.filter(e=>(!fa||e.agentId===fa)&&(!ft||e.taskId===ft)&&(!fq||((e.summary||"")+" "+(e.tool||"")+" "+(e.detail||"")).toLowerCase().includes(fq)));
  const counts=KINDS.map(([k])=>base.filter(e=>matchKind(e,k)).length);const kb=$("a-kinds");const ksig=actKind+"|"+counts.join(",");
  if(kb.dataset.sig!==ksig){kb.dataset.sig=ksig;kb.replaceChildren();KINDS.forEach(([k,label],i)=>{const b=el("button",actKind===k?"on":"");b.type="button";b.append(label,el("span","k",String(counts[i])));b.onclick=()=>{actKind=k;actShown=0;render()};kb.append(b)})}
  let list=base.filter(e=>matchKind(e,actKind));
  const box=$("activity");
  // "следить" brings new events in only while you are at the top; scrolled down to read, the list holds still and new ones wait in the pill
  if((follow&&box.scrollTop<40)||!actShown)actShown=actSeq;
  const fresh=list.filter(e=>e.seq>actShown).length;list=list.filter(e=>e.seq<=actShown).slice(-400);
  // rebuilt only when what is shown changed: a rebuild resets the scroll and swallows clicks
  const sig=[actKind,fa,ft,fq,list.length,list.length?list[0].seq+"-"+list[list.length-1].seq:"",fresh,[...actOpen].join(".")].join("|");
  if(box.dataset.sig!==sig){box.dataset.sig=sig;const rows=list.slice().reverse().map(e=>actRow(e,false));
    if(fresh){const pill=el("button","newpill","Новых событий: "+fresh+" — показать");pill.type="button";pill.onclick=()=>{actShown=actSeq;box.scrollTop=0;render()};rows.unshift(pill)}
    keepAnchor(box,()=>box.replaceChildren(...(rows.length?rows:[el("div","empty",S.control?"Пока пусто: события появятся, когда агенты начнут работать.":"Лента доступна в UI с --runners: её ведут runner'ы.")])))}
  $("a-total").textContent=ACT.length?"всего в памяти: "+ACT.length+" событий · ошибок: "+ACT.filter(isErr).length:"";
  $("c-activity").textContent="";
}
["a-agent","a-task","a-follow"].forEach(id=>$(id).addEventListener("change",render));$("a-q").addEventListener("input",render);
/** The runner card's latest events, in one box that stays. Scrolled down to read, the window stops sliding: it keeps
 *  the events from the one you are reading down and adds the new ones on top. */
function miniFeed(id,box){const mine=ACT.filter(e=>e.agentId===id);let from=mine.length-12;
  if(box.scrollTop>0&&box.dataset.oldest){const i=mine.findIndex(e=>String(e.seq)===box.dataset.oldest);if(i>=0)from=Math.min(from,i)}
  const list=mine.slice(Math.max(0,from)).reverse();box.dataset.oldest=list.length?String(list[list.length-1].seq):"";
  const sig=list.map(e=>e.seq).join(".")+"|"+list.filter(e=>actOpen.has(e.seq)).map(e=>e.seq).join(".");if(box.dataset.sig===sig)return;box.dataset.sig=sig;
  keepAnchor(box,()=>box.replaceChildren(...(list.length?list.map(e=>actRow(e,true)):[el("div","empty","событий пока нет")])))}

/* ---------- questions ---------- */
const qCards=new Map();
function renderQuestions(s){
  const open=s.openQuestions||[];$("questions").hidden=!open.length;const box=$("qlist");const keep=new Set();
  for(const qq of open){const key=route.project+"/"+qq.taskId+"/"+qq.messageId;keep.add(key);if(qCards.has(key))continue;
    const c=questionCard(qq,s,key);qCards.set(key,c);box.append(c)}
  for(const [key,c] of qCards)if(!keep.has(key)){c.remove();qCards.delete(key)}
}
/** An agent's question to the operator: its text, its choices (the recommended one picked) and the answer form. */
function questionCard(qq,s,key){
  const c=el("div","card q");const h=el("div","");h.append(el("span","who",qq.from),el("span","muted"," · "+qq.taskId+" «"+qq.taskTitle+"» · "+time(qq.askedAt)));c.append(h,el("div","",qq.question));
    if(s.control){const f=el("form","");const ta=document.createElement("textarea");ta.placeholder="Ваш ответ агенту "+qq.from;
      // the agent's choices: one (radio) or several (checkboxes), its recommendation picked; the text box adds to it or replaces it
      const ch=qq.choices;let picked=()=>[];
      if(ch){const opts=el("div","qopts");const name="q-"+key;
        ch.options.forEach(o=>{const l=el("label","qopt"+(o.label===ch.recommended?" rec":""));const i=document.createElement("input");i.type=ch.multiSelect?"checkbox":"radio";i.name=name;i.value=o.label;i.checked=o.label===ch.recommended;
          const t=el("div","");t.append(el("b","",o.label));if(o.label===ch.recommended)t.append(el("span","tag","агент рекомендует"));if(o.description)t.append(el("div","muted",o.description));l.append(i,t);opts.append(l)});
        f.append(opts);picked=()=>[...opts.querySelectorAll("input:checked")].map(i=>i.value);ta.placeholder="Комментарий к выбору или свой ответ вместо вариантов (необязательно)";ta.rows=2}const r2=el("div","row2");const b=el("button","","Ответить");b.type="submit";const note=el("span","note","");
      const x=el("button","ghost","Закрыть без ответа");x.type="button";x.title="агент ничего не получит: например, он уже сделал по своему предложению или вопрос решён иначе";
      x.onclick=async()=>{if(!await ask("Закрыть вопрос "+qq.from+" без ответа? Агент ничего не получит."))return;x.disabled=true;try{await post("/api/questions/dismiss",{taskId:qq.taskId,messageId:qq.messageId});await tick()}catch(e){note.className="note err";note.textContent=e.message;x.disabled=false}};
      r2.append(b,x,note);f.append(ta,r2);
      f.onsubmit=async ev=>{ev.preventDefault();const sel=picked();const text=ta.value.trim();if(!sel.length&&!text)return;
        const answer=sel.length?"Chosen: "+sel.map(x=>'"'+x+'"').join(", ")+(text?"\n"+text:""):text;
        b.disabled=true;note.className="note";note.textContent="отправляю…";
        try{await post("/api/questions/answer",{taskId:qq.taskId,messageId:qq.messageId,answer});note.className="note ok";note.textContent="отправлено";await tick()}catch(e){note.className="note err";note.textContent=e.message;b.disabled=false}};
      c.append(f)}else c.append(el("div","muted","ответить можно из UI, запущенного с --runners"));
  return c}

/* ---------- supervisor ---------- */
let SUP=null,supKind="all",supAll=false;const supSessions=new Map();const supSeen={project:null,ids:new Set(),needs:new Set()},supOpen=new Set();let supUi=null;
const RULES=[["questionAfterSec","вопрос оператору без ответа дольше","с"],["stallMin","нет прогресса у агента в сессии дольше","мин"],["repeatCount","одна и та же команда подряд, раз","×"],["testMin","тестовый процесс живёт дольше","мин"],["refusedCount","отказов в правах за 10 мин, раз","×"],["checkInMin","агент работает над фазой задачи дольше (чек-ин)","мин"]];
/* writing to the lead: open state, draft and sending survive the card being rebuilt every refresh */
const composeOpen=new Set(),drafts=new Map(),sendState=new Map();
const OP_NOTE=/^\[From the operator[^\]]*\]\n/;
function renderCompose(t){
  const lead=t.agents[0],others=t.agents.slice(1),key=route.project+"/"+t.id,open=composeOpen.has(key),st=sendState.get(key)||{};
  const box=el("div","compose"+(open?" open":""));box.dataset.compose=key;
  const mine=t.messages.filter(m=>(m.from==="operator"&&m.to===lead&&!m.replyTo)||(m.from===lead&&m.to==="operator"&&m.type!=="QUESTION")).slice(-4);
  const hd=el("div","hd");
  if(!open){const b=el("button","ghost","✉ Написать lead'у "+lead);b.type="button";
    b.onclick=()=>{composeOpen.add(key);render();const ta=document.querySelector('[data-compose="'+key+'"] textarea');if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length)}};
    hd.append(b,el("span","muted",drafts.get(key)?"есть черновик":others.length?"он выполнит своё и передаст "+others.join(", "):"он единственный агент задачи"));box.append(hd)}
  else{
    hd.append(el("b","","Сообщение lead'у "+lead),el("span","muted",others.length?"выполнит своё и передаст остальным ("+others.join(", ")+"); дойдёт, даже если он занят":"дойдёт, даже если он занят"));box.append(hd);
    const ta=document.createElement("textarea");ta.placeholder=others.length?"Например: «"+others[0]+": сначала посмотри DTO, потом сервис». Назовите агента, если это про него.":"Что сделать или учесть";ta.value=drafts.get(key)||"";
    ta.oninput=()=>drafts.set(key,ta.value);
    if(others.length){const who=el("div","who");who.append("касается:");others.forEach(a=>{const c=el("button","ghost",a);c.type="button";c.title="вставить «"+a+": »";
      c.onclick=()=>{const at=ta.selectionStart??ta.value.length;const ins=(at&&!/\s$/.test(ta.value.slice(0,at))?" ":"")+a+": ";ta.value=ta.value.slice(0,at)+ins+ta.value.slice(at);drafts.set(key,ta.value);ta.focus();ta.setSelectionRange(at+ins.length,at+ins.length)};who.append(c)});box.append(who)}
    box.append(ta);
    const urg=el("label","urgent"+(st.urgent?" on":""));const uc=document.createElement("input");uc.type="checkbox";uc.checked=!!st.urgent;
    const ut=el("span","");ut.append(el("b","","⚡ Срочно"),el("span",""," — остановить текущую сессию lead'а (после её текущей команды) и начать новую с этим сообщением первым. Обычное сообщение агент может пропустить, срочное — нет; цена — несколько ходов на новую сессию."));
    urg.append(uc,ut);box.append(urg);
    const r=el("div","row2");const send=el("button",st.urgent?"warnbtn":"",st.pending?"Отправляю…":st.urgent?"⚡ Отправить срочно":"Отправить");
    uc.onchange=()=>{sendState.set(key,{...(sendState.get(key)||{}),urgent:uc.checked});urg.classList.toggle("on",uc.checked);send.className=uc.checked?"warnbtn":"";send.textContent=uc.checked?"⚡ Отправить срочно":"Отправить"};send.type="button";send.disabled=!!st.pending;
    const cancel=el("button","ghost","Свернуть");cancel.type="button";cancel.onclick=()=>{composeOpen.delete(key);render()};
    const note=el("span","note"+(st.error?" err":""),st.error||"⌘/Ctrl+Enter — отправить, Esc — свернуть (черновик останется)");
    const doSend=async()=>{const text=ta.value.trim();if(!text){note.className="note err";note.textContent="Напишите сообщение";ta.focus();return}
      const urgent=uc.checked;sendState.set(key,{pending:true,urgent:urgent});send.disabled=true;send.textContent="Отправляю…";
      const how={now:"сессия остановлена, новая начнётся с сообщения","after-tool":"сессия остановится после текущей команды, новая начнётся с сообщения","next-session":"сессии сейчас нет: следующая начнётся с сообщения","not-running":"runner остановлен: сообщение ждёт в pendingMessages"};
      try{const j=await post("/api/tasks/"+encodeURIComponent(t.id)+"/message",{text:text,urgent:urgent});drafts.delete(key);composeOpen.delete(key);ta.blur();sendState.set(key,{sentAt:new Date().toISOString()});
        toast(urgent?"warn":"ok",t.id+": "+(urgent?"срочно lead'у ":"отправлено lead'у ")+lead,(j.interrupted?how[j.interrupted]+". ":"")+text,t.id)}
      catch(e){sendState.set(key,{error:e.message})}
      await tick()};
    send.onclick=doSend;
    ta.onkeydown=ev=>{if(ev.key==="Enter"&&(ev.metaKey||ev.ctrlKey)){ev.preventDefault();doSend()}else if(ev.key==="Escape"){composeOpen.delete(key);ta.blur();render()}};
    r.append(send,cancel,note);box.append(r)}
  // what you wrote before and whether the lead has read it (it reads with its next action)
  if(mine.length){const h=el("div","hist");mine.slice().reverse().forEach(m=>{const d=el("div");const txt=m.content.replace(OP_NOTE,"");const his=m.from===lead;
    const body=el("span","");if(his)body.append(el("span","from",lead+":"));body.append(txt.length>300?txt.slice(0,300)+"…":txt);
    if(m.urgent)body.prepend(el("span","from","⚡"));
    const got=(t.delivered||[]).includes(m.id);
    d.append(el("span","tm",time(m.createdAt)),body,el("span","rd"+(his||m.readAt?" ok":got?" warn":""),his?"к сведению":m.readAt?"✓ получил":got?"доставлено, ответа нет":"• ещё не дошло"));d.title=his?"":m.readAt?"агент после этого сообщения уже обращался к рою":got?"хук показал сообщение агенту, но тот к рою ещё не обращался; если важно — отправьте срочно":"агент ещё не делал вызовов инструментов после этого сообщения";h.append(d)});box.append(h)}
  return box}
function watchSupervisor(s){const sv=s.supervisor;if(!sv)return;
  // the first look only remembers its entries; a decision that waits for you pops up even then
  if(supSeen.project!==s.project.id){supSeen.project=s.project.id;supSeen.ids=new Set(sv.recent.map(e=>e.id));supSeen.needs=new Set()}
  for(const e of sv.recent){if(supSeen.ids.has(e.id))continue;supSeen.ids.add(e.id);
    if(e.by==="supervisor"&&e.kind==="action")toast("","Надзор"+(e.taskId?" · "+e.taskId:""),e.text,e.taskId,e.taskId?undefined:"supervisor")}
  for(const e of sv.needsYou){if(supSeen.needs.has(e.id))continue;supSeen.needs.add(e.id);toast("bad","Надзор: нужно ваше решение"+(e.taskId?" · "+e.taskId:""),e.text,e.taskId,"supervisor").dataset.need=e.id}
  const open=new Set(sv.needsYou.map(e=>e.id));document.querySelectorAll("#toasts [data-need]").forEach(d=>{if(!open.has(d.dataset.need))d.remove()}); // marked done: its pop-up goes too
}
/** Under a "session" entry: where its full log is, and the log itself on demand (prompt, calls, results, its text). */
function sessionBox(e){const id=e.data.session;const box=el("div","jsess");const b=el("button","ghost",supSessions.has(id)?"Скрыть сессию":"Показать сессию");b.type="button";
  const where=el("span","",".agent-network/"+e.data.log+(e.data.transcript?" · транскрипт CLI: "+e.data.transcript:""));where.title=e.data.transcript||e.data.log;box.append(b,where);
  const pre=el("pre","log jlog",supSessions.get(id)||"");pre.hidden=!supSessions.has(id);
  box.onclick=ev=>ev.stopPropagation();pre.onclick=ev=>ev.stopPropagation(); // reading the log does not fold the row
  b.onclick=async()=>{if(supSessions.has(id)){supSessions.delete(id);pre.hidden=true;b.textContent="Показать сессию";return}
    b.disabled=true;try{const j=await getJSON(q("/api/supervisor/sessions/"+id));supSessions.set(id,j.text);pre.textContent=j.text;pre.hidden=false;b.textContent="Скрыть сессию"}catch(err){alert("Не удалось прочитать "+id)}finally{b.disabled=false}};
  return [box,pre]}
function supState(st){return !st.enabled?["","выключен"]:st.session?["ok","работает"]:st.held?["warn","ждёт"]:["acc","следит"]}
function kpi(label,value,hint,dotCls){const k=el("div","kpi");const v=el("div","v");if(dotCls!==undefined)v.append(dot(dotCls));v.append(value);k.append(el("div","l",label),v,el("div","h",hint));return k}
function makeSupUi(){
  const set=$("s-settings");const modelState=el("div","note","");const form=el("form","inst");const sel=document.createElement("select");const btn=el("button","ghost","Применить");btn.type="submit";form.append(sel,btn);
  const hint=el("div","muted","");const rules=el("div","rules");const limits=el("div","muted","");
  form.onsubmit=async ev=>{ev.preventDefault();let m=sel.value;
    if(m==="__other__"){m=(prompt("Модель, как её называет CLI надзора (например sonnet или qwen/qwen3-coder-30b). Чтобы она всегда была в списке, добавьте её в supervisor.models в runners.json.")||"").trim();if(!m){sel.dataset.server="";await tick();return}}
    btn.disabled=true;try{await post("/api/supervisor/model",{model:m});sel.dataset.server="";sel.blur();await tick()}catch(e){alert(e.message)}finally{btn.disabled=false}};
  set.append(el("h3","","Настройки"),modelState,form,hint,rules,limits,el("div","muted","Пороги меняются здесь или в supervisor.rules в runners.json; лимиты и свои команды — там же. Всё перечитывается на лету."));
  const tools=$("s-tools");const tlist=el("div");tools.append(el("h3","","Инструменты"),el("div","muted","Выключенный инструмент не попадёт в следующую сессию надзора."),tlist);
  $("s-toggle").onclick=async()=>{const b=$("s-toggle");b.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/"+b.dataset.action)};await tick()}catch(e){alert(e.message)}finally{b.disabled=false}};
  KINDS_J.forEach(([k,label])=>{const b=el("button","",label);b.type="button";b.dataset.k=k;b.onclick=()=>{supKind=k;renderSupervisor()};$("s-kinds").append(b)});
  return {modelState,form,sel,hint,rules,limits,tlist}}
const KINDS_J=[["all","all"],["incident","incident"],["action","action"],["needs-you","needs-you"],["note","note"],["session","session"]];
/* ---------- observer ---------- */
let OBS=null;const obsOpen=new Set(),obsReports=new Map(),obsState=new Map();
function renderObserver(){
  const o=OBS;$("o-none").hidden=!!(o&&o.observer);$("o-body").hidden=!(o&&o.observer);$("o-run").hidden=!(o&&o.observer&&S&&S.control);if(!o||!o.observer)return;
  const ob=o.observer;const btn=$("o-run");btn.disabled=!!ob.running;btn.textContent=ob.running?"работает…":"Запустить сейчас";
  btn.onclick=async()=>{btn.disabled=true;try{await post("/api/observer/run",{});await tick()}catch(e){alert(e.message);btn.disabled=false}};
  const sig=JSON.stringify([o.reports,o.proposals,o.issues,ob.running&&ob.running.at,ob.runs.length,ob.digests,[...obsState]]);if($("o-body").dataset.sig===sig)return;$("o-body").dataset.sig=sig;
  const k=$("o-kpis");k.replaceChildren();const kpi=(label,value,sub)=>{const d=el("div","kpi");d.append(el("div","lbl",label),el("div","v",value),el("div","sub",sub||""));k.append(d)};
  const last=ob.runs[0];
  kpi("сейчас",ob.running?"работает":"ждёт",ob.running?"с "+time(ob.running.at).slice(0,5):ob.cron?"по cron "+ob.cron+(ob.nextRunAt?" · следующий "+new Date(ob.nextRunAt).toLocaleString([],{weekday:"short",hour:"2-digit",minute:"2-digit"}):""):"только кнопкой");
  kpi("новых закрытых задач",String(ob.digests.uncovered),"всего итогов: "+ob.digests.total);
  kpi("последний запуск",last?time(last.at).slice(0,5):"—",last?(last.reportId?last.reportId:"без отчёта")+(last.costUsd!==undefined?" · $"+last.costUsd:"")+" · "+ob.cli+(ob.model?" "+ob.model:""):ob.cli+(ob.model?" "+ob.model:""));
  // proposals: open ones first, each can become a swarm task or be rejected with a reason the observer remembers
  const props=$("o-props");props.replaceChildren();const open=o.proposals.filter(p=>p.status==="open");$("o-pcount").textContent=open.length+" ждут решения · всего "+o.proposals.length;
  if(!o.proposals.length)props.append(el("div","muted spad","Предложений пока нет."));
  [...open,...o.proposals.filter(p=>p.status!=="open")].forEach(p=>{const c=el("div","oprop"+(p.status==="open"?"":" decided"));const st=obsState.get(p.id)||{};
    const hd=el("div","ah");hd.append(el("b","",p.title),el("span","badge "+(p.priority==="high"?"ERROR":p.priority==="medium"?"WARNING":"INFO"),p.priority),el("span","chip",p.target==="agent-network"?"agent-network-mcp":"проект"),el("span","muted",p.id+" · "+p.reportId));c.append(hd);
    [["Проблема",p.problem],["Где видно",p.evidence],["Во что обходится",p.impact],["Что сделать",p.fix]].forEach(([l,v])=>{const r=el("div","orow");r.append(el("div","lbl",l),longText(v,"op-"+p.id+l,300));c.append(r)});
    if(p.status==="accepted")c.append(el("div","note ok","принято: задача "+p.taskId+(p.network?" · "+p.network:"")));
    else if(p.status==="rejected")c.append(el("div","note","отклонено: "+p.rejectReason));
    else if(S&&S.control){const r=el("div","checks");const ag=document.createElement("input");ag.value=st.agents||(p.target==="agent-network"?"backend,reviewer":S.control.runners.map(x=>x.id).slice(0,2).join(","));ag.title="агенты задачи через запятую, первый — lead";ag.style.maxWidth="220px";
      ag.oninput=()=>obsState.set(p.id,{...st,agents:ag.value});
      const acc=el("button","","Принять → задача");acc.type="button";acc.disabled=!!st.pending;
      acc.onclick=async()=>{const where=p.target==="agent-network"?"в сети agent-network-mcp ("+o.agentNetworkNetwork+"): там должны работать runner'ы этих агентов":"в этом проекте";
        if(!await ask("Создать задачу «"+p.title+"» "+where+"? Агенты: "+ag.value))return;obsState.set(p.id,{pending:true});render();
        try{const r=await post("/api/observer/proposals/"+p.id+"/accept",{agents:ag.value.split(",").map(x=>x.trim()).filter(Boolean)});obsState.delete(p.id);toast("ok","Создана "+r.task.id,r.task.here?"в этом проекте":"в "+r.task.network)}catch(e){obsState.set(p.id,{error:e.message})}await tick()};
      const rej=el("button","ghost","Отклонить");rej.type="button";rej.disabled=!!st.pending;
      rej.onclick=async()=>{const why=prompt("Почему? Наблюдатель прочтёт и больше это не предложит.");if(!why||!why.trim())return;
        try{await post("/api/observer/proposals/"+p.id+"/reject",{reason:why.trim()})}catch(e){obsState.set(p.id,{error:e.message})}await tick()};
      r.append(el("span","muted","агенты:"),ag,acc,rej);c.append(r);if(st.error)c.append(el("pre","log err",st.error))}
    props.append(c)});
  const iss=$("o-issues");iss.replaceChildren();$("o-icount").textContent=o.issues.filter(i=>i.status!=="fixed").length+" открыто";
  if(!o.issues.length)iss.append(el("div","muted spad","Пока ничего не отслеживается."));
  o.issues.slice().reverse().forEach(i=>{const r=el("div","oissue");r.append(el("span","badge "+(i.status==="open"?"WARNING":i.status==="fixed"?"PASS":"INFO"),i.status),el("b","",i.title),el("span","muted"," · "+i.id+" · задачи: "+i.seenIn.join(", ")),el("div","muted",i.note));iss.append(r)});
  const reps=$("o-reports");const keep=[...reps.querySelectorAll("details[open]")].map(d=>d.dataset.id);keep.forEach(x=>obsOpen.add(x));reps.replaceChildren();
  if(!o.reports.length)reps.append(el("div","muted spad","Отчётов пока нет. Наблюдатель запустится по cron или кнопкой «Запустить сейчас»."));
  o.reports.forEach(r=>{const d=el("details","orep");d.dataset.id=r.id;d.open=obsOpen.has(r.id);d.append(el("summary","",r.id+" · "+new Date(r.at).toLocaleString([],{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" · "+r.title+" ("+r.covers.length+" задач)"));
    const body=el("div","omd",obsReports.get(r.id)||"загружаю…");d.append(body);
    const load=async()=>{if(obsReports.has(r.id))return;try{const j=await getJSON(q("/api/observer/reports/"+r.id));obsReports.set(r.id,j.report.markdown);body.textContent=j.report.markdown}catch(e){body.textContent=e.message}};
    d.addEventListener("toggle",()=>{if(d.open){obsOpen.add(r.id);load()}else obsOpen.delete(r.id)});if(d.open)load();reps.append(d)});
}
function renderSupervisor(){
  const st=SUP&&SUP.status,journal=(SUP&&SUP.journal)||[],ctl=!!S.control;if(!supUi)supUi=makeSupUi();const u=supUi;
  const none=$("s-none");none.hidden=!!st;
  if(!st){none.replaceChildren(el("b","","Надзор не настроен"),el("div","muted",ctl?"Добавьте секцию \"supervisor\" в runners.json и перезапустите UI. Готовые примеры: examples/runner/runners.claude.example.json (Claude, sonnet) и runners.qwen.example.json (Qwen, модель из LM Studio).":"Только чтение: надзор работает в UI, запущенном с --runners и секцией \"supervisor\" в runners.json."))}
  $("s-body").hidden=!st&&!journal.length;
  const tg=$("s-toggle");tg.hidden=!st||!ctl;if(st){tg.textContent=st.enabled?"Выключить":"Включить";tg.className="end"+(st.enabled?" ghost":"");tg.dataset.action=st.enabled?"stop":"start"}
  const needs=journal.filter(e=>e.kind==="needs-you"&&!e.resolvedAt);
  if(st){const [dc,label]=supState(st);const k=$("s-kpis");
    k.replaceChildren(
      kpi("Состояние",label,st.session?"сессия с "+time(st.session.startedAt)+" · "+st.session.incidents.length+" "+plural(st.session.incidents.length,"инцидент","инцидента","инцидентов"):st.held?st.held:st.queued?"в очереди: "+st.queued:st.enabled?"инцидентов нет":"включите кнопкой «Включить»",dc),
      kpi("Модель",st.model||"—","CLI: "+st.cli),
      kpi("Сессии за час",st.sessionsLastHour+" / "+st.maxSessionsPerHour,"лимит maxSessionsPerHour"),
      kpi("Расход 24ч",fmtUsd(st.spend24h.usd),(st.budgetUsd!==null?"бюджет $"+st.budgetUsd:"без бюджета")+(st.spend24h.unpriced?" · без цены: "+st.spend24h.unpriced:"")),
      kpi("Ждут вас",String(needs.length),needs.length?"решения только для человека":"нет вопросов к вам"))}
  else $("s-kpis").replaceChildren();
  // decisions only you can take: the question, its recommendation, a way to the task, "done"
  // rebuilt only when something changed: a rebuild between press and release would swallow the click
  const nb=$("s-needs");const nsig=needs.map(e=>e.id).join(",")+(ctl?"#c":"");
  if(nb.dataset.sig!==nsig){nb.dataset.sig=nsig;nb.replaceChildren();
  needs.slice().reverse().forEach(e=>{const c=el("div","card need");const hd=el("div","hd");hd.append(el("b","","Нужно ваше решение"),el("span","muted",(e.taskId?e.taskId+" · ":"")+time(e.at)));
    const parts=e.text.split("\nRecommendation: ");c.append(hd,el("div","",parts[0]));if(parts[1])c.append(el("div","rec","Рекомендация надзора: "+parts[1]));
    const r=el("div","row2");if(e.taskId){const o=el("button","ghost","Открыть задачу");o.type="button";o.onclick=()=>openTask(e.taskId);r.append(o)}
    if(ctl){
      // what to do with it: the recommendation or your own words go to the agent (an answer to its question, else to the lead); or just close
      const asked=e.data&&e.data.messageId,whom=asked?"ответом на вопрос агента ("+asked+")":"lead'у задачи";
      const note=el("span","note","");const ta=document.createElement("textarea");ta.placeholder="Ваш ответ — уйдёт "+whom;ta.hidden=true;
      const resolve=async(answer,btn)=>{if(answer!==undefined&&!answer.trim()){note.className="note err";note.textContent="Напишите ответ";return}
        btn.disabled=true;note.className="note";note.textContent="отправляю…";
        try{await post("/api/supervisor/resolve",answer===undefined?{id:e.id}:{id:e.id,answer:answer});nb.dataset.sig="";await tick()}catch(err){note.className="note err";note.textContent=err.message;btn.disabled=false}};
      if(parts[1]&&e.taskId){const a=el("button","","Принять рекомендацию");a.type="button";a.title="отправит рекомендацию надзора "+whom;a.onclick=()=>resolve(parts[1],a);r.append(a)}
      if(e.taskId){const w=el("button","ghost","Ответить по-своему");w.type="button";w.onclick=()=>{if(ta.hidden){ta.hidden=false;w.textContent="Отправить ответ";ta.focus()}else resolve(ta.value,w)};r.append(w)}
      const d=el("button","ghost","Закрыть без ответа");d.type="button";d.title=asked?"агент ничего не получит; его вопрос "+asked+" тоже закроется":"агент ничего не получит";d.onclick=()=>resolve(undefined,d);r.append(d,note);
      c.append(ta)}
    c.append(r);nb.append(c)})}
  // journal, newest first
  $("s-kinds").querySelectorAll("button").forEach(b=>{const k=b.dataset.k;b.classList.toggle("on",k===supKind);const n=k==="all"?journal.length:journal.filter(e=>e.kind===k).length;b.textContent=k;if(n)b.append(el("span","k",String(n)))});
  const shown=journal.filter(e=>supKind==="all"||e.kind===supKind).slice().reverse();const total=(SUP&&SUP.journalTotal)||journal.length;
  const jc=$("s-jcount");jc.replaceChildren();if(journal.length){jc.append(supAll?"все "+total:total>journal.length?"последние "+journal.length+" из "+total:String(total));
    if(total>100){const a=el("a","",supAll?" · только последние 100":" · показать все");a.href="#";a.onclick=async ev=>{ev.preventDefault();supAll=!supAll;await tick()};jc.append(a)}}
  const jb=$("s-journal");const jsig=supKind+"|"+shown.map(e=>e.id+(e.resolvedAt?"r":"")).join(",")+"|"+!!(st&&st.enabled);
  if(jb.dataset.sig!==jsig){jb.dataset.sig=jsig;jb.replaceChildren(...(shown.length?shown.map(e=>{const r=el("div","jrow"+(supOpen.has(e.id)?" open":"")+(e.resolvedAt?" resolved":""));r.title=new Date(e.at).toLocaleString([],{hour12:false});
    const tk=el("span","tk",e.taskId||"");if(e.taskId){tk.onclick=ev=>{ev.stopPropagation();go("tasks",route.project)}}
    r.append(el("span","tm",time(e.at)),el("span","jk "+e.kind,e.kind),el("span","by",e.by),tk,el("span","txt",e.text+(e.resolvedAt?"\n(решено "+time(e.resolvedAt)+")":"")));
    if(e.kind==="session"&&e.data&&e.data.session)r.append(...sessionBox(e));
    r.onclick=()=>{supOpen.has(e.id)?supOpen.delete(e.id):supOpen.add(e.id);r.classList.toggle("open")};return r}):[el("div","empty",st&&st.enabled?"Пока тихо: детектор ничего не нашёл.":"Журнал пуст.")]))}
  $("s-settings").hidden=$("s-tools").hidden=!st;if(!st)return;
  // settings: the model of the next session; the select is not rebuilt while you use it
  u.modelState.textContent=st.model?"модель следующей сессии: "+st.model+(st.session&&st.session.model&&st.session.model!==st.model?" (сейчас идёт "+st.session.model+")":""):"модель задана в command (поставьте {model} в command и \"model\" в секции supervisor, чтобы выбирать здесь)";
  u.form.hidden=!st.model||!ctl;u.hint.textContent=st.model&&st.models.length<2?"Список для выбора — supervisor.models в runners.json.":"";u.hint.hidden=!u.hint.textContent;
  const msig=st.models.join("|")+"#"+(st.model||"");
  if(st.model&&document.activeElement!==u.sel&&u.sel.dataset.server!==msig){u.sel.replaceChildren(...st.models.map(m=>new Option(m,m)),new Option("другая…","__other__"));u.sel.value=st.model;u.sel.dataset.server=msig}
  // thresholds: edited here, written to runners.json, applied at the detector's next look; not rebuilt while you type
  const rsig=JSON.stringify(st.rules)+(ctl?"#c":"");
  if(u.rules.dataset.sig!==rsig&&!u.rules.contains(document.activeElement)){u.rules.dataset.sig=rsig;u.rules.replaceChildren();u.rules.append(el("span","","задача стала BLOCKED, runner сдался"),el("b","","сразу"));
    RULES.forEach(([k,label,unit])=>{const inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="any";inp.value=String(st.rules[k]);inp.dataset.k=k;inp.disabled=!ctl;inp.title=unit==="×"?"раз":unit;
      const v=el("b","");v.append(inp,el("span","muted"," "+(unit==="×"?"раз":unit)));u.rules.append(el("span","",label),v)});
    if(ctl){const save=el("button","ghost","Сохранить пороги");save.type="button";const note=el("span","note","");
      save.onclick=async()=>{const rules={};let bad="";u.rules.querySelectorAll("input[data-k]").forEach(i=>{const n=Number(i.value);if(!(n>0))bad=i.dataset.k;rules[i.dataset.k]=n});
        if(bad){note.className="note err";note.textContent="порог должен быть больше 0";return}
        save.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/rules",{rules:rules})};u.rules.dataset.sig="";note.className="note ok";note.textContent="сохранено в runners.json";renderSupervisor()}catch(e){note.className="note err";note.textContent=e.message}finally{save.disabled=false}};
      const r=el("div","row2");r.style.gridColumn="1/-1";r.append(save,note);u.rules.append(r)}}
  // limits: sessions an hour and USD a day, edited here like the thresholds (not rebuilt while you type)
  const lsig=st.maxSessionsPerHour+"|"+st.budgetUsd+(ctl?"#c":"");
  if(u.limits.dataset.sig!==lsig&&!u.limits.contains(document.activeElement)){u.limits.dataset.sig=lsig;u.limits.replaceChildren();u.limits.className="rules";
    const num=(k,v,step,ph)=>{const i=document.createElement("input");i.type="number";i.min="0";i.step=step;i.dataset.k=k;i.value=v===null?"":String(v);i.placeholder=ph;i.disabled=!ctl;return i};
    const per=num("maxSessionsPerHour",st.maxSessionsPerHour,"1",""),bud=num("budgetUsd",st.budgetUsd,"any","нет");
    const b1=el("b","");b1.append(per,el("span","muted"," в час"));const b2=el("b","");b2.append(el("span","muted","$ "),bud,el("span","muted"," за сутки"));
    u.limits.append(el("span","","сессий надзора не больше"),b1,el("span","","расход надзора не больше (пусто — без бюджета)"),b2);
    if(ctl){const save=el("button","ghost","Сохранить лимиты");save.type="button";const note=el("span","note","");
      save.onclick=async()=>{const p=Number(per.value);const bv=bud.value.trim();
        if(!Number.isInteger(p)||p<1||p>100){note.className="note err";note.textContent="сессий в час: целое 1..100";return}
        if(bv!==""&&!(Number(bv)>=0)){note.className="note err";note.textContent="бюджет: число ≥ 0 или пусто";return}
        save.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/limits",{maxSessionsPerHour:p,budgetUsd:bv===""?null:Number(bv)})};u.limits.dataset.sig="";renderSupervisor()}catch(e){note.className="note err";note.textContent=e.message}finally{save.disabled=false}};
      const r=el("div","row2");r.style.gridColumn="1/-1";r.append(save,note);u.limits.append(r)}}
  // tools: rebuilt only when the list or a switch changed, so a click is never lost
  const tsig=st.tools.map(t=>t.name+(t.enabled?"+":"-")).join(",")+(ctl?"#c":"");
  if(u.tlist.dataset.sig!==tsig){u.tlist.dataset.sig=tsig;u.tlist.replaceChildren(...st.tools.map(t=>{const r=el("label","tl"+(t.enabled?"":" off"));const cb=document.createElement("input");cb.type="checkbox";cb.checked=t.enabled;cb.disabled=!ctl;
    cb.onchange=async()=>{cb.disabled=true;try{SUP={...SUP,status:await post("/api/supervisor/tools",{name:t.name,enabled:cb.checked})};renderSupervisor()}catch(e){alert(e.message);cb.checked=!cb.checked}finally{cb.disabled=false}};
    const nm=el("span","nm",t.name);if(!t.builtin)nm.append(" ",badge("","свой"));r.append(cb,nm,el("span","ds",t.description));return r}))}
  const lg=$("s-log");if($("s-logd").open){const atEnd=lg.scrollTop+lg.clientHeight>=lg.scrollHeight-8;lg.textContent=st.log.length?st.log.join("\n"):"(пусто)";if(atEnd)lg.scrollTop=lg.scrollHeight}
}

/* ---------- notes: what agents told you for information (fyi), no answer expected ---------- */
const nCards=new Map();const seenNotes={project:null,ids:new Set()};
function watchNotes(s){const list=s.operatorNotes||[];
  if(seenNotes.project!==s.project.id){seenNotes.project=s.project.id;seenNotes.ids=new Set(list.map(n=>n.taskId+"/"+n.messageId));return}
  for(const n of list){const k=n.taskId+"/"+n.messageId;if(seenNotes.ids.has(k))continue;seenNotes.ids.add(k);toast("",n.from+" → вам · "+n.taskId+" · к сведению",n.text,n.taskId)}}
function renderNotes(s){
  const list=s.operatorNotes||[];$("notes").hidden=!list.length;const box=$("nlist");const keep=new Set();
  for(const n of list){const key=route.project+"/"+n.taskId+"/"+n.messageId;keep.add(key);if(nCards.has(key))continue;
    const c=el("div","card fyi");const h=el("div","");h.append(el("span","who",n.from),el("span","tag","к сведению"),el("span","muted"," · "+n.taskId+" «"+n.taskTitle+"» · "+time(n.at)));c.append(h,el("div","",n.text));
    if(s.control){const r=el("div","row2");const ok=el("button","ghost","Ок");ok.type="button";ok.title="прочитано: убрать отсюда (агенту ничего не уходит)";
      ok.onclick=async()=>{ok.disabled=true;try{await post("/api/questions/dismiss",{taskId:n.taskId,messageId:n.messageId});await tick()}catch(e){ok.disabled=false;alert(e.message)}};r.append(ok,el("span","muted","ответа не ждёт"));c.append(r)}
    nCards.set(key,c);box.append(c)}
  for(const [key,c] of nCards)if(!keep.has(key)){c.remove();nCards.delete(key)}
}

/* ---------- switching projects ---------- */
function resetProject(){
  S=null;RUNS=[];SUP=null;n=0;knownIds="";openDetails.clear();supOpen.clear();["s-needs","s-journal"].forEach(id=>{$(id).dataset.sig="";$(id).replaceChildren()});supSessions.clear();supAll=false;if(supUi)supUi.tlist.dataset.sig="";
  for(const c of runnerCards.values())c.root.remove();runnerCards.clear();
  for(const c of qCards.values())c.remove();qCards.clear();for(const c of nCards.values())c.remove();nCards.clear();
  ["tasks","runs","events","agents","kpis","ov-runners","ov-phases","ov-events"].forEach(id=>$(id).replaceChildren());
  ["f-agent","f-task","f-model","f-status","e-task","e-type"].forEach(id=>{$(id).dataset.sig="";$(id).value=""});expandedRuns.clear();
  $("newtask").hidden=true;$("formnote").textContent="";$("openspec").replaceChildren(new Option("— без OpenSpec —",""),new Option("+ написать новый change…","__new__"));$("proposes-row").hidden=true;
}
// a hidden tab does not refresh (each refresh reads the whole network); it catches up the moment it is shown again
showTab();tick();setInterval(()=>{if(!document.hidden)tick()},2000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick()});
</script>
</body>
</html>`;
