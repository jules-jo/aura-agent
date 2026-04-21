import { describe, expect, it, vi } from "vitest";
import type { Tool } from "@github/copilot-sdk";
import type { AssistantEvent, AuraSession, StartSessionOptions } from "../src/session/copilot.js";

vi.mock("@github/copilot-sdk", () => ({
  approveAll: Symbol("approveAll"),
  CopilotClient: class {
    async listModels(): Promise<unknown[]> {
      return [];
    }

    async createSession(): Promise<unknown> {
      throw new Error("test must inject startSession");
    }
  },
}));

const { composeAgentPrompt, CopilotAgentManager } = await import("../src/agents/agent-manager.js");

function makeFakeSession(
  onSend: (prompt: string, emit: (event: AssistantEvent) => void) => Promise<void> | void,
  onClose: () => void,
): AuraSession {
  const listeners = new Set<(event: AssistantEvent) => void>();
  return {
    send: async (prompt) => {
      await onSend(prompt, (event) => {
        for (const listener of listeners) listener(event);
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () => {
      listeners.clear();
      onClose();
    },
    listModels: async () => [],
    getModel: () => "test-model",
    setModel: async () => {
      // no-op
    },
    onModelChange: () => {
      return () => {
        // no-op
      };
    },
  };
}

describe("CopilotAgentManager", () => {
  it("starts a role-scoped sidecar session and returns its response", async () => {
    const fakeTools = [{ name: "catalog_lookup_test" } as Tool<any>];
    const startCalls: StartSessionOptions[] = [];
    const prompts: string[] = [];
    let closed = 0;
    const manager = new CopilotAgentManager({
      model: "claude-opus-4.6",
      logLevel: "none",
      idleTimeoutMs: 123,
      toolsByRole: { batch_planner: fakeTools },
      startSession: async (options) => {
        startCalls.push(options);
        return makeFakeSession(
          async (prompt, emit) => {
            prompts.push(prompt);
            emit({ kind: "final", text: "Ready to run: row 1" });
          },
          () => {
            closed += 1;
          },
        );
      },
    });

    const result = await manager.run({
      role: "batch_planner",
      task: "Plan rows",
      context: "row 1: Test Z, System A",
    });

    expect(result).toEqual({ role: "batch_planner", output: "Ready to run: row 1" });
    expect(startCalls[0]?.model).toBe("claude-opus-4.6");
    expect(startCalls[0]?.logLevel).toBe("none");
    expect(startCalls[0]?.idleTimeoutMs).toBe(123);
    expect(startCalls[0]?.tools).toBe(fakeTools);
    expect(startCalls[0]?.systemMessage?.content).toContain("batch_planner");
    expect(startCalls[0]?.systemMessage?.content).toContain("spreadsheet_read");
    expect(prompts[0]).toContain("Task:\nPlan rows");
    expect(prompts[0]).toContain("Context:\nrow 1: Test Z, System A");
    expect(closed).toBe(1);
  });

  it("returns an agent error when the sidecar emits one without output", async () => {
    const manager = new CopilotAgentManager({
      startSession: async () =>
        makeFakeSession(
          async (_prompt, emit) => {
            emit({ kind: "error", message: "model unavailable" });
          },
          () => {
            // no-op
          },
        ),
    });

    const result = await manager.run({ role: "batch_planner", task: "Plan rows" });

    expect(result).toEqual({
      role: "batch_planner",
      output: "",
      error: "model unavailable",
    });
  });

  it("formats prompts with optional context", () => {
    expect(composeAgentPrompt({ role: "batch_planner", task: "Plan rows" })).toBe(
      ["Role: batch_planner", "", "Task:", "Plan rows"].join("\n"),
    );
  });
});
