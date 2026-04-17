import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockModelInfo {
  id: string;
  name: string;
}

const mockState = vi.hoisted(() => ({
  models: [] as MockModelInfo[],
  createSessionCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@github/copilot-sdk", () => {
  class MockSession {
    on(): () => void {
      return () => {};
    }

    async sendAndWait(): Promise<void> {
      // no-op
    }

    async setModel(): Promise<void> {
      // no-op
    }

    async disconnect(): Promise<void> {
      // no-op
    }
  }

  return {
    approveAll: Symbol("approveAll"),
    CopilotClient: class {
      async listModels(): Promise<MockModelInfo[]> {
        return mockState.models;
      }

      async createSession(config: Record<string, unknown>): Promise<MockSession> {
        mockState.createSessionCalls.push(config);
        return new MockSession();
      }

      async stop(): Promise<void> {
        // no-op
      }
    },
  };
});

const { startSession } = await import("../src/session/copilot.js");

describe("startSession model selection", () => {
  beforeEach(() => {
    mockState.models = [];
    mockState.createSessionCalls = [];
  });

  afterEach(() => {
    mockState.models = [];
    mockState.createSessionCalls = [];
  });

  it("prefers claude-opus-4.6 when no explicit model is provided", async () => {
    mockState.models = [
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    ];

    const session = await startSession();

    expect(mockState.createSessionCalls[0]?.model).toBe("claude-opus-4.6");
    expect(session.getModel()).toBe("claude-opus-4.6");
    await session.close();
  });

  it("falls back to the first available model when claude-opus-4.6 is unavailable", async () => {
    mockState.models = [
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    ];

    const session = await startSession();

    expect(mockState.createSessionCalls[0]?.model).toBe("gpt-4.1");
    expect(session.getModel()).toBe("gpt-4.1");
    await session.close();
  });

  it("respects an explicit caller-provided model override", async () => {
    mockState.models = [
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    ];

    const session = await startSession({ model: "claude-sonnet-4" });

    expect(mockState.createSessionCalls[0]?.model).toBe("claude-sonnet-4");
    expect(session.getModel()).toBe("claude-sonnet-4");
    await session.close();
  });
});
