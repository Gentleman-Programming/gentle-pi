# Tasks: Persona Single Channel

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300-400 (new test file ~180-220, gentle-ai.ts ~20, orchestrator.md ~25, 2 new artifact docs ~80) |
| 400-line budget risk | Medium (borderline; fixture-heavy test file dominates) |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full dedup (RED tests -> gentle-ai.ts -> orchestrator.md -> byte doc -> contract doc -> green) | PR 1 (single, size-exception) | Base: next branch after #2 (feat/port-review-ledger-contract) commits. |

## Branch/Sequencing Note

Apply runs on the **next branch**, cut only after change #2's apply on `feat/port-review-ledger-contract` is committed. Do not start Phase 1 on an uncommitted #2 tree.

## Phase 0: Prerequisite

- [x] 0.1 Confirm #2's apply on `feat/port-review-ledger-contract` is committed; create/switch to the next branch for this change. — Satisfied at apply start: on `feat/persona-single-channel`, cut from `main` after #72 (the review-ledger port) merged.

## Phase 1: RED — Frozen Fixtures & Guards (must fail first)

- [x] 1.1 Create `tests/persona-single-channel.test.ts`; freeze `PRE_WRAPPER_GENTLEMAN`, `PRE_WRAPPER_NEUTRAL` (`gentle-ai.ts:179-184`), `PRE_ORCH_IDENTITY` (`orchestrator.md:5-21`), `PRE_ORCH_LANGBOUNDARY` (`orchestrator.md:28-42`) as verbatim string-literal fixtures.
- [x] 1.2 Add line-level union sweep: one named assertion per Table A/B rule verifying survival (verbatim/MERGED/POINTER) in `buildGentlePrompt(persona)` + `getOrchestratorPrompt()` output; each message names rule + source line. Include named asserts for wrapper `:180`/`:181` merges.
- [x] 1.3 Add exact-string duplication guard: identity self-description sentence, "Do not claim portability…", and LB2-LB5 each occur exactly once in the combined injection.
- [x] 1.4 Add concept-level duplication guard: language-match regex matches exactly once per rendered mode (gentleman, neutral); exclude the scoped Identity-contract "translated into the user's language" self-description clause from the count (documented exception).
- [x] 1.5 Add added-rule assertion: gentleman output contains the new `GENTLEMAN_PERSONA_PROMPT` clause "Always respond in the same language the user writes in."
- [x] 1.6 Add byte-delta assertion (placeholder values). Run `pnpm test` — confirm all new assertions FAIL against current source. — RED confirmed: 19 pass / 7 fail on first run (one additional false-fail from a 1B fixture-transcription bug, fixed before recording RED — see apply-progress.md). Direction: FAILURES = pre-change duplication/missing-rule state (2x/3x language-match duplication, missing added rule, missing pointers) — exactly the state the migration fixes.

## Phase 2: GREEN — extensions/gentle-ai.ts

- [x] 2.1 Replace wrapper Identity contract block (`:179-184`) with design.md's exact post-change text.
- [x] 2.2 Add `- Always respond in the same language the user writes in.` to `GENTLEMAN_PERSONA_PROMPT`; leave `NEUTRAL_PERSONA_PROMPT` unchanged.
- [x] 2.3 Verify the SDD/named-subagent (empty-injection) branch is untouched. — Verified via `git diff --stat`: only 2 hunks touched (`:147-148` new-clause insertion, `:177-184` Identity block replacement); the `isNamedAgent || isSddAgent ? "" : ...` branch at `:2204-2206` has zero diff.

## Phase 3: GREEN — assets/orchestrator.md

- [x] 3.1 Replace `## Identity Contract` (`:5-21`) with the one-line pointer text.
- [x] 3.2 Replace Language Boundary line `:30` (LB1) with the one-line pointer; keep LB2 (`:32`), LB3 (`:34`), LB4 (`:36`), LB5 (`:38-42`) verbatim.
- [x] 3.3 Run `pnpm test`; if mutating the file mid-process, reset `orchestratorPromptCache` (first-read-wins per process — design.md Testing Strategy). — No mid-process mutation performed (edit-then-fresh-process pattern used); cache reset not needed. Migration test: 28/28 GREEN.

## Phase 4: Byte Measurement

- [x] 4.1 Run `wc -c` before/after on the wrapper Identity block and orchestrator.md Identity Contract + Language Boundary regions.
- [x] 4.2 Record sizes, delta, and method in `openspec/changes/persona-single-channel/byte-measurements.md`; compare against design's converged 817B post / +379B delta / ≈-0.3KB net; flag deviations. — Wrapper block: exact match (817B/+379B). Orchestrator Identity pointer: 149B measured vs 148B design estimate (+1B, flagged, non-blocking, same wording). Net per-session: gentleman -283B, neutral -341B (section-sum method) — within design's converged ≈-0.3KB range.
- [x] 4.3 Update Phase 1.6's byte-delta assertion with actual measured values (±1B). — Test now asserts exact measured deltas (379, -682, -38, 58, -283/-341) instead of placeholders.

## Phase 5: Cross-Tool Ownership Contract

- [x] 5.1 Create `openspec/changes/persona-single-channel/cross-tool-persona-ownership-contract.md` per design.md's outline (title/intent, Guarantees 1-3, drift control, cross-reference).

## Phase 6: Verification

- [x] 6.1 Run `tests/persona-neutral-voseo.test.ts` — confirm still green. — 8/8 pass.
- [x] 6.2 Run full `pnpm test` (includes `test:harness`) — all GREEN. — 271/271 pass (243 baseline + 28 new); `test:harness` completed with exit 0. One pre-existing collateral test (`tests/artifact-language.test.ts`) updated to match the new LB1 pointer wording (was asserting the old LB1 sentence verbatim) — see apply-progress.md Deviations.
- [x] 6.3 Check off spec.md Acceptance Criteria once verified. — All 6 bullets verified true and ticked `[x]` in `specs/session-persona/spec.md`.
