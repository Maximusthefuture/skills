import { describe, expect, it } from "vitest";
import { buildArgv, DEFAULT_PROMPT, pickTask, renderPrompt } from "../../src/runner.js";
import type { Task } from "../../src/types.js";

const task = (id: string, status: Task["status"], agents = ["backend", "reviewer"]): Task => ({
  id,
  title: `title of ${id}`,
  description: "",
  phase: "IMPLEMENT",
  status,
  agents,
  createdAt: "",
  updatedAt: "",
  createdBy: "operator",
  git: null,
  syncRound: 0,
});

describe("renderPrompt", () => {
  it("fills the placeholders and adds the resume note only on restarts", () => {
    const first = renderPrompt(DEFAULT_PROMPT, { agent: "backend", taskId: "task-002", title: "Cancel orders", attempt: 1 });
    expect(first).toContain('You are agent backend of the agent-network swarm. Task task-002 ("Cancel orders")');
    expect(first).not.toContain("{");
    expect(first).not.toContain("previous one ended");

    const third = renderPrompt(DEFAULT_PROMPT, { agent: "backend", taskId: "task-002", title: "Cancel orders", attempt: 3 });
    expect(third).toContain("This is session 3 for this task");
    expect(renderPrompt("{agent}/{taskId}/{attempt}", { agent: "a", taskId: "t", title: "", attempt: 2 })).toBe("a/t/2");
  });
});

describe("buildArgv", () => {
  it("replaces {prompt} wherever it appears, otherwise appends the prompt", () => {
    expect(buildArgv(["claude", "-p", "{prompt}", "--model", "haiku"], "do it")).toEqual(["claude", "-p", "do it", "--model", "haiku"]);
    expect(buildArgv(["tool", "--input={prompt}"], "x")).toEqual(["tool", "--input=x"]);
    expect(buildArgv(["codex", "exec"], "do it")).toEqual(["codex", "exec", "do it"]);
  });
});

describe("pickTask", () => {
  it("takes the oldest unfinished task of the agent, like the server", () => {
    const tasks = [task("task-010", "ACTIVE"), task("task-002", "COMPLETED"), task("task-009", "BLOCKED"), task("task-001", "ACTIVE", ["other"])];
    expect(pickTask(tasks, "backend")?.id).toBe("task-009");
    expect(pickTask([task("task-003", "CANCELLED"), task("task-004", "COMPLETED")], "backend")).toBeNull();
    expect(pickTask(tasks, "nobody")).toBeNull();
  });
});
