import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SWARM_INSTRUCTIONS } from "../../src/mcp/instructions.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** The tools registerSwarmTools gives an agent, read from its source. */
const tools = [...read("src/mcp/tools.ts").matchAll(/^\s+tool\(\s*\n\s*"([a-z_]+)"/gm)].map((m) => m[1]!);

describe("the protocol docs follow the code (one source: AGENTS.md)", () => {
  it("the skill is AGENTS.md under its front matter: run npm run docs:sync after editing AGENTS.md", () => {
    const skill = read("skills/agent-network/SKILL.md");
    expect(skill.slice(skill.indexOf("-->") + 3).trim()).toBe(read("AGENTS.md").trim());
  });

  it("every tool an agent gets is described in AGENTS.md and named in the README", () => {
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) {
      expect(read("AGENTS.md"), t).toContain(`\`${t}\``);
      expect(read("README.md"), t).toContain(`\`${t}\``);
    }
  });

  it("no stale tool count anywhere, and the README's count is the code's", () => {
    for (const p of ["AGENTS.md", "README.md"]) expect(read(p)).not.toMatch(/\b(seven|eight)\b[^.\n]*tools|(семь|восемь)[^.\n]*tools/i);
    expect(SWARM_INSTRUCTIONS).not.toMatch(/\b(seven|eight|five)\s+(MCP\s+)?tools/i);
    const words: Record<number, string> = { 11: "одиннадцать", 12: "двенадцать", 13: "тринадцать", 14: "четырнадцать" };
    expect(read("README.md")).toContain(`Агент видит **${words[tools.length]}** tools`);
  });
});
