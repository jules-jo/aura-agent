import { describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../src/agents/agent-manager.js";

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

    const tools = agentTools(manager);
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
  });
});
