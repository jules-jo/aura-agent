import { z } from "zod";
import type { WikiPage } from "./pages.js";

export interface CatalogMatchSummary {
  page_path: string;
  name: string;
  aliases: string[];
  slug: string;
}

export interface CatalogArgSpec {
  name: string;
  required: boolean;
  prompt: string;
  choices: string[] | null;
  default: string | null;
}

export interface CatalogMissingArg {
  name: string;
  required: boolean;
  prompt: string;
  choices: string[] | null;
  default: string | null;
}

export interface CatalogInvalidArg {
  name: string;
  value: string;
  reason: string;
  choices: string[] | null;
}

export interface CatalogLookup {
  score: number;
  match_type: "name" | "alias" | "slug" | "fuzzy";
  page_path: string;
  slug: string;
  title: string | null;
  name: string;
  aliases: string[];
  host: string | null;
  username: string | null;
  credential_id: string | null;
  cwd: string | null;
  command: string | null;
  host_template: string | null;
  username_template: string | null;
  credential_id_template: string | null;
  cwd_template: string | null;
  command_template: string;
  timeout_minutes: number | null;
  env: Record<string, string> | null;
  env_template: Record<string, string> | null;
  args: CatalogArgSpec[];
  arg_values: Record<string, string>;
  missing_args: CatalogMissingArg[];
  invalid_args: CatalogInvalidArg[];
  ready_to_dispatch: boolean;
  framework: string | null;
  pass_pattern: string | null;
  fail_pattern: string | null;
  summary: Record<string, unknown> | null;
  execution_target: "local" | "ssh";
  required_fields: string[];
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface CatalogSearchResult {
  result: CatalogLookup | null;
  error?: "not_found" | "ambiguous" | "invalid_spec";
  candidates?: CatalogMatchSummary[];
  page_path?: string;
  validation_errors?: string[];
}

export interface CatalogLookupOptions {
  providedArgs?: Record<string, string>;
}

const catalogArgSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().optional().default(false),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).optional(),
  default: z.string().min(1).optional(),
});

const catalogSummarySchema = z.object({
  template: z.string().min(1).optional(),
  include_tail_lines: z.number().int().positive().optional(),
}).passthrough();

const catalogFrontmatterSchema = z.object({
  tags: z.array(z.string().min(1)).optional(),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional().default([]),
  host: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  credential_id: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  command: z.string().min(1),
  timeout_minutes: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  args: z.array(catalogArgSchema).optional().default([]),
  framework: z.string().min(1).optional(),
  pass_pattern: z.string().min(1).optional(),
  fail_pattern: z.string().min(1).optional(),
  summary: catalogSummarySchema.optional(),
  errors: z.unknown().optional(),
}).passthrough().superRefine((value, ctx) => {
  const target = classifyTarget(value.host ?? null);
  if (target === "ssh" && !value.username) {
    ctx.addIssue({
      code: "custom",
      path: ["username"],
      message: "username is required for SSH targets",
    });
  }
  const seen = new Set<string>();
  for (const arg of value.args) {
    const key = normalize(arg.name);
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["args"],
        message: `duplicate arg name '${arg.name}'`,
      });
    }
    seen.add(key);
    if (arg.choices && arg.default && !arg.choices.includes(arg.default)) {
      ctx.addIssue({
        code: "custom",
        path: ["args"],
        message: `default for '${arg.name}' must be one of its choices`,
      });
    }
  }
});

type CatalogFrontmatter = z.infer<typeof catalogFrontmatterSchema>;

interface ScoredPage {
  page: WikiPage;
  score: number;
  matchType: CatalogLookup["match_type"];
}

export function lookupTestPage(
  pages: readonly WikiPage[],
  query: string,
  options: CatalogLookupOptions = {},
): CatalogSearchResult {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return { result: null, error: "not_found", candidates: [] };
  }

  const scored = pages
    .map((page) => {
      const match = scorePage(page, normalizedQuery);
      if (!match) return null;
      return { page, score: match.score, matchType: match.matchType };
    })
    .filter((value): value is ScoredPage => value !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return displayName(a.page).localeCompare(displayName(b.page));
    });

  if (scored.length === 0) return { result: null, error: "not_found", candidates: [] };

  const [best, second] = scored;
  if (best && second && best.score === second.score) {
    return {
      result: null,
      error: "ambiguous",
      candidates: scored
        .filter((candidate) => candidate.score === best.score)
        .slice(0, 5)
        .map((candidate) => toMatchSummary(candidate.page)),
    };
  }

  if (!best) return { result: null, error: "not_found", candidates: [] };

  const validated = catalogFrontmatterSchema.safeParse(best.page.frontmatter);
  if (!validated.success) {
    return {
      result: null,
      error: "invalid_spec",
      page_path: best.page.path,
      validation_errors: validated.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      ),
    };
  }

  return { result: toLookup(best.page, validated.data, best.score, best.matchType, options) };
}

