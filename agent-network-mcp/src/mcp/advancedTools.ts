import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { defineTool, errorResult } from "./toolkit.js";
import { isAppError } from "../errors.js";
import { MAX_WAIT_MS, NetworkService, DEFAULT_WAIT_MS } from "../service.js";
import { MESSAGE_TYPES } from "../types.js";

const text = z.string().min(1).max(20_000);
const shortText = z.string().min(1).max(500);
const taskId = z.string().describe("Task id, e.g. task-001");
const filePath = z.string().min(1).max(1024).describe("Project-relative path, no '..', not absolute");

function fail(e: unknown, log: (m: string) => void): CallToolResult {
  if (isAppError(e)) return errorResult({ error: { code: e.code, message: e.message } });
  log(`internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`); // stack stays in stderr
  return errorResult({ error: { code: "INTERNAL_ERROR", message: "Internal error; see server log" } });
}

/** The original fine-grained tool set; only exposed with AGENT_NETWORK_ADVANCED=1 (debugging, scripted clients). */
export function registerAdvancedTools(server: McpServer, service: NetworkService, log: (m: string) => void = () => undefined): void {
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>) =>
    defineTool(server, (e) => fail(e, log), name, description, shape, handler);

  // --- agent
  tool("agent_register", "Register this agent (identity comes from the server environment). Safe to call again after a restart.", {}, async () => service.registerAgent());
  tool("agent_list", "List registered agents with status and lastSeenAt.", {}, async () => ({ agents: await service.listAgents() }));
  tool(
    "agent_heartbeat",
    "Update lastSeenAt; optionally set status.",
    { status: z.enum(["ONLINE", "WORKING", "WAITING"]).optional() },
    async (a) => service.heartbeat(a.status),
  );

  // --- task
  tool(
    "task_create",
    "Create a collaborative task (starts in DISCUSS). `agents` must include you and be registered.",
    { title: shortText, description: text, agents: z.array(z.string()).min(2).max(20) },
    async (a) => service.createTask(a),
  );
  tool("task_get", "Get a task.", { taskId }, async (a) => service.getTask(a.taskId));

  // --- agreement
  tool(
    "agreement_propose",
    "Propose (or replace, while in DISCUSS) the agreement. Every task agent needs exactly one assignment. Approvals reset on each new proposal.",
    {
      taskId,
      summary: text,
      assignments: z.array(z.object({ agentId: z.string(), responsibility: text })).min(1).max(20),
      decisions: z.array(text).max(100).optional(),
      interfaces: z.array(text).max(100).optional(),
    },
    async (a) => service.proposeAgreement(a),
  );
  tool(
    "agreement_approve",
    "Approve the current agreement. When all assigned agents approved, the task moves to IMPLEMENT. Optionally pass the version you read.",
    { taskId, version: z.number().int().positive().optional() },
    async (a) => service.approveAgreement(a),
  );
  tool("agreement_get", "Get the current agreement.", { taskId }, async (a) => service.getAgreement(a.taskId));

  // --- messages
  tool(
    "message_send",
    "Send a message to one other agent of the task. The sender is always you.",
    { taskId, to: z.string(), type: z.enum(MESSAGE_TYPES), content: text, replyTo: z.string().optional() },
    async (a) => service.sendMessage(a),
  );
  tool(
    "message_list",
    "List your messages in a task (default: inbox).",
    { taskId, direction: z.enum(["inbox", "sent", "all"]).optional(), unreadOnly: z.boolean().optional() },
    async (a) => ({ messages: await service.listMessages(a) }),
  );
  tool("message_read", "Read a message addressed to you (marks it read).", { taskId, messageId: z.string() }, async (a) => service.readMessage(a));

  // --- events
  tool(
    "wait_for_event",
    `Block until an event addressed to you (or broadcast) arrives, or timeout. Without taskId, covers all your tasks. Returns {status:"EVENT",event} or {status:"TIMEOUT"}. Call again to get the next event. Default ${DEFAULT_WAIT_MS}ms, max ${MAX_WAIT_MS}ms.`,
    { taskId: taskId.optional(), timeoutMs: z.number().int().min(0).max(MAX_WAIT_MS).optional() },
    async (a, signal) => service.waitForEvent(a, signal),
  );

  // --- implementation
  tool("implementation_start", "Start your implementation (IMPLEMENT phase). Idempotent while IN_PROGRESS.", { taskId }, async (a) => service.startImplementation(a.taskId));
  tool(
    "implementation_complete",
    "Mark your implementation READY_FOR_SYNC. When all agents are ready, the task moves to SYNC.",
    { taskId, summary: text, filesChanged: z.array(filePath).max(500).optional(), commits: z.array(z.string().max(64)).max(200).optional() },
    async (a) => service.completeImplementation(a),
  );
  tool("implementation_list", "List implementations of the task.", { taskId }, async (a) => ({ implementations: await service.listImplementations(a.taskId) }));

  // --- sync
  tool(
    "sync_submit",
    "Submit your sync review for the current round. Any NEEDS_FIX sends the task back to IMPLEMENT (name the agent to fix in relatedAgent); all PASS completes it.",
    {
      taskId,
      status: z.enum(["PASS", "NEEDS_FIX"]),
      findings: z
        .array(
          z.object({
            severity: z.enum(["INFO", "WARNING", "ERROR"]),
            description: text,
            relatedAgent: z.string().optional(),
            files: z.array(filePath).max(100).optional(),
          }),
        )
        .max(100)
        .optional(),
    },
    async (a) => service.submitSync(a),
  );
  tool("sync_list", "List sync reports (optionally of one round).", { taskId, round: z.number().int().positive().optional() }, async (a) => ({ reports: await service.listSyncReports(a) }));

  // --- phase
  tool("phase_get", "Current phase, who the task is waiting on, and a hint for the next step.", { taskId }, async (a) => service.getPhase(a.taskId));

}
