---
tags: [test]
name: "Remote Pytest"
aliases:
  - remote pytest
  - pytest remote
created: 2026-04-17
updated: 2026-04-17
cwd: "/srv/app"
command: "pytest -q"
timeout_minutes: 30
framework: "pytest"
summary:
  include_tail_lines: 40
---

# Remote Pytest

Example split-model remote test spec.

Pair this with a page in `pages/systems/` so the same test can be dispatched
against different SSH targets.
