import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_WAIT_MS } from "../service.js";
import { defineTool, errorResult } from "./toolkit.js";
import type { Swarm } from "./swarm.js";

// Fields every call needs are declared required, so the model sees them in the JSON schema (weak models
// emit "{}" when everything is optional). Phase-dependent arguments of complete() stay optional and are
// validated by the Swarm with an actionable error (message + nextAction).
const finding = z.object({
  severity: z.string().describe("INFO, WARNING or ERROR"),
  description: z.string().describe("What is wrong, concretely"),
  relatedAgent: z.string().optional().describe("Agent id who must fix it, e.g. 'backend'"),
  files: z.array(z.string()).optional().describe("Project-relative paths, e.g. ['src/main/java/A.java']"),
});

/** The tools an agent sees: swarm_context, create_task, send_message, propose, complete, wait. */
export function registerSwarmTools(server: McpServer, swarm: Swarm): void {
  const onError = async (e: unknown) => errorResult(await swarm.errorBody(e));
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>) =>
    defineTool(server, onError, name, description, shape, handler);

  tool(
    "swarm_context",
    "Everything you need to decide what to do next: task, phase, your assignment, other agents, unread messages, agreement, implementations, allowedActions and nextAction. Read-only and safe to call at any time. Call it before acting.",
    {},
    async () => swarm.context(),
  );
  tool(
    "create_task",
    "Start a new collaborative task ONLY when the USER asked you to. You become the lead; the other agents must already be registered (see registeredAgents in swarm_context). Allowed only if you have no active task. The description must be concrete: problem, expected behaviour, files, who does what; use the user's words, never invent scope.",
    {
      title: z.string().describe("Short title, e.g. 'POST /orders: missing amount must return 400'"),
      description: z.string().describe("Concrete spec: problem, expected behaviour, files to touch, who does what (e.g. 'backend: fix in src/main; reviewer: write the test'), what must not change"),
      agents: z.array(z.string()).describe("Ids of the OTHER agents, e.g. ['reviewer']; you are added automatically"),
      verifyCommand: z.string().optional().describe("Build/test command for the integration step, if the user named one, e.g. 'mvn -q verify'"),
    },
    async (a) => swarm.createTask(a),
  );
  tool(
    "send_message",
    "Send a message to ONE other agent of your task. Your identity is added automatically. Also used to negotiate files: requestFiles asks the owner for permission to change their file, grantFiles (owner) gives it.",
    {
      to: z.string().describe("Agent id of the recipient, one of the other agents of your task, e.g. 'reviewer'"),
      message: z.string().describe("Text of the message, e.g. 'I take the controller and service, you take validation. Agreed?'"),
      requestFiles: z.array(z.string()).optional().describe("To change files OWNED by the recipient: list them here and explain why in message. The owner replies with grantFiles"),
      grantFiles: z.array(z.string()).optional().describe("Owner only: let the recipient change these files of yours (after their request); message = conditions"),
    },
    async (a) => swarm.sendMessage(a),
  );
  tool(
    "propose",
    "DISCUSS only. Propose (or replace) the agreement: a summary plus ONE assignment {agentId, responsibility} for EVERY agent of the task, optionally decisions and interfaces. Others then approve with complete().",
    {
      summary: z.string().describe("One or two sentences: what the team will build"),
      assignments: z
        .array(
          z.object({
            agentId: z.string().describe("Agent id, e.g. 'backend'"),
            responsibility: z.string().describe("What this agent implements"),
            files: z.array(z.string()).describe("Files or globs this agent will change, e.g. ['src/main/java/A.java', 'src/test/**']. Must not overlap with other agents"),
          }),
        )
        .describe("One entry for EVERY agent of the task, including yourself"),
      decisions: z.array(z.string()).optional().describe("Agreed decisions, e.g. ['IDs are UUID']"),
      interfaces: z.array(z.string()).optional().describe("Agreed contracts, e.g. ['POST /users -> 201 {id}']"),
    },
    async (a) => swarm.propose(a),
  );
  tool(
    "complete",
    "Finish your step; meaning depends on the phase. DISCUSS: no arguments, approves the current agreement. IMPLEMENT: {result, filesChanged?, commits} marks your part ready (in a git project commit first and pass the hashes). SYNC: {status: PASS|NEEDS_FIX, findings?} submits your review (NEEDS_FIX needs an ERROR finding naming the agent to fix in relatedAgent; WARNING/INFO go with PASS). INTEGRATE (lead): {status, result, commits, findings?} after merging everything and running the build and tests.",
    {
      result: z.string().optional().describe("IMPLEMENT: short summary of what you implemented. INTEGRATE: what was merged, where, build/test outcome"),
      filesChanged: z.array(z.string()).optional().describe("IMPLEMENT only: project-relative paths you changed"),
      commits: z.array(z.string()).optional().describe("IMPLEMENT: hashes of your commits. INTEGRATE: HEAD of the merged result"),
      status: z.string().optional().describe("SYNC / INTEGRATE: PASS or NEEDS_FIX"),
      findings: z.array(finding).optional().describe("SYNC / INTEGRATE, required for NEEDS_FIX (at least one ERROR)"),
    },
    async (a) => swarm.complete(a),
  );
  tool(
    "wait",
    `Stop and wait while there is nothing useful for you to do. Returns when a message arrives, an action is required of you, or the task is done; status is MESSAGES | ACTION_REQUIRED | UPDATED (new task, phase change, blocked) | DONE | TIMEOUT (short answer; call wait again). Returns immediately if something is already pending. Max ${MAX_WAIT_MS}ms.`,
    { timeoutMs: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe(`Milliseconds to wait; omit it to use the default (${swarm.defaultWaitMs})`) },
    async (a, signal) => swarm.wait(a, signal),
  );
}
