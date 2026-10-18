import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdvancedTools } from "./mcp/advancedTools.js";
import { SWARM_INSTRUCTIONS } from "./mcp/instructions.js";
import { Swarm } from "./mcp/swarm.js";
import { registerSwarmTools } from "./mcp/tools.js";
import type { NetworkService } from "./service.js";
import type { Phase } from "./types.js";

export interface ServerOptions {
  /** Also expose the fine-grained tools (agent_*, task_*, agreement_*, ...). Off by default. */
  advanced?: boolean;
  log?: (m: string) => void;
  /** Default wait() timeout. */
  waitMs?: number;
  /** Phases this session hands over to a fresh session (see handoff.ts). */
  freshPhases?: Phase[];
  /** The session was started by a runner: it ends on a BLOCKED task. */
  underRunner?: boolean;
  /** The task a runner started this session for (AGENT_NETWORK_TASK_ID). */
  sessionTask?: string;
  /** How long a question to the operator holds the asker before it goes ahead with its own proposal. */
  operatorTimeoutMs?: number;
}

export function createServer(service: NetworkService, opts: ServerOptions = {}): McpServer {
  const log = opts.log ?? (() => undefined);
  // under a runner the session has the runner's system prompt and the server's hints: the general instructions (about
  // 1300 tokens) and create_task (a runner's session never starts a task) would only be read again every turn
  const server = new McpServer({ name: "agent-network-mcp", version: "0.2.0" }, opts.underRunner ? {} : { instructions: SWARM_INSTRUCTIONS });
  registerSwarmTools(server, new Swarm(service, log, { defaultWaitMs: opts.waitMs, freshPhases: opts.freshPhases, underRunner: opts.underRunner, sessionTask: opts.sessionTask, operatorTimeoutMs: opts.operatorTimeoutMs }), { omit: opts.underRunner ? ["create_task"] : [] });
  if (opts.advanced) registerAdvancedTools(server, service, log);
  return server;
}
