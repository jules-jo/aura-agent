import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { listSystemPages, listTestPages } from "../wiki/pages.js";
import {
  resolveRunSpec,
  type CatalogPreflightStep,
  type CatalogProgressSpec,
  type ResolvedRunSpec,
} from "../wiki/catalog.js";
import type { ConfirmationStore } from "../ssh/confirmation-store.js";
import type { AgentTraceStore } from "../agents/agent-trace-store.js";
import {
  formatProgressEvents,
  RunProgressTracker,
  summarizeProgressSnapshot,
  type ProgressSpec,
  type RunProgressSnapshot,
} from "../runs/progress-parser.js";
import { writeSpreadsheetUpdates, type SpreadsheetCellValue } from "./spreadsheet.js";

const readyRowSchema = z
  .object({
    row_number: z.number().int().positive().nullable().optional().default(null),
    test_name: z.string().min(1),
    system_name: z.string().min(1).nullable().optional().default(null),
    args: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .default({}),
    notes: z.string().min(1).nullable().optional().default(null),
  })
  .passthrough();

const resultColumnsSchema = z
  .object({
    status: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    completed_at: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    jira_key: z.string().min(1).optional(),
  })
  .optional();

const runPlanSchema = z.object({
  spreadsheet_path: z
    .string()
    .min(1)
    .optional()
    .describe("Spreadsheet path to write results into. Omit to run without spreadsheet write-back."),
  sheet_name: z.string().min(1).optional().describe("Optional sheet name for .xlsx spreadsheets."),
  ready: z.array(readyRowSchema).min(1).describe("structured_plan.ready rows from batch_planner."),
  write_results: z.boolean().optional().describe("Defaults to true when spreadsheet_path is provided."),
  result_columns: resultColumnsSchema.describe("Optional spreadsheet column names for write-back."),
  poll_wait_ms: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .optional()
    .describe("Poll wait per run. Defaults to runtime AURA_AGENTIC_POLL_WAIT_MS or 2000."),
  progress_heartbeat_ms: z
    .number()
    .int()
    .min(0)
    .max(600000)
    .optional()
    .describe(
      "Quiet-running heartbeat interval. 0 disables quiet heartbeats. Defaults to runtime AURA_AGENTIC_PROGRESS_HEARTBEAT_MS or 30000.",
    ),
  progress_chunk_lines: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Output lines per progress chunk. Defaults to runtime AURA_AGENTIC_PROGRESS_CHUNK_LINES or 20."),
});

const recordJiraKeySchema = z.object({
  spreadsheet_path: z.string().min(1).describe("Spreadsheet path to update."),
  sheet_name: z.string().min(1).optional().describe("Optional sheet name for .xlsx spreadsheets."),
  row_number: z.number().int().positive().describe("Spreadsheet row number to update."),
  jira_key: z.string().min(1).describe("Jira issue key returned after creation."),
  result_columns: resultColumnsSchema.describe("Optional spreadsheet column names for write-back."),
});

type ReadyRow = z.infer<typeof readyRowSchema>;
interface ResultColumns {
  status: string;
  run_id: string;
  completed_at: string;
  summary: string;
  jira_key: string;
}

export interface AgenticRunPlanToolsOptions {
  rootDir: string;
  confirmations: ConfirmationStore;
  localTools: Tool<any>[];
  sshTools: Tool<any>[];
  defaultPollWaitMs?: number;
  progressHeartbeatMs?: number;
  progressChunkLines?: number;
  traces?: AgentTraceStore;
  now?: () => Date;
}

type RowStatus = "success" | "failed" | "skipped" | "blocked";

interface RowResult {
  row_number: number | null;
  test_name: string;
  system_name: string | null;
  status: RowStatus;
  run_id: string | null;
  exit_code: number | null;
  completed_at: string;
  summary: string;
  output_tail: string[];
  progress: RunProgressSnapshot;
  spreadsheet_updated: boolean;
  spreadsheet_error?: string;
  preflight: PreflightResult[];
}

interface PreflightResult {
  name: string;
  status: "ran" | "skipped" | "failed" | "blocked";
  file_exists: boolean | null;
  run_test: string | null;
  run_id: string | null;
  summary: string;
}

