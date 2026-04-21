export type AgentTraceStatus = "started" | "finished" | "failed";

export interface AgentTraceEvent {
  id: string;
  role: string;
  status: AgentTraceStatus;
  message: string;
  at: string;
}

export interface AgentTraceInput {
  role: string;
  status: AgentTraceStatus;
  detail?: string;
}

type Listener = (events: readonly AgentTraceEvent[]) => void;

export class AgentTraceStore {
  private readonly events: AgentTraceEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private snapshot: readonly AgentTraceEvent[] = [];
  private nextId = 0;

  getEvents = (): readonly AgentTraceEvent[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  record(input: AgentTraceInput): AgentTraceEvent {
    const event: AgentTraceEvent = {
      id: `agent-${this.nextId++}`,
      role: input.role,
      status: input.status,
      message: formatAgentTraceMessage(input),
      at: new Date().toISOString(),
    };
    this.events.push(event);
    this.commit();
    return event;
  }

  private commit(): void {
    this.snapshot = this.events.slice();
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function formatAgentTraceMessage(input: AgentTraceInput): string {
  if (input.status === "started") {
    return `I'm delegating to the ${input.role} sidecar agent.`;
  }
  if (input.status === "finished") {
    return `${input.role} sidecar agent finished.`;
  }
  return input.detail
    ? `${input.role} sidecar agent failed: ${input.detail}`
    : `${input.role} sidecar agent failed.`;
}
