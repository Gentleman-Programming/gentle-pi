# Apply Progress: Harden Review Contracts

## Status

**Blocked before implementation.**

The authoritative OpenSpec status consumed on 2026-07-12 reports `applyState: ready`, `nextRecommended: apply`, and an allowed repository-local edit root of `/home/gentleman/work/gentle-pi`.

## Delivery gate

The persisted workload forecast is **1,450 authored lines** with `400-line budget risk: High`. The delegated instruction selects `single-pr` with a 2,000-line ceiling, but does not explicitly approve the required `size:exception` for a single PR above the 400-line review budget.

**Decision required before apply:** explicit maintainer approval: `size:exception` for the planned single PR (forecast 1,450 lines; hard ceiling 2,000).

## Inputs consumed

- `proposal.md`
- `specs/review-orchestration/spec.md`
- `specs/review-routing/spec.md`
- `specs/review-transaction/spec.md`
- `design.md`
- `tasks.md`
- `openspec/config.yaml`

## Protected baseline

Existing uncommitted CodeGraph explorer and compact-authority work was inspected and remains untouched. No source, test, asset, or task-checkbox changes were made by this apply attempt.

## Tests

None run: implementation is blocked by the delivery decision before the strict-TDD RED phase.

## TDD Cycle Evidence

| Work unit | RED | GREEN | TRIANGULATE | REFACTOR | Evidence |
|---|---|---|---|---|---|
| None | Not started | Not started | Not started | Not started | Blocked before implementation |

## Remaining tasks

- [ ] 1. Baseline protection and strict contract parser
- [ ] 2. Facade and extension pre-mutation boundaries
- [ ] 3. Native validator handoff and bounded repair reporting
- [ ] 4. Loaded-runtime identity binding and compatibility
- [ ] 5. Canonical reviewer prompt parity
- [ ] 6. End-to-end lifecycle, regression, and release readiness
- [ ] All work units completed in dependency order with tests included in their unit.
- [ ] `git diff --stat` confirms authored changes are within 2,000 lines and protected uncommitted hunks remain unchanged.
- [ ] `node --experimental-strip-types --test tests/*.test.ts` passes through `pnpm test`.
- [ ] `pnpm run prepack` passes and package assets/modules are present.
- [ ] No persisted schema migration, graph-v1 mutation, new state/actor/round, delivery behavior, or `IDENTITY` change was introduced.
- [ ] Review evidence covers deterministic rejection before mutation, native validator binding, bounded reports, prompt parity/drift, runtime mismatch, and facade-to-store compatibility.
- [ ] Final verification confirms no protected CodeGraph explorer or compact-authority changes were modified.

## Workload / PR boundary

Single PR only after explicit `size:exception`; scope remains the full `harden-review-contracts` task list and must remain at or below 2,000 authored changed lines.

## Deviations from design

None in the completed strict-parser slice. The broader change has not been completed.

## Apply continuation — 2026-07-12

### Status

**Partial / blocked on test-contract reconciliation.** The delegated prompt explicitly approved the `size:exception` for one PR (maximum 2,000 authored lines), satisfying the previous delivery gate. The authoritative OpenSpec status remained `applyState: ready`, `nextRecommended: apply`, with the repository root as the allowed edit root.

### Strict TDD evidence

| Work unit | RED | GREEN | TRIANGULATE | REFACTOR | Evidence |
|---|---|---|---|---|---|
| 1. Strict transient compact parser | `tests/review-compact-contract.test.ts` failed with `ERR_MODULE_NOT_FOUND` before `lib/review-compact-contract.ts` existed | Focused parser tests pass after the parser was added | Valid inputs plus nested unknown-key and final-evidence-pair violations | Parser keeps exact-object assertions local and separate from persisted-record validation | `node --experimental-strip-types --test tests/review-compact-contract.test.ts` passed (2 tests) |
| 2. Facade pre-mutation boundary | New facade test failed because repository discovery happened before malformed-input rejection | Parser now executes at `startCompactReview` and `finalizeCompactReview` entry; focused facade tests pass | Invalid start against a nonexistent cwd and invalid finalize evidence pairing both reject as contract errors | No broad repository changes | `node --experimental-strip-types --test tests/review-compact-contract.test.ts tests/review-facade.test.ts` passed (10 tests) |

### Files changed in this continuation

- `lib/review-compact-contract.ts` — new strict transient START/FINALIZE parser and stable contract error.
- `tests/review-compact-contract.test.ts` — new parser coverage.
- `lib/review-facade.ts` — parse before authority discovery.
- `tests/review-facade.test.ts` — boundary and rejection coverage.

### Verification

