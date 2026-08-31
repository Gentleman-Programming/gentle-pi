# Apply Progress: Worktree-Aware Review Authority

## Current Status

**Implementation complete: 41/41 implementation-owned tasks checked in `tasks.md`.**

Strict TDD is active. All implementation work, including this evidence remediation, is complete. The mandatory parent post-apply lifecycle is intentionally not implementation work and remains unperformed: no review transaction, receipt, gate validation, commit, push, or PR was created.

## Final Acceptance Matrix

| Requirement / task group | Exact implementation and test evidence | Commands |
| --- | --- | --- |
| 1. Live candidate binding and reset recovery | `lib/review-snapshot.ts`; `extensions/gentle-ai.ts`; `tests/review-snapshot.test.ts` proves complete/current tree, canonical paths, intended untracked scope, and temporary-index preservation. `tests/review-controller.test.ts` proves missing `control/reset-state.json` is stable, zero-mutation, and inventory-preserving. | `node --experimental-strip-types --test tests/review-snapshot.test.ts tests/review-controller.test.ts` |
| 2. Terminal binding dimensions and provenance | `lib/review-facade.ts` compares repository ID, base tree, final candidate tree, canonical changed-path hash, intended-untracked hash, and policy. `tests/review-facade.test.ts` independently negates all six dimensions and proves a detached terminal receipt fails closed. `tests/review-compact-store.test.ts` rejects an authority tuple from another repository. `tests/review-repository.test.ts` rejects a transplanted pinned store. | `node --experimental-strip-types --test tests/review-facade.test.ts tests/review-compact-store.test.ts tests/review-repository.test.ts` |
| 3. Explicit lineage, ambiguity, replay, and CAS | `lib/review-facade.ts` derives policy-bound lineage IDs, captures before scanning, sorts terminal IDs, and blocks explicit mismatch. `tests/review-facade.test.ts` covers explicit mismatch, duplicate exact terminals, sorted ambiguity, replay, and no mutation. `tests/review-compact-store.test.ts` covers content-derived CAS, exact retry, and terminal immutability. | `node --experimental-strip-types --test tests/review-facade.test.ts tests/review-compact-store.test.ts` |
| 4. Linked worktrees and controller applicability | `extensions/gentle-ai.ts` supplies bare `policy-unresolved` and policy-bound applicability without trusting prior INSPECT. `tests/review-controller.test.ts` covers linked-worktree identical/path-only reuse, material candidate B fresh START, bare/policy-bound applicability, duplicate ambiguity, legacy, graph-v1, mixed, invalid, active, and reset-in-progress routing. `tests/review-compact-gate.test.ts` proves candidate A remains gate-valid after candidate B starts. | `node --experimental-strip-types --test tests/review-controller.test.ts tests/review-compact-gate.test.ts` |
| Receipt/state/store byte and hash preservation | `lib/review-compact-store.ts` validates terminal receipt/state correspondence and immutability. `tests/review-compact-store.test.ts` covers terminal readback and immutable CAS. `tests/review-compact-gate.test.ts` byte-compares candidate A state and receipt before and after candidate B starts, then validates A's exact gate target. | `node --experimental-strip-types --test tests/review-compact-store.test.ts tests/review-compact-gate.test.ts` |
| 5. SDD ownership/status accounting | `lib/sdd-status.ts`; `tests/sdd-status.test.ts` cover markers, malformed rows, implementation accounting, and parent-lifecycle routing. | `node --experimental-strip-types --test tests/sdd-status.test.ts` |
| 6–7. SDD agent, support, and chain contracts | `assets/agents/sdd-tasks.md`, `assets/agents/sdd-apply.md`, `assets/agents/sdd-status.md`, `assets/support/sdd-status-contract.md`, and `assets/chains/sdd-full.chain.md`; `tests/artifact-language.test.ts` and `tests/sdd-status.test.ts` enforce ownership and no apply-owned review lifecycle. | `node --experimental-strip-types --test tests/artifact-language.test.ts tests/sdd-status.test.ts` |
| 8. Cross-cutting compatibility | Focused suites above plus full `pnpm test`; compatibility coverage includes legacy, graph-v1, mixed, compact-invalid, active, reset-in-progress, receipt/state loading, and schema/layout preservation. | `git diff --check`; `pnpm test` |

