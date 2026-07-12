# Implementation Tasks: Harden Review Contracts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,450 authored lines (approximately 850 production/assets + 600 tests/fixtures) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR, delivered as ordered work-unit commits |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

The forecast is below the requested 2,000-line ceiling. The High 400-line risk is accepted because delivery is explicitly single-PR; implementation must stop and rescope if the authored forecast exceeds 2,000 lines. Preserve all pre-existing uncommitted CodeGraph explorer and compact-authority changes; do not format, revert, or absorb their hunks.

## Execution Rules

- Strict TDD is active: every work unit follows RED → GREEN → TRIANGULATE → REFACTOR.
- Keep production code and its tests in the same work unit/commit; use conventional commits and do not commit by file type.
- Before implementation, record protected uncommitted paths/hunks with `git diff --stat` and targeted `git diff`; after each unit, verify those hunks are unchanged.
- Use targeted edits and existing seams. Do not modify `lib/review-repository.ts` or the pinned `IDENTITY` file unless a narrow, unavoidable import seam is proven.
- Do not change operation names, states, lens-selection policy, correction limits, graph-v1 mutation rules, delivery gates, or persisted schemas.
- Run focused tests after each unit; run `pnpm test` and `pnpm run prepack` before release readiness.

## Work Units

### 1. Baseline protection and strict contract parser

- [x] 1. Baseline protection and strict contract parser

**Scope:** `lib/review-compact-contract.ts`, `tests/review-compact-contract.test.ts`, and the smallest required type/import seams in `lib/review-compact.ts`.

- RED: Add table-driven tests for malformed top-level start/finalize/validate values; recursively unknown keys in projection, findings, refuter rows, validation proof/checks, follow-ups, final evidence, and derived targets; wrong types/enums; untrimmed/empty strings; malformed digests/lineage IDs; duplicate canonical lists; unsafe/non-integer/out-of-range numbers; and invalid field pairings.
- GREEN: Implement `CompactReviewContractError` with stable `area`/`code`, exact-key recursive parsers accepting `unknown`, const-backed enums, canonical string/digest/lineage/integer/range helpers, and the parser exports specified by design. Return typed values without spreading unvalidated input or coercing values.
- TRIANGULATE: Prove representative invalid payloads leave authority revision and store/Git probe counters unchanged; prove valid existing fixtures parse; run `node --experimental-strip-types --test tests/review-compact-contract.test.ts`.
- REFACTOR: Consolidate only local assertion helpers; keep transient parsing separate from persisted-record validation.
- **Finish/rollback:** Finish when all parser tables and no-side-effect tests pass. Roll back only this parser/test unit without touching persisted records or protected baseline work.

### 2. Facade and extension pre-mutation boundaries

- [x] 2. Facade and extension pre-mutation boundaries

**Scope:** `lib/review-facade.ts`, `extensions/gentle-ai.ts`, `tests/review-facade.test.ts`, `tests/review-controller.test.ts`.

- RED: Add boundary tests proving `startCompactReview`, `finalizeCompactReview`, `validateCompactReviewGate`, and the extension tool route parse complete inputs before inspection, authority discovery, lock/CAS, actor launch, receipt load, or reducer execution. Cover nested errors and unchanged 0/1/4 lens selection.
- GREEN: Route all compact public inputs through the shared parsers; remove compact-path coercions/casts and distributed shallow checks; preserve graph-v1 routing and existing operation/state names.
- TRIANGULATE: Use probes to assert zero observable repository/state activity on invalid input and run facade/controller focused tests.
- REFACTOR: Keep JSON decoding/routing in the extension and semantic decisions in the facade/reducer; avoid broad changes to repository code.
- **Finish/rollback:** Finish when invalid public requests fail deterministically before side effects and valid routing behavior remains unchanged. Revert only boundary wiring/tests if needed.

### 3. Native validator handoff and bounded repair reporting

- [x] 3. Native validator handoff and bounded repair reporting

**Scope:** `lib/review-compact.ts`, `lib/review-facade.ts`, `tests/review-facade.test.ts`, `tests/review-controller.test.ts`.

- RED: Test the two-call finalize flow: positive forecast, read-only validator request, exact replay, and terminal completion. Add tampering cases for correction IDs, rows, ledger hash, paths, candidate tree, fix hash, purposes, evidence, request hash, added findings, follow-up authority, and extra rounds. Test inert follow-ups and report phases/scope.
- GREEN: Add validation-proof/request contracts and native request construction from frozen correction authority plus Git snapshot; self-validate before dispatch; reconstruct and exact-compare on replay; reject widened evidence before mutation. Add `CompactRepairReport` derived only from frozen IDs/paths and native state, with inert observations separate from repair scope.
- TRIANGULATE: Assert no ledger/store mutation on every tampering case; assert one correction and one validator remain the maximum; verify reports for correction-required, scoped-validation, approved, and escalated outcomes; run focused facade/controller tests.
- REFACTOR: Centralize state-to-report derivation and preserve compatibility action text from the same native report source.
- **Finish/rollback:** Finish when request/response binding and reports are authority-derived and bounded. Revert this isolated handoff/report unit without weakening parser strictness.

