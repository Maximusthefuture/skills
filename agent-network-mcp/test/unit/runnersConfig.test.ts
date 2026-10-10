import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
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
    expect(qwen.agents[0]!.promptFile).toBe(join(EXAMPLES, "qwen-prompt.md")); // resolved next to the config
    expect(qwen.agents[1]!.instructionsFile).toBe(join(EXAMPLES, "instructions", "reviewer.md"));

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

describe("instructions file per agent", () => {
  it("is set from the UI: checked, resolved next to the config, written back, shown with a preview", async () => {
    const dir = await tmpDir();
    const configPath = join(dir, "runners.json");
    await writeFile(configPath, JSON.stringify({ _comment: ["keep me"], defaults: { command: ["x", "{prompt}"] }, agents: [{ id: "backend" }, { id: "tester" }] }, null, 2));
    await writeFile(join(dir, "tester.md"), "You only review. Never change files.");
    const config = await loadRunnersConfig(configPath);
    const pool = new RunnerPool(join(dir, ".agent-network"), config.agents, { configPath: config.path! });

    await expect(pool.setInstructionsFile("tester", "missing.md")).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("Cannot read") });
    const view = await pool.setInstructionsFile("tester", "tester.md");
    expect(view.instructionsFile).toBe(join(dir, "tester.md"));
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved._comment).toEqual(["keep me"]);
    expect(saved.agents).toEqual([{ id: "backend" }, { id: "tester", instructionsFile: "tester.md" }]);
    expect((await pool.details()).find((d) => d.id === "tester")!.instructions).toEqual({ preview: "You only review. Never change files." });

    const reloaded = await loadRunnersConfig(configPath); // survives a restart
    expect(reloaded.agents[1]!.instructionsFile).toBe(join(dir, "tester.md"));

    await pool.setInstructionsFile("tester", "");
    expect(JSON.parse(await readFile(configPath, "utf8")).agents[1]).toEqual({ id: "tester" });
    expect((await pool.details()).find((d) => d.id === "tester")!.instructions).toBeNull();
  });

  it("a config pointing at a missing instructions file is refused at start", async () => {
    const dir = await tmpDir();
    const configPath = join(dir, "runners.json");
    await writeFile(configPath, JSON.stringify({ defaults: { command: ["x"] }, agents: [{ id: "a", instructionsFile: "nope.md" }] }));
    await expect(loadRunnersConfig(configPath)).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining("instructionsFile") });
  });
});
