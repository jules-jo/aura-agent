import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { ConfirmationStore } = await import("../src/ssh/confirmation-store.js");
const { AgentTraceStore } = await import("../src/agents/agent-trace-store.js");
const { RunStore } = await import("../src/runs/run-store.js");
const { localRunTools } = await import("../src/tools/local-run.js");
const { agenticRunPlanTools } = await import("../src/tools/agentic-run-plan.js");
const { readSpreadsheet } = await import("../src/tools/spreadsheet.js");

type ChildLike = import("../src/tools/local-run.js").ChildLike;
type Spawner = import("../src/tools/local-run.js").Spawner;

interface FakeChild {
  child: ChildLike;
  emitStdout: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  close: (code: number | null) => void;
  error: (err: Error) => void;
}

function makeFakeChild(): FakeChild {
  const stdoutListeners = new Set<(chunk: string) => void>();
  const stderrListeners = new Set<(chunk: string) => void>();
  const closeListeners = new Set<(code: number | null) => void>();
  const errorListeners = new Set<(err: Error) => void>();
  const child: ChildLike = {
    onStdout: (l) => {
      stdoutListeners.add(l);
    },
    onStderr: (l) => {
      stderrListeners.add(l);
    },
    onClose: (l) => {
      closeListeners.add(l);
    },
    onError: (l) => {
      errorListeners.add(l);
    },
    kill: () => {
      /* noop */
    },
  };
  return {
    child,
    emitStdout: (chunk) => stdoutListeners.forEach((l) => l(chunk)),
    emitStderr: (chunk) => stderrListeners.forEach((l) => l(chunk)),
    close: (code) => closeListeners.forEach((l) => l(code)),
    error: (err) => errorListeners.forEach((l) => l(err)),
  };
}

