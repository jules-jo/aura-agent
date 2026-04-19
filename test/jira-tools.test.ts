import { describe, expect, it, vi } from "vitest";

vi.mock("@github/copilot-sdk", () => ({
  defineTool: (name: string, config: Record<string, unknown>) => ({ name, ...config }),
}));

const { ConfirmationStore } = await import("../src/ssh/confirmation-store.js");
const { jiraTools } = await import("../src/tools/jira.js");
const { jiraConfigFromEnv } = await import("../src/tools/jira.js");

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
  it("jiraConfigFromEnv accepts AURA_JIRA_PAT as an alias for AURA_JIRA_TOKEN", () => {
    expect(
      jiraConfigFromEnv({
        AURA_JIRA_BASE_URL: "https://jira.example",
        AURA_JIRA_PAT: "pat-token",
        AURA_JIRA_DEFAULT_PROJECT: "PROJ",
      }),
    ).toEqual({
      baseUrl: "https://jira.example",
      token: "pat-token",
      defaultProject: "PROJ",
    });
  });

  it("jiraConfigFromEnv prefers AURA_JIRA_TOKEN when both token names are set", () => {
    expect(
      jiraConfigFromEnv({
        AURA_JIRA_BASE_URL: "https://jira.example",
        AURA_JIRA_TOKEN: "token-value",
        AURA_JIRA_PAT: "pat-value",
      }),
    ).toMatchObject({
      token: "token-value",
    });
  });

  it("jira_preview_issue returns the exact fields to show the user", async () => {
    const tools = jiraTools({
      confirmations: autoConfirm(true),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      config: {
        baseUrl: "https://jira.example",
        token: "pat",
        defaultProject: "PROJ",
      },
    });

    const preview = await callHandler<{
      preview_id: string;
      project_key: string;
      summary: string;
      description: string;
      issue_type: string;
      labels: string[];
      preview_markdown: string;
    }>(tools, "jira_preview_issue", {
      summary: "Test Z failed",
      description: "Failure details",
      labels: ["aura", "test-failure"],
    });

    expect(preview.preview_id).toBe("jp0");
    expect(preview).toMatchObject({
      project_key: "PROJ",
      summary: "Test Z failed",
      description: "Failure details",
      issue_type: "Bug",
      labels: ["aura", "test-failure"],
    });
    expect(preview.preview_markdown).toContain("project: PROJ");
    expect(preview.preview_markdown).toContain("summary: Test Z failed");
    expect(preview.preview_markdown).toContain("description:\nFailure details");
  });

  it("jira_create_issue posts a previewed Jira issue after confirmation", async () => {
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

    const preview = await callHandler<{ preview_id: string }>(tools, "jira_preview_issue", {
      summary: "Test Z failed",
      description: "Failure details",
      labels: ["aura", "test-failure"],
    });
    const result = await callHandler<{ key: string | null; url: string | null }>(tools, "jira_create_issue", {
      preview_id: preview.preview_id,
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

  it("jira_preview_issue returns missing_config before prompting", async () => {
    const confirmations = new ConfirmationStore();
    const tools = jiraTools({
      confirmations,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      config: {},
    });

    const result = await callHandler<{ error?: string; missing?: string[] }>(tools, "jira_preview_issue", {
      project_key: "PROJ",
      summary: "Missing config",
      description: "Details",
    });

    expect(result.error).toBe("missing_config");
    expect(result.missing).toEqual(["AURA_JIRA_BASE_URL", "AURA_JIRA_TOKEN or AURA_JIRA_PAT"]);
    expect(confirmations.getPending()).toHaveLength(0);
  });

  it("jira_create_issue refuses to create without a preview id", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tools = jiraTools({
      confirmations: autoConfirm(true),
      fetchImpl,
      config: {
        baseUrl: "https://jira.example",
        token: "pat",
        defaultProject: "PROJ",
      },
    });

    const result = await callHandler<{ error?: string; message?: string }>(tools, "jira_create_issue", {
      preview_id: "missing",
    });

    expect(result.error).toBe("preview_required");
    expect(result.message).toContain("jira_preview_issue");
    expect(fetchImpl).not.toHaveBeenCalled();
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

    const preview = await callHandler<{ preview_id: string }>(tools, "jira_preview_issue", {
      summary: "Declined",
      description: "Details",
    });
    const result = await callHandler<{ error?: string }>(tools, "jira_create_issue", {
      preview_id: preview.preview_id,
    });

    expect(result.error).toBe("user_declined");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("jira_create_issue includes request failure cause and hints", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND jira.example"), { code: "ENOTFOUND" });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause });
    }) as unknown as typeof fetch;
    const tools = jiraTools({
      confirmations: autoConfirm(true),
      fetchImpl,
      config: {
        baseUrl: "https://jira.example",
        token: "pat",
        defaultProject: "PROJ",
      },
    });

    const preview = await callHandler<{ preview_id: string }>(tools, "jira_preview_issue", {
      summary: "Network failure",
      description: "Details",
    });
    const result = await callHandler<{
      error?: string;
      message?: string;
      cause?: string | null;
      code?: string | null;
      hint?: string | null;
      url?: string;
    }>(tools, "jira_create_issue", {
      preview_id: preview.preview_id,
    });

    expect(result.error).toBe("request_failed");
    expect(result.url).toBe("https://jira.example/rest/api/2/issue");
    expect(result.message).toBe("fetch failed");
    expect(result.cause).toContain("ENOTFOUND");
    expect(result.code).toBe("ENOTFOUND");
    expect(result.hint).toContain("resolved");
  });

  it("jira_create_issue returns invalid_config for malformed Jira base URLs", async () => {
    const tools = jiraTools({
      confirmations: autoConfirm(true),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      config: {
        baseUrl: "jira.example",
        token: "pat",
        defaultProject: "PROJ",
      },
    });

    const preview = await callHandler<{ preview_id: string }>(tools, "jira_preview_issue", {
      summary: "Bad URL",
      description: "Details",
    });
    const result = await callHandler<{ error?: string; message?: string }>(tools, "jira_create_issue", {
      preview_id: preview.preview_id,
    });

    expect(result.error).toBe("invalid_config");
    expect(result.message).toContain("AURA_JIRA_BASE_URL");
  });
});