function toLookup(
  page: WikiPage,
  frontmatter: CatalogFrontmatter,
  score: number,
  matchType: CatalogLookup["match_type"],
  options: CatalogLookupOptions,
): CatalogLookup {
  const args = normalizeArgSpecs(frontmatter.args);
  const providedArgs = normalizeProvidedArgs(options.providedArgs);
  const { argValues, missingArgs, invalidArgs } = resolveArgs(args, providedArgs);

  const commandResolution = resolveTemplate(frontmatter.command, argValues);
  const hostResolution = resolveNullableTemplate(frontmatter.host, argValues);
  const usernameResolution = resolveNullableTemplate(frontmatter.username, argValues);
  const credentialIdResolution = resolveNullableTemplate(frontmatter.credential_id, argValues);
  const cwdResolution = resolveNullableTemplate(frontmatter.cwd, argValues);
  const envResolution = resolveStringRecordTemplate(frontmatter.env, argValues);

  const unresolvedArgNames = new Set<string>([
    ...commandResolution.unresolved,
    ...hostResolution.unresolved,
    ...usernameResolution.unresolved,
    ...credentialIdResolution.unresolved,
    ...cwdResolution.unresolved,
    ...envResolution.unresolved,
  ]);
  const allMissingArgs = addTemplateDrivenMissingArgs(args, missingArgs, unresolvedArgNames);
  const executionTarget = classifyTarget(hostResolution.value ?? frontmatter.host ?? null);

  const requiredFields: string[] = [];
  if (!commandResolution.value) requiredFields.push("command");
  if (executionTarget === "ssh") {
    if (!hostResolution.value) requiredFields.push("host");
    if (!usernameResolution.value) requiredFields.push("username");
  }
  const readyToDispatch = allMissingArgs.length === 0 && invalidArgs.length === 0 && requiredFields.length === 0;

  return {
    score,
    match_type: matchType,
    page_path: page.path,
    slug: page.slug,
    title: page.title,
    name: frontmatter.name,
    aliases: frontmatter.aliases,
    host: hostResolution.value,
    username: usernameResolution.value,
    credential_id: credentialIdResolution.value,
    cwd: cwdResolution.value,
    command: readyToDispatch ? commandResolution.value : null,
    host_template: frontmatter.host ?? null,
    username_template: frontmatter.username ?? null,
    credential_id_template: frontmatter.credential_id ?? null,
    cwd_template: frontmatter.cwd ?? null,
    command_template: frontmatter.command,
    timeout_minutes: frontmatter.timeout_minutes ?? null,
    env: readyToDispatch ? envResolution.value : null,
    env_template: frontmatter.env ?? null,
    args,
    arg_values: argValues,
    missing_args: allMissingArgs,
    invalid_args: invalidArgs,
    ready_to_dispatch: readyToDispatch,
    framework: frontmatter.framework ?? null,
    pass_pattern: frontmatter.pass_pattern ?? null,
    fail_pattern: frontmatter.fail_pattern ?? null,
    summary: frontmatter.summary ?? null,
    execution_target: executionTarget,
    required_fields: requiredFields,
    frontmatter: page.frontmatter,
    body: page.body,
  };
}

function scorePage(
  page: WikiPage,
  normalizedQuery: string,
): { score: number; matchType: CatalogLookup["match_type"] } | null {
  const name = normalize(readString(page.frontmatter.name) ?? page.title ?? page.slug);
  const aliases = readStringArray(page.frontmatter.aliases).map(normalize);
  const slug = normalize(page.slug.replace(/-/g, " "));

  if (name === normalizedQuery) return { score: 400, matchType: "name" };
  if (aliases.includes(normalizedQuery)) return { score: 350, matchType: "alias" };
  if (slug === normalizedQuery) return { score: 300, matchType: "slug" };

  const pool = [name, slug, ...aliases];
  let best = 0;
  for (const candidate of pool) {
    const score = fuzzyScore(normalizedQuery, candidate);
    if (score > best) best = score;
  }
  if (best === 0) return null;
  return { score: best, matchType: "fuzzy" };
}

function toMatchSummary(page: WikiPage): CatalogMatchSummary {
  return {
    page_path: page.path,
    name: displayName(page),
    aliases: readStringArray(page.frontmatter.aliases),
    slug: page.slug,
  };
}

function displayName(page: WikiPage): string {
  return readString(page.frontmatter.name) ?? page.title ?? page.slug;
}

