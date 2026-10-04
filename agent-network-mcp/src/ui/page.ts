/** Single-file page: vanilla JS, no dependencies. All dynamic text goes through textContent (never innerHTML). */
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Network</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1c2128;--muted:#667085;--line:#e3e6eb;--accent:#2f6fed;--ok:#16a34a;--warn:#d97706;--bad:#dc2626;--idle:#98a2b3}
@media (prefers-color-scheme:dark){:root{--bg:#0f1318;--card:#171c23;--text:#e6e9ee;--muted:#98a2b3;--line:#2a313b;--accent:#6b9bff;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--idle:#667085}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--card)}
h1{font-size:16px;margin:0}h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:22px 0 8px}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
main{max-width:1100px;margin:0 auto;padding:0 20px 40px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.agent .top{display:flex;align-items:center;gap:8px;font-weight:600}
.dot{width:9px;height:9px;border-radius:50%;background:var(--idle);flex:none}
.ONLINE .dot,.WORKING .dot{background:var(--ok)}.WAITING .dot{background:var(--warn)}.DEAD .dot{background:var(--bad)}
.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid var(--line);color:var(--muted)}
.badge.ONLINE,.badge.WORKING,.badge.PASS,.badge.READY_FOR_SYNC{color:var(--ok);border-color:var(--ok)}.badge.WAITING,.badge.IN_PROGRESS{color:var(--warn);border-color:var(--warn)}.badge.DEAD,.badge.NEEDS_FIX,.badge.ERROR{color:var(--bad);border-color:var(--bad)}
.task{margin-bottom:12px}.task.done{opacity:.75}
.task h3{margin:0 0 2px;font-size:15px}
.steps{display:flex;gap:4px;margin:10px 0}.step{flex:1;text-align:center;font-size:11px;padding:4px 0;border-radius:6px;background:var(--bg);color:var(--muted);border:1px solid var(--line)}
.step.past{color:var(--ok)}.step.now{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.chip{padding:1px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--line);font-size:12px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:5px 8px 5px 0;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted)}
.msg{padding:4px 0;border-bottom:1px solid var(--line)}.msg:last-child{border:0}
.empty{color:var(--muted);padding:12px 0}
</style>
</head>
<body>
<header><h1>Agent Network</h1><span class="muted mono" id="dir"></span><span class="muted" id="upd"></span></header>
<main>
<h2>Агенты</h2><div class="grid" id="agents"></div>
<h2>Задачи</h2><div id="tasks"></div>
</main>
<script>
const PHASES=["DISCUSS","IMPLEMENT","SYNC","DONE"];
const $=id=>document.getElementById(id);
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function badge(v){return el("span","badge "+v,v)}
function ago(iso){const s=Math.max(0,(Date.now()-new Date(iso))/1000);if(s<60)return Math.round(s)+" с назад";if(s<3600)return Math.round(s/60)+" мин назад";if(s<86400)return Math.round(s/3600)+" ч назад";return Math.round(s/86400)+" дн назад"}
function time(iso){return new Date(iso).toLocaleTimeString()}

function renderAgents(s){
  const box=$("agents");box.replaceChildren();
  if(!s.agents.length&&!s.notStarted.length){box.append(el("div","empty","Агентов пока нет. Они появятся, когда запустятся их MCP-процессы."))}
  for(const a of s.agents){
    const c=el("div","card agent "+a.effectiveStatus);
    const top=el("div","top");top.append(el("span","dot"),el("span","",a.id),badge(a.effectiveStatus));c.append(top);
    c.append(el("div","muted",[a.type,a.role&&a.role!==a.id?a.role:null].filter(Boolean).join(" · ")));
    c.append(el("div","muted","активность: "+ago(a.lastSeenAt)+(a.pid?" · pid "+a.pid:"")));
    c.append(el("div","muted","задачи: "+(a.tasks.length?a.tasks.join(", "):"—")));
    if(a.effectiveStatus==="DEAD")c.append(el("div","muted","процесс не найден (упал?)"));
    box.append(c);
  }
  for(const id of s.notStarted){const c=el("div","card agent");const top=el("div","top");top.append(el("span","dot"),el("span","",id),badge("не запущен"));c.append(top,el("div","muted","назначен на задачу, но ещё не зарегистрировался"));box.append(c)}
}

