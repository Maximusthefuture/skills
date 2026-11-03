import { join } from "node:path";
import { expect, it } from "vitest";
import { NetworkService } from "../../src/service.js";
import { Swarm } from "../../src/mcp/swarm.js";
import { inputSchema, nextExample, type BrainstormInput } from "../../src/brainstorm/index.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { parkMark } from "../../src/park.js";
import { PhaseManager } from "../../src/phase/phaseManager.js";
import { startUiServer } from "../../src/ui/server.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";
import { runRunner } from "../../src/runner.js";
import { brainstormReadOnlyCommand } from "../../src/brainstormRunner.js";
import { spawnAgent } from "../helpers/agentProcess.js";

async function setup(planReview = false) {
  const dir = join(await tmpDir(), ".agent-network");
  const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
  const lead = await NetworkService.create(dir, { id: "lead", type: "test" }), reviewer = await NetworkService.create(dir, { id: "reviewer", type: "test" });
  await lead.registerAgent(); await reviewer.registerAgent();
  const task = await operator.createTaskAsOperator({ title: "Choose storage", description: "Compare storage approaches for a small offline application", agents: ["lead", "reviewer"], brainstorm: { enabled: true, maxRounds: 1 }, planReview });
  const swarms = { lead: new Swarm(lead), reviewer: new Swarm(reviewer) };
  return { dir, operator, lead, reviewer, task, swarms, close: () => { operator.close(); lead.close(); reviewer.close(); } };
}
async function recommendation(s: Awaited<ReturnType<typeof setup>>) {
  for (const action of ["submit_option", "submit_critique", "synthesize"]) {
    for (const actor of action === "synthesize" ? ["lead"] as const : ["lead", "reviewer"] as const) {
      const state = (await s.operator.brainstormState(s.task.id))!;
      const input = inputSchema.parse(nextExample(state, actor)!.args);
      await s[actor].brainstormSubmit(s.task.id, input);
    }
  }
  return (await s.operator.brainstormState(s.task.id))!;
}
const assignments = [{ agentId: "lead", responsibility: "implement", files: ["src/**"] }, { agentId: "reviewer", responsibility: "review", files: [] }];

it("guides participants, hides initial options and gates all normal paths until explicit approval", async () => {
  const s = await setup();
  try {
    const ctx = await s.swarms.lead.context();
    expect(ctx.nextAction).toBe("brainstorm");
    const example = ctx.exampleCall as { args: { input: BrainstormInput } };
    await s.swarms.lead.brainstorm(example.args.input);
    const peer = await s.swarms.reviewer.context({ full: true });
    expect(JSON.stringify(peer.brainstorm)).not.toContain("Describe your proposed approach");
    expect(peer.nextAction).toBe("brainstorm");
    await expect(s.lead.proposeAgreement({ taskId: s.task.id, summary: "skip", assignments })).rejects.toThrow("BRAINSTORM_NOT_APPROVED");
    await expect(s.swarms.lead.build({ command: "npm run build" })).rejects.toThrow("BRAINSTORM_NOT_APPROVED");
    await expect(s.lead.approveAgreement({ taskId: s.task.id })).rejects.toThrow("BRAINSTORM_NOT_APPROVED");
    // Continue from the one saved option using current examples.
    let state = (await s.operator.brainstormState(s.task.id))!;
    await s.reviewer.brainstormSubmit(s.task.id, inputSchema.parse(nextExample(state, "reviewer")!.args));
    for (const actor of ["lead", "reviewer"] as const) {
      state = (await s.operator.brainstormState(s.task.id))!;
      await s[actor].brainstormSubmit(s.task.id, inputSchema.parse(nextExample(state, actor)!.args));
    }
    state = (await s.operator.brainstormState(s.task.id))!;
    await s.lead.brainstormSubmit(s.task.id, inputSchema.parse(nextExample(state, "lead")!.args));
    state = (await s.operator.brainstormState(s.task.id))!;
    const d = state.decisions.at(-1)!;
    await expect(s.lead.brainstormDecide(s.task.id, { action: "approve", operationId: "forged", decisionVersion: d.version, decisionHash: d.hash })).rejects.toThrow("operator");
    expect((await s.swarms.lead.context()).nextAction).toBe("wait");
    await s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "approve", decisionVersion: d.version, decisionHash: d.hash });
    await s.lead.proposeAgreement({ taskId: s.task.id, summary: "chosen approach", assignments });
    const result = await s.reviewer.approveAgreement({ taskId: s.task.id });
    expect(result.phase).toBe("IMPLEMENT");
    expect((await s.lead.agreements.find(s.task.id))!.brainstormDecisionHash).toBe(d.hash);
    expect((await s.swarms.lead.context()).brainstormDecision).toContain(d.hash);
  } finally { s.close(); }
});

