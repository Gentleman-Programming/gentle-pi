# Verification Report: persona-single-channel

**Change**: persona-single-channel
**Mode**: Strict TDD (`pnpm test`, node:test), full artifact set (proposal/design/specs/tasks/apply-progress present)
**Verdict**: PASS WITH WARNINGS

## Completeness

- Tasks: 20/20 checked in `tasks.md` (0 unchecked) — verified by direct count, not just the apply-progress claim.
- Acceptance Criteria: 6/6 checked in `specs/session-persona/spec.md` — verified by direct count.
- `apply-progress.md` reports "20/20 tasks complete. Ready for verify." — consistent.

## Test Execution Evidence

Ran `pnpm test` (`node --experimental-strip-types --test tests/*.test.ts && pnpm run test:harness`) directly:

```
ℹ tests 271
ℹ pass 271
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
$ node --experimental-strip-types tests/runtime-harness.mjs   (exit 0)
```

271/271 pass, matches apply-progress's claimed count exactly (243 baseline + 28 new in `tests/persona-single-channel.test.ts`). `tests/persona-neutral-voseo.test.ts` (8 tests) included and green.

## Spec Compliance Matrix

| Requirement | Scenario | Test coverage | Status |
|---|---|---|---|
| Single Canonical Identity/Persona/Language Channel | Parent session single-source injection | `persona-single-channel.test.ts` dup guards (exact-string + concept-level regex), all pass | PASS |
| " | Identity Contract pointer preserves discoverability | `orchestrator.md Identity Contract collapses to the one-line pointer` test, pass | PASS |
| " | Language Boundary LB1 pointer + LB2-5 verbatim | `LB1 collapses...LB2-LB5 remain verbatim` test + 4 separate LB2/3/4/5 verbatim tests, pass | PASS |
| Union Reconciliation With Zero Rule Loss | Migration test validates the union | Line-level union sweep, one named assertion per Table A/B rule, all pass; independently re-verified below | PASS |
| " | Frozen fixtures remain immutable | Fixtures unedited during apply per apply-progress; file-integrity self-check test passes | PASS |
| Persona Constant Selection Keeps Working | Gentleman/Neutral selected | 2 dedicated tests (no cross-leak of voseo bullets), pass | PASS |
| Named/SDD Subagent Branches Unaffected | SDD subagent launch unaffected | **No runtime test exercises `agent_start` with `isNamedAgent`/`isSddAgent` true.** Verified only via manual `git diff --stat` (task 2.3) claiming 0 diff on that branch. Independently re-confirmed via `git diff HEAD -- extensions/gentle-ai.ts`: the `isNamedAgent \|\| isSddAgent ? "" : ...` branch (:2205-2207) has zero diff. | **WARNING — no covering runtime test, compliance rests on source inspection only** |
| Cross-Tool Ownership Contract Documented | Ownership contract artifact exists | `cross-tool-persona-ownership-contract.md` exists, contains all 3 guarantees + drift control + cross-reference | PASS (doc-only requirement, no test expected) |
| Measured Byte Delta Recorded | Byte measurement recorded with method | `byte-measurements.md` exists with method + before/after + delta; reproduced independently below | PASS |

## Independent Reproduction — Union Diff (removed orchestrator sections vs new wrapper text)

Diffed `git show HEAD:assets/orchestrator.md` (removed Identity Contract :5-21, removed Language Boundary LB1 :30) against the current wrapper block (`extensions/gentle-ai.ts` :175-185) and current `orchestrator.md`, line by line:

