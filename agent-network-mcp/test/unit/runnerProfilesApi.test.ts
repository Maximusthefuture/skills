import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => { await ui?.close(); ui = undefined; });

describe("runner role profile API", () => {
  it("persists profiles, clears inherited defaults and creates a stopped profiled runner without changing its model or command", async () => {
    const dir = await tmpDir(), configPath = join(dir, "runners.json");
    const command = ["unused-cli", "{prompt}", "--model", "{model}"];
    await writeFile(join(dir, "custom.md"), "Project-specific instructions");
    await writeFile(configPath, JSON.stringify({ networkDir: join(dir, ".agent-network"), project: dir,
      defaults: { command, model: "test-model", profile: "developer", autostart: false },
      agents: [{ id: "lead", instructionsFile: "custom.md" }],
      runnerTemplates: { mock: { command, model: "test-model", models: ["test-model"], profile: "analyst" } },
    }));
    const config = await loadRunnersConfig(configPath);
    let starts = 0;
    const pool = new RunnerPool(config.networkDir!, config.agents, { configPath, templates: config.runnerTemplates, run: async () => { starts++; return 0; } });
    ui = await startUiServer(config.networkDir!, { port: 0, runners: pool });
    const post = (path: string, data: unknown) => fetch(ui!.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const state = await (await fetch(ui.url + "/api/state")).json() as any;
    expect(state.control.runnerProfiles.map((p: any) => p.id)).toEqual(["analyst", "developer", "reviewer"]);
    expect(state.control.runners[0].profile).toBe("developer");
    const response = await post("/api/runners/lead/profile", { profile: "reviewer" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ profile: "reviewer", model: "test-model", running: false, command: command.join(" ") });
    expect((await loadRunnersConfig(configPath)).agents[0]).toMatchObject({ profile: "reviewer", instructionsFile: join(dir, "custom.md"), command });
    const before = await readFile(configPath, "utf8");
    expect((await post("/api/runners/lead/profile", { profile: "admin" })).status).toBe(400);
    expect((await post("/api/runners/lead/profile", {})).status).toBe(400);
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect((await post("/api/runners/lead/profile", { profile: null })).status).toBe(200);
    expect((await loadRunnersConfig(configPath)).agents[0]!.profile).toBeUndefined();
    const made = await post("/api/runners", { id: "reviewer", template: "mock", profile: "reviewer" });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ id: "reviewer", profile: "reviewer", model: "test-model", running: false });
    expect((await loadRunnersConfig(configPath)).agents.find(a => a.id === "reviewer")).toMatchObject({ profile: "reviewer", autostart: false });
    expect(starts).toBe(0);
  });
});