- PASS: `node --experimental-strip-types --test tests/review-compact-contract.test.ts`
- PASS: `node --experimental-strip-types --test tests/review-compact-contract.test.ts tests/review-facade.test.ts`
- FAIL: `pnpm test` — 492 passed / 2 failed. The failures are `tests/review-compact-gate.test.ts` (expects an incomplete final-evidence pair to persist escalation) and protected concurrent `tests/review-controller.test.ts` (expects malformed refuter data to persist escalation). Both expectations conflict with the required strict pre-mutation rejection. No package/prepack dry-run was run after this failure.
- PASS: `git diff --check`

### Protected baseline and authored-line accounting

The recorded protected baseline was 326 insertions / 20 deletions. Current tracked diff is 348 insertions / 30 deletions; this continuation adds 22 insertions / 10 deletions to tracked files plus two untracked implementation/test files (169 + 58 lines). **Actual continuation authored changed lines: 259** (249 insertions, 10 deletions). Existing CodeGraph explorer and compact-authority hunks were not reverted or reformatted.

### Remaining tasks

- [ ] 1. Baseline protection and strict contract parser
- [ ] 2. Facade and extension pre-mutation boundaries
- [ ] 3. Native validator handoff and bounded repair reporting
- [ ] 4. Loaded-runtime identity binding and compatibility
- [ ] 5. Canonical reviewer prompt parity
- [ ] 6. End-to-end lifecycle, regression, and release readiness
- [ ] All work units completed in dependency order with tests included in their unit.
- [ ] `git diff --stat` confirms authored changes are within 2,000 lines and protected uncommitted hunks remain unchanged.
- [ ] `node --experimental-strip-types --test tests/*.test.ts` passes through `pnpm test`.
- [ ] `pnpm run prepack` passes and package assets/modules are present.
- [ ] No persisted schema migration, graph-v1 mutation, new state/actor/round, delivery behavior, or `IDENTITY` change was introduced.
- [ ] Review evidence covers deterministic rejection before mutation, native validator binding, bounded reports, prompt parity/drift, runtime mismatch, and facade-to-store compatibility.
- [ ] Final verification confirms no protected CodeGraph explorer or compact-authority changes were modified.

### Workload / PR boundary

Explicit `size:exception` approved: one PR, hard maximum 2,000 authored lines. Current continuation contribution is 259 authored changed lines; no commit, push, publish, or package release action was performed.

## Corrective gate retry — 2026-07-12

### Status

**Blocked: the corrective expectation reconciliation passes, but the requested full six-work-unit implementation is not complete.** The authoritative status consumed before editing remained `applyState: ready`, `nextRecommended: apply`, artifact store `openspec`, and repository-local edit root `/home/gentleman/work/gentle-pi`. No action-context warning applied.

### Corrective change

The two legacy expectations were updated to the approved transient-contract behavior:

- `tests/review-compact-gate.test.ts` now proves an incomplete `final_evidence` / `final_verification_passed` pair throws before authority mutation and leaves the lineage in `reviewing`.
- `tests/review-controller.test.ts` now proves a malformed transient refuter row throws before CAS and leaves the persisted compact revision and state unchanged.

### TDD Cycle Evidence

| Work unit | RED | GREEN | TRIANGULATE | REFACTOR | Evidence |
|---|---|---|---|---|---|
| Corrective legacy expectation reconciliation | The two focused tests failed because they expected escalation persistence from malformed transient FINALIZE payloads | Updated expectations assert deterministic contract rejection before mutation | Focused gate/controller suite passed with 30 tests; full suite passed with 494 tests | Removed terminal/escalation assertions that contradicted strict boundary semantics | `node --experimental-strip-types --test tests/review-compact-gate.test.ts tests/review-controller.test.ts`; `pnpm test` |

### Files changed in this retry

- `tests/review-compact-gate.test.ts`
- `tests/review-controller.test.ts`
- `openspec/changes/harden-review-contracts/apply-progress.md`

### Verification

- PASS: `node --experimental-strip-types --test tests/review-compact-gate.test.ts tests/review-controller.test.ts` (30/30)
- PASS: `pnpm test` (494/494)
- PASS: `pnpm run prepack` (package resource check passed: 49 files)
- PASS: `git diff --check`
- Current repository diff accounting: tracked `332 insertions, 49 deletions`; active change untracked parser/tests add `227` lines. The combined visible change count is **608 lines**, below the explicit 2,000-line exception ceiling. This includes protected concurrent baseline changes, so it is not a precise ownership-only count.

### Exact blocker

