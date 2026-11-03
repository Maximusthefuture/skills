import { createHash } from "node:crypto";
import { z } from "zod";
import type { FileStore } from "../storage/fileStore.js";
import { AppError } from "../errors.js";

export const configSchema = z.object({ enabled: z.literal(true), maxRounds: z.number().int().min(1).max(5).default(2) }).strict();
export type BrainstormConfig = z.infer<typeof configSchema>;
const text = z.string().trim().min(1).max(8000), list = z.array(text).max(30);
export const optionSchema = z.object({ approach: text, components: list, benefits: list, risks: list, assumptions: list, evidence: list, unknowns: list }).strict();
export const critiqueSchema = z.object({ optionIds: z.array(z.string().min(1).max(200)).min(1).max(30), strengths: list, concerns: list, recommendation: text }).strict();
export const recommendationSchema = z.object({ selectedOptionIds: z.array(z.string().min(1).max(200)).min(1).max(30), rationale: text, comparison: text, disagreements: list, constraints: list, nextSteps: list }).strict();
const operationId = z.string().min(1).max(200);
const base = { operationId, epoch: z.number().int().positive(), round: z.number().int().min(1).max(5), expectedRevision: z.number().int().nonnegative() };
export const inputSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("submit_option"), option: optionSchema }).strict(),
  z.object({ ...base, action: z.literal("submit_critique"), critique: critiqueSchema }).strict(),
  z.object({ ...base, action: z.literal("synthesize"), recommendation: recommendationSchema }).strict(),
]);
export type BrainstormInput = z.infer<typeof inputSchema>;
const reference = { operationId, decisionVersion: z.number().int().positive(), decisionHash: z.string().regex(/^[a-f0-9]{64}$/) };
export const operatorInputSchema = z.discriminatedUnion("action", [
  z.object({ ...reference, action: z.literal("approve") }).strict(),
  z.object({ ...reference, action: z.literal("revise"), feedback: text }).strict(),
  z.object({ action: z.literal("extend"), operationId, expectedRevision: z.number().int().nonnegative(), maxRounds: z.number().int().min(1).max(5), reason: text }).strict(),
]);
export type BrainstormOperatorInput = z.infer<typeof operatorInputSchema>;
type Option = z.infer<typeof optionSchema> & { id: string; author: string };
type Critique = z.infer<typeof critiqueSchema> & { author: string };
type Recommendation = z.infer<typeof recommendationSchema>;
export type BrainstormStage = "options" | "critique" | "synthesis" | "approval" | "approved";
export interface BrainstormRound { round: number; options: Option[]; critiques: Critique[]; feedback?: string }
export interface BrainstormDecision { version: number; round: number; hash: string; recommendation: Recommendation }
export interface BrainstormState {
  schemaVersion: 1; taskId: string; epoch: number; revision: number; stage: BrainstormStage; round: number; maxRounds: number;
  participants: string[]; lead: string; brief: { title: string; description: string }; briefHash: string;
  rounds: BrainstormRound[]; decisions: BrainstormDecision[];
  approvedDecision?: { version: number; hash: string; by: string; at: string };
  operations: { id: string; hash: string }[]; updatedAt: string;
}
export interface BrainstormTask { id: string; title: string; description: string; agents: string[]; status: string; phase: string; updatedAt?: string; brainstorm?: BrainstormConfig; brainstormGeneration?: number; jobOf?: unknown; openspec?: unknown; proposes?: unknown }
const fail = (reason: string): never => { throw new AppError("INVALID_INPUT", "BRAINSTORM_" + reason); };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,canonical(val)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const current = (s: BrainstormState) => s.rounds.at(-1)!;
export function approved(s: BrainstormState | null): boolean {
  const decision = s?.decisions.at(-1);
  if(!s||s.stage!=="approved"||!decision||s.approvedDecision?.hash!==decision.hash||s.approvedDecision.version!==decision.version)return false;
  const round=s.rounds.find(r=>r.round===decision.round);
  return !!round&&decision.hash===hash({briefHash:s.briefHash,participants:s.participants,round,recommendation:decision.recommendation});
}
export function decisionSummary(s: BrainstormState | null): string {
  if (!approved(s)) return "";
  const d = s!.decisions.at(-1)!;
  return `Approved brainstorm decision v${d.version} (${d.hash}):\n${JSON.stringify(d.recommendation)}`;
}
export function agentAction(s: BrainstormState, actor: string): "submit_option" | "submit_critique" | "synthesize" | "wait" | "approved" {
  if (!s.participants.includes(actor)) return "wait";
  if (approved(s)) return "approved";
  if (s.stage === "options" && !current(s).options.some(o=>o.author===actor)) return "submit_option";
  if (s.stage === "critique" && !current(s).critiques.some(c=>c.author===actor)) return "submit_critique";
  return s.stage === "synthesis" && actor === s.lead ? "synthesize" : "wait";
}
export function nextExample(s:BrainstormState,actor:string) {
  const action=agentAction(s,actor),base={operationId:`brainstorm-${s.epoch}-${s.round}-${actor}-${action}`,epoch:s.epoch,round:s.round,expectedRevision:s.revision};
  if(action==="submit_option")return {tool:"brainstorm",args:{...base,action,option:{approach:"Describe your proposed approach",components:["Main component"],benefits:["Benefit and conditions"],risks:["Risk and mitigation"],assumptions:[],evidence:[],unknowns:[]}}};
  if(action==="submit_critique")return {tool:"brainstorm",args:{...base,action,critique:{optionIds:current(s).options.filter(o=>o.author!==actor).map(o=>o.id),strengths:[],concerns:[],recommendation:"Compare the approaches using the task criteria"}}};
  if(action==="synthesize")return {tool:"brainstorm",args:{...base,action,recommendation:{selectedOptionIds:current(s).options.slice(0,1).map(o=>o.id),rationale:"Explain the recommended choice",comparison:"Compare alternatives using the same criteria",disagreements:[],constraints:[],nextSteps:["Describe implementation steps"]}}};
  return undefined;
}
export function view(s: BrainstormState, actor: string, operator = false) {
  if (!operator && !s.participants.includes(actor)) throw new AppError("NOT_ASSIGNED", "Not a brainstorm participant");
  const { operations: _operations, ...copy } = structuredClone(s);
  // Hide ALL prior material in the independently authored options stage, including decisions/feedback.
  if (!operator && s.stage === "options") {
    copy.rounds = copy.rounds.map(r=>({ round:r.round, options:r.round===s.round?r.options.filter(o=>o.author===actor):[], critiques:[], ...(r.round===s.round&&r.feedback?{feedback:r.feedback}:{}) }));
    copy.decisions = [];
  }
  return { ...copy, action: agentAction(s, actor), submitted: { options: current(s).options.length, critiques: current(s).critiques.length }, waitingOn: s.participants.filter(id=>agentAction(s,id)!=="wait"&&agentAction(s,id)!=="approved") };
}

