import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/app.js";
import type { AuraSession, AssistantEvent, AuraModelInfo } from "../src/session/copilot.js";
import { RunStore } from "../src/runs/run-store.js";
import { CredentialStore } from "../src/ssh/credential-store.js";
import { ConfirmationStore } from "../src/ssh/confirmation-store.js";

async function flushEffects(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

interface FakeSessionOptions {
  models?: AuraModelInfo[];
  initialModel?: string;
  /** If set, send() returns a promise that stays pending until resolve is called. */
  manualSendCompletion?: boolean;
}

function makeFakeSession(options: FakeSessionOptions = {}): {
  session: AuraSession;
  emit: (event: AssistantEvent) => void;
  sentPrompts: string[];
  modelHistory: string[];
  completeNextSend: () => void;
} {
  const listeners = new Set<(event: AssistantEvent) => void>();
  const modelListeners = new Set<(id: string) => void>();
  const sentPrompts: string[] = [];
  const modelHistory: string[] = [];
  const pendingResolvers: Array<() => void> = [];
  let currentModel = options.initialModel;
  const session: AuraSession = {
    send: async (prompt: string) => {
      sentPrompts.push(prompt);
      if (options.manualSendCompletion) {
        await new Promise<void>((resolve) => {
          pendingResolvers.push(resolve);
        });
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      listeners.clear();
      modelListeners.clear();
    },
    listModels: async () => options.models ?? [],
    getModel: () => currentModel,
    setModel: async (id: string) => {
      currentModel = id;
      modelHistory.push(id);
      for (const l of modelListeners) l(id);
    },
    onModelChange: (listener) => {
      modelListeners.add(listener);
      return () => modelListeners.delete(listener);
    },
  };
  return {
    session,
    emit: (event) => listeners.forEach((l) => l(event)),
    sentPrompts,
    modelHistory,
    completeNextSend: () => {
      const next = pendingResolvers.shift();
      if (next) next();
    },
  };
}

describe("App", () => {
  it("renders the two panes and the prompt", () => {
    const { session } = makeFakeSession();
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
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
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
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
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
    );
    await flushEffects();
    emit({ kind: "delta", text: "partial " });
    emit({ kind: "delta", text: "response" });
    await flushEffects();
    expect(lastFrame() ?? "").toContain("partial response");
  });

  it("shows the active model in the header", async () => {
    const { session } = makeFakeSession({ initialModel: "gpt-4.1" });
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
    );
    await flushEffects();
    expect(lastFrame() ?? "").toContain("model: gpt-4.1");
  });

  it("falls back to '(server default)' when the session model is unknown", async () => {
    const { session } = makeFakeSession();
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
    );
    await flushEffects();
    expect(lastFrame() ?? "").toContain("(server default)");
  });

  it("shows a persistent bypass banner when bypass permissions are enabled", async () => {
    const { session } = makeFakeSession();
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore({ bypass: true });
    const { lastFrame } = render(
      <App
        session={session}
        runStore={store}
        credentials={credentials}
        confirmations={confirmations}
        bypassPermissions
      />,
    );
    await flushEffects();
    expect(lastFrame() ?? "").toContain("BYPASS MODE");
    expect(lastFrame() ?? "").toContain("side-effect confirmations are auto-approved");
  });

  it("shows the model display name when the current model id matches the model list", async () => {
    const { session } = makeFakeSession({
      initialModel: "anthropic/claude-opus-4-6",
      models: [{ id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" }],
    });
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
    );
    await flushEffects();
    expect(lastFrame() ?? "").toContain("model: Claude Opus 4.6");
  });

  it("keeps the thinking indicator visible after a final message when send() is still in flight", async () => {
    const { session, emit, completeNextSend } = makeFakeSession({ manualSendCompletion: true });
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore();
    const { lastFrame, stdin } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
    );
    await flushEffects();
    // Simulate the user submitting a prompt.
    stdin.write("hi");
    await flushEffects();
    stdin.write("\r");
    await flushEffects();
    expect(lastFrame() ?? "").toMatch(/thinking/);
    // First intermediate final (between tool calls).
    emit({ kind: "final", text: "let me check that" });
    await flushEffects();
    // The final text appeared but thinking indicator must still be visible
    // because send() has not resolved yet.
    const mid = lastFrame() ?? "";
    expect(mid).toContain("let me check that");
    expect(mid).toMatch(/thinking/);
    // Resolve send(); now the indicator should disappear.
    completeNextSend();
    await flushEffects();
    const after = lastFrame() ?? "";
    expect(after).toContain("let me check that");
    expect(after).not.toMatch(/thinking/);
  });

  it("header updates when setModel is called via onModelChange", async () => {
    const { session } = makeFakeSession({ initialModel: "a" });
    const store = new RunStore();
    const credentials = new CredentialStore();
    const confirmations = new ConfirmationStore();
    const { lastFrame } = render(
      <App session={session} runStore={store} credentials={credentials} confirmations={confirmations} />,
    );
    await flushEffects();
    expect(lastFrame() ?? "").toContain("model: a");
    await session.setModel("b");
    await flushEffects();
    expect(lastFrame() ?? "").toContain("model: b");
  });
});
