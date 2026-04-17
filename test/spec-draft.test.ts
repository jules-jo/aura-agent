import { describe, expect, it } from "vitest";
import { draftTestSpec, inferHelpArguments } from "../src/wiki/spec-draft.js";

describe("spec draft", () => {
  it("infers required options, choices, and positional args from help output", () => {
    const help = [
      "usage: x.py [-h] -i I [--mode {fast,full}] input",
      "",
      "options:",
      "  -h, --help            show this help message and exit",
      "  -i I, --iterations I  required iteration count",
      "  --mode {fast,full}    run mode",
      "",
    ].join("\n");

    const inferred = inferHelpArguments("python3 x.py", help);
    expect(inferred).toEqual([
      expect.objectContaining({
        name: "iterations",
        required: true,
        flag: "--iterations",
        aliases: ["-i", "i", "--iterations"],
        choices: null,
      }),
      expect.objectContaining({
        name: "mode",
        required: false,
        flag: "--mode",
        aliases: ["--mode"],
        choices: ["fast", "full"],
      }),
      expect.objectContaining({
        name: "input",
        required: true,
        flag: null,
        aliases: [],
        kind: "positional",
      }),
    ]);
  });

  it("drafts markdown content with required args wired into the command template", () => {
    const help = [
      "usage: x.py [-h] -i I [--mode {fast,full}] input",
      "",
      "options:",
      "  -h, --help            show this help message and exit",
      "  -i I, --iterations I  required iteration count",
      "  --mode {fast,full}    run mode",
      "",
    ].join("\n");

    const draft = draftTestSpec({
      name: "X Script",
      probeCommand: "python3 x.py --help",
      helpOutput: help,
      cwd: "/srv/app",
    });

    expect(draft.page_path).toBe("pages/tests/x-script.md");
    expect(draft.base_command).toBe("python3 x.py");
    expect(draft.required_args.map((arg) => arg.name)).toEqual(["iterations", "input"]);
    expect(draft.optional_args.map((arg) => arg.name)).toEqual(["mode"]);
    expect(draft.content).toContain('name: X Script');
    expect(draft.content).toContain('cwd: /srv/app');
    expect(draft.content).toContain('command: python3 x.py --iterations {{iterations}} {{input}}');
    expect(draft.content).toContain('aliases:');
    expect(draft.content).toContain('- -i');
    expect(draft.content).toContain('- i');
    expect(draft.content).toContain('description: required iteration count');
    expect(draft.content).toContain('prompt: What value should I pass to --iterations?');
    expect(draft.content).toContain('prompt: What value should I use for input?');
    expect(draft.content).toContain("Optional inputs detected but not wired into the command template:");
  });
});
