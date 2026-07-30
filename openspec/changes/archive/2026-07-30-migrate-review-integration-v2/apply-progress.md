# Apply Progress: migrate gentle-pi to `review-integration/v2`

**Cumulative state**: Phases 1–5 and 7–14 complete; Phase 6.1 remains historically partial as recorded in `tasks.md` because two mirrored skill assets were deliberately left to their upstream sync. This file merges the original Phase-1 OpenSpec report, cumulative Engram progress through Stage 2/Phase 13, and corrective attempt 11.

**Mode**: Strict TDD
**Delivery**: accepted `size:exception`
**Corrective objectives**: 4/4 complete

## Completed Work

- [x] Phase 1 — v2 exact-key decoder module and 23+ replacement tests.
- [x] Phase 2 — pure correction outcome resolver and distinct-evidence invariant.
- [x] Phase 3 — field-wise candidate manifest derivation/comparison and no-shell lens dispatch.
- [x] Phase 4 — loud native/dev-binary skip gates.
- [x] Phase 5 — bidirectional contract and generated-runtime package reconciliation.
- [~] Phase 6.1 — README/native architecture docs complete; mirrored skill assets intentionally deferred as documented in `tasks.md`.
- [x] Phase 7 — Stage-1 close-out.
- [x] Phases 8–12 — v2 switchover, v1 deletion, client call sites, capture-result/evidence surfaces, generated runtime, and Stage-2 verification.
- [x] Phase 13 — final v2.2.2 pin, terminology correction, and SDD readiness fix.
- [x] 14.1 — production reviewer projection now consumes v2 `next_transition.collect.inputs[]`; each capture-result input must bind canonical lineage/revision/target/lens/order/subject arguments to its `artifact_subject`, the projection trees, one identical manifest, and one identical provider manifest hash. Fresh-process reviewer FINALIZE requires this descriptor and runs field-wise Git validation.
- [x] 14.2 — correction FINALIZE now requires STATUS to offer exactly one `review.capture-evidence` input before validation; premature `external.run_targeted_validation` fails closed. After capture, STATUS is re-queried before any validator document can reach native FINALIZE.
- [x] 14.3 — the production decision point now calls `resolveCorrectionStep`: `passed` requires one provider-bound targeted-validation request, `verification_failed` returns an open zero-charge recapture step, and `procedural_tooling_failed` requires terminal escalated authority. Reused failed evidence identity is rejected through `assertDistinctCorrectionEvidence`.
- [x] 14.4 — direct `captureEvidence` test covers exact staged bytes, closed outcome argv, direct v2 record decoding, and pre-launch rejection. All delta-spec v2.2.1 references now name the actual v2.2.2 pin.
- [x] 14.5 — focused and full gates green.

## Corrective Files Changed

| File | Action | Correction |
|---|---|---|
| `extensions/gentle-ai.ts` | Modified | Provider manifest adapter, evidence-first orchestration, three production outcome branches, distinct-evidence state, fail-closed diagnostics, and closed wrapper outcome input. |
| `lib/review-candidate-view.ts` | Modified | Distinguish production provider-hash verification from local hand-built descriptor digest checks. |
| `lib/review-compact-contract.ts` | Modified | Add exact-key `final_verification_outcome` with the three-value closed domain while retaining the paired boolean compatibility input. |
| `tests/review-controller-native-routing.test.ts` | Modified | Production caller tests for manifest/hash enforcement, ordering, three branches, fail-closed premature validation, and evidence identity reuse. |
| `tests/review-controller-native-recovery.test.ts` | Modified | Direct `captureEvidence` boundary test. |
| `tests/review-compact-contract.test.ts` | Modified | Exact outcome parsing and invalid/ambiguous input tests. |
| `tests/runtime-harness.mjs` | Modified | Real extension/controller ordering scenario. |
| `openspec/changes/migrate-review-integration-v2/specs/review-transaction/spec.md` | Modified | Five v2.2.1 references corrected to v2.2.2. |
| `openspec/changes/migrate-review-integration-v2/tasks.md` | Modified | Added completed corrective Phase 14. |
| `openspec/changes/migrate-review-integration-v2/apply-progress.md` | Reconciled | Replaced stale Phase-1-only copy with this cumulative hybrid record. |

The historical failed `verify-report.md` remains untracked and byte-untouched.

## TDD Cycle Evidence

