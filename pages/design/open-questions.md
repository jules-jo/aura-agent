---
tags: [design, open-questions]
created: 2026-04-16
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Open Questions

*Ambiguities tracked to resolution. Each item has a question, why it matters, and a resolution pointer (or "open").*

## Resolved

### Q1. Which "GitHub Copilot SDK"? -> [[copilot-sdk]]
`@github/copilot-sdk` (Node.js / TypeScript). Standalone SDK, auth via `gh copilot` CLI, supports MCP tools, hooks, skills, sub-agents, streaming.

### Q2. Execution target? -> [[execution-and-monitoring]]
SSH-remote. Local is treated as SSH-to-localhost.

### Q3. Test definition / discovery? -> [[test-catalog]]
Wiki-backed catalog under `pages/tests/`. `catalog.lookup_test` resolves friendly names.

### Q4. Poll or stream? -> [[execution-and-monitoring]]
Poll at module / iteration boundaries.

### Q5. Stop-vs-notify policy? -> [[test-catalog]]
Per-test `errors:` block in spec frontmatter, with a `default:`.

### Q6. Notification channel? -> TUI only for v1.

### Q7. Permission granularity? -> [[permission-model]]
Prompt on side-effecting tools only. Per-session allowlist deferred. Bypass flag flips the session.

### Q8. Persistence and recovery? -> [[persistence-and-recovery]]
Auto-log every run. SDK session memory distinct from durable run state; remote PID file + run-state JSON cover crash reattach.

### Q9. Summary shape? -> [[summary-format]]
Structured default + per-test Mustache template override.

### Q11. Can SDK hooks block a tool call async? -> [[copilot-sdk-hooks]]
Yes. `PreToolUseHandler` returns `Promise<PreToolUseHookOutput | void>`. Async await on user input is the intended pattern.

### Q12. MCP transport? -> [[copilot-sdk]]
Subprocess over stdio.

### Q13. TUI framework? -> [[architecture/overview]]
Ink.

### Q14. SSH credential storage? -> [[credentials]]
**Encrypted credentials file** (`age`-encrypted YAML) outside the wiki. Test spec references `credential_id`; password resolved from the encrypted store at dispatch time. Master passphrase typed once per session; decrypted buffer held in memory only and zeroised on exit. DPAPI auto-unlock on Windows is a deferred enhancement.

### Q15. Long-run context compaction? -> [[context-compaction]]
Hybrid: SDK `InfiniteSessionConfig` + test-aware rollup over `ssh.poll`.

### Q16. Host platform -> [[host-platform]]
Windows. Paths resolved via `env-paths`; `ssh2` for SSH (not `ssh.exe`); Windows Terminal is the primary target shell; Node 18+.

### Q17. Passphrase-protected SSH keys -> N/A
Password-based auth in use; key-auth passphrase flow not relevant for v1.

## Open (minor -- none block v1 design)

### Q18. SDK session resume vs our crash recovery -- LOW PRIORITY
The SDK exposes `onSessionStart` with `source: "startup" | "resume" | "new"`,
suggesting built-in session resume. Worth confirming whether we can delegate
*conversational* resume to the SDK. The remote-process reattachment in
[[persistence-and-recovery]] is still ours to own regardless -- the SDK
doesn't know about our in-flight SSH runs. This refines the implementation
but doesn't change the design. Settle when we start coding.

### Q19. Skills for per-test instructions -- DEFER
Could let a test spec ship a per-test skill ("how to classify failures
here"). Defer until we feel the absence.
