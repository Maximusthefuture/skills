import { AppError, isAppError } from "../errors.js";
import type { FileStore } from "../storage/fileStore.js";
import type { Agent, AgentIdentity, AgentStatus } from "../types.js";
import { assertAgentId } from "../validation.js";

export interface RegisterOptions {
  pid?: number;
  now?: () => Date;
  isProcessAlive?: (pid: number) => boolean;
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class AgentStore {
  constructor(private readonly fs: FileStore) {}

  private path(id: string): string[] {
    return ["agents", `${assertAgentId(id)}.json`];
  }

  async get(id: string): Promise<Agent | null> {
    return this.fs.readJson<Agent>(this.path(id));
  }

  async require(id: string): Promise<Agent> {
    const agent = await this.get(id);
    if (!agent) throw new AppError("AGENT_NOT_REGISTERED", `Agent '${id}' is not registered; call agent_register first`);
    return agent;
  }

  async list(): Promise<Agent[]> {
    const names = await this.fs.listJsonNames(["agents"]);
    const agents = await Promise.all(names.map((n) => this.get(n)));
    return agents.filter((a): a is Agent => a !== null);
  }

  /**
   * Register (or re-register after a restart) an identity. Offline agents are never deleted, so the
   * same AGENT_ID may come back. Registering an id that is currently owned by another *live* process
   * is rejected as a duplicate.
   */
  async register(identity: AgentIdentity, opts: RegisterOptions = {}): Promise<{ agent: Agent; created: boolean }> {
    assertAgentId(identity.id);
    const now = (opts.now ?? (() => new Date()))().toISOString();
    const pid = opts.pid ?? process.pid;
    const alive = opts.isProcessAlive ?? defaultIsProcessAlive;

    const existing = await this.get(identity.id);
    if (existing && existing.status !== "OFFLINE" && existing.pid !== undefined && existing.pid !== pid && alive(existing.pid)) {
      throw new AppError(
        "AGENT_ALREADY_REGISTERED",
        `Agent '${identity.id}' is already registered by a running process (pid ${existing.pid})`,
      );
    }

    const agent: Agent = {
      id: identity.id,
      type: identity.type,
      ...(identity.role ? { role: identity.role } : {}),
      status: "ONLINE",
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now,
      pid,
    };
    await this.fs.writeJson(this.path(identity.id), agent);
    return { agent, created: existing === null };
  }

  /**
   * Take the first identity of `candidates` that no live process holds, atomically across processes
   * (several MCP processes started from one shared config race for the pool). A process still owns exactly
   * one identity; this only decides which one at startup.
   */
  async claim(candidates: string[], base: Omit<AgentIdentity, "id">, opts: RegisterOptions = {}): Promise<{ agent: Agent; created: boolean }> {
    candidates.forEach((c) => assertAgentId(c));
    return this.fs.withLock(["agents", ".claim"], async () => {
      for (const id of candidates) {
        try {
          return await this.register({ ...base, id }, opts);
        } catch (e) {
          if (!isAppError(e) || e.code !== "AGENT_ALREADY_REGISTERED") throw e;
        }
      }
      throw new AppError("AGENT_ALREADY_REGISTERED", `Every identity of the pool is held by a running process: ${candidates.join(", ")}`);
    });
  }

  async heartbeat(id: string, status?: AgentStatus, now: () => Date = () => new Date()): Promise<Agent> {
    const agent = await this.require(id);
    const updated: Agent = { ...agent, lastSeenAt: now().toISOString(), status: status ?? (agent.status === "OFFLINE" ? "ONLINE" : agent.status) };
    await this.fs.writeJson(this.path(id), updated);
    return updated;
  }

  async setStatus(id: string, status: AgentStatus): Promise<void> {
    const agent = await this.get(id);
    if (!agent) return;
    await this.fs.writeJson(this.path(id), { ...agent, status, lastSeenAt: new Date().toISOString() });
  }
}
