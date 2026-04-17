import { CopilotClient, approveAll } from "@github/copilot-sdk";
import type {
  CopilotClientOptions,
  ModelInfo,
  PermissionHandler,
  SessionEvent,
  SystemMessageConfig,
  Tool,
} from "@github/copilot-sdk";
import { friendlyErrorMessage } from "./error-format.js";

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

export interface AuraModelInfo {
  id: string;
  name: string;
}

export interface AuraSession {
  send: (prompt: string) => Promise<void>;
  subscribe: (listener: (event: AssistantEvent) => void) => () => void;
  close: () => Promise<void>;
  listModels: () => Promise<AuraModelInfo[]>;
  getModel: () => string | undefined;
  setModel: (id: string) => Promise<void>;
  onModelChange: (listener: (id: string) => void) => () => void;
}

export interface StartSessionOptions {
  model?: string;
  logLevel?: CopilotClientOptions["logLevel"];
  tools?: Tool<any>[];
  systemMessage?: SystemMessageConfig;
  onPermissionRequest?: PermissionHandler;
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
const PREFERRED_DEFAULT_MODEL = "claude-opus-4.6";

export async function startSession(options: StartSessionOptions = {}): Promise<AuraSession> {
  const client = new CopilotClient({ logLevel: options.logLevel ?? "none" });
  // Resolve a concrete model id before createSession so the header can always
  // display what is active. If the caller did not specify one, pick the first
  // model the server exposes. listModels() triggers the client's auto-connect
  // and the results are cached by the SDK so this is cheap.
  let resolvedModel: string | undefined = options.model;
  if (!resolvedModel) {
    try {
      const models = await client.listModels();
      resolvedModel = pickDefaultModel(models)?.id;
    } catch {
      // Auth or transport error -- fall through and let the SDK pick; header
      // will simply omit the model indicator until the user runs /model.
    }
  }
  const session = await client.createSession({
    onPermissionRequest: options.onPermissionRequest ?? approveAll,
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.systemMessage ? { systemMessage: options.systemMessage } : {}),
  });
  let currentModel: string | undefined = resolvedModel;
  if (resolvedModel) {
    try {
      await session.setModel(resolvedModel);
      currentModel = resolvedModel;
    } catch {
      // Best effort only. Some providers may reject the startup switch even
      // though createSession accepted the model hint.
    }
  }
  try {
    currentModel = (await session.rpc.model.getCurrent()).modelId ?? currentModel;
  } catch {
    // Best effort only. If the SDK cannot report the active model, keep the
    // resolved startup choice (or undefined when the server picked the default).
  }
  const modelListeners = new Set<(id: string) => void>();
  const notifyModel = (id: string): void => {
    for (const l of modelListeners) l(id);
  };

  const listeners = new Set<(event: AssistantEvent) => void>();
  const emit = (event: AssistantEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const unsubscribeAll = session.on((event: SessionEvent) => {
    if (event.type === "session.model_change") {
      currentModel = event.data.newModel;
      notifyModel(event.data.newModel);
      return;
    }
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

  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  return {
    async send(prompt: string): Promise<void> {
      try {
        await session.sendAndWait({ prompt }, idleTimeoutMs);
      } catch (err: unknown) {
        emit({ kind: "error", message: friendlyErrorMessage(err, currentModel) });
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async listModels(): Promise<AuraModelInfo[]> {
      const models: ModelInfo[] = await client.listModels();
      return models.map((m) => ({ id: m.id, name: m.name }));
    },
    getModel(): string | undefined {
      return currentModel;
    },
    async setModel(id: string): Promise<void> {
      await session.setModel(id);
      currentModel = id;
      notifyModel(id);
    },
    onModelChange(listener) {
      modelListeners.add(listener);
      return () => {
        modelListeners.delete(listener);
      };
    },
    async close(): Promise<void> {
      unsubscribeAll();
      listeners.clear();
      modelListeners.clear();
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

function pickDefaultModel(models: readonly ModelInfo[]): ModelInfo | undefined {
  const preferredNeedle = normalizeModelIdentifier(PREFERRED_DEFAULT_MODEL);
  const preferred = models.find((model) => {
    const id = normalizeModelIdentifier(model.id);
    const name = normalizeModelIdentifier(model.name);
    return id === preferredNeedle
      || name === preferredNeedle
      || id.includes(preferredNeedle)
      || name.includes(preferredNeedle);
  });
  return preferred ?? models[0];
}

function normalizeModelIdentifier(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
