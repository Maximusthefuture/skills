import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { captureChange, changeHash } from "../../src/specInput.js";

describe("immutable change capture", () => {
  it("hashes binary and text from the captured files and keeps old text after edits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capture-"));
    try {
      await mkdir(join(dir, "change"));
      await writeFile(join(dir, "change", "spec.md"), "old requirement");
      await writeFile(join(dir, "change", "asset.bin"), Buffer.from([0, 255, 1]));
      const before = await captureChange(dir, "change");
      expect(before.hash).toBe(await changeHash(dir, "change"));
      expect(before.files.find(f => f.name.endsWith("asset.bin"))).toMatchObject({ bytes: 3, textUnavailable: "binary" });
      await writeFile(join(dir, "change", "spec.md"), "new requirement");
      expect(before.files.find(f => f.name.endsWith("spec.md"))?.text).toBe("old requirement");
      expect((await captureChange(dir, "change")).hash).not.toBe(before.hash);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("retains the hash of oversized text without sending its content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "capture-"));
    try {
      await mkdir(join(dir, "change"));
      await writeFile(join(dir, "change", "large.txt"), "a".repeat(500001));
      const captured = await captureChange(dir, "change");
      expect(captured.hash).toBe(await changeHash(dir, "change"));
      expect(captured.files[0]).toMatchObject({ textUnavailable: "size-limit", bytes: 500001 });
      expect(captured.files[0]!.text).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
