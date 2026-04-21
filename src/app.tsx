import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Box, Text, Static } from "ink";
import { ChatPane } from "./components/chat-pane.js";
import { MessageView, type ChatMessage } from "./components/message-view.js";
import { RunPane } from "./components/run-pane.js";
import { PromptInput } from "./components/prompt-input.js";
import { PasswordPrompt } from "./components/password-prompt.js";
import { ConfirmPrompt } from "./components/confirm-prompt.js";
import type { AuraSession, AuraModelInfo } from "./session/copilot.js";
import type { RunStore } from "./runs/run-store.js";
import type { AgentTraceEvent, AgentTraceStore } from "./agents/agent-trace-store.js";
import type { CredentialStore, PendingPrompt } from "./ssh/credential-store.js";
import type { ConfirmationStore, PendingConfirmation } from "./ssh/confirmation-store.js";

interface Props {
  session: AuraSession;
  runStore: RunStore;
  credentials: CredentialStore;
  confirmations: ConfirmationStore;
  agentTraces?: AgentTraceStore;
  bypassPermissions?: boolean;
  agenticMode?: boolean;
}

type Status = "idle" | "thinking" | "error";

export function App({
  session,
  runStore,
  credentials,
  confirmations,
  agentTraces,
  bypassPermissions = false,
  agenticMode = false,
}: Props): React.ReactElement {
  const pendingPrompts = useSyncExternalStore<readonly PendingPrompt[]>(
    credentials.subscribe,
    credentials.getPending,
    credentials.getPending,
  );
  const pendingConfirmations = useSyncExternalStore<readonly PendingConfirmation[]>(
    confirmations.subscribe,
    confirmations.getPending,
    confirmations.getPending,
  );
  const agentTraceEvents = useSyncExternalStore<readonly AgentTraceEvent[]>(
    agentTraces?.subscribe ?? noopSubscribe,
    agentTraces?.getEvents ?? getEmptyAgentTraces,
    agentTraces?.getEvents ?? getEmptyAgentTraces,
  );
  const activeConfirmation = pendingConfirmations[0];
  const activePrompt = pendingPrompts[0];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [currentModel, setCurrentModel] = useState<string | undefined>(() => session.getModel());
  const [availableModels, setAvailableModels] = useState<AuraModelInfo[] | null>(null);
  const nextId = useRef(0);
  const nextTraceIndex = useRef(0);

  const makeId = (): string => {
    const id = `m${nextId.current}`;
    nextId.current += 1;
    return id;
  };

  const pushSystem = useCallback((text: string): void => {
    setMessages((prev) => [
      ...prev,
      { id: `s${nextId.current++}`, role: "assistant", text },
    ]);
  }, []);

  useEffect(() => {
    const newEvents = agentTraceEvents.slice(nextTraceIndex.current);
    nextTraceIndex.current = agentTraceEvents.length;
    if (newEvents.length === 0) return;
    setMessages((prev) => [
      ...prev,
      ...newEvents.map((event) => ({
        id: event.id,
        role: "assistant" as const,
        text: event.message,
      })),
    ]);
  }, [agentTraceEvents]);

  useEffect(() => {
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === "delta") {
        setPending((prev) => prev + event.text);
        return;
      }
      if (event.kind === "final") {
        setMessages((prev) => [...prev, { id: makeId(), role: "assistant", text: event.text }]);
        setPending("");
        // Do NOT flip to idle here. A single turn can emit multiple final
        // messages interleaved with tool calls; the indicator must stay
        // visible until session.send() resolves (see handleSubmit).
        return;
      }
      if (event.kind === "error") {
        setError(event.message);
        setPending("");
        setStatus("error");
      }
    });
    const unsubscribeModel = session.onModelChange((id) => {
      setCurrentModel(id);
    });
    return () => {
      unsubscribe();
      unsubscribeModel();
    };
  }, [session]);

  const fetchModels = useCallback(async (): Promise<AuraModelInfo[]> => {
    if (availableModels) return availableModels;
    const list = await session.listModels();
    setAvailableModels(list);
    return list;
  }, [availableModels, session]);

  useEffect(() => {
    void fetchModels().catch(() => {
      // Best effort only. The header can still fall back to the raw model id.
    });
  }, [fetchModels]);

  const handleModelCommand = useCallback(
    async (rawArg: string): Promise<void> => {
      const arg = rawArg.trim();
      try {
        const list = await fetchModels();
        if (!arg) {
          const active = formatModelLabel(session.getModel(), list);
          const lines = [
            `active model: ${active}`,
            "available models:",
            ...list.map((m) => `  - ${m.id}  (${m.name})`),
            "switch with: /model <id>",
          ];
          pushSystem(lines.join("\n"));
          return;
        }
        const match = list.find((m) => m.id === arg || m.name === arg);
        if (!match) {
          pushSystem(`unknown model '${arg}'. type /model to see available ids.`);
          return;
        }
        await session.setModel(match.id);
        pushSystem(`model switched to ${match.id} (${match.name}).`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        pushSystem(`model command failed: ${msg}`);
      }
    },
    [fetchModels, pushSystem, session],
  );

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();
      if (!text) return;
      setMessages((prev) => [...prev, { id: makeId(), role: "user", text }]);
      setDraft("");
      setPending("");
      setError(undefined);
      const slash = parseSlashCommand(text);
      if (slash?.name === "model" || slash?.name === "models") {
        void handleModelCommand(slash.rest);
        return;
      }
      setStatus("thinking");
      void session.send(text).then(() => {
        setStatus((prev) => (prev === "error" ? prev : "idle"));
      });
    },
    [handleModelCommand, session],
  );

  return (
    <Box flexDirection="column">
      <Static items={messages}>
        {(m) => <MessageView key={m.id} message={m} />}
      </Static>
      <Box>
        <Text bold color="magenta">aura</Text>
        <Text color="gray"> -- test-running agent -- ctrl+c to exit</Text>
        <Text color="gray"> -- model: </Text>
        <Text color="cyan">{formatModelLabel(currentModel, availableModels)}</Text>
        <Text color="gray"> (/model to switch)</Text>
      </Box>
      {bypassPermissions ? (
        <Box>
          <Text bold color="red">BYPASS MODE: side-effect confirmations are auto-approved.</Text>
        </Box>
      ) : null}
      {agenticMode ? (
        <Box>
          <Text bold color="yellow">
            AGENTIC MODE: complete spreadsheet rows can run without per-test approval.
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="row">
        <Box flexDirection="column" width="60%">
          <ChatPane
            historyLength={messages.length}
            pending={pending}
            status={status}
            error={error}
          />
        </Box>
        <Box flexDirection="column" width="40%">
          <RunPane store={runStore} />
        </Box>
      </Box>
      {activeConfirmation ? (
        <ConfirmPrompt request={activeConfirmation} />
      ) : activePrompt ? (
        <PasswordPrompt request={activePrompt} />
      ) : (
        <PromptInput
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          disabled={status === "thinking"}
        />
      )}
    </Box>
  );
}

interface SlashCommand {
  name: string;
  rest: string;
}

function parseSlashCommand(text: string): SlashCommand | null {
  if (!text.startsWith("/")) return null;
  const trimmed = text.slice(1);
  const space = trimmed.indexOf(" ");
  if (space === -1) return { name: trimmed.toLowerCase(), rest: "" };
  return { name: trimmed.slice(0, space).toLowerCase(), rest: trimmed.slice(space + 1) };
}

function formatModelLabel(currentModel: string | undefined, models: AuraModelInfo[] | null): string {
  if (!currentModel) return "(server default)";
  const match = models?.find((model) => model.id === currentModel);
  return match?.name ?? currentModel;
}

const EMPTY_AGENT_TRACES: readonly AgentTraceEvent[] = [];

function noopSubscribe(): () => void {
  return () => {
    // no-op
  };
}

function getEmptyAgentTraces(): readonly AgentTraceEvent[] {
  return EMPTY_AGENT_TRACES;
}
