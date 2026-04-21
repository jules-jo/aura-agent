import type { CopilotClientOptions, Tool } from "@github/copilot-sdk";
import type { AssistantEvent, AuraSession, StartSessionOptions } from "../session/copilot.js";
import { startSession as defaultStartSession } from "../session/copilot.js";

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
Use catalog/wiki read tools when available to resolve test names, systems, and
required args. Never run tests, never dispatch SSH/local commands, never write
wiki pages, never create Jira issues, and never send Teams notifications.

Return a concise plan with these sections:
- Ready to run: rows/items that have test, system, and required args.
- Needs user input: exact missing fields and the single question Aura should ask.
- Blocked or ambiguous: unknown tests/systems or conflicting data.
- Suggested next action: what the main Aura agent should do next.`;

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
        return {
          role: task.role,
          output: result.output,
          ...(result.error !== undefined ? { error: result.error } : {}),
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