it("requires an independent plan approval when planReview is enabled", async () => {
  const s = await setup(true);
  try {
    const state = await recommendation(s), d = state.decisions.at(-1)!;
    await s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "approve", decisionVersion: d.version, decisionHash: d.hash });
    await expect(s.lead.proposeAgreement({ taskId: s.task.id, summary: "skip plan", assignments })).rejects.toThrow("plan");
    await s.lead.writePlan({ taskId: s.task.id, html: "<!doctype html><html><body><h1>Storage plan</h1></body></html>" });
    await s.operator.planFeedback({ taskId: s.task.id, version: 1, approve: true });
    expect((await s.lead.planState(s.task.id)).approved).toBeTruthy();
    const current = (await s.operator.brainstormState(s.task.id))!;
    await s.operator.brainstormReset(s.task.id, { operationId: "plan-reset", expectedEpoch: current.epoch, expectedRevision: current.revision, title: s.task.title, description: "New recovery constraints", agents: s.task.agents, reason: "Requirements changed" });
    expect((await s.lead.planState(s.task.id)).approved).toBeUndefined();
    const replacement = await recommendation(s), decision = replacement.decisions.at(-1)!;
    await s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "new-approval", decisionVersion: decision.version, decisionHash: decision.hash });
    expect((await s.lead.writePlan({ taskId: s.task.id, html: "<!doctype html><html><body><h1>Revised storage plan</h1></body></html>" })).version).toBe(2);
  } finally { s.close(); }
});

it("accepts the context example through the actual MCP transport", async () => {
  const s = await setup();
  let client: Awaited<ReturnType<typeof spawnAgent>> | undefined;
  try {
    await s.lead.agents.setStatus("lead", "OFFLINE");
    client = await spawnAgent({ id: "lead", networkDir: s.dir });
    const context = await client.call("swarm_context");
    expect(context.exampleCall.tool).toBe("brainstorm");
    await client.call("brainstorm", context.exampleCall.args);
    expect((await s.operator.brainstormState(s.task.id))!.rounds[0]!.options).toHaveLength(1);
    await client.call("brainstorm", { input: { action: "read" } });
  } finally { await client?.close(); s.close(); }
});

