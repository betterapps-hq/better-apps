---
name: internal-documentation
description: Write, update, or review internal engineering documentation, including architecture maps, feature explanations, and runbooks. Use when documenting how a system works today, where to change it, and why its boundaries exist; keep histories and agent instructions in their own documents.
---

# Internal documentation

Write for the engineer who needs to understand, change, or operate the system without a conversation with its author. Give them a reliable map of the implementation and the reasons behind its important boundaries. Treat code and configuration as the source for volatile details; document the knowledge a reader cannot infer easily from a file listing.

## Establish the current truth

- Inspect the relevant code, configuration, tests, and existing docs before describing behavior. Trace the actual entry point and dependency path. Resolve contradictions or state uncertainty rather than repeating an old document as fact.
- Say what the system does and how a reader uses or changes it. Explain _why_ a boundary, invariant, or unusual choice exists when that reason affects future work. Name the relevant module, file, symbol, command, or contract when it helps the reader find or verify the claim.
- Write in the present tense. Remove time-relative labels such as “now,” “currently,” “new,” “latest,” “soon,” and “does not yet” from descriptions of normal behavior. Use a date or version only when it defines a real compatibility boundary. Plans belong in proposals; change history belongs in records.
- Update the existing explanation in place when behavior changes. Remove superseded claims and examples. Do not append a narrated migration to the active guide or preserve parallel descriptions of the same behavior.

## Give a map, not an inventory

- For architecture, start with the problem and major flow, then describe coarse modules, their responsibilities, dependency direction, important boundaries, and cross-cutting concerns. Answer “where should I change this?” and “what does this part own?” Keep local implementation detail with the code or in a focused topic page.
- Call out invariants a reader cannot discover by browsing files, including meaningful absences: for example, a domain package does not import UI code. Explain the consequence and reason rather than stating a slogan.
- Name a few stable paths or searchable symbols when they serve as landmarks. Link to the authoritative manifest, config, API schema, or generated reference for a changing inventory. Do not maintain a second list of every package, route, flag, dependency, or test.
- Avoid brittle totals, ordinal references, and numbered headings that imply a fixed count: “the seven adapters,” “the third package,” “step 4 above.” Use descriptive headings and links. Enumerate when order matters for a procedure or when the list is a closed contract.
- Keep exact commands, paths, values, and examples where a reader needs them to act safely. Timeless does not mean vague. Verify these details against the source before publishing.

## Keep each document's job clear

- Stable architecture and conventions explain enduring rules and boundaries. A current-state page describes the situation to act on and is rewritten when it changes. Decision records and changelogs preserve history. Proposals describe unaccepted possibilities. Do not make a current guide double as an append-only log.
- Prefer one authoritative home for each claim. Link to it from other pages instead of copying it. Place docs by topic and reader need, using the repository's existing structure; do not create a taxonomy of folders or maintenance headers solely to classify documents.
- Before adding a page, identify its reader and distinct question. Use an existing page or section when that gives the reader a clearer route. Keep the entry path short and retire superseded active pages when consolidation is in scope.

Read [paired examples](references/paired-examples.md) when drafting or reviewing architecture, feature, or operational docs. They show the difference between useful specificity and details that go stale.

## Review

Check that a new engineer can find the implementation, understand its behavior and rationale, and act without knowing prior versions. Verify that the claims match the system, that changing lists have a single owner, and that the page contains no obsolete narrative or unsupported future promises.

For instructions meant to direct an agent's behavior, use [writing-for-agents](../writing-for-agents/SKILL.md). For prose and sentence-level editing, use the relevant writing skill. This skill governs the content and maintenance of internal engineering docs.

Approach adapted from [Google's timeless documentation](https://developers.google.com/style/timeless-documentation), [matklad's ARCHITECTURE.md](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html), and [document-governance](https://github.com/Fadelis98/document-governance/blob/main/SKILL.md).
