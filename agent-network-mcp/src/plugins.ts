import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FileStore } from "./storage/fileStore.js";
import { AppError } from "./errors.js";

export interface PluginInfo {
  id: string; name: string; version: string; description: string; fingerprint: string;
  enabled: boolean; skills: string[]; mcpServers: string[];
}
export interface PluginAssignment {
  pluginsByAgent?: Record<string, string[]>;
  pluginLocks?: Record<string, string>;
}
export const isQwen = (command: readonly string[]) => /(^|[/\\])qwen(\.exe|\.cmd|\.ps1)?$/i.test(command[0] ?? "");
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Installed Qwen extensions are exposed in the UI as plugins. No example cards or executable configs are sent to the model. */
export async function pluginCatalog(networkDir: string, home = homedir()): Promise<PluginInfo[]> {
  const fs = await FileStore.open(networkDir);
  const disabled = (await fs.readJson<{ disabled: string[] }>(["plugins.json"]))?.disabled ?? [];
  const root = join(home, ".qwen", "extensions");
  const plugins: PluginInfo[] = [];
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory() && !folder.isSymbolicLink()) continue;
    const dir = join(root, folder.name);
    const raw = await readFile(join(dir, "qwen-extension.json"), "utf8").catch(() => null);
    if (!raw) continue;
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(raw); } catch { continue; }
    if (!manifest || typeof manifest.name !== "string" || !NAME.test(manifest.name) || manifest.name === "none") continue;
    const skills = (await readdir(join(dir, "skills"), { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name).sort();
    const mcpServers = manifest.mcpServers && typeof manifest.mcpServers === "object" && !Array.isArray(manifest.mcpServers)
      ? Object.keys(manifest.mcpServers).sort() : [];
    if (mcpServers.some(name => !NAME.test(name) || name === "agent-network")) continue;
    plugins.push({ id: manifest.name, name: manifest.name, version: String(manifest.version ?? "unknown").slice(0, 80),
      description: typeof manifest.description === "string" ? manifest.description.slice(0, 500) : "",
      fingerprint: createHash("sha256").update(raw).digest("hex"), enabled: !disabled.includes(manifest.name), skills, mcpServers });
  }
  // Duplicate registered names cannot be resolved safely by a CLI name allowlist.
  return plugins.filter(plugin => plugins.filter(other => other.id === plugin.id).length === 1).sort((a,b) => a.id.localeCompare(b.id));
}

export async function setPluginEnabled(networkDir: string, id: string, enabled: boolean, home?: string): Promise<void> {
  if (!(await pluginCatalog(networkDir, home)).some(plugin => plugin.id === id)) throw new AppError("INVALID_INPUT", "Plugin is not installed");
  const fs = await FileStore.open(networkDir);
  await fs.withLock([".plugins-lock"], async () => {
    const disabled = new Set((await fs.readJson<{ disabled: string[] }>(["plugins.json"]))?.disabled ?? []);
    if (enabled) disabled.delete(id); else disabled.add(id);
    await fs.writeJson(["plugins.json"], { disabled: [...disabled] });
  });
}

export function validatePlugins(input: PluginAssignment & { agents: string[] }, catalog: PluginInfo[], qwenAgents: string[]): void {
  const selected = new Set<string>();
  for (const [agent, ids] of Object.entries(input.pluginsByAgent ?? {})) {
    if (!input.agents.includes(agent) || !qwenAgents.includes(agent)) throw new AppError("INVALID_INPUT", `Plugin assignment requires an assigned Qwen runner: ${agent}`);
    if (new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT", `Duplicate plugin assignment for ${agent}`);
    for (const id of ids) {
      const plugin = catalog.find(p => p.id === id && p.enabled);
      if (!plugin || input.pluginLocks?.[id] !== plugin.fingerprint) throw new AppError("INVALID_INPUT", `Plugin '${id}' is unavailable or its manifest changed; revise the proposal`);
      selected.add(id);
    }
  }
  if (Object.keys(input.pluginLocks ?? {}).some(id => !selected.has(id))) throw new AppError("INVALID_INPUT", "Plugin locks contain unassigned plugins");
}

/** Replace inherited extension/MCP choices, including repeated and equals-form flags. */
export function qwenPluginCommand(command: string[], plugins: PluginInfo[]): string[] {
  if (!isQwen(command)) throw new AppError("INVALID_INPUT", "Plugin selection is supported only for Qwen runners");
  if (command.includes("--")) throw new AppError("INVALID_INPUT", "Qwen runner command cannot use an option terminator with managed plugins");
  const args: string[] = [];
  const flags = ["-e", "--extensions", "--allowed-mcp-server-names"];
  for (let i = 1; i < command.length; i++) {
    const arg = command[i]!;
    if (flags.includes(arg)) { // Qwen array flags can consume several successive values.
      while (i + 1 < command.length && !command[i + 1]!.startsWith("-") && !command[i + 1]!.includes("{prompt}")) i++;
      continue;
    }
    if (flags.some(flag => arg.startsWith(flag + "="))) continue;
    if (arg.startsWith("-e") && !arg.startsWith("--") && arg.length > 2) continue;
    args.push(arg);
  }
  return [command[0]!, ...args, ...plugins.flatMap(p => ["-e", p.id]), ...(!plugins.length ? ["-e", "none"] : [])];
}