/** Caller serializes these operations with the existing task lock; writes are atomic. */
export class BrainstormStore {
  constructor(private readonly fs: FileStore) {}
  private path(task: BrainstormTask) { return ["tasks", task.id, "brainstorm", "state.json"]; }
  async read(task: BrainstormTask): Promise<BrainstormState | null> {
    if (!task.brainstorm?.enabled) return null;
    const cfg = configSchema.parse(task.brainstorm);
    const old = await this.fs.readJson<BrainstormState>(this.path(task));
    const brief = { title: task.title, description: task.description };
    const briefHash = hash({ taskId:task.id, brief, participants:task.agents, generation:task.brainstormGeneration ?? 0 });
    if (old?.briefHash === briefHash || (old && task.phase !== "DISCUSS")) return old;
    return { schemaVersion:1,taskId:task.id,epoch:(old?.epoch??0)+1,revision:0,stage:"options",round:1,maxRounds:cfg.maxRounds,
      participants:[...task.agents],lead:task.agents[0]!,brief,briefHash,rounds:[{round:1,options:[],critiques:[]}],decisions:[],operations:[],updatedAt:task.updatedAt ?? new Date(0).toISOString() } as BrainstormState;
  }
  private async state(task: BrainstormTask) {
    if(task.status!=="ACTIVE"||task.phase!=="DISCUSS") throw new AppError("INVALID_PHASE","Brainstorm requires ACTIVE DISCUSS");
    const s=await this.read(task); if(!s) return fail("DISABLED"); return s;
  }
  private replay(s: BrainstormState, actor: string, input: { operationId: string }): boolean {
    const previous=s.operations.find(op=>op.id===input.operationId); if(!previous)return false;
    if(previous.hash!==hash({actor,input}))fail("OPERATION_CONFLICT");return true;
  }
  private async save(task: BrainstormTask,s: BrainstormState,actor:string,input:{operationId:string}) {
    s.operations.push({id:input.operationId,hash:hash({actor,input})});s.revision++;s.updatedAt=new Date().toISOString();
    if(s.operations.length>200||Buffer.byteLength(JSON.stringify(s))>512*1024)fail("STATE_LIMIT");
    await this.fs.writeJson(this.path(task),s);return s;
  }
  async submit(task: BrainstormTask, actor:string, raw:BrainstormInput):Promise<BrainstormState> {
    const input=inputSchema.parse(raw),s=await this.state(task);
    if(!s.participants.includes(actor))throw new AppError("NOT_ASSIGNED","Not a brainstorm participant");
    if(this.replay(s,actor,input))return s;
    if(input.epoch!==s.epoch||input.round!==s.round||input.expectedRevision!==s.revision)fail("STALE_STATE");
    const round=current(s);
    if(input.action==="submit_option") {
      if(agentAction(s,actor)!==input.action)fail("INVALID_ACTION");
      round.options.push({...input.option,id:`option-${s.round}-${actor}`,author:actor});
      if(round.options.length===s.participants.length)s.stage="critique";
    } else if(input.action==="submit_critique") {
      if(agentAction(s,actor)!==input.action)fail("INVALID_ACTION");
      if(input.critique.optionIds.some(id=>!round.options.some(o=>o.id===id))||!input.critique.optionIds.some(id=>round.options.some(o=>o.id===id&&o.author!==actor)))fail("INVALID_CRITIQUE_REFERENCES");
      round.critiques.push({...input.critique,author:actor});if(round.critiques.length===s.participants.length)s.stage="synthesis";
    } else {
      if(agentAction(s,actor)!==input.action)fail("INVALID_ACTION");
      if(input.recommendation.selectedOptionIds.some(id=>!round.options.some(o=>o.id===id)))fail("INVALID_DECISION_REFERENCES");
      const decision={version:s.decisions.length+1,round:s.round,recommendation:input.recommendation,hash:hash({briefHash:s.briefHash,participants:s.participants,round:structuredClone(round),recommendation:input.recommendation})};
      s.decisions.push(decision);s.stage="approval";
    }
    return this.save(task,s,actor,input);
  }
  async decide(task:BrainstormTask,actor:string,raw:BrainstormOperatorInput):Promise<BrainstormState> {
    if(actor!=="operator")throw new AppError("FORBIDDEN","Only the operator decides brainstorm");
    const input=operatorInputSchema.parse(raw),s=await this.state(task);
    if(this.replay(s,actor,input))return s;
    if(input.action==="extend") {
      if(input.expectedRevision!==s.revision)fail("STALE_STATE");
      if(input.maxRounds<=s.maxRounds||s.stage==="approved")fail("INVALID_EXTENSION");s.maxRounds=input.maxRounds;
    } else {
      const d=s.decisions.at(-1);
      if(s.stage!=="approval"||!d||d.version!==input.decisionVersion||d.hash!==input.decisionHash)fail("STALE_DECISION");
      if(input.action==="approve") {s.stage="approved";s.approvedDecision={version:d!.version,hash:d!.hash,by:actor,at:new Date().toISOString()};}
      else {if(s.round>=s.maxRounds)fail("ROUND_LIMIT");s.round++;s.stage="options";delete s.approvedDecision;s.rounds.push({round:s.round,options:[],critiques:[],feedback:input.feedback});}
    }
    return this.save(task,s,actor,input);
  }
}
