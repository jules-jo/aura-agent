import { describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { RunStore } = await import("../src/runs/run-store.js");
const { startRunCompletionNotifier } = await import("../src/runs/run-completion-notifier.js");

function makeFetchRecorder(): { fetchImpl: typeof fetch; calls: () => Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response("1", { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe("RunCompletionNotifier", () => {
  it("sends one Teams notification when a run completes", async () => {
    const store = new RunStore();
    const recorder = makeFetchRecorder();
    const notifier = startRunCompletionNotifier(store, {
      fetchImpl: recorder.fetchImpl,
      teams: { webhookUrl: "https://teams.example/webhook" },
    });

    const run = store.createRun({ command: "npm test", cwd: "/repo" });
    store.appendLines(run.id, [
      " Test Files  23 passed (23)",
      "      Tests  144 passed (144)",
      "   Duration  1.09s",
    ]);
    store.completeRun(run.id, 0);
    await flushMicrotasks();
    store.appendLines(run.id, ["ignored after completion"]);
    await flushMicrotasks();
    notifier.close();

    expect(recorder.calls()).toHaveLength(1);
    expect(recorder.calls()[0]?.url).toBe("https://teams.example/webhook");
    expect(recorder.calls()[0]?.body).toMatchObject({
      title: "Aura test passed: Tests 144 passed (144)",
      text: "Test passed.\n\nOutput summary:\nTest Files 23 passed (23)\nTests 144 passed (144)\nDuration 1.09s",
      themeColor: "2EB886",
    });
    expect(recorder.calls()[0]?.body).toMatchObject({
      sections: [
        {
          facts: expect.arrayContaining([{ name: "command", value: "npm test" }]),
        },
      ],
    });
  });

  it("sends failed status and error text for failed runs", async () => {
    const store = new RunStore();
    const recorder = makeFetchRecorder();
    const notifier = startRunCompletionNotifier(store, {
      fetchImpl: recorder.fetchImpl,
      teams: { webhookUrl: "https://teams.example/webhook" },
    });

    const run = store.createRun({ command: "pytest", cwd: "/repo" });
    store.failRun(run.id, "assertion failed");
    await flushMicrotasks();
    notifier.close();

    expect(recorder.calls()).toHaveLength(1);
    expect(recorder.calls()[0]?.body).toMatchObject({
      title: "Aura test failed: assertion failed",
      text: "Run failed: assertion failed",
      themeColor: "D13438",
    });
  });

  it("falls back to status text when there is no captured output", async () => {
    const store = new RunStore();
    const recorder = makeFetchRecorder();
    const notifier = startRunCompletionNotifier(store, {
      fetchImpl: recorder.fetchImpl,
      teams: { webhookUrl: "https://teams.example/webhook" },
    });

    const run = store.createRun({ command: "quiet-test", cwd: "/repo" });
    store.completeRun(run.id, 0);
    await flushMicrotasks();
    notifier.close();

    expect(recorder.calls()).toHaveLength(1);
    expect(recorder.calls()[0]?.body).toMatchObject({
      title: "Aura test passed",
      text: "Test passed with exit code 0.",
    });
  });

  it("does not send when Teams notifications are disabled", async () => {
    const store = new RunStore();
    const recorder = makeFetchRecorder();
    const notifier = startRunCompletionNotifier(store, {
      fetchImpl: recorder.fetchImpl,
      teams: {
        webhookUrl: "https://teams.example/webhook",
        notifyOnComplete: false,
      },
    });

    const run = store.createRun({ command: "npm test", cwd: "/repo" });
    store.completeRun(run.id, 0);
    await flushMicrotasks();
    notifier.close();

    expect(recorder.calls()).toHaveLength(0);
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
