import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { finalizeProjectInput } from "../../src/project/inputManifest.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
it("freezes input and verifies destination without recopying changed sources", async () => {
  const dir = await tmpDir(); const fs = await FileStore.open(join(dir, "network"));
  const source = join(dir, "input.md");await writeFile(source, "original");
  const manifest = await finalizeProjectInput(fs, "task-001", ["input.md"], async () => [{ rel: "input.md", abs: source }]);
  await writeFile(source, "changed source");
  expect(await finalizeProjectInput(fs, "task-001", ["input.md"], async () => { throw new Error("sources must not be read"); })).toEqual(manifest);
  await writeFile(fs.resolve(["tasks", "task-001", "input", "input.md"]), "changed destination");
  await expect(finalizeProjectInput(fs, "task-001", ["input.md"], async () => [])).rejects.toThrow("snapshot changed");
});
