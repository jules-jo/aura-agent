import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";
import type { Tool } from "@github/copilot-sdk";

const notificationSchema = z.object({
  title: z.string().min(1).describe("Teams notification title."),
  text: z.string().min(1).describe("Short notification body."),
  status: z.enum(["passed", "failed", "completed", "cancelled"]).optional(),
  facts: z
    .array(
      z.object({
        name: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .optional()
    .describe("Optional facts to render in the Teams card."),
});

type TeamsNotification = z.infer<typeof notificationSchema>;

export interface TeamsConfig {
  webhookUrl?: string;
  notifyOnComplete?: boolean;
}

export interface TeamsToolsOptions {
  config: TeamsConfig;
  fetchImpl?: typeof fetch;
}

export interface SendTeamsNotificationOptions {
  config: TeamsConfig;
  notification: TeamsNotification;
  fetchImpl?: typeof fetch;
}

export function teamsTools(options: TeamsToolsOptions): Tool<any>[] {
  const notifyTool = defineTool("teams_send_notification", {
    description:
      "Send a Microsoft Teams notification through the configured Teams Workflows webhook. Use after a test run completes.",
    parameters: notificationSchema,
    handler: async (args) => {
      return sendTeamsNotification({
        config: options.config,
        notification: args,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
    },
  });

  return [notifyTool];
}

export function teamsConfigFromEnv(env: NodeJS.ProcessEnv): TeamsConfig {
  return {
    ...(env.AURA_TEAMS_WEBHOOK_URL !== undefined ? { webhookUrl: env.AURA_TEAMS_WEBHOOK_URL } : {}),
    ...(env.AURA_TEAMS_NOTIFY_ON_COMPLETE !== undefined
      ? { notifyOnComplete: parseEnvBoolean(env.AURA_TEAMS_NOTIFY_ON_COMPLETE) }
      : {}),
  };
}

export async function sendTeamsNotification(options: SendTeamsNotificationOptions): Promise<Record<string, unknown>> {
  if (options.config.notifyOnComplete === false) {
    return { disabled: true, reason: "AURA_TEAMS_NOTIFY_ON_COMPLETE is disabled" };
  }
  if (!options.config.webhookUrl) {
    return {
      error: "missing_config",
      missing: ["AURA_TEAMS_WEBHOOK_URL"],
      message: "Set AURA_TEAMS_WEBHOOK_URL to a Teams Workflows webhook URL.",
    };
  }

  const url = buildWebhookUrl(options.config.webhookUrl);
  if ("error" in url) return url;

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildMessageCard(options.notification)),
    });
  } catch (err: unknown) {
    const details = describeRequestError(err);
    return {
      error: "request_failed",
      url: url.url,
      message: details.message,
      cause: details.cause,
      code: details.code,
      hint: details.hint,
    };
  }

  if (!response.ok) {
    return {
      error: "teams_error",
      status: response.status,
      message: await safeResponseText(response),
    };
  }

  return {
    sent: true,
    status: options.notification.status ?? "completed",
    title: options.notification.title,
  };
}

function buildMessageCard(args: TeamsNotification): Record<string, unknown> {
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: args.title,
    themeColor: themeColor(args.status ?? "completed"),
    title: args.title,
    text: args.text,
    ...(args.facts && args.facts.length > 0
      ? {
          sections: [
            {
              facts: args.facts,
            },
          ],
        }
      : {}),
  };
}

function themeColor(status: "passed" | "failed" | "completed" | "cancelled"): string {
  switch (status) {
    case "passed":
      return "2EB886";
    case "failed":
      return "D13438";
    case "cancelled":
      return "8A8886";
    case "completed":
      return "0078D4";
  }
}

function parseEnvBoolean(value: string): boolean {
  return !/^(0|false|no|off)$/i.test(value.trim());
}

function buildWebhookUrl(value: string): { url: string } | { error: "invalid_config"; message: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return {
        error: "invalid_config",
        message: "AURA_TEAMS_WEBHOOK_URL must start with http:// or https://",
      };
    }
    return { url: url.toString() };
  } catch (err: unknown) {
    return {
      error: "invalid_config",
      message: `AURA_TEAMS_WEBHOOK_URL must be an absolute URL (${toErrorMessage(err)})`,
    };
  }
}

function describeRequestError(err: unknown): {
  message: string;
  cause: string | null;
  code: string | null;
  hint: string;
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

function hintForRequestFailure(message: string, cause: string | null, code: string | null): string {
  const combined = [message, cause, code].filter(Boolean).join(" ");
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(combined)) {
    return "Teams webhook host could not be resolved. Check AURA_TEAMS_WEBHOOK_URL, DNS, VPN, and corporate network access.";
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(combined)) {
    return "Aura could not connect to Teams. Check VPN/firewall/proxy access from the machine running aura.";
  }
  if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT/i.test(combined)) {
    return "TLS verification failed. Configure your company CA with NODE_EXTRA_CA_CERTS before starting aura.";
  }
  return "No HTTP response was received from Teams. Check the webhook URL, network/VPN, proxy, and TLS certificate trust.";
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