## Evidence Remediation (2026-07-12)

### Newly traceable evidence

- Added `tests/review-compact-store.test.ts` coverage for a foreign `RepositoryAuthorityV1` passed to authority-bound terminal discovery. The RED run failed because discovery accepted the foreign tuple. `lib/review-compact-store.ts` now verifies common directory, store root, repository ID, and authority ID against the current repository before enumerating stores.
- Added `tests/review-facade.test.ts` coverage that a terminal receipt detached from its matching state fails closed during a later START; it cannot be filtered as an ordinary non-match.
- Added `tests/review-compact-gate.test.ts` coverage that candidate A remains gate-valid after candidate B starts and that A's terminal state and receipt bytes remain unchanged.

### Strict TDD evidence

| Cycle | RED | GREEN | Triangulate / refactor |
| --- | --- | --- | --- |
| Foreign authority tuple | `node --experimental-strip-types --test tests/review-compact-store.test.ts` failed: `Missing expected exception` for foreign authority-bound discovery. | Added the current-authority tuple guard in `discoverCompactReviewStoresForAuthority`; the focused store/gate suite passed. | The guard uses the existing `RepositoryAuthorityV1` fields and introduces no persisted schema, path identity, or test-only switch. |
| Detached receipt evidence | Exception: this was an evidence-only regression for existing fail-closed behavior; no production change was warranted. | `node --experimental-strip-types --test tests/review-facade.test.ts` passed the new detached-receipt regression. | The test copies a valid receipt onto a different terminal state and proves a later START fails closed. |
| Candidate A after B | Exception: this was an evidence-only regression for existing read-only gate behavior; no production change was warranted. | `node --experimental-strip-types --test tests/review-compact-gate.test.ts` passed the new A-after-B byte-preservation and gate-validity regression. | The test restores A's exact target after B starts, validates A, and byte-compares A state/receipt. |

## Final Validation

- `node --experimental-strip-types --test tests/review-compact-store.test.ts` — RED observed: 2 passed, 1 failed before tuple guard.
- `node --experimental-strip-types --test tests/review-compact-store.test.ts tests/review-compact-gate.test.ts` — 16 passed after tuple guard.
- `node --experimental-strip-types --test tests/review-facade.test.ts` — 13 passed, including detached-receipt coverage.
- `node --experimental-strip-types --test tests/review-snapshot.test.ts tests/review-facade.test.ts tests/review-compact-store.test.ts tests/review-compact-gate.test.ts tests/review-controller.test.ts tests/review-repository.test.ts tests/sdd-status.test.ts tests/artifact-language.test.ts` — 134 passed.
- `git diff --check` — passed (no output).
- `pnpm test` — 554 tests plus runtime harness passed, exit 0.

## Parent Lifecycle Boundary

The parent/orchestrator owns native bounded review, receipt authority, lifecycle-gate validation, commit, push, PR, independent SDD verification, and archive. None was invoked here. All 41 implementation-owned tasks remain checked; the parent lifecycle prose in `tasks.md` remains intentionally unchecked-free and unchanged.

---

## Historical Continuations (superseded; not current status)

- **Initial partial implementation:** policy-bound terminal routing and typed missing-reset-state handling were recorded before all acceptance regressions existed.
- **Corrective continuation:** added ephemeral candidate binding, explicit terminal errors, controller applicability, and missing-reset-state retry coverage; the then-remaining terminal/lineage/worktree matrix was not current completion evidence.
- **Ownership-boundary continuation:** completed the SDD ownership/status/asset/chain work while Issue #118 acceptance rows were still recorded as remaining.
- **Issue #118 completion:** marked the remaining implementation rows complete, but the prior summary did not independently trace every checked requirement to a focused regression.

Those partial/0-of-21/25-of-41 status claims and provisional evidence are historical only. They do not describe current task accounting, blockers, or readiness. The authoritative current status is the 41/41 completion and acceptance matrix above.
