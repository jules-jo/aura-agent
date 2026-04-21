import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { wikiReadOnlyTools, wikiTools } = await import("../src/tools/wiki.js");
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
    await fs.mkdir(path.join(rootDir, "pages", "systems"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("wikiReadOnlyTools exposes only read and catalog tools", () => {
    const names = wikiReadOnlyTools({ rootDir }).map((tool) => tool.name);

    expect(names).toEqual([
      "wiki_read",
      "catalog_lookup_test",
      "catalog_lookup_system",
      "catalog_resolve_run",
    ]);
    expect(names).not.toContain("wiki_write");
    expect(names).not.toContain("catalog_draft_test_spec");
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

  it("catalog_lookup_test accepts provided_args keyed by arg aliases", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "python-cli.md"),
      [
        "---",
        'name: "Python CLI"',
        "host: localhost",
        'command: "python3 x.py -i {{iterations}}"',
        "args:",
        '  - name: "iterations"',
        "    required: true",
        '    prompt: "What value should I pass to -i?"',
        "    aliases:",
        '      - "-i"',
        '      - "i"',
        '    description: "Iteration count"',
        "---",
        "",
        "# Python CLI",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const resolved = await callHandler<{
      ready_to_dispatch: boolean;
      command: string | null;
      arg_values: Record<string, string>;
      args: Array<{ name: string; aliases: string[]; description: string | null }>;
      missing_args: unknown[];
    }>(tools, "catalog_lookup_test", {
      query: "python cli",
      provided_args: { "-i": "10" },
    });

    expect(resolved.ready_to_dispatch).toBe(true);
    expect(resolved.command).toBe("python3 x.py -i 10");
    expect(resolved.arg_values).toEqual({ iterations: "10" });
    expect(resolved.args).toEqual([
      expect.objectContaining({
        name: "iterations",
        aliases: ["-i", "i"],
        description: "Iteration count",
      }),
    ]);
    expect(resolved.missing_args).toEqual([]);
  });

  it("catalog_lookup_test rejects duplicate arg identifiers across names and aliases", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "broken-args.md"),
      [
        "---",
        'name: "Broken Args"',
        "host: localhost",
        'command: "python3 x.py"',
        "args:",
        '  - name: "iterations"',
        '    prompt: "First arg"',
        "    aliases:",
        '      - "-i"',
        '  - name: "input"',
        '    prompt: "Second arg"',
        "    aliases:",
        '      - "-i"',
        "---",
        "",
        "# Broken Args",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{ error?: string; validation_errors?: string[] }>(
      tools,
      "catalog_lookup_test",
      { query: "broken args" },
    );

    expect(result.error).toBe("invalid_spec");
    expect(result.validation_errors?.join("\n")).toContain("duplicate arg identifier");
  });

  it("catalog_lookup_test marks hostless specs as requiring a separate system", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "remote-pytest.md"),
      [
        "---",
        'name: "Remote Pytest"',
        'cwd: "/srv/app"',
        'command: "pytest -q"',
        "---",
        "",
        "# Remote Pytest",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{
      page_path: string;
      execution_target: string | null;
      system_required: boolean;
      command: string | null;
      ready_to_dispatch: boolean;
    }>(tools, "catalog_lookup_test", { query: "remote pytest" });

    expect(result.page_path).toBe("pages/tests/remote-pytest.md");
    expect(result.execution_target).toBeNull();
    expect(result.system_required).toBe(true);
    expect(result.command).toBe("pytest -q");
    expect(result.ready_to_dispatch).toBe(false);
  });

  it("catalog_lookup_system resolves a named system with port metadata", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "systems", "system-a.md"),
      [
        "---",
        'name: "System A"',
        "aliases:",
        "  - runner a",
        'host: "192.0.2.10"',
        'username: "root"',
        "port: 2222",
        "---",
        "",
        "# System A",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const result = await callHandler<{
      page_path: string;
      name: string;
      match_type: string;
      host: string;
      username: string;
      port: number | null;
      execution_target: string;
    }>(tools, "catalog_lookup_system", { query: "runner a" });

    expect(result.page_path).toBe("pages/systems/system-a.md");
    expect(result.name).toBe("System A");
    expect(result.match_type).toBe("alias");
    expect(result.host).toBe("192.0.2.10");
    expect(result.username).toBe("root");
    expect(result.port).toBe(2222);
    expect(result.execution_target).toBe("ssh");
  });

  it("catalog_resolve_run combines a hostless test with a named system", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "remote-pytest.md"),
      [
        "---",
        'name: "Remote Pytest"',
        'cwd: "/srv/app"',
        'command: "pytest -q {{target}}"',
        "args:",
        '  - name: "target"',
        "    required: true",
        '    prompt: "Which pytest file or node id should I run?"',
        "---",
        "",
        "# Remote Pytest",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "pages", "systems", "system-a.md"),
      [
        "---",
        'name: "System A"',
        'host: "192.0.2.10"',
        'username: "root"',
        "port: 2222",
        "---",
        "",
        "# System A",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const missingSystem = await callHandler<{ error?: string; test_page_path?: string }>(
      tools,
      "catalog_resolve_run",
      { test_query: "remote pytest" },
    );
    expect(missingSystem.error).toBe("system_required");
    expect(missingSystem.test_page_path).toBe("pages/tests/remote-pytest.md");

    const resolved = await callHandler<{
      error?: string;
      test_page_path: string;
      system_page_path: string | null;
      execution_target: string;
      host: string | null;
      username: string | null;
      port: number | null;
      command: string | null;
      ready_to_dispatch: boolean;
      arg_values: Record<string, string>;
    }>(tools, "catalog_resolve_run", {
      test_query: "remote pytest",
      system_query: "system a",
      provided_args: { target: "tests/test_api.py" },
    });

    expect(resolved.error).toBeUndefined();
    expect(resolved.test_page_path).toBe("pages/tests/remote-pytest.md");
    expect(resolved.system_page_path).toBe("pages/systems/system-a.md");
    expect(resolved.execution_target).toBe("ssh");
    expect(resolved.host).toBe("192.0.2.10");
    expect(resolved.username).toBe("root");
    expect(resolved.port).toBe(2222);
    expect(resolved.command).toBe("pytest -q tests/test_api.py");
    expect(resolved.arg_values).toEqual({ target: "tests/test_api.py" });
    expect(resolved.ready_to_dispatch).toBe(true);
  });

  it("catalog_resolve_run exposes preflight calibration metadata and resolves templated file checks", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "test-z.md"),
      [
        "---",
        'name: "Test Z"',
        'cwd: "/srv/app"',
        'command: "python3 test_z.py --profile {{profile}}"',
        "args:",
        '  - name: "profile"',
        "    required: true",
        '    prompt: "Which profile should I use for Test Z?"',
        "preflight:",
        '  - name: "Calibration"',
        "    check:",
        '      kind: "file_exists"',
        '      path: "/srv/app/calibration/{{profile}}.json"',
        "    if_exists:",
        '      ask: "Calibration file exists. Re-run calibration before Test Z?"',
        '      run_test: "Calibration Z"',
        "    if_missing:",
        '      ask: "No calibration file found. Run calibration before Test Z?"',
        '      run_test: "Calibration Z"',
        '    before_test_ask: "Calibration is complete or skipped. Run Test Z now?"',
        "---",
        "",
        "# Test Z",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "calibration-z.md"),
      [
        "---",
        'name: "Calibration Z"',
        'cwd: "/srv/app"',
        'command: "python3 calibration_z.py --profile {{profile}}"',
        "args:",
        '  - name: "profile"',
        "    required: true",
        '    prompt: "Which profile should I use for Calibration Z?"',
        "---",
        "",
        "# Calibration Z",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(rootDir, "pages", "systems", "system-a.md"),
      [
        "---",
        'name: "System A"',
        'host: "192.0.2.10"',
        'username: "root"',
        "---",
        "",
        "# System A",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const missingArgs = await callHandler<{
      execution_target: string;
      missing_args: Array<{ name: string }>;
      preflight: Array<{ check: { kind: string; path: string | null; path_template: string } }>;
      ready_to_dispatch: boolean;
    }>(tools, "catalog_resolve_run", {
      test_query: "test z",
      system_query: "system a",
    });

    expect(missingArgs.execution_target).toBe("ssh");
    expect(missingArgs.ready_to_dispatch).toBe(false);
    expect(missingArgs.missing_args).toEqual([expect.objectContaining({ name: "profile" })]);
    expect(missingArgs.preflight).toEqual([
      expect.objectContaining({
        check: expect.objectContaining({
          kind: "file_exists",
          path: null,
          path_template: "/srv/app/calibration/{{profile}}.json",
        }),
      }),
    ]);

    const resolved = await callHandler<{
      command: string | null;
      preflight: Array<{
        name: string;
        check: { kind: string; path: string | null; path_template: string };
        if_exists: { ask: string; run_test: string };
        if_missing: { ask: string; run_test: string };
        before_test_ask: string | null;
      }>;
      ready_to_dispatch: boolean;
    }>(tools, "catalog_resolve_run", {
      test_query: "test z",
      system_query: "system a",
      provided_args: { profile: "front" },
    });

    expect(resolved.ready_to_dispatch).toBe(true);
    expect(resolved.command).toBe("python3 test_z.py --profile front");
    expect(resolved.preflight).toEqual([
      {
        name: "Calibration",
        check: {
          kind: "file_exists",
          path: "/srv/app/calibration/front.json",
          path_template: "/srv/app/calibration/{{profile}}.json",
        },
        if_exists: {
          ask: "Calibration file exists. Re-run calibration before Test Z?",
          run_test: "Calibration Z",
        },
        if_missing: {
          ask: "No calibration file found. Run calibration before Test Z?",
          run_test: "Calibration Z",
        },
        before_test_ask: "Calibration is complete or skipped. Run Test Z now?",
      },
    ]);
  });

  it("catalog_resolve_run exposes semantic progress rules", async () => {
    await fs.writeFile(
      path.join(rootDir, "pages", "tests", "semantic-test.md"),
      [
        "---",
        'name: "Semantic Test"',
        "host: localhost",
        'command: "run-semantic-test"',
        "progress:",
        "  heartbeat_ms: 45000",
        "  chunk_lines: 7",
        "  patterns:",
        "    - type: phase",
        '      regex: "^PHASE: (?<phase>.+)$"',
        "    - type: metric",
        '      name: "fps"',
        '      regex: "fps=(?<value>\\\\d+(?:\\\\.\\\\d+)?)"',
        "---",
        "",
        "# Semantic Test",
        "",
      ].join("\n"),
      "utf8",
    );

    const tools = wikiTools({ rootDir });
    const resolved = await callHandler<{
      ready_to_dispatch: boolean;
      progress: {
        heartbeat_ms: number | null;
        chunk_lines: number | null;
        patterns: Array<{ type: string; regex: string; name: string | null; message: string | null }>;
      } | null;
    }>(tools, "catalog_resolve_run", {
      test_query: "semantic test",
    });

    expect(resolved.ready_to_dispatch).toBe(true);
    expect(resolved.progress).toEqual({
      heartbeat_ms: 45000,
      chunk_lines: 7,
      patterns: [
        {
          type: "phase",
          regex: "^PHASE: (?<phase>.+)$",
          name: null,
          message: null,
        },
        {
          type: "metric",
          regex: "fps=(?<value>\\d+(?:\\.\\d+)?)",
          name: "fps",
          message: null,
        },
      ],
    });
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
