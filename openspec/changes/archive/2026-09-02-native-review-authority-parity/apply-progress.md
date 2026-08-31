# Apply Progress: Native Review Authority Parity

## Status

Partial — implementation batch 5 completed work unit 3. No review, receipt, gate, bind, commit, push, or PR action was performed.

## Cumulative completed tasks

- Work units 1 and 2 are complete (14 persisted `[x]` implementation tasks): native CLI boundary, strict 2.1.0 fixtures/decoders/process errors, and finalize staging/cleanup.
- Work unit 3 is complete (5 persisted `[x]` tasks): injected controller routing, native start/finalize/validate envelope mapping, failure/replay behavior, and compatibility triangulation.

## Batch 5 implementation

- Added `NativeReviewCli` as the injected, flat controller dependency contract.
- Added `GentleAiRuntimeDependencies` and `createGentleAiExtension(dependencies)` while retaining the default package export as the production wrapper using `createNativeReviewCli()`.
- Made controller execution asynchronous and routed new ordinary `START`, native-lineage `FINALIZE`, and unknown-lineage `VALIDATE` through exactly one native client method.
- Added stable native public mappings: native `risk_level` maps to `risk_tier`; `changed_lines` maps to `original_changed_lines`; receipt paths remain opaque.
- Native errors return a typed blocked envelope and never fall through to compact-v2 or graph-v1 mutation. Ambiguous mutating outcomes require target-scoped `review.status`; Pi follows only the provider-declared action.
- Preserved explicit Judgment Day and legacy test routes. Existing known compact-v2/graph-v1 lineages return `legacy-read-only` for ordinary mutation under native routing.
- Kept lineage-free general `STATUS` and mixed-inventory `INSPECT` on the typed `native-status-unsupported` boundary before any native invocation.
- Added fake-client controller tests for success, stable mapping, no-fallback ambiguity, and zero-call unsupported status.

## Files changed in batch 5

- `extensions/gentle-ai.ts`
- `lib/native-review-cli.ts`
- `tests/review-controller.test.ts`
- `tests/review-controller-native-routing.test.ts`
- `openspec/changes/native-review-authority-parity/tasks.md`
- `openspec/changes/native-review-authority-parity/apply-progress.md`

## TDD Cycle Evidence

| Cycle | RED evidence | GREEN evidence | Triangulate / refactor evidence |
| --- | --- | --- | --- |
| Injected native controller route | `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts` failed because `createGentleAiExtension` was not exported. | The same focused test passed after dependency injection, async execution, and native envelope mappers were added. | Controller plus native-route focused tests passed (40 tests); legacy controller suite uses an explicit null native dependency to exercise unchanged compatibility behavior. |
| Native failure without fallback | The new controller test initially could not construct the dependency seam and therefore demonstrated the absent route. | A thrown ambiguous native operation now returns `native-operation-failed` with exact replay guidance and no compact fallback. | `pnpm test` passed (574 unit tests plus runtime harness). |

## Verification

- `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller.test.ts` — PASS (40 tests)
- `git diff --check` — PASS
- `pnpm test` — PASS (574 unit tests plus runtime harness)

## Deviations

- No design deviation. The controller's test-only legacy compatibility setup injects `nativeReviewCli: null`; the default package wrapper remains production-native.
- Work units 4–8 were not started. This batch intentionally completed work unit 3 rather than beginning another foundation slice.
- Engram was unavailable at `http://127.0.0.1:7437`; OpenSpec is authoritative and this progress artifact was persisted directly.

## Remaining tasks (verbatim persisted unchecked lines)

