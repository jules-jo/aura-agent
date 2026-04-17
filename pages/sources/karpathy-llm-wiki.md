---
tags: [source, pattern, wiki-design]
created: 2026-04-16
updated: 2026-04-16
sources: [raw/karpathy-llm-wiki.md]
---

# Karpathy -- LLM Wiki

*One-pager on a pattern for LLM-maintained personal knowledge bases, by Andrej Karpathy.*

## What it is

An "idea file" meant to be pasted into an LLM agent so the agent can instantiate
a wiki that fits a particular domain. It describes the pattern, not an
implementation. See [[llm-wiki-pattern]] for the distilled version and
[[rag-vs-wiki]] for why this sits opposite RAG.

## Key claims

- RAG re-derives knowledge every query; a wiki compiles it once and keeps it current.
- The wiki is a **persistent, compounding artifact** -- cross-references, contradictions, and synthesis all live in the artifact, not the prompt.
- The human curates sources and asks good questions; the LLM does the bookkeeping.
- The pattern generalises across domains: personal, research, reading a book, business/team, competitive analysis, hobby deep-dives.

## Three layers

1. **Raw sources** -- immutable input documents the LLM reads but never edits.
2. **The wiki** -- LLM-owned markdown files (summaries, entity pages, concept pages, comparisons).
3. **The schema** -- a config document (`CLAUDE.md`, `AGENTS.md`) that tells the LLM how the wiki is structured and what workflows to follow.

## Three operations

- **Ingest** -- LLM reads a new source, updates relevant pages, updates index, appends to log. One source often touches 10-15 pages.
- **Query** -- LLM reads `index.md`, drills into pages, synthesises with citations. Good answers get filed back as new pages so exploration compounds.
- **Lint** -- periodic health check: contradictions, stale claims, orphan pages, missing cross-references, data gaps.

## Two special files

- **`index.md`** -- content-oriented catalog, organised by category. Read first on every query.
- **`log.md`** -- chronological, append-only. Consistent prefix (`## [YYYY-MM-DD] op | title`) keeps it greppable.

## Tooling notes

- Obsidian recommended as the human-side browser; LLM edits, human reads graph view.
- [qmd](https://github.com/tobi/qmd) is suggested once the wiki outgrows a flat index -- local hybrid BM25/vector search with CLI and MCP.
- Obsidian Web Clipper for getting web articles into raw/. Marp for slide decks. Dataview for frontmatter-driven queries.
- The wiki is just a git repo -- you inherit history, branching, collaboration for free.

## Why it works

The maintenance burden is what kills human-run wikis. LLMs don't get bored and
can touch 15 files in one pass, so maintenance cost goes to near zero. The
pattern is related to Vannevar Bush's 1945 Memex; the missing piece Bush
couldn't solve -- who does the upkeep -- is the piece the LLM fills in.

## Applied to aura-agent

This wiki follows the pattern directly. See [[llm-wiki-pattern]] for the
project-specific instantiation and `schema/CLAUDE.md` for the schema used here.