function renderTask(t){
  const c=el("div","card task"+(t.status!=="ACTIVE"?" done":""));
  const head=el("div");head.append(el("h3","",t.id+" · "+t.title+(t.status==="CANCELLED"?" (отменена)":"")));head.append(el("div","muted",t.description));c.append(head);
  const steps=el("div","steps");const idx=PHASES.indexOf(t.phase);
  PHASES.forEach((p,i)=>steps.append(el("div","step"+(i<idx?" past":i===idx?" now":""),p+(p==="SYNC"&&t.syncRound&&idx>=2?" #"+t.syncRound:""))));
  c.append(steps);
  if(t.waitingOn.length){const w=el("div","chips");w.append(el("span","muted","ждём:"));t.waitingOn.forEach(x=>w.append(el("span","chip",x)));c.append(w)}
  const tbl=el("table");const hr=el("tr");["Агент","Задача в agreement","Implementation","Sync (раунд "+t.syncRound+")"].forEach(h=>hr.append(el("th","",h)));tbl.append(hr);
  for(const id of t.agents){
    const r=el("tr");r.append(el("td","",id));
    const as=t.agreement&&t.agreement.assignments.find(a=>a.agentId===id);
    const ap=t.agreement&&t.agreement.approvedBy.includes(id);
    const td=el("td");td.append(el("span","",as?as.responsibility:"—"));if(t.agreement&&as)td.append(" ",el("span","badge "+(ap?"PASS":"WAITING"),ap?"одобрил":"не одобрил"));r.append(td);
    const im=t.implementations.find(i=>i.agentId===id);
    const td2=el("td");td2.append(im?badge(im.status):el("span","muted","—"));if(im&&im.summary)td2.append(el("div","muted",im.summary));if(im&&im.filesChanged.length)td2.append(el("div","muted mono",im.filesChanged.join(", ")));r.append(td2);
    const rep=t.syncReports.filter(x=>x.agentId===id&&x.round===t.syncRound).pop();
    const td3=el("td");td3.append(rep?badge(rep.status):el("span","muted","—"));
    if(rep)rep.findings.forEach(f=>{const d=el("div","muted");d.append(el("span","badge "+f.severity,f.severity)," "+f.description+(f.relatedAgent?" → "+f.relatedAgent:""));td3.append(d)});
    r.append(td3);tbl.append(r);
  }
  c.append(tbl);
  if(t.agreement){const d=el("details");d.append(el("summary","","Agreement v"+t.agreement.version+" — "+t.agreement.summary));
    t.agreement.assignments.forEach(a=>d.append(el("div","",a.agentId+": "+a.responsibility)));
    if(t.agreement.decisions.length)d.append(el("div","muted","решения: "+t.agreement.decisions.join("; ")));
    if(t.agreement.interfaces.length)d.append(el("div","muted mono","interfaces: "+t.agreement.interfaces.join("; ")));c.append(d)}
  const md=el("details");md.append(el("summary","","Сообщения ("+t.messages.length+")"));
  t.messages.forEach(m=>{const r=el("div","msg");r.append(el("span","muted mono",time(m.createdAt)+" "),el("b","",m.from+" → "+m.to+": "),el("span","",m.content),m.readAt?el("span","muted"," ✓"):el("span","muted"," •"));md.append(r)});c.append(md);
  const ed=el("details");ed.append(el("summary","","События ("+t.events.length+")"));
  t.events.slice().reverse().forEach(e=>{const r=el("div","msg mono");r.textContent=time(e.createdAt)+"  "+e.type+(e.sourceAgent?"  от "+e.sourceAgent:"")+(e.targetAgent?"  → "+e.targetAgent:"");ed.append(r)});c.append(ed);
  return c;
}

const open=new Set();
function render(s){
  $("dir").textContent=s.networkDir;$("upd").textContent="обновлено "+time(s.generatedAt);
  renderAgents(s);
  const box=$("tasks");
  box.querySelectorAll("details[open]").forEach(d=>open.add(d.parentNode.dataset.id+"|"+d.firstChild.textContent.split(" ")[0]));
  box.replaceChildren();
  if(!s.tasks.length)box.append(el("div","empty","Задач нет. Создайте: agent-network-mcp task create --title … --agents a,b"));
  for(const t of s.tasks){const c=renderTask(t);c.dataset.id=t.id;c.querySelectorAll("details").forEach(d=>{if(open.has(t.id+"|"+d.firstChild.textContent.split(" ")[0]))d.open=true});box.append(c)}
}
async function tick(){try{const r=await fetch("/api/state",{cache:"no-store"});render(await r.json())}catch(e){$("upd").textContent="нет связи с сервером"}}
tick();setInterval(tick,2000);
</script>
</body>
</html>`;
