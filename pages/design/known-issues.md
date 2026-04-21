---
tags: [design, known-issues, backlog]
created: 2026-04-17
updated: 2026-04-21
---

# Known Issues

*Backlog of bugs and rough edges observed in dogfooding that aren't blocking the
current phase. Each entry: one-line symptom, why it happens (or best current
guess), impact, and what the fix likely looks like. Promote to a real roadmap
item or ADR when someone picks it up.*

## KI-001 -- Agent re-dispatches the test after a mid-run SSH disconnect

**Symptom:** SSH connection drops while a remote run is in flight. Aura
reconnects, but instead of reattaching to the existing remote process via
`ssh_reattach`, the model calls `ssh_dispatch` again -- the same command
executes a second time on the target host.

**Why (current guess):**
- The remote process is designed to survive disconnect (nohup + PID file +
  detached stdout/stderr, see [[persistence-and-recovery]] and
  `src/ssh/remote-script.ts`), so a reattach is the correct recovery path.
- The background poller in `ssh_dispatch` surfaces the transport failure to
  the model. The model sees "the run failed, let me retry" and picks
  `ssh_dispatch` over `ssh_reattach`, because nothing in the system message or
  the tool output explicitly tells it "the run is still alive remotely; call
  `ssh_reattach(run_id)` instead".
- The `RunStateStore` already writes the record the reattach flow needs, but
  the current turn doesn't route the model toward it on mid-session drops --
  only Phase 7 startup scan is wired up.

**Impact:** duplicate execution. Cheap for read-only probes, potentially
destructive for tests with side effects. Also corrupts the run log (two
interleaved iteration streams into the same `RunStore` entry if the run_id
gets reused, or a new run_id that silently supersedes the one still executing
remotely).

**Likely fix direction (not starting yet):**
1. When the background poller encounters a transport error on an in-flight
   run, surface a structured tool event like `{ state: "disconnected", run_id,
   remote_host }` rather than a generic dispatch failure, so the model has an
   unambiguous signal.
2. Update the system message to state: on disconnect of a known run_id, call
   `ssh_reattach(run_id)`; never call `ssh_dispatch` again for a run whose
   state file still exists and whose PID file is still alive.
3. Short-circuit: the poller itself could attempt one automatic reattach
   before handing control back to the model, keeping the model loop simpler.

**Related:**
- [[persistence-and-recovery]] -- reattach design (startup scan today, needs
  to cover mid-session drops too).
- [[roadmap]] Phase 7 -- crash recovery; this issue argues Phase 7's scope
  should include mid-session reattach, not just restart-time reattach.

**Priority:** low for now (per user, 2026-04-17). Revisit alongside Phase 7.

## KI-002 -- Batch planner takes too long on spreadsheet planning

**Symptom:** Reading an Excel spreadsheet and creating a batch plan can feel
slow, even when the spreadsheet itself is not large.

**Why (current guess):**
- Spreadsheet file I/O is probably not the main bottleneck. The slow path is
  usually model reasoning plus tool calls.
- Current flow starts a `batch_planner` sidecar Copilot session for each
  delegation.
- The sidecar may read the spreadsheet, reason over rows, call catalog/system
  lookup tools repeatedly, then generate both prose and structured JSON.
- The planner currently gets fairly raw spreadsheet rows. It still has to infer
  which columns matter, map names to catalog entries, identify missing args, and
  produce the final plan.

**Impact:** demo works, but spreadsheet-driven automation can feel sluggish.
This will matter more once users expect Aura to track a spreadsheet and react to
changes repeatedly.

**Likely fix direction (not starting yet):**
1. Deterministic pre-processing: parse spreadsheet rows in code, normalize
   columns, drop irrelevant cells, and send only compact row summaries to the
   sidecar.
2. Catalog indexing/cache: load test specs and system specs once per session and
   reuse them instead of re-scanning wiki files for every planner turn.
3. Structured planner code: match obvious test/system/arg columns in code and
   ask the model only for ambiguous rows.
4. Persistent sidecar session: keep `batch_planner` alive instead of creating a
   fresh Copilot session for each delegation.
5. Row limits and changed-row detection: plan only new or modified spreadsheet
   rows instead of the whole file every time.
6. Planner model choice: consider a faster model for `batch_planner` if quality
   is acceptable.

**Near-term recommended slice:** `spreadsheet_read -> deterministic row summary
-> batch_planner only sees compact normalized rows`.

**Later slice:** add catalog cache and spreadsheet changed-row tracking.

**Related:**
- [[roadmap]] Phase 10 -- change intake and test planning.
- [[roadmap]] Phase 11 -- multi-agent execution and reporting.

**Priority:** medium after the spreadsheet demo is functionally correct.
