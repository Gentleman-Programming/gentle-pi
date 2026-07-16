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

### Requirement: Negotiated native ordinary authority

The consumer MUST resolve the integrity-verified package-local Gentle AI v2.1.6 executable, independently hash it, negotiate `gentle-ai.review-integration/v1` outside repository context, and cache capabilities only by that digest. START, target status, FINALIZE, validation, and SDD binding MUST pass the same contract identifier. Native compact-v2 MUST be the sole mutable ordinary authority; legacy-v1 and Pi authority remain compatibility-read-only. Unknown mandatory behavior, incompatible protocol/schema identity, or executable drift MUST fail closed, while advertised optional additions MAY be ignored without disabling mandatory operations.

#### Scenario: Target-scoped restart

- GIVEN a fresh Pi process and existing native authority
- WHEN target status returns a Git/content projection
- THEN Pi reconstructs only its derived candidate view without reading provider-private authority files or selecting a lineage

#### Scenario: Native failure truth

- GIVEN a negotiated mutating operation fails or loses output
- WHEN Pi reconciles an unknown result
- THEN Pi calls target-scoped native status first, preserves the exact failure and status evidence, follows only the provider-declared action, and replays only when native declares the exact request safe

### Requirement: Mode-isolated reducers

Separate reducers MUST keep mode/budget immutable, counters monotonic, and Judgment Day unreachable from ordinary.

#### Scenario: Cross-mode request

- GIVEN an ordinary lineage
- WHEN a Judgment Day operation is requested
- THEN rejection MUST preserve state/counters

### Requirement: One-shot ordinary transaction

Ordinary MUST run selected 0/1/4 lenses once, controller-check deterministic evidence, permit one inferential refuter batch with independent concrete proof, escalate insufficient or malformed evidence, and permit one correction transaction under the original changed-line budget without rerunning initial lenses or refutation.

#### Scenario: Bounded ordinary work

- GIVEN any finding count
- WHEN ordinary runs
- THEN review, refutation, and correction are each one-shot within the frozen budget

### Requirement: Terminal scoped validation

The authoritative ledger MUST retain immutable canonical ID-sorted identity/claim/evidence rows bound by its hash. The correction receives the requested IDs and frozen scope, records its forecast, Git-derived actual changed lines, snapshot, and targeted validation checks, then advances only when original criteria and correction regression both pass. Failed targeted validation MUST escalate and MUST NOT return to `correction_required`. The correction MUST NOT alter claims, add work, launch discovery actors, or rerun initial lenses. No-fix runs no validator; a passing correction runs one final verification to `approved | escalated`.

#### Scenario: Fixed candidate

- GIVEN a correction attempt passes targeted validation
- WHEN advancing
- THEN one final verification MUST run without rerunning initial review

#### Scenario: Unfixed or failed candidate

- GIVEN no fix, a failed targeted validation, or exhausted correction/final verification
- WHEN reduced
- THEN no-fix uses zero validators and every validation, budget, or final-verification failure escalates without another attempt

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

### Requirement: Durable pre-commit transaction

An authorized direct `git commit` MUST be replaced by one package-owned Git-common-dir transaction. It MUST bind command intent, repository/worktree identity, original HEAD/index, lineage, and recovery state; execute the effective pre-commit hook once; derive and natively validate the exact post-hook tree; preserve applicable message/post hooks through proxies without rerunning pre-commit; and prove the resulting `HEAD^{tree}` equals native authorization. Hook/validation/commit failure or interruption MUST create no silently publishable result, MUST NOT reset Git content automatically, and MUST block push, PR, and release until deterministic reconciliation or explicit safe abandonment. Amend, signing arguments, cancellation, stale locks, and exact post-hook retry MUST remain bound to the same transaction.

#### Scenario: Mutating pre-commit hook

- GIVEN a reviewed staged tree and a hook that formats and stages content
- WHEN direct commit runs
- THEN the hook runs once, native validation evaluates the formatted tree, and scope change creates no commit until that tree is reviewed; exact retry skips the completed hook

#### Scenario: Commit proof or crash

- GIVEN native allowed the post-hook tree
- WHEN Git returns or the runner restarts after an uncertain boundary
- THEN the transaction proves or reconciles `HEAD^{tree}` against that tree, and any mismatch remains a publication-blocking incident

## Acceptance Criteria

Tests MUST cover every binding, replay/budget, integrity, exact-gate, reducer, and forbidden-transition invariant.
