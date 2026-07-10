# Review Transaction Specification

## Purpose

Review authority.

## Requirements

### Requirement: Complete immutable snapshot

`SnapshotV1` MUST persist `base_tree`, full `complete_snapshot_tree`, exact `review_projection` (`complete` or resolved `intended-commit`), `initial_review_tree`, route, ordered lenses, and policy hash without index/worktree mutation. Unsupported projections fail closed.

#### Scenario: Mixed working state

- GIVEN supported changes and ignored paths
- WHEN a transaction snapshot is created
- THEN complete content and projected review tree MUST be exact while the real index remains unchanged

### Requirement: Atomic lineage and receipt authority

Each mutation MUST atomically append `{operation, idempotency_key, request_hash, status, authorization?, canonical_result?}` to the persisted journal. Exact key+request replay returns its stored result across revisions/restarts; mismatch or unresolved pending work fails closed. `ReceiptEnvelopeV1` holds body plus `SHA-256(canonical(body))`; the body excludes the hash and binds lineage/mode, base/complete trees, exact `review_projection`, initial/final trees, route/lenses/policy, ledger/evidence hashes, budget/counters, and terminal state. Write/integrity failure preserves prior authority.

#### Scenario: Failed or tampered state

- GIVEN write, hash, or state/receipt inconsistency
- WHEN authority is checked
- THEN detectable corruption MUST fail closed

#### Scenario: Genuine scope change

- GIVEN a parent receipt and changed target tree
- WHEN review is requested
- THEN parent+target MUST identify one claimed child whose explicit fresh budget is created once

#### Scenario: Logical controller authority

- GIVEN same-user actors return data
- WHEN authority is checked
- THEN only controller APIs MAY authorize; local files are not claimed tamper-proof

### Requirement: Mode-isolated reducers

Separate reducers MUST keep mode/budget immutable, counters monotonic, and Judgment Day unreachable from ordinary.

#### Scenario: Cross-mode request

- GIVEN an ordinary lineage
- WHEN a Judgment Day operation is requested
- THEN rejection MUST preserve state/counters

### Requirement: One-shot ordinary transaction

Ordinary MUST run selected 0/1/4 lenses once, controller-check deterministic evidence, permit one inferential refuter batch, escalate insufficient evidence, and permit one fix batch.

#### Scenario: Bounded ordinary work

- GIVEN any finding count
- WHEN ordinary runs
- THEN review is once and refuter/fix batches are at most one each

### Requirement: Terminal scoped validation

The authoritative ledger MUST retain immutable canonical ID-sorted identity/claim/evidence rows bound by its hash. After fixes, one validator receives requested IDs, their exact rows, and the fix diff; resolutions remain separate. It MUST NOT alter claims, add work, launch actors, or repeat. No-fix runs no validator; both paths run one final verification to `approved | escalated`.

#### Scenario: Fixed candidate

- GIVEN fixes complete
- WHEN advancing
- THEN one validator and one final verification MUST run without new work

#### Scenario: Unfixed or failed candidate

- GIVEN no fix or failed validation/verification
- WHEN reduced
- THEN no-fix uses zero validators and failure escalates

### Requirement: Explicit Judgment Day replacement

Explicit Judgment Day replaces ordinary, uses two blind judges, zero refuters, and at most two rounds.

#### Scenario: Round exhaustion

- GIVEN findings survive round two
- WHEN evaluated
- THEN no third round runs and the transaction escalates

### Requirement: Receipt-only boundaries

Gates MUST accept only typed exact targets: intended commit tree; ordered push ref updates; PR base/head ref/commit/tree; or release tag/object/commit/tree. Every identity MUST resolve and match receipt base/final semantics; otherwise fail closed. Journaled results bind target hash and launch zero actors. SDD adds no review; transactions deliver nothing.

#### Scenario: Unchanged target

- GIVEN an approved receipt and resolved target
- WHEN validated
- THEN matching base/final semantics allow with zero actors

#### Scenario: Incident after approval

- GIVEN a post-approval incident
- WHEN recovery starts
- THEN the lineage remains closed and performs no delivery

## Acceptance Criteria

Tests MUST cover every binding, replay/budget, integrity, exact-gate, reducer, and forbidden-transition invariant.
