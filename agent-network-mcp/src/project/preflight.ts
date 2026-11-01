import { AppError } from "../errors.js";
import type { Task } from "../types.js";
import type { ProjectState } from "./store.js";
import { projectTaskSchema, type EffectivePayload } from "./payload.js";

export interface PreflightDependencies {
  tasks: Task[];
  availableAgents: string[];
  checkAgentFolders: (change: string, agents: string[]) => Promise<void>;
  verifyParentBase: (parent: Task, baseCommit: string | undefined) => Promise<void>;
  checkSharedFolder: (payload: EffectivePayload, openCoordinatorTasks: Task[]) => Promise<void>;
  validateTask: (payload: EffectivePayload) => Promise<void>;
}
/** Read-only checks. Command service must serialize this check with the eventual mutation. */
export async function projectPreflight(state: ProjectState, input: EffectivePayload, deps: PreflightDependencies): Promise<void> {
  const payload = projectTaskSchema.parse(input);
  const fail = (message: string): never => { throw new AppError("INVALID_INPUT", message); };
  for (const agent of payload.agents) {
    if (agent === "operator" || !deps.availableAgents.includes(agent)) fail(`Agent '${agent}' is unavailable`);
  }
  const open = (t: Task) => t.status === "ACTIVE" || t.status === "BLOCKED";
  const links = new Set(state.tasks.map(t => t.taskId));
  if (deps.tasks.filter(t => links.has(t.id) && open(t)).length >= state.maxOpenTasks) fail("Project maxOpenTasks reached");
  if (payload.parentTaskId) {
    const parent = deps.tasks.find(t => t.id === payload.parentTaskId);
    if (!parent || !links.has(parent.id)) fail("Parent task is not linked to this project");
    if (parent!.status !== "COMPLETED" && parent!.status !== "CANCELLED") fail("Parent task is still open");
    await deps.verifyParentBase(parent!, payload.baseCommit);
  }
  if (payload.openspec) await deps.checkAgentFolders(payload.openspec, payload.agents);
  await deps.checkSharedFolder(payload, deps.tasks.filter(t => t.projectOrigin?.projectId === state.projectId && !t.proposes && open(t)));
  await deps.validateTask(payload);
}
