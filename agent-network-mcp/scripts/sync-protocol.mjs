#!/usr/bin/env node
// The swarm protocol has one source: AGENTS.md. The skill (skills/agent-network/SKILL.md) is its copy under the skill's
// own front matter; run `npm run docs:sync` after editing AGENTS.md (a test fails while they differ).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
const skillPath = join(root, "skills", "agent-network", "SKILL.md");
const skill = readFileSync(skillPath, "utf8");
const front = /^---\n[\s\S]*?\n---\n/.exec(skill)?.[0];
if (!front) throw new Error(`${skillPath}: no front matter`);
writeFileSync(skillPath, `${front}\n<!-- generated from AGENTS.md by npm run docs:sync: edit AGENTS.md -->\n\n${agents}`);
console.log(`${skillPath} <- AGENTS.md`);