- "You are el Gentleman: ... controlled development work." — byte-identical, kept once (wrapper).
- Self-description translated paragraph ("I am el Gentleman: ...not a generic chatbot.") — merged verbatim into wrapper bullet 1.
- "Never introduce yourself as only 'your assistant' or 'the default assistant'." — merged into wrapper bullet 1 (was orchestrator-only, correctly ADDED per design Table A).
- "Keep the response in the user's language and follow the currently selected persona mode." — trimmed to "Follow the currently selected persona mode."; the language-match clause is NOT lost — it now lives in `GENTLEMAN_PERSONA_PROMPT` as "Always respond in the same language the user writes in." (confirmed present in `gentle-ai.ts` diff, mirrors `NEUTRAL_PERSONA_PROMPT`'s pre-existing identical clause).
- "Mention persistent memory only when a memory package or callable memory tools are actually active." — superseded by wrapper's pre-existing, strictly-richer "Mention memory only when memory packages or callable memory tools are actually active; never invent persistent memory." (superset, not a loss — matches JD-005).
- "Do not claim portability outside the Pi runtime." — byte-identical, kept once (wrapper).
- LB1 ("User-facing conversation should stay in the user's language...") — collapsed to pointer text; the underlying rule (persona-mode language style) is preserved via the wrapper's `Current persona mode:` line + persona-prompt language-match clause, exactly as the pointer states.
- LB2 (subagent-English), LB3 (artifacts-English), LB4 (public-comment language), LB5/Exceptions — confirmed **byte-identical, unchanged** in current `assets/orchestrator.md` vs `git show HEAD` (verified via direct `sed` extraction, not just trusting the design doc).

**Conclusion: no normative rule lost.** This matches the automated test suite's union-sweep and duplication-guard results; the manual line-by-line reproduction found the same result independently.

## Independent Reproduction — Byte Measurements

All figures in `byte-measurements.md` were independently reproduced via direct `wc -c` on this branch (not by trusting the artifact):

| Region | Claimed | Reproduced | Match |
|---|---|---|---|
| Wrapper Identity block (post, lines 180-185) | 817 B | 817 B | Exact |
| Wrapper Identity block (pre, HEAD 179-184) | 438 B | 438 B | Exact |
| Orchestrator Identity Contract (post, lines 5-7) | 149 B | 149 B | Exact |
| Orchestrator Identity Contract (pre, HEAD 5-21) | 831 B | 831 B | Exact |
| Orchestrator Language Boundary (post, lines 15-29) | 2,079 B | 2,079 B | Exact |
| Orchestrator Language Boundary (pre, HEAD 28-42) | 2,117 B | 2,117 B | Exact |
| Whole-file `extensions/gentle-ai.ts` delta | +437 B | +437 B (77,226 → 77,663) | Exact |
| Whole-file `assets/orchestrator.md` delta | −719 B | −719 B (23,766 → 23,047) | Exact |

All byte claims verified bit-for-bit. `byte-measurements.md`'s stated method (`bat --line-range` / `wc -c`, cross-checked with `git diff --stat`) is reproducible and accurate.

## Deviations Review (apply-progress.md, 4 documented)

1. **Fixture transcription bug (self-caught)** — legitimate, self-corrected before recording RED, not a design deviation.
2. **1B measurement-convention artifact (149 vs 148 design estimate)** — verified: same wording, reproducible 149B, cosmetic only. Legitimate.
3. **Collateral fix to `tests/artifact-language.test.ts`** — reviewed the actual diff. The test's stated purpose ("orchestrator keeps conversation language separate from generated artifact language") is preserved: the modified assertion now checks for the new LB1 pointer text instead of the old inline rule sentence, while the LB3 (artifacts-English) and LB4 (public-comment) assertions in the same test are untouched and still enforce the separation. The new assertion is not a weakened/tautological check — it still exercises real file content and would fail if the pointer text regressed or were duplicated back. A one-line comment in the test explains the rationale. **Legitimate, not weakened in a way that reduces test value.**
4. **Position of new `GENTLEMAN_PERSONA_PROMPT` clause** (position 2, mirroring `NEUTRAL_PERSONA_PROMPT`'s own position 2) — verified in source, cosmetic/structural choice only, byte-identical text either way. Legitimate.

## Additional Finding Not Listed in apply-progress.md Deviations

**Design-specified `SHARED_PERSONA_BULLETS` refactor was not implemented, and this was not recorded as a deviation.** `design.md`'s "File Changes" table lists factoring `SHARED_PERSONA_BULLETS` as part of the `extensions/gentle-ai.ts` modification (Decision 3: "factor the 4 shared bullets ... into one `SHARED_PERSONA_BULLETS` base, leaving each persona only its language-specific bullets. Kills intra-constant drift."). Current source (`extensions/gentle-ai.ts:147-165`) still has `GENTLEMAN_PERSONA_PROMPT` and `NEUTRAL_PERSONA_PROMPT` as two fully independent template literals; the 4 bullets design calls out ("senior architect and teacher", "Treat AI as a tool...", "Push back...", "Correct errors...") remain literally duplicated across both constants — the exact intra-constant drift Decision 3 says the change exists to remove. `design.md`'s own Open Questions section (unchecked) flags this as unresolved scope ("Confirm `SHARED_PERSONA_BULLETS` refactor is in scope now vs a follow-up"), which is inconsistent with the File Changes table treating it as a settled action item. No spec requirement mandates this refactor (the spec only requires persona selection to keep working, which it does), so this is not spec-blocking — but `apply-progress.md`'s Deviations section should have recorded this skip explicitly, the way it recorded the other 4 deviations, instead of silently omitting a design-table action item.

## Issues

### CRITICAL
None.

### WARNING
1. **Untested spec scenario**: "Named/SDD subagent launch unaffected" (spec `Requirement: Named/SDD Subagent Branches Unaffected`) has no runtime-executed covering test. Compliance rests solely on a manual `git diff --stat` claim in `tasks.md` task 2.3, independently re-confirmed here via source diff (0 diff on the `isNamedAgent || isSddAgent` branch) — but per this project's own strict-verify bar, "a spec scenario is compliant only when a covering test passed at runtime," and none exists. Practical risk is low (branch is provably untouched), but the regression-safety net for this scenario is manual, not automated.
2. **Undocumented design-vs-apply gap**: `SHARED_PERSONA_BULLETS` factoring specified in `design.md`'s File Changes table (Decision 3) was not implemented and not recorded as a deviation in `apply-progress.md`. Not spec-blocking; recommend either implementing it or adding an explicit deferred-follow-up note to close the design/apply inconsistency and to close design.md's own unchecked Open Question.

### SUGGESTION
None beyond the above.

## Final Verdict

**PASS WITH WARNINGS** — 0 CRITICAL, 2 WARNING, 0 SUGGESTION. All 20/20 tasks and 6/6 acceptance criteria are genuinely complete and test-backed except for the one untested named/SDD-branch scenario (WARNING 1, low practical risk, independently source-verified). All byte-measurement and union-reconciliation claims were independently reproduced and matched exactly. Full `pnpm test` is green at 271/271. Recommend either (a) archiving with the two WARNINGs recorded as accepted/known, or (b) a short follow-up apply pass to add one runtime test for the named/SDD empty-injection branch and to resolve/document the `SHARED_PERSONA_BULLETS` gap — neither blocks archive on spec-compliance grounds.
