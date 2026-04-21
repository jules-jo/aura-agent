#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { startSession } from "./session/copilot.js";
import { phase3SystemMessageForMode } from "./session/system-message.js";
import { CopilotAgentManager } from "./agents/agent-manager.js";
import { AgentTraceStore } from "./agents/agent-trace-store.js";
import { RunStore } from "./runs/run-store.js";
import { startRunCompletionNotifier } from "./runs/run-completion-notifier.js";
import { localRunTools } from "./tools/local-run.js";
import { sshRunTools } from "./tools/ssh-run.js";
import { agenticRunPlanTools } from "./tools/agentic-run-plan.js";
import { agentTools } from "./tools/agents.js";
import { spreadsheetTools } from "./tools/spreadsheet.js";
import { wikiReadOnlyTools, wikiTools } from "./tools/wiki.js";
import { jiraConfigFromEnv, jiraTools } from "./tools/jira.js";
import { teamsConfigFromEnv, teamsTools } from "./tools/teams.js";
import { CredentialStore, sshPasswordResolverFromEnv } from "./ssh/credential-store.js";
import { ConfirmationStore, type ConfirmationRequest } from "./ssh/confirmation-store.js";
import { RunStateStore } from "./ssh/run-state-store.js";
import { createSsh2Client } from "./ssh/ssh-client.js";
import { loadDotEnv } from "./config/dotenv.js";
import { formatAuraHelp, parseAuraCliArgs } from "./config/cli.js";

async function main(): Promise<void> {
  const cli = parseAuraCliArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(formatAuraHelp());
    return;
  }

  loadDotEnv(process.cwd());
  const runStore = new RunStore();
  const credentials = new CredentialStore({
    resolvePassword: sshPasswordResolverFromEnv(process.env),
  });
  const confirmations = new ConfirmationStore({
    bypass: cli.bypassPermissions,
    ...(cli.agenticMode ? { autoApprove: isAgenticAutoApprovedConfirmation } : {}),
  });
  const agentTraces = new AgentTraceStore();
  const runStateStore = new RunStateStore();
  const sshClient = createSsh2Client();
  const useAgentAuth = process.env.AURA_SSH_USE_AGENT === "1";
  const defaultSpreadsheetPath = readOptionalEnv("AURA_AGENTIC_SPREADSHEET_PATH");
  const defaultSpreadsheetSheet = readOptionalEnv("AURA_AGENTIC_SPREADSHEET_SHEET");
  const agenticPollWaitMs = parseNonNegativeInt(process.env.AURA_AGENTIC_POLL_WAIT_MS);
  const agenticProgressHeartbeatMs = parseNonNegativeInt(process.env.AURA_AGENTIC_PROGRESS_HEARTBEAT_MS);
  const agenticProgressChunkLines = parsePositiveInt(process.env.AURA_AGENTIC_PROGRESS_CHUNK_LINES);
  const teamsConfig = teamsConfigFromEnv(process.env);
  const runCompletionNotifier = startRunCompletionNotifier(runStore, { teams: teamsConfig });
  const idleTimeoutMs = parsePositiveInt(process.env.AURA_IDLE_TIMEOUT_MS);
  const agentManager = new CopilotAgentManager({
    logLevel: "none",
    toolsByRole: {
      batch_planner: [
        ...wikiReadOnlyTools({ rootDir: process.cwd() }),
        ...spreadsheetTools({ rootDir: process.cwd() }),
      ],
    },
    ...(process.env.AURA_MODEL ? { model: process.env.AURA_MODEL } : {}),
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
  });
  const localTools = localRunTools(runStore, { defaultCwd: process.cwd() });
  const sshTools = sshRunTools(runStore, { sshClient, credentials, confirmations, runStateStore, useAgentAuth });
  const tools = [
    ...agentTools(agentManager, { traces: agentTraces }),
    ...agenticRunPlanTools({
      rootDir: process.cwd(),
      confirmations,
      localTools,
      sshTools,
      traces: agentTraces,
      ...(agenticPollWaitMs !== undefined ? { defaultPollWaitMs: agenticPollWaitMs } : {}),
      ...(agenticProgressHeartbeatMs !== undefined ? { progressHeartbeatMs: agenticProgressHeartbeatMs } : {}),
      ...(agenticProgressChunkLines !== undefined ? { progressChunkLines: agenticProgressChunkLines } : {}),
    }),
    ...localTools,
    ...sshTools,
    ...wikiTools({ rootDir: process.cwd(), confirmations }),
    ...jiraTools({
      confirmations,
      config: jiraConfigFromEnv(process.env),
    }),
    ...teamsTools({
      config: teamsConfig,
    }),
  ];
  const session = await startSession({
    logLevel: "none",
    tools,
    systemMessage: phase3SystemMessageForMode({
      agenticMode: cli.agenticMode,
      ...(defaultSpreadsheetPath !== undefined ? { defaultSpreadsheetPath } : {}),
      ...(defaultSpreadsheetSheet !== undefined ? { defaultSpreadsheetSheet } : {}),
    }),
    ...(process.env.AURA_MODEL ? { model: process.env.AURA_MODEL } : {}),
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
  });
  const { waitUntilExit } = render(
    <App
      session={session}
      runStore={runStore}
      credentials={credentials}
      confirmations={confirmations}
      agentTraces={agentTraces}
      bypassPermissions={cli.bypassPermissions}
      agenticMode={cli.agenticMode}
    />,
  );
  try {
    await waitUntilExit();
  } finally {
    runCompletionNotifier.close();
    await agentManager.close();
    await session.close();
  }
}

function isAgenticAutoApprovedConfirmation(req: ConfirmationRequest): boolean {
  return req.kind === "ssh_dispatch" || req.kind === "spreadsheet_write";
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`aura failed to start: ${message}\n`);
  process.exit(1);
});
