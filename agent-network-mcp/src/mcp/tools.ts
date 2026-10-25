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
export function registerSwarmTools(server: McpServer, swarm: Swarm, opts: { omit?: string[] } = {}): void {
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>) => {
    if (opts.omit?.includes(name)) return;
    defineTool(server, async (e: unknown) => errorResult(await swarm.errorBody(e, name)), name, description, shape, handler);
  };

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
    "Message ONE agent of your task, or 'operator' (the human): a question only a human can answer, or with fyi: true a note that needs no answer. Also for files: requestFiles asks an owner to let you CHANGE its files (reading needs no permission), grantFiles (owner) allows it; owners answer first (nextAction 'respond').",
    {
      to: z.string().describe("Agent id, e.g. 'reviewer', or 'operator' (answers arrive in pendingMessages)"),
      message: z.string().describe("Text of the message, e.g. 'I take the controller and service, you take validation. Agreed?'"),
      requestFiles: z.array(z.string()).optional().describe("Files OWNED by the recipient you need to CHANGE (never for reading); say why in message"),
      grantFiles: z.array(z.string()).optional().describe("Owner: let the recipient change these files of yours; message = conditions. Refuse with a plain message"),
      fyi: z.boolean().optional().describe("true = a note that needs no answer: to 'operator' it holds nobody; to an agent it does not wake it (it reads the note with its next reply). Default: to 'operator' a question, to an agent a message that wakes it"),
      options: z
        .array(z.object({ label: z.string().describe("1-5 words, e.g. 'Service layer'"), description: z.string().optional().describe("What choosing it means, its trade-off") }))
        .optional()
        .describe("A question to 'operator' with 2-6 choices it picks on the page; give them whenever there are options"),
      recommended: z.string().optional().describe("With options: the label you would take (taken if nobody answers in time); fit the project as it is, no new framework or dependency unless the task asks"),
      multiSelect: z.boolean().optional().describe("With options: true when several may be picked"),
      summary: z.boolean().optional().describe("true: this question to 'operator' is your summary of a grilling (\"How I understand it: … Is that right?\"); its yes ends the grilling"),
    },
    async (a) => swarm.sendMessage(a),
  );
  tool(
    "propose",
    "DISCUSS: propose (or replace) the agreement: a summary and ONE assignment for EVERY agent of the task; the others approve with complete().",
    {
      summary: z.string().describe("One or two sentences: what the team will build"),
      assignments: z
        .array(
          z.object({
            agentId: z.string().describe("Agent id, e.g. 'backend'"),
            responsibility: z.string().describe("What this agent implements"),
            files: z.array(z.string()).describe("Files or globs it changes, e.g. ['src/main/java/A.java', 'src/test/**'], no overlap with others; [] = review only (never invent a file)"),
            tasks: z.array(z.string()).optional().describe("OpenSpec task only: its tasks.md numbers, e.g. ['1.1', '1.2']; each open task to exactly one agent"),
            dependsOn: z.array(z.string()).optional().describe("Agents whose NEW code its work calls, e.g. ['backend'] for API tests; it completes after they report and it ran against their code"),
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
    "Lead, when swarm_context has 'plan': write ONE self-contained HTML page for the operator. A plan (DISCUSS): the operator comments, edits it in place, answers its questions, approves it; then propose(). A change-writing task with analysts' input ('proposes.input'): stage \"input\" (DISCUSS, their artifacts as they are, the operator looks) and stage \"change\" (IMPLEMENT, your change next to theirs, the operator accepts it or returns it). Feedback arrives in pendingMessages. Each call saves a new version.",
    {
      html: z.string().optional().describe("The whole page: <!doctype html><html>... with inline <style>; for the first version or a rewrite"),
      edits: z.array(z.object({ find: z.string().describe("Exact text of the current version, occurring once"), replace: z.string().describe("Its replacement; \"\" removes it") })).optional().describe("Changes of the current version instead of the whole page (cheaper after feedback)"),
      note: z.string().optional().describe("What changed in this version, e.g. 'tester takes the API tests; the retry moved to the client'. After the operator's feedback, a note alone sends the same page again (nothing needed to change, and why)"),
      read: z.boolean().optional().describe("true: return the current version's html (after the operator edited it in place), save nothing; a big page comes as its headings, read it by parts with around"),
      around: z.string().optional().describe("Read only the parts of the current version around this text (a few words of it), save nothing"),
      stage: z.enum(["input", "change"]).optional().describe("A change-writing task with analysts' input: which page — \"input\" (their artifacts) or \"change\" (yours next to theirs). Without html the server builds the page from the files"),
      departures: z.array(z.object({ where: z.string(), what: z.string(), rule: z.string() })).optional().describe("stage input: where their artifacts depart from the project — where (file, section), what, rule (java-conventions, CLAUDE.md, file:line)"),
      coverage: z.array(z.object({ analyst: z.string(), outcome: z.enum(["taken", "adapted", "dropped", "added"]), where: z.string().optional(), why: z.string().optional() })).optional().describe("stage change: every requirement and scenario of their input — taken / adapted / dropped / added, where in your change, why (Qn, rule, code)"),
      diagrams: z.array(z.string()).optional().describe("Mermaid sources to show, e.g. a sequenceDiagram per scenario"),
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
    "Finish your step. DISCUSS: no arguments = approve the agreement. IMPLEMENT: {result, filesChanged?, commits?, tasksDone?} = your part is ready. SYNC: {status: PASS|NEEDS_FIX, findings?} = your review (NEEDS_FIX needs an ERROR with relatedAgent). INTEGRATE (lead): {status, result, commits?, findings?, followUps?, acceptance} after merging and a green build.",
    {
      result: z.string().optional().describe("IMPLEMENT: what you did. INTEGRATE: what was merged, the build/test outcome"),
      filesChanged: z.array(z.string()).optional().describe("IMPLEMENT only: project-relative paths you changed"),
      commits: z.array(z.string()).optional().describe("Hashes as git shows them (IMPLEMENT: yours; INTEGRATE: the merged HEAD)"),
      tasksDone: z.array(z.string()).optional().describe("OpenSpec task: your finished tasks.md numbers"),
      status: z.string().optional().describe("SYNC / INTEGRATE: PASS or NEEDS_FIX"),
      findings: z.array(finding).optional().describe("SYNC / INTEGRATE; NEEDS_FIX needs an ERROR"),
      followUps: z.array(followUp).optional().describe("INTEGRATE PASS, when followUps.remaining > 0: new tasks for work that is left"),
      acceptance: z
        .object({
          criteria: z.array(z.object({
            requirement: z.string().describe("A requirement of the task in a sentence (with OpenSpec: starting with the scenario's name)"),
            status: z.enum(["done", "partial", "not-done"]),
            tests: z.array(z.string()).optional().describe("Tests that prove it, at the merged commit: 'path#method' or 'path'"),
            where: z.array(z.string()).optional().describe("Where the code is: 'path' or 'path:line'"),
            note: z.string().optional().describe("Required for partial / not-done: what is missing"),
          })).describe("One per requirement of the task"),
          checks: z.array(z.object({ step: z.string(), command: z.string().optional(), expect: z.string().optional() })).optional().describe("How the operator sees it work by hand"),
          risks: z.array(z.object({ what: z.string(), why: z.string().optional() })).optional().describe("What you are unsure of"),
        })
        .optional()
        .describe("INTEGRATE PASS of a code task (required): what the operator accepts the task by"),
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
    "Lead, DISCUSS, before propose, only when the operator allowed it for the task ('spawnable' in swarm_context lists the templates and how many are left; no 'spawnable' = not allowed): add an agent to the team from a template. It joins this task, its runner starts by itself in its own folder, and you give it an assignment in propose() like any agent. Use it when the work splits into more independent parts than the team has agents; every agent costs tokens.",
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
    { timeoutMs: z.number().int().min(0).optional().describe(`Milliseconds to wait, at most ${MAX_WAIT_MS} (more is cut to it); omit it to use the default (${swarm.defaultWaitMs})`) },
    async (a, signal) => swarm.wait(a, signal),
  );
}
