import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { pluginCatalog, setPluginEnabled, validatePlugins, qwenPluginCommand, type PluginInfo } from "../../src/plugins.js";
import { withQwenSkillSettings } from "../../src/skills.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { ProjectStore } from "../../src/project/store.js";
import { ProjectCommandService } from "../../src/project/commands.js";
import { createProjectServer } from "../../src/project/mcp.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
import { startUiServer } from "../../src/ui/server.js";

async function fixture() {
  const home = await tmpDir(), networkDir = join(home, "network"), dir = join(home, ".qwen/extensions/browser-kit");
  await mkdir(join(dir, "skills/browser-check"), { recursive: true });
  const manifest = join(dir, "qwen-extension.json");
  await writeFile(manifest, JSON.stringify({ name: "browser-kit", version: "1.0", description: "Browser checks", mcpServers: { browser: { command: "private-command", env: { TOKEN: "secret" } } } }));
  return { home, networkDir, manifest };
}

it("discovers real installed plugins without exposing commands/secrets and persists project enablement", async () => {
  const f = await fixture();
  const catalog = await pluginCatalog(f.networkDir, f.home);
  expect(catalog).toHaveLength(1);
  expect(catalog[0]).toMatchObject({ id: "browser-kit", skills: ["browser-check"], mcpServers: ["browser"], enabled: true });
  expect(JSON.stringify(catalog)).not.toContain("secret");
  expect(JSON.stringify(catalog)).not.toContain("private-command");
  await setPluginEnabled(f.networkDir, "browser-kit", false, f.home);
  expect((await pluginCatalog(f.networkDir, f.home))[0]!.enabled).toBe(false);
  await setPluginEnabled(f.networkDir, "browser-kit", true, f.home);
  expect((await pluginCatalog(f.networkDir, f.home))[0]!.enabled).toBe(true);
  await expect(setPluginEnabled(f.networkDir, "invented", true, f.home)).rejects.toThrow("not installed");
});

it("rejects disabled, changed, unknown plugins and assignments outside the Qwen team", async () => {
  const f = await fixture(), catalog = await pluginCatalog(f.networkDir, f.home), plugin = catalog[0]!;
  const input = { agents: ["lead", "review"], pluginsByAgent: { lead: [plugin.id] }, pluginLocks: { [plugin.id]: plugin.fingerprint } };
  expect(() => validatePlugins(input, catalog, ["lead"])).not.toThrow();
  expect(() => validatePlugins(input, [{ ...plugin, enabled: false }], ["lead"])).toThrow("unavailable");
  expect(() => validatePlugins(input, [{ ...plugin, fingerprint: "changed" }], ["lead"])).toThrow("changed");
  expect(() => validatePlugins(input, [], ["lead"])).toThrow("unavailable");
  expect(() => validatePlugins(input, catalog, ["review"])).toThrow("Qwen runner");
  expect(() => validatePlugins({ ...input, pluginsByAgent: { outsider: [] } }, catalog, ["outsider"])).toThrow("assigned Qwen");
});

it("serves the plugin catalog and persists enablement through the UI API", async () => {
  const f = await fixture();
  const pool = new RunnerPool(f.networkDir, [{ id: "lead", command: ["qwen", "-p", "{prompt}"] }], { home: f.home });
  const ui = await startUiServer(f.networkDir, { port: 0, runners: pool });
  try {
    const initial = await (await fetch(ui.url + "/api/plugins")).json() as { plugins: PluginInfo[]; qwenAgents: string[] };
    expect(initial.qwenAgents).toEqual(["lead"]);
    expect(initial.plugins[0]!.enabled).toBe(true);
    const changed = await fetch(ui.url + "/api/plugins/enabled", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "browser-kit", enabled: false }) });
    expect(changed.status).toBe(200);
    expect((await changed.json() as { plugins: PluginInfo[] }).plugins[0]!.enabled).toBe(false);
    expect((await (await fetch(ui.url + "/api/plugins")).json() as { plugins: PluginInfo[] }).plugins[0]!.enabled).toBe(false);
    const rejected = await fetch(ui.url + "/api/plugins/enabled", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.invalid" }, body: JSON.stringify({ id: "browser-kit", enabled: true }) });
    expect(rejected.status).toBe(403);
  } finally { await ui.close(); }
});

