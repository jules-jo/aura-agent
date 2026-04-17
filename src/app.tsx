import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { ChatPane, type ChatMessage } from "./components/chat-pane.js";
import { RunPane } from "./components/run-pane.js";
import { PromptInput } from "./components/prompt-input.js";
import type { AuraSession } from "./session/copilot.js";
import type { RunStore } from "./runs/run-store.js";

interface Props {
  session: AuraSession;
  runStore: RunStore;
}

type Status = "idle" | "thinking" | "error";

export function App({ session, runStore }: Props): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const nextId = useRef(0);

  const makeId = (): string => {
    const id = `m${nextId.current}`;
    nextId.current += 1;
    return id;
  };

  useEffect(() => {
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === "delta") {
        setPending((prev) => prev + event.text);
        return;
      }
      if (event.kind === "final") {
        setMessages((prev) => [...prev, { id: makeId(), role: "assistant", text: event.text }]);
        setPending("");
        setStatus("idle");
        return;
      }
      if (event.kind === "error") {
        setError(event.message);
        setPending("");
        setStatus("error");
      }
    });
    return () => {
      unsubscribe();
    };
  }, [session]);

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();
      if (!text) return;
      setMessages((prev) => [...prev, { id: makeId(), role: "user", text }]);
      setDraft("");
      setPending("");
      setError(undefined);
      setStatus("thinking");
      void session.send(text);
    },
    [session],
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="magenta">aura</Text>
        <Text color="gray"> -- test-running agent -- ctrl+c to exit</Text>
      </Box>
      <Box flexDirection="row">
        <Box flexDirection="column" width="60%">
          <ChatPane messages={messages} pending={pending} status={status} error={error} />
        </Box>
        <Box flexDirection="column" width="40%">
          <RunPane store={runStore} />
        </Box>
      </Box>
      <PromptInput
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        disabled={status === "thinking"}
      />
    </Box>
  );
}