Tasks **3–6 remain wholly unchecked**, and their required production work is absent: no native frozen validator-request/replay binding or authority-derived repair report, no loaded runtime identity module/enforcement, no canonical prompt-parity fixture, and no specified facade-to-store correction lifecycle coverage. Passing the existing suite cannot substitute for these acceptance boundaries. This corrective retry therefore cannot truthfully mark tasks 1–6 or final release readiness complete.

### Persisted task state

No task checkbox was changed: every implementation task remains visibly unchecked in `tasks.md`, matching the incomplete acceptance coverage.

### Workload / PR boundary

Explicit `size:exception` remains approved for one PR with a 2,000-line maximum. No commit, push, publish, or package release action was performed.

## Completion continuation — 2026-07-12

### Status

**Complete / ready for verify.** Authoritative OpenSpec status consumed: `applyState: ready`, `nextRecommended: apply`; repository-local edits only. The explicit single-PR `size:exception` remains bounded to 2,000 authored lines.

### Completed tasks and persisted checkbox evidence

- [x] 1. Baseline protection and strict contract parser
- [x] 2. Facade and extension pre-mutation boundaries
- [x] 3. Native validator handoff and bounded repair reporting
- [x] 4. Loaded-runtime identity binding and compatibility
- [x] 5. Canonical reviewer prompt parity
- [x] 6. End-to-end lifecycle, regression, and release readiness

`tasks.md` now visibly marks tasks 1–6 and every release-readiness checkbox complete.

### Implementation

- Added a native two-call validator handoff: proof-only FINALIZE derives a hash-bound request from frozen correction IDs/rows/ledger and Git snapshot; replay requires the exact request hash before correction mutation.
- Added authority-derived repair reports for correction-required, scoped-validation, approved, and escalated outcomes.
- Added deterministic loaded-runtime identity and fail-closed compact-store enforcement before load, replacement, receipt materialization, and terminal receipt access.
- Added canonical four-lens parity fixture coverage while preserving package-owned prompt text and lens specialization.
- Extended the controller route to forward `validation_proof`; no operation, state, persisted schema, graph-v1 mutation path, or delivery behavior changed.

### Files changed in this continuation

- `lib/review-compact.ts`
- `lib/review-facade.ts`
- `lib/review-compact-store.ts`
- `lib/review-runtime-contract.ts`
- `lib/review-compact-contract.ts`
- `extensions/gentle-ai.ts`
- `tests/review-compact.test.ts`
- `tests/review-facade.test.ts`
- `tests/review-runtime-contract.test.ts`
- `tests/review-ledger-contract.test.ts`
- `tests/support/review-lens-parity.ts`
- `openspec/changes/harden-review-contracts/tasks.md`

### TDD Cycle Evidence

| Work unit | RED | GREEN | TRIANGULATE | REFACTOR | Evidence |
|---|---|---|---|---|---|
| 3. Validator handoff/reporting | Focused lifecycle originally failed until a request hash was available | Proof-only handoff and exact replay pass | Tampered request hash rejects before mutation; scoped approved report asserted | Request construction remains native in compact reducer seam | focused compact/facade tests passed |
| 4. Runtime identity | New runtime test failed with missing module | Stable identity and mismatch guard pass | Store mismatch rejects before compact authority load | Identity remains separate from repository identity | `tests/review-runtime-contract.test.ts` passed |
| 5. Prompt parity | Parity fixture extracted from repeated lens assertions | All four package prompts pass the fixture | Ledger contract suite validates every lens and JSON envelope | Shared clauses centralized in test support | `tests/review-ledger-contract.test.ts` passed |
| 6. Lifecycle/release readiness | Full suite initially exposed missing request hash in direct compact correction test | Direct lifecycle updated to use native request | Focused compact/facade/gate/runtime suite and full package verification pass | No unrelated fixture normalization | commands below passed |

### Verification

- PASS: `node --experimental-strip-types --test tests/review-compact.test.ts tests/review-facade.test.ts tests/review-compact-gate.test.ts tests/review-runtime-contract.test.ts` (19/19)
- PASS: `node --experimental-strip-types --test tests/review-runtime-contract.test.ts tests/review-ledger-contract.test.ts` (18/18)
- PASS: `pnpm test` (496/496)
- PASS: `pnpm run prepack` (package resource check: 49 files)
- PASS: `git diff --check`

### Workload / protected baseline

Current tracked diff is 472 insertions and 69 deletions. Excluding OpenSpec artifacts and the protected CodeGraph files, current visible review-contract implementation/test additions are 892 changed lines (823 additions and 69 deletions), below the approved 2,000-line ceiling. No commit, push, publish, or package release action was performed. Existing CodeGraph explorer and compact-authority baseline work was preserved; this continuation added only targeted review-contract hunks.

### Deviations and remaining tasks

No design deviation. There are no unchecked implementation or release-readiness checkboxes remaining.

