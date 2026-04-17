import React from "react";
import { Box, Text } from "ink";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

type Props = {
  messages: readonly ChatMessage[];
  pending: string;
  status: "idle" | "thinking" | "error";
  error?: string | undefined;
  thinkingTick?: number;
};

const ROLE_LABEL: Record<ChatRole, string> = {
  user: "you",
  assistant: "aura",
  system: "sys",
};

const ROLE_COLOR: Record<ChatRole, string> = {
  user: "cyan",
  assistant: "green",
  system: "gray",
};

export function ChatPane({
  messages,
  pending,
  status,
  error,
  thinkingTick = 0,
}: Props): React.ReactElement {
  const dots = ".".repeat((thinkingTick % 3) + 1);
  const elapsedSeconds = Math.floor((thinkingTick * 500) / 1000);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1}>
      <Box>
        <Text bold>chat</Text>
      </Box>
      {messages.length === 0 && !pending ? (
        <Text color="gray">Type a prompt below and press Enter.</Text>
      ) : null}
      {messages.map((m) => (
        <Box key={m.id} flexDirection="column" marginTop={1}>
          <Text color={ROLE_COLOR[m.role]} bold>
            {ROLE_LABEL[m.role]}
          </Text>
          <Text>{m.text}</Text>
        </Box>
      ))}
      {pending ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={ROLE_COLOR.assistant} bold>
            {ROLE_LABEL.assistant}
          </Text>
          <Text>{pending}</Text>
        </Box>
      ) : null}
      {status === "thinking" && !pending ? (
        <Box marginTop={1}>
          <Text color="yellow">thinking{dots}</Text>
          {elapsedSeconds >= 2 ? <Text color="gray"> ({elapsedSeconds}s)</Text> : null}
        </Box>
      ) : null}
      {status === "thinking" && pending ? (
        <Box>
          <Text color="yellow">{dots}</Text>
        </Box>
      ) : null}
      {status === "error" && error ? (
        <Box marginTop={1}>
          <Text color="red">error: {error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
