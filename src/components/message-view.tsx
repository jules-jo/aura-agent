import React from "react";
import { Box, Text } from "ink";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

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

export function MessageView({ message }: { message: ChatMessage }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={ROLE_COLOR[message.role]} bold>
        {ROLE_LABEL[message.role]}
      </Text>
      <Text>{message.text}</Text>
    </Box>
  );
}
