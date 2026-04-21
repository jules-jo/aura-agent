import type { RunStore } from "./run-store.js";
import type { Run } from "./run-types.js";
import type { TeamsConfig } from "../tools/teams.js";
import { sendTeamsNotification } from "../tools/teams.js";

export interface RunCompletionNotifierOptions {
  teams: TeamsConfig;
  fetchImpl?: typeof fetch;
}

export interface RunCompletionNotifier {
  close: () => void;
}

export function startRunCompletionNotifier(
  store: RunStore,
  options: RunCompletionNotifierOptions,
): RunCompletionNotifier {
  const notified = new Set<string>();
  const unsubscribe = store.subscribe((run) => {
    if (run.status === "running" || notified.has(run.id)) return;
    notified.add(run.id);
    void sendCompletionNotification(run, options);
  });
  return {
    close: unsubscribe,
  };
}

async function sendCompletionNotification(run: Run, options: RunCompletionNotifierOptions): Promise<void> {
  const status = run.status === "completed" ? "passed" : "failed";
  const durationSeconds = computeDurationSeconds(run);
  const summary = summarizeRun(run, status);
  await sendTeamsNotification({
    config: options.teams,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    notification: {
      title: summary.title,
      text: summary.text,
      status,
      facts: [
        ...(run.testName !== undefined ? [{ name: "test", value: run.testName }] : []),
        ...(run.systemName !== undefined ? [{ name: "system", value: run.systemName }] : []),
        { name: "command", value: run.command },
        { name: "cwd", value: run.cwd },
        { name: "status", value: run.status },
        { name: "exit_code", value: run.exitCode !== undefined ? String(run.exitCode) : "unknown" },
        ...(durationSeconds !== null ? [{ name: "duration", value: `${durationSeconds.toFixed(1)}s` }] : []),
      ],
    },
  });
}

function summarizeRun(run: Run, status: "passed" | "failed"): { title: string; text: string } {
  const runLabel = formatRunLabel(run);
  const titleStatus = status === "passed" ? "success" : "failed";
  const bodyStatus = status === "passed" ? "passed" : "failed";
  if (run.error) {
    const error = cleanLine(run.error);
    return {
      title: `Aura test ${titleStatus}: ${truncateOneLine(runLabel ?? error, 90)}`,
      text: `${runLabel ? `${runLabel} ` : "Run "}failed: ${error}`,
    };
  }

  const output = summarizeOutput(run);
  if (output) {
    return {
      title: `Aura test ${titleStatus}: ${truncateOneLine(runLabel ?? output.title, 90)}`,
      text: [`Test ${runLabel ? `${runLabel} ` : ""}${bodyStatus}.`, "", "Output summary:", ...output.lines].join(
        "\n",
      ),
    };
  }

  const exitText =
    run.exitCode !== undefined
      ? `Test ${runLabel ? `${runLabel} ` : ""}${bodyStatus} with exit code ${run.exitCode}.`
      : `Test ${runLabel ? `${runLabel} ` : ""}${bodyStatus} with unknown exit code.`;
  return {
    title: `Aura test ${titleStatus}${runLabel ? `: ${truncateOneLine(runLabel, 90)}` : ""}`,
    text: exitText,
  };
}

function formatRunLabel(run: Run): string | null {
  if (!run.testName) return null;
  return run.systemName ? `${run.testName} on ${run.systemName}` : run.testName;
}

function summarizeOutput(run: Run): { title: string; lines: string[] } | null {
  const lines = run.iterations
    .flatMap((iteration) => iteration.lines)
    .map(cleanLine)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const tail = lines.slice(-8);
  const title =
    [...tail]
      .reverse()
      .find((line) => /\b(passed|failed|failures?|errors?|tests?|test files|success|completed)\b/i.test(line)) ??
    tail.at(-1) ??
    "completed";
  return {
    title,
    lines: tail.map((line) => truncateOneLine(line, 240)),
  };
}

function cleanLine(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "").trim().replace(/\s{2,}/g, " ");
}

function truncateOneLine(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function computeDurationSeconds(run: Run): number | null {
  if (!run.completedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 1000);
}
