import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { runSession } from "../runner.js";
import type { CoordinatorExecutor } from "./coordinator.js";
import { COORDINATOR_INSTRUCTIONS as system } from "./prompt.js";
import type { PluginInfo } from "../plugins.js";


/** Fixed argv: caller configuration cannot re-enable coding tools or repository hooks. */
export function coordinatorArgv(prompt: string, model?: string, mcpConfig?: string): string[] {
  return ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose",
    "--tools", "", "--strict-mcp-config", "--mcp-config", mcpConfig ?? '{"mcpServers":{}}',
    ...(mcpConfig ? ["--allowedTools", "mcp__project__read_history", "mcp__project__read_task_context", "mcp__project__read_proposal", "mcp__project__propose_task", "mcp__project__read_memory", "mcp__project__propose_memory_change"] : []),
    "--settings", '{"disableAllHooks":true}', "--setting-sources", "",
    "--no-session-persistence", "--system-prompt", system,
    ...(model ? ["--model", model] : [])];
}

export function kimiCoordinatorArgv(prompt: string, profileFile: string, model?: string, command = "kimi"): string[] {
  return [command, "--agent-file", profileFile, "--skills-dir", "", "--prompt", prompt,
    "--output-format", "stream-json", ...(model ? ["--model", model] : [])];
}

const projectTools = ["read_history", "read_task_context", "read_proposal", "propose_task", "read_memory", "propose_memory_change"];

/** Codex receives a temporary, allowlisted MCP config and no shell or web tools. */
export function codexCoordinatorArgv(prompt: string, model: string | undefined, cwd: string, entry: {
  command: string; args: string[]; env: Record<string, string>;
}, command = "codex"): string[] {
  const config = (key: string, value: unknown) => ["-c", `${key}=${JSON.stringify(value)}`];
  return [command, "exec", "--json", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
    "--sandbox", "read-only", "--disable", "shell_tool", "--cd", cwd,
    ...config("web_search", "disabled"),
    ...config("developer_instructions", system),
    ...config("mcp_servers.project.command", entry.command),
    ...config("mcp_servers.project.args", entry.args),
    ...config("mcp_servers.project.cwd", cwd),
    ...Object.entries(entry.env).flatMap(([key, value]) => config(`mcp_servers.project.env.${key}`, value)),
    ...config("mcp_servers.project.enabled_tools", projectTools),
    ...config("mcp_servers.project.default_tools_approval_mode", "approve"),
    ...config("mcp_servers.project.required", true),
    ...(model ? ["--model", model] : []), prompt];
}

