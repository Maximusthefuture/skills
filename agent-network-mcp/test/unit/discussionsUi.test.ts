import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE2_HTML } from "../../src/ui/page2.js";

function setup() {
  const doc: {activeElement?: Node} = {};
  class Node {
    children: Node[] = []; dataset: Record<string,string> = {}; value = ""; hidden=false; disabled=false; isConnected=true; open=false;
    selectionStart=0; selectionEnd=0; selectionDirection="forward"; onclick?:()=>Promise<void>; oninput?:()=>void;
    constructor(public textContent=""){}
    append(...n:Node[]){this.children.push(...n)} setAttribute(){} replaceWith(n:Node){root=n} focus(){doc.activeElement=this}
    setSelectionRange(a:number,b:number,d:string){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=d}
  }
  const task={id:"task",discussions:[{id:"q1",question:"Question",from:"agent",to:"operator",createdAt:"now",status:"open",answeredBy:["operator"],messages:[{from:"operator",to:"agent",content:"Answer",createdAt:"now"}]},{id:"q2",question:"Closed",from:"agent",to:"agent",createdAt:"now",status:"closed",answeredBy:[],messages:[]}]};
  const sent:unknown[]=[],storage=new Map<string,string>();let root:Node;
  const context=vm.createContext({project:"p",S:{control:true},document:doc,task,sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)},taskDisclosure:()=>new Node(),rememberTaskDisclosures:()=>{},el:(_tag:string,_cls:string,text:string)=>new Node(text),time:(s:string)=>s,tick:async()=>{},post:async(url:string,body:unknown)=>{sent.push({url,body});if(context.fail)throw Error("Save failed")}});
  const script=PAGE2_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;vm.runInContext(script.slice(script.indexOf("const discussionDrafts="),script.indexOf("function decisionHistoryCard(")),context);
  const render=()=>{root=vm.runInContext("discussionsCard(task)",context) as Node;return root};
  const flatten=(n:Node):Node[]=>[n,...n.children.flatMap(flatten)];const nodes=()=>flatten(root);
  return {context,task,doc,sent,render,nodes};
}
describe("task discussions",()=>{
  it("restores the selected filter after reloading its in-memory state",async()=>{
    const h=setup();h.render();await h.nodes().find(n=>n.textContent==="Все обсуждения")!.onclick!();
    vm.runInContext("discussionFilters.clear()",h.context);h.render();
    expect(h.nodes().some(n=>n.textContent==="Closed")).toBe(true);
  });
  it("asks for an outcome before submitting an empty closure and shows who closed and reopened it",async()=>{
    const h=setup();Object.assign(h.task.discussions[0]!,{history:[{status:"closed",by:"operator",at:"yesterday",summary:"Earlier decision"},{status:"open",by:"operator",at:"today"}]});h.render();
    await h.nodes().find(n=>n.textContent==="Закрыть обсуждение")!.onclick!();
    expect(h.sent).toHaveLength(0);
    expect(h.nodes().some(n=>n.textContent==="Напишите итог обсуждения перед закрытием."&&!n.hidden)).toBe(true);
    expect(h.nodes().some(n=>n.textContent==="Закрыл обсуждение: operator")).toBe(true);
    expect(h.nodes().some(n=>n.textContent==="Открыл обсуждение снова: operator")).toBe(true);
  });
  it("filters by explicit closure, not merely the presence of answers",async()=>{
    const h=setup();h.render();expect(h.nodes().some(n=>n.textContent==="Question")).toBe(true);expect(h.nodes().some(n=>n.textContent==="Closed")).toBe(false);
    await h.nodes().find(n=>n.textContent==="Все обсуждения")!.onclick!();expect(h.nodes().some(n=>n.textContent==="Closed")).toBe(true);
    expect(h.nodes().some(n=>n.textContent==="Закрыть обсуждение"&&!n.disabled)).toBe(true);
  });
  it("preserves draft and caret after refresh, submits exact root/summary, retains draft and error on failure",async()=>{
    const h=setup();h.render();let summary=h.nodes().find(n=>n.dataset.discussionField?.includes('summary'))!;summary.value="Chosen behavior";summary.oninput!();summary.focus();summary.setSelectionRange(2,6,"backward");
    vm.runInContext("keep=discussionFocus()",h.context);h.render();vm.runInContext("discussionRestore(keep)",h.context);summary=h.nodes().find(n=>n.dataset.discussionField?.includes('summary'))!;
    expect(summary.value).toBe("Chosen behavior");expect(h.doc.activeElement).toBe(summary);expect(summary.selectionEnd).toBe(6);
    h.context.fail=true;await h.nodes().find(n=>n.textContent==="Закрыть обсуждение")!.onclick!();h.render();
    expect(h.sent[0]).toEqual({url:"/api/tasks/task/discussions/q1",body:{status:"closed",summary:"Chosen behavior"}});
    expect(h.nodes().some(n=>n.textContent==="Save failed"&&!n.hidden)).toBe(true);
    expect(h.nodes().find(n=>n.dataset.discussionField?.includes('summary'))!.value).toBe("Chosen behavior");
  });
  it("saves requirement separately and prevents closing unanswered operator questions",async()=>{
    const h=setup();h.task.discussions[0]!.answeredBy=[];h.task.discussions[0]!.messages=[{from:"agent",to:"operator",content:"Pending nested question",createdAt:"now",type:"QUESTION"} as any];h.render();expect(h.nodes().find(n=>n.textContent==="Закрыть обсуждение")!.disabled).toBe(true);
    const req=h.nodes().find(n=>n.dataset.discussionField?.includes('requirement'))!;req.value="REQ-42";req.oninput!();await h.nodes().find(n=>n.textContent==="Сохранить требование")!.onclick!();
    expect(h.sent[0]).toEqual({url:"/api/tasks/task/discussions/q1",body:{requirementId:"REQ-42"}});
    h.context.project="other";h.render();expect(h.nodes().find(n=>n.dataset.discussionField?.includes('requirement'))!.value).toBe("");
  });
  it("allows explicit closure after dismissal and labels reopened historical summary",()=>{
    const h=setup();h.task.discussions[0]!.answeredBy=[];h.task.discussions[0]!.messages=[{from:"agent",to:"operator",content:"Dismissed",createdAt:"now",type:"QUESTION",readAt:"later"} as any];
    Object.assign(h.task.discussions[0]!,{summary:"Historical outcome",closedBy:"operator"});h.render();
    expect(h.nodes().find(n=>n.textContent==="Закрыть обсуждение")!.disabled).toBe(false);
    expect(h.nodes().some(n=>n.textContent==="Предыдущий итог: Historical outcome")).toBe(true);
    expect(h.nodes().some(n=>n.textContent==="Ранее закрыл обсуждение: operator")).toBe(true);
  });

});
