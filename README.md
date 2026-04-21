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

The TUI opens with two panes (chat + run placeholder). Type a prompt, press
Enter, watch the model's response render. Ctrl+C exits.

To plan tests from a spreadsheet, place a `.csv`, `.tsv`, or `.xlsx` file in
the repo and ask Aura to use the batch planner:

```
Use the batch planner sidecar agent to read ./test-plan.xlsx and plan what tests should run.
```

The spreadsheet reader is read-only and is currently scoped to the
`batch_planner` sidecar agent. The planner returns a readable summary plus a
machine-readable `structured_plan` with `ready`, `needs_input`, and `blocked`
rows for later execution.

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
