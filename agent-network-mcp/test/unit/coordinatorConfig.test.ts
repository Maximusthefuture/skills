import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadRunnersConfig } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

it("loads explicit Codex coordinator effort and rejects invalid or unsupported effort", async () => {
  const file = join(await tmpDir(), "runners.json");
  const save = async (coordinator: unknown) => writeFile(file, JSON.stringify({ agents: [{ id: "a", command: ["codex"] }], coordinator }));
  const coordinator = { engine: "codex", model: "gpt-6.1-sol", reasoningEffort: "medium" };
  await save(coordinator);
  expect((await loadRunnersConfig(file)).coordinator).toEqual(coordinator);
  for (const invalid of [{ ...coordinator, reasoningEffort: "invalid" }, { ...coordinator, reasoningEffort: ["medium"] }, { ...coordinator, engine: "claude" }]) {
    await save(invalid);
    await expect(loadRunnersConfig(file)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  }
});
