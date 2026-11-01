import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import type { FileStore } from "../storage/fileStore.js";
import { AppError } from "../errors.js";

interface MemoryChange {
  operationId?: string;
  runId?: string;
  changeId: string;
  content: string;
  baseHash: string;
  status: "pending" | "applying" | "approved" | "rejected";
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Approval intent is durable before materialization, allowing interrupted writes to recover. */
export class ProjectMemory {
  constructor(private readonly fs: FileStore, private readonly projectId: string) {}
  private get dir() { return ["project", this.projectId]; }
  private async content(): Promise<string> {
    try { return await readFile(this.fs.resolve([...this.dir, "memory.md"]), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
  }
  private async locked<T>(fn: (changes: MemoryChange[]) => Promise<T>): Promise<T> {
    return this.fs.withLock([...this.dir, ".memory-lock"], async () => {
      const changes = await this.fs.readJson<MemoryChange[]>([...this.dir, "changes.json"]) ?? [];
      for (const change of changes.filter(c => c.status === "applying")) await this.apply(change, changes);
      return fn(changes);
    });
  }
  private save(changes: MemoryChange[]) { return this.fs.writeJson([...this.dir, "changes.json"], changes); }
  private async apply(change: MemoryChange, changes: MemoryChange[]) {
    const current = await this.content();
    if (hash(current) !== hash(change.content)) {
      if (hash(current) !== change.baseHash) throw new AppError("INVALID_INPUT", "Memory version conflict; manual recovery required");
      const tmp = [...this.dir, "memory.pending"];
      await writeFile(this.fs.resolve(tmp), change.content, "utf8");
      await rename(this.fs.resolve(tmp), this.fs.resolve([...this.dir, "memory.md"]));
    }
    change.status = "approved";
    await this.save(changes);
  }
  read() { return this.locked(async changes => {
    const content = await this.content();
    return { content, baseHash: hash(content), changes };
  }); }
  propose(content: string, baseHash: string, operationId?: string, runId?: string) {
    if (Buffer.byteLength(content) > 16384) throw new AppError("INVALID_INPUT", "Memory exceeds 16 KiB");
    return this.locked(async changes => {
      if (operationId !== undefined && !operationId.trim()) throw new AppError("INVALID_INPUT", "Memory operation ID is required");
      const existing = operationId ? changes.find(change => change.operationId === operationId) : undefined;
      if (existing) {
        if (existing.content !== content || existing.baseHash !== baseHash) throw new AppError("INVALID_INPUT", "Memory operation ID has different parameters");
        return existing;
      }
      const change: MemoryChange = { changeId: randomUUID(), content, baseHash, status: "pending", ...(operationId ? { operationId } : {}), ...(runId ? { runId } : {}) };
      changes.push(change); await this.save(changes); return change;
    });
  }
  decide(changeId: string, approve: boolean) {
    return this.locked(async changes => {
      const change = changes.find(c => c.changeId === changeId);
      if (!change) throw new AppError("INVALID_INPUT", "Unknown memory change");
      if (change.status !== "pending") {
        if (change.status === (approve ? "approved" : "rejected")) return change;
        throw new AppError("INVALID_INPUT", "Memory change already decided");
      }
      if (approve && hash(await this.content()) !== change.baseHash) throw new AppError("INVALID_INPUT", "Memory version conflict");
      change.status = approve ? "applying" : "rejected";
      await this.save(changes);
      if (approve) await this.apply(change, changes);
      return change;
    });
  }
}