## Zombie-task recovery completion — 2026-07-12

### Status

**Complete.** Recovered the stale partial remediation without reverting its valid contract-parser, controller, or test work. The six requested contract boundaries are now implemented and verified.

### Completed hardening

- Validator requests are persisted as immutable compact authority evidence before the validator runs. A response must echo the frozen request hash and the frozen original-criteria and regression evidence before correction mutation can proceed.
- Compact authority discovery rejects every malformed lineage entry, including non-directories and invalid names, instead of filtering them out.
- Compact state persists a loaded runtime-contract identity and fails closed on incompatible runtimes before compact reads, mutation, receipts, or validation; graph-v1 paths remain untouched.
- CodeGraph accepts only the real current Git project root and rejects HOME, the temporary root, nested workspaces, and non-project workspaces before process execution.
- A caller-provided alternate lineage is blocked when a terminal compact authority already covers the unchanged target; changed targets remain startable.
- All four reviewer assets emit exact namespaced lens values and explicit `findings` and `evidence` arrays.

### Strict TDD evidence

| Work unit | RED | GREEN | TRIANGULATE |
|---|---|---|---|
| Recovered six-boundary remediation | Focused suite observed nine failures covering CodeGraph root admission, malformed compact authority entries, validator evidence substitution, alternate terminal lineage restart, runtime persistence, and namespaced prompt parity | Focused suite passed 46/46 after the targeted fixes | Controller lifecycle suite passed 26/26; full package suite passed 501/501 |

### Final verification

- PASS: `node --experimental-strip-types --test tests/review-compact.test.ts tests/review-compact-store.test.ts tests/review-facade.test.ts tests/review-runtime-contract.test.ts tests/review-ledger-contract.test.ts tests/codegraph-tools.test.ts` (46/46)
- PASS: `node --experimental-strip-types --test tests/review-controller.test.ts` (26/26)
- PASS: `pnpm test` (501/501)
- PASS: `pnpm run prepack` (package resource check: 49 files)
- PASS: `git diff --check`

No commit, push, publish, or release action was performed.

## Compact invalid-authority reset routing — 2026-07-12

### Change

When legacy inspection is clean but compact-v2 authority inspection is invalid, RESET now remains behind the existing exact repository/common-directory/inventory challenge and fresh interactive authorization. The reset engine rechecks invalid compact authority while holding the shared mutation lock, then uses its existing quarantine and verified-clean initialization flow. Valid active, approved, and escalated compact authority remains non-resettable through this route; legacy and mixed behavior is unchanged.

### Strict TDD evidence

- RED: `node --experimental-strip-types --test tests/review-controller.test.ts tests/review-reset.test.ts` failed because invalid compact authority was routed to `stop-and-report-ambiguous-authority` and RESET rejected clean legacy inspection.
- GREEN: the same focused command passed 42/42 after the controller routed clean legacy plus invalid compact authority to explicit reset authorization and the reset engine admitted only invalid compact authority.
- TRIANGULATE: tests assert altered challenges fail without reset, valid approved compact authority remains terminal, and existing legacy/mixed reset coverage passes.

### Verification

- PASS: `node --experimental-strip-types --test tests/review-controller.test.ts tests/review-reset.test.ts` (42/42)
- PASS: `pnpm test` (504/504)
- PASS: `pnpm run prepack` (package resource check: 49 files)

No commit, push, publish, or release action was performed.

## Reset journal lifecycle completion — 2026-07-12

### Change

Completed reset journals are now moved to `control/reset-history/<reset-id>.json` with anchored path checks and directory fsync before a new independently authorized reset writes its journal. Only a non-complete journal may be recovered. This preserves prior authorization audit records while preventing completed history from blocking a fresh compact-invalid reset.

### Strict TDD evidence

- RED: `node --experimental-strip-types --test tests/review-reset.test.ts tests/review-controller.test.ts` failed with `A reset state already exists; use explicit resume` for a fresh compact-invalid RESET after completed history.
- GREEN: the focused suite passed 44/44 after archival and incomplete-only RECOVER enforcement.
- TRIANGULATE: tests prove interrupted fresh state remains `reset-in-progress`, compact-v2 is quarantined, an old authorization cannot resume the new reset, completed history causes INSPECT to request RESET rather than RECOVER, and completion returns the verified-clean next action.

### Verification

- PASS: `node --experimental-strip-types --test tests/review-reset.test.ts tests/review-controller.test.ts` (44/44)
- PASS: `pnpm test` (506/506)
- PASS: `pnpm run prepack` (package resource check: 49 files)

No live repository `.git` authority was mutated, and no commit, push, publish, or release action was performed.
