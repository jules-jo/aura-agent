---
tags: [source, brief, foundational]
created: 2026-04-16
updated: 2026-04-16
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Aura Agent -- Initial Brief

*First user-authored description of what aura-agent is for. Everything else in the wiki should trace back to this until superseded by a follow-up brief.*

## What the project is

A **personal agent for running tests, watching their output, and notifying the
user on errors or completion.** TUI-first. Conversational entry point. Agent
keeps looping until the goal is met, Claude-Code-style.

## Confirmed scope

- **UI**: TUI.
- **Interaction**: natural-language.
- **Input gathering**: agent asks the user for missing test info (script location, target system, required arguments, etc. -- "not limited to this").
- **Execution**: agent runs the test on a user-specified system once it has enough info.
- **Monitoring**: continuous status reporting to the user while the test runs.
- **Error handling**: agent notifies on error; per-error policy ("stop" vs "notify and keep going") is specified by the user.
- **Completion**: agent summarises results and notifies user at the end.
- **User-provided config**: test info, run instructions, and summary instructions are authored by the user.
- **Permission model**: human-in-the-loop by default (ask before each action); bypass option for agent-in-the-loop / human-out-of-the-loop, mirroring Claude Code's `--dangerously-skip-permissions`-style mode.
- **Implementation tool**: "Github Copilot SDK" (see [[open-questions]] -- this needs disambiguation).

## Reference points the user called out

- **Claude Code's run loop** -- the polling/looping behaviour while working toward a goal.
- **Claude Code's completion summary** -- the final end-of-turn recap.
- **Claude Code's bypass permissions** -- the opt-in for autonomous mode.

These are the behavioural benchmarks: when in doubt about how a sub-behaviour
should feel, match Claude Code.

## Derived pages

- [[aura-agent-overview]] -- distilled project identity (to be written).
- [[permission-model]] -- the HITL-by-default / bypass-to-autonomous spectrum (to be written).
- [[open-questions]] -- ambiguities flagged back to the user on ingest (this page).
