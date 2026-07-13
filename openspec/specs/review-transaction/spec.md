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

Ordinary MUST run selected 0/1/4 lenses once, controller-check deterministic evidence, permit one inferential refuter batch with independent concrete proof, escalate insufficient or malformed evidence, and permit up to three failed targeted attempts under one original cumulative changed-line budget without rerunning initial lenses or refutation.

#### Scenario: Bounded ordinary work

- GIVEN any finding count
- WHEN ordinary runs
- THEN review and refutation are one-shot while correction attempts are capped at three and share the frozen cumulative budget

### Requirement: Terminal scoped validation

The authoritative ledger MUST retain immutable canonical ID-sorted identity/claim/evidence rows bound by its hash. Each correction attempt receives the same requested IDs and frozen scope, records its forecast, Git-derived actual changed lines, snapshot, and targeted validation checks, then advances only when original criteria and correction regression both pass. Failed targeted validation MAY return to `correction_required` until the third failed attempt, provided cumulative actual lines plus the next forecast remain within the original budget. Attempts MUST NOT alter claims, add work, launch discovery actors, or rerun initial lenses. No-fix runs no validator; a passing correction runs one final verification to `approved | escalated`.

#### Scenario: Fixed candidate

- GIVEN a correction attempt passes targeted validation
- WHEN advancing
- THEN one final verification MUST run without rerunning initial review

#### Scenario: Unfixed or failed candidate

- GIVEN no fix, a failed targeted validation with remaining budget, or exhausted correction/final verification
- WHEN reduced
- THEN no-fix uses zero validators, bounded validation failure permits another attempt, and exhaustion or final-verification failure escalates

### Requirement: Explicit Judgment Day replacement

Explicit Judgment Day replaces ordinary, uses two blind judges, zero refuters, and at most two rounds.

#### Scenario: Round exhaustion

- GIVEN findings survive round two
- WHEN evaluated
- THEN no third round runs and the transaction escalates

### Requirement: Receipt-only boundaries

PR #1216 introduced the v2.1.1 `<remote>/<branch>` selector contract that v2.1.2 inherits unchanged.

Gates MUST accept only typed exact targets: intended commit tree; ordered push ref updates; PR base/head ref/commit/tree; or release tag/object/commit/tree. Native pre-push to an existing branch MUST require the effective push URL and repository identity to equal the fetch URL and identity used by the exact `<remote>/<branch>` selector, bind command remote, destination ref, old/new objects, selector, and advertised commit in one fingerprint, and rederive that fingerprint at bash time. Split fetch/push pre-push is an upstream contract limitation because v2.1.1 resolves `<remote>/<branch>` through fetch-side remote-tracking state; probing `pushurl` MUST NOT be treated as changing selector resolution, and this topology MUST fail closed before native validation with a typed unsupported next action. Native pre-PR MUST preserve fetch-side repository/base/head query semantics, MAY continue using advertised remote selectors, MUST bind the target repository selected by `--repo`, then `GH_REPO`, then unambiguous local inference, plus the exact advertised remote head commit equal to reviewed local HEAD, and MUST rederive the full publication target after each native allow before registering or consuming authorization. Native first-push authorization remains unsupported until a separate follow-up adds a persisted explicit advertised-base source; a missing destination MUST fail closed without upstream, default-branch, or nearest-ancestor inference. An authorizing allow response MUST return the exact requested gate and, for pre-PR, the exact `pre_pr_boundary`. A non-authorizing denial MAY return an empty gate and no `pre_pr_boundary`; any non-empty returned gate MUST equal the requested gate, its structured result/action/reason MUST be preserved, and no denial can register authorization. Network publication probes MUST use fixed argv without a shell, short time/output bounds, and available cancellation. Complete publication/native revalidation MUST use one aggregate bash-time deadline combined safely with any Pi cancellation signal. Every identity MUST resolve and match receipt base/final semantics; otherwise fail closed. Journaled results bind target hash and launch zero actors. SDD adds no review; transactions deliver nothing.

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
