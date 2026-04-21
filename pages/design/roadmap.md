---
tags: [design, roadmap, plan]
created: 2026-04-17
updated: 2026-04-21
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Roadmap

*Phased plan for building aura-agent v1. Each phase ships something runnable; no phase is pure plumbing. Ordered to de-risk the hardest integration (Copilot SDK + Ink + Windows) first and defer everything that can be deferred.*

## Phase 0 -- Walking skeleton

**Goal**: Ink TUI boots on Windows, Copilot SDK session is live, user can type a
prompt and see a streaming model response. No tools, no tests, no wiki.

Ships:
- Node 18 project scaffold, TypeScript, ESM, `tsx` runner.
- `@github/copilot-sdk` wired via `CopilotClient` + `createSession({ model })`.
- `gh copilot` auth path verified on Windows.
- Ink app with two panes (chat, placeholder run pane).
- Streaming assistant deltas render in the chat pane.

Done when: running `npx aura` on a Windows Terminal opens the TUI; a prompt
round-trips to the model and streams back.

Out of scope: tools, catalog, SSH, credentials, permissions.

## Phase 1 -- Local dispatch loop

**Goal**: prove the whole "dispatch -> poll -> summarise" loop pattern with the
simplest possible tool. Before SSH, before catalog, before credentials.

Ships:
- One MCP tool server exposing `local.dispatch(command)` and `local.poll(run_id)`.
- A temporary tool `local.run_simple` that runs a local command, streams stdout into a ring buffer, returns structured poll results with synthetic "iteration" entries (one per N lines).
- TUI run pane renders iterations as they arrive.
- Agent summarises at completion with the structured default from [[summary-format]].

Done when: user types "run `pytest` in this directory"; model calls the local tool;
TUI shows a live progress feed; final summary renders. No permission prompt yet
(everything auto-allowed).

Out of scope: SSH, catalog, credentials, permissions, reattach, compaction.

## Phase 2 -- SSH execution

**Goal**: swap the local tool for real SSH against one host.

