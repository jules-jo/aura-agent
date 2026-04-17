import React, { useSyncExternalStore } from "react";
import { Box, Text } from "ink";
import type { RunStore } from "../runs/run-store.js";
import type { Run, RunStatus } from "../runs/run-types.js";

interface Props {
  store: RunStore;
}

const STATUS_COLOR: Record<RunStatus, string> = {
  running: "yellow",
  completed: "green",
  failed: "red",
};

const TAIL_LINES = 8;

export function RunPane({ store }: Props): React.ReactElement {
  const run = useSyncExternalStore(
    (onChange) => store.subscribe(() => onChange()),
    () => store.getActive(),
    () => store.getActive(),
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1}>
      <Box>
        <Text bold>run</Text>
        {run ? (
          <>
            <Text color="gray"> -- </Text>
            <Text color={STATUS_COLOR[run.status]}>{run.status}</Text>
          </>
        ) : null}
      </Box>
      {!run ? (
        <Box marginTop={1}>
          <Text color="gray">No runs yet. Live test progress will appear here.</Text>
        </Box>
      ) : (
        <RunBody run={run} />
      )}
    </Box>
  );
}

function RunBody({ run }: { run: Run }): React.ReactElement {
  const duration = computeDuration(run);
  const tail = flattenTail(run);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan">$ {run.command}</Text>
      <Text color="gray">cwd: {run.cwd}</Text>
      <Text color="gray">
        iterations: {run.iterations.length}  lines: {run.totalLines}
        {duration !== null ? `  duration: ${duration.toFixed(1)}s` : ""}
        {run.exitCode !== undefined ? `  exit: ${run.exitCode}` : ""}
      </Text>
      {run.error ? <Text color="red">error: {run.error}</Text> : null}
      {tail.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">tail:</Text>
          {tail.map((line, idx) => (
            <Text key={`${run.id}-tail-${idx}`}>{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function computeDuration(run: Run): number | null {
  const end = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  const start = Date.parse(run.startedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 1000);
}

function flattenTail(run: Run): string[] {
  const all: string[] = [];
  for (const it of run.iterations) all.push(...it.lines);
  if (all.length <= TAIL_LINES) return all;
  return all.slice(all.length - TAIL_LINES);
}
