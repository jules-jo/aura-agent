import React from "react";
import { Box, Text, useInput } from "ink";
import type { PendingConfirmation } from "../ssh/confirmation-store.js";

interface Props {
  request: PendingConfirmation;
}

export function ConfirmPrompt({ request }: Props): React.ReactElement {
  useInput((input, key) => {
    if (key.return || input === "y" || input === "Y") {
      request.resolve(true);
      return;
    }
    if (key.escape || input === "n" || input === "N") {
      request.resolve(false);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">confirm</Text>
      <Text>{request.summary}</Text>
      <Text color="gray">{request.detail}</Text>
      <Text color="gray">enter/y to approve -- esc/n to decline</Text>
    </Box>
  );
}
