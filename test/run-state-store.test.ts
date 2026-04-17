import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStateStore, type RunStateRecord } from "../src/ssh/run-state-store.js";

describe("RunStateStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-run-state-"));
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function makeRecord(overrides: Partial<RunStateRecord> = {}): RunStateRecord {
    return {
      runId: "run-1",
      host: "h.example",
      port: 22,
      username: "u",
      credentialId: "c1",
      command: "echo hi",
      remoteBase: "~/.aura/runs",
      remotePidPath: "~/.aura/runs/run-1/pid",
      remoteLogPath: "~/.aura/runs/run-1/output.log",
      startedAt: "2026-04-17T00:00:00.000Z",
      status: "running",
      ...overrides,
    };
  }

  it("create + read round-trips a record", async () => {
    const store = new RunStateStore({ dataDir });
    const record = makeRecord();
    await store.create(record);
    const read = await store.read("run-1");
    expect(read).toEqual(record);
  });

  it("list returns all persisted records", async () => {
    const store = new RunStateStore({ dataDir });
    await store.create(makeRecord({ runId: "a" }));
    await store.create(makeRecord({ runId: "b" }));
    const all = await store.list();
    expect(all.map((r) => r.runId).sort()).toEqual(["a", "b"]);
  });

  it("list returns [] when runs dir does not exist", async () => {
    const store = new RunStateStore({ dataDir: path.join(dataDir, "does-not-exist") });
    expect(await store.list()).toEqual([]);
  });

  it("markComplete flips status and records exit code", async () => {
    const store = new RunStateStore({ dataDir });
    await store.create(makeRecord());
    const updated = await store.markComplete("run-1", 0);
    expect(updated?.status).toBe("completed");
    expect(updated?.exitCode).toBe(0);
    expect(updated?.completedAt).toBeDefined();
    const failed = await store.markComplete("run-1", 2);
    expect(failed?.status).toBe("failed");
    expect(failed?.exitCode).toBe(2);
  });

  it("markOrphaned moves the record to orphaned/", async () => {
    const store = new RunStateStore({ dataDir });
    await store.create(makeRecord());
    await store.markOrphaned("run-1");
    expect(await store.read("run-1")).toBeNull();
    const orphaned = await fs.readdir(path.join(dataDir, "runs", "orphaned"));
    expect(orphaned).toContain("run-1.json");
  });

  it("read returns null for unknown run_id", async () => {
    const store = new RunStateStore({ dataDir });
    expect(await store.read("nope")).toBeNull();
  });
});
