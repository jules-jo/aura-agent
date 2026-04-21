import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import type { AgentManager } from "../agents/agent-manager.js";
import type { AgentTraceStore } from "../agents/agent-trace-store.js";

const agentDelegateSchema = z.object({
  role: z
    .enum(["batch_planner", "log_analyst"])
    .describe("Sidecar agent role. Use batch_planner for spreadsheet planning and log_analyst for test result interpretation."),
  task: z.string().min(1).describe("The bounded planning task to delegate."),
  context: z.string().min(1).optional().describe("Optional relevant user request, rows, or catalog context."),
});

export interface AgentToolsOptions {
  traces?: AgentTraceStore;
}

export function agentTools(manager: AgentManager, options: AgentToolsOptions = {}): Tool<any>[] {
  const delegateTool = defineTool("agent_delegate", {
    description:
      "Delegate a bounded read-only task to a sidecar Aura agent. Use batch_planner for spreadsheet/batch-test planning and log_analyst for test result summaries. Sidecars do not run tests or make side effects.",
    parameters: agentDelegateSchema,
    handler: async (args) => {
      options.traces?.record({ role: args.role, status: "started" });
      try {
        const result = await manager.run({
          role: args.role,
          task: args.task,
          ...(args.context !== undefined ? { context: args.context } : {}),
        });
        if (result.error) {
          options.traces?.record({ role: args.role, status: "failed", detail: result.error });
        } else {
          options.traces?.record({ role: args.role, status: "finished" });
        }
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        options.traces?.record({ role: args.role, status: "failed", detail: message });
        return {
          role: args.role,
          output: "",
          error: message,
        };
      }
    },
  });

  return [delegateTool];
}