interface DispatchResult {
  status: "success" | "failed" | "skipped";
  runId: string | null;
  exitCode: number | null;
  completedAt: string;
  summary: string;
  lines: string[];
  progress: RunProgressSnapshot;
}

interface ProgressConfig {
  pollWaitMs: number;
  heartbeatMs: number;
  chunkLines: number;
}

const DEFAULT_RESULT_COLUMNS: ResultColumns = {
  status: "aura_status",
  run_id: "aura_run_id",
  completed_at: "aura_completed_at",
  summary: "aura_summary",
  jira_key: "aura_jira_key",
};
const DEFAULT_POLL_WAIT_MS = 2000;
const DEFAULT_PROGRESS_HEARTBEAT_MS = 30000;
const DEFAULT_PROGRESS_CHUNK_LINES = 20;

export function agenticRunPlanTools(options: AgenticRunPlanToolsOptions): Tool<any>[] {
  const runPlanTool = defineTool("agentic_run_plan", {
    description:
      "Deterministically execute structured_plan.ready rows sequentially, handle file_exists preflights, and write result status/run metadata back to the spreadsheet.",
    parameters: runPlanSchema,
    handler: async (args) => {
      const parsed = runPlanSchema.parse(args);
      return runPlan(options, {
        ready: parsed.ready,
        resultColumns: normalizeResultColumns(parsed.result_columns),
        progress: {
          pollWaitMs: parsed.poll_wait_ms ?? options.defaultPollWaitMs ?? DEFAULT_POLL_WAIT_MS,
          heartbeatMs: parsed.progress_heartbeat_ms ?? options.progressHeartbeatMs ?? DEFAULT_PROGRESS_HEARTBEAT_MS,
          chunkLines: parsed.progress_chunk_lines ?? options.progressChunkLines ?? DEFAULT_PROGRESS_CHUNK_LINES,
        },
        ...(parsed.spreadsheet_path !== undefined ? { spreadsheetPath: parsed.spreadsheet_path } : {}),
        ...(parsed.sheet_name !== undefined ? { sheetName: parsed.sheet_name } : {}),
        ...(parsed.write_results !== undefined ? { writeResults: parsed.write_results } : {}),
      });
    },
  });

  const recordJiraKeyTool = defineTool("agentic_record_jira_key", {
    description:
      "Write a Jira key returned by a user-approved Jira create into the configured agentic spreadsheet row.",
    parameters: recordJiraKeySchema,
    handler: async (args) => {
      const parsed = recordJiraKeySchema.parse(args);
      const columns = normalizeResultColumns(parsed.result_columns);
      const approved = await options.confirmations.request({
        kind: "spreadsheet_write",
        summary: `record Jira key in ${parsed.spreadsheet_path}`,
        detail: `row ${parsed.row_number}: ${parsed.jira_key}`,
      });
      if (!approved) {
        return {
          error: "user_declined",
          spreadsheet_path: parsed.spreadsheet_path,
          row_number: parsed.row_number,
        };
      }
      try {
        const write = await writeSpreadsheetUpdates(options.rootDir, {
          path: parsed.spreadsheet_path,
          ...(parsed.sheet_name !== undefined ? { sheetName: parsed.sheet_name } : {}),
          updates: [
            {
              rowNumber: parsed.row_number,
              values: {
                [columns.jira_key]: parsed.jira_key,
              },
            },
          ],
        });
        return {
          spreadsheet_path: write.path,
          sheet_name: write.sheet_name,
          row_number: parsed.row_number,
          jira_key: parsed.jira_key,
          spreadsheet_updated: true,
        };
      } catch (err: unknown) {
        return {
          error: "spreadsheet_write_failed",
          spreadsheet_path: parsed.spreadsheet_path,
          row_number: parsed.row_number,
          message: toErrorMessage(err),
        };
      }
    },
  });

  return [runPlanTool, recordJiraKeyTool];
}

