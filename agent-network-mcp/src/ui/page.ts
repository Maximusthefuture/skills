/** Single-file page: vanilla JS, no dependencies. All dynamic text goes through textContent (never innerHTML). */
export const PAGE_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Network</title>
<style>
:root{--bg:#f6f7f9;--side:#eef0f3;--card:#fff;--card2:#f2f4f7;--text:#1c2128;--muted:#667085;--line:#e3e6eb;--accent:#2f6fed;--ok:#16a34a;--warn:#b45309;--bad:#dc2626;--idle:#98a2b3;--qbg:#fff8e6;--qline:#f0cf86;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0d1014;--side:#11151a;--card:#151a20;--card2:#1a2027;--text:#e6e9ee;--muted:#8b95a3;--line:#262d36;--accent:#6b9bff;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--idle:#5d6673;--qbg:#1d1a10;--qline:#5a4614}}
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
.top b{color:var(--text);font-weight:500;margin-left:4px}.top .r{margin-left:auto;text-transform:none}.top .warnq b{color:var(--warn)}
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
pre.log{max-height:280px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:8px;margin:6px 0 0;font:11px/1.4 var(--mono);white-space:pre-wrap;word-break:break-word}pre.log.err{color:var(--bad)}
.stats{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0;font-size:12px;color:var(--muted)}.stats b{color:var(--text);font-weight:600}
.q{border:1px solid var(--qline);border-left:3px solid var(--warn);background:var(--qbg)}.q .who{font-weight:600}.q textarea{min-height:60px;margin-top:8px}.q .row2{display:flex;gap:8px;align-items:center;margin-top:6px}
.inst{display:flex;gap:6px;margin-top:6px}.inst[hidden]{display:none}.inst input,.inst select{flex:1;min-width:0}.inst button{padding:4px 10px}
.sub{font-size:12px}.sub .DONE{color:var(--ok)}.sub .DOING{color:var(--accent);font-weight:600}.sub .DROPPED{color:var(--idle);text-decoration:line-through}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters select,.filters input{width:auto;min-width:140px}
.total{margin-top:10px;font-size:12px;color:var(--muted)}
.scroll.subs{max-height:150px;min-width:170px;margin-top:4px;padding:2px 6px}.scroll{max-height:300px;overflow-y:auto;margin-top:6px;padding:0 8px;border:1px solid var(--line);border-radius:7px;background:var(--bg)}
.feed{max-height:calc(100vh - 230px);min-height:200px;overflow-y:auto}
tr.exp td{background:var(--bg)}.detail{display:grid;gap:4px;font-size:13px;padding:4px 0 6px 18px}
[hidden]{display:none!important}.nw{white-space:nowrap}.path{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app>div{min-width:0}
@media (max-width:820px){.app{grid-template-columns:minmax(0,1fr)}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}nav{display:flex;overflow-x:auto}.grp,.foot{display:none}nav a{border-left:0;border-bottom:2px solid transparent;white-space:nowrap;padding:8px 12px}nav a.on{border-bottom-color:var(--accent)}.cols{grid-template-columns:1fr}.top{position:static;padding:8px 16px}main{padding:16px}.kpi{border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<div class="app">
<aside>
  <div class="brand">◆ agent network</div>
  <div class="proj" id="projcard" title="Проекты"><b><span class="dot" id="projdot"></span><span id="projname">…</span></b><span class="s" id="projsub"></span></div>
  <nav id="nav">
    <div class="grp">Работа</div>
    <a href="#/overview" data-tab="overview"><span class="n">01</span>Обзор</a>
    <a href="#/tasks" data-tab="tasks"><span class="n">02</span>Задачи<span class="c" id="c-tasks"></span></a>
    <a href="#/runs" data-tab="runs"><span class="n">03</span>Запуски<span class="c" id="c-runs"></span></a>
    <div class="grp">Инфраструктура</div>
    <a href="#/runners" data-tab="runners"><span class="n">04</span>Runner'ы<span class="c" id="c-runners"></span></a>
    <a href="#/projects" data-tab="projects"><span class="n">05</span>Проекты<span class="c" id="c-projects"></span></a>
    <a href="#/events" data-tab="events"><span class="n">06</span>События</a>
  </nav>
  <div class="foot">сеть<br><span id="dir"></span></div>
</aside>
<div>
  <div class="top" id="topbar"></div>
  <main>
    <div class="banner note err" id="priceerr" hidden></div>
    <section id="questions" hidden><div class="grid" id="qlist"></div><div style="height:14px"></div></section>

    <section data-panel="overview">
      <div class="hrow"><div><h1>Обзор</h1><div class="lead">Что делают агенты сейчас и сколько это стоит.</div></div><div class="end win" id="win"><button data-w="24h">24ч</button><button data-w="7d">7д</button><button data-w="30d">30д</button></div></div>
      <div class="kpis" id="kpis"></div>
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
      <div id="tasks"></div>
    </section>

    <section data-panel="runs" hidden>
      <h1>Запуски</h1><div class="lead">Каждая сессия агента: сколько шла, сколько токенов и денег.</div>
      <div class="filters"><select id="f-agent"></select><select id="f-task"></select><select id="f-model"></select><select id="f-status"></select></div>
      <div class="panel"><table id="runs"></table></div>
      <div class="total" id="runtotal"></div>
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
const TABS=["overview","tasks","runs","runners","projects","events"];
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
    const s=await getJSON(q("/api/state"));S=s;controlMode=!!s.control;
    if(!route.project)route.project=s.project.id;
    if(["overview","runs","runners"].includes(route.tab)||!n)RUNS=(await getJSON(q("/api/runs"))).runs;
    if(route.tab==="projects"||n%3===0)PROJ=(await getJSON("/api/projects")).projects;
    n++;render();
  }catch(e){$("topbar").textContent="нет связи с сервером"}
}
function render(){if(!S)return;const y=window.scrollY;renderChrome();renderQuestions(S);
  if(route.tab==="overview")renderOverview();if(route.tab==="tasks")renderTasks();if(route.tab==="runs")renderRuns();
  if(route.tab==="runners"){renderControl(S);renderAgents(S)}if(route.tab==="projects")renderProjects();if(route.tab==="events")renderEvents();
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
function renderTask(t){
  const c=el("div","card task"+(t.status!=="ACTIVE"&&t.status!=="BLOCKED"?" done":""));
  const hd=el("div");const h3=el("h3","",t.id+" · "+t.title);h3.append(badge(t.queue,QUEUE[t.queue]||t.queue));if(t.openspec)h3.append(badge("","OpenSpec"));hd.append(h3);hd.append(el("div","muted",t.description));
  const chain=[];if(t.parentTaskId)chain.push("follow-up от "+t.parentTaskId);if(t.followUps&&t.followUps.length)chain.push("follow-up задачи: "+t.followUps.join(", "));if(t.followUpBudget)chain.push("бюджет follow-up: "+t.followUpBudget.used+"/"+t.followUpBudget.max);
  if(chain.length)hd.append(el("div","muted",chain.join(" · ")));
  if(t.openspec)hd.append(renderOpenspec(t));
  hd.append(renderStats(t));
  if(t.status==="BLOCKED"){const b=el("div","");b.append(badge("BLOCKED")," "+(t.blockedReason||"")+" — нужен оператор: task unblock / task cancel");hd.append(b)}
  c.append(hd);
  const steps=el("div","steps");const idx=PHASES.indexOf(t.phase);
  PHASES.forEach((p,i)=>steps.append(el("div","step"+(i<idx?" past":i===idx?" now":""),p+(p==="SYNC"&&t.syncRound&&idx>=2?" #"+t.syncRound:""))));
  c.append(steps);
  if(t.waitingOn.length){const w=el("div","chips");w.append(el("span","muted","ждём:"));t.waitingOn.forEach(x=>w.append(el("span","chip",x)));c.append(w)}
  const tbl=el("table");tbl.append(head(["Агент","Задача в agreement","Подзадачи","Implementation","Sync (раунд "+t.syncRound+")"]));
  for(const id of t.agents){
    const r=el("tr");r.append(td(id));
    const as=t.agreement&&t.agreement.assignments.find(a=>a.agentId===id);const ap=t.agreement&&t.agreement.approvedBy.includes(id);
    const c1=el("td");c1.append(el("span","",as?as.responsibility:"—"));if(as&&as.files&&as.files.length)c1.append(el("div","muted mono","файлы: "+as.files.join(", ")));if(t.agreement&&as)c1.append(" ",el("span","badge "+(ap?"PASS":"WAITING"),ap?"одобрил":"не одобрил"));r.append(c1);
    const subs=(t.subtasks&&t.subtasks[id])||[];const live=subs.filter(x=>x.status!=="DROPPED");
    const c2=el("td","sub");if(!subs.length)c2.append(el("span","muted","—"));else{const doing=subs.find(x=>x.status==="DOING");
      c2.append(el("div","",live.filter(x=>x.status==="DONE").length+"/"+live.length+(doing?" · ▶ "+doing.id:"")));
      // a long plan scrolls in its own box (opened at the step in progress) instead of stretching the row
      const sl=el("div","scroll subs");sl.dataset.scroll="subs-"+id;
      const icon={DONE:"✓",DOING:"▶",TODO:"·",DROPPED:"✕"};subs.forEach(x=>{const d=el("div",x.status,icon[x.status]+" "+x.id+" "+x.title);if(x.note)d.title=x.note;sl.append(d)});c2.append(sl)}
    r.append(c2);
    const im=t.implementations.find(i=>i.agentId===id);
    const c3=el("td");c3.append(im?badge(im.status):el("span","muted","—"));if(im&&im.summary)c3.append(el("div","muted",im.summary));if(im&&im.filesChanged.length)c3.append(el("div","muted mono",im.filesChanged.join(", ")));r.append(c3);
    const rep=t.syncReports.filter(x=>x.agentId===id&&x.round===t.syncRound).pop();
    const c4=el("td");c4.append(rep?badge(rep.status):el("span","muted","—"));
    if(rep)rep.findings.forEach(f=>{const d=el("div","muted");d.append(el("span","badge "+f.severity,f.severity)," "+f.description+(f.relatedAgent?" → "+f.relatedAgent:""));c4.append(d)});
    r.append(c4);tbl.append(r);
  }
  c.append(tbl);
  t.integrations.filter(x=>x.round===t.syncRound).slice(-1).forEach(x=>{const d=el("div","");d.append(el("b","","Интеграция ("+x.agentId+"): "),badge(x.status)," "+x.result);if(x.commits.length)d.append(el("div","muted mono","commits: "+x.commits.join(", ")));
    x.findings.forEach(f=>{const r=el("div","muted");r.append(el("span","badge "+f.severity,f.severity)," "+f.description+(f.relatedAgent?" → "+f.relatedAgent:""));d.append(r)});c.append(d)});
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
function renderTasks(){
  const s=S;$("newbtn").hidden=!s.control;if(!s.control)$("newtask").hidden=true;
  $("tasks-lead").textContent="Текущие и завершённые задачи проекта "+s.project.name+"."+(s.control?"":" Только чтение: чтобы ставить задачи, запустите UI с --runners.");
  updateForm(s);
  const box=$("tasks");
  // the cards are rebuilt on every refresh: keep which details are open and where their lists are scrolled
  if(box.querySelector("[data-id]")){openDetails.clear();box.querySelectorAll("details[open]").forEach(d=>{const card=d.closest("[data-id]");if(card)openDetails.add(card.dataset.id+"|"+d.firstChild.textContent.split(" ")[0])})}
  const scrolls=new Map();box.querySelectorAll("[data-scroll]").forEach(b=>{if(b.closest("details:not([open])"))return;const card=b.closest("[data-id]");if(card)scrolls.set(card.dataset.id+"|"+b.dataset.scroll,{top:b.scrollTop,atEnd:b.scrollTop+b.clientHeight>=b.scrollHeight-8})});
  // build every card first and swap them in at once: measuring a half-built list would shrink the page and reset its scroll
  const cards=s.tasks.map(t=>{const c=renderTask(t);c.dataset.id=t.id;
    c.querySelectorAll("[data-scroll]").forEach(b=>{const sv=scrolls.get(t.id+"|"+b.dataset.scroll);if(sv&&!(b.dataset.scroll==="msgs"&&sv.atEnd))b.dataset.top=String(sv.top)}); // at the bottom of messages: stay at the newest
    c.querySelectorAll("details").forEach(d=>{if(openDetails.has(t.id+"|"+d.firstChild.textContent.split(" ")[0]))d.open=true});return c});
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
const STATUS={running:"идёт",ok:"ок",stopped:"остановлена",failed:"ошибка"};
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
    const st=el("td","nw");st.append(dot({running:"acc",ok:"ok",failed:"bad"}[r.status]||""),r.status==="failed"?"exit "+r.exitCode:STATUS[r.status]);
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
  line("завершение",r.status==="running"?"сессия идёт":r.status==="ok"?"код выхода 0":r.status==="stopped"?"остановлена сигналом (кнопка «Стоп» или Ctrl+C)":"ошибка: код выхода "+r.exitCode);
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
  const details=el("details");details.append(el("summary","","Лог"));const pre=el("pre","log","");details.append(pre);
  details.addEventListener("toggle",()=>{if(details.open)loadLog(id,c)});
  root.append(top,info,cwd,cmd,modelState,modelForm,modelHint,instState,inst,instDetails,details);
  const c={root,dot:dt,badge:badgeEl,btn,info,cwd,cmd,details,pre,modelState,modelForm,modelSel,modelHint,instState,instInput,instPre,instDetails};return c}
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

/* ---------- questions ---------- */
const qCards=new Map();
function renderQuestions(s){
  const open=s.openQuestions||[];$("questions").hidden=!open.length;const box=$("qlist");const keep=new Set();
  for(const qq of open){const key=route.project+"/"+qq.taskId+"/"+qq.messageId;keep.add(key);if(qCards.has(key))continue;
    const c=el("div","card q");const h=el("div","");h.append(el("span","who",qq.from),el("span","muted"," · "+qq.taskId+" «"+qq.taskTitle+"» · "+time(qq.askedAt)));c.append(h,el("div","",qq.question));
    if(s.control){const f=el("form","");const ta=document.createElement("textarea");ta.placeholder="Ваш ответ агенту "+qq.from;const r2=el("div","row2");const b=el("button","","Ответить");b.type="submit";const note=el("span","note","");r2.append(b,note);f.append(ta,r2);
      f.onsubmit=async ev=>{ev.preventDefault();if(!ta.value.trim())return;b.disabled=true;note.className="note";note.textContent="отправляю…";
        try{await post("/api/questions/answer",{taskId:qq.taskId,messageId:qq.messageId,answer:ta.value});note.className="note ok";note.textContent="отправлено";await tick()}catch(e){note.className="note err";note.textContent=e.message;b.disabled=false}};
      c.append(f)}else c.append(el("div","muted","ответить можно из UI, запущенного с --runners"));
    qCards.set(key,c);box.append(c)}
  for(const [key,c] of qCards)if(!keep.has(key)){c.remove();qCards.delete(key)}
}

/* ---------- switching projects ---------- */
function resetProject(){
  S=null;RUNS=[];n=0;knownIds="";openDetails.clear();
  for(const c of runnerCards.values())c.root.remove();runnerCards.clear();
  for(const c of qCards.values())c.remove();qCards.clear();
  ["tasks","runs","events","agents","kpis","ov-runners","ov-phases","ov-events"].forEach(id=>$(id).replaceChildren());
  ["f-agent","f-task","f-model","f-status","e-task","e-type"].forEach(id=>{$(id).dataset.sig="";$(id).value=""});expandedRuns.clear();
  $("newtask").hidden=true;$("formnote").textContent="";$("openspec").replaceChildren(new Option("— без OpenSpec —",""));
}
showTab();tick();setInterval(tick,2000);
</script>
</body>
</html>`;