### 4. Loaded-runtime identity binding and compatibility

- [x] 4. Loaded-runtime identity binding and compatibility

**Scope:** `lib/review-runtime-contract.ts`, `lib/review-compact-store.ts`, `lib/review-compact-gate.ts`, `tests/review-compact-gate.test.ts`, `tests/review-controller.test.ts`.

- RED: Add tests for stable identity across cwd/install/process metadata changes; compatible compact-v2 mutation and receipt use; mismatch before replace, receipt materialization, and both gate reads; and graph-v1 inspection/export/receipt/gate compatibility without compact identity enforcement.
- GREEN: Implement deterministic domain-derived `LoadedReviewRuntimeIdentityV1` and compatibility assertion. Capture/recheck identity in compact store construction, mutation, receipt operations, and gate first/final reads. Add only a private/test seam for mismatch injection; callers cannot provide identity.
- TRIANGULATE: Run gate/controller focused tests and verify mismatch produces explicit `REVIEW_RUNTIME_INCOMPATIBLE` with no mutation/approval or actor/delivery action.
- REFACTOR: Keep runtime identity distinct from repository identity and leave mixed/legacy reset/recovery paths unchanged.
- **Finish/rollback:** Finish when compact boundaries fail closed and graph-v1 read-only behavior passes. Roll back only identity enforcement/module/tests; never rewrite authority or receipts.

### 5. Canonical reviewer prompt parity

- [x] 5. Canonical reviewer prompt parity

**Scope:** `assets/agents/review-risk.md`, `assets/agents/review-resilience.md`, `assets/agents/review-readability.md`, `assets/agents/review-reliability.md`, `tests/review-ledger-contract.test.ts`, and one canonical parity fixture in the existing test/support location.

- RED: Add parity tests for one-shot `initial_review_tree`, exact JSON keys/enums, proof prefixes, candidate-causal severe eligibility, native ownership/untrusted actor output, and prohibited persistence/fix/validation/delivery/metadata actions. Add an in-memory mutation test identifying the affected lens and clause.
- GREEN: Align only missing shared clauses in package-owned prompts and make the fixture parameterize lens role while retaining distinct specialization text. Do not rewrite project/user overrides or asset paths/precedence.
- TRIANGULATE: Run parity tests and package-content checks; assert each lens retains distinct risk-role text.
- REFACTOR: Keep parity assertions centralized and avoid duplicating prompt ownership.
- **Finish/rollback:** Finish when all four prompts pass parity and drift detection. Revert only prompt/test changes if parity reveals an installation or override regression.

### 6. End-to-end lifecycle, regression, and release readiness

- [x] 6. End-to-end lifecycle, regression, and release readiness

**Scope:** `tests/review-controller.test.ts`, `tests/review-facade.test.ts`, `tests/review-compact-gate.test.ts`, package/runtime verification tests as needed, and no unrelated fixtures.

- RED: Add one facade-to-store lifecycle test covering `START → lens FINALIZE → correction forecast → edit → validator-request FINALIZE → targeted-validation FINALIZE → independent evidence FINALIZE → terminal report → compact gate validation`; include persisted receipt integrity, request replay binding, and unchanged operation/state names.
- GREEN: Fix only intentional valid fixtures and narrow integration seams required by the hardened contracts; do not normalize unrelated fixtures or protected uncommitted work.
- TRIANGULATE: Run focused unit tests, then `pnpm test`, then `pnpm run prepack`; verify graph-v1 compatibility, dangerous-command safety composition, exact-gate behavior, and package prompt/module inclusion.
- REFACTOR: Remove redundant fixtures/helpers and document test evidence in the apply/verify artifacts without changing semantics.
- **Finish/rollback:** Finish only when all proposal/spec acceptance boundaries have executable evidence, protected diffs are unchanged, and authored changes remain ≤2,000 lines. Roll back isolated change hunks as a unit; never reset lineages, delete receipts, or revert CodeGraph/compact-authority baseline work.

## Final Release Readiness Checklist

- [x] All work units completed in dependency order with tests included in their unit.
- [x] `git diff --stat` confirms authored changes are within 2,000 lines and protected uncommitted hunks remain unchanged.
- [x] `node --experimental-strip-types --test tests/*.test.ts` passes through `pnpm test`.
- [x] `pnpm run prepack` passes and package assets/modules are present.
- [x] No persisted schema migration, graph-v1 mutation, new state/actor/round, delivery behavior, or `IDENTITY` change was introduced.
- [x] Review evidence covers deterministic rejection before mutation, native validator binding, bounded reports, prompt parity/drift, runtime mismatch, and facade-to-store compatibility.
- [x] Final verification confirms no protected CodeGraph explorer or compact-authority changes were modified.