async function runPlan(
  options: AgenticRunPlanToolsOptions,
  input: {
    spreadsheetPath?: string;
    sheetName?: string;
    ready: ReadyRow[];
    writeResults?: boolean;
    resultColumns: ResultColumns;
    progress: ProgressConfig;
  },
): Promise<Record<string, unknown>> {
  const startedAt = options.now?.().toISOString() ?? new Date().toISOString();
  const shouldWrite = Boolean(input.spreadsheetPath && input.writeResults !== false);
  const writeApproved = shouldWrite
    ? await options.confirmations.request({
        kind: "spreadsheet_write",
        summary: `write agentic results to ${input.spreadsheetPath}`,
        detail: `Update ${input.ready.length} planned row(s) with status, run id, completed time, summary, and Jira key column.`,
      })
    : false;
  const [testPages, systemPages] = await Promise.all([
    listTestPages(options.rootDir),
    listSystemPages(options.rootDir),
  ]);
  const rows: RowResult[] = [];
  trace(options, `Starting agentic batch execution for ${input.ready.length} ready row(s).`);

  for (const row of input.ready) {
    const result = await executeRow(options, {
      row,
      testPages,
      systemPages,
      progress: input.progress,
    });
    if (input.spreadsheetPath && shouldWrite && writeApproved && row.row_number !== null) {
      const writeResult = await writeRowResult(options, {
        spreadsheetPath: input.spreadsheetPath,
        columns: input.resultColumns,
        result,
        ...(input.sheetName !== undefined ? { sheetName: input.sheetName } : {}),
      });
      result.spreadsheet_updated = writeResult.updated;
      if (writeResult.error) result.spreadsheet_error = writeResult.error;
    }
    rows.push(result);
  }

  const completedAt = options.now?.().toISOString() ?? new Date().toISOString();
  const failedRows = rows.filter((row) => row.status === "failed");
  trace(options, formatBatchFinishedMessage(rows));
  return {
    started_at: startedAt,
    completed_at: completedAt,
    spreadsheet_path: input.spreadsheetPath ?? null,
    sheet_name: input.sheetName ?? null,
    spreadsheet_write: input.spreadsheetPath
      ? writeApproved
        ? "enabled"
        : "declined_or_disabled"
      : "not_configured",
    totals: {
      rows: rows.length,
      success: rows.filter((row) => row.status === "success").length,
      failed: rows.filter((row) => row.status === "failed").length,
      skipped: rows.filter((row) => row.status === "skipped").length,
      blocked: rows.filter((row) => row.status === "blocked").length,
    },
    failure_report: {
      needed: failedRows.length > 0,
      instruction: failedRows.length > 0
        ? "Summarize these failed rows to the user and ask whether to draft Jira issues. Do not create Jira issues without preview approval."
        : null,
      rows: failedRows.map((row) => ({
        row_number: row.row_number,
        test_name: row.test_name,
        system_name: row.system_name,
        run_id: row.run_id,
        exit_code: row.exit_code,
        summary: row.summary,
        output_tail: row.output_tail,
        progress: row.progress,
      })),
    },
    rows,
  };
}

async function executeRow(
  options: AgenticRunPlanToolsOptions,
  input: {
    row: ReadyRow;
    testPages: Awaited<ReturnType<typeof listTestPages>>;
    systemPages: Awaited<ReturnType<typeof listSystemPages>>;
    progress: ProgressConfig;
  },
): Promise<RowResult> {
  const providedArgs = stringifyArgs(input.row.args);
  const resolved = resolveRunSpec(input.testPages, input.systemPages, {
    testQuery: input.row.test_name,
    ...(input.row.system_name ? { systemQuery: input.row.system_name } : {}),
    providedArgs,
  });
  const completedAt = options.now?.().toISOString() ?? new Date().toISOString();
  if ("error" in resolved) {
    return blockedRow(input.row, completedAt, `Could not resolve test row: ${resolved.error}`);
  }
  if (!resolved.ready_to_dispatch || !resolved.command) {
    return blockedRow(
      input.row,
      completedAt,
      formatResolutionBlocker(resolved),
      resolved.test_name,
      resolved.system_name,
    );
  }

  trace(options, `Running row ${formatRowNumber(input.row.row_number)}: ${formatSpecLabel(resolved)}.`);
  const preflight: PreflightResult[] = [];
  for (const step of resolved.preflight) {
    const preflightResult = await executePreflight(options, {
      mainSpec: resolved,
      step,
      providedArgs,
      progress: input.progress,
    });
    preflight.push(preflightResult);
    if (preflightResult.status === "failed" || preflightResult.status === "blocked") {
      const skippedAt = options.now?.().toISOString() ?? new Date().toISOString();
      return {
        row_number: input.row.row_number,
        test_name: resolved.test_name,
        system_name: resolved.system_name,
        status: "skipped",
        run_id: null,
        exit_code: null,
        completed_at: skippedAt,
        summary: `Skipped ${resolved.test_name}: ${preflightResult.summary}`,
        output_tail: [],
        progress: emptyProgressSnapshot(),
        spreadsheet_updated: false,
        preflight,
      };
    }
  }

  const dispatch = await dispatchAndWait(options, {
    spec: resolved,
    progress: input.progress,
  });
  return {
    row_number: input.row.row_number,
    test_name: resolved.test_name,
    system_name: resolved.system_name,
    status: dispatch.status,
    run_id: dispatch.runId,
    exit_code: dispatch.exitCode,
    completed_at: dispatch.completedAt,
    summary: dispatch.summary,
    output_tail: tailLines(dispatch.lines),
    progress: dispatch.progress,
    spreadsheet_updated: false,
    preflight,
  };
}

