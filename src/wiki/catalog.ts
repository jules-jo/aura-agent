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
  aliases: string[];
  description: string | null;
  choices: string[] | null;
  default: string | null;
}

export interface CatalogMissingArg {
  name: string;
  required: boolean;
  prompt: string;
  aliases: string[];
  description: string | null;
  choices: string[] | null;
  default: string | null;
}

export interface CatalogInvalidArg {
  name: string;
  value: string;
  reason: string;
  aliases: string[];
  description: string | null;
  choices: string[] | null;
}

export interface CatalogPreflightCheck {
  kind: "file_exists";
  path: string | null;
  path_template: string;
}

export interface CatalogPreflightAction {
  ask: string;
  run_test: string;
}

export interface CatalogPreflightStep {
  name: string;
  check: CatalogPreflightCheck;
  if_exists: CatalogPreflightAction;
  if_missing: CatalogPreflightAction;
  before_test_ask: string | null;
}

export interface TestLookup {
  score: number;
  match_type: "name" | "alias" | "slug" | "fuzzy";
  page_path: string;
  slug: string;
  title: string | null;
  name: string;
  aliases: string[];
  host: string | null;
  username: string | null;
  port: number | null;
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
  system_required: boolean;
  framework: string | null;
  pass_pattern: string | null;
  fail_pattern: string | null;
  summary: Record<string, unknown> | null;
  preflight: CatalogPreflightStep[];
  execution_target: "local" | "ssh" | null;
  required_fields: string[];
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface SystemLookup {
  score: number;
  match_type: "name" | "alias" | "slug" | "fuzzy";
  page_path: string;
  slug: string;
  title: string | null;
  name: string;
  aliases: string[];
  host: string;
  username: string;
  port: number | null;
  credential_id: string | null;
  execution_target: "local" | "ssh";
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ResolvedRunSpec {
  test_name: string;
  test_page_path: string;
  system_name: string | null;
  system_page_path: string | null;
  execution_target: "local" | "ssh";
  host: string | null;
  username: string | null;
  port: number | null;
  credential_id: string | null;
  cwd: string | null;
  command: string | null;
  timeout_minutes: number | null;
  env: Record<string, string> | null;
  framework: string | null;
  pass_pattern: string | null;
  fail_pattern: string | null;
  summary: Record<string, unknown> | null;
  preflight: CatalogPreflightStep[];
  args: CatalogArgSpec[];
  arg_values: Record<string, string>;
  missing_args: CatalogMissingArg[];
  invalid_args: CatalogInvalidArg[];
  ready_to_dispatch: boolean;
  required_fields: string[];
}

export interface LookupResult<T> {
  result: T | null;
  error?: "not_found" | "ambiguous" | "invalid_spec";
  candidates?: CatalogMatchSummary[];
  page_path?: string;
  validation_errors?: string[];
}

export interface ResolveRunInput {
  testQuery: string;
  systemQuery?: string;
  providedArgs?: Record<string, string>;
}

export type ResolveRunResult =
  | ({ error?: undefined } & ResolvedRunSpec)
  | {
      error:
        | "test_not_found"
        | "test_ambiguous"
        | "invalid_test_spec"
        | "system_required"
        | "system_not_found"
        | "system_ambiguous"
        | "invalid_system_spec";
      query?: string;
      page_path?: string;
      test_page_path?: string;
      candidates?: CatalogMatchSummary[];
      validation_errors?: string[];
      missing_args?: CatalogMissingArg[];
      invalid_args?: CatalogInvalidArg[];
    };

const catalogArgSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().optional().default(false),
  prompt: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional().default([]),
  description: z.string().min(1).optional(),
  choices: z.array(z.string().min(1)).optional(),
  default: z.string().min(1).optional(),
});

const catalogSummarySchema = z.object({
  template: z.string().min(1).optional(),
  include_tail_lines: z.number().int().positive().optional(),
}).passthrough();

const catalogPreflightActionSchema = z.object({
  ask: z.string().min(1),
  run_test: z.string().min(1),
});

const catalogPreflightCheckSchema = z.object({
  kind: z.literal("file_exists"),
  path: z.string().min(1),
});

const catalogPreflightStepSchema = z.object({
  name: z.string().min(1),
  check: catalogPreflightCheckSchema,
  if_exists: catalogPreflightActionSchema,
  if_missing: catalogPreflightActionSchema,
  before_test_ask: z.string().min(1).optional(),
});

