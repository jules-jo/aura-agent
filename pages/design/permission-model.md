---
tags: [design, permissions]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Permission Model

*Human-in-the-loop by default: the agent asks before any side-effecting tool call. A bypass flag flips the whole session to autonomous (human-out-of-the-loop), exactly like Claude Code's `--dangerously-skip-permissions`.*

Resolution of [[open-questions]] Q7.

## Modes

| Mode | When each side-effect is run |
|---|---|
| **HITL (default)** | Agent proposes the call; TUI shows approve/deny; call executes only after approval. |
| **Bypass** | Side-effects execute automatically. User opts in per session (`--bypass` flag or an in-TUI toggle). |

## What counts as "side-effecting"

Tools split into two buckets. Only the side-effecting bucket triggers an
approval prompt.

| Read-only (no prompt) | Side-effecting (prompt unless bypass) |
|---|---|
| `wiki.read` | `wiki.write` |
| `catalog.lookup_test` | `ssh.dispatch` |
| `ssh.poll` | `notify.tui` (optional -- almost always allow) |
| `parse.test_output` | any future tool that writes files, sends network requests, or mutates remote state |

The model always knows which bucket a tool is in; the permission hook is the
enforcement point.

## UX (TUI)

When a side-effecting call is proposed, the TUI renders something like:

```
+-- proposed action --------------------------+
| ssh.dispatch                                |
|   host: runner-01.example.com               |
|   cmd:  pytest -q tests/test_x.py           |
+---------------------------------------------+
[a] approve once    [A] approve session    [d] deny
```

- `a` -- one-shot approval for this call.
- `A` -- approve this exact tool+argument shape for the rest of the session
  (per-session allowlist -- see below).
- `d` -- deny; the model sees the denial as tool output and re-plans.

## Per-session allowlist

Nice-to-have, not v1 blocker. When the user hits `A`, the TUI records a rule
like `ssh.dispatch host=runner-01.example.com` and auto-approves further calls
that match. Reset at session end. Out-of-scope for v1; revisit after the core
loop works.

## Bypass mode

- Enabled via a launch flag (`aura --bypass`) or dangerous-style aliases
  (`--dangerously-skip-permissions`,
  `--dangerously-bypass-approvals-and-sandbox`).
- Applies session-wide. A bypassed session prints a persistent banner so the
  user can't miss that approvals are off.
- Rationale: the brief explicitly wants agent-in-the-loop as an opt-in mirror of
  Claude Code's bypass mode.

## Implementation note

Enforced via a Copilot SDK hook on tool invocation. See [[copilot-sdk]] for the
open question about whether hooks can synchronously block until a user callback
resolves; the approve/deny UX depends on it.
