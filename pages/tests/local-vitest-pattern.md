---
tags: [test]
name: "Local Vitest Pattern"
aliases:
  - vitest pattern
  - focused vitest
created: 2026-04-17
updated: 2026-04-17
host: "localhost"
cwd: "."
command: "npx vitest run {{pattern}}"
timeout_minutes: 10
args:
  - name: "pattern"
    required: true
    prompt: "Which Vitest file or test pattern should I run?"
framework: "generic"
summary:
  include_tail_lines: 40
---

# Local Vitest Pattern

Runs a focused Vitest invocation against a user-supplied file or pattern.

Use this when you want a narrow rerun instead of the full `npm test` suite.
