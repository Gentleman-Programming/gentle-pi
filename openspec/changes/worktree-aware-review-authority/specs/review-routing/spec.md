# Delta for Review Routing

## ADDED Requirements

### Requirement: Candidate-aware terminal applicability

Controller INSPECT/status and START routing MUST derive the requested `cwd`'s live candidate before deciding whether shared terminal compact authority applies. A shared terminal receipt MAY be reused or reported as applicable only when the requested candidate matches the receipt's complete existing binding: repository identity, base tree, candidate/complete content tree, changed paths, intended-untracked paths, and policy binding. Worktree directory identity MUST NOT be part of this comparison.

#### Scenario: Identical candidate from a linked worktree

- GIVEN a terminal compact receipt exists in the shared Git common directory
- AND a request from another linked-worktree `cwd` has identical repository, base tree, candidate tree, changed paths, intended-untracked paths, and policy binding
- WHEN controller INSPECT or START routing runs
- THEN the existing terminal authority MUST remain applicable
- AND the existing receipt MUST be reusable and gate-validatable

#### Scenario: Worktree path differs only

- GIVEN two linked worktrees have the same complete candidate binding
- WHEN the request is routed from the second worktree
- THEN the path difference alone MUST neither create a lineage nor prevent receipt reuse

### Requirement: Material candidate differences route to fresh lineage

When any material value in the complete candidate binding differs, controller routing MUST NOT select an unrelated shared terminal lineage as a blocker. The request MUST reach the existing compact START fresh-lineage behavior. Starting that candidate MUST NOT mutate, invalidate, supersede, delete, or fork the prior terminal receipt.

#### Scenario: Different candidate reaches START

- GIVEN a shared terminal receipt exists for candidate A
- AND candidate B differs in repository identity, base tree, candidate tree, changed paths, intended-untracked paths, or policy
- WHEN candidate B is requested through controller START
- THEN candidate A's terminal lineage MUST NOT block candidate B solely because the Git common directory is shared
- AND candidate B MUST be routed to fresh compact START behavior
- AND candidate A's receipt MUST remain unchanged and gate-validatable

## MODIFIED Requirements

### Requirement: Non-blocking safety composition

All lifecycle gates MUST use `GateTargetV1` and receipts only. PR targets bind base/head refs, commits, and trees; release targets bind tag ref/object, peeled commit, and commit tree. Every identity MUST resolve. Target hash and result MUST be journaled. Post-apply MAY explicitly start ordinary without a receipt, never Judgment Day. Dangerous-command confirmation remains authoritative. Controller candidate-aware routing MUST specialize only terminal compact applicability; graph-v1, legacy, mixed, ambiguous, and reset-in-progress authority inspection MUST remain authoritative and fail closed.
(Previously: routing/validation used receipt-only safety composition without candidate-aware shared-terminal applicability or the stated compatibility boundary.)

#### Scenario: Legacy or ambiguous shared authority

- GIVEN graph-v1, legacy, mixed, or ambiguous authority is discovered
- AND the requested live candidate is available or differs from a terminal candidate
- WHEN controller INSPECT or START routing runs
- THEN existing compatibility safety rules MUST remain in force
- AND candidate-aware routing MUST NOT bypass, migrate, or weaken the fail-closed result

#### Scenario: Reset-in-progress authority

- GIVEN authority is reset-in-progress
- WHEN controller routing runs for any candidate
- THEN existing reset authorization and recovery rules MUST remain authoritative
- AND candidate-aware routing MUST NOT infer authorization or route around recovery

### Requirement: Exact same-lineage idempotency

Explicit same-lineage requests and exact replays of the same candidate binding MUST retain current blocking/replay behavior. Replaying an identical request MUST NOT create a duplicate lineage or mutate its receipt.
(Previously: idempotency was required for journaled routing operations but not explicitly for candidate-aware controller reuse.)

#### Scenario: Replayed identical candidate

- GIVEN a terminal lineage and receipt exist for a candidate binding
- WHEN the same candidate request is replayed with the same explicit lineage or request identity
- THEN the controller MUST return the existing deterministic result
- AND MUST NOT create another lineage
- AND MUST NOT mutate the receipt

## Acceptance Criteria

All scenarios MUST pass automated regression tests, including linked-worktree routing, each material binding dimension, receipt preservation, idempotency, and compatibility safety cases.