it("serializes concurrent submissions and permits a stale participant to retry without losing materials", async () => {
  const s = await setup();
  try {
    const state = (await s.operator.brainstormState(s.task.id))!;
    const actors = ["lead", "reviewer"] as const;
    const results = await Promise.allSettled(actors.map(actor => s[actor].brainstormSubmit(s.task.id, inputSchema.parse(nextExample(state, actor)!.args))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const retryActor = actors[results.findIndex(result => result.status === "rejected")]!;
    const fresh = (await s.operator.brainstormState(s.task.id))!;
    await s[retryActor].brainstormSubmit(s.task.id, inputSchema.parse(nextExample(fresh, retryActor)!.args));
    const saved = (await s.operator.brainstormState(s.task.id))!;
    expect(saved.stage).toBe("critique");
    expect(saved.rounds[0]!.options.map(option => option.author).sort()).toEqual([...actors]);
  } finally { s.close(); }
});

it("exposes human approval in HTTP, rejects stale/supervisor decisions and supports explicit round extension", async () => {
  const s = await setup(), pool = new RunnerPool(s.dir, [{ id: "lead", command: ["qwen", "{prompt}"] }, { id: "reviewer", command: ["qwen", "{prompt}"] }]);
  const ui = await startUiServer(s.dir, { port: 0, runners: pool });
  try {
    const state = await recommendation(s), d = state.decisions.at(-1)!;
    const url = `${ui.url}/api/tasks/${s.task.id}/brainstorm/`;
    const post = (action: string, body: object, actor?: string) => fetch(url + action, { method: "POST", headers: { "content-type": "application/json", ...(actor ? { "x-agent-network-actor": actor } : {}) }, body: JSON.stringify(body) });
    const payload = { operationId: "approve", decisionVersion: d.version, decisionHash: d.hash };
    expect((await post("approve", payload, "supervisor")).status).toBe(403);
    expect((await post("approve", { ...payload, decisionHash: "0".repeat(64) })).ok).toBe(false);
    expect((await post("revise", { ...payload, operationId: "feedback", feedback: "Compare offline recovery" })).ok).toBe(false);
    const before = await parkMark(await FileStore.open(s.dir), s.task, "lead");
    expect((await post("extend", { operationId: "extend", expectedRevision: state.revision, maxRounds: 2, reason: "Need another review" })).ok).toBe(true);
    expect((await post("revise", { ...payload, operationId: "feedback", feedback: "Compare offline recovery" })).ok).toBe(true);
    expect((await s.operator.brainstormState(s.task.id))!.round).toBe(2);
    expect(await parkMark(await FileStore.open(s.dir), s.task, "lead")).not.toBe(before);
    expect((await post("approve", payload)).ok).toBe(false);
    const attention = await (await fetch(ui.url + "/api/attention")).text();
    expect(attention).not.toContain('"kind":"brainstorm"');
  } finally { await ui.close(); s.close(); }
});

it("the pure phase evaluator cannot advance a brainstorm task using an old agreement", () => {
  const task = { id: "task-001", status: "ACTIVE", phase: "DISCUSS", agents: ["lead"], brainstorm: { enabled: true, maxRounds: 2 } } as any;
  const agreement = { assignments: [{ agentId: "lead" }], approvedBy: ["lead"], brainstormDecisionHash: "old" } as any;
  const snapshot = { task, agreement, implementations: [], syncReports: [], brainstormApproved: true, brainstormDecisionHash: "new" };
  expect(new PhaseManager().evaluate(snapshot)).toBeNull();
  expect(new PhaseManager().evaluate({ ...snapshot, agreement: { ...agreement, brainstormDecisionHash: "new" } })).toMatchObject({ to: "IMPLEMENT" });
});

it("rejects incompatible task settings and freezes cancelled discussions", async () => {
  const s = await setup();
  try {
    await expect(s.operator.createTaskAsOperator({ title: "bad", description: "bad", agents: ["lead", "reviewer"], brainstorm: { enabled: true }, allowSpawn: true })).rejects.toThrow("cannot combine");
    await s.operator.cancelTask(s.task.id);
    const state = (await s.operator.brainstormState(s.task.id))!;
    await expect(s.lead.brainstormSubmit(s.task.id, inputSchema.parse(nextExample(state, "lead")!.args))).rejects.toThrow("cancelled");
  } finally { s.close(); }
});

it("restarts a read-only brainstorm session after approval without consuming the failure budget or leaking activity", async () => {
  const s = await setup();
  const lines: string[] = [], activity: unknown[] = []; let calls = 0, failed = false;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const state = await recommendation(s), d = state.decisions.at(-1)!;
    await s.lead.agents.setStatus("lead", "OFFLINE");
    await runRunner({ agent: "lead", networkDir: s.dir, command: ["codex", "exec", "--sandbox", "workspace-write", "{prompt}"], cwd: join(s.dir, ".."), once: true, maxRestarts: 0, signal: controller.signal,
      pollMs: 5, restartDelayMs: 0, output: text => lines.push(text), onActivity: event => activity.push(event), onGiveUp: async () => { failed = true; },
      sessionRun: async (argv, env, _cwd, sink, _signal, onEvent) => {
        calls++;
        if (calls === 1) {
          expect(env.AGENT_NETWORK_BRAINSTORM_READONLY).toBe("1");
          expect(argv).toContain("read-only");expect(argv).not.toContain("workspace-write");
          sink?.("private option details");onEvent?.({ kind: "tool_use", tool: "brainstorm", summary: "private option details", detail: "private option details" });
          await s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "runner-approval", decisionVersion: d.version, decisionHash: d.hash });
        } else {
          expect(env.AGENT_NETWORK_BRAINSTORM_READONLY).toBe("0");expect(argv).toContain("workspace-write");
          expect(argv.join(" ")).toContain(d.hash);
          await s.operator.cancelTask(s.task.id, "test finished");
        }
        return { code: 0 };
      },
    });
    expect(calls).toBe(2);expect(failed).toBe(false);
    expect(JSON.stringify([lines,activity])).not.toContain("private option details");
  } finally { clearTimeout(timeout);controller.abort();s.close(); }
});