- [ ] **RED:** Add bind tests for canonical repository/change/path validation, approved lineage/receipt identity, explicit empty first revision, observed-revision retry, stale/conflicting revision, cross-repository/worktree/path mismatch, and ambiguous committed output. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement native `bind-sdd` composition in `extensions/gentle-ai.ts`; verify every echoed identity, return the observed native binding revision, and never create a Pi binding mirror or guess a revision. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add `tests/sdd-status.test.ts` coverage for ready exact bound status, missing/stale/changed binding, authority change during reload, wrong change/path, non-allow gate, malformed status, and no duplicate lifecycle call. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add `NativeReviewReadinessOverlay` and data-only merge to `lib/sdd-status.ts`; make exact `resolveControllerSddStatus` asynchronous and consume only decoded native bound readiness. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Ensure native readiness reloads authority and binding, confirms exact OpenSpec identity/path, revalidates live gate evidence, and adds `resolve-review` blocking without inferring from tasks, artifacts, actor output, Engram, or local discovery. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Verify SDD status never starts/finalizes a review, mutates authority, services general `STATUS`, or reports readiness after any revision/target race. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add controller tests for general ordinary `STATUS`, `INSPECT`/complete mixed claimant inventory, and native-absence decisions requiring native evidence; assert zero native adapter calls and zero local mutations. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add stable `nativeStatusUnsupported` result in `extensions/gentle-ai.ts` with `inventory_complete: false`, follow-up-required action, native contract evidence, and unchanged public outer envelope. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Route unsupported status before version probing; prohibit native file parsing, mutating probes, claimant selection, legacy fallback, binding, approval, receipt creation, and lifecycle authorization. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Verify future status capability is not implied by 2.1.0 and any Pi-local diagnostics remain explicitly incomplete and cannot claim clean/absence/winner. <!-- sdd-owner: implementation -->

## Workload / PR boundary

Delivery remains the accepted single-PR size exception. Batch 5 is work unit 3 only; no commit or lifecycle/delivery action was taken.

## Structured status consumed

- Authoritative OpenSpec status: `native-review-authority-parity`; apply state `ready`; `nextRecommended: apply`.
- Action context: `repo-local`, workspace and only allowed edit root `/home/gentleman/work/gentle-pi-issue112`.
- Strict TDD active; configured full test command `pnpm test`.
- Action-context warning: sibling changes and parent-owned lifecycle prose were preserved.

## Batch 6 — delivery-authority retirement (partial work unit 7)

- Removed the pending native delivery-authorization path and its gate evidence, bash-time revalidation, target derivation, and one-shot consumption.
- Review receipts, lineages, and candidate identity remain review-only evidence; they do not authorize, deny, wrap, or block delivery.
- Ordinary commit, push, PR, and release always follow repository policy, while dangerous-command handling remains outside Pi review authority.
- No real bind, review, delivery, commit, push, or PR operation was performed.

### Persisted task checkbox updates

None in this batch. The delivery-authority retirement advances work unit 7, but its persisted RED/GREEN/TRIANGULATE tasks remain unchecked because the complete matrix is not yet complete. Work unit 4 bind-SDD was not started.

### TDD Cycle Evidence

| Cycle | Safety net | RED evidence | GREEN evidence | Triangulate / refactor evidence |
| --- | --- | --- | --- | --- |
| Delivery authority retirement | `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller.test.ts` — 40 passing | Added a regression for review evidence affecting delivery. | Removed the delivery-authorization path; focused suite passed (42 tests). | Confirmed receipts and review state have no delivery effect. |

### Verification

- `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller.test.ts` — PASS (42 tests)
- `pnpm test` — PASS (576 unit tests plus runtime harness)
- `git diff --check` — PASS

### Batch 6 files changed

- `extensions/gentle-ai.ts`
- `tests/review-controller-native-routing.test.ts`
- `openspec/changes/native-review-authority-parity/apply-progress.md`

### Remaining persisted unchecked tasks

All work-unit 4–8 task lines remain unchecked in `tasks.md`; this batch intentionally does not claim checkbox completion. In particular, the next required task is:

- [ ] **RED:** Add bind tests for canonical repository/change/path validation, approved lineage/receipt identity, explicit empty first revision, observed-revision retry, stale/conflicting revision, cross-repository/worktree/path mismatch, and ambiguous committed output. <!-- sdd-owner: implementation -->

### Workload / PR boundary

The accepted single-PR size exception remains in force. Batch 6 is a partial delivery-authority retirement slice only; no delivery action was taken.

### Structured status consumed

- Authoritative OpenSpec status: `native-review-authority-parity`; apply state `ready`; `nextRecommended: apply`.
- Action context: `repo-local`, workspace and only allowed edit root `/home/gentleman/work/gentle-pi-issue112`.
- Strict TDD active; configured test command `pnpm test`.
- Action-context warning: preserved all sibling work and performed no real bind/review/gate/delivery action.

#### Complete unchecked task inventory at batch end (verbatim)

