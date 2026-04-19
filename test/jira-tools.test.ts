import { describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { ConfirmationStore } = await import("../src/ssh/confirmation-store.js");
const { jiraTools } = await import("../src/tools/jira.js");

function autoConfirm(approved: boolean): InstanceType<typeof ConfirmationStore> {
  const store = new ConfirmationStore();
  store.subscribe((pending) => {
    for (const _ of pending) store.resolveNext(approved);
  });
  return store;
}

function callHandler<T = unknown>(
  tools: ReturnType<typeof jiraTools>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  const invocation = { sessionId: "test", toolCallId: "tc1", toolName: name, arguments: args };
  return Promise.resolve(tool.handler(args, invocation)) as Promise<T>;
}

describe("jira tools", () => {
  it("jira_create_issue posts a Jira issue after confirmation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ key: "PROJ-123", self: "https://jira.example/rest/api/2/issue/10001" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const tools = jiraTools({
      confirmations: autoConfirm(true),
      fetchImpl: fetchMock as unknown as typeof fetch,
      config: {
        baseUrl: "https://jira.example",
        token: "pat",
        defaultProject: "PROJ",
      },
    });

    const result = await callHandler<{ key: string | null; url: string | null }>(tools, "jira_create_issue", {
      summary: "Test Z failed",
      description: "Failure details",
      labels: ["aura", "test-failure"],
    });

    expect(result.key).toBe("PROJ-123");
    expect(result.url).toBe("https://jira.example/browse/PROJ-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("expected Jira fetch call");
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe("https://jira.example/rest/api/2/issue");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer pat",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      fields: {
        project: { key: "PROJ" },
        summary: "Test Z failed",
        description: "Failure details",
        issuetype: { name: "Bug" },
        labels: ["aura", "test-failure"],
      },
    });
  });

  it("jira_create_issue returns missing_config before prompting", async () => {
    const confirmations = new ConfirmationStore();
    const tools = jiraTools({
      confirmations,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      config: {},
    });

    const result = await callHandler<{ error?: string; missing?: string[] }>(tools, "jira_create_issue", {
      project_key: "PROJ",
      summary: "Missing config",
      description: "Details",
    });

    expect(result.error).toBe("missing_config");
    expect(result.missing).toEqual(["AURA_JIRA_BASE_URL", "AURA_JIRA_TOKEN"]);
    expect(confirmations.getPending()).toHaveLength(0);
  });

  it("jira_create_issue does not call Jira when the user declines", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tools = jiraTools({
      confirmations: autoConfirm(false),
      fetchImpl,
      config: {
        baseUrl: "https://jira.example",
        token: "pat",
        defaultProject: "PROJ",
      },
    });

    const result = await callHandler<{ error?: string }>(tools, "jira_create_issue", {
      summary: "Declined",
      description: "Details",
    });

    expect(result.error).toBe("user_declined");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
