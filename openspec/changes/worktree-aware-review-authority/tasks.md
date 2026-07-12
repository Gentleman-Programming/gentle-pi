# Tasks: Worktree-Aware Review Authority

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1,300 (runtime, tests, SDD assets, support contract, and status-chain integration) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

The expanded same-PR scope is explicitly approved. No artificial line cap or new split decision applies; keep implementation and tests cohesive and use work-unit boundaries for reviewability.

## Execution Contract

- Strict TDD is active: RED → GREEN → TRIANGULATE → REFACTOR, with `pnpm test` as the full runner.
- Every checkbox below is implementation-owned and carries exactly one canonical ownership marker.
- Legacy compatibility is runtime behavior, not authoring style: all new task rows use the marker syntax.
- Keep tests with the behavior they verify and preserve schemas, receipts, common-directory layout, worktree identity rules, and graph-v1/legacy semantics.
- `sdd-apply` executes only implementation-owned rows and stops on malformed ownership markers.

## 1. Complete live candidate and reset recovery seams

**Files:** `lib/review-snapshot.ts`, `extensions/gentle-ai.ts`, `tests/review-snapshot.test.ts`, `tests/review-controller.test.ts`.

- [x] **RED:** Add ephemeral-binding coverage for repository ID, base tree, complete/current candidate trees, canonical changed paths, and intended-untracked scope, including preservation of the real index and zero retained snapshot/authority mutation. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Add `LiveReviewCandidateBinding` and missing-reset-state typed mapping without changing `SnapshotV1` or mutating authority before the error is returned. <!-- sdd-owner: implementation -->
- [x] **RED:** Add RECOVER regression coverage for absent exact `control/reset-state.json`, identical retry output, unchanged authority inventory, and zero writes. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify malformed, integrity, repository-mismatch, authorization, and unsafe-path errors remain distinct; run focused snapshot/controller tests. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Preserve temporary-index/object cleanup and use const-object-derived controller outcome types. <!-- sdd-owner: implementation -->

## 2. Bind terminal discovery to authority and prove every dimension

**Files:** `lib/review-compact-store.ts`, `lib/review-facade.ts`, `tests/review-facade.test.ts`.

- [x] **GREEN:** Compare validated terminal receipts against base tree, final candidate tree, canonical changed-path hash, intended-untracked hash, and policy hash. <!-- sdd-owner: implementation -->
- [x] **RED:** Add independent regression cases where each of repository authority, `base_tree`, `final_candidate_tree`, changed-path hash, intended-untracked hash, and policy differs from terminal A and prevents reuse. <!-- sdd-owner: implementation -->
- [x] **RED:** Add provenance regressions for detached receipts, transplanted stores/pinned identity mismatch, authority tuple mismatch/race, and invalid terminal data not being treated as “no match.” <!-- sdd-owner: implementation -->
- [x] **GREEN:** Pass one validated `RepositoryAuthorityV1` through read-only discovery and expose an internal `TerminalReviewCandidateBinding` without schema or path-identity changes. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Assert terminal receipt/state bytes, store paths, and pre-existing receipt hash remain unchanged after applicability inspection or another candidate START. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Centralize comparison/hash projection and retain typed fail-closed authority/integrity errors. <!-- sdd-owner: implementation -->

## 3. Make START deterministic and idempotent

**Files:** `lib/review-facade.ts`, `tests/review-facade.test.ts`.

- [x] **GREEN:** Include policy in derived lineage identity and collect validated exact matches deterministically rather than selecting the first match. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Add typed explicit-lineage binding-mismatch and multiple-terminal ambiguity errors with no mutation. <!-- sdd-owner: implementation -->
- [x] **RED:** Add explicit-lineage mismatch coverage proving it fails closed and never falls through to a fresh START under that ID. <!-- sdd-owner: implementation -->
- [x] **RED:** Add duplicate exact-terminal coverage proving sorted ambiguity, no lineage/receipt mutation, and stable replay output. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify exact replay, concurrent exact START CAS behavior, explicit-lineage behavior, and receipt preservation with focused facade tests and `pnpm test`. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Keep capture-before-scan ordering, deterministic ID sorting, and read-only decisions free of mutation. <!-- sdd-owner: implementation -->

## 4. Route controller INSPECT and START by the live candidate

**Files:** `extensions/gentle-ai.ts`, `tests/review-controller.test.ts`.

- [x] **GREEN:** Add optional policy-bound INSPECT applicability metadata while retaining unfiltered repository-wide inventory and compatibility-first blocking. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Route linked-worktree path-only matches to terminal reuse and material candidate differences to fresh START; preserve existing receipt behavior. <!-- sdd-owner: implementation -->
- [x] **RED:** Add linked-worktree tests for identical binding plus policy, path-only difference, every material candidate difference, and candidate A receipt gate-validatability after candidate B starts. <!-- sdd-owner: implementation -->
- [x] **RED:** Add bare INSPECT `policy-unresolved`, policy-bound applicable/not-applicable/ambiguous, and deterministic inventory assertions. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Cover legacy, graph-v1, mixed, ambiguous, compact-invalid, active, and reset-in-progress authority with no bypass. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Ensure START never trusts prior INSPECT and candidate-aware logic remains limited to compact terminal applicability. <!-- sdd-owner: implementation -->

