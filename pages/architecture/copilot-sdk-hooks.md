---
tags: [architecture, sdk, copilot, hooks, permissions]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Copilot SDK Hooks

*What the SDK gives us for interposing on tool calls -- and why the permission-prompt UX falls out cleanly.*

Resolution of [[open-questions]] Q11. Source: `nodejs/src/types.ts` in
`github/copilot-sdk`.

## The hooks surface

Six hook points. All handlers may be async (`Promise<T | void>` or sync
`T | void`):

| Hook | Fires when | Can do |
|---|---|---|
| `onPreToolUse` | Before a tool runs | Allow / deny / ask, modify args, inject context, suppress output |
| `onPostToolUse` | After a tool returns | Transform result, inject context, suppress output |
| `onUserPromptSubmitted` | User sends a prompt | Modify prompt, inject context |
| `onSessionStart` | Session boots | Inject context, modify config |
| `onSessionEnd` | Session terminates | Cleanup actions, session summary |
| `onErrorOccurred` | Any error | Retry / skip / abort, user notification |

## Why the permission prompt works asynchronously

`PreToolUseHandler` is declared:

```ts
export type PreToolUseHandler = (
    input: PreToolUseHookInput,
    invocation: { sessionId: string }
) => Promise<PreToolUseHookOutput | void> | PreToolUseHookOutput | void;

export interface PreToolUseHookOutput {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    modifiedArgs?: unknown;
    additionalContext?: string;
    suppressOutput?: boolean;
}
```

Because the return type includes `Promise<...>`, the handler can `await`
anything -- including a user-input promise from the TUI -- before it resolves.
That is exactly the block-until-approved UX we want. The hook holds the tool
call open; the TUI renders approve/deny; the user's answer resolves the
promise; the SDK proceeds with `allow` or `deny`.

## Three permission surfaces, use the right one

The SDK exposes related but distinct primitives. aura-agent uses all three for
different jobs:

| Surface | What it is | aura-agent uses it for |
|---|---|---|
| `Tool.skipPermission: true` | Static per-tool flag: this tool never prompts. | Read-only tools: `wiki.read`, `catalog.lookup_test`, `ssh.poll`, `parse.test_output`. |
| `SessionHooks.onPreToolUse` | Programmable gate on every tool call. | Side-effecting tools: `ssh.dispatch`, `wiki.write`. Decides allow/deny/ask by consulting bypass state + per-session allowlist, then calls `session.ui.confirm()` to render the TUI prompt. |
| `PermissionHandler` | Handler for server-originated permission requests (`"shell" \| "write" \| "mcp" \| "read" \| "url" \| "custom-tool"`). | Fallback for built-in permission requests we haven't classified ourselves. |

## The TUI prompt uses elicitation

`session.ui.confirm(message)` is the SDK's built-in confirm dialog -- backed by
the MCP elicitation primitive. `session.ui.input()` and `session.ui.select()`
cover the "ask the user for a missing test argument" UX out of the box. That
means we don't roll our own prompt widget for permission or missing-args
collection in v1; we let the SDK render via Ink.

## Sketch

```ts
const hooks: SessionHooks = {
  onPreToolUse: async (input) => {
    if (sessionBypassEnabled) return { permissionDecision: "allow" };
    if (allowlist.matches(input.toolName, input.toolArgs)) {
      return { permissionDecision: "allow" };
    }
    if (isReadOnly(input.toolName)) {
      return { permissionDecision: "allow" };
    }

    const approved = await session.ui.confirm(
      renderProposal(input.toolName, input.toolArgs)
    );
    return {
      permissionDecision: approved ? "allow" : "deny",
      permissionDecisionReason: approved ? undefined : "user denied",
    };
  },
};
```

## Related

- [[permission-model]] -- the HITL/bypass/allowlist behaviour this implements.
- [[copilot-sdk]] -- the rest of the SDK surface.
- [[open-questions]] Q11 closed.
