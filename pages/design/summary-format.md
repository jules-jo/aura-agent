---
tags: [design, summary]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Summary Format

*Structured default (pass / fail / duration + failures). Per-test template in the test spec overrides the default for a specific test.*

Resolution of [[open-questions]] Q9.

## Structured default

At the end of every run the agent produces an object of this shape:

```jsonc
{
  "test_name": "Test X",
  "status":    "succeeded | failed | timed_out",
  "started":   "2026-04-17T10:00:00Z",
  "ended":     "2026-04-17T10:12:34Z",
  "duration":  "12m 34s",
  "counters":  { "pass": 42, "fail": 1, "skip": 3, "total": 46 },
  "failures":  [
    { "name": "test_edge", "message": "AssertionError: x != y", "location": "tests/test_x.py:142" }
  ],
  "host":      "runner-01.example.com",
  "command":   "pytest -q tests/test_x.py"
}
```

Renderers (TUI, wiki log) read from this single object.

## Default rendering in the TUI

```
Test X -- FAILED in 12m 34s
Passed: 42 / 46    Skipped: 3    Failed: 1
  - test_edge  tests/test_x.py:142
    AssertionError: x != y

host: runner-01.example.com
```

## User-specified override

A test spec can provide `summary.template` (see [[test-catalog]]). The template
receives the structured object as its render context, so the user can reshape
the output without the agent having to re-judge what matters.

Templates are Mustache-style for simplicity:

```mustache
# {{test_name}} -- {{status}}
Passed: {{counters.pass}} / {{counters.total}}   Duration: {{duration}}
{{#failures}}
- {{name}} @ {{location}}: {{message}}
{{/failures}}
```

If the template renders to empty or errors, the agent falls back to the default
renderer and logs a warning.

## Where the summary is written

1. **TUI**: final pane on run completion.
2. **Wiki**: appended as a run page under `pages/runs/<date>-<test-slug>-<short-id>.md`, with the structured object in frontmatter and the rendered text in the body. This is the auto-log from [[persistence-and-recovery]].
3. **log.md**: one-line entry per run, greppable.

## Open

- Does the user want a rolling "pass-rate over last N runs" section? Defer until we have run history.
- Slack/email summary channels are out of scope for v1 (TUI only, per Q6).
