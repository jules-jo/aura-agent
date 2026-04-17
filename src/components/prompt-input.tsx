import React from "react";
import { Box, Text, useInput } from "ink";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
};

export function PromptInput({ value, onChange, onSubmit, disabled }: Props): React.ReactElement {
  useInput((input, key) => {
    if (disabled) return;
    if (key.return) {
      if (value.trim().length > 0) onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.escape) return;
    if (input) onChange(value + input);
  });

  return (
    <Box borderStyle="round" borderColor={disabled ? "gray" : "cyan"} paddingX={1}>
      <Text color="cyan">{"> "}</Text>
      <Text>{value}</Text>
      {!disabled ? <Text color="cyan">_</Text> : null}
    </Box>
  );
}
