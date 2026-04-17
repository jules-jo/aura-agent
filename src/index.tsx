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
import { RunStateStore } from "./ssh/run-state-store.js";
import { createSsh2Client } from "./ssh/ssh-client.js";

async function main(): Promise<void> {
  const runStore = new RunStore();
  const credentials = new CredentialStore();
  const runStateStore = new RunStateStore();
  const sshClient = createSsh2Client();
  const tools = [
    ...localRunTools(runStore, { defaultCwd: process.cwd() }),
    ...sshRunTools(runStore, { sshClient, credentials, runStateStore }),
  ];
  const session = await startSession({
    logLevel: "none",
    tools,
    systemMessage: phase2SystemMessage,
    ...(process.env.AURA_MODEL ? { model: process.env.AURA_MODEL } : {}),
  });
  const { waitUntilExit } = render(
    <App session={session} runStore={runStore} credentials={credentials} />,
  );
  try {
    await waitUntilExit();
  } finally {
    await session.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`aura failed to start: ${message}\n`);
  process.exit(1);
});
