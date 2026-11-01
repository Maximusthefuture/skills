import { expect, it } from "vitest";
import { ProjectOperations } from "../../src/project/operations.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
it("reconciles a mutation that committed before throwing and never repeats it", async () => {
  const fs = await FileStore.open(await tmpDir());
  const operations = new ProjectOperations(fs, "p1");
  let durable: string | null = null, calls = 0;
  const input = { operationId: "op1", kind: "create", request: { title: "Task" },
    recover: async () => durable,
    mutate: async (): Promise<string> => { calls++; durable = "task-001"; throw new Error("connection lost"); } };
  await expect(operations.execute(input)).rejects.toThrow("connection lost");
  expect(await new ProjectOperations(fs, "p1").execute(input)).toBe("task-001");
  expect(await operations.execute(input)).toBe("task-001");
  expect(calls).toBe(1);
  await expect(operations.execute({ ...input, request: { title: "changed" } })).rejects.toThrow("different parameters");
});
it("fails closed when recovery is ambiguous", async () => {
  const operations = new ProjectOperations(await FileStore.open(await tmpDir()), "p1");
  let calls = 0;
  const input = { operationId: "op1", kind: "create", request: {}, recover: async (): Promise<string | null> => { throw new Error("ambiguous"); }, mutate: async () => { calls++; return "duplicate"; } };
  await expect(operations.execute(input)).rejects.toThrow("ambiguous");
  await expect(operations.execute(input)).rejects.toThrow("ambiguous");
  expect(calls).toBe(0);
});
