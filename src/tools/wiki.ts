import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import { lookupTestPage } from "../wiki/catalog.js";
import type { ConfirmationStore } from "../ssh/confirmation-store.js";
import { listTestPages, readWikiPage, writeWikiPage } from "../wiki/pages.js";

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

const wikiWriteSchema = z.object({
  path: z.string().min(1).describe("Markdown page path relative to the repo root."),
  content: z.string().describe("Full replacement markdown content to write."),
  overwrite: z.boolean().optional().describe("Set true to replace an existing file."),
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
      "Resolve a named test spec from pages/tests/*.md. Returns dispatch-relevant fields, validated arg metadata, and any missing/invalid arg prompts.",
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

  return [wikiReadTool, catalogLookupTool, wikiWriteTool];
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