async function executePreflight(
  options: AgenticRunPlanToolsOptions,
  input: {
    mainSpec: ResolvedRunSpec;
    step: CatalogPreflightStep;
    providedArgs: Record<string, string>;
    progress: ProgressConfig;
  },
): Promise<PreflightResult> {
  if (!input.step.check.path) {
    return {
      name: input.step.name,
      status: "blocked",
      file_exists: null,
      run_test: null,
      run_id: null,
      summary: `Preflight ${input.step.name} has an unresolved file path.`,
    };
  }

  trace(options, `Checking preflight '${input.step.name}' for ${formatSpecLabel(input.mainSpec)}.`);
  const check = await checkPreflightFile(options, input.mainSpec, input.step.check.path);
  if ("error" in check) {
    return {
      name: input.step.name,
      status: "blocked",
      file_exists: null,
      run_test: null,
      run_id: null,
      summary: `Preflight ${input.step.name} file check failed: ${check.error}`,
    };
  }

  const action = check.exists ? input.step.if_exists : input.step.if_missing;
  if (check.exists) {
    trace(options, `Preflight file exists for ${formatSpecLabel(input.mainSpec)}; asking whether to rerun ${action.run_test}.`);
    const approved = await options.confirmations.request({
      kind: "agentic_preflight",
      summary: `rerun ${action.run_test}?`,
      detail: `${action.ask}\nfile: ${input.step.check.path}`,
    });
    if (!approved) {
      return {
        name: input.step.name,
        status: "skipped",
        file_exists: true,
        run_test: action.run_test,
        run_id: null,
        summary: `Skipped ${action.run_test}; existing preflight file was accepted.`,
      };
    }
  }
  if (!check.exists) {
    trace(options, `Preflight file is missing for ${formatSpecLabel(input.mainSpec)}; running ${action.run_test}.`);
  }

  const resolved = resolveRunSpec(await listTestPages(options.rootDir), await listSystemPages(options.rootDir), {
    testQuery: action.run_test,
    ...(input.mainSpec.system_name ? { systemQuery: input.mainSpec.system_name } : {}),
    providedArgs: input.providedArgs,
  });
  if ("error" in resolved || !resolved.ready_to_dispatch || !resolved.command) {
    return {
      name: input.step.name,
      status: "blocked",
      file_exists: check.exists,
      run_test: action.run_test,
      run_id: null,
      summary: `Could not resolve prerequisite ${action.run_test}.`,
    };
  }

  const dispatch = await dispatchAndWait(options, {
    spec: resolved,
    progress: input.progress,
  });
  return {
    name: input.step.name,
    status: dispatch.status === "success" ? "ran" : "failed",
    file_exists: check.exists,
    run_test: action.run_test,
    run_id: dispatch.runId,
    summary: dispatch.summary,
  };
}