it("replaces inherited Qwen resource flags and uses none for an empty assignment", async () => {
  const f = await fixture(), catalog = await pluginCatalog(f.networkDir, f.home);
  const original = ["C:/npm/qwen.cmd", "-e", "unrelated", "other", "--extensions=global", "--allowed-mcp-server-names", "all", "-p", "{prompt}"];
  expect(qwenPluginCommand(original, catalog)).toEqual(["C:/npm/qwen.cmd", "-p", "{prompt}", "-e", "browser-kit"]);
  expect(qwenPluginCommand(["qwen", "-p", "{prompt}"], [])).toEqual(["qwen", "-p", "{prompt}", "-e", "none"]);
  expect(original).toContain("unrelated");
  expect(() => qwenPluginCommand(["codex"], [])).toThrow("only for Qwen");
});

it("limits MCP and skill discovery in the session without removing existing exclusions", async () => {
  const f = await fixture(), source = join(f.home, "system.json");
  await writeFile(source, JSON.stringify({ mcp: { excluded: ["blocked"] }, skills: { disabledLevels: ["extension"] } }));
  await withQwenSkillSettings(["qwen"], [], { QWEN_CODE_SYSTEM_SETTINGS_PATH: source, AGENT_ID: "lead", NETWORK_DIR: f.networkDir }, async env => {
    const settings = JSON.parse(await readFile(env.QWEN_CODE_SYSTEM_SETTINGS_PATH!, "utf8"));
    expect(settings.mcp).toEqual({ excluded: ["blocked"], allowed: ["agent-network", "browser"] });
    expect(settings.skills.disabledLevels).toEqual(["extension", "user", "project", "bundled"]);
    expect(settings.mcpServers["agent-network"]).toMatchObject({ command: process.execPath, env: { AGENT_ID: "lead", NETWORK_DIR: f.networkDir } });
  }, true, ["agent-network", "browser"]);
});

it("carries coordinator choices through approval into the exact runner command", async () => {
  const f = await fixture(), fs = await FileStore.open(f.networkDir), store = new ProjectStore(fs);
  const state = await store.read(), run = await store.enqueue("message", "Browser task"); await store.claim("owner");
  const catalog = await pluginCatalog(f.networkDir, f.home);
  const server = await createProjectServer({ networkDir: f.networkDir, projectId: state.projectId, runId: run.runId, ownerToken: "owner",
    agentIds: ["lead", "review"], qwenAgents: ["lead", "review"], plugins: catalog, resolved: {} });
  const client = new Client({ name: "test", version: "1" }), [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  const operator = await NetworkService.create(f.networkDir, { id: "operator", type: "ui" });
  let commandForTask: import("../../src/runner.js").RunnerOptions["pluginCommand"];
  const pool = new RunnerPool(f.networkDir, [{ id: "lead", command: ["qwen", "-p", "{prompt}"] }, { id: "review", command: ["qwen", "-p", "{prompt}"] }], {
    home: f.home, run: async options => { commandForTask = options.pluginCommand; await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => resolve())); return 0; },
  });
  try {
    const args = { operationId: "op", summary: "Browser task", payload: { title: "Check browser", description: "Verify UI", agents: ["lead", "review"], pluginsByAgent: { lead: ["browser-kit"], review: [] } } };
    expect((await client.callTool({ name: "propose_task", arguments: args })).isError).not.toBe(true);
    const proposal = (await store.read()).proposals[0]!;
    expect(proposal.payload.pluginLocks).toEqual({ "browser-kit": catalog[0]!.fingerprint });
    const preflight = async (_state: unknown, input: typeof proposal.payload) => validatePlugins(input, catalog, ["lead", "review"]);
    const commands = new ProjectCommandService(fs, operator);
    await expect(commands.createFromProposal(proposal.proposalId, proposal.hash, preflight)).rejects.toThrow("approval");
    await store.decideProposal(proposal.proposalId, proposal.hash, true, async () => {});
    const task = await commands.createFromProposal(proposal.proposalId, proposal.hash, preflight);
    expect(task.pluginsByAgent).toEqual(args.payload.pluginsByAgent);
    pool.start("lead");
    expect(await commandForTask!(task)).toEqual({ command: ["qwen", "-p", "{prompt}", "-e", "browser-kit"], mcpServers: ["agent-network", "browser"] });
    await setPluginEnabled(f.networkDir, "browser-kit", false, f.home);
    await expect(commandForTask!(task)).rejects.toThrow("unavailable");
  } finally { await pool.stop("lead"); operator.close(); await client.close(); await server.close(); }
});
