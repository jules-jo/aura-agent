import { stringify as stringifyYaml } from "yaml";

export interface InferredDraftArg {
  name: string;
  required: boolean;
  prompt: string;
  flag: string | null;
  aliases: string[];
  kind: "option" | "positional";
  description: string | null;
  choices: string[] | null;
}

export interface DraftTestSpecInput {
  name: string;
  probeCommand: string;
  helpOutput: string;
  pagePath?: string;
  aliases?: string[];
  cwd?: string;
  timeoutMinutes?: number;
}

export interface DraftTestSpecResult {
  page_path: string;
  base_command: string;
  inferred_args: InferredDraftArg[];
  required_args: InferredDraftArg[];
  optional_args: InferredDraftArg[];
  warnings: string[];
  content: string;
}

export function draftTestSpec(input: DraftTestSpecInput): DraftTestSpecResult {
  const baseCommand = stripHelpFlag(input.probeCommand);
  const inferred = inferHelpArguments(baseCommand, input.helpOutput);
  const requiredArgs = inferred.filter((arg) => arg.required);
  const optionalArgs = inferred.filter((arg) => !arg.required);
  const warnings: string[] = [];

  if (requiredArgs.length === 0) {
    warnings.push("No required input arguments were inferred from the help output.");
  }
  if (optionalArgs.length > 0) {
    warnings.push("Optional flags were detected, but only required args are wired into the command template.");
  }

  const pagePath = input.pagePath?.trim() || `pages/tests/${slugify(input.name)}.md`;
  const command = buildCommandTemplate(baseCommand, requiredArgs);
  const today = new Date().toISOString().slice(0, 10);

  const frontmatter: Record<string, unknown> = {
    tags: ["test"],
    name: input.name,
  };
  if (input.aliases && input.aliases.length > 0) {
    frontmatter.aliases = input.aliases.filter((value) => value.trim().length > 0);
  }
  frontmatter.created = today;
  frontmatter.updated = today;
  if (input.cwd?.trim()) frontmatter.cwd = input.cwd.trim();
  frontmatter.command = command;
  frontmatter.timeout_minutes = input.timeoutMinutes ?? 30;
  if (requiredArgs.length > 0) {
    frontmatter.args = requiredArgs.map((arg) => ({
      name: arg.name,
      required: true,
      prompt: arg.prompt,
      ...(arg.aliases.length > 0 ? { aliases: arg.aliases } : {}),
      ...(arg.description ? { description: arg.description } : {}),
      ...(arg.choices ? { choices: arg.choices } : {}),
    }));
  }
  frontmatter.summary = { include_tail_lines: 40 };

  const bodyLines = [
    `# ${input.name}`,
    "",
    `Auto-generated draft from \`${input.probeCommand}\` help output.`,
  ];
  if (requiredArgs.length > 0) {
    bodyLines.push("", "Required inputs inferred:");
    for (const arg of requiredArgs) {
      const source = arg.flag ? `from \`${arg.flag}\`` : "from usage";
      const suffix = arg.description ? `: ${arg.description}` : "";
      bodyLines.push(`- \`${arg.name}\` ${source}${suffix}`);
    }
  }
  if (optionalArgs.length > 0) {
    bodyLines.push("", "Optional inputs detected but not wired into the command template:");
    for (const arg of optionalArgs) {
      const source = arg.flag ? `from \`${arg.flag}\`` : "from usage";
      const suffix = arg.description ? `: ${arg.description}` : "";
      bodyLines.push(`- \`${arg.name}\` ${source}${suffix}`);
    }
  }
  if (warnings.length > 0) {
    bodyLines.push("", "Warnings:");
    for (const warning of warnings) bodyLines.push(`- ${warning}`);
  }

  const yaml = stringifyYaml(frontmatter).trimEnd();
  const content = `---\n${yaml}\n---\n\n${bodyLines.join("\n")}\n`;

  return {
    page_path: pagePath,
    base_command: baseCommand,
    inferred_args: inferred,
    required_args: requiredArgs,
    optional_args: optionalArgs,
    warnings,
    content,
  };
}

export function inferHelpArguments(baseCommand: string, helpOutput: string): InferredDraftArg[] {
  const positionalArgs = parseUsagePositionals(baseCommand, helpOutput);
  const optionArgs = parseOptionArgs(helpOutput);
  return dedupeArgs([...optionArgs, ...positionalArgs]);
}

function parseUsagePositionals(baseCommand: string, helpOutput: string): InferredDraftArg[] {
  const usageLine = helpOutput
    .split(/\r?\n/)
    .find((line) => /^\s*usage:/i.test(line));
  if (!usageLine) return [];

  let rest = usageLine.replace(/^\s*usage:\s*/i, "").trim();
  if (!rest) return [];

  const commandTokenCount = baseCommand.split(/\s+/).filter(Boolean).length;
  const usageTokens = rest.split(/\s+/);
  rest = usageTokens.slice(Math.min(commandTokenCount, usageTokens.length)).join(" ");
  rest = rest.replace(/\[[^\]]+\]/g, " ");
  rest = rest.replace(/--?[A-Za-z0-9][\w-]*(?:[ =]+(?:<[^>]+>|\{[^}]+\}|[A-Za-z0-9_.:-]+))?/g, " ");
  rest = rest.replace(/\.\.\./g, " ");

  const matches = rest.match(/<[^>]+>|[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
  return matches
    .map((token) => token.replace(/^<|>$/g, ""))
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => token.toLowerCase() !== "usage")
    .map<InferredDraftArg>((token) => {
      const name = normalizeArgName(token);
      return {
        name,
        required: true,
        prompt: `What value should I use for ${token}?`,
        flag: null,
        aliases: [],
        kind: "positional",
        description: null,
        choices: null,
      };
    });
}

