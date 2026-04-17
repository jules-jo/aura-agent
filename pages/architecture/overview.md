---
tags: [architecture, overview]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Architecture Overview

*High-level shape of aura-agent: a Node/TS TUI that drives a Copilot SDK session, which calls MCP tools to execute tests over SSH, monitor them, and summarise.*

## The picture

```
+----------------------------+
|          TUI               |   Ink (React-for-CLI) or blessed.
|  chat pane | status pane   |   Streams model output; renders
|   progress | permissions   |   tool-call approvals.
+-------------+--------------+
              |
              v
+----------------------------+
|  Copilot SDK session       |   @github/copilot-sdk
|  CopilotClient             |   Model: user-chosen (e.g. gpt-4.1).
|  createSession({ model })  |   Streams assistant.message_delta.
|  hooks (permissions)       |   Hooks gate side-effecting tool calls.
+-------------+--------------+
              |
              v
+----------------------------+
|   MCP tool surface         |   Tools the agent can call.
|  wiki.read / wiki.write    |   Read test specs + write run logs.
|  catalog.lookup_test       |   Resolve "run test X" -> spec.
|  ssh.dispatch              |   Fire a command on a remote host.
|  ssh.poll                  |   Poll remote process at iteration
|                            |   boundaries (see [[execution-and-monitoring]]).
|  parse.test_output         |   Structured pass/fail/duration.
|  notify.tui                |   Push a message into the TUI banner.
+-------------+--------------+
              |
              v
+----------------------------+
|   SSH target(s)            |   Remote hosts defined per-test
|   (the "desired system")   |   in the test catalog.
+----------------------------+
```

## Layers

### TUI (the surface)
- Built on **Ink** (React for the terminal). Chosen 2026-04-17 over blessed for the component model and alignment with modern agent CLIs (Claude Code, OpenAI CLI, `gh copilot`).
- Two primary regions: a chat pane (model conversation) and a live run pane (current test state, streaming output, tool-call approvals).
- All user input is natural language. Permission prompts appear inline as approve/deny on side-effecting tool calls (see [[permission-model]] and [[copilot-sdk-hooks]]).
- The SDK's built-in elicitation primitives (`session.ui.confirm / select / input`) cover most prompt UX; bespoke Ink widgets are only introduced where the elicitation form isn't expressive enough.

### Copilot SDK session (the brain)
- `@github/copilot-sdk`, Node 18+.
- Authentication delegates to the GitHub Copilot CLI (`gh copilot`).
- Session state is in-memory within the process -- this covers *conversational* memory for the duration of the TUI run. It does **not** cover crash recovery across process deaths; that lives in [[persistence-and-recovery]].
- Hooks are used to interpose on tool calls and trigger the TUI's approval flow.

### MCP tool surface (the hands)
- Every side-effecting capability is a tool the model calls, not a hard-coded step. That way the loop that runs the test is the same loop that answers ad-hoc questions.
- Tools the agent needs (v1):
  - `wiki.read`, `wiki.write` -- read specs, write run logs.
  - `catalog.lookup_test(name)` -- resolve a user reference to a test spec page.
  - `ssh.dispatch(host, cmd)` -- fire a command on a remote host.
  - `ssh.poll(run_id)` -- fetch latest output / status for a running command. Poll at module / iteration boundaries (see [[execution-and-monitoring]]).
  - `parse.test_output(text, format)` -- produce `{pass, fail, duration, failures[]}`.
  - `notify.tui(channel, message)` -- render in the TUI.
- Each tool is declared to the SDK via MCP so the model can call it. Side-effecting tools (`ssh.dispatch`, `wiki.write`) require approval unless the session is in bypass mode.

### SSH targets (the environment)
- Primary execution path is remote, over SSH. Local is a special case of SSH-to-localhost for dev/debug.
- Host, user, keyfile/credentials, and working directory are per-test, stored in the test catalog (see [[test-catalog]]).

## Language / runtime

Node.js + TypeScript. Pinned by the Copilot SDK choice (see [[copilot-sdk]]).

## What the agent loop looks like at runtime

1. User: "run test X".
2. Model calls `catalog.lookup_test("X")` -> gets spec.
3. Model checks the spec for required args; if any are missing, asks the user.
4. Model proposes `ssh.dispatch(...)`. TUI shows approval; user approves (or bypass is on).
5. Model calls `ssh.poll(...)` at module boundaries; prints interpretable progress to the TUI.
6. On each poll, model calls `parse.test_output(...)` to keep a running structured state.
7. On an error signal, model consults the spec's stop/notify policy and either halts via `ssh.dispatch("kill ...")` or pushes a `notify.tui(...)` and keeps polling.
8. At completion: model renders the final summary (user-specified template if present, structured default otherwise) and appends a run page to the wiki via `wiki.write`.

## See also

- [[copilot-sdk]] -- what the SDK gives us and what we build on top.
- [[test-catalog]] -- wiki-backed test specs with stop/notify and summary-template fields.
- [[permission-model]] -- HITL-by-default with bypass; side-effect-only prompts.
- [[execution-and-monitoring]] -- SSH dispatch and iteration-boundary polling.
- [[summary-format]] -- structured defaults and per-test overrides.
- [[persistence-and-recovery]] -- auto-logging vs session memory vs crash recovery.