Ships:
- `ssh.dispatch` / `ssh.poll` / `ssh.kill` MCP tools using `ssh2`.
- Detached remote process with PID file + remote log file.
- Per-call password prompt (in-memory only; no credentials file yet).
- Run-state JSON on disk under `%APPDATA%\aura\Data\runs\<run_id>.json` (used for reattach in Phase 7, but written from the start so we don't refactor the tool later).

Done when: user runs a remote shell command over SSH; TUI shows polled
progress; dropping the SSH connection does not kill the remote process.

Out of scope: catalog, credentials file, permissions, reattach flow, parsing.

## Phase 3 -- Wiki-backed test catalog

**Goal**: "run test X" resolves by name instead of requiring an inline command.

Ships:
- `wiki.read` / `wiki.write` / `catalog.lookup_test` MCP tools.
- Test spec schema per [[test-catalog]]: frontmatter fields for host, command, args, framework, errors, summary.
- Missing-argument flow: agent uses `session.ui.input / select` to prompt the user when a required `args[]` entry is absent.
- First real test spec page (smoke test on the dev host) to anchor the pattern.

Done when: "run test X" works end-to-end from a catalog page, including prompting for missing args.

Out of scope: credentials file (still per-call password), permission prompts, parsing, reattach.

## Phase 4 -- Credentials store

**Goal**: remove plaintext passwords from every surface except the in-memory store.

Ships:
- `age`-encrypted `%APPDATA%\aura\Config\credentials.age` per [[credentials]].
- Master-passphrase prompt on startup; decrypted buffer in memory only, zeroised on exit.
- `/creds add|remove|list|rotate-passphrase` slash commands.
- Test specs migrated to `credential_id`; per-call password prompt removed.

Done when: passwords exist only inside the encrypted file and the in-memory
store; no spec, log, or tool-call argument contains a plaintext password.

Out of scope: DPAPI auto-unlock (deferred), keychain fallback.

## Phase 5 -- Permission model

**Goal**: HITL-by-default with opt-in bypass, matching Claude Code's behaviour.

Ships:
- `Tool.skipPermission: true` on read-only tools (`wiki.read`, `catalog.lookup_test`, `ssh.poll`, `parse.test_output`).
- `onPreToolUse` hook on the SDK session per [[copilot-sdk-hooks]].
  - Returns `{ permissionDecision: "allow" }` for read-only tools and when bypass is on.
  - Otherwise `await session.ui.confirm(...)` with a human-readable proposal, returns allow/deny.
- `aura --bypass` launch flag + persistent in-TUI banner when bypass is on.
- Deny flow: denied tool call surfaces as tool output; model re-plans.

Done when: every side-effecting tool prompts when bypass is off; bypass mode
runs autonomously with the banner visible; denials are recoverable without
aborting the session.

Out of scope: per-session allowlist ("approve session" button) -- deferred.

## Phase 6 -- Structured monitoring and summary

**Goal**: polled output becomes interpretable structured state; summaries honour per-test templates; runs auto-log to the wiki.

Ships:
- `parse.test_output(text, framework)` MCP tool. Framework `pytest` first; `go test` and generic regex-driven parser follow.
- Iteration-boundary rendering in the TUI (only re-render when a new structured event arrives, not on every poll).
- `errors:` block evaluation: classify each failure, apply `stop` (calls `ssh.kill`) or `notify`.
- Structured summary object + Mustache template rendering from [[summary-format]].
- Auto-log flow: `wiki.write` produces `pages/runs/<date>-<slug>-<run_id>.md` and a one-line entry in `log.md`.

Done when: a real test run produces a clean progress feed, the
stop/notify policy fires correctly for seeded failures, and the wiki gains a
run page with the structured summary on completion.

Out of scope: compaction, reattach, per-session allowlist.

## Phase 7 -- Crash recovery (reattachment, v1 requirement)

**Goal**: a TUI crash during a running remote test is fully recoverable.

Ships:
- Startup scan of `%APPDATA%\aura\Data\runs\` for run-state JSON files without a completion record.
- For each: SSH to the host, check the remote PID file, `kill -0 <pid>` (or Windows equivalent) to verify the process is alive.
- If alive: offer to reattach; on approval, tail the remote log from the last known offset, rebuild the iteration stream via `parse.test_output`, and resume the normal monitoring loop.
- If dead: fetch remaining output, write the missing run page + log entry retrospectively, mark the run-state file complete.
- Orphaned / unresolvable state moved to `runs/orphaned/` and forgotten.

Done when: pulling the plug on the TUI mid-run and restarting it within the
timeout window resumes polling and produces a correct final summary.

Out of scope: cross-session conversational memory; partial-module resume.

## Phase 8 -- Context compaction

**Goal**: a 30-minute run doesn't bloat the session past the SDK's thresholds.

Ships:
- `InfiniteSessionConfig` enabled with defaults (80% / 95%).
- `onPostToolUse` rollup hook over `ssh.poll` per [[context-compaction]]: verbatim last K iterations + every failure; older non-failures replaced by synthetic rollup entries.
- Rollup cadence + K tunable via an app-level config; no per-test tuning in v1.

Done when: a seeded long run completes without blocking on the SDK's
compaction buffer; the final summary still has exact pass/fail counts
because the full history lives in the run page.

Out of scope: per-test compaction tuning; summarisation quality metrics.

## Phase 9 -- Polish and deferred wins

Order by whatever bites first when dogfooding:

- Per-session tool-call allowlist ("approve for session" button).
- Windows DPAPI wrapping the `age` key -- unlock without passphrase prompt.
- Skill-per-test: ship a prompt module with the spec for failure classification hints (Q19).
- SDK session resume via `onSessionStart.source: "resume"` for conversational continuity across restarts (Q18).
- Additional test-output parsers (go test, JUnit XML, generic regex).
- OS notifications once the user walks away from the TUI -- out of the TUI-only v1 scope, but cheap to bolt on.

## Phase 10 -- Change intake and autonomous test planning

**Goal**: aura can inspect a structured change source, decide which cataloged
tests should run, and present a test plan with reasons.

Ships:
- Change-source readers for at least one practical source, likely Excel/CSV
  first. Later sources can include Google Sheets, Jira filters, Git diffs, or
  database exports.
- Normalized `changed_item` records with stable fields such as component,
  requirement id, file/path, owner, risk, and free-form notes.
- Test-selection metadata in `pages/tests/*.md`, for example covered
  components, requirement ids, tags, risk areas, or explicit matching rules.
- `plan_tests_for_changes` orchestration: input changed items, output selected
  tests, target systems, required args still missing, and human-readable
  selection reasons.
- Permission-aware run-plan approval: user can approve the whole plan or edit
  the selected tests before execution.
- Report summary: what changed, what was selected, why, what ran, and what
  passed/failed.

Done when: given a representative spreadsheet/change export, aura proposes a
defensible test plan, asks for approval, runs the approved tests, and reports
the results without the user naming each test manually.

Out of scope: true multi-agent execution, continuous watchers/daemons, and
fully unattended operation without the Phase 5 permission policy.

## Phase 11 -- Multi-agent execution and reporting

**Goal**: split autonomous planning/running/reporting into coordinated agents
only after the single-agent planner is stable.

Ships:
- Initial scaffold: `agent_delegate` can call a read-only `batch_planner`
  sidecar agent for spreadsheet/batch-test planning. This is intentionally
  planning-only; it cannot dispatch tests or perform side effects.
- One coordinator/planner agent that owns change intake, test selection, run
  deduplication, and final user-facing decisions.
- One or more runner agents that execute approved tests, ideally scoped by
  target system or test group.
- Optional reporter/Jira agent that turns structured run results into final
  summaries and issue drafts.
- Shared durable state for plans, runs, ownership, retries, and already-filed
  Jira issues so agents do not duplicate work.
- Clear cancellation and approval semantics: the coordinator remains the
  authority for starting, stopping, and escalating side effects.

Done when: aura can run an approved multi-test plan across multiple targets
with independent runner agents, preserve a coherent final summary, and avoid
duplicate runs or duplicate Jira tickets.

Out of scope: multi-user scheduling, distributed service deployment, and
always-on production operation.

## Dependencies at a glance

```
P0 (skeleton)
 +-- P1 (local dispatch)
       +-- P2 (SSH)
             +-- P3 (catalog)        +-- P4 (credentials)
                   \\--+---+---------/
                       v
                      P5 (permissions)
                       v
                      P6 (parse, summary, auto-log)
                       v
                      P7 (reattach)
                       v
                      P8 (compaction)
                       v
                      P9 (polish)
                       v
                      P10 (change intake, test planning)
                       v
                      P11 (multi-agent execution)
```

P3 and P4 can partially overlap (P4 only depends on P3 at the catalog-schema
level, not on its MCP tool work). Everything from P5 onward assumes P1-P4 are
in place. P10 assumes P6 summaries/logging and P5 permissions are solid enough
to support plan approval. P11 assumes P10 has a deterministic single-agent
planner to coordinate from.

## Explicit non-goals for v1

- Cross-channel notifications (Slack / Teams / email). TUI only.
- Multi-user / multi-tenant operation.
- Containerised or CI-triggered test targets.
- Parallel or multi-agent test execution before P11.
- Web UI or anything that isn't the terminal.

## Related

- [[architecture/overview]] -- overall shape the phases are building toward.
- [[open-questions]] -- deferred items tracked against phases.
- [[persistence-and-recovery]] -- reattach details expanded.
- [[context-compaction]] -- compaction rollup details expanded.
