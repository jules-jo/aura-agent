export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "unknown error";
}

/**
 * Format an upstream error for the TUI. Detects the OpenAI
 * "high-risk cyber activity" safety filter (CAPIError 400) that fires on
 * ssh / remote-command prompts and tells the user how to work around it
 * (switch to a non-OpenAI model via /model).
 */
export function friendlyErrorMessage(err: unknown, currentModel: string | undefined): string {
  const raw = toErrorMessage(err);
  if (isOpenAiSafetyBlock(raw)) {
    const onOpenAi = currentModel !== undefined && /^gpt[- ]?/i.test(currentModel);
    const hint = onOpenAi
      ? `The current model (${currentModel}) flagged this prompt under OpenAI's cybersecurity safety check. Try '/model' to switch to a non-OpenAI model (e.g. a Claude variant) and re-send the request.`
      : "The provider flagged this prompt under a cybersecurity safety check. Try '/model' to switch to a different model and re-send the request.";
    return `${raw}\n\n${hint}`;
  }
  return raw;
}

function isOpenAiSafetyBlock(message: string): boolean {
  if (!/CAPIError/i.test(message)) return false;
  if (!/\b400\b/.test(message)) return false;
  return /flagged|cyber|safety[- ]check/i.test(message);
}
