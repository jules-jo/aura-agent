import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "../src/session/error-format.js";

describe("friendlyErrorMessage", () => {
  it("passes generic errors through unchanged", () => {
    const err = new Error("connection reset");
    expect(friendlyErrorMessage(err, "gpt-4.1")).toBe("connection reset");
  });

  it("appends a model-switch hint when OpenAI flags the prompt", () => {
    const err = new Error(
      "CAPIError: 400 This request has been flagged for potentially high-risk cyber activity.",
    );
    const out = friendlyErrorMessage(err, "gpt-4.1");
    expect(out).toContain("CAPIError");
    expect(out).toContain("/model");
    expect(out).toContain("gpt-4.1");
  });

  it("still suggests /model when the active model name does not look like OpenAI", () => {
    const err = new Error(
      "CAPIError: 400 flagged under safety-check cybersecurity policy",
    );
    const out = friendlyErrorMessage(err, undefined);
    expect(out).toContain("/model");
    expect(out).not.toContain("The current model");
  });

  it("does not add the hint for non-400 CAPIError responses", () => {
    const err = new Error("CAPIError: 500 internal error");
    const out = friendlyErrorMessage(err, "gpt-4.1");
    expect(out).toBe("CAPIError: 500 internal error");
  });

  it("does not add the hint for 400s that aren't safety-related", () => {
    const err = new Error("CAPIError: 400 bad request: missing field");
    const out = friendlyErrorMessage(err, "gpt-4.1");
    expect(out).toBe("CAPIError: 400 bad request: missing field");
  });
});
