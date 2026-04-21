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
    store.completeRun(run.id, 0);
    await flushMicrotasks();
    store.appendLines(run.id, ["ignored after completion"]);
    await flushMicrotasks();
    notifier.close();

    expect(recorder.calls()).toHaveLength(1);
    expect(recorder.calls()[0]?.url).toBe("https://teams.example/webhook");
    expect(recorder.calls()[0]?.body).toMatchObject({
      title: "Aura test passed: npm test",
      text: "npm test passed with exit code 0.",
      themeColor: "2EB886",
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
      title: "Aura test failed: pytest",
      text: "pytest failed: assertion failed",
      themeColor: "D13438",
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
