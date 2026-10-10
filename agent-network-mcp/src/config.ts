import { isAbsolute, resolve } from "node:path";
import { AppError } from "./errors.js";
import { parseFreshPhases } from "./handoff.js";
import { AUTO, detectNetworkDir } from "./networkDir.js";
import { MAX_WAIT_MS } from "./service.js";
import type { AgentIdentity, Phase } from "./types.js";
import { assertAgentId } from "./validation.js";

export interface Config {
  identity: AgentIdentity;
  /** AGENT_ID may be a comma-separated pool ("backend,reviewer"); the process claims one free name at startup. */
  candidates: string[];
  networkDir: string;
  /** NETWORK_DIR=auto: the path was found from the git repository of the working folder. */
  networkDirDetected?: true;
  /** AGENT_NETWORK_WAIT_MS: default wait() timeout; must stay below the client's tool-call timeout (Codex: 60 s). */
  waitMs?: number;
  /** AGENT_NETWORK_FRESH_PHASES (set by a runner): phases this session hands over to a fresh one when the task enters them. */
  freshPhases?: Phase[];
  /** AGENT_NETWORK_RUNNER=1: the session was started by a runner. */
  underRunner?: boolean;
}

/** Identity and network location come only from the process environment, never from tool input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Config {
  const agentId = env.AGENT_ID;
  if (!agentId) throw new AppError("INVALID_CONFIG", "AGENT_ID environment variable is required");
  if (!env.NETWORK_DIR) throw new AppError("INVALID_CONFIG", `NETWORK_DIR environment variable is required: an absolute path, or "${AUTO}" for <git repository root>/.agent-network`);
  const detected = env.NETWORK_DIR === AUTO;
  const networkDir = detected ? detectNetworkDir(cwd) : env.NETWORK_DIR;
  if (!networkDir) throw new AppError("INVALID_CONFIG", `NETWORK_DIR=${AUTO} needs a git repository, but ${cwd} is not inside one`);
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
  let waitMs: number | undefined;
  if (env.AGENT_NETWORK_WAIT_MS) {
    waitMs = Number(env.AGENT_NETWORK_WAIT_MS);
    if (!Number.isInteger(waitMs) || waitMs < 1000 || waitMs > MAX_WAIT_MS) {
      throw new AppError("INVALID_CONFIG", `AGENT_NETWORK_WAIT_MS must be an integer 1000..${MAX_WAIT_MS}`);
    }
  }
  const freshPhases = parseFreshPhases(env.AGENT_NETWORK_FRESH_PHASES, "AGENT_NETWORK_FRESH_PHASES");
  const identity: AgentIdentity = { id: candidates[0]!, type: env.AGENT_TYPE || "unknown" };
  if (env.AGENT_ROLE) identity.role = env.AGENT_ROLE;
  return { identity, candidates, networkDir: resolved, ...(detected ? { networkDirDetected: true as const } : {}), ...(waitMs ? { waitMs } : {}), ...(freshPhases.length ? { freshPhases } : {}), ...(env.AGENT_NETWORK_RUNNER === "1" ? { underRunner: true } : {}) };
}
