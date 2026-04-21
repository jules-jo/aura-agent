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
  await sendTeamsNotification({
    config: options.teams,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    notification: {
      title: `Aura test ${status}: ${shortCommand(run.command)}`,
      text: summarizeRun(run, status),
      status,
      facts: [
        { name: "command", value: run.command },
        { name: "cwd", value: run.cwd },
        { name: "status", value: run.status },
        { name: "exit_code", value: run.exitCode !== undefined ? String(run.exitCode) : "unknown" },
        ...(durationSeconds !== null ? [{ name: "duration", value: `${durationSeconds.toFixed(1)}s` }] : []),
      ],
    },
  });
}

function summarizeRun(run: Run, status: "passed" | "failed"): string {
  if (run.error) return `${run.command} ${status}: ${run.error}`;
  if (run.exitCode !== undefined) return `${run.command} ${status} with exit code ${run.exitCode}.`;
  return `${run.command} ${status} with unknown exit code.`;
}

function shortCommand(command: string): string {
  return command.length <= 80 ? command : `${command.slice(0, 77)}...`;
}

function computeDurationSeconds(run: Run): number | null {
  if (!run.completedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 1000);
}