| Work | Test file / layer | Safety net | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|---|
| Prior Phases 1–13 | Decoder, candidate, lifecycle, CLI, and harness suites | Prior cumulative Engram report: 907/906/0/1 at Stage-2 close, later 911/910/0/1 after Phase 13 | Recorded per prior batches | Recorded green | Multiple exact-key and branch cases | Runtime regenerated where required |
| 14.1 manifest production binding | `tests/review-controller-native-routing.test.ts` / integration | 238/238 across routing, recovery, candidate, lifecycle baseline | Production accepted mode drift and hash divergence; focused RED contained both failures | Mode drift and inconsistent provider hashes block before FINALIZE | Matching provider manifest dispatch remains green | Provider canonical hash is cross-input bound instead of incorrectly re-derived |
| 14.2 evidence-first ordering | routing test + `tests/runtime-harness.mjs` / integration-runtime | Harness baseline exit 0 | Controller lacked the new outcome field/capture call; node RED and harness exit 1 | Exact trace `status → capture-evidence → status → finalize`; premature validation blocks | Passed and premature-targeted branches | Ordering helpers extracted from controller body |
| 14.3 three production branches | `tests/review-controller-native-routing.test.ts` / integration | Same 238/238 safety net | All three controller subtests failed before production wiring | Passed, verification-failed, tooling-failed, and reused-identity cases green | Three distinct outcomes plus reused identity | Pure resolver retained; controller performs only orchestration and binding checks |
| 14.4 capture boundary/outcome parser | recovery + compact-contract tests / unit | Existing capture-result/finalize tests green | Explicit outcome was rejected as an unknown exact key | Direct capture and all closed parser values green | Invalid outcome and dual boolean/outcome rejected | No runtime generator change required |

### RED Evidence

`node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller-native-recovery.test.ts tests/review-compact-contract.test.ts` → **exit 1**, 197 tests, 188 pass, **9 fail**. Failures were the new exact outcome parser, two production manifest tests, three outcome subtests, premature-validation ordering, reused evidence identity, and their parent aggregation.

`CI=1 pnpm run test:harness` → **exit 1** at the new correction scenario because production still required only `final_verification_passed` and never called `captureEvidence`.

### GREEN Evidence

`node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller-native-recovery.test.ts tests/review-compact-contract.test.ts tests/review-candidate-view.test.ts tests/review-correction-lifecycle.test.ts` → **exit 0**, 253 tests, 253 pass, 0 fail, 0 skip.

`CI=1 pnpm run test:harness` → **exit 0**, including the production ordering scenario.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | 253/253 pass after a confirmed 9-failure RED. |
| Runtime harness | Exit 0; real `createGentleAiExtension` controller trace proves capture precedes targeted validation. |
| Rollback boundary | Revert Phase-14 edits in `extensions/gentle-ai.ts`, `lib/review-candidate-view.ts`, `lib/review-compact-contract.ts`, their four test files, and the v2.2.2 spec correction. Earlier v2 migration work remains intact. |

## Final Gates

| Command | Exit | Result |
|---|---:|---|
| `node --experimental-strip-types --test tests/*.test.ts` | 0 | 920 tests; 919 pass, 0 fail, 1 Windows-only skip |
| `CI=1 pnpm run test:harness` | 0 | Runtime harness passed |
| `node scripts/verify-package-files.mjs` | 0 | 129 package files; 64 exact v2.2.2 contract artifacts |
| `node scripts/build-git-commit-transaction-runner.mjs --check` | 0 | TypeScript sources match all 4 generated runtime modules; no regeneration required |
| `pnpm test` | 0 | Same 920/919/0/1 unit result plus harness pass |

## Changed-Line Evidence

Correction diff excluding the preserved untracked historical verify report: 723 additions + 91 deletions = **814 changed lines**, under the accepted 1200-line size exception.

## Deviations and Risks

- No specification was weakened. The wrapper adds `final_verification_outcome` because the old boolean could not represent `procedural_tooling_failed`; legacy boolean callers still map `true → passed` and `false → verification_failed`.
- Provider manifest canonicalization remains provider-owned. Pi enforces the provider hash across all collect inputs/artifact subjects and verifies every manifest field against Git; it does not fabricate a second canonicalization algorithm.
- Distinct evidence identity is enforced for repeated captures within the active Pi controller. Provider-owned immutable storage remains the cross-process source of truth.
- No generated runtime source changed, so regeneration was unnecessary and the required `--check` gate passed.

## Status

All four corrective objectives are complete. The implementation is ready for a fresh `sdd-verify`; the existing failed `verify-report.md` remains historical evidence and was not rewritten.