async function checkPreflightFile(
  options: AgenticRunPlanToolsOptions,
  spec: ResolvedRunSpec,
  filePath: string,
): Promise<{ exists: boolean } | { error: string }> {
  if (spec.execution_target === "local") {
    return callTool<{ exists?: boolean; error?: string }>(options.localTools, "local_check_file", {
      path: filePath,
      ...(spec.cwd !== null ? { cwd: spec.cwd } : {}),
    }).then((result) => result.error ? { error: result.error } : { exists: result.exists === true });
  }

  if (!spec.host || !spec.username) {
    return { error: "missing SSH target for preflight file check" };
  }
  const result = await callTool<{ exists?: boolean; error?: string }>(options.sshTools, "ssh_check_file", {
    host: spec.host,
    username: spec.username,
    path: filePath,
    ...(spec.port !== null ? { port: spec.port } : {}),
    ...(spec.credential_id !== null ? { credential_id: spec.credential_id } : {}),
    ...(spec.cwd !== null ? { cwd: spec.cwd } : {}),
  });
  return result.error ? { error: result.error } : { exists: result.exists === true };
}

async function dispatchAndWait(
  options: AgenticRunPlanToolsOptions,
  input: { spec: ResolvedRunSpec; progress: ProgressConfig },
): Promise<DispatchResult> {
  const spec = input.spec;
  const progress = progressConfigForSpec(input.progress, spec.progress);
  const dispatchArgs = {
    command: spec.command,
    ...(spec.cwd !== null ? { cwd: spec.cwd } : {}),
    ...(spec.env !== null ? { env: spec.env } : {}),
    test_name: spec.test_name,
    ...(spec.system_name !== null ? { system_name: spec.system_name } : {}),
    iteration_lines: progress.chunkLines,
  };
  const dispatch =
    spec.execution_target === "local"
      ? await callTool<{ run_id?: string; error?: string }>(options.localTools, "local_dispatch", dispatchArgs)
      : await callTool<{ run_id?: string; error?: string }>(options.sshTools, "ssh_dispatch", {
          ...dispatchArgs,
          host: spec.host,
          username: spec.username,
          ...(spec.port !== null ? { port: spec.port } : {}),
          ...(spec.credential_id !== null ? { credential_id: spec.credential_id } : {}),
        });

  if (dispatch.error || !dispatch.run_id) {
    return {
      status: dispatch.error === "user_declined" ? "skipped" : "failed",
      runId: dispatch.run_id ?? null,
      exitCode: null,
      completedAt: options.now?.().toISOString() ?? new Date().toISOString(),
      summary: dispatch.error ? `Dispatch failed: ${dispatch.error}` : "Dispatch did not return a run id.",
      lines: [],
      progress: emptyProgressSnapshot(),
    };
  }

  trace(options, `Dispatched ${formatSpecLabel(spec)} as run ${dispatch.run_id}; polling status.`);
  return pollUntilComplete(options, {
    runId: dispatch.run_id,
    target: spec.execution_target,
    label: formatSpecLabel(spec),
    progress,
    progressSpec: spec.progress,
  });
}

