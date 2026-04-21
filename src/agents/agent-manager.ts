import type { CopilotClientOptions, Tool } from "@github/copilot-sdk";
import type { AssistantEvent, AuraSession, StartSessionOptions } from "../session/copilot.js";
import { startSession as defaultStartSession } from "../session/copilot.js";
import { parseBatchPlanOutput } from "./batch-plan.js";
import type { BatchPlan } from "./batch-plan.js";

export const agentRoles = ["batch_planner"] as const;
export type AgentRole = (typeof agentRoles)[number];

export interface AgentTask {
  role: AgentRole;
  task: string;
  context?: string;
}

export interface AgentResult {
  role: AgentRole;
  output: string;
  error?: string;
  structured_plan?: BatchPlan;
  structured_plan_error?: string;
}

export interface AgentManager {
  run: (task: AgentTask) => Promise<AgentResult>;
  close: () => Promise<void>;
}

export interface CopilotAgentManagerOptions {
  model?: string;
  logLevel?: CopilotClientOptions["logLevel"];
  idleTimeoutMs?: number;
  toolsByRole?: Partial<Record<AgentRole, Tool<any>[]>>;
  startSession?: (options: StartSessionOptions) => Promise<AuraSession>;
}

const BATCH_PLANNER_SYSTEM_MESSAGE = `You are Aura's batch_planner sidecar agent.

Your job is read-only planning for batch/spreadsheet-driven test execution.
Use spreadsheet_read for CSV/TSV/XLSX inputs, and use catalog/wiki read tools
when available to resolve test names, systems, and required args. Never run
tests, never dispatch SSH/local commands, never write wiki pages, never create
Jira issues, and never send Teams notifications.

Return a concise human-readable plan, then include a fenced JSON block that Aura
can parse. The JSON block must use this shape:
\`\`\`json
{
  "structured_plan": {
    "ready": [
      {
        "row_number": 2,
        "test_name": "Test Z",
        "system_name": "System A",
        "args": { "profile": "front" },
        "notes": "optional"
      }
    ],
    "needs_input": [
      {
        "row_number": 3,
        "test_name": "Test X",
        "system_name": "System A",
        "missing_fields": ["iterations"],
        "question": "What iteration count should I use for row 3?",
        "notes": "optional"
      }
    ],
    "blocked": [
      {
        "row_number": 4,
        "test_name": "Unknown Test",
        "system_name": null,
        "reason": "Test was not found in the catalog",
        "notes": "optional"
      }
    ],
    "suggested_next_action": "Ask for row 3 iterations, then run ready rows."
  }
}
\`\`\`

Use empty arrays when a category has no entries. Keep row_number aligned with
spreadsheet_read's _row_number field when available.`;

export class CopilotAgentManager implements AgentManager {
  private readonly model: string | undefined;
  private readonly logLevel: CopilotClientOptions["logLevel"] | undefined;
  private readonly idleTimeoutMs: number | undefined;
  private readonly toolsByRole: Partial<Record<AgentRole, Tool<any>[]>>;
  private readonly startSession: (options: StartSessionOptions) => Promise<AuraSession>;
  private readonly activeSessions = new Set<AuraSession>();

  constructor(options: CopilotAgentManagerOptions = {}) {
    this.model = options.model;
    this.logLevel = options.logLevel;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.toolsByRole = options.toolsByRole ?? {};
    this.startSession = options.startSession ?? defaultStartSession;
  }

  async run(task: AgentTask): Promise<AgentResult> {
    try {
      const session = await this.startSession({
        ...(this.model !== undefined ? { model: this.model } : {}),
        ...(this.logLevel !== undefined ? { logLevel: this.logLevel } : {}),
        ...(this.idleTimeoutMs !== undefined ? { idleTimeoutMs: this.idleTimeoutMs } : {}),
        tools: this.toolsByRole[task.role] ?? [],
        systemMessage: {
          mode: "append",
          content: systemMessageForRole(task.role),
        },
      });
      this.activeSessions.add(session);
      try {
        const result = await sendAndCollect(session, composeAgentPrompt(task));
        const parsedPlan = task.role === "batch_planner" && result.error === undefined
          ? parseBatchPlanOutput(result.output)
          : undefined;
        return {
          role: task.role,
          output: result.output,
          ...(result.error !== undefined ? { error: result.error } : {}),
          ...(parsedPlan?.structuredPlan !== undefined ? { structured_plan: parsedPlan.structuredPlan } : {}),
          ...(parsedPlan?.error !== undefined ? { structured_plan_error: parsedPlan.error } : {}),
        };
      } finally {
        this.activeSessions.delete(session);
        await session.close();
      }
    } catch (err: unknown) {
      return {
        role: task.role,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.activeSessions].map((session) => session.close()));
    this.activeSessions.clear();
  }
}

export function composeAgentPrompt(task: AgentTask): string {
  const lines = [
    `Role: ${task.role}`,
    "",
    "Task:",
    task.task,
  ];
  if (task.context) {
    lines.push("", "Context:", task.context);
  }
  return lines.join("\n");
}

function systemMessageForRole(role: AgentRole): string {
  if (role === "batch_planner") return BATCH_PLANNER_SYSTEM_MESSAGE;
  return "";
}

async function sendAndCollect(
  session: AuraSession,
  prompt: string,
): Promise<{ output: string; error?: string }> {
  let deltaText = "";
  let finalText = "";
  let error: string | undefined;
  const unsubscribe = session.subscribe((event: AssistantEvent) => {
    if (event.kind === "delta") {
      deltaText += event.text;
      return;
    }
    if (event.kind === "final") {
      finalText = finalText ? `${finalText}\n\n${event.text}` : event.text;
      return;
    }
    error = event.message;
  });
  try {
    await session.send(prompt);
  } finally {
    unsubscribe();
  }
  return {
    output: (finalText || deltaText).trim(),
    ...(error !== undefined ? { error } : {}),
  };
}
