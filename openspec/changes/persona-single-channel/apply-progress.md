# Apply Progress: persona-single-channel

**Mode**: Strict TDD (RED → GREEN → REFACTOR, `pnpm test` runner, node:test)
**Status**: 20/20 tasks complete (all phases). Ready for `sdd-verify`.

## Summary

Made `extensions/gentle-ai.ts`'s `buildGentlePrompt` wrapper block the single canonical home for
Pi-session identity/persona/language content, collapsing `assets/orchestrator.md`'s duplicated
Identity Contract and Language Boundary LB1 sections to one-line pointers (LB2-LB5 kept verbatim —
unique delegation/artifact rules). Locked the union with a frozen-fixture, RED-first migration test
(`tests/persona-single-channel.test.ts`, 28 assertions). Added a language-match clause to
`GENTLEMAN_PERSONA_PROMPT` mirroring `NEUTRAL_PERSONA_PROMPT`. Recorded measured byte deltas and a
cross-tool ownership contract doc.

## Completed Tasks (all phases)

- [x] 0.1 Branch gate — satisfied at apply start.
- [x] 1.1-1.6 RED — frozen fixtures + all guards + byte-delta placeholder, confirmed failing against pre-change source.
- [x] 2.1-2.3 GREEN — `extensions/gentle-ai.ts` edits.
- [x] 3.1-3.3 GREEN — `assets/orchestrator.md` edits.
- [x] 4.1-4.3 Byte measurement — `byte-measurements.md` + test assertions updated with real values.
- [x] 5.1 Cross-tool ownership contract doc.
- [x] 6.1-6.3 Verification — regression test, full suite, spec.md acceptance criteria.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `tests/persona-single-channel.test.ts` | Created | Frozen-fixture line-level union sweep (Table A/B rules), exact-string + concept-level (regex) duplication guards, added-rule assertion, byte-delta assertions with real measured values, persona-selection regression checks. 28 tests, all passing post-change. |
| `extensions/gentle-ai.ts` | Modified | `GENTLEMAN_PERSONA_PROMPT` (:148-155) gains `- Always respond in the same language the user writes in.` (mirrors `NEUTRAL_PERSONA_PROMPT`, position 2 in the bullet list to match). Wrapper Identity contract block (was :179-184) replaced with design.md's exact post-change text (5-bullet union, merged self-description paragraph, trimmed persona-mode bullet). |
| `assets/orchestrator.md` | Modified | `## Identity Contract` (was :5-21) replaced with the one-line pointer. `## Language Boundary` LB1 sentence (was :30) replaced with the one-line pointer; LB2 (subagent-English), LB3 (artifacts-English), LB4 (public-comment language), LB5/Exceptions kept verbatim, byte-for-byte. |
| `tests/artifact-language.test.ts` | Modified (collateral) | One pre-existing assertion asserted the OLD LB1 sentence verbatim (`/User-facing conversation should stay in the user's language/`). Updated to assert the new pointer text instead — the rest of that test (artifact-language separation, LB2-LB5 content) was unaffected and untouched. See Deviations. |
| `openspec/changes/persona-single-channel/byte-measurements.md` | Created | Section-level and whole-file `wc -c` before/after measurements, method, comparison against design.md's converged figures, and the one flagged 1B deviation (orchestrator Identity pointer: 149B measured vs 148B estimate). |
| `openspec/changes/persona-single-channel/cross-tool-persona-ownership-contract.md` | Created | gentle-pi-canonical ownership statement + 3 guarantees + drift control + cross-reference, mirroring gentle-ai's `engram-protocol-dedup/upstream-protocol-flag-contract.md` pattern. Documents gentle-ai's `APPEND_SYSTEM.md` persona-section slimming as an out-of-scope follow-up. |
| `openspec/changes/persona-single-channel/tasks.md` | Modified | All 20 tasks ticked `[x]` with completion notes. |
| `openspec/changes/persona-single-channel/specs/session-persona/spec.md` | Modified | All 6 Acceptance Criteria bullets ticked `[x]`. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.6 (RED fixtures + guards) | `tests/persona-single-channel.test.ts` | Unit | N/A (new file) | ✅ Written (28 assertions) | N/A (RED phase) | ✅ Both persona modes (gentleman + neutral) covered per rule | N/A |
| 2.1-2.2 (`gentle-ai.ts` edits) | `tests/persona-single-channel.test.ts` | Unit | ✅ 8/8 (`persona-neutral-voseo.test.ts` baseline, run before editing) | ✅ (from 1.1-1.6) | ✅ 28/28 pass after edit | ✅ Both modes | ✅ No further extraction needed — design.md text copied verbatim, not re-derived |
| 2.3 (named/SDD branch unaffected) | N/A — verified via `git diff --stat` | N/A | N/A | N/A | ✅ 0 diff on the `isNamedAgent \|\| isSddAgent` branch (`:2204-2206`) | N/A | N/A |
| 3.1-3.2 (`orchestrator.md` edits) | `tests/persona-single-channel.test.ts` | Unit | ✅ (same run) | ✅ (from 1.1-1.6) | ✅ 28/28 pass after edit | ✅ Both modes | ➖ None needed — pointer text is final per design.md, terse by design |
| 4.1-4.3 (byte measurement) | `tests/persona-single-channel.test.ts` (byte-delta tests) | Unit | N/A | ✅ (placeholders written first, task 1.6) | ✅ Updated to real measured values, all pass | ➖ Single measurement per region (structural, one possible output) | ➖ None needed |
| 5.1 (cross-tool contract doc) | N/A — documentation artifact | N/A | N/A | N/A | N/A | N/A | N/A |
| 6.1-6.3 (verification) | Full `pnpm test` | Unit | ✅ | N/A | ✅ 271/271 (243 baseline + 28 new) | N/A | N/A |

