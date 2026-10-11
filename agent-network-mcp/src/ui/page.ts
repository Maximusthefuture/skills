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
.proj b{display:flex;align-items:center;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.proj span.s{display:block;color:var(--muted);font:11px var(--mono);margin-top:2px}
.grp{padding:10px 16px 4px;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
nav a{display:flex;align-items:center;gap:10px;padding:7px 16px;color:var(--muted);text-decoration:none;border-left:2px solid transparent}
nav a .n{font:11px var(--mono);color:var(--idle);width:16px}nav a .c{margin-left:auto;font:11px var(--mono)}
nav a.on{color:var(--text);background:var(--card);border-left-color:var(--accent)}nav a:hover{color:var(--text)}
.foot{margin-top:auto;padding:12px 16px;border-top:1px solid var(--line);color:var(--muted);font:11px var(--mono);word-break:break-all}
.top{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:10px 24px;border-bottom:1px solid var(--line);font:11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.04em;background:var(--bg);position:sticky;top:0;z-index:2}
.top b{color:var(--text);font-weight:500;margin-left:4px}.top .link{cursor:pointer}.top .link:hover b{text-decoration:underline}.top .r{margin-left:auto;text-transform:none}.top .warnq b{color:var(--warn)}
main{padding:20px 24px 40px;max-width:1180px}
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
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.agent .top2,.runner .top2{display:flex;align-items:center;gap:8px;font-weight:600}.runner .top2 button{margin-left:auto}.runner .line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
form.card{display:grid;gap:10px;margin-bottom:14px}form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
input,textarea,select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:6px 8px;width:100%}
textarea{min-height:90px;resize:vertical}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.checks{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;color:var(--text);font-size:13px}.checks input{width:auto}
button{font:inherit;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:7px;padding:6px 14px;cursor:pointer}
button.ghost{background:transparent;color:var(--accent)}button:disabled{opacity:.5;cursor:default}
.note{font-size:13px}.note.err{color:var(--bad)}.note.ok{color:var(--ok)}
.banner{padding:10px 14px;margin-bottom:14px;border:1px solid var(--line);border-left:3px solid var(--bad);background:var(--card)}
.openspec{margin-top:6px;padding:6px 10px;border-left:3px solid var(--accent);background:var(--bg)}
.toasts{position:fixed;top:12px;right:12px;z-index:50;display:flex;flex-direction:column;gap:8px;width:min(340px,calc(100vw - 24px));pointer-events:none}
.toast{pointer-events:auto;cursor:pointer;position:relative;background:var(--card);color:var(--text);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:9px 30px 9px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font-size:13px;animation:tin .18s ease-out}
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
.arow .who{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arow .sum{font:12px/1.45 var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
.jsess{grid-column:1/-1;display:flex;gap:10px;align-items:center;font:11px var(--mono);color:var(--muted);min-width:0}.jsess span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jsess button{padding:2px 10px;font-size:12px;flex:none}
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
.srow input{width:auto;margin:0}.srow .nm b{display:block}.srow .nm span,.srow .sub2{font-size:12px;color:var(--muted)}.srow .cr{font:12px var(--mono)}.srow .last.err{color:var(--bad)}.srow .last.skip{color:var(--warn)}.srow button{padding:4px 12px;white-space:nowrap}.srow.off .nm,.srow.off .cr{opacity:.55}
@media (max-width:820px){.srow{grid-template-columns:auto minmax(0,1fr) auto}.srow .cr,.srow .nx,.srow .last{grid-column:2}}
.compose{margin:6px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}.compose.open{border-color:var(--accent)}
.compose .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.compose .hd button{padding:4px 12px}.compose .hd .muted{font-size:12px}
.compose textarea{min-height:76px;margin-top:8px;background:var(--card)}.compose .row2{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.compose .row2 button{padding:5px 14px}
.compose .who{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--muted)}.compose .who button{padding:1px 9px;font-size:12px;border-radius:999px}
.compose .hist{margin-top:8px;font-size:12px}.compose .hist div{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:8px;padding:4px 0;border-top:1px solid var(--line)}.compose .hist .tm{color:var(--muted);font-family:var(--mono)}.compose .hist .rd{color:var(--muted);white-space:nowrap}.compose .hist .rd.ok{color:var(--ok)}
@media (max-width:700px){.jrow{grid-template-columns:56px 74px minmax(0,1fr)}.jrow .by{display:none}.jrow .txt{grid-column:1/-1}}
.ptl{display:flex;gap:3px;height:26px;margin:10px 0}
.ptl .seg{min-width:84px;display:block;line-height:24px;text-align:center;padding:0 8px;font:11px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--bg);color:var(--muted);border:1px solid var(--line);border-radius:5px}
.ptl .seg.past,.ptl .seg.now,.ptl .seg.bad{min-width:140px}
.ptl .seg .rd{display:inline-flex;gap:2px;margin-left:6px;vertical-align:1px}.ptl .seg .rd i{width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.45}.ptl .seg .rd i.last{opacity:1}
.ptl .seg.past{background:var(--okbg);color:var(--ok);border-color:transparent}.ptl .seg.now{background:var(--accbg);color:var(--accent);border-color:var(--accent);font-weight:600}.ptl .seg.bad{background:var(--badbg);color:var(--bad);border-color:var(--bad);font-weight:600}
.pbar{height:8px;border-radius:4px;background:var(--card2);border:1px solid var(--line);overflow:hidden;display:flex}.pbar>span{height:100%}.pbar .g{background:var(--ok)}.pbar .b{background:var(--accent)}.pbar .r{background:var(--bad)}
.pbar.wait{background:repeating-linear-gradient(45deg,var(--card2) 0 6px,var(--line) 6px 8px)}
.pkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:4px 0 10px}
.pk{background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px 12px}.pk .l{font-size:12px;color:var(--muted)}.pk .v{font:500 18px var(--mono);margin:2px 0 6px}.pk .v small{font-size:12px;color:var(--muted);margin-left:6px;font-weight:400}.pk .h{font-size:12px;color:var(--muted);margin-top:5px}
.pagents{margin:2px 0 10px}.prow{display:grid;grid-template-columns:130px minmax(0,1fr) 56px;gap:12px;align-items:center;padding:7px 0;border-top:1px solid var(--line)}
.prow .nm b{display:block;font-size:13px}.prow .nm span{font:11px var(--mono);color:var(--muted)}
.prow .st{font-size:12px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prow .st.ok{color:var(--ok)}.prow .st.warn{color:var(--warn)}.prow .st.now{color:var(--text)}.prow .st.bad{color:var(--bad)}
.prow .cnt{font:12px var(--mono);text-align:right;color:var(--muted)}.prow .cnt b{color:var(--text);font-weight:500}
.plegend{display:flex;gap:14px;font-size:11px;color:var(--muted);margin-top:6px}.plegend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.ovp{display:grid;grid-template-columns:minmax(0,1.5fr) 104px minmax(0,2fr) 70px;gap:12px;align-items:center;padding:8px 14px;border-top:1px solid var(--line);cursor:pointer;font-size:13px}.ovp:hover{background:var(--card2)}
.ovp .tt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ovp .tt span{color:var(--muted);font:11px var(--mono);margin-right:6px}.ovp .badge{text-align:center}.ovp .pct{font:12px var(--mono);text-align:right}
@media (max-width:700px){.ptl .seg,.ptl .seg.past,.ptl .seg.now,.ptl .seg.bad{min-width:0;padding:0 4px;font-size:10px}.ovp{grid-template-columns:minmax(0,1fr) auto}.ovp .pbar{grid-column:1/-1}.ovp .pct{grid-row:1;grid-column:2}.ovp .badge{display:none}.prow{grid-template-columns:90px minmax(0,1fr) 44px}}
.tscroll{overflow-x:auto}
.acards{display:grid;gap:10px;margin:10px 0}
.acard{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:10px 12px;min-width:0}
.acard .ah{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.acard .ah b{font-size:14px}.acard .tag{font:11px var(--mono);color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:0 7px}
.acard .stats2{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center}.acard .stats2 .chip{font:11px var(--mono)}
.acard .ag{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px;margin-top:8px}
.acard .lbl{font:10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px}
.acard .txt{font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.acard .asec{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)}
.acard .find{display:flex;gap:8px;align-items:flex-start;margin-top:5px;font-size:13px}.acard .find .badge{flex:none;margin-top:1px}.acard .find>*:last-child{min-width:0;flex:1}
.acard .scroll.subs{margin-top:0;max-height:170px}
.icard{border-left:3px solid var(--accent);margin-bottom:10px}
details.more{margin:0}details.more>summary{list-style:none;cursor:pointer;color:var(--text);font-size:13px;line-height:1.5}details.more>summary::-webkit-details-marker{display:none}
details.more>summary .tg::after{content:"ещё ▾";color:var(--accent);font-size:12px;white-space:nowrap}details.more[open]>summary .tg::after{content:"свернуть ▴"}details.more[open]>summary .pv{display:none}
@media (max-width:820px){.acard .ag{grid-template-columns:1fr}.acard .stats2{margin-left:0}}
tr.exp td{background:var(--bg)}.detail{display:grid;gap:4px;font-size:13px;padding:4px 0 6px 18px}
[hidden]{display:none!important}.nw{white-space:nowrap}.path{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
    <a href="#/overview" data-tab="overview"><span class="n">01</span>Обзор</a>
    <a href="#/tasks" data-tab="tasks"><span class="n">02</span>Задачи<span class="c" id="c-tasks"></span></a>
    <a href="#/runs" data-tab="runs"><span class="n">03</span>Запуски<span class="c" id="c-runs"></span></a>
    <a href="#/activity" data-tab="activity"><span class="n">04</span>Активность<span class="c" id="c-activity"></span></a>
    <div class="grp">Инфраструктура</div>
    <a href="#/supervisor" data-tab="supervisor"><span class="n">05</span>Надзор<span class="c" id="c-supervisor"></span></a>
    <a href="#/runners" data-tab="runners"><span class="n">06</span>Runner'ы<span class="c" id="c-runners"></span></a>
    <a href="#/projects" data-tab="projects"><span class="n">07</span>Проекты<span class="c" id="c-projects"></span></a>
    <a href="#/events" data-tab="events"><span class="n">08</span>События</a>
  </nav>
  <div class="foot">сеть<br><span id="dir"></span></div>
</aside>
<div>
  <div class="top" id="topbar"></div>
  <main>
    <div class="banner note err" id="priceerr" hidden></div>
    <section id="questions" hidden><div class="grid" id="qlist"></div><div style="height:14px"></div></section>
    <section id="notes" hidden><div class="grid" id="nlist"></div><div style="height:14px"></div></section>

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
        <label>OpenSpec change (необязательно): агенты делят его tasks.md по номерам задач<select name="openspec" id="openspec"><option value="">— без OpenSpec —</option></select></label>
        <label>Название<input name="title" maxlength="200" placeholder="Отмена заказа: POST /orders/{id}/cancel"></label>
        <label>Описание — конкретно: что сделать, где, ожидаемое поведение, кто что делает (с OpenSpec change — необязательно)<textarea name="description" placeholder="Отменять можно NEW и PAID; при PAID писать событие OrderCancelled. backend — API и сервис, reviewer — тесты."></textarea></label>
        <div class="row"><label>Lead (интегрирует)<select name="lead" id="lead"></select></label><label>Остальные агенты<div class="checks" id="others"></div></label></div>
        <div class="row">
          <label>Сборка и тесты (--verify)<input name="verifyCommand" placeholder="./mvnw -q verify"></label>
          <label>Follow-up задач на цепочку<input name="maxFollowUps" type="number" min="0" max="20" value="0"></label>
          <label>Раундов исправлений<input name="maxFixRounds" type="number" min="0" max="20" value="3"></label>
        </div>
        <div class="checks"><button type="submit">Создать задачу</button><span class="note" id="formnote"></span></div>
      </form>
      <div class="panel" id="schedules" hidden></div>
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
      <h2>Агенты в сети</h2><div class="grid" id="agents"></div>
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
const TABS=["overview","tasks","runs","activity","supervisor","runners","projects","events"];
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
function parseHash(){const m=location.hash.replace(/^#\/?/,"").split("/");return {tab:TABS.includes(m[0])?m[0]:"overview",project:m[1]?decodeURIComponent(m[1]):null}}
function go(tab,project){location.hash="#/"+tab+(project?"/"+encodeURIComponent(project):"")}
function q(path){return path+(route.project?(path.includes("?")?"&":"?")+"project="+encodeURIComponent(route.project):"")}
async function getJSON(path){const r=await fetch(path,{cache:"no-store"});if(!r.ok)throw new Error(r.status+"");return r.json()}
async function post(url,body){const r=await fetch(q(url),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body||{})});const t=await r.text();let j;try{j=JSON.parse(t)}catch(e){j={message:t}}if(!r.ok)throw new Error(j.message||t);return j}
window.addEventListener("hashchange",()=>{const r=parseHash();const switched=r.project&&r.project!==route.project;route.tab=r.tab;if(r.project)route.project=r.project;if(switched)resetProject();showTab();tick()});
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
    n++;render();
  }catch(e){$("topbar").textContent="нет связи с сервером"}
}
function render(){if(!S)return;const y=window.scrollY;renderChrome();renderQuestions(S);renderNotes(S);
  if(route.tab==="overview")renderOverview();if(route.tab==="tasks")renderTasks();if(route.tab==="runs")renderRuns();
  if(route.tab==="runners"){renderControl(S);renderAgents(S)}if(route.tab==="projects")renderProjects();if(route.tab==="events")renderEvents();if(route.tab==="activity")renderActivity();if(route.tab==="supervisor")renderSupervisor();
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
  document.title=(oq?"("+oq+") ":"")+s.project.name+" · Agent Network";
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
      const nowTxt=r.session?(r.session.taskId+(cur?" · "+cur.phase:"")+(live.length?" · "+live.filter(x=>x.status==="DONE").length+"/"+live.length+" подзадач":"")):r.running?"ждёт задачу":"остановлен";
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

/* ---------- pop-ups: a task changed its phase or status ---------- */
const seenTasks=new Map();let seenProject=null;
const phaseName=t=>t.phase+(t.phase==="SYNC"&&t.syncRound?" #"+t.syncRound:"");
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
  d.onclick=()=>{d.remove();if(tab){go(tab,route.project);return}go("tasks",route.project);if(taskId)setTimeout(()=>{const c=document.querySelector('#tasks [data-id="'+taskId+'"]');if(c)c.scrollIntoView({block:"start",behavior:"smooth"})},300)};
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
    const cnt=el("div","cnt");if(subs.length){cnt.append(el("b","",String(d)),"/"+subs.length)}else cnt.append("—");
    row.append(nm,mid,cnt);list.append(row)}
  box.append(list);
  const lg=el("div","plegend");[["var(--ok)","готово"],["var(--accent)","в работе"],["var(--line)","ждёт"]].forEach(([c,l])=>{const sp=el("span");const i=el("i");i.style.background=c;sp.append(i,l);lg.append(sp)});box.append(lg);
  return box}
/** Overview: every open task on one line with how far it is. */
function renderOvProgress(){
  const box=$("ov-progress");const open=S.tasks.filter(t=>t.queue==="running"||t.queue==="blocked"||t.queue==="queued").sort((a,b)=>["running","blocked","queued"].indexOf(a.queue)-["running","blocked","queued"].indexOf(b.queue)||a.id.localeCompare(b.id));
  box.hidden=!open.length;box.replaceChildren();if(!open.length)return;
  const ph=el("div","ph","Прогресс задач");ph.append(el("span","end","OpenSpec-задачи, иначе подзадачи агентов"));box.append(ph);
  for(const t of open){const pr=progressOf(t);const row=el("div","ovp");row.title="открыть задачу";
    row.onclick=()=>{go("tasks",route.project);setTimeout(()=>{const c=document.querySelector('#tasks [data-id="'+t.id+'"]');if(c)c.scrollIntoView({block:"start",behavior:"smooth"})},300)};
    const tt=el("div","tt");tt.append(el("span","",t.id),t.title);
    const blocked=t.status==="BLOCKED",queued=t.queue==="queued";
    const pill=badge(blocked?"BLOCKED":queued?"queued":"running",blocked?"BLOCKED":queued?"в очереди":phaseName(t));
    const bar=blocked?pbar([[pr.share||0,"r"]]):queued?pbar([]):pbar([[pr.share||0,"g"],[pr.doingShare,"b"]]);
    const pct=el("div","pct",blocked?"р. "+t.syncRound+"/"+t.maxFixRounds:queued||pr.share===null?"—":Math.round(pr.share*100)+"%");
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
    b.onclick=async()=>{if(!confirm("openspec archive "+o.change+" в папке проекта? Change переедет в openspec/changes/archive, его спеки — в openspec/specs."))return;
      archiveState.set(key,{pending:true});render();
      try{const res=await post("/api/openspec/archive",{taskId:t.id});archiveState.set(key,{output:res.output||"готово"})}catch(e){archiveState.set(key,{error:e.message})}await tick()};
    r.append(b);if(!ready)r.append(el("span","note","сначала влейте ветку lead'а в папку проекта: lead отмечает задачи у себя"));box.append(r);
  }
  const st=archiveState.get(key);if(st&&(st.output||st.error))box.append(el("pre","log"+(st.error?" err":""),st.error||st.output));
  return box;
}
const unblockState=new Map();
function renderBlocked(t){
  const box=el("div","blocked");box.append(badge("BLOCKED")," "+(t.blockedReason||"лимит раундов исправлений исчерпан"));
  if(!controlMode){box.append(el("span","muted"," — нужен оператор: task unblock / task cancel"));return box}
  const key=route.project+"/"+t.id;const st=unblockState.get(key)||{};
  const act=async(what,body,question)=>{if(!confirm(question))return;unblockState.set(key,{pending:true});render();
    try{await post("/api/tasks/"+encodeURIComponent(t.id)+"/"+what,body);unblockState.delete(key)}catch(e){unblockState.set(key,{error:e.message})}await tick()};
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
  if(st.costUsd!==null)item("стоимость",fmtUsd(st.costUsd,st.costEstimated)+(st.costEstimated?" (по ценам из runners.json)":""));
  if(st.unpricedModels&&st.unpricedModels.length)item("нет цены для",st.unpricedModels.join(", ")+" — добавьте в \"prices\" в runners.json");
  if(st.sessions)item("сессий",String(st.sessions)+(st.sessionsWithoutUsage&&st.usage?" ("+st.sessionsWithoutUsage+" без токенов)":""));
  box.append(line);
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
  const hd=el("div");const h3=el("h3","",t.id+" · "+t.title);const sch=scheduleOf(t);if(sch)h3.append(badge("","по расписанию "+sch));h3.append(badge(t.queue,QUEUE[t.queue]||t.queue));if(t.openspec)h3.append(badge("","OpenSpec"));hd.append(h3);hd.append(el("div","muted",t.description));
  const chain=[];if(t.parentTaskId)chain.push("follow-up от "+t.parentTaskId);if(t.followUps&&t.followUps.length)chain.push("follow-up задачи: "+t.followUps.join(", "));if(t.followUpBudget)chain.push("бюджет follow-up: "+t.followUpBudget.used+"/"+t.followUpBudget.max);
  if(chain.length)hd.append(el("div","muted",chain.join(" · ")));
  if(t.openspec)hd.append(renderOpenspec(t));
  hd.append(renderStats(t));
  if(t.status==="BLOCKED")hd.append(renderBlocked(t));
  if(t.takeover&&t.status!=="BLOCKED")hd.append(el("div","muted","Lead взял исправление "+t.takeover.from.join(", ")+" в раунде "+t.takeover.round+" ("+(t.takeover.by==="timeout"?"оператор не ответил вовремя":"передал оператор")+")."));
  c.append(hd);
  if(t.stats)c.append(phaseBar(t));
  else{const steps=el("div","steps");const idx=PHASES.indexOf(t.phase);
    PHASES.forEach((p,i)=>steps.append(el("div","step"+(i<idx?" past":i===idx?" now":""),p+(p==="SYNC"&&t.syncRound&&idx>=2?" #"+t.syncRound:""))));
    c.append(steps)}
  if(t.status==="ACTIVE"||t.status==="BLOCKED")c.append(progressBlock(t));
  if(S.control&&(t.status==="ACTIVE"||t.status==="BLOCKED"))c.append(renderCompose(t));
  if(t.waitingOn.length){const w=el("div","chips");w.append(el("span","muted","ждём:"));t.waitingOn.forEach(x=>w.append(el("span","chip",x)));c.append(w)}
  // one card per agent: who, statuses at a glance, its part and its plan side by side, its report and the review short (full on click)
  const cards=el("div","acards");const lead=t.agents[0];const rs=S.control?S.control.runners:[];
  for(const id of t.agents){
    const card=el("div","acard");const hd=el("div","ah");
    const as=t.agreement&&t.agreement.assignments.find(a=>a.agentId===id);const ap=t.agreement&&t.agreement.approvedBy.includes(id);
    const im=t.implementations.find(i=>i.agentId===id);const rep=t.syncReports.filter(x=>x.agentId===id&&x.round===t.syncRound).pop();
    const subs=(t.subtasks&&t.subtasks[id])||[];const live=subs.filter(x=>x.status!=="DROPPED");const r=rs.find(x=>x.id===id);
    const model=r&&r.model||(t.stats&&(t.stats.agents.find(a=>a.agentId===id)||{models:[]}).models[0])||"";
    hd.append(el("b","",id));if(id===lead)hd.append(el("span","tag","lead"));if(model)hd.append(el("span","muted mono",model));
    if(S.control&&id===t.agents[0]&&(t.status==="ACTIVE"||t.status==="BLOCKED")){const m=el("button","mail");m.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';m.type="button";m.title="написать lead'у "+id+": он передаст остальным";m.setAttribute("aria-label",m.title);
      m.onclick=()=>{const key=route.project+"/"+t.id;composeOpen.add(key);render();const ta=document.querySelector('[data-compose="'+key+'"] textarea');if(ta){ta.scrollIntoView({block:"center",behavior:"smooth"});ta.focus({preventScroll:true})}};hd.append(m)}
    const st=el("span","stats2");
    if(t.agreement)st.append(badge(ap?"PASS":"WAITING",ap?"agreement ✓":"agreement ждёт"));
    if(live.length)st.append(el("span","chip",live.filter(x=>x.status==="DONE").length+"/"+live.length+" подзадач"));
    st.append(im?badge(im.status):badge("","не сдавал"));
    if(rep)st.append(badge(rep.status,"ревью #"+t.syncRound+": "+rep.status));
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
function renderSchedules(s){
  const box=$("schedules");const list=s.schedules||[];box.hidden=!list.length;if(!list.length){box.replaceChildren();return}
  const sig=JSON.stringify(list)+"|"+Math.floor(Date.now()/60000)+"|"+JSON.stringify([...schedState])+"|"+!!s.control;if(box.dataset.sig===sig)return;box.dataset.sig=sig;
  const ph=el("div","ph","По расписанию");ph.append(el("span","end","cron из runners.json · задача не ставится, пока предыдущая из того же расписания открыта"));
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
    r.append(sw,nm,el("div","cr",x.cron),nx,last,b);return r});
  box.replaceChildren(ph,...rows)}
function scheduleOf(t){for(const x of (S.schedules||[]))if(x.runs.some(r=>r.taskId===t.id))return x.id;return null}
function renderTasks(){
  renderSchedules(S);
  if(document.activeElement&&document.activeElement.matches&&document.activeElement.matches("#tasks .compose textarea"))return; // you are writing to a lead: the refresh waits
  const s=S;$("newbtn").hidden=!s.control;if(!s.control)$("newtask").hidden=true;
  $("tasks-lead").textContent="Текущие и завершённые задачи проекта "+s.project.name+"."+(s.control?"":" Только чтение: чтобы ставить задачи, запустите UI с --runners.");
  updateForm(s);
  const box=$("tasks");
  // the cards are rebuilt on every refresh: keep which details are open and where their lists are scrolled
  if(box.querySelector("[data-id]")){openDetails.clear();box.querySelectorAll("details[open]").forEach(d=>{const card=d.closest("[data-id]");if(card)openDetails.add(card.dataset.id+"|"+(d.dataset.key||d.firstChild.textContent.split(" ")[0]))})}
  const scrolls=new Map();box.querySelectorAll("[data-scroll]").forEach(b=>{if(b.closest("details:not([open])"))return;const card=b.closest("[data-id]");if(card)scrolls.set(card.dataset.id+"|"+b.dataset.scroll,{top:b.scrollTop,atEnd:b.scrollTop+b.clientHeight>=b.scrollHeight-8})});
  // build every card first and swap them in at once: measuring a half-built list would shrink the page and reset its scroll
  const cards=s.tasks.map(t=>{const c=renderTask(t);c.dataset.id=t.id;
    c.querySelectorAll("[data-scroll]").forEach(b=>{const sv=scrolls.get(t.id+"|"+b.dataset.scroll);if(sv&&!(b.dataset.scroll==="msgs"&&sv.atEnd))b.dataset.top=String(sv.top)}); // at the bottom of messages: stay at the newest
    c.querySelectorAll("details").forEach(d=>{if(openDetails.has(t.id+"|"+(d.dataset.key||d.firstChild.textContent.split(" ")[0])))d.open=true});return c});
  box.replaceChildren(...(cards.length?cards:[el("div","empty",s.control?"Задач нет. Нажмите «+ Новая задача».":"Задач нет. Создайте: agent-network-mcp task create --title … --agents a,b")]));
  cards.forEach(c=>c.querySelectorAll("[data-scroll]").forEach(b=>{if(b.closest("details"))return;const sv=scrolls.get(c.dataset.id+"|"+b.dataset.scroll);
    if(sv)b.scrollTop=sv.top;else{const cur=b.querySelector(".DOING");if(cur)b.scrollTop+=cur.getBoundingClientRect().top-b.getBoundingClientRect().top-b.clientHeight/3}}));
}
$("newbtn").onclick=()=>{const f=$("newtask");f.hidden=!f.hidden;if(!f.hidden){loadChanges();f.elements.namedItem("title").focus()}};
let knownIds="";
function updateForm(s){
  const ids=[...new Set([...(s.control?s.control.runners.map(r=>r.id):[]),...s.agents.map(a=>a.id).filter(id=>id!=="operator")])];
  if(ids.join(",")!==knownIds){knownIds=ids.join(",");const lead=$("lead");const keep=lead.value;lead.replaceChildren();ids.forEach(id=>lead.append(new Option(id,id)));if(ids.includes(keep))lead.value=keep;renderOthers(ids)}
}
function renderOthers(ids){const box=$("others");const checked=new Set([...box.querySelectorAll("input:checked")].map(i=>i.value));const lead=$("lead").value;box.replaceChildren();
  ids.forEach(id=>{const l=el("label","");l.style.display="inline-flex";l.style.gap="4px";const i=document.createElement("input");i.type="checkbox";i.value=id;i.checked=checked.size?checked.has(id):id!==lead;i.disabled=id===lead;if(id===lead)i.checked=false;l.append(i,id);box.append(l)})}
$("lead").addEventListener("change",()=>renderOthers(knownIds.split(",")));
async function loadChanges(){try{const j=await getJSON(q("/api/openspec/changes"));const sel=$("openspec");const keep=sel.value;
  sel.replaceChildren(new Option("— без OpenSpec —",""),...j.changes.map(c=>{const o=new Option(c.name+(c.error?" (не читается: "+c.error+")":" ("+c.done+"/"+c.total+" задач отмечено)"),c.name);o.disabled=!!c.error;return o}));
  if([...sel.options].some(o=>o.value===keep))sel.value=keep;sel.title=j.changes.length?"":"в "+j.projectDir+"/openspec/changes нет change'ей"}catch(e){}}
$("openspec").addEventListener("focus",loadChanges);
$("openspec").addEventListener("change",ev=>{const t=$("newtask").elements.namedItem("title");t.placeholder=ev.target.value||"Отмена заказа: POST /orders/{id}/cancel"});
$("newtask").addEventListener("submit",async ev=>{ev.preventDefault();const f=ev.target;const note=$("formnote");const btn=f.querySelector("button");
  const others=[...$("others").querySelectorAll("input:checked")].map(i=>i.value);const v=n=>f.elements.namedItem(n);
  if(!v("openspec").value&&(!v("title").value.trim()||!v("description").value.trim())){note.className="note err";note.textContent="Нужны название и описание (или выберите OpenSpec change).";return}
  btn.disabled=true;note.className="note";note.textContent="создаю…";
  try{const r=await post("/api/tasks",{title:v("title").value,description:v("description").value,agents:[v("lead").value,...others],verifyCommand:v("verifyCommand").value,maxFollowUps:v("maxFollowUps").value,maxFixRounds:v("maxFixRounds").value,openspec:v("openspec").value});
    note.className="note ok";note.textContent="Создана "+r.task.id+": "+r.task.title+". Runner'ы подхватят её за пару секунд.";v("title").value="";v("description").value="";v("openspec").value="";await tick()}
  catch(e){note.className="note err";note.textContent=e.message}finally{btn.disabled=false}});

/* ---------- runs ---------- */
function fillSelect(id,label,values,fmt){const sel=$(id);const keep=sel.value;const sig=values.join("|");if(sel.dataset.sig===sig)return;sel.dataset.sig=sig;
  sel.replaceChildren(new Option(label,""),...values.map(v=>new Option(fmt?fmt(v):v,v)));if(values.includes(keep))sel.value=keep}
["f-agent","f-task","f-model","f-status","e-task","e-type"].forEach(id=>$(id).addEventListener("change",render));
const STATUS={running:"идёт",ok:"ок",turns:"лимит ходов",stopped:"остановлена",failed:"ошибка"};
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
    c.info.textContent=(r.session?"сейчас: "+r.session.taskId+" · сессия #"+r.session.attempt+" · "+since(r.session.startedAt):r.running&&r.startedAt?"ждёт задачу · запущен "+ago(r.startedAt):r.stoppedAt?"остановлен "+ago(r.stoppedAt):"не запускался")+(mine.length?" · за 24ч "+fmtUsd(mine.reduce((a,x)=>a+x.costUsd,0),mine.some(x=>x.costEstimated)):"");
    c.cwd.textContent=r.cwd?"папка: "+r.cwd:"папка: текущая";c.cwd.title=r.cwd||"";
    c.cmd.textContent=r.command;c.cmd.title=r.command;
    miniFeed(r.id,c.feed);
    c.modelHint.textContent=r.model&&r.models.length<2?"Список моделей для выбора — поле \"models\" в runners.json (в defaults или у агента).":"";c.modelHint.hidden=!c.modelHint.textContent;
    c.modelState.textContent=r.model?"модель: "+r.model:"модель: задана в command (поставьте {model} в command и \"model\" в runners.json, чтобы выбирать здесь)";c.modelForm.hidden=!r.model;
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
    const c=el("div","card q");const h=el("div","");h.append(el("span","who",qq.from),el("span","muted"," · "+qq.taskId+" «"+qq.taskTitle+"» · "+time(qq.askedAt)));c.append(h,el("div","",qq.question));
    if(s.control){const f=el("form","");const ta=document.createElement("textarea");ta.placeholder="Ваш ответ агенту "+qq.from;const r2=el("div","row2");const b=el("button","","Ответить");b.type="submit";const note=el("span","note","");
      const x=el("button","ghost","Закрыть без ответа");x.type="button";x.title="агент ничего не получит: например, он уже сделал по своему предложению или вопрос решён иначе";
      x.onclick=async()=>{if(!confirm("Закрыть вопрос "+qq.from+" без ответа? Агент ничего не получит."))return;x.disabled=true;try{await post("/api/questions/dismiss",{taskId:qq.taskId,messageId:qq.messageId});await tick()}catch(e){note.className="note err";note.textContent=e.message;x.disabled=false}};
      r2.append(b,x,note);f.append(ta,r2);
      f.onsubmit=async ev=>{ev.preventDefault();if(!ta.value.trim())return;b.disabled=true;note.className="note";note.textContent="отправляю…";
        try{await post("/api/questions/answer",{taskId:qq.taskId,messageId:qq.messageId,answer:ta.value});note.className="note ok";note.textContent="отправлено";await tick()}catch(e){note.className="note err";note.textContent=e.message;b.disabled=false}};
      c.append(f)}else c.append(el("div","muted","ответить можно из UI, запущенного с --runners"));
    qCards.set(key,c);box.append(c)}
  for(const [key,c] of qCards)if(!keep.has(key)){c.remove();qCards.delete(key)}
}

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
    const r=el("div","row2");if(e.taskId){const o=el("button","ghost","Открыть задачу");o.type="button";o.onclick=()=>{go("tasks",route.project);setTimeout(()=>{const x=document.querySelector('#tasks [data-id="'+e.taskId+'"]');if(x)x.scrollIntoView({block:"start",behavior:"smooth"})},300)};r.append(o)}
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
  $("newtask").hidden=true;$("formnote").textContent="";$("openspec").replaceChildren(new Option("— без OpenSpec —",""));
}
showTab();tick();setInterval(tick,2000);
</script>
</body>
</html>`;