function callHandler<T = unknown>(
  tools: ReturnType<typeof agenticRunPlanTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("agentic run plan tools", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-agentic-run-plan-"));
    await fs.mkdir(path.join(rootDir, "pages", "tests"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("executes ready rows and writes result metadata back to a CSV spreadsheet", async () => {
    await writeTestPage(
      "local-smoke.md",
      [
        "---",
        'name: "Local Smoke"',
        "host: localhost",
        'command: "run-smoke --profile {{profile}}"',
        "args:",
        '  - name: "profile"',
        "    required: true",
        '    prompt: "Which profile?"',
        "---",
        "# Local Smoke",
      ].join("\n"),
    );
    await fs.writeFile(path.join(rootDir, "plan.csv"), "test_name,profile\nLocal Smoke,front\n", "utf8");

    const commands: string[] = [];
    const tools = makeTools((options) => {
      commands.push(options.command);
      const fake = makeFakeChild();
      setImmediate(() => {
        fake.emitStdout("Tests 1 passed (1)\n");
        fake.close(0);
      });
      return fake.child;
    });

    const result = await callHandler<{
      totals: { success: number; failed: number; skipped: number; blocked: number };
      rows: Array<{ status: string; run_id: string; spreadsheet_updated: boolean; summary: string }>;
    }>(tools, "agentic_run_plan", {
      spreadsheet_path: "plan.csv",
      ready: [
        {
          row_number: 2,
          test_name: "Local Smoke",
          args: { profile: "front" },
        },
      ],
      poll_wait_ms: 0,
    });

    expect(commands).toEqual(["run-smoke --profile front"]);
    expect(result.totals).toMatchObject({ success: 1, failed: 0, skipped: 0, blocked: 0 });
    expect(result.rows[0]).toMatchObject({
      status: "success",
      spreadsheet_updated: true,
    });
    expect(result.rows[0]?.run_id).toBeTruthy();
    expect(result.rows[0]?.summary).toContain("Tests 1 passed");

    const sheet = await readSpreadsheet(rootDir, { path: "plan.csv" });
    expect(sheet.rows[0]).toMatchObject({
      aura_status: "success",
      aura_run_id: result.rows[0]?.run_id,
      aura_summary: expect.stringContaining("Tests 1 passed"),
      aura_jira_key: null,
    });
    expect(sheet.rows[0]?.aura_completed_at).toEqual(expect.any(String));
  });

  it("runs missing-file preflight before the main test", async () => {
    await writeTestPage(
      "test-z.md",
      [
        "---",
        'name: "Test Z"',
        "host: localhost",
        'command: "python3 test_z.py --profile {{profile}}"',
        "args:",
        '  - name: "profile"',
        "    required: true",
        '    prompt: "Profile?"',
        "preflight:",
        '  - name: "Calibration"',
        "    check:",
        "      kind: file_exists",
        '      path: "calibration.json"',
        "    if_exists:",
        '      ask: "Calibration file exists. Run calibration again?"',
        '      run_test: "Calibration Z"',
        "    if_missing:",
        '      ask: "No calibration file found. Run calibration?"',
        '      run_test: "Calibration Z"',
        "---",
        "# Test Z",
      ].join("\n"),
    );
    await writeTestPage(
      "calibration-z.md",
      [
        "---",
        'name: "Calibration Z"',
        "host: localhost",
        'command: "python3 calibration_z.py --profile {{profile}}"',
        "args:",
        '  - name: "profile"',
        "    required: true",
        '    prompt: "Profile?"',
        "---",
        "# Calibration Z",
      ].join("\n"),
    );
    await fs.writeFile(path.join(rootDir, "plan.csv"), "test_name,profile\nTest Z,front\n", "utf8");

    const commands: string[] = [];
    const tools = makeTools((options) => {
      commands.push(options.command);
      const fake = makeFakeChild();
      setImmediate(() => {
        fake.emitStdout(`${options.command} completed\n`);
        fake.close(0);
      });
      return fake.child;
    });

    const result = await callHandler<{
      totals: { success: number };
      rows: Array<{ status: string; preflight: Array<{ status: string; run_test: string; file_exists: boolean }> }>;
    }>(tools, "agentic_run_plan", {
      spreadsheet_path: "plan.csv",
      ready: [
        {
          row_number: 2,
          test_name: "Test Z",
          args: { profile: "front" },
        },
      ],
      poll_wait_ms: 0,
    });

    expect(commands).toEqual([
      "python3 calibration_z.py --profile front",
      "python3 test_z.py --profile front",
    ]);
    expect(result.totals.success).toBe(1);
    expect(result.rows[0]).toMatchObject({
      status: "success",
      preflight: [
        {
          status: "ran",
          run_test: "Calibration Z",
          file_exists: false,
        },
      ],
    });
  });

  it("records a Jira key into the configured spreadsheet row", async () => {
    await fs.writeFile(path.join(rootDir, "plan.csv"), "test_name,aura_status\nTest Z,failed\n", "utf8");
    const tools = makeTools(() => makeFakeChild().child);

    const result = await callHandler<{ spreadsheet_updated: boolean; jira_key: string }>(
      tools,
      "agentic_record_jira_key",
      {
        spreadsheet_path: "plan.csv",
        row_number: 2,
        jira_key: "PROJ-123",
      },
    );

    expect(result).toMatchObject({
      spreadsheet_updated: true,
      jira_key: "PROJ-123",
    });
    const sheet = await readSpreadsheet(rootDir, { path: "plan.csv" });
    expect(sheet.rows[0]).toMatchObject({
      aura_jira_key: "PROJ-123",
    });
  });

  it("emits progress traces and returns failure report details for failed rows", async () => {
    await writeTestPage(
      "failing-test.md",
      [
        "---",
        'name: "Failing Test"',
        "host: localhost",
        'command: "run-failing-test"',
        "---",
        "# Failing Test",
      ].join("\n"),
    );
    await fs.writeFile(path.join(rootDir, "plan.csv"), "test_name\nFailing Test\n", "utf8");
    const traces = new AgentTraceStore();
    const tools = makeTools(() => {
      const fake = makeFakeChild();
      setImmediate(() => {
        fake.emitStdout("AssertionError: expected ok\nTests 1 failed (1)\n");
        fake.close(1);
      });
      return fake.child;
    }, traces);

    const result = await callHandler<{
      totals: { failed: number };
      failure_report: {
        needed: boolean;
        rows: Array<{ test_name: string; exit_code: number; output_tail: string[] }>;
      };
      rows: Array<{ status: string; output_tail: string[] }>;
    }>(tools, "agentic_run_plan", {
      spreadsheet_path: "plan.csv",
      ready: [
        {
          row_number: 2,
          test_name: "Failing Test",
        },
      ],
      poll_wait_ms: 0,
    });

    expect(result.totals.failed).toBe(1);
    expect(result.rows[0]).toMatchObject({
      status: "failed",
      output_tail: ["AssertionError: expected ok", "Tests 1 failed (1)"],
    });
    expect(result.failure_report).toMatchObject({
      needed: true,
      rows: [
        {
          test_name: "Failing Test",
          exit_code: 1,
          output_tail: ["AssertionError: expected ok", "Tests 1 failed (1)"],
        },
      ],
    });
    expect(traces.getEvents().map((event) => event.message)).toEqual(
      expect.arrayContaining([
        "Starting agentic batch execution for 1 ready row(s).",
        "Running row 2: Failing Test.",
        expect.stringContaining("Dispatched Failing Test as run"),
        expect.stringContaining("Failing Test failed: failed (exit 1): Tests 1 failed (1)."),
        "Agentic batch finished: 0 success, 1 failed, 0 skipped, 0 blocked.",
      ]),
    );
  });

  function makeTools(spawner: Spawner, traces?: InstanceType<typeof AgentTraceStore>): ReturnType<typeof agenticRunPlanTools> {
    const runStore = new RunStore();
    const confirmations = new ConfirmationStore({ bypass: true });
    const localTools = localRunTools(runStore, { defaultCwd: rootDir, spawner });
    return agenticRunPlanTools({
      rootDir,
      confirmations,
      localTools,
      sshTools: [],
      ...(traces !== undefined ? { traces } : {}),
    });
  }

  async function writeTestPage(name: string, content: string): Promise<void> {
    await fs.writeFile(path.join(rootDir, "pages", "tests", name), `${content}\n`, "utf8");
  }
});