function parseOptionArgs(helpOutput: string): InferredDraftArg[] {
  const lines = helpOutput.split(/\r?\n/);
  let currentSection: "required" | "optional" | null = null;
  const out: InferredDraftArg[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^required (arguments|options):?$/i.test(trimmed)) {
      currentSection = "required";
      continue;
    }
    if (/^(optional )?(arguments|options):?$/i.test(trimmed)) {
      currentSection = "optional";
      continue;
    }

    if (!/^\s*-/.test(line)) continue;
    const parsed = parseOptionLine(trimmed, currentSection);
    if (parsed) out.push(parsed);
  }

  return out;
}

function parseOptionLine(
  line: string,
  currentSection: "required" | "optional" | null,
): InferredDraftArg | null {
  const [rawFlagsPart, ...descriptionParts] = line.split(/\s{2,}/);
  const flagsPart = rawFlagsPart ?? "";
  const description = descriptionParts.join(" ").trim() || null;
  const parts = flagsPart.split(/,\s*(?=--?[A-Za-z0-9])/);

  let chosenFlag: string | null = null;
  let placeholder: string | null = null;
  let choices: string[] | null = null;
  const flags: string[] = [];

  for (const part of parts) {
    const match = part.match(/^(--?[A-Za-z0-9][\w-]*)(?:[=\s]+(.+))?$/);
    if (!match) continue;
    const flag = match[1] ?? "";
    if (flag === "-h" || flag === "--help") return null;
    flags.push(flag);
    const valueHint = match[2]?.trim() ?? null;
    if (!chosenFlag || flag.startsWith("--")) chosenFlag = flag;
    if (valueHint) {
      placeholder = valueHint;
      choices = parseChoices(valueHint) ?? choices;
    }
  }

  if (!chosenFlag || !placeholder) return null;

  const required = currentSection === "required" || /\brequired\b/i.test(description ?? "");
  const flagName = chosenFlag.replace(/^-+/, "");
  const name = normalizeArgName(shouldUseFlagName(flagName, placeholder) ? flagName : placeholder);
  const aliases = buildOptionAliases(flags, name);

  return {
    name,
    required,
    prompt: `What value should I pass to ${chosenFlag}?`,
    flag: chosenFlag,
    aliases,
    kind: "option",
    description,
    choices,
  };
}

function buildCommandTemplate(baseCommand: string, requiredArgs: readonly InferredDraftArg[]): string {
  const segments = [baseCommand];
  for (const arg of requiredArgs) {
    if (arg.kind === "option" && arg.flag) {
      segments.push(`${arg.flag} {{${arg.name}}}`);
      continue;
    }
    segments.push(`{{${arg.name}}}`);
  }
  return segments.join(" ").trim();
}

function buildOptionAliases(flags: readonly string[], canonicalName: string): string[] {
  const seen = new Set<string>([normalize(canonicalName)]);
  const out: string[] = [];
  for (const flag of flags) {
    const candidates = [flag, flag.replace(/^-+/, "")];
    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      const key = normalize(trimmed);
      if (!trimmed || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

function parseChoices(valueHint: string): string[] | null {
  const match = valueHint.match(/^\{(.+)\}$/);
  if (!match) return null;
  const values = (match[1] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : null;
}

function dedupeArgs(args: readonly InferredDraftArg[]): InferredDraftArg[] {
  const byName = new Map<string, InferredDraftArg>();
  for (const arg of args) {
    const existing = byName.get(arg.name);
    if (!existing) {
      byName.set(arg.name, arg);
      continue;
    }
    byName.set(arg.name, {
      ...existing,
      required: existing.required || arg.required,
      prompt: existing.prompt,
      flag: existing.flag ?? arg.flag,
      aliases: dedupeAliasList([...existing.aliases, ...arg.aliases], existing.name),
      description: existing.description ?? arg.description,
      choices: existing.choices ?? arg.choices,
    });
  }
  return [...byName.values()];
}

function dedupeAliasList(aliases: readonly string[], canonicalName: string): string[] {
  const seen = new Set<string>([normalize(canonicalName)]);
  const out: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    const key = normalize(trimmed);
    if (!trimmed || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function stripHelpFlag(command: string): string {
  return command.trim().replace(/\s+(--help|-h)$/, "").trim();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "generated-test";
}

function normalizeArgName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^--?/, "")
    .replace(/[<>]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "value";
}

function shouldUseFlagName(flagName: string, placeholder: string): boolean {
  const cleanedPlaceholder = placeholder.replace(/^<|>$/g, "");
  return (
    parseChoices(placeholder) !== null ||
    cleanedPlaceholder.length <= 2 ||
    /^[A-Z0-9_:-]+$/.test(cleanedPlaceholder)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
