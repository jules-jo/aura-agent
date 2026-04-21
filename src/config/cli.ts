export interface AuraCliOptions {
  bypassPermissions: boolean;
  help: boolean;
}

const BYPASS_FLAGS = new Set([
  "--bypass",
  "--dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
]);

export function parseAuraCliArgs(argv: readonly string[]): AuraCliOptions {
  const options: AuraCliOptions = {
    bypassPermissions: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (BYPASS_FLAGS.has(arg)) {
      options.bypassPermissions = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

export function formatAuraHelp(): string {
  return [
    "Usage: aura [options]",
    "",
    "Options:",
    "  --bypass                                   Auto-approve side-effect confirmations for this session.",
    "  --dangerously-skip-permissions             Alias for --bypass.",
    "  --dangerously-bypass-approvals-and-sandbox  Alias for --bypass.",
    "  -h, --help                                 Show this help.",
    "",
  ].join("\n");
}
