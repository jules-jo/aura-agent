---
tags: [design, persistence, recovery]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Persistence and Recovery

*Auto-log every run into the wiki. Session memory is an SDK feature; crash recovery is a separate concern that needs durable storage.*

Resolution of [[open-questions]] Q8.

## The three things people mean by "memory"

| Concept | Lives where | What it survives |
|---|---|---|
| **Session memory** | In-process, in the Copilot SDK session object. | Multiple turns in the same TUI run. Dies when the process exits. |
| **Auto-logging** | Wiki: `log.md` and `pages/runs/*.md`, written via `wiki.write`. | Everything. It's on disk. |
| **Crash recovery** | Run-state file on disk (e.g. `runs/<run_id>.json`) + the remote PID file from `ssh.dispatch`. | A TUI crash mid-run. |

The user's question -- "doesn't the Copilot SDK provide session memory?" --
yes, it does, but that only covers the first row. It gives the model continuous
conversation memory *within one live process*. It does not write anything to
disk, and if the TUI dies while a 30-minute remote test is still running, the
session memory dies with the process.

That's why the other two rows exist.

## Auto-logging (yes, and how)

Every run gets three durable artifacts:

1. **`log.md`** -- one line per run: `## [YYYY-MM-DD] run | <test-name> -- <status> in <duration>`. Matches the existing log format.
2. **`pages/runs/<date>-<slug>-<short-id>.md`** -- full run page. Frontmatter holds the structured summary object from [[summary-format]]; body holds the rendered summary and a tail of raw output.
3. **`index.md`** -- new run page listed under a "Runs" section.

The agent writes all three via `wiki.write` after the run terminates, inside
one tool call per page.

## Crash recovery

**Reattachment is a v1 requirement** (confirmed 2026-04-17). On TUI restart
after a crash, aura-agent re-attaches to any remote test that is still running
and resumes polling automatically -- the user does not have to SSH in
manually or re-run.

Scoped tightly for v1:

- `ssh.dispatch` writes a **run-state file** on the TUI host before returning:
  `<data-dir>/runs/<run_id>.json` with `{host, credential_id, pid, pid_file, cwd, spec_path, started_at}`. On Windows `<data-dir>` resolves to `%APPDATA%\aura\Data` via `env-paths` (see [[host-platform]]).
- `ssh.dispatch` also writes a **PID file** on the remote (e.g. `~/.aura/runs/<run_id>.pid`). This lets the remote process be found again even if the SSH connection drops.
- On TUI startup, the agent:
  1. Scans `runs/*.json` for entries with no matching completion record.
  2. For each, calls `ssh.poll(run_id)` against the remote PID file.
  3. If the process is still alive, offers to re-attach. If it already finished, offers to fetch the final output and write the usual summary / run page / log entry.
- If the user declines or the remote state is gone, the run-state file is moved to `runs/orphaned/` for debugging and forgotten.

This mirrors the pattern the sibling jules-daemon uses -- worth cross-reading
when we implement.

## What is **not** covered in v1

- Cross-session conversational memory (the agent remembering a multi-day
  discussion about a specific test). Could be added later by seeding new
  sessions from the test page's body and recent run pages.
- Resuming a killed test from the last passing module. Out of scope -- the test
  owner re-runs.

## Related

- [[copilot-sdk]] -- the session-memory half of the picture.
- [[execution-and-monitoring]] -- the run-state file and PID file are written by `ssh.dispatch`.
- [[summary-format]] -- what the run page contains.
