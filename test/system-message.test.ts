import { describe, expect, it } from "vitest";
import { phase3SystemMessage, phase3SystemMessageForMode } from "../src/session/system-message.js";

describe("phase3SystemMessageForMode", () => {
  it("omits agentic instructions by default", () => {
    expect(phase3SystemMessage.content).not.toContain("AGENTIC MODE is enabled");
    expect(phase3SystemMessageForMode().content).not.toContain("AGENTIC MODE is enabled");
  });

  it("adds agentic execution and preflight policy when enabled", () => {
    const message = phase3SystemMessageForMode({ agenticMode: true }).content;

    expect(message).toContain("AGENTIC MODE is enabled");
    expect(message).toContain("Do not ask for permission before running a spreadsheet row");
    expect(message).toContain("After agent_delegate returns a structured_plan with ready rows");
    expect(message).toContain("do not ask the user to say \"run it\"");
    expect(message).toContain("Execute the ready rows sequentially");
    expect(message).toContain("Poll each run to completion before moving to the next ready row");
    expect(message).toContain("If the preflight file is missing");
    expect(message).toContain("do NOT ask preflight.if_missing.ask");
    expect(message).toContain("If the preflight file exists");
    expect(message).toContain("ask preflight.if_exists.ask");
  });

  it("adds default spreadsheet configuration when provided", () => {
    const message = phase3SystemMessageForMode({
      defaultSpreadsheetPath: "./test-plan.xlsx",
      defaultSpreadsheetSheet: "Plan",
    }).content;

    expect(message).toContain("Default spreadsheet configuration");
    expect(message).toContain("Path: ./test-plan.xlsx");
    expect(message).toContain("Sheet: Plan");
    expect(message).toContain("default spreadsheet");
  });
});
