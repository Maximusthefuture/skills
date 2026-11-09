import { AppError } from "./errors.js";
export type RunnerProfileId = "analyst" | "developer" | "reviewer";
export interface CoordinatorAgent {
  id: string;
  profile: RunnerProfileId | null;
  name: string;
  description: string;
}
export function coordinatorAgents(agents: readonly { id: string; profile?: RunnerProfileId | null }[]): CoordinatorAgent[] {
  return agents.map(agent => {
    const role = RUNNER_PROFILES.find(p => p.id === agent.profile);
    return { id: agent.id, profile: role?.id ?? null, name: role?.name ?? "Без профиля", description: role?.description ?? "Роль выбирается по задаче; профиль не задан" };
  });
}
const BOUNDS = "Follow the task scope, file ownership, approved decisions and normal swarm gates. This role is guidance, not permission to bypass the protocol or expand the assignment.";
export const RUNNER_PROFILES: readonly { id: RunnerProfileId; name: string; description: string; instructions: string }[] = [
  { id: "analyst", name: "Аналитик", description: "Уточняет требования и готовит спецификацию по задаче", instructions: `Role: Analyst. Clarify requirements, distinguish facts from assumptions and preserve open questions. Write specifications only when the task asks for them. ${BOUNDS}` },
  { id: "developer", name: "Разработчик", description: "Реализует согласованное изменение и проверяет результат", instructions: `Role: Developer. Implement the agreed behavior, keep changes focused and verify the result with appropriate checks. Report blockers and evidence honestly. ${BOUNDS}` },
  { id: "reviewer", name: "Ревьюер", description: "Независимо проверяет реализацию и доказательства", instructions: `Role: Reviewer. Review independently against requirements and agreed interfaces. Support findings with code or test evidence. Change files only when your explicit assignment asks for changes; this profile does not enforce read-only access. ${BOUNDS}` },
];
export function validateRunnerProfile(value: unknown): RunnerProfileId | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !RUNNER_PROFILES.some(p => p.id === value)) throw new AppError("INVALID_INPUT", "Unknown runner profile: choose analyst, developer or reviewer");
  return value as RunnerProfileId;
}
export function profileInstructions(profile?: RunnerProfileId | null): string {
  return RUNNER_PROFILES.find(p => p.id === profile)?.instructions ?? "";
}
