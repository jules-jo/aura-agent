import { promises as fs } from "node:fs";
import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { lookupSystemPage, lookupTestPage, resolveRunSpec } from "../wiki/catalog.js";
import { draftTestSpec } from "../wiki/spec-draft.js";
import type { ConfirmationStore } from "../ssh/confirmation-store.js";
import { listSystemPages, listTestPages, readWikiPage, resolveRepoPath, writeWikiPage } from "../wiki/pages.js";

const wikiReadSchema = z.object({
  path: z.string().min(1).describe("Markdown page path relative to the repo root, e.g. pages/tests/local-vitest.md."),
});

const catalogLookupSchema = z.object({
  query: z.string().min(1).describe("Friendly test name, alias, or slug to resolve from pages/tests/*.md."),
  provided_args: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional arg values to apply against the spec's declared args before dispatch."),
});

const systemLookupSchema = z.object({
  query: z.string().min(1).describe("Friendly system name, alias, or slug to resolve from pages/systems/*.md."),
});

const resolveRunSchema = z.object({
  test_query: z.string().min(1).describe("Named test to resolve from pages/tests/*.md."),
  system_query: z
    .string()
    .min(1)
    .optional()
    .describe("Optional named system to resolve from pages/systems/*.md."),
  provided_args: z
    .record(z.string(), z.string())
    .optional()
    .describe("Optional arg values to apply against the test spec before final resolution."),
});

const wikiWriteSchema = z.object({
  path: z.string().min(1).describe("Markdown page path relative to the repo root."),
  content: z.string().describe("Full replacement markdown content to write."),
  overwrite: z.boolean().optional().describe("Set true to replace an existing file."),
});

const draftTestSpecSchema = z.object({
  name: z.string().min(1).describe("Human-readable test name."),
  probe_command: z
    .string()
    .min(1)
    .describe("The local or remote command used to collect help output, usually ending in --help or -h."),
  help_output: z.string().min(1).describe("Combined stdout/stderr from the command's help output."),
  page_path: z
    .string()
    .min(1)
    .optional()
    .describe("Optional explicit markdown path. Defaults to pages/tests/<slug>.md."),
  aliases: z.array(z.string().min(1)).optional().describe("Optional test aliases to include in the draft."),
  cwd: z.string().min(1).optional().describe("Optional working directory to store in the draft."),
  timeout_minutes: z.number().int().positive().optional().describe("Optional timeout to include in the draft."),
});

export interface WikiToolsOptions {
  rootDir: string;
  confirmations?: ConfirmationStore;
}

