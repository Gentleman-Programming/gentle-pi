# Cross-tool contract: Pi-session persona ownership (gentle-pi ↔ gentle-ai)

This note documents the ownership handoff between `gentle-pi` (this repo) and the sibling
`gentle-ai` Pi adapter for identity/persona/language content injected into Pi coding-agent
sessions. Slimming `gentle-ai`'s `APPEND_SYSTEM.md` persona section (37,276 B, unchanged by this
change) is explicitly **out of scope** here — it is a `gentle-ai`-owned follow-up (pattern mirrors
`gentle-ai`'s own `engram-protocol-dedup/upstream-protocol-flag-contract.md`, which documents an
analogous upstream handoff to `gentle-engram`).

## Title / intent

`persona-single-channel` makes `gentle-pi`'s always-on parent-session injection (the
`buildGentlePrompt` wrapper block + `assets/orchestrator.md`, concatenated once per parent session
at `extensions/gentle-ai.ts:2204-2208`) the single canonical source of Pi-session
identity/persona/language content. This document records the guarantees that hold on the
`gentle-pi` side today, and the follow-up expectation on the `gentle-ai` side.

## Guarantee 1 — gentle-pi is canonical for Pi-session identity/persona/language

For any Pi parent session running the `gentle-pi` extension, the wrapper block
(`extensions/gentle-ai.ts` `buildGentlePrompt`) plus `assets/orchestrator.md` is the SINGLE source
of identity, persona, and reply-language-style content. `orchestrator.md`'s Identity Contract and
Language Boundary LB1 sections are one-line pointers back to the wrapper (this change); no other
`gentle-pi` file duplicates this content in the parent-session injection path.

- Named/SDD subagent sessions receive an empty `gentlePrompt` branch
  (`extensions/gentle-ai.ts:2204-2206`, untouched by this change) — this guarantee applies only to
  the parent session.
- The known residual third memory-rule copy at `gentle-ai.ts:198` (Harness principles block,
  "Never claim persistent memory is available because of this package...") is out of scope for this
  change (design.md Table A footnote) — tracked as a follow-up cleanup, not a blocking finding.

## Guarantee 2 — upstream (gentle-ai's Pi adapter) MUST slim to a residual/pointer

`gentle-ai`'s Pi adapter injects a separate, larger persona/identity block via
`APPEND_SYSTEM.md`'s `<!-- gentle-ai:persona -->` section (37,276 B, measured on this branch,
unchanged by this change). Once `gentle-pi`'s wrapper + `orchestrator.md` is canonical
(Guarantee 1), that upstream section is a duplicate at the tool level (a third copy of
identity/persona/language content, this time in a different repository's injected file).

`gentle-ai`'s Pi adapter MUST reduce `<!-- gentle-ai:persona -->` to an action/tooling residual
that does NOT restate identity, persona, or language-style tone content — it may keep
Pi-adapter-specific mechanics (tool wiring, capability flags, invocation instructions) but must not
duplicate the identity/persona/language prose that `gentle-pi` now owns. This mirrors the residual
pattern already established by the `persona-canonical-channel` change (see review-ledger.md context
above; that precedent is why `gentle-pi`'s union sweep in this change is line-level, not
section-level — it previously caught 3 content-loss regressions the same class of dedup can
introduce).

- This guarantee does NOT ship in this change. It is recorded here so the `gentle-ai` follow-up
  change has a concrete, gentle-pi-side-verified target to slim against.
- Until the `gentle-ai` follow-up lands, `APPEND_SYSTEM.md`'s persona section remains a duplicate
  for any environment where BOTH `gentle-pi`'s Pi extension AND `gentle-ai`'s Pi adapter are active
  in the same session. This is a known, accepted, temporary state — not a regression introduced by
  this change (this change only touches `gentle-pi`'s own injection).

## Guarantee 3 — marker idempotency

`gentle-ai`'s `<!-- gentle-ai:persona -->` section is marker-delimited and re-injected via
`InjectMarkdownSection`'s full-section-replace semantics (gentle-ai's own convention, referenced
here for the follow-up's benefit). When the `gentle-ai` follow-up slims that section, the slim
MUST converge on re-inject (i.e., re-running the injection with the already-slimmed section content
present MUST be a no-op / MUST NOT orphan old content or double-append) — the same idempotency
guarantee `gentle-ai` already provides for its other marker-delimited sections.

## Drift control

- This document is the single source of truth for the ownership boundary described above; if
  `gentle-pi` wording and any future `gentle-ai`-side documentation of this boundary conflict,
  `gentle-pi`'s wording in this document wins (gentle-pi is canonical per Guarantee 1).
- Any future edit to `gentle-pi`'s Identity Contract / Language Boundary / persona-prompt content
  MUST be reflected here if it changes what the `gentle-ai` follow-up is expected to slim against.

## Cross-reference

- `openspec/changes/persona-single-channel/proposal.md` → Dependencies (links back to this
  document).
- `openspec/changes/persona-single-channel/design.md` → Decision 1 (canonical home), Table A/B
  (union reconciliation), "Cross-tool ownership contract (required outline)" (the outline this
  document fulfills).
- `openspec/changes/persona-single-channel/specs/session-persona/spec.md` → "Requirement: Cross-Tool
  Ownership Contract Documented".
- `gentle-ai` follow-up change id: **TBD** — to be filed in the `gentle-ai` repository once this
  change merges; it should link back to this document as its source of the slimming target.
- `gentle-ai`'s `engram-protocol-dedup/upstream-protocol-flag-contract.md` — the precedent this
  document's structure mirrors (three numbered guarantees + drift control + cross-reference).
