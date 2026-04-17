---
tags: [design, catalog, wiki-schema]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Test Catalog

*Test specs live as wiki pages. "Run test X" resolves a friendly name to a spec and the agent reads it like any other wiki page.*

Resolution of [[open-questions]] Q3, Q5, Q9 (partial).

## Layout

```
pages/
  tests/
    <test-slug>.md     # One page per test.
```

Each page has YAML frontmatter (structured config) and a markdown body
(free-form notes, reproduction steps, historical context).

## Page schema

```yaml
---
tags: [test]
name: "Test X"                 # Human name; what the user says.
aliases: ["x", "smoke-x"]      # Optional extras the lookup tool will match.
created: 2026-04-17
updated: 2026-04-17

# --- Target ---
host: "runner-01.example.com"  # SSH host. localhost is fine too.
credential_id: "runner-01"     # Looked up in the encrypted credentials file.
                               # See [[credentials]]. user + password are NOT stored here.
cwd: "/srv/tests/x"

# --- Command ---
command: "pytest -q tests/test_x.py"
timeout_minutes: 30
env:
  LOG_LEVEL: "info"

# --- Arguments the user may be asked for ---
args:
  - name: "scenario"
    required: true
    prompt: "Which scenario do you want to run?"
    choices: ["smoke", "full"]
  - name: "seed"
    required: false
    prompt: "Random seed (optional)."

# --- Output parsing ---
framework: "pytest"            # Informs parse.test_output.
pass_pattern: "^=+ \\d+ passed"
fail_pattern: "FAILED|ERROR"

# --- Error policy: stop vs notify ---
errors:
  - match: "CONNECTION_REFUSED"
    action: stop                  # abort the run
    reason: "Target is unreachable -- no point continuing."
  - match: "AssertionError"
    action: notify                # keep going, tell the user
  - match: "OutOfMemoryError"
    action: stop
  default: notify                 # anything unmatched

# --- Summary ---
summary:
  template: |
    # {{name}} -- {{status}}
    Passed: {{pass}} / {{total}}   Duration: {{duration}}
    {{#failures}}
    - {{name}}: {{message}}
    {{/failures}}
  include_tail_lines: 40         # raw output tail appended after the template
---

# Test X

Notes on what this test does, dependencies, known flakes, related tickets, etc.
Free-form. The agent reads this body when asked "what is test X about?"
```

## Resolution ("run test X")

`catalog.lookup_test(query)` resolves in this order:
1. Exact match on `name`.
2. Exact match on any `aliases[]`.
3. Case-insensitive fuzzy match on slug / name.
4. Returns the single best match, or asks the user to disambiguate when multiple
   candidates are close.

## Where the stop-vs-notify policy lives

In the test page's `errors:` block. That is the single answer to
[[open-questions]] Q5: per-test file, in the test wiki. The `default:` key
decides what happens for unmatched errors. See [[error-policy]] once we write
it; for now the block above is the whole spec.

## Where the summary template lives

In the test page's `summary.template` field. If absent, the agent falls back to
the structured default defined in [[summary-format]]. Answers Q9.

## Related

- [[execution-and-monitoring]] -- how the `command` + `host` block drives the run.
- [[credentials]] -- where the actual username/password for `credential_id` live.
- [[summary-format]] -- the structured default and what template variables resolve to.
- [[permission-model]] -- `ssh.dispatch` on the test's target is a side-effecting call and requires approval unless bypass is on.