- [ ] **RED:** Add bind tests for canonical repository/change/path validation, approved lineage/receipt identity, explicit empty first revision, observed-revision retry, stale/conflicting revision, cross-repository/worktree/path mismatch, and ambiguous committed output. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement native `bind-sdd` composition in `extensions/gentle-ai.ts`; verify every echoed identity, return the observed native binding revision, and never create a Pi binding mirror or guess a revision. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add `tests/sdd-status.test.ts` coverage for ready exact bound status, missing/stale/changed binding, authority change during reload, wrong change/path, non-allow gate, malformed status, and no duplicate lifecycle call. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add `NativeReviewReadinessOverlay` and data-only merge to `lib/sdd-status.ts`; make exact `resolveControllerSddStatus` asynchronous and consume only decoded native bound readiness. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Ensure native readiness reloads authority and binding, confirms exact OpenSpec identity/path, revalidates live gate evidence, and adds `resolve-review` blocking without inferring from tasks, artifacts, actor output, Engram, or local discovery. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Verify SDD status never starts/finalizes a review, mutates authority, services general `STATUS`, or reports readiness after any revision/target race. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add controller tests for general ordinary `STATUS`, `INSPECT`/complete mixed claimant inventory, and native-absence decisions requiring native evidence; assert zero native adapter calls and zero local mutations. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add stable `nativeStatusUnsupported` result in `extensions/gentle-ai.ts` with `inventory_complete: false`, follow-up-required action, native contract evidence, and unchanged public outer envelope. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Route unsupported status before version probing; prohibit native file parsing, mutating probes, claimant selection, legacy fallback, binding, approval, receipt creation, and lifecycle authorization. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Verify future status capability is not implied by 2.1.0 and any Pi-local diagnostics remain explicitly incomplete and cannot claim clean/absence/winner. <!-- sdd-owner: implementation -->
- [ ] **RED:** Extend existing compact/graph suites (`tests/review-compact-gate.test.ts`, `tests/review-transaction.test.ts`, and graph/receipt suites) with review read/export preservation and typed ordinary mutation rejection. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update route precedence so explicit Judgment Day remains graph-v1, known Pi compact-v2/graph-v1 lineages use existing compatible readers, and ordinary mutation returns `legacy-read-only` without native or Pi mutation. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add mixed-authority and cross-mode tests proving state, counters, receipts, and formats remain unchanged; native success/failure never mirrors or falls through to legacy stores. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Run compatibility fixtures against current issue #118 seams and verify no existing issue #118 behavior, files, receipts, or authority ownership is rewritten. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep legacy compatibility routing isolated from the single native adapter and preserve existing graph-v1 Judgment Day mutation rules. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add regressions proving review and Judgment Day evidence cannot authorize, deny, wrap, or otherwise control commit, push, PR, or release delivery. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Remove `PendingReviewAuthorization`, `gateLifecycleCommand`, `ReviewGateEvaluator`, and all bash-time native delivery revalidation from `extensions/gentle-ai.ts`. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Keep review receipts, lineages, and candidate evidence review-only; ordinary commit, push, PR, and release always follow repository policy. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Prove no Pi review output mints delivery authority and dangerous-command handling remains outside review authority. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add package/runtime tests covering inclusion of `lib/native-review-cli.ts`, fixtures, controller exports, injected dependencies, and production asset loading from the packaged runtime rather than source-only paths. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update package/runtime manifests or asset-copy rules only where required so native adapter and fixture/test support are available in the supported runtime; do not alter unrelated issue #118 assets. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Run focused native, controller, SDD, compact/graph, receipt, Judgment Day, dispatcher, release-fast-path, and issue #118 seam suites, then run `pnpm test` and type/package checks. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove only proven duplication after tests pass; retain strict decoders, typed errors, no-fallback guarantees, and the explicit upstream status/inventory follow-up. <!-- sdd-owner: implementation -->

## Batch 7 — review-only evidence and bound SDD composition

- Confirmed the delivery-authorization matrix is retired: no native allow, receipt, lineage, candidate, or review result registers or revalidates Pi delivery authority.
- Added the controller `bind-sdd` operation. It accepts only a canonical existing OpenSpec change path and exact approved repository/lineage/revision/receipt identities, passes the explicit expected binding revision to native, maps only echoed matching identities, returns the observed binding revision, and stores no Pi mirror.
- Made controller bound-change SDD resolution asynchronous. It calls only the injected/native exact `sdd-status` operation for an authoritative selected OpenSpec change, maps its decoded data-only readiness overlay through `resolveSddStatus`, and adds `resolve-review` on missing, malformed, or non-ready native evidence. It never starts/finalizes a review or serves general review status.
- Updated runtime-harness expectation for the new fail-closed behavior: an unbound selected SDD change resolves to `resolve-review`, rather than inferring apply readiness.
- No real native authority, review, binding, receipt, lifecycle command, delivery action, commit, push, or PR operation was performed.

