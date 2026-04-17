import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type {
  CopilotClientOptions,
  PermissionHandler,
  SessionEvent,
  SystemMessageConfig,
  Tool,
} from "@github/copilot-sdk";

export interface AssistantDelta {
  kind: "delta";
  text: string;
}

export interface AssistantFinal {
  kind: "final";
  text: string;
}

export interface AssistantError {
  kind: "error";
  message: string;
}

export type AssistantEvent = AssistantDelta | AssistantFinal | AssistantError;

export interface AuraSession {
  send: (prompt: string) => Promise<void>;
  subscribe: (listener: (event: AssistantEvent) => void) => () => void;
  close: () => Promise<void>;
}

export interface StartSessionOptions {
  model?: string;
  logLevel?: CopilotClientOptions["logLevel"];
  tools?: Tool<any>[];
  systemMessage?: SystemMessageConfig;
  onPermissionRequest?: PermissionHandler;
}

const DEFAULT_MODEL = "gpt-4.1";

export async function startSession(options: StartSessionOptions = {}): Promise<AuraSession> {
  const client = new CopilotClient({ logLevel: options.logLevel ?? "none" });
  const session = await client.createSession({
    model: options.model ?? DEFAULT_MODEL,
    onPermissionRequest: options.onPermissionRequest ?? approveAll,
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.systemMessage ? { systemMessage: options.systemMessage } : {}),
  });

  const listeners = new Set<(event: AssistantEvent) => void>();
  const emit = (event: AssistantEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const unsubscribeAll = session.on((event: SessionEvent) => {
    if (event.type === "assistant.message_delta") {
      const text = event.data.deltaContent;
      if (text) emit({ kind: "delta", text });
      return;
    }
    if (event.type === "assistant.message") {
      const text = event.data.content;
      if (text) emit({ kind: "final", text });
    }
  });

  return {
    async send(prompt: string): Promise<void> {
      try {
        await session.sendAndWait({ prompt });
      } catch (err: unknown) {
        emit({ kind: "error", message: toErrorMessage(err) });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      unsubscribeAll();
      listeners.clear();
      try {
        await session.disconnect();
      } catch {
        /* best effort */
      }
      try {
        await client.stop();
      } catch {
        /* best effort */
      }
    },
  };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "unknown error";
}
