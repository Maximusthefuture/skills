import type { FileStore } from "../storage/fileStore.js";
import type { EventType, NetworkEvent } from "../types.js";
import { assertAgentId, assertTaskId } from "../validation.js";

export const GLOBAL_SCOPE = "_global";

export interface NewEvent {
  type: EventType;
  taskId?: string;
  targetAgent?: string | null;
  sourceAgent?: string;
  payload?: unknown;
}

export interface StoredEvent {
  event: NetworkEvent;
  seq: number;
}

type Cursors = Record<string, number>;

/**
 * Events live as one file per event: tasks/<task>/events/event-NNN.json, with agent-wide events
 * (AGENT_REGISTERED) in events/. Each agent keeps a private cursor per scope (cursors/<agent>.json),
 * written only by that agent's own process.
 */
export class EventStore {
  constructor(private readonly fs: FileStore) {}

  private dir(scope: string): string[] {
    return scope === GLOBAL_SCOPE ? ["events"] : ["tasks", assertTaskId(scope), "events"];
  }

  async create(input: NewEvent): Promise<NetworkEvent> {
    const scope = input.taskId ?? GLOBAL_SCOPE;
    return this.fs.createNumbered(this.dir(scope), "event", (id) => ({
      id,
      type: input.type,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      targetAgent: input.targetAgent ?? null,
      ...(input.sourceAgent ? { sourceAgent: input.sourceAgent } : {}),
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    }));
  }

  async list(scope: string, afterSeq = 0): Promise<StoredEvent[]> {
    const entries = (await this.fs.listNumbered(this.dir(scope), "event")).filter((e) => e.seq > afterSeq);
    const out: StoredEvent[] = [];
    for (const e of entries) {
      const event = await this.fs.readJson<NetworkEvent>([...this.dir(scope), e.name]);
      if (event) out.push({ event, seq: e.seq });
    }
    return out;
  }

  async getCursors(agentId: string): Promise<Cursors> {
    return (await this.fs.readJson<Cursors>(["cursors", `${assertAgentId(agentId)}.json`])) ?? {};
  }

  async setCursor(agentId: string, scope: string, seq: number): Promise<void> {
    const cursors = await this.getCursors(agentId);
    if ((cursors[scope] ?? 0) >= seq) return;
    cursors[scope] = seq;
    await this.fs.writeJson(["cursors", `${assertAgentId(agentId)}.json`], cursors);
  }
}
