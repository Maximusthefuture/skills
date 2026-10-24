import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preSkillDecision, runHookCli } from "../../src/hook.js";
import { disabledFromEnv, isDisabled, listSkills } from "../../src/skills.js";
import { loadRunnersConfig, RunnerPool } from "../../src/ui/runners.js";
import { tmpDir } from "../helpers/tmp.js";

function skill(root: string, folder: string, front: string) {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "SKILL.md"), `---\n${front}\n---\n\n# body\n`);
}

describe("skills switched off for an agent", () => {
  it("a name covers its plugin-prefixed form; plugin:* covers the whole plugin", () => {
    expect(isDisabled("java-tdd", ["java-tdd"])).toBe(true);
    expect(isDisabled("backend-design-java:migration-safety", ["migration-safety"])).toBe(true);
    expect(isDisabled("backend-design-java:migration-safety", ["backend-design-java:*"])).toBe(true);
    expect(isDisabled("backend-design-java:migration-safety", ["backend-design-java:query-discipline"])).toBe(false);
    expect(isDisabled("grilling", ["java-tdd"])).toBe(false);
    expect(disabledFromEnv({ AGENT_NETWORK_DISABLED_SKILLS: '["a","b"]' })).toEqual(["a", "b"]);
    expect(disabledFromEnv({ AGENT_NETWORK_DISABLED_SKILLS: "not json" })).toEqual([]);
  });

  it("the pre-skill hook refuses the Skill tool and reads of the skill's SKILL.md; anything else passes", async () => {
    const off = ["java-tdd"];
    expect(preSkillDecision("Skill", { skill: "java-tdd" }, off)?.hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: expect.stringContaining('"java-tdd" off') });
    expect(preSkillDecision("read_file", { absolute_path: "/home/u/.qwen/skills/java-tdd/SKILL.md" }, off)).not.toBeNull();
    expect(preSkillDecision("Skill", { skill: "grilling" }, off)).toBeNull();
    expect(preSkillDecision("Read", { file_path: "/x/java-tdd/references/modes.md" }, off)).toBeNull();
    expect(preSkillDecision("Skill", { skill: "java-tdd" }, [])).toBeNull();

    const out: string[] = [];
    const run = (env: NodeJS.ProcessEnv) => runHookCli("pre-skill", [], env, (s) => out.push(s), async () => JSON.stringify({ tool_name: "Skill", tool_input: { skill: "java-tdd" } }));
    expect(await run({ AGENT_NETWORK_DISABLED_SKILLS: '["java-tdd"]' })).toBe(0);
    expect(JSON.parse(out[0]!).hookSpecificOutput.permissionDecision).toBe("deny");
    await run({});
    expect(out).toHaveLength(1); // nothing switched off: no answer, the call goes ahead
  });

  it("lists the skills of the user's and the agents' folders by their front-matter name", async () => {
    const home = await tmpDir();
    const project = await tmpDir();
    skill(join(home, ".claude", "skills"), "java-tdd", "name: java-tdd\ndescription: \"red, green, refactor\"");
    skill(join(home, ".qwen", "skills"), "grill", "name: grilling\ndescription: interview");
    skill(join(project, ".claude", "skills"), "java-tdd", "name: java-tdd\ndescription: project copy");
    mkdirSync(join(project, ".claude", "skills", "not-a-skill"), { recursive: true });
    expect(await listSkills([project], home)).toEqual([
      { name: "grilling", description: "interview", sources: ["user"] },
      { name: "java-tdd", description: "red, green, refactor", sources: ["user", "project"] },
    ]);
  });

  it("runners.json: disabledSkills per agent (or in defaults), switched on the page and written back", async () => {
    const dir = await tmpDir();
    const configPath = join(dir, "runners.json");
    await writeFile(configPath, JSON.stringify({ _comment: ["keep me"], defaults: { command: ["x", "{prompt}"], disabledSkills: ["grilling"] }, agents: [{ id: "backend" }, { id: "reviewer", disabledSkills: ["java-tdd"] }] }, null, 2));
    const config = await loadRunnersConfig(configPath);
    expect(config.agents.map((a) => [a.id, a.disabledSkills])).toEqual([["backend", ["grilling"]], ["reviewer", ["java-tdd"]]]);
    await writeFile(join(dir, "bad.json"), JSON.stringify({ agents: [{ id: "a", command: ["x"], disabledSkills: ["no spaces allowed"] }] }));
    await expect(loadRunnersConfig(join(dir, "bad.json"))).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining("disabledSkills") });

    const pool = new RunnerPool(join(dir, ".agent-network"), config.agents, { configPath: config.path!, home: dir });
    await expect(pool.setSkillEnabled("backend", "two words", false)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await pool.setSkillEnabled("backend", "java-spec-intake", false)).disabledSkills).toEqual(["grilling", "java-spec-intake"]);
    expect((await pool.setSkillEnabled("reviewer", "java-tdd", true)).disabledSkills).toEqual([]);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved._comment).toEqual(["keep me"]);
    expect(saved.agents).toEqual([{ id: "backend", disabledSkills: ["grilling", "java-spec-intake"] }, { id: "reviewer" }]);
    expect((await loadRunnersConfig(configPath)).agents[0]!.disabledSkills).toEqual(["grilling", "java-spec-intake"]); // survives a restart
  });

describe("a model for change-writing tasks", () => {
  it("proposeModel is used for sessions of a task that writes a change, model for the others", async () => {
    const dir = await tmpDir();
    const configPath = join(dir, "runners.json");
    await writeFile(configPath, JSON.stringify({ defaults: { command: ["x", "--model", "{model}", "{prompt}"], model: "haiku" }, agents: [{ id: "reviewer", proposeModel: "sonnet" }, { id: "backend" }] }));
    const config = await loadRunnersConfig(configPath);
    const given: Record<string, (task?: object) => string | undefined> = {};
    const pool = new RunnerPool(join(dir, ".agent-network"), config.agents, {
      run: (o) => {
        given[o.agent] = o.model as (task?: object) => string | undefined;
        return new Promise((r) => o.signal!.addEventListener("abort", () => r(0)));
      },
    });
    pool.start("reviewer");
    pool.start("backend");
    expect(given.reviewer!({ proposes: { change: "x" } })).toBe("sonnet");
    expect(given.reviewer!({})).toBe("haiku");
    expect(given.backend!({ proposes: { change: "x" } })).toBe("haiku");
    expect(pool.list().find((v) => v.id === "reviewer")!.proposeModel).toBe("sonnet");
    await pool.stop("reviewer");
    await pool.stop("backend");
    await writeFile(configPath, JSON.stringify({ agents: [{ id: "a", command: ["x"], proposeModel: "two words" }] }));
    await expect(loadRunnersConfig(configPath)).rejects.toMatchObject({ code: "INVALID_CONFIG", message: expect.stringContaining("proposeModel") });
  });
});
});
