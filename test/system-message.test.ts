import { describe, expect, it } from "vitest";
import { phase3SystemMessage, phase3SystemMessageForMode } from "../src/session/system-message.js";

describe("phase3SystemMessageForMode", () => {
  it("omits agentic instructions by default", () => {
    expect(phase3SystemMessage.content).not.toContain("AGENTIC MODE is enabled");
    expect(phase3SystemMessageForMode().content).not.toContain("AGENTIC MODE is enabled");
  });

  it("includes failure-report policy and Jira preview requirements", () => {
    const message = phase3SystemMessageForMode().content;

    expect(message).toContain("Failure-report policy");
    expect(message).toContain("ask the user whether they want you to draft a Jira");
    expect(message).toContain("Do not create a Jira automatically");
    expect(message).toContain("call jira_preview_issue");
    expect(message).toContain("Only call jira_create_issue after the user explicitly approves the preview");
    expect(message).toContain("Do not ask to file Jira for successful runs");
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
    expect(message).toContain("do not interrupt the remaining ready rows to");
    expect(message).toContain("ask once whether the user wants");
    expect(message).toContain("Jira drafts for the failed rows");
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
