import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError, isAppError } from "../errors.js";
import { defineTool, errorResult } from "../mcp/toolkit.js";
import { readDigests } from "./digest.js";
import { ObserverStore } from "./store.js";

/**
 * The observer's MCP server (`agent-network-mcp observer-mcp`), started by its CLI session: the digests of closed tasks,
 * what it found and proposed before (with the operator's decisions), and one call that saves its report. It writes
 * only into <network>/observer/; it changes no code, no task and no agent.
 */
export const OBSERVER_INSTRUCTIONS =
  "You are the observer of an agent-network swarm: you look back across finished tasks for problems of the system itself " +
  "(protocol, prompts, runners, configuration), not of the project's code. Start with digests, then history; read logs and " +
  "the agent-network source when a digest points at something; end with exactly one save_report.";

const issue = z.object({
  id: z.string().optional().describe("issue-NNN from history when it is a known issue; omit for a new one"),
  title: z.string().describe("The problem in one line, e.g. 'Haiku testers hit the turn limit in long test runs'"),
  status: z.enum(["open", "watching", "fixed"]).describe("open: still happens; watching: a fix landed, not proven yet; fixed: gone in the recent tasks"),
  seenIn: z.array(z.string()).describe("Task ids of THESE digests where it showed, e.g. ['task-004']"),
  note: z.string().describe("What you saw this time, in short"),
});

const proposal = z.object({
  title: z.string().describe("The improvement, imperative, e.g. 'Give the tester a quiet test command in tester.md'"),
  problem: z.string().describe("What goes wrong, as the digests and logs show it"),
  evidence: z.string().describe("Where: task ids, agents, error codes, log lines"),
  impact: z.string().describe("How often, and what it costs: money, minutes, operator attention"),
  fix: z.string().describe("The concrete change: the file (e.g. examples/runner/instructions/tester.md, src/mcp/swarm.ts) and what to change in it; specific enough for a swarm task"),
  target: z.enum(["agent-network", "project"]).describe("agent-network: the swarm's own code, prompts and examples (the agent-network-mcp repo); project: this project's runners.json or instruction files"),
  priority: z.enum(["high", "medium", "low"]),
  issueId: z.string().optional().describe("issue-NNN it addresses, if known"),
});

export function createObserverServer(networkDir: string): McpServer {
  const server = new McpServer({ name: "agent-network-observer", version: "0.1.0" }, { instructions: OBSERVER_INSTRUCTIONS });
  const onError = (e: unknown) => errorResult(isAppError(e) ? { error: e.code, message: e.message } : { error: "INTERNAL_ERROR", message: String(e) });
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>) =>
    defineTool(server, onError, name, description, shape, handler);
  const store = () => ObserverStore.open(networkDir);

  tool(
    "digests",
    "Digests of the closed tasks you have not reported on yet (all: every one): phases and minutes, cost per agent, failed and turn-limit sessions, blocks with reasons, review findings, questions to the operator and answer times, refused tool calls by code, red builds, supervisor incidents.",
    { all: z.boolean().optional() },
    async ({ all }) => {
      const covered = new Set((await (await store()).reports()).flatMap((r) => r.covers));
      const digests = await readDigests(networkDir);
      const fresh = all ? digests : digests.filter((d) => !covered.has(d.taskId));
      return { digests: fresh, total: digests.length, newSinceLastReport: digests.filter((d) => !covered.has(d.taskId)).length };
    },
  );
  tool("history", "What you found and proposed before: the issues you track, your proposals with the operator's decisions (accepted: the task that implements it; rejected: why — do not propose it again), your last reports' titles.", {}, async () => {
    const s = await store();
    return {
      issues: await s.issues(),
      proposals: (await s.proposals()).map(({ id, title, status, target, priority, taskId, rejectReason, issueId }) => ({ id, title, status, target, priority, ...(taskId ? { taskId } : {}), ...(rejectReason ? { rejectReason } : {}), ...(issueId ? { issueId } : {}) })),
      reports: (await s.reports()).slice(-5).map(({ id, at, title, covers }) => ({ id, at, title, covers })),
    };
  });
  tool(
    "save_report",
    "Save this run once, at the end: a report for the operator (markdown, in the operator's language: Russian), the issues as you see them now, and new proposals (only ones not proposed or rejected before; each concrete enough to become a swarm task). Proposals appear on the page with Accept / Reject.",
    {
      title: z.string().describe("e.g. 'Tasks 004-009: turn limits and late answers'"),
      markdown: z.string().describe("The report: what went well, the problems with evidence and impact, what you propose and why; tables are fine"),
      covers: z.array(z.string()).describe("The task ids of the digests you read"),
      issues: z.array(issue),
      proposals: z.array(proposal),
    },
    async (a) => {
      if (!a.markdown.trim()) throw new AppError("INVALID_INPUT", "markdown must not be empty");
      const saved = await (await store()).saveRun({ title: a.title, markdown: a.markdown, covers: a.covers, issues: a.issues, proposals: a.proposals });
      return { report: saved.report.id, proposals: saved.proposals.map((p) => p.id), issues: saved.issues.length };
    },
  );
  return server;
}
