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

/** The tools an agent sees: swarm_context, create_task, send_message, propose, plan, subtasks, complete, build, spawn_agent, delegate, resolve_comments, wait. */
export function registerSwarmTools(server: McpServer, swarm: Swarm): void {
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>) =>
    defineTool(server, async (e: unknown) => errorResult(await swarm.errorBody(e, name)), name, description, shape, handler);

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
    "Send a message to ONE other agent of your task, or to 'operator' (the human) with a question only a human can answer (or, with fyi: true, something it should know that needs no answer). Your identity is added automatically. Also used to negotiate files: requestFiles asks the owner for permission to CHANGE their files (reading any file needs no permission), grantFiles (owner) gives it. A request blocks the asker until the owner answers, so owners answer first (nextAction 'respond').",
    {
      to: z.string().describe("Agent id of the recipient, one of the other agents of your task, e.g. 'reviewer'; or 'operator' to ask the human operator a question (the answer arrives in pendingMessages)"),
      message: z.string().describe("Text of the message, e.g. 'I take the controller and service, you take validation. Agreed?'"),
      requestFiles: z.array(z.string()).optional().describe("Only to CHANGE files OWNED by the recipient (never for reading: reading needs no permission). Explain why in message. The owner replies with grantFiles or a refusal"),
      grantFiles: z.array(z.string()).optional().describe("Owner only: let the recipient change these files of yours (answer to their request); message = conditions. To refuse, send a normal message with the reason"),
      fyi: z.boolean().optional().describe("To 'operator' only. true: for information, no answer expected (a reply to the operator's message, a status it asked for); it does not hold you. Default: a question the operator answers"),
      options: z
        .array(z.object({ label: z.string().describe("1-5 words, e.g. 'Service layer'"), description: z.string().optional().describe("What choosing it means, its trade-off") }))
        .optional()
        .describe("A question to 'operator' with 2-6 choices: the operator picks one on the page (buttons) or writes its own answer. Give them whenever there are options to choose from; the message still explains the question"),
      recommended: z.string().optional().describe("With options: the label you would take; you go ahead with it if nobody answers in time"),
      multiSelect: z.boolean().optional().describe("With options: true when several may be picked"),
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
            tasks: z.array(z.string()).optional().describe("Only when the task has an OpenSpec change ('openspec' in swarm_context): the tasks.md numbers this agent implements, e.g. ['1.1', '1.2']. Every open task goes to exactly one agent; [] = review only"),
            dependsOn: z.array(z.string()).optional().describe("Agents whose NEW code this agent's work calls, e.g. ['backend'] for a tester whose API tests call the endpoint backend builds. It still works in parallel, but its complete() is accepted only after they report their part and it ran its work against their code. Omit when it needs nobody's new code"),
          }),
        )
        .describe("One entry for EVERY agent of the task, including yourself"),
      decisions: z.array(z.string()).optional().describe("Agreed decisions, e.g. ['IDs are UUID']"),
      interfaces: z.array(z.string()).optional().describe("Agreed contracts, e.g. ['POST /users -> 201 {id}']"),
    },
    async (a) => swarm.propose(a),
  );
  tool(
    "plan",
    "Lead, DISCUSS, when swarm_context has 'plan' (the operator asked for a plan before the agreement): write the plan as ONE self-contained HTML page. The operator comments on it, edits it in place and answers its questions on the page; their feedback arrives in pendingMessages; propose() is accepted once they approve it. Each call saves a new version.",
    {
      html: z.string().optional().describe("The whole page: <!doctype html><html>... with inline <style>; for the first version or a rewrite"),
      edits: z.array(z.object({ find: z.string().describe("Exact text of the current version, occurring once"), replace: z.string().describe("Its replacement; \"\" removes it") })).optional().describe("Changes of the current version instead of the whole page (cheaper after feedback)"),
      note: z.string().optional().describe("What changed in this version, e.g. 'tester takes the API tests; the retry moved to the client'. After the operator's feedback, a note alone sends the same page again (nothing needed to change, and why)"),
      read: z.boolean().optional().describe("true: return the current version's html (after the operator edited it in place), save nothing"),
    },
    async (a) => swarm.plan(a),
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
    "Finish your step; meaning depends on the phase. DISCUSS: no arguments, approves the current agreement. IMPLEMENT: {result, filesChanged?, commits?, tasksDone?} marks your part ready (commits are optional; tasksDone for an OpenSpec task). SYNC: {status: PASS|NEEDS_FIX, findings?} submits your review (NEEDS_FIX needs an ERROR finding naming the agent to fix in relatedAgent; WARNING/INFO go with PASS). INTEGRATE (lead): {status, result, commits?, findings?, followUps?} after bringing everything together and running the build and tests; with PASS, followUps (when the task allows them) creates new tasks for work that is left.",
    {
      result: z.string().optional().describe("IMPLEMENT: short summary of what you implemented. INTEGRATE: what was merged, where, build/test outcome"),
      filesChanged: z.array(z.string()).optional().describe("IMPLEMENT only: project-relative paths you changed"),
      commits: z.array(z.string()).optional().describe("Optional. IMPLEMENT: hashes of your commits, if you committed. INTEGRATE: HEAD of the merged result, if you merged with git"),
      tasksDone: z.array(z.string()).optional().describe("IMPLEMENT, OpenSpec task only: the numbers of your tasks.md tasks you finished"),
      status: z.string().optional().describe("SYNC / INTEGRATE: PASS or NEEDS_FIX"),
      findings: z.array(finding).optional().describe("SYNC / INTEGRATE, required for NEEDS_FIX (at least one ERROR)"),
      followUps: z.array(followUp).optional().describe("INTEGRATE with PASS, lead only, when swarm_context shows followUps.remaining > 0: new tasks for work that is left; the agents start them after this task is DONE"),
    },
    async (a) => swarm.complete(a),
  );
  tool(
    "build",
    "Run the build or tests in your folder and get the outcome, test totals and what failed (failing tests with their first lines, compile errors), not the whole output; the full log is saved and its path returned (grep it or read a part for details). Use it instead of running Maven/Gradle/npm builds in the shell: their output fills your context. Default command: the task's verifyCommand. One plain command, no shell (&&, pipes, redirects).",
    {
      command: z.string().optional().describe("Build or test command, e.g. './mvnw -q test -Dtest=OrderServiceTest -Dsurefire.timeout=300' or 'npm test'; omit to run the task's verifyCommand"),
      timeoutMin: z.number().optional().describe("Stop it after this many minutes (default 20)"),
    },
    async (a, signal) => swarm.build(a, signal),
  );
  tool(
    "spawn_agent",
    "Lead, DISCUSS, before propose: add an agent to the team from a template the operator prepared ('spawnable' in swarm_context lists them and how many are left). It joins this task, its runner starts by itself in its own folder, and you give it an assignment in propose() like any agent. Use it when the work splits into more independent parts than the team has agents; every agent costs tokens.",
    {
      template: z.string().describe("Template name from spawnable.templates, e.g. 'backend'"),
      reason: z.string().describe("Which part of the work it takes and why the team needs it, e.g. 'the second endpoint group: /refunds, independent of /orders'"),
      id: z.string().optional().describe("Agent id; omit for a fresh one like 'backend-2'"),
      role: z.string().optional().describe("What it does: a role of the project's library by name (spawnable.roles), or the name of a role you write now with instructions, e.g. 'architect'"),
      instructions: z.string().optional().describe("Your own role (with role): what this agent does in the task, what it looks at, which skills it uses, what it must not do, how it reports; 40-6000 characters. Its template still decides the CLI, model and permissions"),
    },
    async (a) => swarm.spawnAgent(a),
  );
  tool(
    "delegate",
    "Lead, IMPLEMENT or INTEGRATE: hand a self-contained piece of your work to a new runner from a template ('delegable' in swarm_context): e.g. a load test, a concurrency test, a diagnosis, a benchmark. It runs alone (no agreement, no review) from your last commit, as your open subtask; its result and commits come back to you in pendingMessages. Commit your work first.",
    {
      template: z.string().describe("Template name from delegable.templates, e.g. 'tester'"),
      job: z.string().describe("What to do, concretely: the goal, where (files, endpoints), how to check it, what to report back, e.g. 'Load test POST /orders with 50 parallel requests; report p95 and errors'"),
      files: z.array(z.string()).optional().describe("Files or globs it may change, e.g. ['src/test/java/shop/load/**']; omit for a job that only reports"),
      role: z.string().optional().describe("A role of the project's library by name, or the name of one you write now with instructions"),
      instructions: z.string().optional().describe("Your own role (with role): what this agent does, what it must not do, how it reports; 40-6000 characters"),
    },
    async (a) => swarm.delegate(a),
  );
  tool(
    "resolve_comments",
    "Lead: answer the operator's review comments on the diff ('reviewComments' in swarm_context): each fixed (what changed) or declined (why it stays). complete() is refused while any is open.",
    {
      resolve: z.array(z.object({ id: z.string().describe("rc-N"), status: z.enum(["fixed", "declined"]), note: z.string().optional().describe("fixed: what changed; declined: why (required)") })).describe("One entry per comment you answer"),
    },
    async (a) => swarm.resolveComments(a),
  );
  tool(
    "wait",
    `Stop and wait while there is nothing useful for you to do. Returns when a message arrives, an action is required of you, or the task is done; status is MESSAGES | ACTION_REQUIRED | UPDATED (new task, phase change, blocked) | DONE | TIMEOUT (short answer; call wait again). Returns immediately if something is already pending. Max ${MAX_WAIT_MS}ms.`,
    { timeoutMs: z.number().int().min(0).max(MAX_WAIT_MS).optional().describe(`Milliseconds to wait; omit it to use the default (${swarm.defaultWaitMs})`) },
    async (a, signal) => swarm.wait(a, signal),
  );
}
