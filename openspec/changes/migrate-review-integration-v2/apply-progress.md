# Apply Progress: migrate gentle-pi to `review-integration/v2`

**Scope of this batch**: Stage 1, Phase 1 only (tasks 1.1–1.8). Stage 2 and Phases 2–7 are untouched.

**Mode**: Strict TDD

## Completed Tasks

- [x] 1.1 RED: `tests/review-integration-v2.test.ts` created, importing decoders from a not-yet-existing `lib/review-integration-v2.ts`. Confirmed failure by running `node --experimental-strip-types --test tests/review-integration-v2.test.ts` → `ERR_MODULE_NOT_FOUND`.
- [x] 1.2 GREEN: `lib/review-integration-v2.ts` created with primitives ported verbatim from `lib/review-integration-v1.ts` (`record`, `exactRecord`, `text`, `nonempty`, `boolean`, `integer`, `enumeration`, `canonicalJson`, `array`, `stringArray`, `enumArray`, `sha256`, `gitTree`, `lineage`, `safePath`, `assertExactSet`, `assertSupersetOf`), a v2-only `requireIdentity` (const-schema identity, no `requireVersionedIdentity` needed since v2 protocol minor is a fixed `const 0`), and `decodeReviewCapabilitiesV2` (22-schema superset check via `assertSupersetOf`, 10 exact mandatory features via `assertExactSet`, 17 optional features tolerated forward-compatibly).
- [x] 1.3 GREEN: implemented `decodeReviewStartV3`, `decodeReviewStatusV3`, `decodeReviewProjectionV1` (kept the v1 name — the v2 capabilities schema still advertises `gentle-ai.review-integration.projection/v1`), `decodeReviewFailureV2`, `decodeReviewOperationV2`. All 4 mirrored fixtures (`capabilities.fixture.json`, `start.fixture.json`, `status.fixture.json`, `consent.fixture.json`) round-trip.
- [x] 1.4 RED: added rejection tests for the net-new `decodeReviewConsentV2`, `decodeReviewNextTransitionV3`, `decodeReviewArtifactSubjectV2` (no provider fixture needed for next-transition/artifact-subject beyond what's embedded in the status/start fixtures; consent has its own fixture).
- [x] 1.5 GREEN: implemented `decodeReviewConsentV2`, `decodeReviewNextTransitionV3` (returns a typed value, unlike v1's void-returning `decodeNextTransition`), `decodeReviewArtifactSubjectV2`.
- [x] 1.6 RED: added hand-built repair payload tests — execute-mode-without-`execution` rejected; eligible-preflight with `required_inputs` out of order rejected. No provider fixture exists for `repair/v2` (confirmed: only 4 fixtures ship — capabilities, start, status, consent).
- [x] 1.7 GREEN: implemented `decodeReviewRepairV2` (both `allOf` invariants from v1 `repair.schema.json:53-157`: execute mode requires `execution`, forbids `provider_inputs`, requires empty `required_inputs`; eligible preflight requires `provider_inputs` and `required_inputs` exactly `[actor, reason, maintainer_authorization]` in order) and `decodeAuthorityRepairAssessmentV1` (consumed both by `status.repair`, which is now required, and by `repair.assessment`).
- [x] 1.8 Verify: `tests/review-integration-v2.test.ts` has **23 tests** (≥22 required). Confirmed `lib/review-integration-v2.ts` is not imported by `lib/native-review-cli.ts`, `extensions/gentle-ai.ts`, or `scripts/build-git-commit-transaction-runner.mjs` (`rg -n "review-integration-v2" lib/native-review-cli.ts extensions/gentle-ai.ts scripts/build-git-commit-transaction-runner.mjs` → no matches).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `tests/review-integration-v2.test.ts` | Unit | N/A (new file) | ✅ Written — module import fails (`ERR_MODULE_NOT_FOUND`) | N/A (RED-only step) | N/A | N/A |
| 1.2–1.3 | `tests/review-integration-v2.test.ts` | Unit | N/A (new file) | ✅ 13 tests written against capabilities/v2, start/v3, status/v3, projection/v1, failure/v2, operation/v2 before the implementing module existed | ✅ 13/13 passed after `lib/review-integration-v2.ts` implemented (one bug found and fixed mid-cycle: initial `target_mode`/`target_identity`/`base_tree`/`candidate_tree` all-or-nothing bundling was wrong — the mirrored schema's `dependentRequired` binds `base_tree<->candidate_tree` and `target_mode<->target_identity` as two independent pairs, not one 4-field bundle; fixed and re-ran to green) | ✅ 10 additional tests added for exact-set/superset boundaries, independent overlay-pair binding, status authority/frozen/receipt conditionals, validation_request/retry_final_verification preconditions, operation validate/bind_sdd/retry_final_verification variants, failure context oneOf(scope_change, binding_revision) | ✅ No structural changes needed after the overlay-pair fix; primitives kept identical to v1's proven shape |
| 1.4–1.5 | `tests/review-integration-v2.test.ts` | Unit | N/A (new decoders) | ✅ Written — consent/next-transition/artifact-subject rejection tests | ✅ Passed on first implementation | ✅ Additional tests for consent choice-order/invocation-pattern rejection, next-transition execute-variant decode + stop-cannot-carry-transition rejection, artifact-subject optional `correction_target_identity` | ➖ None needed |
| 1.6–1.7 | `tests/review-integration-v2.test.ts` | Unit | N/A (new decoder) | ✅ Written — execute-without-execution and eligible-preflight-wrong-order hand-built payloads | ✅ Passed on first implementation | ✅ Additional test for committed execute-result decode and non-eligible-preflight-with-provider_inputs rejection | ➖ None needed |
| 1.8 | `tests/review-integration-v2.test.ts` | Unit | N/A | N/A (verification step) | ✅ 23/23 tests pass | N/A | N/A |

### Test Summary

- **Total tests written**: 23
- **Total tests passing**: 23
- **Layers used**: Unit (23), Integration (0 — Phase 1 has no integration/harness task), E2E (0)
- **Approval tests** (refactoring): None — no refactoring tasks in this batch (new module, no existing behavior to preserve)
- **Pure functions created**: all decoders in `lib/review-integration-v2.ts` are pure (no I/O, no subprocess); primitives (`text`, `enumeration`, `array`, etc.) are pure

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/review-integration-v2.test.ts` → `tests 23, pass 23, fail 0` |
| Runtime harness command/scenario and exact result | N/A — Phase 1 tasks 1.1–1.8 are pure decoder unit tests only; no runtime/harness boundary is exercised until Phase 3 (candidate-view manifest binding, out of scope this batch) |
| Rollback boundary | Revert `lib/review-integration-v2.ts` and `tests/review-integration-v2.test.ts` alone. Both are net-new, unimported files — no other file was touched, so rollback removes zero unrelated work. |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `lib/review-integration-v2.ts` | Created | v2 decoder module: primitives ported verbatim, `decodeReviewCapabilitiesV2`, `decodeReviewStartV3`, `decodeReviewStatusV3`, `decodeReviewProjectionV1`, `decodeReviewFailureV2`, `decodeReviewOperationV2`, `decodeReviewConsentV2`, `decodeReviewNextTransitionV3`, `decodeReviewArtifactSubjectV2`, `decodeReviewRepairV2`, `decodeAuthorityRepairAssessmentV1`. Unimported by any other module. |
| `tests/review-integration-v2.test.ts` | Created | 23 unit tests: rejection tests per decoder, 4-fixture round-trips, and triangulation coverage for conditional branches (authority/frozen/receipt, validation_request, retry_final_verification, repair invariants, consent, next-transition). |
| `openspec/changes/migrate-review-integration-v2/tasks.md` | Modified | Marked tasks 1.1–1.8 `[x]`. |

## Deviations from Design

1. **Overlay field grouping** (bug found and fixed during GREEN, not a design deviation but worth recording): the mirrored `start.schema.json`'s `dependentRequired` binds `base_tree<->candidate_tree` and `target_mode<->target_identity` as two **independent** pairs (target_mode/target_identity additionally require base_tree+candidate_tree present, but base_tree/candidate_tree can appear alone — e.g. when `selected_lenses` is non-empty). My first implementation incorrectly bundled all four fields as one all-or-nothing group (copying v1's simpler pattern, where only the workspace-overlay 4-field bundle exists). Fixed before considering GREEN complete; the real fixture (`start.fixture.json`, which has `base_tree`/`candidate_tree` but no `target_mode`/`target_identity`) exposed this immediately.
2. **`decodeEligibility` correction beyond v1**: v1's `decodeEligibility` only accepted `disposition`/`binding` for `review.recover`, but the mirrored `status-v2.schema.json`'s `action_eligibility` definition (which v2's `status.schema.json` also `$ref`s) requires `disposition`+`binding` for **both** `review.recover` and `review.retry_final_verification`. This looks like a latent gap in the ported v1 decoder. Fixed in v2 to match the mirrored schema faithfully, since v2 has a first-class `retry_final_verification` status action.
3. **`decodeFailureContext` extended beyond v1**: v1's `decodeFailureContext` only ever implemented the `scope_change` branch, even though the mirrored `gate_context` `$defs` is `oneOf [scope_change, binding_revision]`. v2's decoder implements both branches so a legitimate `binding_revision` failure payload (used by bind-sdd replay flows) is not silently rejected.
4. **`FAILURE_NEXT_ACTIONS` includes `review.repair`**: v1's lib-level constant was missing `review.repair` even though the mirrored v1 schema's `next_action` enum includes it. v2's `FAILURE_NEXT_ACTIONS` includes it, matching the schema v2 `$ref`s directly.
5. **No decoder for `admitted-result/v2`**: per design, this schema gets a `REQUIRED_SCHEMAS` entry (string literal, free) but no decoder — Pi has no call site consuming a provider-admitted reviewer result in this stage. Matches design exactly.

None of these deviate from `design.md`'s intent; items 2–4 are corrections of latent v1 gaps discovered while porting against the mirrored schemas, made because a v2 decoder that silently drops a legitimate provider payload is exactly the failure mode `design.md` calls out as highest-risk.

## Issues Found

None blocking. See Deviations above for the one implementation bug (found and fixed within this batch, before GREEN was called done).

## Remaining Tasks

- [ ] Phase 2 (2.1–2.2): correction lifecycle (pure) — `lib/review-correction-lifecycle.ts`
- [ ] Phase 3 (3.1–3.7): candidate-view manifest binding — `lib/review-candidate-view.ts`
- [ ] Phase 4 (4.1–4.7): loud-skip gate — `tests/support/native-binary-gate.ts`
- [ ] Phase 5 (5.1–5.2): package-files reconciliation — `scripts/verify-package-files.mjs`
- [ ] Phase 6 (6.1): docs
- [ ] Phase 7 (7.1): Stage 1 close-out verification
- [ ] Stage 2 (Phases 8–12): RELEASE-GATED, blocked on gentle-ai v2.2.1 publish + pin

## Workload / PR Boundary

- Mode: `size:exception` (accepted per tasks.md forecast, 1200-line review budget)
- Current work unit: Unit 1 — Stage 1 (this batch covers only its Phase 1 slice)
- Boundary: This batch starts from a clean Stage-1-untouched tree and ends with `lib/review-integration-v2.ts` + `tests/review-integration-v2.test.ts` created, additive-only, `pnpm test` green, `pnpm run check:transaction-runner` untouched-green.
- Estimated review budget impact: ~1,050 changed lines added this batch (test file ~360 lines, lib file ~690 lines) — within the accepted 1200-line `size:exception` budget for the full Stage 1 + Stage 2 PR; more Stage 1 phases remain to be added before Stage 2.

## Status

8/8 Phase 1 tasks complete (1.1–1.8). 0/34 remaining Stage 1 + Stage 2 tasks (Phases 2–12) started. Ready for next batch (Phase 2: correction lifecycle) or `sdd-verify` if the orchestrator wants to checkpoint Phase 1 alone first.
