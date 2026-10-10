#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runCli } from "./cli.js";
import { loadConfig } from "./config.js";
import { isAppError } from "./errors.js";
import { createServer } from "./server.js";
import { NetworkService } from "./service.js";
import { FileStore } from "./storage/fileStore.js";
import { AgentStore } from "./stores/agentStore.js";

// stdout carries the MCP protocol; everything human-readable goes to stderr.
const log = (msg: string): void => {
  process.stderr.write(`[agent-network-mcp] ${msg}\n`);
};

async function main(): Promise<void> {
  if (process.argv[2] && process.argv[2] !== "serve") {
    const code = await runCli(process.argv.slice(2), process.env, (s) => process.stdout.write(s + "\n"));
    if (code >= 0) process.exit(code);
    return; // long-running operator command (ui) keeps the event loop alive
  }
  const config = loadConfig();
  let identity = config.identity;
  let announce = false;
  if (config.candidates.length > 1) {
    // shared config for several agents: take the first free name of the pool
    const claimed = await new AgentStore(await FileStore.open(config.networkDir)).claim(config.candidates, { type: identity.type, ...(identity.role ? { role: identity.role } : {}) });
    identity = { ...identity, id: claimed.agent.id };
    announce = claimed.created;
  }
  const service = await NetworkService.create(config.networkDir, identity, { log });
  await service.registerAgent(announce); // visible to the others right away; fails if a live process already owns this AGENT_ID
  const advanced = process.env.AGENT_NETWORK_ADVANCED === "1";
  const server = createServer(service, { advanced, log, waitMs: config.waitMs, freshPhases: config.freshPhases, underRunner: config.underRunner });
  await server.connect(new StdioServerTransport());
  log(`started: agent=${identity.id} network=${config.networkDir}${advanced ? " (advanced tools)" : ""}${config.freshPhases ? ` (fresh sessions: ${config.freshPhases.join(",")})` : ""}`);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    service.close();
    await service.markOffline().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.stdin.on("end", () => void shutdown());
}

main().catch((e: unknown) => {
  log(`fatal: ${isAppError(e) ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
});
