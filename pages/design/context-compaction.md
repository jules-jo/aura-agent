---
tags: [design, context, long-runs]
created: 2026-04-17
updated: 2026-04-17
sources: [raw/aura-agent-brief-2026-04-16.md]
---

# Context Compaction

*Hybrid strategy: the SDK's built-in background compaction plus a test-aware rollup so a 30-minute run doesn't bloat session memory with 900 polls.*

Resolution of [[open-questions]] Q15.

## Baseline -- rely on the SDK

`@github/copilot-sdk` exposes `InfiniteSessionConfig`:

```ts
interface InfiniteSessionConfig {
  enabled?: boolean;                      // default true
  backgroundCompactionThreshold?: number; // default 0.80
  bufferExhaustionThreshold?: number;     // default 0.95
}
```

At 80% context utilisation the SDK starts an async compaction pass; at 95% it
blocks the session until compaction finishes. aura-agent leaves these defaults
in place -- they cover the generic "session has been going for a while" case
without any custom code.

## Test-aware rollup on top

The SDK's compaction is generic. For a long test run, we want to retain the
*structure* of the run (failures in particular) while dropping the repetitive
"still running, N iterations in" detail. So aura-agent layers a rollup:

- **Keep verbatim**: the last K iteration entries (default K = 20) and **every failure** regardless of age.
- **Roll up older entries** into a single synthetic message of the form:
  `"[rollup] modules 1..47 completed: 312 passed, 3 skipped"`.
- Run every N new iterations (default N = 50) or when a poll returns `> K` unread entries at once.

The rollup is implemented as an `onPostToolUse` hook over `ssh.poll` results:
when a poll returns a payload that would push the session past a size
threshold, the hook replaces older iteration entries with the rollup summary
before the result is fed back to the model. The full history still lives in
the run page written via `wiki.write`, so the final summary can reconstruct
pass/fail counts exactly.

## Why this is "hybrid"

- Verbatim window -- the model always sees recent iterations and every failure.
- Rollup -- older non-failures are compressed so the window stays small.
- SDK background compaction -- still runs for anything else the session has accumulated (conversation history, prior tool calls).

Rollup lives above the SDK compaction: we aggressively trim our own data
before the SDK's threshold-based pass has to touch it.

## Parameters to tune later

| Param | Default | Notes |
|---|---|---|
| `keepLastK` | 20 | Verbatim iteration entries retained. |
| `rolloverEveryN` | 50 | How often to run the rollup. |
| `failureRetention` | all | Always keep every failure verbatim. |

These become fields on the test spec later if per-test tuning is needed -- out
of scope for v1.

## Related

- [[execution-and-monitoring]] -- produces the iteration stream that gets rolled up.
- [[copilot-sdk-hooks]] -- `onPostToolUse` is where the rollup runs.
- [[persistence-and-recovery]] -- the run page is the source of truth for full history.
