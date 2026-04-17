---
tags: [concept, wiki-design, comparison]
created: 2026-04-16
updated: 2026-04-16
sources: [raw/karpathy-llm-wiki.md]
---

# RAG vs Wiki

*Two different answers to "how should an LLM use a pile of documents": retrieve fragments on demand, or compile knowledge into a maintained artifact.*

## The comparison

| Dimension | RAG | LLM Wiki |
|---|---|---|
| Primary artifact | Vector index over chunks | Cross-referenced markdown files |
| When work happens | At query time | At ingest time (and on lint passes) |
| Knowledge state | Re-derived each query | Persistent, compounding |
| Cross-references | None (chunks are independent) | Explicit wikilinks between pages |
| Contradictions | Invisible -- surface only if retrieved together | Flagged during ingest, resolved on the page |
| Good answers | Disappear into chat history | Filed back as new pages |
| Human-readable? | Not really -- chunks out of context | Yes -- browsable like any wiki |
| Scales via | Better embeddings + re-rankers | Better schema + optional local search (e.g. qmd) |
| Typical tooling | NotebookLM, ChatGPT uploads, vector DB + RAG pipeline | Obsidian + LLM agent + git |

## Why the wiki accumulates and RAG doesn't

RAG treats each question as independent. Ask the same subtle cross-document
question twice, and the LLM rediscovers the synthesis from scratch both times.
Nothing the LLM figured out last time is available to it this time. The index
never learns.

The wiki inverts that. The expensive work -- reading, summarising,
cross-referencing, reconciling contradictions -- happens once, at ingest, and
the result is persisted as markdown. The next query starts from the synthesis,
not from the chunks. Good answers get filed back as pages, so explorations
compound too. See [[llm-wiki-pattern]] for the full operating model.

## When RAG is still the right tool

- **Large corpora you don't control** (customer-support KBs, enterprise data lakes) where paying maintenance cost per document is infeasible.
- **Freshness requirements** where sources change faster than the wiki can be kept in sync.
- **Shallow lookup** -- find-me-the-paragraph questions where no synthesis is needed.
- **No curator** -- RAG tolerates an uncurated pile; wikis need a human who cares which sources go in.

## When the wiki pattern wins

- **Long-lived knowledge base** on a bounded domain.
- **Synthesis-heavy questions** that span many sources.
- **Curated sourcing** where you control what enters `raw/`.
- **Humans who read and browse** the artifact, not just query it.

## Hybrid: wiki + search

At moderate scale (~hundreds of pages) `index.md` is enough navigation. Past
that, add a local search engine over the wiki pages -- e.g. qmd, which does
BM25 + vector + LLM re-ranking on-device. This is still the wiki pattern; the
search is over the compiled artifact, not the raw corpus.

## See also

- [[llm-wiki-pattern]] -- the operating model this wiki runs on.
- [[Karpathy -- LLM Wiki]] (`pages/sources/karpathy-llm-wiki.md`) -- the source.
