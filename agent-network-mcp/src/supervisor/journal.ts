import { AppError } from "../errors.js";
import type { FileStore } from "../storage/fileStore.js";

/**
 * What the supervisor saw and did, for the page: <network>/supervisor/journal/entry-NNN.json.
 * incident — the detector found something; action — the supervisor changed something through the page's API;
 * note — it explains what it found; needs-you — a decision only the human can take, with its recommendation;
 * session — one supervisor session ended (cost, outcome).
 */
export type JournalKind = "incident" | "action" | "note" | "needs-you" | "session";

export interface JournalEntry {
  id: string;
  at: string;
  kind: JournalKind;
  /** detector (no model), supervisor (its session), operator (you, on the page). */
  by: "detector" | "supervisor" | "operator";
  taskId?: string;
  text: string;
  data?: unknown;
  /** needs-you: when the operator marked it done on the page. */
  resolvedAt?: string;
}

const DIR = ["supervisor", "journal"];

export class Journal {
  /** Entries already read: they never change, except resolvedAt, which goes through resolve() of this instance. */
  private readonly cache = new Map<string, JournalEntry>();

  constructor(private readonly fs: FileStore) {}

  async add(entry: Omit<JournalEntry, "id" | "at">): Promise<JournalEntry> {
    return this.fs.createNumbered(DIR, "entry", (id) => ({ id, at: new Date().toISOString(), ...entry }));
  }

  /** The newest `limit` entries, oldest first. */
  async list(limit = 100): Promise<JournalEntry[]> {
    const entries = (await this.fs.listNumbered(DIR, "entry")).slice(-limit);
    const all = await Promise.all(
      entries.map(async (e) => {
        const known = this.cache.get(e.id);
        if (known) return known;
        const read = await this.fs.readJson<JournalEntry>([...DIR, e.name]);
        if (read) this.cache.set(e.id, read);
        return read;
      }),
    );
    return all.filter((e): e is JournalEntry => e !== null);
  }

  /** How many entries there are in all. */
  async count(): Promise<number> {
    return (await this.fs.listNumbered(DIR, "entry")).length;
  }

  /** The operator has dealt with a needs-you entry: it no longer shows as waiting for them. */
  async resolve(id: string): Promise<JournalEntry> {
    if (!/^entry-\d+$/.test(id)) throw new AppError("INVALID_INPUT", `Not a journal entry id: ${JSON.stringify(id)}`);
    const entry = await this.fs.readJson<JournalEntry>([...DIR, `${id}.json`]);
    if (!entry) throw new AppError("INVALID_INPUT", `No journal entry ${id}`);
    if (entry.kind !== "needs-you") throw new AppError("INVALID_INPUT", `${id} is a ${entry.kind}, not a decision for you`);
    const done = entry.resolvedAt ? entry : { ...entry, resolvedAt: new Date().toISOString() };
    await this.fs.writeJson([...DIR, `${id}.json`], done);
    this.cache.set(id, done);
    return done;
  }
}
