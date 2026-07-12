# Implementation Tasks: Native Review Authority Parity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR with reviewable work-unit commits |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

The single-PR size exception is accepted by delivery constraints. Work-unit commits remain independently reviewable; no artificial line cap or chained PR is introduced. Keep all current issue #118 changes intact and do not rewrite their authority or receipt artifacts.

## Implementation Work Units

### 1. Establish native CLI boundary and capability contract

- [x] **RED:** Add `tests/native-review-cli.test.ts` coverage for injected `ExecFileAdapter`, explicit `cwd`, argument-array invocation, `shell: false` production behavior, timeout/max-buffer handling, and no shell interpolation. <!-- sdd-owner: implementation -->
- [x] **RED:** Add version/capability tests for exact `gentle-ai 2.1.0\n`, rejected dev/older/newer/suffixed/stderr output, immutable capability caching, and disabled general status/inventory. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Create `lib/native-review-cli.ts` with const-derived operation/error types, flat executor interfaces, `createNodeExecFileAdapter`, `NATIVE_CLI_CONTRACTS`, `NativeReviewCliError`, and `createNativeReviewCli`. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement `NativeReviewCliV210` request types and exact argv builders for `review start`, `review finalize`, `review validate`, `review bind-sdd`, and exact bound `sdd-status`; preserve opaque native paths and identity fields. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify every adapter call uses one operation, explicit working directory, typed argv values, and no native authority-file read/write or status-via-mutation probe. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Keep external inputs `unknown`, use strict TypeScript types/const objects, and ensure no `any`, inline nested interfaces, semver-range inference, or duplicate process boundary. <!-- sdd-owner: implementation -->

### 2. Add strict v2.1.0 fixtures, decoders, process errors, and finalize staging

- [x] **RED:** Add checked-in success fixtures under `tests/fixtures/native-review-cli/v2.1.0/` for start, finalize, validate allow/deny, bind-SDD, and bound SDD status. <!-- sdd-owner: implementation -->
- [x] **RED:** Add one-field mutation tests for missing/extra keys, wrong types/enums, unsafe integers, trailing JSON, inconsistent allow/result, identity mismatch, incomplete gate context, and wrong schema/version. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement operation-specific recursive decoders in `lib/native-review-cli.ts`; reject malformed/incompatible success bodies before public mapping and require `allowed === (result === "allow")`. <!-- sdd-owner: implementation -->
- [x] **RED:** Add process-error coverage for unavailable/spawn failure, timeout, signal, non-zero, stderr-on-success, output overflow, empty output, malformed JSON, cancellation, and ambiguous mutating completion. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Map failures to typed `NativeReviewCliError` codes with launch certainty and `mutationOutcome`; require exact replay/recovery for ambiguous mutation and never report false `lineage_created: false`. <!-- sdd-owner: implementation -->
- [x] **RED:** Add finalize temporary-directory tests for mode 0700 directory, mode 0600 JSON files, native lens/result ordering, optional files, and cleanup on success, denial, timeout, cancellation, and decode failure. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement finalize staging/cleanup without shell utilities and without exposing or opening native receipt/binding paths. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Confirm all process, decode, and staging failures authorize nothing and create no local authority, binding, receipt, approval, or fallback mutation. <!-- sdd-owner: implementation -->

### 3. Route controller operations through native and preserve stable envelopes

- [x] **RED:** Extend `tests/review-controller.test.ts` and `tests/gentle-ai.test.ts` with injected native start/finalize/validate success, typed failure, ambiguous replay, stable envelope, and no-fallback cases. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Refactor `extensions/gentle-ai.ts` to add `GentleAiRuntimeDependencies`, `createGentleAiExtension`, asynchronous controller execution, route resolution, and native result/error mappers while preserving the default package wrapper. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Route new ordinary `START`/`FINALIZE`/`VALIDATE` to exactly one matching native operation; map only decoded fields into existing envelopes, retaining native ownership of canonicalization, transitions, revisions, receipts, and gates. <!-- sdd-owner: implementation -->
- [x] **RED:** Add tests proving native non-zero, malformed, unavailable, timeout, or ambiguous results never enter compact-v2/graph-v1 mutation or create a second lineage. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify operation names, blocked/action semantics, opaque receipt paths, risk/changed-line mappings, and cancellation behavior remain stable for existing callers. <!-- sdd-owner: implementation -->

### 4. Bind native SDD through CAS and exact bound status readiness

- [x] **RED:** Add bind tests for request-known canonical change/path, lineage, and expected-revision validation; explicit empty first revision; observed-revision replay; native-owned result evidence; and committed-or-ambiguous malformed or selected-identity output. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement native `bind-sdd` composition in `extensions/gentle-ai.ts`; send only change, lineage, and expected revision; validate native-owned returned selected identity and required binding evidence; return the observed binding revision; and never create a Pi binding mirror or guess a revision. <!-- sdd-owner: implementation -->
- [x] **RED:** Add `tests/sdd-status.test.ts` coverage for ready exact bound status, missing/stale/changed binding, authority change during reload, wrong change/path, non-allow gate, malformed status, and no duplicate lifecycle call. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Add `NativeReviewReadinessOverlay` and data-only merge to `lib/sdd-status.ts`; make exact `resolveControllerSddStatus` asynchronous and consume only decoded native bound readiness. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Ensure native readiness reloads authority and binding, confirms exact OpenSpec identity/path, revalidates live gate evidence, and adds `resolve-review` blocking without inferring from tasks, artifacts, actor output, Engram, or local discovery. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify SDD status never starts/finalizes a review, mutates authority, services general `STATUS`, or reports readiness after any revision/target race. <!-- sdd-owner: implementation -->