async function pollUntilComplete(
  options: AgenticRunPlanToolsOptions,
  input: {
    runId: string;
    target: "local" | "ssh";
    label: string;
    progress: ProgressConfig;
    progressSpec: CatalogProgressSpec | null;
  },
): Promise<DispatchResult> {
  let sinceIteration = 0;
  let lastProgressAtMs = nowMs(options);
  const lines: string[] = [];
  const tracker = new RunProgressTracker(toProgressSpec(input.progressSpec));
  for (;;) {
    const poll = await callTool<{
      status?: "running" | "completed" | "failed";
      exit_code?: number | null;
      error?: string | null;
      completed_at?: string | null;
      total_iterations?: number;
      iterations?: Array<{ index: number; lines: string[] }>;
    }>(input.target === "local" ? options.localTools : options.sshTools, input.target === "local" ? "local_poll" : "ssh_poll", {
      run_id: input.runId,
      since_iteration: sinceIteration,
      wait_ms: input.progress.pollWaitMs,
    });
    if (poll.error) {
      trace(options, `${input.label} polling failed: ${poll.error}.`);
      return {
        status: "failed",
        runId: input.runId,
        exitCode: poll.exit_code ?? null,
        completedAt: poll.completed_at ?? options.now?.().toISOString() ?? new Date().toISOString(),
        summary: `Poll failed: ${poll.error}`,
        lines,
        progress: tracker.snapshot(),
      };
    }
    const iterations = poll.iterations ?? [];
    for (const iteration of iterations) {
      lines.push(...iteration.lines);
      const events = tracker.applyLines(iteration.lines);
      if (events.length > 0) trace(options, formatProgressEvents(input.label, events));
    }
    if (iterations.length > 0) lastProgressAtMs = nowMs(options);
    sinceIteration = poll.total_iterations ?? nextSinceIteration(sinceIteration, iterations);
    if (poll.status === "running") {
      const now = nowMs(options);
      if (iterations.length === 0 && input.progress.heartbeatMs > 0 && now - lastProgressAtMs >= input.progress.heartbeatMs) {
        trace(options, `${input.label} still running; no new output chunk yet (run ${input.runId}).`);
        lastProgressAtMs = now;
      }
    }
    if (poll.status !== "running") {
      const status = poll.status === "completed" ? "success" : "failed";
      const progressSnapshot = tracker.snapshot();
      const summary = summarizeRun(status, poll.exit_code ?? null, lines, progressSnapshot);
      trace(options, `${input.label} ${status === "success" ? "succeeded" : "failed"}: ${summary}.`);
      return {
        status,
        runId: input.runId,
        exitCode: poll.exit_code ?? null,
        completedAt: poll.completed_at ?? options.now?.().toISOString() ?? new Date().toISOString(),
        summary,
        lines,
        progress: progressSnapshot,
      };
    }
  }
}

async function writeRowResult(
  options: AgenticRunPlanToolsOptions,
  input: {
    spreadsheetPath: string;
    sheetName?: string;
    columns: ResultColumns;
    result: RowResult;
  },
): Promise<{ updated: boolean; error?: string }> {
  if (input.result.row_number === null) return { updated: false, error: "missing row_number" };
  try {
    await writeSpreadsheetUpdates(options.rootDir, {
      path: input.spreadsheetPath,
      ...(input.sheetName !== undefined ? { sheetName: input.sheetName } : {}),
      updates: [
        {
          rowNumber: input.result.row_number,
          values: {
            [input.columns.status]: input.result.status,
            [input.columns.run_id]: input.result.run_id ?? "",
            [input.columns.completed_at]: input.result.completed_at,
            [input.columns.summary]: input.result.summary,
            [input.columns.jira_key]: "",
          },
        },
      ],
    });
    return { updated: true };
  } catch (err: unknown) {
    return { updated: false, error: toErrorMessage(err) };
  }
}

function normalizeResultColumns(input: z.infer<typeof resultColumnsSchema>): ResultColumns {
  return {
    status: input?.status ?? DEFAULT_RESULT_COLUMNS.status,
    run_id: input?.run_id ?? DEFAULT_RESULT_COLUMNS.run_id,
    completed_at: input?.completed_at ?? DEFAULT_RESULT_COLUMNS.completed_at,
    summary: input?.summary ?? DEFAULT_RESULT_COLUMNS.summary,
    jira_key: input?.jira_key ?? DEFAULT_RESULT_COLUMNS.jira_key,
  };
}

function stringifyArgs(input: ReadyRow["args"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) continue;
    out[key] = String(value);
  }
  return out;
}

function blockedRow(
  row: ReadyRow,
  completedAt: string,
  summary: string,
  resolvedTestName?: string,
  resolvedSystemName?: string | null,
): RowResult {
  return {
    row_number: row.row_number,
    test_name: resolvedTestName ?? row.test_name,
    system_name: resolvedSystemName ?? row.system_name,
    status: "blocked",
    run_id: null,
    exit_code: null,
    completed_at: completedAt,
    summary,
    output_tail: [],
    progress: emptyProgressSnapshot(),
    spreadsheet_updated: false,
    preflight: [],
  };
}