function fuzzyScore(query: string, candidate: string): number {
  if (!candidate) return 0;
  if (candidate.includes(query)) return 140 - Math.max(0, candidate.length - query.length);
  if (query.includes(candidate)) return 90 - Math.max(0, query.length - candidate.length);
  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => candidate.includes(token))) {
    return 80 - Math.max(0, candidate.length - query.length);
  }
  return 0;
}

function classifyTarget(host: string | null): "local" | "ssh" {
  if (!host) return "local";
  const normalized = normalize(host.replace(/{{.*?}}/g, "").trim());
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "local"
    ? "local"
    : "ssh";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeArgSpecs(args: CatalogFrontmatter["args"]): CatalogArgSpec[] {
  return args.map((arg) => ({
    name: arg.name,
    required: arg.required,
    prompt: arg.prompt,
    choices: arg.choices ?? null,
    default: arg.default ?? null,
  }));
}

function normalizeProvidedArgs(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalize(key);
    const trimmedValue = value.trim();
    if (!normalizedKey || !trimmedValue) continue;
    out[normalizedKey] = trimmedValue;
  }
  return out;
}

function resolveArgs(args: readonly CatalogArgSpec[], providedArgs: Record<string, string>): {
  argValues: Record<string, string>;
  missingArgs: CatalogMissingArg[];
  invalidArgs: CatalogInvalidArg[];
} {
  const argValues: Record<string, string> = {};
  const missingArgs: CatalogMissingArg[] = [];
  const invalidArgs: CatalogInvalidArg[] = [];

  for (const arg of args) {
    const key = normalize(arg.name);
    const chosenValue = providedArgs[key] ?? arg.default ?? undefined;
    if (!chosenValue) {
      if (arg.required) missingArgs.push(toMissingArg(arg));
      continue;
    }
    if (arg.choices && !arg.choices.includes(chosenValue)) {
      invalidArgs.push({
        name: arg.name,
        value: chosenValue,
        reason: `must be one of: ${arg.choices.join(", ")}`,
        choices: arg.choices,
      });
      continue;
    }
    argValues[key] = chosenValue;
  }

  return { argValues, missingArgs, invalidArgs };
}

function addTemplateDrivenMissingArgs(
  args: readonly CatalogArgSpec[],
  missingArgs: readonly CatalogMissingArg[],
  unresolvedArgNames: Set<string>,
): CatalogMissingArg[] {
  const byName = new Map(missingArgs.map((arg) => [normalize(arg.name), arg]));
  for (const unresolvedName of unresolvedArgNames) {
    if (byName.has(unresolvedName)) continue;
    const spec = args.find((arg) => normalize(arg.name) === unresolvedName);
    if (spec) {
      byName.set(unresolvedName, toMissingArg(spec));
      continue;
    }
    byName.set(unresolvedName, {
      name: unresolvedName,
      required: true,
      prompt: `Provide a value for '${unresolvedName}'.`,
      choices: null,
      default: null,
    });
  }
  return [...byName.values()];
}

function toMissingArg(arg: CatalogArgSpec): CatalogMissingArg {
  return {
    name: arg.name,
    required: arg.required,
    prompt: arg.prompt,
    choices: arg.choices,
    default: arg.default,
  };
}

function resolveNullableTemplate(
  template: string | undefined,
  values: Record<string, string>,
): { value: string | null; unresolved: string[] } {
  if (!template) return { value: null, unresolved: [] };
  return resolveTemplate(template, values);
}

function resolveTemplate(
  template: string,
  values: Record<string, string>,
): { value: string | null; unresolved: string[] } {
  const unresolved = new Set<string>();
  const resolved = template.replace(/{{\s*([A-Za-z0-9_-]+)\s*}}/g, (match, key: string) => {
    const replacement = values[normalize(key)];
    if (replacement === undefined) {
      unresolved.add(normalize(key));
      return match;
    }
    return replacement;
  });
  return {
    value: unresolved.size > 0 ? null : resolved,
    unresolved: [...unresolved],
  };
}

function resolveStringRecordTemplate(
  input: Record<string, string> | undefined,
  values: Record<string, string>,
): { value: Record<string, string> | null; unresolved: string[] } {
  if (!input) return { value: null, unresolved: [] };
  const out: Record<string, string> = {};
  const unresolved = new Set<string>();
  for (const [key, template] of Object.entries(input)) {
    const resolved = resolveTemplate(template, values);
    if (resolved.value === null) {
      for (const name of resolved.unresolved) unresolved.add(name);
      continue;
    }
    out[key] = resolved.value;
  }
  return {
    value: unresolved.size > 0 ? null : out,
    unresolved: [...unresolved],
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