### Test Summary

- **Total tests written**: 28 (new file) + 1 assertion updated in an existing file (collateral fix)
- **Total tests passing**: 271/271 (full `pnpm test`, includes `test:harness`)
- **Layers used**: Unit (28 new + 1 modified), no integration/E2E (none available per project config)
- **Approval tests** (refactoring): None — this is additive/replacement text, not a behavioral refactor of logic; the frozen PRE_*/POST_* fixtures serve the same "preserve documented reality" function as approval tests would.
- **Pure functions created**: 0 (test-only helpers: `countOccurrences`, `countLanguageMatchConceptOccurrences` — both pure)

## RED Evidence (Phase 1, before any source edit)

First run (with a transcription bug in `PRE_ORCH_IDENTITY`, see Deviations): 17 pass / 9 fail.
After fixing the transcription bug: **19 pass / 7 fail**. The 7 genuine RED failures, all directly
tied to the pre-change LIVE source (not fixture bugs):

1. `Table A rule: orchestrator :17 'never introduce yourself...' ADDED to wrapper` — wrapper doesn't have it yet.
2. `Table A rule: persona-mode selection (trimmed) survives` — wrapper still has old wording.
3. `orchestrator.md Identity Contract collapses to the one-line pointer` — orchestrator.md unedited.
4. `orchestrator.md Language Boundary LB1 collapses to the one-line pointer` — orchestrator.md unedited.
5. `dup guard (exact-string): 'Do not claim portability...' occurs exactly once` — **2 occurrences pre-change** (wrapper :184 + orchestrator :20, byte-identical) — confirmed via `rg -c` before writing the test.
6. `dup guard (concept-level): language-match regex...` — **2x (gentleman) / 3x (neutral)** non-excepted occurrences pre-change, confirmed via `rg -n` cross-check against both full files before writing the test. Matches the apply prompt's "2x/3x duplication" note exactly.
7. `added rule: gentleman output contains the new GENTLEMAN_PERSONA_PROMPT clause` — clause doesn't exist yet pre-change (JD-001 finding).

**RED direction**: failures = pre-change duplication / missing-rule state. This is the expected
direction — the assertions describe the POST-change target state, so they fail until the source is
edited (Phase 2/3), then pass (GREEN, 28/28).

## Measured Byte Deltas (see byte-measurements.md for full detail)