### 5. Implement typed unsupported status and mixed-inventory boundary

- [x] **RED:** Add controller tests for general ordinary `STATUS`, `INSPECT`/complete mixed claimant inventory, and native-absence decisions requiring native evidence; assert zero native adapter calls and zero local mutations. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Add stable `nativeStatusUnsupported` result in `extensions/gentle-ai.ts` with `inventory_complete: false`, follow-up-required action, native contract evidence, and unchanged public outer envelope. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Route unsupported status before version probing; prohibit native file parsing, mutating probes, claimant selection, legacy fallback, binding, approval, receipt creation, and lifecycle authorization. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify future status capability is not implied by 2.1.0 and any Pi-local diagnostics remain explicitly incomplete and cannot claim clean/absence/winner. <!-- sdd-owner: implementation -->

### 6. Preserve legacy compact/graph/Judgment Day compatibility without fallback mutation

- [x] **RED:** Extend existing compact/graph suites (`tests/review-compact-gate.test.ts`, `tests/review-transaction.test.ts`, and graph/receipt suites) with read/export/gate preservation and typed ordinary mutation rejection. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Update route precedence so explicit Judgment Day remains graph-v1, known Pi compact-v2/graph-v1 lineages use existing compatible readers/gates, and ordinary mutation returns `legacy-read-only` without native or Pi mutation. <!-- sdd-owner: implementation -->
- [x] **RED:** Add mixed-authority and cross-mode tests proving state, counters, receipts, and formats remain unchanged; native success/failure never mirrors or falls through to legacy stores. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Run compatibility fixtures against current issue #118 seams and verify no existing issue #118 behavior, files, receipts, or authority ownership is rewritten. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Keep legacy compatibility routing isolated from the single native adapter and preserve existing graph-v1 Judgment Day mutation rules. <!-- sdd-owner: implementation -->

### 7. Enforce native validation as exact one-shot authorization

- [x] **RED:** Add authorization regressions for native allow, deny/error/malformed/version mismatch, actor/process success without validation, duplicate registration, replay, consume-before-await, stale context, changed candidate/target, worktree mismatch, and dangerous-command precedence. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Extend `PendingReviewAuthorization`, `gateLifecycleCommand`, and `ReviewGateEvaluator` in `extensions/gentle-ai.ts` with native gate context, lineage/revision fingerprint, asynchronous bash-time revalidation, and one-shot consumption. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Register authorization only after exit-zero strict native allow for the exact typed target; reload and rederive cwd/target/receipt evidence before execution and fail closed on any mismatch without restoring consumed authorization. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Prove exactly one authorization is registered/executed, zero actors authorize lifecycle work, and native approval cannot override independent dangerous-command safety. <!-- sdd-owner: implementation -->

### 8. Package/runtime assets and full verification

- [x] **RED:** Add package/runtime tests covering inclusion of `lib/native-review-cli.ts`, fixtures, controller exports, injected dependencies, and production asset loading from the packaged runtime rather than source-only paths. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Update package/runtime manifests or asset-copy rules only where required so native adapter and fixture/test support are available in the supported runtime; do not alter unrelated issue #118 assets. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Run focused native, controller, SDD, compact/graph, receipt/gate, Judgment Day, dispatcher, release-fast-path, and issue #118 seam suites, then run `pnpm test` and type/package checks. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Remove only proven duplication after tests pass; retain strict decoders, typed errors, no-fallback guarantees, and the explicit upstream status/inventory follow-up. <!-- sdd-owner: implementation -->

## Parent-Owned Review and Delivery Gates

After implementation, the parent must perform the ordinary post-apply review/bind/gate workflow in prose. The parent must bind only the expanded candidate to a fresh native review after independent verification; the historical issue #118 Pi receipt remains read-only and is not imported or relabelled. The parent must validate the exact content-bound receipt at lifecycle gates, preserve the single-PR size exception, and record any scope-change or ambiguous native mutation as fail-closed evidence. No parent review, binding, authorization, or gate operation is represented as an implementation checkbox.

## Post-completion correction evidence: native START policy boundary

The original 42 implementation rows remain complete: the corrected native START contract is covered by the existing native CLI and controller-routing work units without adding a new implementation row. Native requests use only optional `policyPath`; omitted paths delegate to native default policy selection, while legacy `policyHash` remains compact-only. Controller policy validation rejects legacy hashes, outside, missing, and symlinked paths before any native call. The native result mapper does not synthesize policy evidence from request input.
