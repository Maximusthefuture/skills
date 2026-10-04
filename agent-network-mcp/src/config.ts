import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors.js";
import type { AgentIdentity } from "./types.js";
import { assertAgentId } from "./validation.js";

export interface Config {
  identity: AgentIdentity;
  /** AGENT_ID may be a comma-separated pool ("backend,reviewer"); the process claims one free name at startup. */
  candidates: string[];
  networkDir: string;
}

/** Identity and network location come only from the process environment, never from tool input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const agentId = env.AGENT_ID;
  const networkDir = env.NETWORK_DIR;
  if (!agentId) throw new AppError("INVALID_CONFIG", "AGENT_ID environment variable is required");
  if (!networkDir) throw new AppError("INVALID_CONFIG", "NETWORK_DIR environment variable is required");
  const candidates = agentId.split(",").map((c) => c.trim());
  try {
    candidates.forEach((c) => assertAgentId(c, "AGENT_ID"));
    if (new Set(candidates).size !== candidates.length) throw new AppError("INVALID_CONFIG", "AGENT_ID pool contains duplicates");
  } catch (e) {
    throw new AppError("INVALID_CONFIG", (e as Error).message);
  }
  if (!isAbsolute(networkDir)) {
    throw new AppError("INVALID_CONFIG", "NETWORK_DIR must be an absolute path");
  }
  const resolved = resolve(networkDir);
  if (resolved === resolve("/")) {
    throw new AppError("INVALID_CONFIG", "NETWORK_DIR must not be the filesystem root");
  }
  const identity: AgentIdentity = { id: candidates[0]!, type: env.AGENT_TYPE || "unknown" };
  if (env.AGENT_ROLE) identity.role = env.AGENT_ROLE;
  return { identity, candidates, networkDir: resolved };
}
