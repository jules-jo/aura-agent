import React from "react";
import { Box, Text } from "ink";

export type { ChatMessage, ChatRole } from "./message-view.js";

type Props = {
  historyLength: number;
  pending: string;
  status: "idle" | "thinking" | "error";
  error?: string | undefined;
};

export function ChatPane({
  historyLength,
  pending,
  status,
  error,
}: Props): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1}>
      <Box>
        <Text bold>chat</Text>
      </Box>
      {historyLength === 0 && !pending ? (
        <Text color="gray">Type a prompt below and press Enter.</Text>
      ) : null}
      {pending ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>
            aura
          </Text>
          <Text>{pending}</Text>
        </Box>
      ) : null}
      {status === "thinking" && !pending ? (
        <Box marginTop={1}>
          <Text color="yellow">thinking...</Text>
        </Box>
      ) : null}
      {status === "thinking" && pending ? (
        <Box>
          <Text color="yellow">thinking...</Text>
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
