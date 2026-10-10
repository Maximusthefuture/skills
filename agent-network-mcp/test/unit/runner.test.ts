import { describe, expect, it } from "vitest";
import { buildArgv, DEFAULT_PROMPT, isValidModel, pickTask, renderPrompt, usesModel, withModel } from "../../src/runner.js";
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
    expect(first).not.toMatch(/\{(agent|taskId|title|attempt|resume)\}/); // every placeholder is filled
    expect(first).toContain('send_message({to: "operator"'); // headless: questions go to the operator
    expect(first).not.toContain("previous one ended");

    const third = renderPrompt(DEFAULT_PROMPT, { agent: "backend", taskId: "task-002", title: "Cancel orders", attempt: 3 });
    expect(third).toContain("This is session 3 for this task");
    expect(renderPrompt("{agent}/{taskId}/{attempt}", { agent: "a", taskId: "t", title: "", attempt: 2 })).toBe("a/t/2");
    const fresh = renderPrompt(DEFAULT_PROMPT, { agent: "reviewer", taskId: "task-002", title: "Cancel orders", attempt: 2, handoff: "SYNC" });
    expect(fresh).toContain("This is a fresh session for phase SYNC");
    expect(fresh).not.toContain("previous one ended"); // a handoff is not a crash
  });
});

describe("buildArgv", () => {
  it("replaces {prompt} wherever it appears, otherwise appends the prompt", () => {
    expect(buildArgv(["claude", "-p", "{prompt}", "--model", "haiku"], "do it")).toEqual(["claude", "-p", "do it", "--model", "haiku"]);
    expect(buildArgv(["tool", "--input={prompt}"], "x")).toEqual(["tool", "--input=x"]);
    expect(buildArgv(["codex", "exec"], "do it")).toEqual(["codex", "exec", "do it"]);
    expect(buildArgv(["claude", "-p", "{prompt}", "--system-prompt", "{systemPrompt}"], "task", "be brief")).toEqual(["claude", "-p", "task", "--system-prompt", "be brief"]);
  });
});

describe("model", () => {
  it("fills {model} in any argument; names with spaces or a leading dash are refused", () => {
    expect(usesModel(["qwen", "{prompt}", "-m", "{model}"])).toBe(true);
    expect(usesModel(["claude", "-p", "{prompt}", "--model", "haiku"])).toBe(false);
    expect(withModel(["qwen", "-m", "{model}", "--x={model}"], "qwen/qwen3.5-9b")).toEqual(["qwen", "-m", "qwen/qwen3.5-9b", "--x=qwen/qwen3.5-9b"]);
    expect(withModel(["qwen", "-m", "{model}"], undefined)).toEqual(["qwen", "-m", "{model}"]);
    for (const ok of ["haiku", "claude-haiku-4-5", "qwen/qwen3.5-9b", "qwen2.5-coder:7b", "org/model@q4"]) expect(isValidModel(ok)).toBe(true);
    for (const bad of ["", "-rf", "--yolo", "two words", "a\nb", 42]) expect(isValidModel(bad)).toBe(false);
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