const testFrontmatterSchema = z
  .object({
    tags: z.array(z.string().min(1)).optional(),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).optional().default([]),
    host: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    port: z.number().int().positive().max(65535).optional(),
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
    preflight: z.array(catalogPreflightStepSchema).optional().default([]),
    errors: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (classifyTarget(value.host ?? null) === "ssh" && !value.username) {
      ctx.addIssue({
        code: "custom",
        path: ["username"],
        message: "username is required when a test page directly specifies a remote host",
      });
    }
    validateArgs(value.args, ctx);
  });

const systemFrontmatterSchema = z
  .object({
    tags: z.array(z.string().min(1)).optional(),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)).optional().default([]),
    host: z.string().min(1),
    username: z.string().min(1),
    port: z.number().int().positive().max(65535).optional(),
    credential_id: z.string().min(1).optional(),
  })
  .passthrough();

type TestFrontmatter = z.infer<typeof testFrontmatterSchema>;
type SystemFrontmatter = z.infer<typeof systemFrontmatterSchema>;

export function lookupTestPage(
  pages: readonly WikiPage[],
  query: string,
  options: { providedArgs?: Record<string, string> } = {},
): LookupResult<TestLookup> {
  const match = findNamedPage(pages, query);
  if ("error" in match) return match;

  const validated = testFrontmatterSchema.safeParse(match.page.frontmatter);
  if (!validated.success) {
    return {
      result: null,
      error: "invalid_spec",
      page_path: match.page.path,
      validation_errors: validated.error.issues.map(formatIssue),
    };
  }

  return {
    result: buildTestLookup(match.page, validated.data, match.score, match.matchType, options.providedArgs),
  };
}

export function lookupSystemPage(pages: readonly WikiPage[], query: string): LookupResult<SystemLookup> {
  const match = findNamedPage(pages, query);
  if ("error" in match) return match;

  const validated = systemFrontmatterSchema.safeParse(match.page.frontmatter);
  if (!validated.success) {
    return {
      result: null,
      error: "invalid_spec",
      page_path: match.page.path,
      validation_errors: validated.error.issues.map(formatIssue),
    };
  }

  return {
    result: {
      score: match.score,
      match_type: match.matchType,
      page_path: match.page.path,
      slug: match.page.slug,
      title: match.page.title,
      name: validated.data.name,
      aliases: validated.data.aliases,
      host: validated.data.host,
      username: validated.data.username,
      port: validated.data.port ?? null,
      credential_id: validated.data.credential_id ?? null,
      execution_target: classifyTarget(validated.data.host),
      frontmatter: match.page.frontmatter,
      body: match.page.body,
    },
  };
}

export function resolveRunSpec(
  testPages: readonly WikiPage[],
  systemPages: readonly WikiPage[],
  input: ResolveRunInput,
): ResolveRunResult {
  const testLookup = lookupTestPage(testPages, input.testQuery, {
    ...(input.providedArgs !== undefined ? { providedArgs: input.providedArgs } : {}),
  });
  if (testLookup.error) {
    return mapLookupError("test", input.testQuery, testLookup);
  }
  const test = testLookup.result;
  if (!test) {
    return { error: "test_not_found", query: input.testQuery };
  }

  let system: SystemLookup | null = null;
  if (input.systemQuery) {
    const systemLookup = lookupSystemPage(systemPages, input.systemQuery);
    if (systemLookup.error) {
      return mapLookupError("system", input.systemQuery, systemLookup);
    }
    system = systemLookup.result;
  } else if (test.system_required) {
    return {
      error: "system_required",
      test_page_path: test.page_path,
      missing_args: test.missing_args,
      invalid_args: test.invalid_args,
    };
  }

  const host = system?.host ?? test.host;
  const username = system?.username ?? test.username;
  const port = system?.port ?? test.port;
  const credentialId = system?.credential_id ?? test.credential_id;
  const executionTarget = classifyTarget(host);

  const requiredFields = [...test.required_fields];
  if (executionTarget === "ssh") {
    if (!host) requiredFields.push("host");
    if (!username) requiredFields.push("username");
  }
  const readyToDispatch =
    test.missing_args.length === 0 &&
    test.invalid_args.length === 0 &&
    requiredFields.length === 0 &&
    test.command !== null;

  return {
    test_name: test.name,
    test_page_path: test.page_path,
    system_name: system?.name ?? null,
    system_page_path: system?.page_path ?? null,
    execution_target: executionTarget,
    host,
    username,
    port,
    credential_id: credentialId,
    cwd: test.cwd,
    command: readyToDispatch ? test.command : null,
    timeout_minutes: test.timeout_minutes,
    env: test.env,
    framework: test.framework,
    pass_pattern: test.pass_pattern,
    fail_pattern: test.fail_pattern,
    summary: test.summary,
    preflight: test.preflight,
    args: test.args,
    arg_values: test.arg_values,
    missing_args: test.missing_args,
    invalid_args: test.invalid_args,
    ready_to_dispatch: readyToDispatch,
    required_fields: requiredFields,
  };
}

