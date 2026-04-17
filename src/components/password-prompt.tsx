import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PendingPrompt } from "../ssh/credential-store.js";

interface Props {
  request: PendingPrompt;
}

export function PasswordPrompt({ request }: Props): React.ReactElement {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      const entered = value;
      setValue("");
      request.resolve(entered);
      return;
    }
    if (key.escape) {
      setValue("");
      request.reject(new Error("password_prompt_cancelled"));
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  const mask = "*".repeat(value.length);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">password required</Text>
      <Text color="gray">
        {request.username}@{request.host} (credential_id: {request.credentialId})
      </Text>
      <Box marginTop={1}>
        <Text color="yellow">password: </Text>
        <Text>{mask}</Text>
        <Text color="gray">_</Text>
      </Box>
      <Text color="gray">enter to submit -- esc to cancel</Text>
    </Box>
  );
}
