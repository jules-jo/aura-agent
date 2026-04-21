import { describe, expect, it } from "vitest";
import { parseBatchPlanOutput } from "../src/agents/batch-plan.js";

describe("parseBatchPlanOutput", () => {
  it("extracts a structured plan from a fenced JSON envelope", () => {
    const result = parseBatchPlanOutput([
      "Ready to run: row 2",
      "",
      "```json",
      JSON.stringify({
        structured_plan: {
          ready: [
            {
              row_number: 2,
              test_name: "Test Z",
              system_name: "System A",
              args: { profile: "front", iterations: 10 },
            },
          ],
          needs_input: [],
          blocked: [],
          suggested_next_action: "Run row 2.",
        },
      }),
      "```",
    ].join("\n"));

    expect(result.error).toBeUndefined();
    expect(result.structuredPlan).toEqual({
      ready: [
        {
          row_number: 2,
          test_name: "Test Z",
          system_name: "System A",
          args: { profile: "front", iterations: 10 },
          notes: null,
        },
      ],
      needs_input: [],
      blocked: [],
      suggested_next_action: "Run row 2.",
    });
  });

  it("accepts the structured plan object without an envelope", () => {
    const result = parseBatchPlanOutput(JSON.stringify({
      ready: [],
      needs_input: [
        {
          row_number: 3,
          test_name: "Test X",
          system_name: "System A",
          missing_fields: ["iterations"],
          question: "What iteration count should I use for row 3?",
        },
      ],
      blocked: [],
      suggested_next_action: "Ask for iterations.",
    }));

    expect(result.error).toBeUndefined();
    expect(result.structuredPlan?.needs_input).toEqual([
      {
        row_number: 3,
        test_name: "Test X",
        system_name: "System A",
        missing_fields: ["iterations"],
        question: "What iteration count should I use for row 3?",
        notes: null,
      },
    ]);
  });

  it("returns an error when no JSON plan is present", () => {
    const result = parseBatchPlanOutput("Ready to run: row 2");

    expect(result.structuredPlan).toBeUndefined();
    expect(result.error).toContain("did not include");
  });
});
