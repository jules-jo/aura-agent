# Wiki Log

## [2026-04-17] build | P2 SSH execution landed
Added the SSH dispatch/poll/kill loop. Three new SDK-registered tools
(`ssh_dispatch`, `ssh_poll`, `ssh_kill`) in `src/tools/ssh-run.ts`; they sit
on top of a tiny `SshClient` abstraction (`src/ssh/ssh-client.ts`, ssh2-backed)
so tests inject a FakeSshClient without touching the network. Remote-side
primitives live in `src/ssh/remote-script.ts`: `buildDispatchScript` wraps the
user command in `mkdir -p <run-dir> && nohup sh -c '<cmd>; echo $? > exit'
> output.log 2>&1 &` with a PID file, so the remote process outlives a
dropped SSH connection; `buildTailScript` reads `STATE=running|stopped`,
`EXIT=<code>`, `SIZE=<bytes>`, and a byte-offset tail of the log, parsed by
`parsePollOutput` so each poll only pulls new bytes; `buildKillScript`
defaults to SIGTERM. `shellEscape` does POSIX single-quote escaping with
`'\\''`-for-apostrophe for safety. A background poller (started inside
`ssh_dispatch`, not the model) feeds new log bytes into the same `RunStore`
the local tools use, so the run pane shows remote runs live without any new
UI. `RunStateStore` (`src/ssh/run-state-store.ts`) writes run metadata as
JSON under `env-paths('aura').data/runs/<run_id>.json` -- Windows resolves
to `%APPDATA%\aura\Data\runs\` per the roadmap -- using a temp-file + rename
atomic-write so a mid-write reader never sees a truncated file. The record
is the reattach payload P7 will need (host, port, username, credential_id,
command, cwd, remote log/pid paths, timestamps, status). Credentials go
through `CredentialStore` (`src/ssh/credential-store.ts`): an in-memory
password map plus a pending-request queue; when `ssh_dispatch` calls
`credentials.request(...)` for an unknown credential, a promise sits in the
queue until the TUI's new `PasswordPrompt` component resolves it. The
component uses Ink's `useInput` with character masking and shows
`username@host (credential_id)` so the user always knows what they are
authenticating. The store snapshot is cached (same stable-reference trick
the `RunStore` uses for its `useSyncExternalStore` contract) so the prompt
does not loop. System message extended with Phase-2 instructions
(`phase2SystemMessage`) covering when to pick `ssh_*` over `local_*` and
that the TUI -- not the agent -- handles password collection. 25 new
vitest tests (credential store queueing, atomic run-state persistence,
script-builder edge cases, FakeSshClient-backed dispatch/poll/kill,
dispatch-failed path, password-request round-trip) on top of P1's 14 --
39 total, all green. Typecheck clean under `exactOptionalPropertyTypes`.
Out of scope for P2 and still deferred: catalog, `age`-encrypted credentials
file, HITL permission prompts, parsing, reattach flow.

## [2026-04-17] build | P1 local dispatch loop landed
Shipped the Phase 1 dispatch/poll pattern. Two SDK-registered tools
(`local_dispatch`, `local_poll`) defined via `defineTool` + Zod schemas in
`src/tools/local-run.ts`; they spawn a shell child (`shell: true` for
Windows/POSIX parity), stream stdout/stderr line-by-line into an in-process
`RunStore` (`src/runs/*`), bucket lines into iterations (default 20 lines =
1 iteration; tunable per dispatch), and expose a long-poll `waitForUpdate`
that holds the model's `local_poll` call open for up to `wait_ms` until a
new iteration or status change arrives -- no busy-waiting. Dispatch is
injected with a `Spawner` abstraction so tests mock the child without
`child_process`. TUI run pane now renders the active run live via
`useSyncExternalStore`: status pill (yellow/green/red), command, cwd,
iteration + line counters, duration, exit code, and a tail of the last 8
lines. System message (`phase1SystemMessage`) guides the model to
dispatch-then-poll-then-summarise. Permission handler swapped from deny-all
to SDK's `approveAll` for P1 (HITL arrives in P5). 14 vitest tests green
(store flush-at-threshold, flush-on-completion, waitForUpdate semantics;
tool dispatch-plumbing, since-iteration slicing, run_not_found, error path).
Noted SDK quirk: `@github/copilot-sdk`'s transitive `vscode-jsonrpc/node`
import lacks `.js` extension and breaks vitest's ESM resolver -- worked
around by `vi.mock('@github/copilot-sdk', ...)` in the tool test since
`defineTool` is a trivial passthrough.

## [2026-04-17] decision | P1 tools are SDK-native, not MCP subprocess
Roadmap originally described P1 as "one MCP tool server exposing
local.dispatch / local.poll". In practice, the SDK's `defineTool` registers
in-process tools over the same protocol the model sees for any tool, so
spinning up a subprocess for P1 would be pure ceremony. Decision: use
`defineTool` for P1's local tools; defer the real MCP-subprocess path to
P3 (catalog/wiki tools) where a long-lived server is useful. Tool names
switched from `local.dispatch` / `local.poll` (MCP-prefix convention) to
`local_dispatch` / `local_poll` for the in-process namespace; the dotted
names will return naturally when P3 introduces MCP prefixes.

## [2026-04-17] verify | P0 validated on Windows host
User ran `npm install`, `npm run typecheck`, `npm test`, `npm start` on the
Windows target and confirmed the TUI boots, a prompt round-trips to the
model, and the streaming response renders in the chat pane. All Phase 0
done-when criteria met. Project also published to
https://github.com/jules-jo/aura-agent (public) -- initial commit contains
the wiki + P0 scaffold; local-only git identity set to
`jules-jo@users.noreply.github.com` to keep user's real email out of public
history. Next: Phase 1 (local dispatch loop) per `pages/design/roadmap.md`.

## [2026-04-17] build | P0 walking skeleton landed
Scaffolded Phase 0 per `pages/design/roadmap.md`. Node 20 + TS ESM project,
`@github/copilot-sdk` wired via `CopilotClient` + `createSession({ model,
onPermissionRequest })` (the SDK's `SessionConfig` makes
`onPermissionRequest` required -- wired a temporary deny-all handler for P0
since no tools are registered yet; real HITL handler lands in P5). Session
subscription uses the typed `on(handler)` overload and maps
`assistant.message_delta` -> streaming deltas and `assistant.message` -> final
text. Ink app has two panes (chat, run placeholder) plus a single-line
prompt input; ctrl+c exits via ink's default handler with cleanup in
`main()`'s `finally`. Vitest + `ink-testing-library` smoke tests cover
initial render, final message, and streaming deltas; `tsc --noEmit` is
clean. Files: `package.json`, `tsconfig.json`, `vitest.config.ts`,
`.gitignore` (preemptively excludes `*.age`/`credentials.age`),
`src/{index,app}.tsx`, `src/components/{chat,run}-pane.tsx`,
`src/components/prompt-input.tsx`, `src/session/copilot.ts`,
`test/app.test.tsx`, `README.md`. SDK quirks discovered while wiring:
`logLevel` values are `none|error|warning|info|debug|all` (not
`silent|warn`), and `session.on` has both typed and all-events overloads.

## [2026-04-17] plan | Phased roadmap for v1
Added `design/roadmap.md` with 10 phases (P0 walking skeleton through P9
polish). Ordering prioritises de-risking the Copilot-SDK-on-Windows-with-Ink
integration (P0) and proving the dispatch-poll-summarise loop locally (P1)
before adding SSH (P2), catalog (P3), credentials (P4), permissions (P5),
structured monitoring + auto-log (P6), reattachment (P7), compaction (P8),
and polish (P9). Explicit non-goals for v1: cross-channel notifications,
multi-tenant, containers/CI targets, parallel execution, web UI.

## [2026-04-17] decision | Reattachment is a v1 requirement
User confirmed reattachment (auto-resume of a still-running remote test after a
TUI crash) is required, not optional. Pinned in `design/persistence-and-recovery.md`.
The `ssh.dispatch` run-state JSON plus the remote PID file already provide
everything the reattach flow needs; no scope change, just lifting the status
from "default" to "required".

## [2026-04-17] design | Credentials (Q14) + Windows host (Q16)
User chose option #2 for SSH credentials -- age-encrypted file outside the
wiki, master passphrase prompted once per session, decrypted buffer in memory
only. Confirmed Windows as the TUI host. Added `design/credentials.md` with
the file shape, `age` encryption rationale, `/creds` management commands, and
gitignore rules. Added `architecture/host-platform.md` pinning Windows specifics
(env-paths for `%APPDATA%`, `ssh2` over shell-out, Windows Terminal, Node 18+,
`gh copilot` auth). Updated `test-catalog.md` to drop `user/key` fields in favour
of `credential_id`; updated `execution-and-monitoring.md` and
`persistence-and-recovery.md` for credential lookup and Windows data-dir paths.
Closed Q14 and Q16. Q17 marked N/A (key-auth passphrase not relevant while on
password-auth). Q18 (SDK session resume vs our crash recovery) left open but
non-blocking -- remote-process reattach is ours to own regardless.

## [2026-04-17] design | SDK deep-dive, second-round resolutions
Pulled `nodejs/src/types.ts` from `github/copilot-sdk` and resolved Q11
(hooks are fully async -- `PreToolUseHandler` returns `Promise<...>`, output
supports `permissionDecision` "allow"/"deny"/"ask" plus arg modification),
Q12 (stdio subprocess MCP transport), Q13 (Ink), Q15 (hybrid compaction --
SDK `InfiniteSessionConfig` + test-aware rollup). Added
`architecture/copilot-sdk-hooks.md` with the full hook surface and a
code sketch for the permission hook, and `design/context-compaction.md`.
**Q14 (password-based SSH credentials in md files) flagged as a security
concern rather than filed** -- user needs to pick a safer store before any
test spec is written. Discovered useful bonuses in the SDK: built-in
elicitation (`session.ui.confirm/select/input`), `InfiniteSessionConfig`
for auto-compaction, skills/custom-agent support, session resume hints
via `onSessionStart.source`. Added Q18/Q19 to open-questions.

## [2026-04-17] design | Initial design resolution
Resolved all 10 open questions from the initial brief. Confirmed
`@github/copilot-sdk` (Node/TS, MCP tools, hooks, sub-agents) as the SDK
([[copilot-sdk]]). Committed to SSH-first execution with local as
SSH-to-localhost ([[execution-and-monitoring]]), wiki-backed test catalog with
per-test stop/notify policy and summary template ([[test-catalog]]),
side-effect-only permission prompts with bypass mode ([[permission-model]]),
structured-default summary with per-test Mustache override ([[summary-format]]),
auto-logging to `log.md` + run page + wiki index, and crash recovery via
run-state + remote PID files distinct from SDK session memory
([[persistence-and-recovery]]). Added seven new pages: architecture/overview,
architecture/copilot-sdk, design/test-catalog, design/permission-model,
design/execution-and-monitoring, design/summary-format, design/persistence-and-recovery.
Five new questions surfaced (Copilot SDK hook blocking semantics, MCP
registration API shape, TUI framework choice, SSH passphrase flow, long-run
context-window compaction) -- tracked in [[open-questions]].

## [2026-04-16] ingest | Aura Agent initial brief
User-authored project brief filed as `raw/aura-agent-brief-2026-04-16.md`. Established project identity: TUI-first personal test-running agent with natural-language input, missing-info prompting, live status reporting, per-error stop/notify policy, end-of-run summary, HITL-by-default with bypass mode, targeted on the "Github Copilot SDK". Created `pages/sources/aura-agent-brief.md` (source summary), `pages/design/open-questions.md` (10 flagged ambiguities). Updated `schema/CLAUDE.md` Domain section with the real project description. 10 questions surfaced back to user -- biggest is Q1 (which "Copilot SDK" -- GitHub Models REST, Copilot Extensions, Copilot CLI, or VS Code Language Model API).

## [2026-04-16] ingest | Karpathy LLM Wiki Pattern
Seeded the wiki with Andrej Karpathy's gist on the LLM Wiki pattern (raw/karpathy-llm-wiki.md). Created `pages/sources/karpathy-llm-wiki.md` as the source summary and `pages/concepts/llm-wiki-pattern.md` plus `pages/concepts/rag-vs-wiki.md` as the two foundational concept pages the rest of the wiki will build on. This establishes the three-layer architecture (raw, wiki, schema) and three operations (ingest, query, lint) that govern how this wiki is maintained.

## [2026-04-16] init | Wiki created
Created wiki structure for the aura-agent project following Karpathy's LLM Wiki pattern. Scaffolded `schema/CLAUDE.md`, `index.md`, `log.md`, and the `raw/`, `pages/concepts/`, `pages/architecture/`, `pages/design/`, `pages/decisions/`, `pages/sources/` directories. Domain section in the schema is a placeholder -- tighten it once the aura-agent project scope is locked.
