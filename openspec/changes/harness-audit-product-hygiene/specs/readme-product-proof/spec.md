# Spec — README landing: mechanism-first, honest claims (product-proof-saas)

## Context

The README is the package's landing surface. Two problems: (1) version/examples drift — install examples still say `npm:gentle-pi@0.14.0` and describe the v0.15+ split while the package is 2.2.0; (2) the landing can better follow product-proof-saas: show the mechanism (state flow, real operation) before broad capability claims, and never invent metrics or outcomes.

## Acceptance criteria

- AC1: Version-freshness: install/version examples reference the current release (2.2.x); the "stable vs RDD" note is either updated to reflect the current line or removed if no longer accurate.
- AC2: Mechanism-first: a short "How it works" section describes the actual controlled flow as explicit states — e.g. clarify → explore/proposal/spec/design/tasks → apply → verify → sync → archive, and the review authority boundary (native `gentle-ai` CLI owns evidence; delivery follows ordinary repository policy) — with a description of real states (blocked/proceed/asked gates), not a magical one-click promise.
- AC3: Honesty pass: remove or neutralize any claim not backed by the repo (no invented customers, metrics, availability, performance, or security statements; badges already real stay; capability table entries must map to real assets/commands).
- AC4: The feature table stays, but entries are anchored to the mechanism section by direct cross-reference; no "fake dashboard" style decoration.
- AC5: A diff/review of README asserts: every referenced command and path exists (verify by checking the repo: `/gentle:status`, `/gentle:doctor`, `sdd-attempt`, `review` CLI surface as in `gentle-ai --help`).
- AC6: No visual redesign of the GitHub README beyond the above; content structure changes only where the mechanism-first and honesty principles require.

## Non-constraints

- The README stays a single Markdown file; no separate docs site, no images required.
- product-proof-saas's interaction-state specs (pricing tabs, deep-linked FAQ) apply only where the README has comparable interactive claims; the README currently does not — no invented pricing/comparison content.