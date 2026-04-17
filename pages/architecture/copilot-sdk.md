---
tags: [architecture, sdk, copilot]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Copilot SDK

*What `@github/copilot-sdk` gives us and what aura-agent has to build on top.*

Resolution of [[open-questions]] Q1.

## What it is

A GitHub-published Node.js/TypeScript SDK for building applications that talk
to Copilot's models. The package is `@github/copilot-sdk`. It is a **standalone
SDK** -- you run it in your own process, it is not tied to VS Code or Copilot
Chat. Authentication delegates to the GitHub Copilot CLI (`gh copilot`), which
must be installed and authenticated on the host.

Docs: <https://docs.github.com/en/copilot/how-tos/copilot-sdk/sdk-getting-started>

## What it provides

| Primitive | API surface | Notes |
|---|---|---|
| Client | `CopilotClient` | Process-wide handle. |
| Session | `client.createSession({ model })` | Conversation state. Model chosen at creation (e.g. `"gpt-4.1"`). |
| Send | `session.sendAndWait(text)` | Single-turn send, wait for completion. |
| Streaming | `session.on("assistant.message_delta", ...)` | Token deltas as the model streams. |
| Readiness | `session.on("session.idle", ...)` | Signals ready for the next message. |
| Tools | **MCP server integration** | External tools exposed via MCP. |
| Skills | Custom skills (reusable prompt modules) | Scoped prompt bundles. |
| Hooks | Hooks subsystem | Interpose on session behaviour -- our permission hook point. |
| Sub-agents | Custom agents and sub-agent orchestration | Scoped tools + prompts per agent. |
| Observability | Built-in observability primitives | Useful for debugging the loop. |
| Ecosystem | Microsoft Agent Framework integration | Not needed for v1. |

## What aura-agent adds on top

| Concern | Where it lives |
|---|---|
| TUI surface | Ink or blessed (Node-native), not in the SDK. |
| Permission prompts | Hook on side-effecting tool calls -> TUI approve/deny. See [[permission-model]]. |
| Test catalog | Wiki pages + `catalog.lookup_test` MCP tool. See [[test-catalog]]. |
| SSH execution | `ssh.dispatch` + `ssh.poll` MCP tools on top of a node SSH client (`ssh2` or similar). See [[execution-and-monitoring]]. |
| Output parsing | `parse.test_output` MCP tool -- framework-aware, structured. |
| Auto-logging | `wiki.write` MCP tool invoked by the model after each run. See [[persistence-and-recovery]]. |

## Sessions vs durable state

The session object holds **conversational memory inside one process**. If the
TUI process dies, that memory dies with it. Anything that has to survive a
crash -- in-flight run state, partial output, the wiki itself -- has to be
written through an MCP tool to durable storage (the wiki, or a run-state file).
This is the distinction between session memory (SDK-provided) and crash
recovery (aura-agent's job). See [[persistence-and-recovery]].

## MCP transport -- subprocess (stdio)

Resolved 2026-04-17: aura-agent launches MCP tool servers as **subprocesses
over stdio**, the same pattern Claude Code and other MCP hosts use. Rationale:

- Tools stay swappable -- an SSH-execution server written later in Go or Rust drops in without touching aura-agent.
- Crash isolation: a bad tool server can't take down the TUI.
- Matches the broader MCP ecosystem, so third-party MCP servers can be added to a user's config without custom wiring.

Tradeoff accepted: a little more boilerplate and IPC latency vs. an
in-process registration shape. Fine for this workload.

## Hooks can block asynchronously

Resolved 2026-04-17: `PreToolUseHandler` returns a Promise; the TUI can hold a
tool call open until the user decides. See [[copilot-sdk-hooks]] for full
signatures and the code sketch.

## Built-in context compaction

Resolved 2026-04-17: the SDK ships `InfiniteSessionConfig` with background
compaction at 80% context utilisation and a hard blocking threshold at 95%.
We use it as the baseline and layer a test-aware rollup on top -- see
[[context-compaction]].

## Open items

- Model choice -- user may want to pin a specific model per session, or expose it as a TUI setting.
- Elicitation vs custom Ink widget for the permission prompt: the SDK's `session.ui.confirm()` is sufficient for v1, but a bespoke Ink widget gives us finer control (e.g. showing the full command). Decide when we write the TUI.
