import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Swarm } from "../../src/mcp/swarm.js";
import { parseRisks, pickSkills, PlanCritic, readCritiques } from "../../src/planCritic.js";
import { NetworkService } from "../../src/service.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";

const PAGE = "<!doctype html><html><body><h1>Refunds</h1><p>backend: POST /orders/{id}/refunds</p></body></html>";

async function skill(dir: string, name: string, description: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: "${description}"\n---\n\nRules of ${name}.\n`);
}

describe("the critic's answer", () => {
  it("takes the risks from JSON alone or in a json block, fills in the severity, drops the incomplete ones", () => {
    const risks = [{ severity: "HIGH", title: "Double refund", where: "RefundService", why: "two clicks refund twice", suggest: "idempotency key" }, { title: "no why" }, { severity: "odd", title: "t", why: "w" }];
    expect(parseRisks(JSON.stringify({ risks }))).toEqual([
      { severity: "high", title: "Double refund", where: "RefundService", why: "two clicks refund twice", suggest: "idempotency key" },
      { severity: "medium", title: "t", why: "w" },
    ]);
    expect(parseRisks("Here it is:\n```json\n{\"risks\": []}\n```")).toEqual([]);
    expect(parseRisks("I could not read the plan.")).toBeNull();
    // a long answer (6 KB of risks) after some words
    const long = { risks: Array.from({ length: 8 }, (_, i) => ({ severity: "medium", title: `risk ${i}`, why: "x".repeat(600) })) };
    expect(parseRisks(`Based on my review:\n\n\`\`\`json\n${JSON.stringify(long, null, 2)}\n\`\`\``)).toHaveLength(8);
  });
});

describe("skills for the kind of project", () => {
  it("takes every set whose file is in the project's root: a skill, a folder of skills, a single .md; each skill once", async () => {
    const root = await tmpDir();
    const project = join(root, "shop");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "pom.xml"), "<project/>");
    await skill(join(root, "skills", "java-extensibility-review"), "java-extensibility-review", "what changes when one more variant is added");
    await skill(join(root, "skills", "backend-design", "skills", "migration-safety"), "migration-safety", "schema changes that do not lock");
    await skill(join(root, "skills", "backend-design", "skills", "idempotency"), "idempotency", "the same request twice");
    await writeFile(join(root, "critic.md"), "---\nname: critic\ndescription: \"Pre-mortem: what breaks in production\"\n---\nYou are the critic.\n");
    const picked = await pickSkills(project, [
      { name: "always", when: ["*"], skills: [join(root, "critic.md")] },
      { name: "java-spring", when: ["pom.xml", "build.gradle*"], skills: [join(root, "skills", "backend-design"), join(root, "skills", "java-extensibility-review"), join(root, "missing")] },
      { name: "node", when: ["package.json"], skills: [join(root, "skills", "java-extensibility-review")] },
    ]);
    expect(picked.sets).toEqual(["always", "java-spring"]);
    expect(picked.skills.map((k) => k.name).sort()).toEqual(["critic", "idempotency", "java-extensibility-review", "migration-safety"]);
    expect(picked.skills.find((k) => k.name === "critic")).toMatchObject({ description: "Pre-mortem: what breaks in production", file: join(root, "critic.md") });
  });
});

describe("the plan critic", () => {
  it("reads each version the lead writes once, with the project's skills; the operator's own edits and approved plans are left alone", async () => {
    const root = await tmpDir();
    const project = join(root, "shop");
    const dir = join(project, ".agent-network");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "pom.xml"), "<project/>");
    await skill(join(root, "skills", "migration-safety"), "migration-safety", "schema changes that do not lock");
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const backend = new Swarm(await NetworkService.create(dir, { id: "backend", type: "test" }));
    const task = await operator.createTaskAsOperator({ title: "Refunds", description: "partial refunds", agents: ["backend", "reviewer"], planReview: true });

    const seen: { prompt: string; cwd: string; skillFile: string | null }[] = [];
    const critic = new PlanCritic({
      networkDir: dir, projectDir: project,
      config: { command: ["claude", "-p", "{prompt}", "--add-dir", "{projectDir}", "--add-dir", "{planDir}"], promptFile: join(root, "none.md"), skillSets: [{ name: "java-spring", when: ["pom.xml"], skills: [join(root, "skills", "migration-safety")] }] },
      run: async (argv, _env, cwd) => {
        const prompt = argv[2]!;
        seen.push({ prompt, cwd, skillFile: await readFile(join(cwd, "skills", "migration-safety", "SKILL.md"), "utf8").catch(() => null) });
        expect(argv).toContain(project);
        expect(argv).toContain(join(dir, "tasks", task.id, "plan"));
        return { code: 0, result: { text: JSON.stringify({ risks: [{ severity: "high", title: "Double refund", why: "two clicks", suggest: "idempotency key" }] }), costUsd: 0.04 } as never };
      },
    });

    await critic.tick(); // no plan yet
    expect(seen).toHaveLength(0);
    await backend.plan({ html: PAGE });
    await critic.tick();
    await critic.idle();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain(`"planFile": "${join(dir, "tasks", task.id, "plan", "v1.html")}"`);
    expect(seen[0]!.prompt).toContain("Skills for this kind of project");
    expect(seen[0]!.skillFile).toContain("Rules of migration-safety");
    const fs = await FileStore.open(dir);
    expect(await readCritiques(fs, task.id)).toMatchObject([{ version: 1, costUsd: 0.04, skillSets: ["java-spring"], skills: ["migration-safety"], risks: [{ severity: "high", title: "Double refund" }] }]);

    await critic.tick(); // v1 is done: nothing new
    await critic.idle();
    expect(seen).toHaveLength(1);

    // the operator's edits are a version too, not the lead's plan: no critique for it
    await operator.planFeedback({ taskId: task.id, version: 1, edits: [{ before: "Refunds", after: "Partial refunds" }], html: PAGE.replace("Refunds", "Partial refunds") });
    await critic.tick();
    await critic.idle();
    expect(seen).toHaveLength(1);

    // the lead's next version: read, with the titles of the risks it had before
    await backend.plan({ note: "kept as it is" });
    await critic.tick();
    await critic.idle();
    expect(seen).toHaveLength(2);
    expect(seen[1]!.prompt).toContain("risksOfThePreviousVersion");

    // once more on request
    await critic.again(task.id, 3);
    await critic.tick();
    await critic.idle();
    expect(seen).toHaveLength(3);

    await operator.planFeedback({ taskId: task.id, version: 3, approve: true });
    await backend.plan({ html: PAGE }).catch(() => null); // refused after the approval anyway
    await critic.tick();
    expect(seen).toHaveLength(3);
  });

  it("an answer without the JSON is kept as the error, to read on the page", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const operator = await NetworkService.create(dir, { id: "operator", type: "cli" });
    const backend = new Swarm(await NetworkService.create(dir, { id: "backend", type: "test" }));
    const task = await operator.createTaskAsOperator({ title: "t", description: "d", agents: ["backend", "reviewer"], planReview: true });
    await backend.plan({ html: PAGE });
    const critic = new PlanCritic({ networkDir: dir, projectDir: dir, config: { command: ["x", "{prompt}"], promptFile: "/none" }, run: async () => ({ code: 1, result: { text: "The plan file does not exist." } as never }) });
    await critic.tick();
    await critic.idle();
    expect(await readCritiques(await FileStore.open(dir), task.id)).toMatchObject([{ version: 1, risks: [], error: "The plan file does not exist." }]);
  });
});
