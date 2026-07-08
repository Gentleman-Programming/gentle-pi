# Exploration — orchestrator-lazy-diet

## Problem

assets/orchestrator.md (22,626 B ≈ 5,650 tokens) is injected ALWAYS-ON into every Pi parent session (extensions/gentle-ai.ts getOrchestratorPrompt :123-133, appended at :2208), while a lazy-load pattern already exists in the same package: the orchestrator's "## SDD Workflow (lazy-loaded)" section points to assets/sdd-orchestrator-workflow.md (12,425 B) by path instead of inlining it.

gentle-ai applied the same diet to its Claude orchestrator: 7.8KB always-on + 13.8KB lazy file. gentle-pi's equivalent should follow: keep the thin always-on core (delegation triggers, review lens selection pointers, memory contract summary) and move the long-tail detail to lazy-loaded reference files the orchestrator reads on demand.

## Verified facts (2026-07-08 audit)

- orchestrator.md sections include: Identity Contract (:5-21), Language Boundary (:28-42), delegation rules, Mandatory Delegation Triggers, Review Lens Selection / 4R Review Triggers, Memory Contract (:206-243), SDD Workflow lazy pointer, and more (inventory the full section list).
- The lazy workflow file (12.4KB) is NOT double-injected — the pointer pattern works today.
- Always-on parent injection totals ~24.7KB from gentle-pi alone (~6,170 tokens); orchestrator.md is 92% of it.

## Decision space for proposal

1. Section-by-section disposition table (the gentle-ai persona-change method): always-on core vs lazy reference file(s), with a target always-on budget (suggest ≤8KB).
2. What is load-bearing every turn: delegation trigger thresholds, review lens table pointer, memory contract one-liner, lazy-file paths. What is not: long protocol prose, examples, per-phase details.
3. Identity Contract and Language Boundary sections interact with persona-single-channel (parallel change) — that change dedupes them against the wrapper; this change decides where the SINGLE copy lives (thin core) — coordinate: define which change owns which orchestrator.md regions, or sequence applies.
4. Drift-guard: a TS test asserting the always-on file stays under the byte budget and that lazy files carry the moved normative sections (frozen-fixture union test per gentle-ai's lesson — nothing lost).

## Constraints

- Strict TDD (pnpm test); measure before/after (bytes and ≈tokens, stated method); the getOrchestratorPrompt cache (:123-133) and path substitution must keep working for the thin core + any new lazy files.
