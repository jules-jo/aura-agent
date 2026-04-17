import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/app.js";
import type { AuraSession, AssistantEvent } from "../src/session/copilot.js";
import { RunStore } from "../src/runs/run-store.js";
import { CredentialStore } from "../src/ssh/credential-store.js";

async function flushEffects(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function makeFakeSession(): {
  session: AuraSession;
  emit: (event: AssistantEvent) => void;
  sentPrompts: string[];
} {
  const listeners = new Set<(event: AssistantEvent) => void>();
  const sentPrompts: string[] = [];
  const session: AuraSession = {
    send: async (prompt: string) => {
      sentPrompts.push(prompt);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      listeners.clear();
    },
  };
  return {
    session,
    emit: (event) => listeners.forEach((l) => l(event)),
    sentPrompts,
  };
}

describe("App", () => {
  it("renders the two panes and the prompt", () => {
    const { session } = makeFakeSession();
    const store = new RunStore();
    const credentials = new CredentialStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("aura");
    expect(frame).toContain("chat");
    expect(frame).toContain("run");
  });

  it("appends assistant final responses to the chat pane", async () => {
    const { session, emit } = makeFakeSession();
    const store = new RunStore();
    const credentials = new CredentialStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} />,
    );
    await flushEffects();
    emit({ kind: "final", text: "hello from aura" });
    await flushEffects();
    expect(lastFrame() ?? "").toContain("hello from aura");
  });

  it("shows streaming deltas while the assistant is thinking", async () => {
    const { session, emit } = makeFakeSession();
    const store = new RunStore();
    const credentials = new CredentialStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} />,
    );
    await flushEffects();
    emit({ kind: "delta", text: "partial " });
    emit({ kind: "delta", text: "response" });
    await flushEffects();
    expect(lastFrame() ?? "").toContain("partial response");
  });
});
