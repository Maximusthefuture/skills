import { basename } from "node:path";
import { AppError } from "./errors.js";

const RULES = "Brainstorm is read-only discussion. Follow swarm_context.nextAction and exampleCall. Submit independent options, then critique, then the lead synthesizes. Do not edit files, run builds/experiments, install dependencies, spawn/delegate, commit, or read hidden materials directly. Distinguish evidence, assumptions and unknowns. Never infer operator approval from silence. Save materials only with brainstorm. After submitting, wait; the runner parks idle sessions.";
export const brainstormRules = RULES;

/** Restrict native coding tools; this is not an isolation guarantee for third-party MCP servers/hooks. */
export function brainstormReadOnlyCommand(command: string[]): string[] {
  const cli = basename(command[0] ?? "").replace(/\.(exe|cmd|ps1)$/i, "").toLowerCase();
  const strip = (flags: string[]) => command.filter((arg, i) => i === 0 || (!flags.some(flag => arg === flag || arg.startsWith(flag + "=")) && !flags.includes(command[i - 1]!)));
  if (cli === "codex") {
    const args = strip(["--sandbox", "--ask-for-approval", "-a"]).filter(arg => !["--full-auto", "--dangerously-bypass-approvals-and-sandbox"].includes(arg));
    return [...args, "--sandbox", "read-only"];
  }
  if (cli === "claude") {
    const args = strip(["--tools"]);
    const at = args.indexOf("--settings");
    if (at >= 0) {
      let settings: object;
      try { settings = JSON.parse(args[at + 1]!); } catch { throw new AppError("INVALID_CONFIG", "Brainstorm requires Claude --settings as inline JSON so hooks can be disabled"); }
      args[at + 1] = JSON.stringify({ ...settings, disableAllHooks: true });
    } else args.push("--settings", '{"disableAllHooks":true}');
    return [...args, "--tools", "Read,Grep,Glob"];
  }
  if (cli === "qwen") {
    const args: string[] = [];
    for (let i=0;i<command.length;i++) {
      if (command[i]==="--core-tools") {while(i+1<command.length&&!command[i+1]!.startsWith("-")&&!command[i+1]!.includes("{prompt}"))i++;continue;}
      if(command[i]!.startsWith("--core-tools="))continue;
      args.push(command[i]!);
    }
    return [...args, "--core-tools", "read_file", "read_many_files", "list_directory", "glob", "grep_search", "--exclude-tools", "run_shell_command", "write_file", "edit", "notebook_edit", "agent", "list_agents", "cron_create", "cron_delete", "save_memory"];
  }
  throw new AppError("INVALID_CONFIG", "Brainstorm read-only adapter supports only codex, claude and qwen commands");
}
