#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { startSession } from "./session/copilot.js";
import { phase1SystemMessage } from "./session/system-message.js";
import { RunStore } from "./runs/run-store.js";
import { localRunTools } from "./tools/local-run.js";

async function main(): Promise<void> {
  const runStore = new RunStore();
  const tools = localRunTools(runStore, { defaultCwd: process.cwd() });
  const session = await startSession({
    logLevel: "none",
    tools,
    systemMessage: phase1SystemMessage,
  });
  const { waitUntilExit } = render(<App session={session} runStore={runStore} />);
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
