# Wiki Schema

This wiki follows the LLM Wiki pattern (Karpathy, 2026). The LLM maintains all pages; the human curates sources and directs exploration.

## Directory Structure

```
aura-agent/
  raw/              # Immutable source documents (articles, papers, transcripts, notes)
    assets/         # Downloaded images and media
  pages/            # LLM-maintained wiki pages (markdown)
    concepts/       # Core ideas and patterns behind the project
    architecture/   # System design, components, data flow
    design/         # Feature specs, UX, behavioral contracts
    decisions/      # ADRs -- why a choice was made over alternatives
    sources/        # One page per ingested raw source (summary + takeaways)
  schema/           # Wiki configuration (this file)
  index.md          # Content catalog with links and summaries
  log.md            # Chronological record of wiki operations
```

## Page Conventions

- Every page starts with `# Title` followed by a one-line summary in italics.
- Use `[[Page Name]]` style wikilinks for cross-references (Obsidian-compatible).
- Add YAML frontmatter with: `tags`, `created`, `updated`, `sources`.
- Keep pages focused: one entity/concept per page, 200-800 lines max.
- Use tables for comparisons, code blocks for examples.
- Cite raw sources as `([raw/source-name.md](../raw/source-name.md))` when making a factual claim.

## Workflows

### Ingest
1. Drop source into `raw/` (articles, transcripts, notes, code dumps).
2. LLM reads source, discusses key takeaways with user.
3. LLM creates a summary page under `pages/sources/` for the new material.
4. LLM updates relevant pages in `concepts/`, `architecture/`, `design/`, `decisions/` with new information and cross-references.
5. LLM updates `index.md` and appends an entry to `log.md`.

### Query
1. User asks a question.
2. LLM reads `index.md` to find relevant pages, then drills in.
3. LLM synthesizes an answer with citations.
4. If the answer is valuable, file it as a new wiki page (usually under `concepts/` or `design/`).

### Lint
1. Check for contradictions, orphan pages, stale claims.
2. Check for missing cross-references between related pages.
3. Flag important concepts mentioned but lacking their own page.
4. Suggest new questions to investigate and new sources to seek.

## Log Format

Each entry in `log.md` starts with a consistent prefix so it stays greppable:

```
## [YYYY-MM-DD] <op> | <short title>
<one-paragraph summary of what happened and which pages changed>
```

`<op>` is one of: `init`, `ingest`, `analysis`, `design`, `decision`, `lint`, `refactor`, `milestone`.

## Domain

This wiki is the knowledge base for the **aura-agent** project.

**aura-agent** is a personal agent for running tests, watching their output,
and notifying the user on errors or completion. It is TUI-first, takes natural
language, asks for missing test info before executing, keeps the user posted
during the run (Claude-Code-style loop), applies a user-specified per-error
"stop vs notify" policy, and summarises results at the end. It operates
human-in-the-loop by default with an opt-in bypass mode for autonomous runs.

Source of record: [[Aura Agent -- Initial Brief]]
(`raw/aura-agent-brief-2026-04-16.md`). Open ambiguities live in
[[open-questions]] (`pages/design/open-questions.md`) until resolved.

The raw layer holds whatever feeds the design: the initial brief, follow-up
notes, external articles on relevant patterns (Claude Code's run loop,
permission models, TUI frameworks, GitHub's model/agent offerings), and code
dumps from adjacent projects (e.g. the jules-daemon SSH test runner in a
sibling directory).
