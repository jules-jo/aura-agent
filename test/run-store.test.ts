import { describe, expect, it } from "vitest";
import { RunStore } from "../src/runs/run-store.js";

describe("RunStore", () => {
  it("creates a run with running status and no iterations", () => {
    const store = new RunStore();
    const run = store.createRun({
      command: "echo hi",
      cwd: "/tmp",
      testName: "Smoke Test",
      systemName: "Bench A",
      iterationSize: 5,
    });
    expect(run.status).toBe("running");
    expect(run.testName).toBe("Smoke Test");
    expect(run.systemName).toBe("Bench A");
    expect(run.iterations).toEqual([]);
    expect(run.iterationSize).toBe(5);
    expect(store.getActive()?.id).toBe(run.id);
  });

  it("flushes a full iteration once iterationSize lines have arrived", () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp", iterationSize: 3 });
    store.appendLines(run.id, ["a", "b"]);
    expect(store.get(run.id)?.iterations.length).toBe(0);
    store.appendLines(run.id, ["c"]);
    const snap = store.get(run.id);
    expect(snap?.iterations.length).toBe(1);
    expect(snap?.iterations[0]?.lines).toEqual(["a", "b", "c"]);
    expect(snap?.totalLines).toBe(3);
  });

  it("flushes remaining pending lines on completion", () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp", iterationSize: 5 });
    store.appendLines(run.id, ["a", "b"]);
    store.completeRun(run.id, 0);
    const snap = store.get(run.id);
    expect(snap?.status).toBe("completed");
    expect(snap?.exitCode).toBe(0);
    expect(snap?.iterations.length).toBe(1);
    expect(snap?.iterations[0]?.lines).toEqual(["a", "b"]);
  });

  it("marks the run failed on non-zero exit", () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp" });
    store.completeRun(run.id, 2);
    expect(store.get(run.id)?.status).toBe("failed");
    expect(store.get(run.id)?.exitCode).toBe(2);
  });

  it("waitForUpdate resolves immediately when updates already exist", async () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp", iterationSize: 1 });
    store.appendLines(run.id, ["a"]);
    await store.waitForUpdate(run.id, 0, 5000);
    expect(store.get(run.id)?.iterations.length).toBe(1);
  });

  it("waitForUpdate resolves when a new iteration arrives later", async () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp", iterationSize: 1 });
    const promise = store.waitForUpdate(run.id, 0, 1000);
    setImmediate(() => store.appendLines(run.id, ["a"]));
    await promise;
    expect(store.get(run.id)?.iterations.length).toBe(1);
  });

  it("getActive returns a stable reference between mutations", () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp", iterationSize: 5 });
    const first = store.getActive();
    const second = store.getActive();
    expect(first).toBe(second);
    store.appendLines(run.id, ["only-one"]);
    const third = store.getActive();
    expect(third).toBe(second);
    store.appendLines(run.id, ["a", "b", "c", "d", "e"]);
    const fourth = store.getActive();
    expect(fourth).not.toBe(third);
  });

  it("waitForUpdate resolves on timeout if nothing happens", async () => {
    const store = new RunStore();
    const run = store.createRun({ command: "x", cwd: "/tmp", iterationSize: 10 });
    const start = Date.now();
    await store.waitForUpdate(run.id, 0, 30);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(store.get(run.id)?.status).toBe("running");
  });
});
