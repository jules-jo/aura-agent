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
    expect(message).toContain("If the preflight file is missing");
    expect(message).toContain("do NOT ask preflight.if_missing.ask");
    expect(message).toContain("If the preflight file exists");
    expect(message).toContain("ask preflight.if_exists.ask");
  });
});
