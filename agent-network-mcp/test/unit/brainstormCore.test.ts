import { expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { BrainstormStore, agentAction, approved, configSchema, decisionSummary, view, nextExample, inputSchema, type BrainstormTask, type BrainstormState, type BrainstormInput } from "../../src/brainstorm/index.js";
import { tmpDir } from "../helpers/tmp.js";

const option = { approach:"Use simple JS", components:["UI"], benefits:["small"], risks:["scope"], assumptions:[], evidence:[], unknowns:[] };
async function fixture(maxRounds=2) {
  const fs=await FileStore.open(await tmpDir()),store=new BrainstormStore(fs);
  const task:BrainstormTask={id:"task-001",title:"Counter",description:"Build counter",agents:["lead","reviewer"],status:"ACTIVE",phase:"DISCUSS",brainstorm:{enabled:true,maxRounds}};
  return {fs,store,task};
}
function base(s:BrainstormState,operationId:string) { return {operationId,epoch:s.epoch,round:s.round,expectedRevision:s.revision}; }
async function decision(store:BrainstormStore, task:BrainstormTask) {
  let s=(await store.read(task))!;
  for(const actor of task.agents) s=await store.submit(task,actor,{...base(s,`${s.round}-option-${actor}`),action:"submit_option",option});
  const ids=s.rounds.at(-1)!.options.map(o=>o.id);
  for(const actor of task.agents) s=await store.submit(task,actor,{...base(s,`${s.round}-critique-${actor}`),action:"submit_critique",critique:{optionIds:ids,strengths:["small"],concerns:[],recommendation:"Use JS"}});
  return store.submit(task,"lead",{...base(s,`${s.round}-decision`),action:"synthesize",recommendation:{selectedOptionIds:[ids[0]!],rationale:"Simple",comparison:"No framework needed",disagreements:[],constraints:[],nextSteps:["Implement"]}});
}

it("defaults the bounded config and keeps read-only initialization deterministic",async()=>{
  expect(configSchema.parse({enabled:true})).toEqual({enabled:true,maxRounds:2});
  expect(()=>configSchema.parse({enabled:true,maxRounds:6})).toThrow();
  const {fs,store,task}=await fixture();
  expect(await store.read({...task,brainstorm:undefined})).toBeNull();
  expect(await store.read(task)).toEqual(await store.read(task));
  expect(await fs.readJson(["tasks",task.id,"brainstorm","state.json"])).toBeNull();
});

it("requires all options/critiques, lead synthesis and exact operator approval; survives reload",async()=>{
  const {fs,store,task}=await fixture();
  let s=(await store.read(task))!;
  expect(agentAction(s,"lead")).toBe("submit_option");
  s=await decision(store,task);
  expect(s.stage).toBe("approval");expect(approved(s)).toBe(false);
  const d=s.decisions.at(-1)!;
  await expect(store.decide(task,"reviewer",{action:"approve",operationId:"approve",decisionVersion:d.version,decisionHash:d.hash})).rejects.toThrow("Only the operator");
  await expect(store.decide(task,"operator",{action:"approve",operationId:"approve",decisionVersion:999,decisionHash:d.hash})).rejects.toThrow("STALE_DECISION");
  s=await store.decide(task,"operator",{action:"approve",operationId:"approve",decisionVersion:d.version,decisionHash:d.hash});
  expect(approved(s)).toBe(true);expect(agentAction(s,"lead")).toBe("approved");
  expect(decisionSummary(s)).toContain("Simple");
  expect(await new BrainstormStore(fs).read(task)).toEqual(s);
  expect(await store.read({...task,phase:"IMPLEMENT",description:"Later description"})).toEqual(s);
  const changed=structuredClone(s);changed.decisions[0]!.recommendation.comparison="tampered";
  expect(approved(changed)).toBe(false);
});

it("provides schema-valid action examples with actual peer option identifiers",async()=>{
  const {store,task}=await fixture();let s=(await store.read(task))!;
  const first=nextExample(s,"lead")!;
  expect(inputSchema.parse(first.args).action).toBe("submit_option");
  s=await store.submit(task,"lead",inputSchema.parse(first.args));
  expect(nextExample(s,"lead")).toBeUndefined();
  s=await store.submit(task,"reviewer",inputSchema.parse(nextExample(s,"reviewer")!.args));
  const peerExample=nextExample(s,"lead")!;
  expect(inputSchema.parse(peerExample.args).action).toBe("submit_critique");
  expect(peerExample.args).toMatchObject({critique:{optionIds:["option-1-reviewer"]}});
});

it("hides other initial options and operation bodies, but reveals the complete comparison stage",async()=>{
  const {store,task}=await fixture();let s=(await store.read(task))!;
  s=await store.submit(task,"lead",{...base(s,"secret-operation"),action:"submit_option",option:{...option,approach:"SECRET IDEA"}});
  expect(JSON.stringify(view(s,"reviewer"))).not.toContain("SECRET IDEA");
  expect(JSON.stringify(view(s,"reviewer"))).not.toContain("secret-operation");
  expect(JSON.stringify(view(s,"lead"))).toContain("SECRET IDEA");
  expect(JSON.stringify(view(s,"operator",true))).toContain("SECRET IDEA");
  expect(()=>view(s,"outsider")).toThrow("participant");
  s=await store.submit(task,"reviewer",{...base(s,"other"),action:"submit_option",option});
  expect(JSON.stringify(view(s,"reviewer"))).toContain("SECRET IDEA");
});

it("makes retries idempotent, rejects operation reuse, stale revisions, late epochs and nonmembers",async()=>{
  const {store,task}=await fixture();const initial=(await store.read(task))!;
  const input:BrainstormInput={...base(initial,"one"),action:"submit_option",option};
  const saved=await store.submit(task,"lead",input);
  expect(await store.submit(task,"lead",input)).toEqual(saved);
  await expect(store.submit(task,"lead",{...input,option:{...option,approach:"different"}})).rejects.toThrow("OPERATION_CONFLICT");
  await expect(store.submit(task,"reviewer",{...input,operationId:"new"})).rejects.toThrow("STALE_STATE");
  await expect(store.submit(task,"intruder",input)).rejects.toThrow("participant");
  const changed={...task,description:"Changed scope"};
  expect((await store.read(changed))!.epoch).toBe(2);
  await expect(store.submit(changed,"lead",input)).rejects.toThrow("STALE_STATE");
  await expect(store.submit({...task,status:"CANCELLED"},"lead",input)).rejects.toThrow("ACTIVE DISCUSS");
  await expect(store.submit({...task,phase:"IMPLEMENT"},"lead",input)).rejects.toThrow("ACTIVE DISCUSS");
});

it("requires a peer critique and rejects premature/nonlead synthesis",async()=>{
  const {store,task}=await fixture();let s=(await store.read(task))!;
  for(const actor of task.agents)s=await store.submit(task,actor,{...base(s,actor),action:"submit_option",option});
  await expect(store.submit(task,"lead",{...base(s,"own-only"),action:"submit_critique",critique:{optionIds:[s.rounds[0]!.options[0]!.id],strengths:[],concerns:[],recommendation:"mine"}})).rejects.toThrow("CRITIQUE_REFERENCES");
  const recommendation={selectedOptionIds:[s.rounds[0]!.options[0]!.id],rationale:"x",comparison:"x",disagreements:[],constraints:[],nextSteps:[]};
  await expect(store.submit(task,"lead",{...base(s,"early"),action:"synthesize",recommendation})).rejects.toThrow("INVALID_ACTION");
  for(const actor of task.agents)s=await store.submit(task,actor,{...base(s,actor+"-review"),action:"submit_critique",critique:{optionIds:s.rounds[0]!.options.map(o=>o.id),strengths:[],concerns:[],recommendation:"fine"}});
  await expect(store.submit(task,"reviewer",{...base(s,"not-lead"),action:"synthesize",recommendation})).rejects.toThrow("INVALID_ACTION");
});

it("preserves exhausted rounds, extends explicitly and versions a revised decision",async()=>{
  const {store,task}=await fixture(1);let s=await decision(store,task);const first=s.decisions[0]!;
  const revise={action:"revise" as const,operationId:"revise",decisionVersion:first.version,decisionHash:first.hash,feedback:"Consider maintenance"};
  await expect(store.decide(task,"operator",revise)).rejects.toThrow("ROUND_LIMIT");
  expect(await store.read(task)).toEqual(s);
  s=await store.decide(task,"operator",{action:"extend",operationId:"extend",expectedRevision:s.revision,maxRounds:2,reason:"Need another round"});
  s=await store.decide(task,"operator",revise);
  expect(s.round).toBe(2);expect(s.rounds).toHaveLength(2);
  expect(view(s,"reviewer").decisions).toEqual([]);
  s=await decision(store,task);expect(s.decisions[1]!.version).toBe(2);expect(s.decisions[1]!.hash).not.toBe(first.hash);
  await expect(store.decide(task,"operator",{action:"approve",operationId:"stale",decisionVersion:first.version,decisionHash:first.hash})).rejects.toThrow("STALE_DECISION");
});
