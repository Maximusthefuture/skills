import { AppError } from "../errors.js";
import { DEFAULT_MAX_FIX_ROUNDS } from "../phase/phaseManager.js";
import type { FileStore } from "../storage/fileStore.js";
import type { GitContext, Task } from "../types.js";
import { assertTaskId } from "../validation.js";

export interface NewTask {
  title: string;
  description: string;
  agents: string[];
  createdBy: string;
  git: GitContext | null;
  maxFixRounds?: number;
  verifyCommand?: string;
  maxFollowUps?: number;
  parentTaskId?: string;
  rootTaskId?: string;
  baseCommit?: string;
  openspec?: string;
}

export class TaskStore {
  constructor(private readonly fs: FileStore) {}

  taskDir(taskId: string): string[] {
    return ["tasks", assertTaskId(taskId)];
  }

  async create(input: NewTask): Promise<Task> {
    const id = await this.fs.createNumberedDir(["tasks"], "task");
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: input.title,
      description: input.description,
      phase: "DISCUSS",
      status: "ACTIVE",
      agents: input.agents,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      git: input.git,
      syncRound: 0,
      phaseHistory: [{ phase: "DISCUSS", at: now }],
      maxFixRounds: input.maxFixRounds ?? DEFAULT_MAX_FIX_ROUNDS,
      ...(input.verifyCommand ? { verifyCommand: input.verifyCommand } : {}),
      ...(input.maxFollowUps ? { maxFollowUps: input.maxFollowUps, followUpsUsed: 0 } : {}),
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.rootTaskId ? { rootTaskId: input.rootTaskId } : {}),
      ...(input.baseCommit ? { baseCommit: input.baseCommit } : {}),
      ...(input.openspec ? { openspec: { change: input.openspec } } : {}),
    };
    await this.fs.writeJson([...this.taskDir(id), "task.json"], task);
    return task;
  }

  async find(taskId: string): Promise<Task | null> {
    return this.fs.readJson<Task>([...this.taskDir(taskId), "task.json"]);
  }

  async get(taskId: string): Promise<Task> {
    const task = await this.find(taskId);
    if (!task) throw new AppError("TASK_NOT_FOUND", `Task '${taskId}' not found`);
    return task;
  }

  async save(task: Task): Promise<Task> {
    const updated = { ...task, updatedAt: new Date().toISOString() };
    await this.fs.writeJson([...this.taskDir(task.id), "task.json"], updated);
    return updated;
  }

  async list(): Promise<Task[]> {
    const dirs = await this.fs.listNumberedDirs(["tasks"], "task");
    const tasks = await Promise.all(dirs.map((d) => this.find(d.id)));
    return tasks.filter((t): t is Task => t !== null); // dir without task.json = creation in flight
  }

  async listForAgent(agentId: string): Promise<Task[]> {
    return (await this.list()).filter((t) => t.agents.includes(agentId));
  }

  lockPath(taskId: string): string[] {
    return [...this.taskDir(taskId), ".lock"];
  }
}
