# aura-agent

TUI-first personal test-running agent built on the GitHub Copilot SDK.

Phase 0 ships a walking skeleton: an Ink-based TUI that connects to a Copilot
SDK session and streams a model response. No tools, no tests, no wiki yet --
those arrive in later phases (see `pages/design/roadmap.md`).

## Requirements

- Node 18+
- A working `gh` CLI with Copilot access: `gh auth login` then `gh copilot --help`
- Windows Terminal is the primary target shell on Windows (see `pages/architecture/host-platform.md`)

## Setup

```
npm install
npm run typecheck
npm test
```

## Run

```
npm start
```

To run with side-effect confirmations auto-approved for the session:

```
npm start -- --bypass
```

To run complete spreadsheet rows without per-test approval while still asking
for missing or ambiguous inputs:

```
npm start -- --agentic
```

For SSH password auth, Aura first checks `.env` before prompting. Use a scoped
variable when possible:

```
# For credential_id: bench-a
AURA_SSH_PASSWORD_BENCH_A=your-password

# Fallback for any SSH target without a more specific variable
AURA_SSH_PASSWORD=your-password
```

Scoped variable names are normalized from `credential_id`, or from
`username@host` when `credential_id` is omitted. For example,
`root@192.168.1.10` becomes `AURA_SSH_PASSWORD_ROOT_192_168_1_10`.

You can set a default spreadsheet in `.env`. The path can be repo-relative or
an absolute local path:

```
AURA_AGENTIC_SPREADSHEET_PATH=./test-plan.xlsx
AURA_AGENTIC_SPREADSHEET_SHEET=Plan
```

Agentic run progress is also controlled from `.env`:

```
AURA_AGENTIC_POLL_WAIT_MS=2000
AURA_AGENTIC_PROGRESS_CHUNK_LINES=20
AURA_AGENTIC_PROGRESS_HEARTBEAT_MS=30000
```

`AURA_AGENTIC_POLL_WAIT_MS` controls how often Aura checks run state.
`AURA_AGENTIC_PROGRESS_CHUNK_LINES` controls how many output lines make one
progress update. `AURA_AGENTIC_PROGRESS_HEARTBEAT_MS` controls the quiet
heartbeat when a run is active but has not produced a new output chunk; set it
to `0` to disable that heartbeat.

Then prompt Aura with:

```
Read the default spreadsheet, create a batch plan, and run the ready tests.
```

The TUI opens with two panes (chat + run placeholder). Type a prompt, press
Enter, watch the model's response render. Ctrl+C exits.

To plan tests from a spreadsheet, place a `.csv`, `.tsv`, or `.xlsx` file in
the repo and ask Aura to use the batch planner:

```
Use the batch planner sidecar agent to read ./test-plan.xlsx and plan what tests should run.
```

The `batch_planner` sidecar reads spreadsheets and returns a readable summary
plus a machine-readable `structured_plan` with `ready`, `needs_input`, and
`blocked` rows. In `--agentic` mode, Aura can pass `structured_plan.ready` to
`agentic_run_plan`, which runs ready rows sequentially and writes result columns
such as `aura_status`, `aura_run_id`, `aura_completed_at`, `aura_summary`, and
`aura_jira_key` back to the spreadsheet.

Aura also has a read-only `log_analyst` sidecar. After deterministic execution,
Aura can delegate compact run results to it for a human-quality final summary,
failure interpretation, Teams-ready summary text, and Jira-ready failure
context. The analyst receives structured rows and output tails only; it cannot
run tests or perform side effects.

For better in-run status, add optional `progress.patterns` to a test catalog
page. Aura uses those regex rules to turn raw output into semantic updates and
final summaries:

```yaml
progress:
  patterns:
    - type: phase
      regex: "^PHASE: (?<phase>.+)$"
    - type: progress
      regex: "iteration (?<current>\\d+)/(?<total>\\d+)"
      message: "iteration {current}/{total}"
    - type: metric
      name: "fps"
      regex: "fps=(?<value>\\d+(?:\\.\\d+)?)"
    - type: failure
      regex: "^ERROR: (?<message>.+)$"
```

## Layout

```
src/
  index.tsx            -- entry, renders <App /> into Ink
  app.tsx              -- root component; owns chat state and wiring
  components/
    chat-pane.tsx      -- assistant transcript
    run-pane.tsx       -- P1+ placeholder for live test progress
    prompt-input.tsx   -- single-line prompt input
  session/
    copilot.ts         -- wraps CopilotClient + createSession
test/
  app.test.tsx         -- smoke tests via ink-testing-library
```

## Windows notes

- Paths resolved via `env-paths` later; Phase 0 doesn't touch the filesystem.
- `gh copilot` must be on PATH; the SDK picks up auth from it.