### Persisted task checkbox updates

- Marked work unit 4 RED/GREEN/TRIANGULATE tasks `[x]`.
- Marked work unit 7 RED/GREEN/TRIANGULATE tasks `[x]`.

### TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 bind-SDD CAS composition | `tests/review-controller-native-routing.test.ts` | Unit, fake native adapter | Focused native/controller suite: 65 passing | Controller rejected unsupported `bind-sdd` operation | Added canonical bind route and exact echoed identity mapping | Tested explicit empty revision, observed revision mapping, identity rejection, and no mirror | No further refactor needed |
| 4 exact bound SDD status | `tests/review-controller-native-routing.test.ts`, `tests/sdd-status.test.ts` | Unit, fake native adapter | Focused native/controller/SDD suite passing | Readiness had no controller-native path | Added async exact native status overlay | Missing/non-ready evidence becomes `resolve-review`; generic runtime status stays fail-closed | Kept overlay data-only |
| 7 delivery-authority retirement | `tests/review-controller-native-routing.test.ts`, `tests/native-review-cli.test.ts` | Unit, fake native adapter | Focused native/controller suite passing | Prior delivery test demonstrated review output could affect delivery | Removed delivery authority from Pi | Commit, push, PR, and release remain repository-policy operations | No review-derived delivery state retained |

### Verification

- `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/sdd-status.test.ts tests/native-review-cli.test.ts` — PASS (68 tests)
- `git diff --check` — PASS
- `pnpm test` — PASS (579 unit tests plus runtime harness)

### Files changed in batch 7

- `extensions/gentle-ai.ts`
- `lib/native-review-cli.ts`
- `lib/sdd-status.ts`
- `tests/review-controller-native-routing.test.ts`
- `tests/review-controller.test.ts`
- `tests/sdd-status.test.ts`
- `tests/runtime-harness.mjs`
- `openspec/changes/native-review-authority-parity/tasks.md`
- `openspec/changes/native-review-authority-parity/apply-progress.md`

### Deviations

- No design deviation. The exact native status path remains bound-change-only and uses fake adapters in tests.

### Remaining tasks

Work units 5, 6, and 8 remain unchecked in `tasks.md`; no task outside the assigned bind/SDD and delivery-authority retirement slices was marked complete.

### Workload / PR boundary

Accepted single-PR size exception remains in force. Batch 7 is a reviewable bind/status plus delivery-authority retirement work unit; no commit or delivery action was taken.

### Structured status consumed

- Authoritative OpenSpec status: `native-review-authority-parity`; `applyState: ready`; `nextRecommended: apply`.
- Action context: `repo-local`; only allowed edit root `/home/gentleman/work/gentle-pi-issue112`.
- Strict TDD active; configured test command `pnpm test`.
- Action-context warning: pre-existing sibling changes were preserved; no native authority mutation was executed.

## Batch 8 — compatibility, packaging, and final implementation verification

### Status

Complete — all 42/42 implementation task checkboxes are persisted as `[x]`. No real native review, binding, lifecycle gate, delivery action, commit, push, or PR action was performed.

### Completed work units and persisted checkbox reconciliation

- Work unit 5: completed all four typed unsupported-status/inventory rows. The controller returns the stable `native-status-unsupported` envelope for general `STATUS` and `INSPECT` before any fake/native adapter operation; the result remains explicitly incomplete and fail-closed.
- Work unit 6: completed all five legacy compatibility rows. Native-routed `FINALIZE` now recognizes known compact-v2 and graph-v1 lineages and returns typed `legacy-read-only` without invoking the native client or changing legacy authority. Existing compact/graph review read, receipt, mixed-authority, and explicit Judgment Day suites remain green.
- Work unit 8: completed all four package/runtime rows. Package verification now names `lib/native-review-cli.ts` and the pinned start fixture; manifest/package dry-run confirms both are shipped. No unrelated issue #118 asset was changed.
- Tasks artifact was updated immediately after the final green verification: work units 5, 6, and 8 now visibly use `[x]`; task progress is 42/42 with no unchecked implementation rows.

### Files changed in batch 8

- `extensions/gentle-ai.ts`
- `scripts/verify-package-files.mjs`
- `tests/review-controller-native-routing.test.ts`
- `tests/package-manifest.test.ts`
- `openspec/changes/native-review-authority-parity/tasks.md`
- `openspec/changes/native-review-authority-parity/apply-progress.md`

### TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 typed unsupported status/inventory | `tests/review-controller-native-routing.test.ts` | Unit, fake native client | Focused controller suite passed before the new regression | Added general `STATUS` plus `INSPECT` zero-call envelope assertions; pre-existing implementation already satisfied the contract | Focused suite passed with all adapter methods guarded against invocation | Verifies both unsupported operations and all five fake client entry points | Kept the stable helper/envelope; no duplication added |
| 6 legacy compact/graph native isolation | `tests/review-controller-native-routing.test.ts` | Unit, fake native client plus temporary Git authority | Focused compact/graph/controller suites passed | Compact legacy `FINALIZE` test failed: fake native `finalize` was called and produced an approval envelope | Added known-legacy routing guard; compact test passed | Graph-v1 legacy finalize test proves the same zero-call, unchanged-revision outcome; existing Judgment Day and receipt suites passed | Extracted `isKnownPiLegacyLineage` to keep native routing isolated and preserve non-repository fake-client tests |
| 8 packaged native runtime contract | `tests/package-manifest.test.ts` | Unit/package contract | Package-manifest suite passed before the new assertion | Package verifier test failed because it did not name the native module or pinned fixture | Added explicit required package paths; focused package test and verifier passed | `pnpm pack --dry-run` listed the module and all native fixtures; full package/runtime suite passed | Retained existing manifest directory inclusion; only explicit verifier coverage was added |

### Verification

- `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller.test.ts tests/review-compact-gate.test.ts tests/review-transaction.test.ts tests/review-facade.test.ts tests/native-review-cli.test.ts tests/sdd-status.test.ts tests/package-manifest.test.ts` — PASS (172 tests)
- `pnpm run test:harness` — PASS
- `node scripts/verify-package-files.mjs` — PASS (51 required resources)
- `pnpm test` — PASS (582 unit tests plus runtime harness)
- `pnpm pack --dry-run` — PASS; package includes `lib/native-review-cli.ts` and `tests/fixtures/native-review-cli/v2.1.0/*`
- `git diff --check` — PASS

### Deviations

- No design deviation. The final legacy route guard applies only when a native client is active, preserving issue #118's existing explicit `nativeReviewCli: null` compatibility route and authority bytes.
- CodeGraph MCP was unavailable in this executor session despite an existing repository index; targeted filesystem reads were used after that failed availability check.
- Engram persistence endpoint was unavailable in prior batches; OpenSpec remains authoritative and this artifact was persisted directly.

### Remaining tasks

None. Persisted task artifact has 42/42 implementation rows checked `[x]`.

### Workload / PR boundary

The accepted single-PR size exception remains in force. This batch completed the final implementation slice only; no commit or parent-owned review/bind/delivery action was taken.

### Structured status consumed

- Authoritative OpenSpec status: `native-review-authority-parity`; `applyState: ready`; `nextRecommended: apply` at batch start.
- Action context: `repo-local`; workspace and only allowed edit root `/home/gentleman/work/gentle-pi-issue112`.
- Strict TDD active; configured test command `pnpm test`.
- Action-context warning: pre-existing sibling changes and parent-owned lifecycle prose were preserved.
- **Superseded historical status:** the final recorded OpenSpec status was `applyState: all_done`, task progress `42/42`, and `nextRecommended: review`. Its former claim that review evidence blocked verification/archive is obsolete; review evidence is informational and does not receipt-gate archive or delivery.

## Batch 9 — bind-SDD controller contract correction

### Status

Complete — task reconciliation remains 42/42 checked with zero unchecked rows. No real native review, binding, lifecycle gate, delivery action, commit, push, or PR action was performed.

### Correction

- Replaced caller-supplied `approved.repository`, `approved.authorityRevision`, and `approved.receiptHash` with request-only `change`, `lineageId`, and `expectedBindingRevision`.
- Before calling native, the controller now validates canonical change syntax, lineage and revision token syntax, an existing directory under the repository-confined OpenSpec change path, and symlink-resolved containment.
- The native request contains only canonical cwd, change, lineage, and expected binding revision. The explicit empty first revision and exact observed-revision replay remain covered.
- Returned repository, authority revision, receipt hash, and binding revision are native-owned binding evidence. The controller validates nonempty required fields and exact returned selected change/path/lineage before mapping the binding envelope.
- Malformed returned evidence or selected identity drift after a native call now maps through `nativeOperationFailure` as committed-or-ambiguous with exact replay guidance; it performs no retry or fallback.
- Updated the completed work-unit 4 task wording to describe the corrected request/result ownership boundary.

