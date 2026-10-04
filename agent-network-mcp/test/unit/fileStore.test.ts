import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";

async function open() {
  const root = join(await tmpDir(), ".agent-network");
  return { root, fs: await FileStore.open(root) };
}

describe("FileStore atomic write", () => {
  it("writes and overwrites JSON without leaving temp files", async () => {
    const { fs } = await open();
    await fs.writeJson(["agents", "a.json"], { v: 1 });
    await fs.writeJson(["agents", "a.json"], { v: 2 });
    expect(await fs.readJson(["agents", "a.json"])).toEqual({ v: 2 });
    expect(await readdir(fs.resolve(["agents"]))).toEqual(["a.json"]);
  });

  it("returns null for a missing document", async () => {
    const { fs } = await open();
    expect(await fs.readJson(["nope.json"])).toBeNull();
  });

  it("createJson refuses to overwrite", async () => {
    const { fs } = await open();
    expect(await fs.createJson(["x.json"], { v: 1 })).toBe(true);
    expect(await fs.createJson(["x.json"], { v: 2 })).toBe(false);
    expect(await fs.readJson(["x.json"])).toEqual({ v: 1 });
  });

  it("concurrent overwrites never produce a corrupted file", async () => {
    const { fs } = await open();
    const big = "x".repeat(200_000);
    await Promise.all(Array.from({ length: 30 }, (_, i) => fs.writeJson(["doc.json"], { i, big })));
    const doc = await fs.readJson<{ i: number; big: string }>(["doc.json"]);
    expect(doc?.big.length).toBe(200_000);
  });
});

describe("FileStore numbered files", () => {
  it("allocates unique sequential ids under concurrent creation from several store instances", async () => {
    const { root } = await open();
    const stores = await Promise.all(Array.from({ length: 4 }, () => FileStore.open(root)));
    const created = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        stores[i % 4]!.createNumbered(["messages"], "msg", (id) => ({ id, n: i })),
      ),
    );
    const ids = created.map((c) => c.id);
    expect(new Set(ids).size).toBe(60);
    const listed = await stores[0]!.listNumbered(["messages"], "msg");
    expect(listed.map((e) => e.seq)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    for (const e of listed) {
      const doc = await stores[0]!.readJson<{ id: string }>(["messages", e.name]);
      expect(doc?.id).toBe(e.id);
    }
  });

  it("ignores temp files and foreign names when listing", async () => {
    const { fs } = await open();
    await fs.createNumbered(["m"], "msg", (id) => ({ id }));
    await writeFile(fs.resolve(["m", "msg-002.json.123.abcd.tmp"]), "{}");
    await writeFile(fs.resolve(["m", "notes.txt"]), "x");
    expect((await fs.listNumbered(["m"], "msg")).map((e) => e.id)).toEqual(["msg-001"]);
  });

  it("numbered directories are unique under concurrency", async () => {
    const { fs } = await open();
    const ids = await Promise.all(Array.from({ length: 20 }, () => fs.createNumberedDir(["tasks"], "task")));
    expect(new Set(ids).size).toBe(20);
  });
});

describe("FileStore path safety", () => {
  it.each([["../etc"], [".."], ["."], ["a/b"], ["a\\b"], ["/abs"], [""], ["bad\0name"]])("rejects segment %j", async (seg) => {
    const { fs } = await open();
    expect(() => fs.resolve([seg])).toThrow(AppError);
    await expect(fs.readJson([seg])).rejects.toBeInstanceOf(AppError);
    await expect(fs.writeJson(["ok", seg], {})).rejects.toBeInstanceOf(AppError);
  });

  it("keeps everything inside the root", async () => {
    const { fs } = await open();
    expect(fs.resolve(["tasks", "task-001", "task.json"]).startsWith(fs.root)).toBe(true);
  });

  it("rejects a relative root", async () => {
    await expect(FileStore.open("relative/dir")).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });
});

describe("FileStore lock", () => {
  it("serializes critical sections across store instances", async () => {
    const { root } = await open();
    const stores = await Promise.all(Array.from({ length: 3 }, () => FileStore.open(root)));
    let inside = 0;
    let max = 0;
    let counter = 0;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        stores[i % 3]!.withLock(["tasks", "task-001", ".lock"], async () => {
          inside++;
          max = Math.max(max, inside);
          const v = counter;
          await new Promise((r) => setTimeout(r, 5));
          counter = v + 1;
          inside--;
        }),
      ),
    );
    expect(max).toBe(1);
    expect(counter).toBe(12);
  });

  it("releases the lock when the callback throws", async () => {
    const { fs } = await open();
    await expect(fs.withLock(["l"], async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(fs.withLock(["l"], async () => "ok")).resolves.toBe("ok");
  });

  it("breaks a stale lock left by a crashed process", async () => {
    const { fs } = await open();
    const path = fs.resolve(["stale-lock"]);
    await mkdir(path, { recursive: true });
    const old = new Date(Date.now() - 120_000);
    await utimes(path, old, old);
    await expect(fs.withLock(["stale-lock"], async () => "ok")).resolves.toBe("ok");
  });
});
