# Wiki Index

## Concepts
- [LLM Wiki Pattern](pages/concepts/llm-wiki-pattern.md) -- Karpathy's pattern for persistent, LLM-maintained knowledge bases
- [RAG vs Wiki](pages/concepts/rag-vs-wiki.md) -- Why compiled, cross-referenced knowledge beats re-derived retrieval

## Architecture
- [Overview](pages/architecture/overview.md) -- TUI -> Copilot SDK session -> MCP tools -> SSH targets
- [Copilot SDK](pages/architecture/copilot-sdk.md) -- What `@github/copilot-sdk` provides and what aura-agent builds on top
- [Copilot SDK Hooks](pages/architecture/copilot-sdk-hooks.md) -- Hook signatures, async blocking, and the permission-prompt sketch
- [Host Platform](pages/architecture/host-platform.md) -- Windows specifics: paths, terminal, SSH client, subprocess semantics

## Design
- [Test Catalog](pages/design/test-catalog.md) -- Wiki-backed test specs; "run test X" resolves by name; stop/notify policy and summary template per test
- [Permission Model](pages/design/permission-model.md) -- HITL-by-default with side-effect-only prompts; bypass mode for autonomous runs
- [Execution and Monitoring](pages/design/execution-and-monitoring.md) -- SSH-first dispatch, iteration-boundary polling, error policy evaluation
- [Summary Format](pages/design/summary-format.md) -- Structured default plus per-test Mustache template override
- [Persistence and Recovery](pages/design/persistence-and-recovery.md) -- Auto-logging; session memory vs run-state-file-based crash recovery
- [Context Compaction](pages/design/context-compaction.md) -- SDK-native background compaction plus test-aware rollup over long poll histories
- [Credentials](pages/design/credentials.md) -- `age`-encrypted credentials file; test catalog references `credential_id`, never the password
- [Roadmap](pages/design/roadmap.md) -- Phased v1 plan from walking-skeleton through compaction
- [Open Questions](pages/design/open-questions.md) -- Ambiguities tracked to resolution

## Decisions
_Empty. Add ADRs here as non-trivial choices get made._

## Tests
_Empty. Add per-test spec pages under `pages/tests/` as the catalog grows._

## Runs
_Empty. Populated automatically by the agent on every completed test run._

## Sources
- [Karpathy -- LLM Wiki](pages/sources/karpathy-llm-wiki.md) -- The seed gist that defines this wiki's operating model
- [Aura Agent -- Initial Brief](pages/sources/aura-agent-brief.md) -- First user-authored description of the project (2026-04-16)