function formatResolutionBlocker(spec: ResolvedRunSpec): string {
  const parts = [
    spec.missing_args.length > 0 ? `missing args: ${spec.missing_args.map((arg) => arg.name).join(", ")}` : null,
    spec.invalid_args.length > 0 ? `invalid args: ${spec.invalid_args.map((arg) => arg.name).join(", ")}` : null,
    spec.required_fields.length > 0 ? `missing fields: ${spec.required_fields.join(", ")}` : null,
    !spec.command ? "command is not resolved" : null,
  ].filter(Boolean);
  return parts.length > 0 ? `Row is not ready to dispatch (${parts.join("; ")}).` : "Row is not ready to dispatch.";
}

function progressConfigForSpec(base: ProgressConfig, spec: CatalogProgressSpec | null): ProgressConfig {
  return {
    pollWaitMs: base.pollWaitMs,
    heartbeatMs: spec?.heartbeat_ms ?? base.heartbeatMs,
    chunkLines: spec?.chunk_lines ?? base.chunkLines,
  };
}

function toProgressSpec(spec: CatalogProgressSpec | null): ProgressSpec | null {
  if (!spec) return null;
  return {
    patterns: spec.patterns,
  };
}

function emptyProgressSnapshot(): RunProgressSnapshot {
  return {
    phase: null,
    progress: null,
    metrics: {},
    latest_signal: null,
    warnings: [],
    failures: [],
    artifacts: [],
    matched_events: 0,
  };
}

function summarizeRun(
  status: "success" | "failed" | "skipped",
  exitCode: number | null,
  lines: readonly string[],
  progress?: RunProgressSnapshot,
): string {
  const progressSummary = progress ? summarizeProgressSnapshot(progress) : null;
  const tail = tailLines(lines);
  const signal =
    [...tail].reverse().find((line) => /\b(passed|failed|failures?|errors?|tests?|success|completed)\b/i.test(line)) ??
    tail.at(-1);
  const exit = exitCode !== null ? `exit ${exitCode}` : "unknown exit";
  if (progressSummary && signal && !progressSummary.includes(signal)) {
    return `${status} (${exit}): ${progressSummary}; latest output ${signal}`;
  }
  if (progressSummary) return `${status} (${exit}): ${progressSummary}`;
  return signal ? `${status} (${exit}): ${signal}` : `${status} (${exit})`;
}

function nextSinceIteration(current: number, iterations: ReadonlyArray<{ index: number }>): number {
  return iterations.reduce((next, iteration) => Math.max(next, iteration.index + 1), current);
}

function nowMs(options: AgenticRunPlanToolsOptions): number {
  return options.now?.().getTime() ?? Date.now();
}

function tailLines(lines: readonly string[]): string[] {
  return lines.map(cleanLine).filter(Boolean).slice(-8);
}

function formatRowNumber(rowNumber: number | null): string {
  return rowNumber === null ? "(no spreadsheet row)" : String(rowNumber);
}

function formatSpecLabel(spec: Pick<ResolvedRunSpec, "test_name" | "system_name">): string {
  return spec.system_name ? `${spec.test_name} on ${spec.system_name}` : spec.test_name;
}

function formatBatchFinishedMessage(rows: readonly RowResult[]): string {
  const success = rows.filter((row) => row.status === "success").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const skipped = rows.filter((row) => row.status === "skipped").length;
  const blocked = rows.filter((row) => row.status === "blocked").length;
  return `Agentic batch finished: ${success} success, ${failed} failed, ${skipped} skipped, ${blocked} blocked.`;
}

function trace(options: AgenticRunPlanToolsOptions, message: string): void {
  options.traces?.record({
    role: "agentic_run_plan",
    status: "progress",
    message,
  });
}

function cleanLine(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "").trim().replace(/\s{2,}/g, " ");
}

type ToolWithHandler = Tool<any> & {
  name: string;
  handler: (args: Record<string, unknown>, invocation: Record<string, unknown>) => unknown;
};

async function callTool<T>(
  tools: readonly Tool<any>[],
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((candidate) => candidate.name === name) as ToolWithHandler | undefined;
  if (!tool) throw new Error(`tool not available: ${name}`);
  return await Promise.resolve(
    tool.handler(args, {
      sessionId: "agentic_run_plan",
      toolCallId: `${name}_${Date.now()}`,
      toolName: name,
      arguments: args,
    }),
  ) as T;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
