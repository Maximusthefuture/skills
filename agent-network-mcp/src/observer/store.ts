import { AppError } from "../errors.js";
import { FileStore } from "../storage/fileStore.js";

/**
 * What the observer keeps in <network>/observer/: its reports (report-NNN.json), the improvements it proposed
 * (proposals.json, decided on the page) and the problems it tracks across runs (issues.json).
 */
export interface ObserverReport {
  id: string;
  at: string;
  title: string;
  markdown: string;
  /** The tasks whose digests it read. */
  covers: string[];
}

export interface Proposal {
  id: string;
  reportId: string;
  at: string;
  title: string;
  /** What goes wrong, as the digests and logs show it. */
  problem: string;
  /** Where it was seen: tasks, sessions, log lines. */
  evidence: string;
  /** How often and what it costs (time, money, operator's attention). */
  impact: string;
  /** The concrete change: which file, what to change. */
  fix: string;
  /** agent-network: the swarm's own code and prompts (agent-network-mcp); project: this project's runners.json or instructions. */
  target: "agent-network" | "project";
  priority: "high" | "medium" | "low";
  issueId?: string;
  status: "open" | "accepted" | "rejected";
  decidedAt?: string;
  /** accepted: the task that implements it, in the network named. */
  taskId?: string;
  network?: string;
  /** rejected: why, so it is not proposed again. */
  rejectReason?: string;
}

export interface Issue {
  id: string;
  title: string;
  status: "open" | "watching" | "fixed";
  firstSeen: string;
  lastSeen: string;
  /** Task ids where it showed. */
  seenIn: string[];
  note: string;
}

const LOCK = ["observer", "store.lock"];

export class ObserverStore {
  private constructor(private readonly fs: FileStore) {}

  static async open(networkDir: string): Promise<ObserverStore> {
    return new ObserverStore(await FileStore.open(networkDir));
  }

  async reports(): Promise<ObserverReport[]> {
    const entries = await this.fs.listNumbered(["observer", "reports"], "report");
    const out: ObserverReport[] = [];
    for (const e of entries) {
      const r = await this.fs.readJson<ObserverReport>(["observer", "reports", e.name]);
      if (r) out.push(r);
    }
    return out;
  }

  async report(id: string): Promise<ObserverReport | null> {
    if (!/^report-\d{3,}$/.test(id)) throw new AppError("INVALID_INPUT", `No report ${id}`);
    return this.fs.readJson<ObserverReport>(["observer", "reports", `${id}.json`]);
  }

  async proposals(): Promise<Proposal[]> {
    return (await this.fs.readJson<Proposal[]>(["observer", "proposals.json"])) ?? [];
  }

  async issues(): Promise<Issue[]> {
    return (await this.fs.readJson<Issue[]>(["observer", "issues.json"])) ?? [];
  }

  /** One observer run: the report, its new proposals and the issue list as the observer sees it now. */
  async saveRun(input: {
    title: string;
    markdown: string;
    covers: string[];
    proposals: Omit<Proposal, "id" | "reportId" | "at" | "status">[];
    issues: (Omit<Issue, "id" | "firstSeen" | "lastSeen"> & { id?: string })[];
  }): Promise<{ report: ObserverReport; proposals: Proposal[]; issues: Issue[] }> {
    return this.fs.withLock(LOCK, async () => {
      const at = new Date().toISOString();
      const report = await this.fs.createNumbered<ObserverReport>(["observer", "reports"], "report", (id) => ({ id, at, title: input.title, markdown: input.markdown, covers: input.covers }));
      const known = await this.issues();
      let next = known.reduce((n, i) => Math.max(n, Number(i.id.slice(6))), 0);
      const issues = [...known];
      const ids = new Map<string, string>();
      for (const i of input.issues) {
        const found = i.id ? issues.find((x) => x.id === i.id) : undefined;
        if (found) {
          Object.assign(found, { title: i.title, status: i.status, note: i.note, lastSeen: at, seenIn: [...new Set([...found.seenIn, ...i.seenIn])] });
          ids.set(i.title, found.id);
        } else {
          const id = `issue-${String(++next).padStart(3, "0")}`;
          issues.push({ id, title: i.title, status: i.status, note: i.note, seenIn: [...new Set(i.seenIn)], firstSeen: at, lastSeen: at });
          ids.set(i.title, id);
        }
      }
      const old = await this.proposals();
      let p = old.reduce((n, x) => Math.max(n, Number(x.id.slice(5))), 0);
      const added: Proposal[] = input.proposals.map((x) => ({ ...x, id: `prop-${String(++p).padStart(3, "0")}`, reportId: report.id, at, status: "open" as const }));
      await this.fs.writeJson(["observer", "issues.json"], issues);
      await this.fs.writeJson(["observer", "proposals.json"], [...old, ...added]);
      return { report, proposals: added, issues };
    });
  }

  /** The operator's decision on the page. */
  async decide(id: string, change: Pick<Proposal, "status"> & Partial<Pick<Proposal, "taskId" | "network" | "rejectReason">>): Promise<Proposal> {
    return this.fs.withLock(LOCK, async () => {
      const all = await this.proposals();
      const p = all.find((x) => x.id === id);
      if (!p) throw new AppError("INVALID_INPUT", `No proposal ${id}`);
      if (p.status !== "open") throw new AppError("ALREADY_COMPLETED", `${id} is ${p.status} already`);
      Object.assign(p, change, { decidedAt: new Date().toISOString() });
      await this.fs.writeJson(["observer", "proposals.json"], all);
      return p;
    });
  }
}