export function wikiTools(options: WikiToolsOptions): Tool<any>[] {
  const wikiReadTool = defineTool("wiki_read", {
    description: "Read a markdown page from the project wiki and return its frontmatter, title, and body.",
    parameters: wikiReadSchema,
    handler: async (args) => {
      try {
        const page = await readWikiPage(options.rootDir, args.path);
        return {
          path: page.path,
          title: page.title,
          frontmatter: page.frontmatter,
          body: page.body,
        };
      } catch (err: unknown) {
        return {
          error: classifyReadError(err),
          path: args.path,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const catalogLookupTool = defineTool("catalog_lookup_test", {
    description:
      "Resolve a named test spec from pages/tests/*.md. Returns command/arg metadata and indicates whether a separate system is still required.",
    parameters: catalogLookupSchema,
    handler: async (args) => {
      const pages = await listTestPages(options.rootDir);
      const lookup = lookupTestPage(pages, args.query, {
        ...(args.provided_args !== undefined ? { providedArgs: args.provided_args } : {}),
      });
      if (lookup.error) {
        return {
          error: lookup.error,
          query: args.query,
          candidates: lookup.candidates ?? [],
          page_path: lookup.page_path ?? null,
          validation_errors: lookup.validation_errors ?? [],
          searched_dir: "pages/tests",
        };
      }
      return lookup.result;
    },
  });

  const systemLookupTool = defineTool("catalog_lookup_system", {
    description:
      "Resolve a named target system from pages/systems/*.md. Returns host, username, optional port, and aliases.",
    parameters: systemLookupSchema,
    handler: async (args) => {
      const pages = await listSystemPages(options.rootDir);
      const lookup = lookupSystemPage(pages, args.query);
      if (lookup.error) {
        return {
          error: lookup.error,
          query: args.query,
          candidates: lookup.candidates ?? [],
          page_path: lookup.page_path ?? null,
          validation_errors: lookup.validation_errors ?? [],
          searched_dir: "pages/systems",
        };
      }
      return lookup.result;
    },
  });

  const resolveRunTool = defineTool("catalog_resolve_run", {
    description:
      "Resolve a runnable spec from a named test plus an optional named system. Use this for prompts like 'run test X in system A'.",
    parameters: resolveRunSchema,
    handler: async (args) => {
      const [testPages, systemPages] = await Promise.all([
        listTestPages(options.rootDir),
        listSystemPages(options.rootDir),
      ]);
      return resolveRunSpec(testPages, systemPages, {
        testQuery: args.test_query,
        ...(args.system_query !== undefined ? { systemQuery: args.system_query } : {}),
        ...(args.provided_args !== undefined ? { providedArgs: args.provided_args } : {}),
      });
    },
  });

  const wikiWriteTool = defineTool("wiki_write", {
    description:
      "Write a markdown page into the repo wiki. Creates parent directories as needed. Set overwrite=true to replace an existing file.",
    parameters: wikiWriteSchema,
    handler: async (args) => {
      if (options.confirmations) {
        const approved = await options.confirmations.request({
          summary: `write wiki page ${args.path}`,
          detail: args.overwrite ? "overwrite existing file if present" : "create new file",
        });
        if (!approved) return { error: "user_declined", path: args.path };
      }
      try {
        const result = await writeWikiPage(options.rootDir, args.path, args.content, {
          ...(args.overwrite !== undefined ? { overwrite: args.overwrite } : {}),
        });
        return {
          path: result.path,
          overwritten: result.overwritten,
          bytes_written: result.bytesWritten,
        };
      } catch (err: unknown) {
        return {
          error: classifyWriteError(err),
          path: args.path,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  const draftTestSpecTool = defineTool("catalog_draft_test_spec", {
    description:
      "Draft a pages/tests/*.md spec from command help output. Use after probing a local or remote command with --help or -h.",
    parameters: draftTestSpecSchema,
    handler: async (args) => {
      const draft = draftTestSpec({
        name: args.name,
        probeCommand: args.probe_command,
        helpOutput: args.help_output,
        ...(args.page_path !== undefined ? { pagePath: args.page_path } : {}),
        ...(args.aliases !== undefined ? { aliases: args.aliases } : {}),
        ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
        ...(args.timeout_minutes !== undefined ? { timeoutMinutes: args.timeout_minutes } : {}),
      });
      const absolutePath = resolveRepoPath(options.rootDir, draft.page_path);
      const pathExists = await fileExists(absolutePath);
      return {
        ...draft,
        path_exists: pathExists,
      };
    },
  });

  return [wikiReadTool, catalogLookupTool, systemLookupTool, resolveRunTool, wikiWriteTool, draftTestSpecTool];
}

function classifyReadError(err: unknown): "invalid_path" | "not_found" | "read_failed" {
  if (err instanceof Error && /escapes repo root|path is required/i.test(err.message)) {
    return "invalid_path";
  }
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT") {
    return "not_found";
  }
  return "read_failed";
}

function classifyWriteError(err: unknown): "invalid_path" | "file_exists" | "write_failed" {
  if (err instanceof Error && /escapes repo root|path is required|must be markdown/i.test(err.message)) {
    return "invalid_path";
  }
  if (err instanceof Error && /file exists/i.test(err.message)) {
    return "file_exists";
  }
  return "write_failed";
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
