import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunnerOptions } from "../../src/runner.js";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { startUiServer } from "../../src/ui/server.js";
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
    expect(qwen.agents.map((a) => a.model)).toEqual(["qwen/qwen3.5-9b", "qwen/qwen3.5-9b", "qwen/qwen3.5-9b"]); // {model} in the command
    expect(claude.agents.map((a) => a.model)).toEqual(["sonnet", "sonnet", "haiku"]);
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

describe("model per agent", () => {
  const write = async (dir: string, cfg: unknown) => {
    const p = join(dir, `c${Math.random()}.json`);
    await writeFile(p, JSON.stringify(cfg, null, 2));
    return p;
  };
  const QWEN = ["qwen", "{prompt}", "-m", "{model}"];

  it("{model} in the command needs a model; the page gets the list plus the current model", async () => {
    const dir = await tmpDir();
    await expect(loadRunnersConfig(await write(dir, { defaults: { command: QWEN }, agents: [{ id: "a" }] }))).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining('set "model"') });
    await expect(loadRunnersConfig(await write(dir, { defaults: { command: QWEN, model: "--yolo" }, agents: [{ id: "a" }] }))).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(loadRunnersConfig(await write(dir, { defaults: { command: QWEN, model: "m", models: "m" }, agents: [{ id: "a" }] }))).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining('"models"') });

    const config = await loadRunnersConfig(
      await write(dir, {
        defaults: { command: QWEN, model: "qwen/qwen3.5-9b", models: ["qwen/qwen3.5-9b", "qwen/qwen3-coder-30b"] },
        agents: [{ id: "backend" }, { id: "reviewer", model: "local:7b" }, { id: "claude", command: ["claude", "-p", "{prompt}", "--model", "haiku"] }],
      }),
    );
    const views = new RunnerPool(join(dir, ".agent-network"), config.agents).list();
    expect(views.map((v) => [v.id, v.model, v.models])).toEqual([
      ["backend", "qwen/qwen3.5-9b", ["qwen/qwen3.5-9b", "qwen/qwen3-coder-30b"]],
      ["reviewer", "local:7b", ["qwen/qwen3.5-9b", "qwen/qwen3-coder-30b", "local:7b"]],
      ["claude", null, []], // the command names its model itself
    ]);
  });

  it("is chosen on the page: checked, written back, given to the runner before every session", async () => {
    const dir = await tmpDir();
    const configPath = join(dir, "runners.json");
    await writeFile(configPath, JSON.stringify({ _comment: ["keep me"], defaults: { command: QWEN, model: "small", models: ["small"] }, agents: [{ id: "backend" }, { id: "fixed", command: ["x", "{prompt}"] }] }, null, 2));
    const config = await loadRunnersConfig(configPath);
    let given: RunnerOptions | undefined;
    const pool = new RunnerPool(join(dir, ".agent-network"), config.agents, {
      configPath: config.path!,
      run: (o) => {
        given = o;
        return new Promise((r) => o.signal!.addEventListener("abort", () => r(0)));
      },
    });
    pool.start("backend");
    const current = () => (given!.model as () => string | undefined)();
    expect(current()).toBe("small");

    await expect(pool.setModel("backend", "-rf")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(pool.setModel("fixed", "big")).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringContaining("{model}") });
    const view = await pool.setModel("backend", " big/model ");
    expect([view.model, view.models]).toEqual(["big/model", ["small", "big/model"]]);
    expect(current()).toBe("big/model"); // the running runner uses it from its next session
    expect(pool.log("backend").some((l) => l.endsWith("[ui] model: big/model (applies from the next session)"))).toBe(true);

    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved._comment).toEqual(["keep me"]);
    expect(saved.agents[0]).toEqual({ id: "backend", model: "big/model" });
    expect((await loadRunnersConfig(configPath)).agents[0]!.model).toBe("big/model"); // survives a restart

    const ui = await startUiServer(join(dir, ".agent-network"), { port: 0, runners: pool });
    try {
      const post = (model: string) => fetch(`${ui.url}/api/runners/backend/model`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
      expect(await (await post("haiku")).json()).toMatchObject({ id: "backend", model: "haiku" });
      expect((await post("two words")).status).toBe(400);
      const state = (await (await fetch(`${ui.url}/api/state`)).json()) as { control: { runners: { id: string; model: string | null; models: string[] }[] } };
      expect(state.control.runners.map((r) => [r.id, r.model, r.models])).toEqual([["backend", "haiku", ["small", "haiku"]], ["fixed", null, []]]);
    } finally {
      await ui.close();
    }
    await pool.stopAll();
  });
});
