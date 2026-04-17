#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { startSession } from "./session/copilot.js";

async function main(): Promise<void> {
  const session = await startSession({ logLevel: "none" });
  const { waitUntilExit } = render(<App session={session} />);
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
