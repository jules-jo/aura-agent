import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import type { AgentManager } from "../agents/agent-manager.js";

const agentDelegateSchema = z.object({
  role: z
    .enum(["batch_planner"])
    .describe("Sidecar agent role. Currently only batch_planner is available."),
  task: z.string().min(1).describe("The bounded planning task to delegate."),
  context: z.string().min(1).optional().describe("Optional relevant user request, rows, or catalog context."),
});

export function agentTools(manager: AgentManager): Tool<any>[] {
  const delegateTool = defineTool("agent_delegate", {
    description:
      "Delegate a bounded read-only planning task to a sidecar Aura agent. Use batch_planner for spreadsheet or batch-test planning. The sidecar does not run tests or make side effects.",
    parameters: agentDelegateSchema,
    handler: async (args) => {
      return manager.run({
        role: args.role,
        task: args.task,
        ...(args.context !== undefined ? { context: args.context } : {}),
      });
    },
  });

  return [delegateTool];
}
