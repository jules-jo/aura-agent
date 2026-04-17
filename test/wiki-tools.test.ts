import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { wikiTools } = await import("../src/tools/wiki.js");
const { ConfirmationStore } = await import("../src/ssh/confirmation-store.js");

function callHandler<T = unknown>(
  tools: ReturnType<typeof wikiTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("wiki tools", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-wiki-"));
    await fs.mkdir(path.join(rootDir, "pages", "tests"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("wiki_read returns frontmatter, title, and body for a wiki page", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "alpha.md"),
      [
        "---",
        'name: "Alpha Test"',
        "aliases: [alpha]",
        "command: npm test",
        "---",
        "",
        "# Alpha Test",
        "",
        "Runs alpha.",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{
      path: string;
      title: string;
      frontmatter: Record<string, unknown>;
      body: string;
    }>(tools, "wiki_read", { path: "pages/tests/alpha.md" });

    expect(result.path).toBe("pages/tests/alpha.md");
    expect(result.title).toBe("Alpha Test");
    expect(result.frontmatter.name).toBe("Alpha Test");
    expect(result.body).toContain("Runs alpha.");
  });

  it("wiki_read rejects paths that escape the repo root", async () => {
    const tools = wikiTools({ rootDir });
    const result = await callHandler<{ error?: string }>(tools, "wiki_read", {
      path: "../secret.md",
    });
    expect(result.error).toBe("invalid_path");
  });

  it("catalog_lookup_test resolves an alias to the matching local spec", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "local-vitest.md"),
      [
        "---",
        'name: "Local Vitest"',
        "aliases:",
        "  - vitest",
        "host: localhost",
        "cwd: .",
        "command: npm test",
        "---",
        "",
        "# Local Vitest",
        "",
        "Runs local tests.",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{
      page_path: string;
      name: string;
      match_type: string;
      execution_target: string;
      command: string;
      ready_to_dispatch: boolean;
    }>(tools, "catalog_lookup_test", { query: "vitest" });

    expect(result.page_path).toBe("pages/tests/local-vitest.md");
    expect(result.name).toBe("Local Vitest");
    expect(result.match_type).toBe("alias");
    expect(result.execution_target).toBe("local");
    expect(result.command).toBe("npm test");
    expect(result.ready_to_dispatch).toBe(true);
  });

  it("catalog_lookup_test returns ambiguous when two specs tie", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "alpha-one.md"),
      ["---", 'name: "Alpha One"', "aliases: [alpha]", "command: echo one", "---", "", "# Alpha One", ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "alpha-two.md"),
      ["---", 'name: "Alpha Two"', "aliases: [alpha]", "command: echo two", "---", "", "# Alpha Two", ""].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{ error?: string; candidates?: Array<{ name: string }> }>(
      tools,
      "catalog_lookup_test",
      { query: "alpha" },
    );

    expect(result.error).toBe("ambiguous");
    expect(result.candidates?.map((candidate) => candidate.name)).toEqual(["Alpha One", "Alpha Two"]);
  });

  it("catalog_lookup_test reports invalid_spec when an SSH test omits username", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "broken-remote.md"),
      [
        "---",
        'name: "Broken Remote"',
        "host: runner.example.com",
        "command: pytest -q",
        "---",
        "",
        "# Broken Remote",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{ error?: string; validation_errors?: string[]; page_path?: string }>(
      tools,
      "catalog_lookup_test",
      { query: "broken remote" },
    );

    expect(result.error).toBe("invalid_spec");
    expect(result.page_path).toBe("pages/tests/broken-remote.md");
    expect(result.validation_errors?.join("\n")).toContain("username");
  });

  it("catalog_lookup_test surfaces missing args until provided_args resolves the template", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "focused.md"),
      [
        "---",
        'name: "Focused Vitest"',
        "host: localhost",
        'command: "npx vitest run {{pattern}}"',
        "args:",
        '  - name: "pattern"',
        "    required: true",
        '    prompt: "Which pattern should I run?"',
        "---",
        "",
        "# Focused Vitest",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const missing = await callHandler<{
      ready_to_dispatch: boolean;
      command: string | null;
      missing_args: Array<{ name: string; prompt: string }>;
    }>(tools, "catalog_lookup_test", { query: "focused vitest" });
    expect(missing.ready_to_dispatch).toBe(false);
    expect(missing.command).toBeNull();
    expect(missing.missing_args).toHaveLength(1);
    expect(missing.missing_args[0]).toMatchObject({
      name: "pattern",
      prompt: "Which pattern should I run?",
      required: true,
    });

    const resolved = await callHandler<{
      ready_to_dispatch: boolean;
      command: string | null;
      arg_values: Record<string, string>;
      missing_args: unknown[];
    }>(tools, "catalog_lookup_test", {
      query: "focused vitest",
      provided_args: { pattern: "app.test.tsx" },
    });
    expect(resolved.ready_to_dispatch).toBe(true);
    expect(resolved.command).toBe("npx vitest run app.test.tsx");
    expect(resolved.arg_values).toEqual({ pattern: "app.test.tsx" });
    expect(resolved.missing_args).toEqual([]);
  });

  it("wiki_write creates markdown files and requires overwrite=true to replace", async () => {
    const confirmations = new ConfirmationStore();
    confirmations.subscribe(() => {
      while (confirmations.getPending().length > 0) confirmations.resolveNext(true);
    });
    const tools = wikiTools({ rootDir, confirmations });

    const created = await callHandler<{ path: string; overwritten: boolean }>(tools, "wiki_write", {
      path: "pages/tests/generated.md",
      content: "# Generated\n",
    });
    expect(created.path).toBe("pages/tests/generated.md");
    expect(created.overwritten).toBe(false);
    expect(await fs.readFile(path.join(rootDir, "pages", "tests", "generated.md"), "utf8")).toBe("# Generated\n");

    const blocked = await callHandler<{ error?: string }>(tools, "wiki_write", {
      path: "pages/tests/generated.md",
      content: "# Updated\n",
    });
    expect(blocked.error).toBe("file_exists");

    const replaced = await callHandler<{ overwritten: boolean }>(tools, "wiki_write", {
      path: "pages/tests/generated.md",
      content: "# Updated\n",
      overwrite: true,
    });
    expect(replaced.overwritten).toBe(true);
    expect(await fs.readFile(path.join(rootDir, "pages", "tests", "generated.md"), "utf8")).toBe("# Updated\n");
  });
});
