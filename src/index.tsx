#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { startSession } from "./session/copilot.js";
import { phase2SystemMessage } from "./session/system-message.js";
import { RunStore } from "./runs/run-store.js";
import { localRunTools } from "./tools/local-run.js";
import { sshRunTools } from "./tools/ssh-run.js";
import { CredentialStore } from "./ssh/credential-store.js";
import { ConfirmationStore } from "./ssh/confirmation-store.js";
import { RunStateStore } from "./ssh/run-state-store.js";
import { createSsh2Client } from "./ssh/ssh-client.js";

async function main(): Promise<void> {
  const runStore = new RunStore();
  const credentials = new CredentialStore();
  const confirmations = new ConfirmationStore();
  const runStateStore = new RunStateStore();
  const sshClient = createSsh2Client();
  const useAgentAuth = process.env.AURA_SSH_USE_AGENT === "1";
  const tools = [
    ...localRunTools(runStore, { defaultCwd: process.cwd() }),
    ...sshRunTools(runStore, { sshClient, credentials, confirmations, runStateStore, useAgentAuth }),
  ];
  const idleTimeoutMs = parsePositiveInt(process.env.AURA_IDLE_TIMEOUT_MS);
  const session = await startSession({
    logLevel: "none",
    tools,
    systemMessage: phase2SystemMessage,
    ...(process.env.AURA_MODEL ? { model: process.env.AURA_MODEL } : {}),
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
  });
  const { waitUntilExit } = render(
    <App
      session={session}
      runStore={runStore}
      credentials={credentials}
      confirmations={confirmations}
    />,
  );
  try {
    await waitUntilExit();
  } finally {
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
