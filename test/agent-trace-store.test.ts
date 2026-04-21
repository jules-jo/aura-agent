import { describe, expect, it } from "vitest";
import { AgentTraceStore } from "../src/agents/agent-trace-store.js";

describe("AgentTraceStore", () => {
  it("records trace events and notifies subscribers", () => {
    const store = new AgentTraceStore();
    const snapshots: readonly unknown[][] = [];

    store.subscribe((events) => {
      (snapshots as unknown[][]).push([...events]);
    });

    const started = store.record({ role: "batch_planner", status: "started" });
    const finished = store.record({ role: "batch_planner", status: "finished" });

    expect(started.message).toBe("I'm delegating to the batch_planner sidecar agent.");
    expect(finished.message).toBe("batch_planner sidecar agent finished.");
    expect(store.getEvents()).toHaveLength(2);
    expect(snapshots).toHaveLength(2);
  });

  it("includes failure detail when provided", () => {
    const store = new AgentTraceStore();
    const failed = store.record({
      role: "batch_planner",
      status: "failed",
      detail: "model unavailable",
    });

    expect(failed.message).toBe("batch_planner sidecar agent failed: model unavailable");
  });

  it("supports custom progress messages", () => {
    const store = new AgentTraceStore();
    const progress = store.record({
      role: "agentic_run_plan",
      status: "progress",
      message: "Running row 2: Test Z on System A.",
    });

    expect(progress.message).toBe("Running row 2: Test Z on System A.");
  });
});
