import { describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { RunStore } = await import("../src/runs/run-store.js");
const { localRunTools } = await import("../src/tools/local-run.js");
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
  tools: ReturnType<typeof localRunTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("local-run tools", () => {
  it("local_dispatch creates a run and pipes child output into the store", async () => {
    const store = new RunStore();
    const fake = makeFakeChild();
    const spawner: Spawner = () => fake.child;
    const tools = localRunTools(store, { defaultCwd: "/tmp", spawner });
    const result = await callHandler<{ run_id: string; command: string }>(tools, "local_dispatch", {
      command: "echo hi",
      iteration_lines: 2,
    });
    expect(result.command).toBe("echo hi");
    expect(store.get(result.run_id)?.status).toBe("running");
    fake.emitStdout("line 1\nline 2\nline 3\n");
    fake.close(0);
    const snap = store.get(result.run_id);
    expect(snap?.status).toBe("completed");
    expect(snap?.exitCode).toBe(0);
    expect(snap?.totalLines).toBe(3);
    expect(snap?.iterations.length).toBeGreaterThanOrEqual(1);
  });

  it("local_poll returns only iterations after since_iteration", async () => {
    const store = new RunStore();
    const fake = makeFakeChild();
    const tools = localRunTools(store, { defaultCwd: "/tmp", spawner: () => fake.child });
    const dispatch = await callHandler<{ run_id: string }>(tools, "local_dispatch", {
      command: "x",
      iteration_lines: 1,
    });
    fake.emitStdout("a\nb\nc\n");
    fake.close(0);
    const firstPoll = await callHandler<{ iterations: unknown[]; status: string }>(
      tools,
      "local_poll",
      { run_id: dispatch.run_id, wait_ms: 0 },
    );
    expect(firstPoll.status).toBe("completed");
    expect(firstPoll.iterations.length).toBe(3);
    const secondPoll = await callHandler<{ iterations: unknown[] }>(tools, "local_poll", {
      run_id: dispatch.run_id,
      since_iteration: 2,
      wait_ms: 0,
    });
    expect(secondPoll.iterations.length).toBe(1);
  });

  it("local_poll returns not_found for unknown run_id", async () => {
    const store = new RunStore();
    const tools = localRunTools(store, {
      defaultCwd: "/tmp",
      spawner: () => makeFakeChild().child,
    });
    const result = await callHandler<{ error?: string }>(tools, "local_poll", {
      run_id: "does-not-exist",
      wait_ms: 0,
    });
    expect(result.error).toBe("run_not_found");
  });

  it("marks the run failed when the child emits an error", async () => {
    const store = new RunStore();
    const fake = makeFakeChild();
    const tools = localRunTools(store, { defaultCwd: "/tmp", spawner: () => fake.child });
    const dispatch = await callHandler<{ run_id: string }>(tools, "local_dispatch", {
      command: "broken",
    });
    fake.error(new Error("spawn failed"));
    const snap = store.get(dispatch.run_id);
    expect(snap?.status).toBe("failed");
    expect(snap?.error).toContain("spawn failed");
  });

  it("passes env through to the spawner when provided", async () => {
    const store = new RunStore();
    let seenEnv: Record<string, string> | undefined;
    const tools = localRunTools(store, {
      defaultCwd: "/tmp",
      spawner: (options) => {
        seenEnv = options.env;
        return makeFakeChild().child;
      },
    });

    await callHandler(tools, "local_dispatch", {
      command: "echo $FOO",
      env: { FOO: "bar" },
    });

    expect(seenEnv).toEqual({ FOO: "bar" });
  });
});
