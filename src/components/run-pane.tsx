import React from "react";
import { Box, Text } from "ink";

export function RunPane(): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexGrow={1}>
      <Box>
        <Text bold>run</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">No runs yet. Live test progress will appear here.</Text>
      </Box>
    </Box>
  );
}
