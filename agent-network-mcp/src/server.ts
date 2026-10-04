import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdvancedTools } from "./mcp/advancedTools.js";
import { SWARM_INSTRUCTIONS } from "./mcp/instructions.js";
import { Swarm } from "./mcp/swarm.js";
import { registerSwarmTools } from "./mcp/tools.js";
import type { NetworkService } from "./service.js";

export interface ServerOptions {
  /** Also expose the fine-grained tools (agent_*, task_*, agreement_*, ...). Off by default. */
  advanced?: boolean;
  log?: (m: string) => void;
}

export function createServer(service: NetworkService, opts: ServerOptions = {}): McpServer {
  const log = opts.log ?? (() => undefined);
  const server = new McpServer({ name: "agent-network-mcp", version: "0.2.0" }, { instructions: SWARM_INSTRUCTIONS });
  registerSwarmTools(server, new Swarm(service, log));
  if (opts.advanced) registerAdvancedTools(server, service, log);
  return server;
}
