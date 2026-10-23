import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Skills the operator switches off for an agent ("disabledSkills" in runners.json, or on the page): the runner tells the
 * session which ones (AGENT_NETWORK_DISABLED_SKILLS and a line in its prompt), and the PreToolUse hook "pre-skill"
 * refuses loading them — Claude Code's Skill tool, or a read of the skill's SKILL.md (CLIs without a Skill tool).
 */

export const DISABLED_SKILLS_ENV = "AGENT_NETWORK_DISABLED_SKILLS";

/** A skill name is a folder name, optionally with a plugin prefix ("backend-design-java:migration-safety"). */
export const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/** Is this skill switched off? "migration-safety" also covers "<plugin>:migration-safety", and a plugin prefix alone covers all of its skills. */
export function isDisabled(skill: string, disabled: readonly string[]): boolean {
  const bare = skill.includes(":") ? skill.slice(skill.indexOf(":") + 1) : skill;
  const plugin = skill.includes(":") ? skill.slice(0, skill.indexOf(":")) : null;
  return disabled.some((d) => d === skill || d === bare || (plugin !== null && d === `${plugin}:*`));
}

/** The list a session got from its runner (empty when none or unreadable). */
export function disabledFromEnv(env: NodeJS.ProcessEnv): string[] {
  try {
    const v = JSON.parse(env[DISABLED_SKILLS_ENV] ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The line the runner adds to the prompt, so the agent does not try a skill only to be refused. */
export function disabledSkillsNote(disabled: readonly string[]): string {
  return disabled.length
    ? `\n\nSkills the operator switched off for you: ${disabled.join(", ")}. Do not load them (the call is refused); do that part of the work without them.`
    : "";
}

export interface SkillInfo {
  name: string;
  description: string;
  /** Where it was found: "user" (~/.claude/skills, ~/.qwen/skills), "project" (<folder>/.claude/skills). */
  sources: string[];
}

function frontMatter(text: string, field: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
  const m = fm ? new RegExp(`^${field}:\\s*(.*)$`, "m").exec(fm) : null;
  return m?.[1]?.trim().replace(/^["']|["']$/g, "");
}

/** The skills installed for the agents: <dir>/<name>/SKILL.md in the user's and the agents' folders, by name. */
export async function listSkills(projectDirs: string[], home = homedir()): Promise<SkillInfo[]> {
  const roots: [string, string][] = [
    [join(home, ".claude", "skills"), "user"],
    [join(home, ".qwen", "skills"), "user"],
    ...[...new Set(projectDirs)].flatMap((d): [string, string][] => [[join(d, ".claude", "skills"), "project"], [join(d, ".qwen", "skills"), "project"]]),
  ];
  const byName = new Map<string, SkillInfo>();
  for (const [root, source] of roots) {
    for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const text = await readFile(join(root, e.name, "SKILL.md"), "utf8").catch(() => null);
      if (text === null) continue;
      const name = frontMatter(text, "name") || e.name;
      const s = byName.get(name) ?? { name, description: (frontMatter(text, "description") ?? "").slice(0, 300), sources: [] };
      if (!s.sources.includes(source)) s.sources.push(source);
      byName.set(name, s);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
