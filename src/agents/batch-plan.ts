import { z } from "zod";

const readyItemSchema = z.object({
  row_number: z.number().int().positive().nullable().optional().default(null),
  test_name: z.string().min(1),
  system_name: z.string().min(1).nullable().optional().default(null),
  args: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ).optional().default({}),
  notes: z.string().min(1).nullable().optional().default(null),
}).passthrough();

const needsInputItemSchema = z.object({
  row_number: z.number().int().positive().nullable().optional().default(null),
  test_name: z.string().min(1).nullable().optional().default(null),
  system_name: z.string().min(1).nullable().optional().default(null),
  missing_fields: z.array(z.string().min(1)).optional().default([]),
  question: z.string().min(1),
  notes: z.string().min(1).nullable().optional().default(null),
}).passthrough();

const blockedItemSchema = z.object({
  row_number: z.number().int().positive().nullable().optional().default(null),
  test_name: z.string().min(1).nullable().optional().default(null),
  system_name: z.string().min(1).nullable().optional().default(null),
  reason: z.string().min(1),
  notes: z.string().min(1).nullable().optional().default(null),
}).passthrough();

export const batchPlanSchema = z.object({
  ready: z.array(readyItemSchema).optional().default([]),
  needs_input: z.array(needsInputItemSchema).optional().default([]),
  blocked: z.array(blockedItemSchema).optional().default([]),
  suggested_next_action: z.string().min(1).nullable().optional().default(null),
}).passthrough();

const batchPlanEnvelopeSchema = z.object({
  structured_plan: batchPlanSchema,
}).passthrough();

export type BatchPlan = z.infer<typeof batchPlanSchema>;

export type BatchPlanParseResult =
  | { structuredPlan: BatchPlan; error?: undefined }
  | { structuredPlan?: undefined; error: string };

export function parseBatchPlanOutput(output: string): BatchPlanParseResult {
  const candidates = extractJsonCandidates(output);
  if (candidates.length === 0) {
    return { error: "batch planner did not include a structured JSON plan" };
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const envelope = batchPlanEnvelopeSchema.safeParse(parsed);
      if (envelope.success) {
        return { structuredPlan: envelope.data.structured_plan };
      }
      const direct = batchPlanSchema.safeParse(parsed);
      if (direct.success) {
        return { structuredPlan: direct.data };
      }
      errors.push(direct.error.issues.map((issue) => issue.message).join("; "));
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    error: errors.length > 0
      ? `batch planner structured JSON could not be parsed: ${errors[0]}`
      : "batch planner did not include a valid structured JSON plan",
  };
}

function extractJsonCandidates(output: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(output)) !== null) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }
  const trimmed = output.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }
  return candidates;
}
