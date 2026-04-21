#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { startSession } from "./session/copilot.js";
import { phase3SystemMessage } from "./session/system-message.js";
import { RunStore } from "./runs/run-store.js";
import { startRunCompletionNotifier } from "./runs/run-completion-notifier.js";
import { localRunTools } from "./tools/local-run.js";
import { sshRunTools } from "./tools/ssh-run.js";
import { wikiTools } from "./tools/wiki.js";
import { jiraConfigFromEnv, jiraTools } from "./tools/jira.js";
import { teamsConfigFromEnv, teamsTools } from "./tools/teams.js";
import { CredentialStore } from "./ssh/credential-store.js";
import { ConfirmationStore } from "./ssh/confirmation-store.js";
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
  const credentials = new CredentialStore();
  const confirmations = new ConfirmationStore({ bypass: cli.bypassPermissions });
  const runStateStore = new RunStateStore();
  const sshClient = createSsh2Client();
  const useAgentAuth = process.env.AURA_SSH_USE_AGENT === "1";
  const teamsConfig = teamsConfigFromEnv(process.env);
  const runCompletionNotifier = startRunCompletionNotifier(runStore, { teams: teamsConfig });
  const tools = [
    ...localRunTools(runStore, { defaultCwd: process.cwd() }),
    ...sshRunTools(runStore, { sshClient, credentials, confirmations, runStateStore, useAgentAuth }),
    ...wikiTools({ rootDir: process.cwd(), confirmations }),
    ...jiraTools({
      confirmations,
      config: jiraConfigFromEnv(process.env),
    }),
    ...teamsTools({
      config: teamsConfig,
    }),
  ];
  const idleTimeoutMs = parsePositiveInt(process.env.AURA_IDLE_TIMEOUT_MS);
  const session = await startSession({
    logLevel: "none",
    tools,
    systemMessage: phase3SystemMessage,
    ...(process.env.AURA_MODEL ? { model: process.env.AURA_MODEL } : {}),
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
  });
  const { waitUntilExit } = render(
    <App
      session={session}
      runStore={runStore}
      credentials={credentials}
      confirmations={confirmations}
      bypassPermissions={cli.bypassPermissions}
    />,
  );
  try {
    await waitUntilExit();
  } finally {
    runCompletionNotifier.close();
    await session.close();
  }
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`aura failed to start: ${message}\n`);
  process.exit(1);
});
