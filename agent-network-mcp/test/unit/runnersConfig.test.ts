import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRunnersConfig } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples", "runner");

describe("runners config", () => {
  it("the shipped examples load: three agents, own worktrees, the prompt right after the CLI", async () => {
    const qwen = await loadRunnersConfig(join(EXAMPLES, "runners.qwen.example.json"));
    expect(qwen.networkDir).toBe("/abs/path/project/.agent-network");
    expect(qwen.agents.map((a) => [a.id, a.cwd, a.autostart])).toEqual([
      ["backend", "/abs/path/project-backend", true],
      ["reviewer", "/abs/path/project-reviewer", true],
      ["tester", "/abs/path/project-tester", false],
    ]);
    expect(qwen.agents[0]!.command.slice(0, 2)).toEqual(["qwen", "{prompt}"]);
    expect(qwen.agents[0]!.promptTemplate).toContain("{agent}"); // promptFile is resolved next to the config

    const claude = await loadRunnersConfig(join(EXAMPLES, "runners.claude.example.json"));
    expect(claude.agents.map((a) => a.id)).toEqual(["backend", "reviewer", "tester"]);
    expect(claude.agents[0]!.command.slice(0, 3)).toEqual(["claude", "-p", "{prompt}"]);
  });

  it("refuses a config without agents, without a command or with a repeated id", async () => {
    const dir = await tmpDir();
    const write = async (cfg: unknown) => {
      const p = join(dir, `c${Math.random()}.json`);
      await writeFile(p, JSON.stringify(cfg));
      return p;
    };
    await expect(loadRunnersConfig(await write({ agents: [] }))).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(loadRunnersConfig(await write({ agents: [{ id: "a" }] }))).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining('needs "command"') });
    await expect(loadRunnersConfig(await write({ defaults: { command: ["x"] }, agents: [{ id: "a" }, { id: "a" }] }))).rejects.toMatchObject({ message: expect.stringContaining("twice") });
    await expect(loadRunnersConfig(join(dir, "missing.json"))).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });
});
