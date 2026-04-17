# Test Spec Templates

These are copy-paste starting points for the current Phase 3 split model.

The rule of thumb is:
- `pages/tests/*.md` says what to run and what inputs it needs
- `pages/systems/*.md` says where to run it

## Python CLI

```md
---
tags: [test]
name: "X Script"
aliases:
  - x script
cwd: "/srv/app"
command: "python3 x.py -i {{iterations}} {{input_file}}"
timeout_minutes: 30
args:
  - name: "iterations"
    required: true
    prompt: "What value should I pass to -i?"
    aliases:
      - "-i"
      - "i"
    description: "Iteration count for x.py"
  - name: "input_file"
    required: true
    prompt: "Which input file should I use?"
    aliases:
      - "input"
      - "file"
    description: "Input file path passed to x.py"
summary:
  include_tail_lines: 40
---

# X Script

Runs `x.py` with the required CLI inputs.
```

## Binary CLI

```md
---
tags: [test]
name: "Foo Binary"
aliases:
  - foo binary
cwd: "/opt/foo"
command: "./foo.bin --config {{config_path}} --mode {{mode}}"
timeout_minutes: 20
args:
  - name: "config_path"
    required: true
    prompt: "Which config file should I use?"
    aliases:
      - "--config"
      - "config"
    description: "Path to the binary config file"
  - name: "mode"
    required: true
    prompt: "Which mode should I run?"
    aliases:
      - "--mode"
    description: "Execution mode for foo.bin"
    choices:
      - fast
      - full
summary:
  include_tail_lines: 40
---

# Foo Binary

Runs the binary with explicit required inputs.
```

## Required Args + System

Use this with a separate page under `pages/systems/`.

```md
---
tags: [test]
name: "Remote Pytest Target"
aliases:
  - remote pytest target
cwd: "/srv/app"
command: "pytest -q {{target}}"
timeout_minutes: 30
args:
  - name: "target"
    required: true
    prompt: "Which pytest file, node id, or pattern should I run?"
    aliases:
      - "test"
      - "pattern"
    description: "Focused pytest target"
framework: "pytest"
summary:
  include_tail_lines: 40
---

# Remote Pytest Target

Pair this with a page in `pages/systems/` and run it as:
`run Remote Pytest Target in System A`
```

## Minimal System Page

```md
---
tags: [system]
name: "System A"
aliases:
  - system a
host: "203.0.113.10"
username: "root"
port: 22
---
```