### TDD cycle evidence

| Cycle | Evidence |
| --- | --- |
| RED | `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/native-review-cli.test.ts` failed 2 bind tests because the controller still required caller-provided `approved` evidence. |
| GREEN | The same focused suite passed 26/26 after the request-only controller route and post-call evidence validation were implemented. |
| TRIANGULATE | The controller/native suite passed 63/63: malformed change, lineage, revision, and missing path made zero bind calls; first empty revision and exact replay were forwarded; selected identity mismatch and malformed result evidence incremented calls then returned ambiguous replay guidance. |
| REFACTOR | Kept the change inside the existing controller boundary; no native CLI, authority store, retry, or fallback path was added. |

### Verification

- `node --experimental-strip-types --test tests/review-controller-native-routing.test.ts tests/review-controller.test.ts tests/native-review-cli.test.ts && git diff --check` — PASS (63 tests; whitespace check passed).
- `pnpm test` — PASS (583 unit tests plus runtime harness).
- `grep -c '^- [x]' openspec/changes/native-review-authority-parity/tasks.md` / `grep -c '^- [ ]' openspec/changes/native-review-authority-parity/tasks.md` — PASS (42 checked, 0 unchecked).

### Files changed in batch 9

- `extensions/gentle-ai.ts`
- `tests/review-controller-native-routing.test.ts`
- `openspec/changes/native-review-authority-parity/tasks.md`
- `openspec/changes/native-review-authority-parity/apply-progress.md`

### Scope and provenance

- CodeGraph MCP was unavailable in this executor session despite the existing repository index; targeted filesystem reads followed the failed availability check.
- Pre-existing unrelated workspace changes were preserved. This batch used injected fake-native controller tests only and made no native/lifecycle/delivery calls.

## Batch 10 — corrected native START policy contract

### Status

Complete — task reconciliation remains 42/42 checked with zero unchecked implementation rows. No real native review, binding, lifecycle gate, delivery action, commit, push, or PR action was performed.

### Correction

- Replaced `NativeStartRequest.policyHash` with optional `policyPath`; native argv omits `--policy` when absent and sends one canonical path value when present.
- Native ordinary START now rejects a legacy `policyHash` before invoking the injected client, including when a policy path is also supplied.
- Custom policy paths are canonical repository-local regular files under `.gentle-ai/policies/`; outside, missing, and symlinked paths fail closed before a native/version call.
- The native start result mapper remains result-only and does not fabricate policy evidence from caller input. Legacy compact START continues to accept `policyHash` when native routing is disabled.
- Updated public tool input guidance to distinguish native `policyPath` from legacy compact `policyHash`.

### TDD cycle evidence

| Cycle | Evidence |
| --- | --- |
| RED | `node --experimental-strip-types --test tests/native-review-cli.test.ts tests/review-controller-native-routing.test.ts` failed 4 tests: native argv omitted `policyPath`, accepted legacy hash as `--policy`, and controller required `policyHash` for native ordinary START. |
| GREEN | The same focused suite passed 28/28 after the request type/argv update and pre-call policy path validation. |
| TRIANGULATE | Focused routing cases prove default and safe custom policy paths, plus hash, outside, missing, and symlink rejections with no additional native client calls; compact-only hash compatibility remains covered. |
| REFACTOR | Kept policy validation at the native controller boundary; no native authority, policy evidence, fallback, or compatibility-store mutation was added. |

### Verification

- `node --experimental-strip-types --test tests/native-review-cli.test.ts tests/review-controller-native-routing.test.ts` — PASS (28 tests).
- `pnpm test` — PASS (585 unit tests plus runtime harness).
- `git diff --check` — PASS.

### Files changed in batch 10

- `lib/native-review-cli.ts`
- `extensions/gentle-ai.ts`
- `tests/native-review-cli.test.ts`
- `tests/review-controller-native-routing.test.ts`
- `openspec/changes/native-review-authority-parity/tasks.md`
- `openspec/changes/native-review-authority-parity/apply-progress.md`

### Scope and provenance

- CodeGraph MCP was unavailable in this executor session despite the existing repository index; targeted filesystem reads followed the failed availability check.
- Pre-existing unrelated workspace changes were preserved. This batch used injected fake-native tests and made no native/lifecycle/delivery calls.
