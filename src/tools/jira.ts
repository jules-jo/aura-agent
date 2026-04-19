import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";
import type { ConfirmationStore } from "../ssh/confirmation-store.js";

const DEFAULT_ISSUE_TYPE = "Bug";

const createIssueSchema = z.object({
  project_key: z.string().min(1).optional().describe("Jira project key. Defaults to AURA_JIRA_DEFAULT_PROJECT."),
  summary: z.string().min(1).describe("Issue summary/title."),
  description: z.string().min(1).describe("Issue description in plain text."),
  issue_type: z.string().min(1).optional().describe("Jira issue type. Defaults to Bug."),
  labels: z.array(z.string().min(1)).optional().describe("Optional labels to attach."),
});

export interface JiraConfig {
  baseUrl?: string;
  token?: string;
  defaultProject?: string;
}

export interface JiraToolsOptions {
  config: JiraConfig;
  confirmations: ConfirmationStore;
  fetchImpl?: typeof fetch;
}

interface JiraCreateResponse {
  key?: unknown;
  self?: unknown;
}

export function jiraTools(options: JiraToolsOptions): Tool<any>[] {
  const createIssueTool = defineTool("jira_create_issue", {
    description:
      "Create a Jira issue using the configured company Jira PAT. This is side-effecting and always asks the user for confirmation first.",
    parameters: createIssueSchema,
    handler: async (args) => {
      const config = normalizeConfig(options.config);
      if ("error" in config) return config;

      const projectKey = args.project_key ?? config.defaultProject;
      if (!projectKey) {
        return {
          error: "missing_project",
          message: "project_key is required when AURA_JIRA_DEFAULT_PROJECT is not set",
        };
      }

      const issueType = args.issue_type ?? DEFAULT_ISSUE_TYPE;
      const approved = await options.confirmations.request({
        summary: `create Jira issue in ${projectKey}`,
        detail: `${issueType}: ${args.summary}`,
      });
      if (!approved) {
        return { error: "user_declined", project_key: projectKey, summary: args.summary };
      }

      const fetchImpl = options.fetchImpl ?? fetch;
      const url = new URL("/rest/api/2/issue", config.baseUrl).toString();
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: {
              project: { key: projectKey },
              summary: args.summary,
              description: args.description,
              issuetype: { name: issueType },
              ...(args.labels !== undefined ? { labels: args.labels } : {}),
            },
          }),
        });
      } catch (err: unknown) {
        return {
          error: "request_failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }

      if (!response.ok) {
        return {
          error: "jira_error",
          status: response.status,
          message: await safeResponseText(response),
        };
      }

      const body = (await response.json().catch(() => ({}))) as JiraCreateResponse;
      const key = typeof body.key === "string" ? body.key : null;
      return {
        key,
        url: key ? new URL(`/browse/${key}`, config.baseUrl).toString() : null,
        self: typeof body.self === "string" ? body.self : null,
        project_key: projectKey,
        issue_type: issueType,
      };
    },
  });

  return [createIssueTool];
}

function normalizeConfig(config: JiraConfig):
  | { baseUrl: string; token: string; defaultProject?: string }
  | { error: "missing_config"; missing: string[]; message: string } {
  const baseUrl = config.baseUrl;
  const token = config.token;
  const missing: string[] = [];
  if (!baseUrl) missing.push("AURA_JIRA_BASE_URL");
  if (!token) missing.push("AURA_JIRA_TOKEN");
  if (!baseUrl || !token) {
    return {
      error: "missing_config",
      missing,
      message: `Set ${missing.join(", ")} before creating Jira issues.`,
    };
  }
  return {
    baseUrl: ensureTrailingSlash(baseUrl),
    token,
    ...(config.defaultProject !== undefined ? { defaultProject: config.defaultProject } : {}),
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}
