import { describe, expect, it } from "vitest";
import { formatAuraHelp, parseAuraCliArgs } from "../src/config/cli.js";

describe("parseAuraCliArgs", () => {
  it("defaults to human-in-the-loop mode", () => {
    expect(parseAuraCliArgs([])).toEqual({
      bypassPermissions: false,
      agenticMode: false,
      help: false,
    });
  });

  it.each([
    "--bypass",
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
  ])("enables bypass permissions for %s", (flag) => {
    expect(parseAuraCliArgs([flag])).toEqual({
      bypassPermissions: true,
      agenticMode: false,
      help: false,
    });
  });

  it("enables agentic mode", () => {
    expect(parseAuraCliArgs(["--agentic"])).toEqual({
      bypassPermissions: false,
      agenticMode: true,
      help: false,
    });
  });

  it("allows agentic mode and bypass together", () => {
    expect(parseAuraCliArgs(["--agentic", "--bypass"])).toEqual({
      bypassPermissions: true,
      agenticMode: true,
      help: false,
    });
  });

  it("detects help", () => {
    expect(parseAuraCliArgs(["--help"])).toEqual({
      bypassPermissions: false,
      agenticMode: false,
      help: true,
    });
    expect(formatAuraHelp()).toContain("--agentic");
    expect(formatAuraHelp()).toContain("--bypass");
  });

  it("rejects unknown arguments", () => {
    expect(() => parseAuraCliArgs(["--unknown"])).toThrow("unknown argument: --unknown");
  });
});