it("changes the brief explicitly, archives old materials and invalidates agreement/plan approval", async () => {
  const s = await setup();
  try {
    const state = await recommendation(s), d = state.decisions.at(-1)!;
    await s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "approve", decisionVersion: d.version, decisionHash: d.hash });
    await s.lead.proposeAgreement({ taskId: s.task.id, summary: "old", assignments });
    await s.lead.grantFiles({ taskId: s.task.id, to: "reviewer", files: ["src/old.ts"], message: "Review fix" });
    expect((await s.reviewer.ownership(s.task.id)).grantedToYou).toHaveLength(1);
    const input = { operationId: "reset", expectedEpoch: state.epoch, expectedRevision: state.revision+1, title: s.task.title, description: "New requirement: offline recovery", agents: s.task.agents, reason: "Changed requirements" };
    const reset = await s.operator.brainstormReset(s.task.id, input);
    expect(reset.brainstorm.epoch).toBe(state.epoch+1);
    expect(reset.brainstorm.stage).toBe("options");
    const repeated = await s.operator.brainstormReset(s.task.id, input);
    expect(repeated.brainstorm.epoch).toBe(reset.brainstorm.epoch);
    const ctx = await s.swarms.reviewer.context({ full: true });
    expect(ctx.agreement).toBeUndefined();expect(ctx.nextAction).toBe("brainstorm");
    await expect(s.lead.getAgreement(s.task.id)).rejects.toMatchObject({ code: "AGREEMENT_NOT_READY" });
    expect(await s.lead.ownership(s.task.id)).toMatchObject({ declared: false, yours: [], grantedByYou: [] });
    expect((await s.reviewer.ownership(s.task.id)).grantedToYou).toEqual([]);
    await expect(s.lead.grantFiles({ taskId: s.task.id, to: "reviewer", files: ["src/old.ts"], message: "Old rights" })).rejects.toMatchObject({ code: "AGREEMENT_NOT_READY" });
    await expect(s.reviewer.approveAgreement({ taskId: s.task.id })).rejects.toThrow("NOT_APPROVED");
    await expect(s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "late", decisionVersion: d.version, decisionHash: d.hash })).rejects.toThrow("STALE_DECISION");
    expect(await (await FileStore.open(s.dir)).readJson(["tasks",s.task.id,"brainstorm","archive",`epoch-${state.epoch}.json`])).toMatchObject({ stage: "approved" });
    const updated = await recommendation(s), newDecision = updated.decisions.at(-1)!;
    await s.operator.brainstormDecide(s.task.id, { action: "approve", operationId: "new-decision", decisionVersion: newDecision.version, decisionHash: newDecision.hash });
    await s.lead.proposeAgreement({ taskId: s.task.id, summary: "new", assignments });
    expect((await s.reviewer.ownership(s.task.id)).grantedToYou).toEqual([]);
  } finally { s.close(); }
});

it("restricts native write tools for each supported CLI and refuses unsupported adapters", () => {
  expect(brainstormReadOnlyCommand(["qwen.cmd", "{prompt}"])).toContain("write_file");
  expect(brainstormReadOnlyCommand(["claude", "-p", "{prompt}"])).toContain("Read,Grep,Glob");
  expect(brainstormReadOnlyCommand(["codex.exe", "exec", "--full-auto", "--sandbox=workspace-write", "{prompt}"])).toEqual(["codex.exe","exec","{prompt}","--sandbox","read-only"]);
  expect(() => brainstormReadOnlyCommand(["custom", "{prompt}"])).toThrow("supports only");
});
