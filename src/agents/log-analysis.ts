import { z } from "zod";

const analyzedRowSchema = z.object({
  row_number: z.number().int().positive().nullable().optional().default(null),
  test_name: z.string().min(1),
  system_name: z.string().min(1).nullable().optional().default(null),
  status: z.enum(["success", "failed", "skipped", "blocked", "unknown"]).optional().default("unknown"),
  summary: z.string().min(1),
  key_signals: z.array(z.string().min(1)).optional().default([]),
  failure_reason: z.string().min(1).nullable().optional().default(null),
  suggested_next_action: z.string().min(1).nullable().optional().default(null),
  jira_recommended: z.boolean().optional().default(false),
}).passthrough();

export const logAnalysisSchema = z.object({
  overall_status: z.enum(["success", "failed", "mixed", "blocked", "unknown"]).optional().default("unknown"),
  summary: z.string().min(1),
  rows: z.array(analyzedRowSchema).optional().default([]),
  teams_summary: z.string().min(1).nullable().optional().default(null),
}).passthrough();

const logAnalysisEnvelopeSchema = z.object({
  structured_analysis: logAnalysisSchema,
}).passthrough();

export type LogAnalysis = z.infer<typeof logAnalysisSchema>;

export type LogAnalysisParseResult =
  | { structuredAnalysis: LogAnalysis; error?: undefined }
  | { structuredAnalysis?: undefined; error: string };

export function parseLogAnalysisOutput(output: string): LogAnalysisParseResult {
  const candidates = extractJsonCandidates(output);
  if (candidates.length === 0) {
    return { error: "log analyst did not include a structured JSON analysis" };
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const envelope = logAnalysisEnvelopeSchema.safeParse(parsed);
      if (envelope.success) {
        return { structuredAnalysis: envelope.data.structured_analysis };
      }
      const direct = logAnalysisSchema.safeParse(parsed);
      if (direct.success) {
        return { structuredAnalysis: direct.data };
      }
      errors.push(direct.error.issues.map((issue) => issue.message).join("; "));
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    error: errors.length > 0
      ? `log analyst structured JSON could not be parsed: ${errors[0]}`
      : "log analyst did not include a valid structured JSON analysis",
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
