---
tags: [test]
name: "Local Vitest"
aliases:
  - vitest
  - local tests
  - smoke
created: 2026-04-17
updated: 2026-04-17
host: "localhost"
cwd: "."
command: "npm test"
timeout_minutes: 10
framework: "generic"
pass_pattern: "Test Files\\s+\\d+ passed"
fail_pattern: "\\bfailed\\b|\\bFAIL\\b"
summary:
  include_tail_lines: 40
---

# Local Vitest

Runs the repository's Vitest suite from the workspace root.

Use this as the default smoke test when you want to verify the current
workspace quickly after a change.
