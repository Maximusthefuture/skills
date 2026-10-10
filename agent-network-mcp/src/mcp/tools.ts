import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_WAIT_MS } from "../service.js";
import { defineTool, errorResult } from "./toolkit.js";
import type { Swarm } from "./swarm.js";

// Fields every call needs are declared required, so the model sees them in the JSON schema (weak models
// emit "{}" when everything is optional). Phase-dependent arguments of complete() stay optional and are
// validated by the Swarm with an actionable error (message + nextAction).
const followUp = z.object({
  title: z.string().describe("Short title, e.g. 'Validate currency on PUT /orders'"),
  description: z.string().describe("Concrete: what is wrong or missing, where (files), expected behaviour, who does what"),
  agents: z.array(z.string()).optional().describe("Agent ids, the first one leads; omit to keep this task's agents"),
});

const finding = z.object({
  severity: z.string().describe("INFO, WARNING or ERROR"),
  description: z.string().describe("What is wrong, concretely"),
  relatedAgent: z.string().optional().describe("Agent id who must fix it, e.g. 'backend'"),
  files: z.array(z.string()).optional().describe("Project-relative paths, e.g. ['src/main/java/A.java']"),
});

/** The tools an agent sees: swarm_context, create_task, send_message, propose, subtasks, complete, wait. */
export function registerSwarmTools(server: McpServer, swarm: Swarm): void {
  const onError = async (e: unknown) => errorResult(await swarm.errorBody(e));
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>) =>
    defineTool(server, onError, name, description, shape, handler);

  tool(
    "swarm_context",
    "What you need for your next step: task, phase, your assignment, unread messages, and what the current phase uses (agreement, ownership, the others' work), plus allowedActions and nextAction. Compact: only the current phase, the task description once per session. Read-only; call it before acting.",
    { full: z.boolean().optional().describe("true = everything (agreement, all implementations, reports), e.g. after a restart") },
    async (a) => swarm.context(a),
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
    "Send a message to ONE other agent of your task, or to 'operator' (the human) with a question only a human can answer. Your identity is added automatically. Also used to negotiate files: requestFiles asks the owner for permission to CHANGE their files (reading any file needs no permission), grantFiles (owner) gives it. A request blocks the asker until the owner answers, so owners answer first (nextAction 'respond').",
    {
      to: z.string().describe("Agent id of the recipient, one of the other agents of your task, e.g. 'reviewer'; or 'operator' to ask the human operator a question (the answer arrives in pendingMessages)"),
      message: z.string().describe("Text of the message, e.g. 'I take the controller and service, you take validation. Agreed?'"),
      requestFiles: z.array(z.string()).optional().describe("Only to CHANGE files OWNED by the recipient (never for reading: reading needs no permission). Explain why in message. The owner replies with grantFiles or a refusal"),
      grantFiles: z.array(z.string()).optional().describe("Owner only: let the recipient change these files of yours (answer to their request); message = conditions. To refuse, send a normal message with the reason"),
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
            files: z.array(z.string()).describe("Files or globs this agent will change, e.g. ['src/main/java/A.java', 'src/test/**']. Must not overlap with other agents. [] for an agent that changes nothing and only reviews the others' work (never invent a file for it)"),
          }),
        )
        .describe("One entry for EVERY agent of the task, including yourself"),
      decisions: z.array(z.string()).optional().describe("Agreed decisions, e.g. ['IDs are UUID']"),
      interfaces: z.array(z.string()).optional().describe("Agreed contracts, e.g. ['POST /users -> 201 {id}']"),
    },
    async (a) => swarm.propose(a),
  );
  tool(
    "subtasks",
    "Your own checklist for your part of the task (mainly IMPLEMENT): split a big assignment into steps, start one, mark them done as you finish, drop the ones that turn out unnecessary (with a reason). The list is kept by the server, so a restarted session and the other agents see your progress. complete() in IMPLEMENT is refused while subtasks are open. Ids are s1, s2, ...",
    {
      add: z.array(z.string()).optional().describe("New steps, one concrete action each, e.g. ['Add currency column + changeset', 'Validate currency in OrderService']"),
      start: z.string().optional().describe("Id of the step you work on now, e.g. 's2' (only one step is in progress)"),
      done: z.array(z.string()).optional().describe("Ids of finished steps, e.g. ['s1']"),
      drop: z.array(z.object({ id: z.string(), reason: z.string() })).optional().describe("Steps that are not needed, each with the reason"),
    },
    async (a) => swarm.subtasks(a),
  );
  tool(
    "complete",
    "Finish your step; meaning depends on the phase. DISCUSS: no arguments, approves the current agreement. IMPLEMENT: {result, filesChanged?, commits?} marks your part ready (commits are optional). SYNC: {status: PASS|NEEDS_FIX, findings?} submits your review (NEEDS_FIX needs an ERROR finding naming the agent to fix in relatedAgent; WARNING/INFO go with PASS). INTEGRATE (lead): {status, result, commits?, findings?, followUps?} after bringing everything together and running the build and tests; with PASS, followUps (when the task allows them) creates new tasks for work that is left.",
    {
      result: z.string().optional().describe("IMPLEMENT: short summary of what you implemented. INTEGRATE: what was merged, where, build/test outcome"),
      filesChanged: z.array(z.string()).optional().describe("IMPLEMENT only: project-relative paths you changed"),
      commits: z.array(z.string()).optional().describe("Optional. IMPLEMENT: hashes of your commits, if you committed. INTEGRATE: HEAD of the merged result, if you merged with git"),
      status: z.string().optional().describe("SYNC / INTEGRATE: PASS or NEEDS_FIX"),
      findings: z.array(finding).optional().describe("SYNC / INTEGRATE, required for NEEDS_FIX (at least one ERROR)"),
      followUps: z.array(followUp).optional().describe("INTEGRATE with PASS, lead only, when swarm_context shows followUps.remaining > 0: new tasks for work that is left; the agents start them after this task is DONE"),
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