## 5. Establish SDD ownership parsing and status accounting

**Files:** `lib/sdd-status.ts`, `tests/sdd-status.test.ts`.

- [x] **RED:** Add parser tests for unmarked legacy rows, canonical implementation/parent markers, checked/unchecked combinations, and legacy completion routing to `parent-lifecycle`. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Add const-derived `SDD_TASK_OWNER`, line-oriented parsing, implementation `taskProgress`, and additive `deferredParentActions`/`taskArtifactErrors` fields in every status constructor. <!-- sdd-owner: implementation -->
- [x] **RED:** Add malformed marker tests for unsupported/uppercase/duplicate/non-terminal/unterminated markers, including checked malformed rows. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Account malformed rows as unresolved implementation work, emit exact diagnostics and blocked reasons, and route to `fix-task-ownership-marker`. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Verify rendering, empty/non-authoritative constructors, parent visibility, legacy compatibility, and no prose-based ownership inference. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Keep one parser/progress accumulator and flat status interfaces. <!-- sdd-owner: implementation -->

## 6. Update SDD task/apply/status/support contracts

**Files:** `assets/agents/sdd-tasks.md`, `assets/agents/sdd-apply.md`, `assets/agents/sdd-status.md`, `assets/support/sdd-status-contract.md`.

- [x] **RED:** Add asset-language assertions covering canonical markers, legacy default, malformed fail-closed behavior, separated progress, and parent-lifecycle routing. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Require `sdd-tasks` to mark every generated checkbox exactly once, keep parent lifecycle prose separate, and never assign bounded review to implementation work. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Require `sdd-apply` to select/check/report only implementation rows, preserve parent rows, stop on artifact errors, and return `parent-lifecycle` after implementation completion. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Document the shared marker grammar, additive status shape, route table, and marker-independent review obligation in status/support contracts. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Assert apply prohibition on review/refutation/correction/validation actors, receipt creation/approval, and all delivery-gate validation. <!-- sdd-owner: implementation -->

## 7. Update full-chain routing and verification contracts

**Files:** `assets/chains/sdd-full.chain.md`, `tests/artifact-language.test.ts`, `tests/sdd-status.test.ts`.

- [x] **RED:** Add chain and artifact-language regressions proving completed implementation yields to the parent boundary and no review actor is added to the chain. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Amend the full chain so every completed apply yields to parent lifecycle unless authoritative approved receipt evidence already exists; resume independent verification only after approval. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Keep sync/archive behind verification readiness and preserve parent ownership of native lifecycle gates. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Cover no parent markers, checked/unchecked parent markers, missing/approved/invalidated/scope-changed/escalated/ambiguous receipt authority, and archive blockers. <!-- sdd-owner: implementation -->

## 8. Cross-cutting implementation verification

**Files:** all changed production/test/assets plus `apply-progress.md` and `verify-report.md`.

- [x] **TRIANGULATE:** Run focused runtime tests, focused status/asset tests, `git diff --check`, available type/lint checks, and full `pnpm test`; record exact results. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Remove test-only switches, worktree identity, schema changes, duplicated comparison logic, and unrelated edits; confirm pure code/asset rollback. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Record the acceptance matrix, exact implementation checkbox updates, untouched parent lifecycle prose, receipt-preservation evidence, and unresolved warnings in apply/verification artifacts. <!-- sdd-owner: implementation -->

## Parent post-apply lifecycle

This section is mandatory parent/orchestrator procedure, not apply work and not part of implementation progress. It intentionally contains no implementation checkbox. After all implementation-owned rows and verification evidence are complete, the parent must yield at this boundary. The parent/orchestrator must start or reuse native bounded review using authority-first rules: reuse only an authoritatively approved receipt valid for the live candidate; otherwise explicitly run `review/start`; fail closed for scope-changed, invalidated, escalated, ambiguous, invalid, or missing authority. The parent must not infer approval from task text or checkbox state.

After review approval, the parent validates the same content-bound receipt at each applicable lifecycle gate (`pre-commit`, `pre-push`, `pre-pr`, release, or other native gate). Independent SDD verification may proceed only after authoritative receipt approval; sync/archive additionally require verification readiness. The parent marks any explicit parent lifecycle rows only when it actually performs those actions. `sdd-apply` must never perform this section.

## Verification Matrix

| Requirement | Evidence target |
|---|---|
| Complete candidate binding and provenance | Per-dimension facade/controller regressions and authority tuple tests |
| Receipt preservation | Byte/hash and gate-validity checks before/after another candidate START |
| Same-lineage idempotency | Exact replay, explicit mismatch, ambiguity, and CAS tests |
| SDD ownership | Parser/status/apply/asset/chain tests with canonical markers |
| Parent boundary | Status and chain tests proving unconditional post-apply handoff and no apply review actors |
| Compatibility | Legacy, graph-v1, mixed, invalid, active, ambiguous, and reset-in-progress tests |
| Persistence/schema compatibility | Existing receipt/state loading, unchanged bytes/layout, and full `pnpm test` |
