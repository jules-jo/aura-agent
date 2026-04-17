---
tags: [design, execution, ssh, monitoring]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Execution and Monitoring

*SSH-first execution. Polling at module / iteration boundaries, not raw line streaming, so each status update is meaningful to the user.*

Resolution of [[open-questions]] Q2, Q4.

## Execution target

- **Primary**: SSH-remote. Host, user, keyfile, and cwd come from the test spec (see [[test-catalog]]).
- **Fallback**: local. Treated as SSH-to-localhost for uniformity -- no separate code path.
- Containers / CI are out of scope for v1. Can be layered later by adding new MCP tools without touching the loop.

## Dispatch

`ssh.dispatch(test_id, host, credential_id, cwd, command, env, timeout_minutes)`:
- Looks up the password for `credential_id` from the in-memory credential store (see [[credentials]]). The password never appears in tool args, logs, or wiki pages.
- Opens an SSH connection via the pure-Node `ssh2` library (see [[host-platform]] -- no shelling out to `ssh.exe`), runs the command in a durable way (e.g. via `nohup` + a PID file on a POSIX target, or `Start-Process -WindowStyle Hidden` on a Windows target), and returns immediately with a `run_id` plus the path to a remote log file.
- The process keeps running even if the SSH connection drops. This is what lets [[persistence-and-recovery]] work.

## Monitoring -- poll, not stream

The user's answer to [[open-questions]] Q4 is: poll at each "major moment" --
module or iteration boundaries -- so the output the TUI shows is interpretable,
not a raw firehose.

`ssh.poll(run_id)` returns a structured view:

```jsonc
{
  "run_id": "…",
  "status": "running | succeeded | failed | timed_out",
  "iterations": [
    { "kind": "module_started", "name": "tests/test_x.py::TestSmoke", "at": "…" },
    { "kind": "test_passed",    "name": "test_basic",                  "at": "…" },
    { "kind": "test_failed",    "name": "test_edge",    "message": "…", "at": "…" }
  ],
  "counters": { "pass": 12, "fail": 1, "skip": 0 },
  "tail": "…last N lines of raw stdout, for context only…"
}
```

- Polling cadence: on a short timer (e.g. every 2s) **only to advance state**. The TUI only renders an update when a new `iteration` arrives -- not on every poll.
- Boundaries are framework-aware: `parse.test_output` knows how to read pytest / go test / JUnit XML / etc. The `framework` field on the test spec picks the parser.
- For frameworks with no structured output, fall back to regex matches from the spec's `pass_pattern` / `fail_pattern`, emitted as synthetic `iteration` entries.

## The monitoring loop

```
agent: ssh.dispatch(spec) -> run_id
loop:
  poll = ssh.poll(run_id)
  if poll.iterations has new entries:
    render each into TUI
    for each new failure:
      consult spec.errors[] -> action: stop | notify
      if stop: ssh.dispatch("kill <pid>"); break loop
      if notify: notify.tui(failure)
  if poll.status in {succeeded, failed, timed_out}: break loop
  sleep(cadence)
```

The loop is driven by the model via tool calls, not hard-coded -- so a user can
ask "what's the current count?" mid-run and the model answers from the latest
`ssh.poll` result without breaking the flow.

## Killing a run

`ssh.dispatch(run_id, kill=true)` -- signals the remote process (SIGTERM,
SIGKILL after grace). Invoked when the spec's `errors[]` says `action: stop`,
or when the user asks to abort in the TUI.

## Related

- [[test-catalog]] -- source of the spec that drives the dispatch and the error policy.
- [[permission-model]] -- `ssh.dispatch` is side-effecting and prompts unless bypass is on; `ssh.poll` is read-only and does not.
- [[persistence-and-recovery]] -- how a surviving remote run is picked up if the TUI restarts.
- [[summary-format]] -- what the final structured view looks like.
