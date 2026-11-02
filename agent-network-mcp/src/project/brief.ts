import { z } from "zod";

/** Coordinator input only: persisted as part of the approved task description. */
export const taskBriefSchema = z.object({
  goal: z.string().trim().min(1).describe("The user outcome this task must achieve"),
  expectedBehavior: z.array(z.string().trim().min(1)).min(1)
    .describe("Observable outcomes, including relevant triggers or conditions; for analysis, required findings"),
  acceptanceCriteria: z.array(z.object({
    condition: z.string().trim().min(1),
    expected: z.string().trim().min(1),
    verification: z.string().trim().min(1).describe("How a reviewer checks the result; do not invent commands or test names"),
  }).strict()).min(1),
}).strict();

export function describeTask(description: string, brief: z.infer<typeof taskBriefSchema>): string {
  return [description.trim(), `Goal:\n${brief.goal}`,
    `Expected behavior:\n${brief.expectedBehavior.map(item => `- ${item}`).join("\n")}`,
    `Acceptance criteria:\n${brief.acceptanceCriteria.map((item, index) =>
      `${index + 1}. ${item.condition}\n   Expected: ${item.expected}\n   Verification: ${item.verification}`).join("\n")}`,
  ].join("\n\n");
}
