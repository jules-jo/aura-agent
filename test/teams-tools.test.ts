import { describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { teamsConfigFromEnv, teamsTools } = await import("../src/tools/teams.js");

function callHandler<T = unknown>(
  tools: ReturnType<typeof teamsTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("teams tools", () => {
  it("teamsConfigFromEnv reads webhook and notification toggle", () => {
    expect(
      teamsConfigFromEnv({
        AURA_TEAMS_WEBHOOK_URL: "https://example.invalid/webhook",
        AURA_TEAMS_NOTIFY_ON_COMPLETE: "false",
      }),
    ).toEqual({
      webhookUrl: "https://example.invalid/webhook",
      notifyOnComplete: false,
    });
  });

  it("teams_send_notification posts a MessageCard payload", async () => {
    const fetchMock = vi.fn(async () => new Response("1", { status: 200 }));
    const tools = teamsTools({
      fetchImpl: fetchMock as unknown as typeof fetch,
      config: {
        webhookUrl: "https://example.invalid/webhook",
      },
    });

    const result = await callHandler<{ sent: boolean; status: string }>(tools, "teams_send_notification", {
      title: "Test Z finished",
      text: "Test Z passed on System A.",
      status: "passed",
      facts: [
        { name: "system", value: "System A" },
        { name: "exit_code", value: "0" },
      ],
    });

    expect(result).toEqual({
      sent: true,
      status: "passed",
      title: "Test Z finished",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("expected Teams fetch call");
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe("https://example.invalid/webhook");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: "Test Z finished",
      themeColor: "2EB886",
      title: "Test Z finished",
      text: "Test Z passed on System A.",
      sections: [
        {
          facts: [
            { name: "system", value: "System A" },
            { name: "exit_code", value: "0" },
          ],
        },
      ],
    });
  });

  it("teams_send_notification returns missing_config when no webhook is configured", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const tools = teamsTools({
      fetchImpl: fetchMock,
      config: {},
    });

    const result = await callHandler<{ error?: string; missing?: string[] }>(tools, "teams_send_notification", {
      title: "No webhook",
      text: "Missing config",
    });

    expect(result.error).toBe("missing_config");
    expect(result.missing).toEqual(["AURA_TEAMS_WEBHOOK_URL"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("teams_send_notification returns disabled when notifications are disabled", async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const tools = teamsTools({
      fetchImpl: fetchMock,
      config: {
        webhookUrl: "https://example.invalid/webhook",
        notifyOnComplete: false,
      },
    });

    const result = await callHandler<{ disabled?: boolean; reason?: string }>(tools, "teams_send_notification", {
      title: "Disabled",
      text: "No-op",
    });

    expect(result.disabled).toBe(true);
    expect(result.reason).toContain("AURA_TEAMS_NOTIFY_ON_COMPLETE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("teams_send_notification includes network failure diagnostics", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND teams.example"), { code: "ENOTFOUND" });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause });
    }) as unknown as typeof fetch;
    const tools = teamsTools({
      fetchImpl,
      config: {
        webhookUrl: "https://teams.example/webhook",
      },
    });

    const result = await callHandler<{
      error?: string;
      cause?: string | null;
      code?: string | null;
      hint?: string | null;
    }>(tools, "teams_send_notification", {
      title: "Network failure",
      text: "Details",
    });

    expect(result.error).toBe("request_failed");
    expect(result.cause).toContain("ENOTFOUND");
    expect(result.code).toBe("ENOTFOUND");
    expect(result.hint).toContain("resolved");
  });
});