| Region | Before | After | Δ | vs design.md |
|---|---|---|---|---|
| Wrapper Identity contract block | 438 B | 817 B | +379 B | Exact match |
| Orchestrator Identity Contract | 831 B | 149 B | −682 B | 1 B high (149 vs 148, counting-convention noise, not a wording diff) |
| Orchestrator Language Boundary | 2,117 B | 2,079 B | −38 B | New measurement (design.md didn't re-measure post-change) |
| New GENTLEMAN clause line | 0 B | 58 B | +58 B | Matches "~60 B" estimate within 2 B |
| **Net per session (gentleman)** | — | — | **−283 B (≈ −0.28 KB)** | Within design's converged "≈ −0.3 KB" |
| **Net per session (neutral)** | — | — | **−341 B (≈ −0.33 KB)** | Within design's converged "≈ −0.3 KB" |

Whole-file `wc -c` cross-check: `extensions/gentle-ai.ts` +437 B, `assets/orchestrator.md` −719 B
(1 B off the −720 B section-sum, same rounding-noise artifact, confirmed via `git diff --stat`
showing only the two intended hunks per file).

## Deviations from Design

1. **Fixture transcription bug, self-caught and fixed before recording RED.** My first transcription
   of `PRE_ORCH_IDENTITY` (frozen from `orchestrator.md:5-21`) was missing the trailing blank line
   (line 21 is blank before `## Core Role`), producing 830 B instead of the judge-measured 831 B. A
   fixture-integrity self-check test (`Buffer.byteLength(...) === 831`) caught this immediately. Fixed
   by adding the missing blank line before recording the official RED run. Not a design deviation —
   a test-authoring bug caught by the test suite itself, working as intended.
2. **Orchestrator Identity Contract pointer measures 149 B, not design's 148 B estimate.** 1 B
   difference, same trailing-newline/range-boundary counting convention that also produced the
   831 B pre-change figure (both consistently include one newline after the block's last content
   line). The wording is copied verbatim from design.md's "Exact post-change text" section — this is
   a measurement-convention artifact, not a text change. Flagged in `byte-measurements.md`.
3. **One pre-existing test needed a collateral fix**: `tests/artifact-language.test.ts`'s first test
   asserted the OLD LB1 sentence (`/User-facing conversation should stay in the user's language/`)
   verbatim. This is expected fallout of the LB1→pointer change this migration is SPEC-APPROVED to
   make (spec.md "Requirement: Single Canonical Identity/Persona/Language Channel", JD-003-amended).
   Updated that one assertion to match the new pointer text; the rest of that test file (artifact-vs-
   conversation language separation, LB2-LB5 content checks) is unaffected and was left untouched.
   This was NOT listed as a task in tasks.md — recorded here as an out-of-list collateral fix required
   to keep `pnpm test` green (task 6.2's explicit requirement).
4. **Position of the new `GENTLEMAN_PERSONA_PROMPT` clause**: design.md doesn't specify the exact
   bullet position, only that it "mirrors NEUTRAL_PERSONA_PROMPT :158." I placed it at position 2 in
   `GENTLEMAN_PERSONA_PROMPT`'s bullet list (immediately after "Be direct, technical, and concise."),
   matching `NEUTRAL_PERSONA_PROMPT`'s own position-2 placement of the same clause, for structural
   symmetry. Text is byte-identical to design's specified clause either way.

None of these deviations change any normative rule text from design.md's "Exact post-change text"
section — all canonical block wording was copied verbatim, not re-derived.

## Issues Found

None blocking. The two 1-byte measurement deviations (items 2 above) and the flagged 1B whole-file
vs section-sum rounding noise are cosmetic byte-counting-convention artifacts, not content defects —
recorded transparently per task 4.2's "flag deviations" instruction rather than silently reconciled.

## Remaining Tasks

None. All 20 tasks across 7 phases complete.

## Workload / PR Boundary

- Mode: single PR, `size:exception` (per tasks.md Review Workload Forecast: `Chain strategy:
  size-exception`, `400-line budget risk: Medium`, `Decision needed before apply: No`).
- Current work unit: Unit 1 (full dedup: RED tests → gentle-ai.ts → orchestrator.md → byte doc →
  contract doc → green) — the only planned unit, completed in full.
- Boundary: starts at Phase 0 (branch gate, pre-satisfied) and ends at Phase 6 (full green suite +
  spec acceptance criteria checked).
- Estimated review budget impact: diff is `tests/persona-single-channel.test.ts` (new, ~460 lines,
  fixture-heavy — the dominant contributor anticipated in the forecast), `extensions/gentle-ai.ts`
  (+5/-4 lines), `assets/orchestrator.md` (+2/-15 lines), `tests/artifact-language.test.ts` (+4/-1,
  collateral), plus two new markdown artifacts (`byte-measurements.md`,
  `cross-tool-persona-ownership-contract.md`) and the two OpenSpec tracking files
  (`tasks.md`, `spec.md` checkboxes). Consistent with the tasks.md forecast (~300-400 lines,
  Medium risk, single PR with accepted exception).

## Final Test Output

Full `pnpm test` (`node --experimental-strip-types --test tests/*.test.ts && pnpm run
test:harness`): **271/271 pass, 0 fail** (243 baseline + 28 new from
`tests/persona-single-channel.test.ts`). `test:harness` (`tests/runtime-harness.mjs`) completed with
exit code 0.

## Status

20/20 tasks complete. Ready for verify.

## Post-review reconciliation (implementation judgment-day round)

- RED count: the recorded "19 pass / 7 fail" run predates the two "Persona Constant Selection Keeps Working" regression tests (added in Phase 4); the final 28-test file reproduces 21 pass / 7 fail against pre-change source (judge-verified; the 7 genuine failures and their duplication counts 2x/3x are exact).
- Deviation #5: the SHARED_PERSONA_BULLETS refactor (design Decision 3, open question) was deliberately DEFERRED — the two persona constants remain independent literals (now with 5 shared bullets); tracked as follow-up, not silently dropped.
- Accepted-known: the named/SDD-agent injection branch (gentle-ai.ts:2204-2208) is verified untouched by zero-diff inspection (three reviewers) but has no automated regression test — accepted for this change; candidate follow-up if a hook-level test harness lands.
