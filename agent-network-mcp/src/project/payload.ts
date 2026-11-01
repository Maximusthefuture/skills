import { createHash } from "node:crypto";
import { z } from "zod";
import type { NewTaskInput } from "../service.js";

/** Strict: newly supported task fields must be consciously added to the approval contract. */
export const projectTaskFields = {
  title: z.string().trim().min(1), description: z.string().trim().min(1),
  agents: z.array(z.string().trim().min(1)).min(2).refine(a => new Set(a).size === a.length, "Agents must be distinct"),
  maxFixRounds: z.number().int().nonnegative().optional(),
  maxFollowUps: z.number().int().nonnegative().optional(),
  verifyCommand: z.string().min(1).optional(),
  maxCostUsd: z.number().finite().nonnegative().optional(),
  maxTaskCostUsd: z.number().finite().nonnegative().optional(),
  openspec: z.string().min(1).optional(), proposes: z.string().min(1).optional(),
  from: z.array(z.string().min(1)).min(1).optional(),
  clarify: z.boolean().optional(), grill: z.boolean().optional(), planReview: z.boolean().optional(),
  parentTaskId: z.string().min(1).optional(), baseCommit: z.string().min(1).optional(),
  contract: z.string().min(1).optional(), allowSpawn: z.boolean().optional(),
};

export const projectTaskSchema = z.object(projectTaskFields).strict().superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.openspec && value.proposes) invalid("openspec and proposes cannot be combined");
  if (value.from && !value.proposes) invalid("from requires proposes");
  if (value.proposes && value.planReview) invalid("proposes and planReview cannot be combined");
  if (value.baseCommit && !value.parentTaskId) invalid("baseCommit requires parentTaskId");
});
export type EffectivePayload = z.infer<typeof projectTaskSchema>;
// Compile-time coverage: adding a NewTaskInput key requires extending this schema.
const allTaskFieldsCovered: Exclude<keyof NewTaskInput, keyof EffectivePayload> extends never ? true : never = true;
void allTaskFieldsCovered;

export function normalizeProjectTask(input: unknown, resolved: {
  maxTaskCostUsd?: number; maxCostUsd?: number; verifyCommand?: string;
}): EffectivePayload {
  const parsed = projectTaskSchema.parse(input);
  return projectTaskSchema.parse({ ...parsed, ...resolved });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function payloadHash(payload: EffectivePayload): string {
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}
