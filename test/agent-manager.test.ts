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
            emit({
              kind: "final",
              text: [
                "Ready to run: row 1",
                "",
                "```json",
                JSON.stringify({
                  structured_plan: {
                    ready: [
                      {
                        row_number: 1,
                        test_name: "Test Z",
                        system_name: "System A",
                        args: { profile: "front" },
                      },
                    ],
                    needs_input: [],
                    blocked: [],
                    suggested_next_action: "Run row 1.",
                  },
                }),
                "```",
              ].join("\n"),
            });
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

    expect(result.role).toBe("batch_planner");
    expect(result.output).toContain("Ready to run: row 1");
    expect(result.structured_plan).toEqual({
      ready: [
        {
          row_number: 1,
          test_name: "Test Z",
          system_name: "System A",
          args: { profile: "front" },
          notes: null,
        },
      ],
      needs_input: [],
      blocked: [],
      suggested_next_action: "Run row 1.",
    });
    expect(startCalls[0]?.model).toBe("claude-opus-4.6");
    expect(startCalls[0]?.logLevel).toBe("none");
    expect(startCalls[0]?.idleTimeoutMs).toBe(123);
    expect(startCalls[0]?.tools).toBe(fakeTools);
    expect(startCalls[0]?.systemMessage?.content).toContain("batch_planner");
    expect(startCalls[0]?.systemMessage?.content).toContain("spreadsheet_read");
    expect(startCalls[0]?.systemMessage?.content).toContain("First read and interpret the spreadsheet");
    expect(startCalls[0]?.systemMessage?.content).not.toContain('"Test Z"');
    expect(prompts[0]).toContain("Task:\nPlan rows");
    expect(prompts[0]).toContain("Context:\nrow 1: Test Z, System A");
    expect(closed).toBe(1);
  });

  it("starts a log analyst sidecar and parses structured analysis", async () => {
    const startCalls: StartSessionOptions[] = [];
    const manager = new CopilotAgentManager({
      startSession: async (options) => {
        startCalls.push(options);
        return makeFakeSession(
          async (_prompt, emit) => {
            emit({
              kind: "final",
              text: [
                "Test Z failed during calibration.",
                "",
                "```json",
                JSON.stringify({
                  structured_analysis: {
                    overall_status: "failed",
                    summary: "Test Z failed during calibration on System A.",
                    rows: [
                      {
                        row_number: 2,
                        test_name: "Test Z",
                        system_name: "System A",
                        status: "failed",
                        summary: "Calibration file was missing.",
                        key_signals: ["phase calibration", "failure: missing calibration.json"],
                        failure_reason: "missing calibration.json",
                        suggested_next_action: "Run Calibration Z, then rerun Test Z.",
                        jira_recommended: true,
                      },
                    ],
                    teams_summary: "Test Z failed on System A: missing calibration.json.",
                  },
                }),
                "```",
              ].join("\n"),
            });
          },
          () => {
            // no-op
          },
        );
      },
    });

    const result = await manager.run({
      role: "log_analyst",
      task: "Summarize this failed run",
      context: JSON.stringify({
        rows: [
          {
            row_number: 2,
            test_name: "Test Z",
            system_name: "System A",
            status: "failed",
            progress: { phase: "calibration" },
            output_tail: ["ERROR: missing calibration.json"],
          },
        ],
      }),
    });

    expect(result.role).toBe("log_analyst");
    expect(result.output).toContain("Test Z failed during calibration.");
    expect(result.structured_analysis).toEqual({
      overall_status: "failed",
      summary: "Test Z failed during calibration on System A.",
      rows: [
        {
          row_number: 2,
          test_name: "Test Z",
          system_name: "System A",
          status: "failed",
          summary: "Calibration file was missing.",
          key_signals: ["phase calibration", "failure: missing calibration.json"],
          failure_reason: "missing calibration.json",
          suggested_next_action: "Run Calibration Z, then rerun Test Z.",
          jira_recommended: true,
        },
      ],
      teams_summary: "Test Z failed on System A: missing calibration.json.",
    });
    expect(startCalls[0]?.tools).toEqual([]);
    expect(startCalls[0]?.systemMessage?.content).toContain("log_analyst");
    expect(startCalls[0]?.systemMessage?.content).toContain("Never run tests");
    expect(startCalls[0]?.systemMessage?.content).toContain("structured_analysis");
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

  it("returns a structured plan error when the sidecar omits machine-readable JSON", async () => {
    const manager = new CopilotAgentManager({
      startSession: async () =>
        makeFakeSession(
          async (_prompt, emit) => {
            emit({ kind: "final", text: "Ready to run: row 1" });
          },
          () => {
            // no-op
          },
        ),
    });

    const result = await manager.run({ role: "batch_planner", task: "Plan rows" });

    expect(result.role).toBe("batch_planner");
    expect(result.output).toBe("Ready to run: row 1");
    expect(result.structured_plan).toBeUndefined();
    expect(result.structured_plan_error).toContain("did not include");
  });

  it("returns a structured analysis error when the log analyst omits machine-readable JSON", async () => {
    const manager = new CopilotAgentManager({
      startSession: async () =>
        makeFakeSession(
          async (_prompt, emit) => {
            emit({ kind: "final", text: "Test Z failed during calibration." });
          },
          () => {
            // no-op
          },
        ),
    });

    const result = await manager.run({ role: "log_analyst", task: "Summarize run" });

    expect(result.role).toBe("log_analyst");
    expect(result.output).toBe("Test Z failed during calibration.");
    expect(result.structured_analysis).toBeUndefined();
    expect(result.structured_analysis_error).toContain("did not include");
  });

  it("formats prompts with optional context", () => {
    expect(composeAgentPrompt({ role: "batch_planner", task: "Plan rows" })).toBe(
      ["Role: batch_planner", "", "Task:", "Plan rows"].join("\n"),
    );
  });
});