export function isolatedCoordinatorExecutor(options: {
  snapshot: () => Promise<unknown>;
  model?: string;
  engine?: "claude" | "kimi" | "codex";
  project?: { networkDir: string; projectId: string; agentIds: string[]; plugins?: () => Promise<{ plugins: PluginInfo[]; qwenAgents: string[] }>; resolved: { maxTaskCostUsd?: number; maxCostUsd?: number; verifyCommand?: string } };
  run?: typeof runSession;
}): CoordinatorExecutor {
  return async ({ message, run, signal, retryContext }) => {
    if (signal.aborted) throw new Error("Coordinator cancelled");
    const resources = await options.project?.plugins?.();
    const snapshot = JSON.stringify({ ...await options.snapshot() as object, ...(resources ? { resources } : {}) });
    if (Buffer.byteLength(snapshot) > 65536) throw new Error("Project snapshot exceeds 64 KiB");
    const cwd = await mkdtemp(join(tmpdir(), "agent-network-coordinator-"));
    try {
      const prompt = JSON.stringify({ context: JSON.parse(snapshot), request: { messageId: message.messageId, content: message.content },
        ...(run.retryOfRunId ? { retry: { retryOfRunId: run.retryOfRunId, savedState: retryContext,
          instruction: "This is a retry. Use saved proposals and memory changes only; do not create new ones. Explain what was already saved and continue answering the original request." } } : {}) });
      let mcpConfig: string | undefined;
      let argv: string[];
      let kimiOAuthHost: string | undefined;
      if (options.project) {
        if (!run.ownerToken) throw new Error("Project run owner token missing");
        const entry = { command: process.execPath, args: [fileURLToPath(new URL("../index.js", import.meta.url)), "project-mcp"],
          env: { NETWORK_DIR: options.project.networkDir, PROJECT_ID: options.project.projectId,
            PROJECT_RUN_ID: run.runId, PROJECT_OWNER_TOKEN: run.ownerToken, PROJECT_AGENT_IDS: JSON.stringify(options.project.agentIds),
            PROJECT_RESOLVED: JSON.stringify(options.project.resolved),
            PROJECT_PLUGINS: JSON.stringify(resources?.plugins ?? []), PROJECT_QWEN_AGENTS: JSON.stringify(resources?.qwenAgents ?? []) } };
        if (options.engine === "kimi") {
          const home = join(cwd, ".kimi-code");
          await mkdir(home, { recursive: true });
          const sourceConfig = await readFile(join(process.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code"), "config.toml"), "utf8");
          const sections = new Map<string, Record<string, string>>([["", {}]]);
          let section = "";
          for (const line of sourceConfig.split(/\r?\n/)) {
            const header = /^\[([^\]]+)\]$/.exec(line.trim());
            if (header) { section = header[1]!.replaceAll('"', ""); sections.set(section, {}); continue; }
            const pair = /^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim());
            if (pair) sections.get(section)![pair[1]!] = JSON.parse(`"${pair[2]}"`) as string;
            else {
              const number = /^([A-Za-z0-9_-]+)\s*=\s*(\d+)\s*$/.exec(line.trim());
              if (number) sections.get(section)![number[1]!] = number[2]!;
            }
          }
          const root = sections.get("") ?? {};
          const selectedModel = options.model ?? root.default_model;
          if (!selectedModel) throw new Error("Kimi default model is missing");
          const modelConfig = sections.get(`models.${selectedModel}`);
          const providerId = modelConfig?.provider;
          const provider = providerId ? sections.get(`providers.${providerId}`) : undefined;
          if (!providerId || !provider || !provider.base_url || !modelConfig?.model) throw new Error(`Kimi model '${selectedModel}' is not configured`);
          const oauth = sections.get(`providers.${providerId}.oauth`);
          const sourceCredentials = join(process.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code"), "credentials");
          const credentialNames: string[] = await readdir(sourceCredentials).catch(() => []);
          const q = (value: string) => JSON.stringify(value);
          const protocol = modelConfig.protocol ?? (providerId === "managed:kimi-code" ? "openai" : undefined);
          const contextSize = Number(modelConfig.max_context_size);
          if (!Number.isSafeInteger(contextSize) || contextSize < 1) throw new Error(`Kimi model '${selectedModel}' has no valid max_context_size`);
          const kimiCredential = credentialNames.find(name => name.startsWith("kimi-code") && name.endsWith(".json"));
          const oauthKey = oauth?.key ?? (kimiCredential ? `oauth/${kimiCredential.slice(0, -5)}` : undefined);
          const oauthConfig = oauth !== undefined && oauthKey
            ? `\n[providers.${q(providerId)}.oauth]\nstorage = ${q(oauth?.storage ?? "file")}\nkey = ${q(oauthKey)}\n`
            : "";
          const minimalConfig = `default_model = ${q(selectedModel)}\n\n[providers.${q(providerId)}]\ntype = ${q(provider.type ?? "kimi")}\napi_key = ${q(provider.api_key ?? "")}\nbase_url = ${q(provider.base_url)}\n${oauthConfig}\n[models.${q(selectedModel)}]\nprovider = ${q(providerId)}\nmodel = ${q(modelConfig.model)}\nmax_context_size = ${contextSize}\n${protocol ? `protocol = ${q(protocol)}\n` : ""}`;
          await writeFile(join(home, "config.toml"), minimalConfig, { encoding: "utf8", mode: 0o600 });
          if (credentialNames.length) await mkdir(join(home, "credentials"), { recursive: true });
          for (const name of credentialNames) {
            if (!name.endsWith(".json")) continue;
            const credential = await readFile(join(sourceCredentials, name));
            await writeFile(join(home, "credentials", name), credential, { mode: 0o600 });
          }
          if (providerId === "managed:kimi-code" && !process.env.KIMI_CODE_OAUTH_HOST && !process.env.KIMI_OAUTH_HOST) {
            const baseUrl = provider.base_url.replace(/\/+$/, "");
            for (const host of ["https://auth.kimi.com", "https://auth.kimi.ai"]) {
              const digest = createHash("sha256").update(JSON.stringify({ oauthHost: host, baseUrl })).digest("hex").slice(0, 16);
              if (credentialNames.includes(`kimi-code-env-${digest}.json`)) { kimiOAuthHost = host; break; }
            }
          }
          await writeFile(join(home, "mcp.json"), JSON.stringify({ mcpServers: { project: entry } }), { encoding: "utf8", mode: 0o600 });
          const profile = join(cwd, "coordinator.md");
          await writeFile(profile, `---\nname: project-coordinator\ndescription: Discuss goals and prepare proposals\ntools:\n  - mcp__project__read_history\n  - mcp__project__read_task_context\n  - mcp__project__read_proposal\n  - mcp__project__propose_task\n  - mcp__project__read_memory\n  - mcp__project__propose_memory_change\n---\n${system}`, "utf8");
          const command = process.platform === "win32"
            ? (process.env.PATH ?? "").split(";").map(dir => join(dir, "kimi.cmd")).find(existsSync) ?? "kimi"
            : "kimi";
          argv = kimiCoordinatorArgv(prompt, profile, options.model, command);
        } else if (options.engine === "codex") {
          argv = codexCoordinatorArgv(prompt, options.model, cwd, entry);
        } else {
          mcpConfig = join(cwd, "project-mcp.json");
          await writeFile(mcpConfig, JSON.stringify({ mcpServers: { project: entry } }), { encoding: "utf8", mode: 0o600 });
          argv = coordinatorArgv(prompt, options.model, mcpConfig);
        }
      }
      // Identity and swarm connection variables are deliberately not inherited.
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key === "NETWORK_DIR" || key === "AGENT_ID" || key.startsWith("AGENT_NETWORK_")) delete env[key];
      argv ??= coordinatorArgv(prompt, options.model, mcpConfig);
      if (options.engine === "kimi") {
        env.KIMI_CODE_HOME = join(cwd, ".kimi-code"); env.KIMI_CODE_TRUST_WORKSPACE = "1";
        if (kimiOAuthHost) env.KIMI_CODE_OAUTH_HOST = kimiOAuthHost;
      }
      let diagnostics = "";
      const result = await (options.run ?? runSession)(argv, env, cwd, text => {
        diagnostics = (diagnostics + text).slice(-12000);
      }, signal);
      if (signal.aborted) throw new Error("Coordinator cancelled");
      if (result.code !== 0) throw new Error(`Coordinator CLI exited with code ${result.code}${diagnostics ? `: ${diagnostics}` : ""}`);
      if (!result.result?.text) throw new Error("Coordinator CLI returned no answer");
      return result.result.text;
    } finally { await rm(cwd, { recursive: true, force: true }); }
  };
}
