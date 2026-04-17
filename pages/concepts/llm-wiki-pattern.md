---
tags: [concept, wiki-design, foundational]
created: 2026-04-16
updated: 2026-04-16
sources: [raw/karpathy-llm-wiki.md]
---

# LLM Wiki Pattern

*The operating model this wiki runs on: the LLM writes and maintains everything; the human curates sources and asks questions.*

## The pattern

An LLM **incrementally builds and maintains a persistent wiki** -- a structured,
interlinked directory of markdown files that sits between the human and the raw
sources. When a new source arrives, the LLM reads it, extracts what matters,
and integrates it into the existing wiki: updates entity pages, revises topic
summaries, flags contradictions with existing claims, strengthens or challenges
the evolving synthesis. The knowledge is compiled once and kept current, not
re-derived on every query.

Contrast with [[rag-vs-wiki]] -- RAG rediscovers knowledge on every question;
this pattern accumulates.

## Three layers

| Layer | What lives there | Who owns it |
|---|---|---|
| Raw sources | Articles, transcripts, papers, images, code dumps | Human (curates); LLM reads only |
| Wiki | Summaries, entity/concept/architecture/decision pages | LLM (writes and maintains) |
| Schema | `schema/CLAUDE.md` -- directory structure, conventions, workflows | Co-evolved by human and LLM |

In this wiki the three layers are `raw/`, `pages/`, and `schema/CLAUDE.md`.

## Three operations

### Ingest
1. Human drops a source into `raw/`.
2. LLM reads it and discusses key takeaways with the human.
3. LLM creates a source-summary page under `pages/sources/`.
4. LLM updates every page in `concepts/`, `architecture/`, `design/`, or `decisions/` that the source touches.
5. LLM updates `index.md` and appends to `log.md`.

A single ingest can touch 10-15 pages. That is the point.

### Query
1. Human asks a question.
2. LLM reads `index.md` first, then drills into the relevant pages.
3. LLM synthesises an answer with citations back to the raw sources.
4. If the answer is non-trivial, the LLM files it back into the wiki as a new page so it compounds instead of evaporating into chat history.

### Lint
Periodic health check. Look for contradictions between pages, stale claims
newer sources have superseded, orphan pages with no inbound links, important
concepts mentioned but lacking their own page, missing cross-references,
data gaps that a targeted search could fill.

## Two special files

- **`index.md`** -- the content catalog. Every page listed under a category, with
  a one-line hook. Read first on every query.
- **`log.md`** -- append-only, chronological. Consistent line prefix
  (`## [YYYY-MM-DD] op | title`) keeps it greppable. Timeline of the wiki's
  evolution and context for the LLM on what has happened recently.

## Human-LLM division of labour

| Human | LLM |
|---|---|
| Curate sources | Read sources |
| Ask questions | Synthesise answers |
| Direct exploration | Bookkeeping: cross-refs, summaries, consistency |
| Judge what matters | Touch 10-15 files per ingest without complaining |
| Evolve the schema | Follow the schema |

## Why it works

Humans abandon wikis because the maintenance burden grows faster than the
value. LLMs don't get bored, don't forget cross-references, and edit many files
in one pass. Maintenance cost drops to near zero, so the wiki stays maintained,
so it stays useful.

## Applied to this project

This wiki is instantiated for the aura-agent project. The page categories
(`concepts`, `architecture`, `design`, `decisions`, `sources`) and the log
format are spelled out in `schema/CLAUDE.md`. Cross-reference style is
Obsidian-compatible `[[Page Name]]` wikilinks so the human can browse the graph
view while the LLM edits.

## See also

- [[rag-vs-wiki]] -- why accumulation beats retrieval for a long-lived knowledge base.
- [[Karpathy -- LLM Wiki]] (`pages/sources/karpathy-llm-wiki.md`) -- the source summary.
- `raw/karpathy-llm-wiki.md` -- the full original gist.
