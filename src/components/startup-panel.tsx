import React from "react";
import { Box, Text } from "ink";

interface Props {
  modelLabel: string;
  bypassPermissions: boolean;
  agenticMode: boolean;
}

export function StartupPanel({
  modelLabel,
  bypassPermissions,
  agenticMode,
}: Props): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Box>
        <Text bold color="cyan">AURA</Text>
        <Text color="gray"> / agentic test runner</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">model </Text>
        <Text color="cyan">{modelLabel}</Text>
        <Text color="gray">  mode </Text>
        <Text color={agenticMode ? "yellow" : "gray"}>{agenticMode ? "agentic" : "interactive"}</Text>
        <Text color="gray">  permissions </Text>
        <Text color={bypassPermissions ? "red" : "green"}>{bypassPermissions ? "bypass" : "confirm"}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">flow </Text>
        <Text>batch_planner</Text>
        <Text color="gray">{" -> "}</Text>
        <Text>agentic_run_plan</Text>
        <Text color="gray">{" -> "}</Text>
        <Text>log_analyst</Text>
      </Box>
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Capability title="Plan" body="Read spreadsheets and resolve catalog rows." />
        <Capability title="Run" body="Dispatch local or SSH tests with preflight checks." />
        <Capability title="Report" body="Write results, summarize failures, notify Teams." />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">try</Text>
        <Text color="cyan">{"> "}<Text>Read the default spreadsheet, create a batch plan, and run the ready tests.</Text></Text>
        <Text color="cyan">{"> "}<Text>Run Test Z in System A with profile front.</Text></Text>
        <Text color="cyan">{"> "}<Text>/model</Text><Text color="gray"> to inspect or switch models</Text></Text>
      </Box>
    </Box>
  );
}

function Capability({ title, body }: { title: string; body: string }): React.ReactElement {
  return (
    <Box flexDirection="column" width={26}>
      <Text bold color="white">{title}</Text>
      <Text color="gray">{body}</Text>
    </Box>
  );
}