function buildTestLookup(
  page: WikiPage,
  frontmatter: TestFrontmatter,
  score: number,
  matchType: TestLookup["match_type"],
  providedArgs: Record<string, string> | undefined,
): TestLookup {
  const args = normalizeArgSpecs(frontmatter.args);
  const normalizedProvidedArgs = normalizeProvidedArgs(providedArgs);
  const { argValues, missingArgs, invalidArgs } = resolveArgs(args, normalizedProvidedArgs);

  const commandResolution = resolveTemplate(frontmatter.command, argValues);
  const hostResolution = resolveNullableTemplate(frontmatter.host, argValues);
  const usernameResolution = resolveNullableTemplate(frontmatter.username, argValues);
  const credentialIdResolution = resolveNullableTemplate(frontmatter.credential_id, argValues);
  const cwdResolution = resolveNullableTemplate(frontmatter.cwd, argValues);
  const envResolution = resolveStringRecordTemplate(frontmatter.env, argValues);
  const preflightResolution = resolvePreflight(frontmatter.preflight, argValues);

  const unresolvedArgNames = new Set<string>([
    ...commandResolution.unresolved,
    ...hostResolution.unresolved,
    ...usernameResolution.unresolved,
    ...credentialIdResolution.unresolved,
    ...cwdResolution.unresolved,
    ...envResolution.unresolved,
    ...preflightResolution.unresolved,
  ]);
  const allMissingArgs = addTemplateDrivenMissingArgs(args, missingArgs, unresolvedArgNames);

  const requiredFields: string[] = [];
  if (!commandResolution.value) requiredFields.push("command");
  const executionTarget = hostResolution.value ? classifyTarget(hostResolution.value) : null;
  if (executionTarget === "ssh" && !usernameResolution.value) {
    requiredFields.push("username");
  }
  const systemRequired = hostResolution.value === null;
  const commandReady = allMissingArgs.length === 0 && invalidArgs.length === 0;
  const readyToDispatch =
    !systemRequired &&
    commandReady &&
    requiredFields.length === 0 &&
    commandResolution.value !== null;

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
    port: frontmatter.port ?? null,
    credential_id: credentialIdResolution.value,
    cwd: cwdResolution.value,
    command: commandReady ? commandResolution.value : null,
    host_template: frontmatter.host ?? null,
    username_template: frontmatter.username ?? null,
    credential_id_template: frontmatter.credential_id ?? null,
    cwd_template: frontmatter.cwd ?? null,
    command_template: frontmatter.command,
    timeout_minutes: frontmatter.timeout_minutes ?? null,
    env: allMissingArgs.length === 0 && invalidArgs.length === 0 ? envResolution.value : null,
    env_template: frontmatter.env ?? null,
    args,
    arg_values: argValues,
    missing_args: allMissingArgs,
    invalid_args: invalidArgs,
    ready_to_dispatch: readyToDispatch,
    system_required: systemRequired,
    framework: frontmatter.framework ?? null,
    pass_pattern: frontmatter.pass_pattern ?? null,
    fail_pattern: frontmatter.fail_pattern ?? null,
    summary: frontmatter.summary ?? null,
    preflight: preflightResolution.steps,
    execution_target: executionTarget,
    required_fields: requiredFields,
    frontmatter: page.frontmatter,
    body: page.body,
  };
}

function findNamedPage(
  pages: readonly WikiPage[],
  query: string,
):
  | { page: WikiPage; score: number; matchType: CatalogMatchType }
  | { result: null; error: "not_found" | "ambiguous"; candidates: CatalogMatchSummary[] } {
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
    .filter((value): value is { page: WikiPage; score: number; matchType: CatalogMatchType } => value !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return displayName(a.page).localeCompare(displayName(b.page));
    });

  if (scored.length === 0) {
    return { result: null, error: "not_found", candidates: [] };
  }

  const [best, second] = scored;
  if (!best) {
    return { result: null, error: "not_found", candidates: [] };
  }
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

  return best;
}

type CatalogMatchType = "name" | "alias" | "slug" | "fuzzy";

