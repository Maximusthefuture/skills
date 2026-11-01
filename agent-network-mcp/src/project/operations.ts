import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import type { FileStore } from "../storage/fileStore.js";

export interface ProjectOperation<T = unknown> {
  operationId: string;
  projectId: string;
  kind: string;
  requestHash: string;
  state: "prepared" | "executing" | "finalizing" | "succeeded" | "failed";
  result?: T;
  error?: string;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** Mutation callbacks must write durable correlation atomically with their primary record. */
export class ProjectOperations {
  constructor(private readonly fs: FileStore, private readonly projectId: string) {}
  async execute<T>(input: {
    operationId: string; kind: string; request: unknown;
    recover: () => Promise<T | null>;
    mutate: () => Promise<T>;
    finalize?: (result: T) => Promise<T>;
  }): Promise<T> {
    const dir = ["project", this.projectId];
    const requestHash = createHash("sha256").update(JSON.stringify(canonical(input.request))).digest("hex");
    if (!input.operationId.trim()) throw new AppError("INVALID_INPUT", "Operation ID is required");
    return this.fs.withLock([...dir, ".operations-lock"], async () => {
      const path = [...dir, "operations.json"];
      const all = await this.fs.readJson<ProjectOperation<T>[]>(path) ?? [];
      let operation = all.find(o => o.operationId === input.operationId);
      if (operation && (operation.requestHash !== requestHash || operation.kind !== input.kind)) throw new AppError("INVALID_INPUT", "Operation ID has different parameters");
      if (operation?.state === "succeeded") return operation.result as T;
      if (operation?.state === "failed") throw new AppError("INVALID_INPUT", operation.error ?? "Operation failed; manual recovery required");
      const save = () => this.fs.writeJson(path, all);
      if (!operation) {
        operation = { operationId: input.operationId, projectId: this.projectId, kind: input.kind, requestHash, state: "prepared" };
        all.push(operation); await save();
      }
      // A recovery error is not absence: never repeat an ambiguous mutation.
      let recovered: T | null;
      try { recovered = await input.recover(); }
      catch (error) {
        operation.state = "failed";
        operation.error = error instanceof Error ? error.message : String(error);
        await save(); throw error;
      }
      let result: T;
      if (recovered !== null) result = recovered;
      else {
        operation.state = "executing"; await save();
        // Keep executing on failure: a mutation may have committed before throwing.
        // The next attempt must reconcile before deciding whether retry is safe.
        result = await input.mutate();
      }
      if (input.finalize) {
        operation.state = "finalizing"; operation.result = result; await save();
        result = await input.finalize(result);
      }
      operation.state = "succeeded"; operation.result = result; delete operation.error;
      await save();
      return result;
    });
  }
}
