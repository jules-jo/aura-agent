import { describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../src/agents/agent-manager.js";
import { AgentTraceStore } from "../src/agents/agent-trace-store.js";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { agentTools } = await import("../src/tools/agents.js");

function callHandler<T = unknown>(
  tools: ReturnType<typeof agentTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("agent tools", () => {
  it("delegates a task to the requested sidecar agent", async () => {
    const calls: unknown[] = [];
    const manager: AgentManager = {
      run: async (task) => {
        calls.push(task);
        return { role: task.role, output: "ready rows: 1" };
      },
      close: async () => {
        // no-op
      },
    };

    const traces = new AgentTraceStore();
    const tools = agentTools(manager, { traces });
    const result = await callHandler<{ role: string; output: string }>(tools, "agent_delegate", {
      role: "batch_planner",
      task: "plan this spreadsheet",
      context: "row 1: Test Z on System A",
    });

    expect(result).toEqual({ role: "batch_planner", output: "ready rows: 1" });
    expect(calls).toEqual([
      {
        role: "batch_planner",
        task: "plan this spreadsheet",
        context: "row 1: Test Z on System A",
      },
    ]);
    expect(traces.getEvents().map((event) => event.message)).toEqual([
      "I'm delegating to the batch_planner sidecar agent.",
      "batch_planner sidecar agent finished.",
    ]);
  });

  it("records failed sidecar delegation traces", async () => {
    const manager: AgentManager = {
      run: async (task) => ({ role: task.role, output: "", error: "model unavailable" }),
      close: async () => {
        // no-op
      },
    };
    const traces = new AgentTraceStore();
    const tools = agentTools(manager, { traces });

    const result = await callHandler<{ role: string; error: string }>(tools, "agent_delegate", {
      role: "batch_planner",
      task: "plan this spreadsheet",
    });

    expect(result).toEqual({ role: "batch_planner", output: "", error: "model unavailable" });
    expect(traces.getEvents().map((event) => event.message)).toEqual([
      "I'm delegating to the batch_planner sidecar agent.",
      "batch_planner sidecar agent failed: model unavailable",
    ]);
  });
});