function scorePage(
  page: WikiPage,
  normalizedQuery: string,
): { score: number; matchType: CatalogMatchType } | null {
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

function mapLookupError(
  kind: "test" | "system",
  query: string,
  result: LookupResult<TestLookup> | LookupResult<SystemLookup>,
): ResolveRunResult {
  if (result.error === "not_found") {
    return { error: kind === "test" ? "test_not_found" : "system_not_found", query };
  }
  if (result.error === "ambiguous") {
    return {
      error: kind === "test" ? "test_ambiguous" : "system_ambiguous",
      query,
      candidates: result.candidates ?? [],
    };
  }
  return {
    error: kind === "test" ? "invalid_test_spec" : "invalid_system_spec",
    query,
    ...(result.page_path !== undefined ? { page_path: result.page_path } : {}),
    validation_errors: result.validation_errors ?? [],
  };
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

function validateArgs(
  args: readonly z.infer<typeof catalogArgSchema>[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Map<string, string>();
  for (const arg of args) {
    const identifiers = [arg.name, ...(arg.aliases ?? [])].map(normalize).filter(Boolean);
    for (const identifier of identifiers) {
      const owner = seen.get(identifier);
      if (owner) {
        ctx.addIssue({
          code: "custom",
          path: ["args"],
          message: `duplicate arg identifier '${identifier}' shared by '${owner}' and '${arg.name}'`,
        });
        continue;
      }
      seen.set(identifier, arg.name);
    }
    if (arg.choices && arg.default && !arg.choices.includes(arg.default)) {
      ctx.addIssue({
        code: "custom",
        path: ["args"],
        message: `default for '${arg.name}' must be one of its choices`,
      });
    }
  }
}

function normalizeArgSpecs(args: readonly z.infer<typeof catalogArgSchema>[]): CatalogArgSpec[] {
  return args.map((arg) => ({
    name: arg.name,
    required: arg.required,
    prompt: arg.prompt,
    aliases: normalizeArgAliases(arg.name, arg.aliases),
    description: arg.description ?? null,
    choices: arg.choices ?? null,
    default: arg.default ?? null,
  }));
}

function normalizeProvidedArgs(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalize(key);
    const trimmed = value.trim();
    if (!normalizedKey || !trimmed) continue;
    out[normalizedKey] = trimmed;
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
    const chosenValue = findProvidedArgValue(arg, providedArgs) ?? arg.default ?? undefined;
    if (!chosenValue) {
      if (arg.required) missingArgs.push(toMissingArg(arg));
      continue;
    }
    if (arg.choices && !arg.choices.includes(chosenValue)) {
      invalidArgs.push({
        name: arg.name,
        value: chosenValue,
        reason: `must be one of: ${arg.choices.join(", ")}`,
        aliases: arg.aliases,
        description: arg.description,
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
      aliases: [],
      description: null,
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
    aliases: arg.aliases,
    description: arg.description,
    choices: arg.choices,
    default: arg.default,
  };
}

function normalizeArgAliases(name: string, aliases: readonly string[]): string[] {
  const canonical = normalize(name);
  const seen = new Set<string>(canonical ? [canonical] : []);
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

function findProvidedArgValue(arg: CatalogArgSpec, providedArgs: Record<string, string>): string | undefined {
  const identifiers = [arg.name, ...arg.aliases].map(normalize).filter(Boolean);
  for (const identifier of identifiers) {
    const value = providedArgs[identifier];
    if (value !== undefined) return value;
  }
  return undefined;
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

function resolvePreflight(
  input: readonly z.infer<typeof catalogPreflightStepSchema>[],
  values: Record<string, string>,
): { steps: CatalogPreflightStep[]; unresolved: string[] } {
  const unresolved = new Set<string>();
  const steps = input.map((step) => {
    const pathResolution = resolveTemplate(step.check.path, values);
    for (const name of pathResolution.unresolved) unresolved.add(name);
    return {
      name: step.name,
      check: {
        kind: step.check.kind,
        path: pathResolution.value,
        path_template: step.check.path,
      },
      if_exists: {
        ask: step.if_exists.ask,
        run_test: step.if_exists.run_test,
      },
      if_missing: {
        ask: step.if_missing.ask,
        run_test: step.if_missing.run_test,
      },
      before_test_ask: step.before_test_ask ?? null,
    };
  });
  return { steps, unresolved: [...unresolved] };
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

function formatIssue(issue: z.ZodIssue): string {
  return issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
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

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
