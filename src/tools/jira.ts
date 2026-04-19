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

const createFromPreviewSchema = z.object({
  preview_id: z.string().min(1).describe("Preview id returned by jira_preview_issue."),
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

interface JiraIssueDraft {
  preview_id: string;
  project_key: string;
  summary: string;
  description: string;
  issue_type: string;
  labels: string[];
}

export function jiraTools(options: JiraToolsOptions): Tool<any>[] {
  const previews = new Map<string, JiraIssueDraft>();
  let nextPreviewId = 0;

  const previewIssueTool = defineTool("jira_preview_issue", {
    description:
      "Prepare and return the exact Jira issue fields that would be created. This does not create anything. Always use this before jira_create_issue.",
    parameters: createIssueSchema,
    handler: async (args) => {
      const config = normalizeConfig(options.config);
      if ("error" in config) return config;

      const draft = buildDraft(args, config, `jp${nextPreviewId++}`);
      if ("error" in draft) return draft;
      previews.set(draft.preview_id, draft);
      return {
        ...draft,
        preview_markdown: formatDraftPreview(draft),
      };
    },
  });

  const createIssueTool = defineTool("jira_create_issue", {
    description:
      "Create a Jira issue from a prior jira_preview_issue preview_id. This is side-effecting and always asks the user for final confirmation first.",
    parameters: createFromPreviewSchema,
    handler: async (args) => {
      const config = normalizeConfig(options.config);
      if ("error" in config) return config;

      const draft = previews.get(args.preview_id);
      if (!draft) {
        return {
          error: "preview_required",
          message: "Call jira_preview_issue first, show the preview to the user, and pass its preview_id after approval.",
        };
      }

      const approved = await options.confirmations.request({
        summary: `create Jira issue in ${draft.project_key}`,
        detail: formatDraftPreview(draft),
      });
      if (!approved) {
        return { error: "user_declined", preview_id: draft.preview_id, project_key: draft.project_key };
      }

      const fetchImpl = options.fetchImpl ?? fetch;
      const urlResult = buildJiraUrl(config.baseUrl, "/rest/api/2/issue");
      if ("error" in urlResult) return urlResult;
      let response: Response;
      try {
        response = await fetchImpl(urlResult.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fields: buildJiraFields(draft),
          }),
        });
      } catch (err: unknown) {
        const details = describeRequestError(err);
        return {
          error: "request_failed",
          url: urlResult.url,
          message: details.message,
          cause: details.cause,
          code: details.code,
          hint: details.hint,
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
      const browseUrl = key ? buildJiraUrl(config.baseUrl, `/browse/${key}`) : null;
      previews.delete(draft.preview_id);
      return {
        key,
        url: browseUrl && !("error" in browseUrl) ? browseUrl.url : null,
        self: typeof body.self === "string" ? body.self : null,
        project_key: draft.project_key,
        issue_type: draft.issue_type,
      };
    },
  });

  return [previewIssueTool, createIssueTool];
}

export function jiraConfigFromEnv(env: NodeJS.ProcessEnv): JiraConfig {
  const token = env.AURA_JIRA_TOKEN ?? env.AURA_JIRA_PAT;
  return {
    ...(env.AURA_JIRA_BASE_URL !== undefined ? { baseUrl: env.AURA_JIRA_BASE_URL } : {}),
    ...(token !== undefined ? { token } : {}),
    ...(env.AURA_JIRA_DEFAULT_PROJECT !== undefined ? { defaultProject: env.AURA_JIRA_DEFAULT_PROJECT } : {}),
  };
}

function normalizeConfig(config: JiraConfig):
  | { baseUrl: string; token: string; defaultProject?: string }
  | { error: "missing_config"; missing: string[]; message: string } {
  const baseUrl = config.baseUrl;
  const token = config.token;
  const missing: string[] = [];
  if (!baseUrl) missing.push("AURA_JIRA_BASE_URL");
  if (!token) missing.push("AURA_JIRA_TOKEN or AURA_JIRA_PAT");
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

function buildDraft(
  args: z.infer<typeof createIssueSchema>,
  config: { defaultProject?: string },
  previewId: string,
): JiraIssueDraft | { error: "missing_project"; message: string } {
  const projectKey = args.project_key ?? config.defaultProject;
  if (!projectKey) {
    return {
      error: "missing_project",
      message: "project_key is required when AURA_JIRA_DEFAULT_PROJECT is not set",
    };
  }
  return {
    preview_id: previewId,
    project_key: projectKey,
    summary: args.summary,
    description: args.description,
    issue_type: args.issue_type ?? DEFAULT_ISSUE_TYPE,
    labels: args.labels ?? [],
  };
}

function buildJiraFields(draft: JiraIssueDraft): Record<string, unknown> {
  return {
    project: { key: draft.project_key },
    summary: draft.summary,
    description: draft.description,
    issuetype: { name: draft.issue_type },
    ...(draft.labels.length > 0 ? { labels: draft.labels } : {}),
  };
}

function formatDraftPreview(draft: JiraIssueDraft): string {
  return [
    `project: ${draft.project_key}`,
    `issue_type: ${draft.issue_type}`,
    `summary: ${draft.summary}`,
    `labels: ${draft.labels.length > 0 ? draft.labels.join(", ") : "(none)"}`,
    "description:",
    draft.description,
  ].join("\n");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildJiraUrl(
  baseUrl: string,
  path: string,
): { url: string } | { error: "invalid_config"; message: string } {
  try {
    return { url: new URL(path, baseUrl).toString() };
  } catch (err: unknown) {
    return {
      error: "invalid_config",
      message: `AURA_JIRA_BASE_URL must be an absolute URL including http:// or https:// (${toErrorMessage(err)})`,
    };
  }
}

function describeRequestError(err: unknown): {
  message: string;
  cause: string | null;
  code: string | null;
  hint: string | null;
} {
  const message = toErrorMessage(err);
  const cause = readCause(err);
  const code = readErrorCode(err) ?? readErrorCode(cause);
  return {
    message,
    cause: cause ? toErrorMessage(cause) : null,
    code,
    hint: hintForRequestFailure(message, cause ? toErrorMessage(cause) : null, code),
  };
}

function readCause(err: unknown): unknown {
  return typeof err === "object" && err !== null && "cause" in err
    ? (err as { cause?: unknown }).cause
    : null;
}

function readErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function hintForRequestFailure(message: string, cause: string | null, code: string | null): string | null {
  const combined = [message, cause, code].filter(Boolean).join(" ");
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(combined)) {
    return "Jira host could not be resolved. Check AURA_JIRA_BASE_URL, DNS, VPN, and corporate network access.";
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(combined)) {
    return "Aura could not connect to Jira. Check VPN/firewall/proxy access from the machine running aura.";
  }
  if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT/i.test(combined)) {
    return "TLS verification failed. Configure your company CA with NODE_EXTRA_CA_CERTS before starting aura.";
  }
  if (/proxy/i.test(combined)) {
    return "This may require corporate proxy configuration. Node fetch does not always use shell proxy settings automatically.";
  }
  return "No HTTP response was received from Jira. Check the Jira URL, network/VPN, proxy, and TLS certificate trust.";
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}
