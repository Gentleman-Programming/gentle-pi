# Review Graph Specification

## Purpose

Define the authoritative, portable, recoverable, and fail-closed persistence contract for bounded review transactions while preserving existing review policy, lifecycle outcomes, and delivery boundaries.

## Requirements

### Requirement: Content-addressed predecessor closure

The system MUST represent authoritative history as immutable graph-v1 events whose canonical identity commits to event content, lineage identity, and predecessor identity. A genesis representation MUST be explicit. Every non-genesis event MUST have exactly one valid predecessor in the same lineage, and an authoritative head MUST reference a complete, acyclic, deterministically reducible closure.

#### Scenario: Deterministic event identity

- GIVEN two processes receive identical canonical event data and predecessor identity
- WHEN they compute the event identity
- THEN both identities are identical
- AND changing any canonical field or the predecessor identity produces a different identity

#### Scenario: Invalid graph is rejected

- GIVEN an event set containing a missing predecessor, cycle, wrong-lineage predecessor, conflicting content for an identity, invalid fork, or unreachable proposed head
- WHEN the set is validated
- THEN validation fails closed
- AND no authoritative head or index changes

#### Scenario: State reduction is independently verifiable

- GIVEN a valid genesis-to-head closure
- WHEN the system reduces the events
- THEN it produces deterministic transaction state and a state hash
- AND a mismatch between reduced state and recorded state hash is rejected

### Requirement: Exact Git common-directory authority

The system MUST resolve authoritative event objects, heads, indexes, journals, locks, reset state, and import/resume metadata beneath the exact Git common directory. Linked worktrees MUST resolve to the same authority and lock domain. Bare repositories and supported relocated worktrees MUST have deterministic resolution, while a non-Git context or unavailable common directory MUST fail closed rather than selecting worktree-local authority.

#### Scenario: Linked worktrees share authority

- GIVEN two linked worktrees of the same repository
- WHEN each resolves the review store and lock path
- THEN both resolve the same exact common-directory paths
- AND a mutation from one worktree is visible to the other through the authoritative graph

#### Scenario: Worktree-local state cannot authorize

- GIVEN a worktree-local cache or presentation copy that differs from common-directory authority
- WHEN a lifecycle mutation or gate checks review state
- THEN the local copy is ignored as authority
- AND the operation requires valid common-directory authority

### Requirement: Crash-safe locking and fail-closed ownership

Every authoritative mutation, reset, import, and recovery operation MUST hold an OS-backed lock with durable ownership metadata. The system MUST reject or serialize concurrent mutation and MUST fail closed when ownership or interrupted publication is ambiguous. Publication MUST expose either the prior valid authority or the next fully valid authority, never a partial authority.

#### Scenario: Concurrent writers serialize

- GIVEN two processes attempt authoritative mutation concurrently
- WHEN one process owns the lock
- THEN the other cannot mutate until the lock is validly released or safely recovered
- AND no authority state reflects an interleaving or partial publication

#### Scenario: Ambiguous ownership fails closed

- GIVEN lock metadata whose owner cannot be conclusively identified or whose recovery token does not match
- WHEN recovery is attempted
- THEN recovery is refused
- AND authoritative state and review budgets remain unchanged

#### Scenario: Crash publication recovers safely

- GIVEN a process crashes at a publication boundary
- WHEN the next process opens the store
- THEN it observes the previous valid authority or the next fully valid authority
- AND idempotent recovery does not consume review, refutation, validation, fix, or lifecycle budget

### Requirement: Legacy state is detected before authority use

The system MUST detect legacy review authority and authority-bearing legacy artifacts beneath the exact Git common-directory boundary before graph-v1 initialization and before every graph-v1 read, mutation, resume, import, receipt issuance, or gate validation. Detection MUST fail closed without silently initializing, selecting, translating, or treating either legacy or partially initialized graph-v1 state as authority.

#### Scenario: Legacy detection blocks operations

- GIVEN any legacy authority, receipt, approval, ledger, finding, frozen hash, lineage, journal, consumed counter, or gate evidence is present
- WHEN an authority-bearing graph-v1 operation starts
- THEN the operation is denied with target-specific diagnostics identifying the detected legacy state and required destructive reset
- AND no graph-v1 authority or gate result is created

#### Scenario: Detection is shared across worktrees

- GIVEN legacy state exists in the common-directory store and a linked worktree has no local copy
- WHEN the linked worktree starts an authority-bearing operation
- THEN legacy state is detected through the common directory
- AND the operation remains blocked

### Requirement: Explicit logical reset retires legacy authority

The system MUST provide an explicit logical reset that is never silent, implicit, startup-triggered, import-triggered, resume-triggered, or inferred from ambiguous confirmation. Confirmation MUST identify the exact repository/common-directory target. Reset MUST run under the authoritative mutation lock, durably publish a crash-safe reset marker, and create a new store epoch/incarnation that is the sole authority. Legacy bytes MUST remain inert audit evidence: reset MUST NOT recursively delete, quarantine, or traverse legacy paths, and MUST NOT translate, archive as active authority, retain as fallback authority, or preserve review credit.

#### Scenario: Reset requires deliberate confirmation

- GIVEN legacy state is detected
- WHEN an operator does not provide explicit confirmation bound to the exact target
- THEN reset does not run
- AND all legacy state and gates remain blocked and unchanged

#### Scenario: Successful reset establishes sole new authority

- GIVEN explicit target-bound destructive confirmation and an acquired mutation lock
- WHEN the reset marker and new store epoch/incarnation are durably published
- THEN the new empty graph-v1 store is initialized from genesis under that epoch
- AND legacy bytes remain untouched and are inert audit evidence only
- AND no legacy lineage, receipt, approval, ledger, finding, frozen hash, journal, counter, bundle, or gate evidence is usable
- AND no approval, receipt, or passing gate is created by reset

#### Scenario: Legacy paths are never recursively removed or traversed

- GIVEN legacy files or directories exist beneath the common-directory review store
- WHEN reset, initialization, recovery, import, or any graph-v1 operation runs
- THEN it does not recursively delete, quarantine, enumerate, or traverse those legacy paths
- AND only the authoritative marker and new epoch/incarnation namespace are examined or mutated

#### Scenario: Retired-byte writers cannot affect graph authority

- GIVEN an old writer modifies bytes in a retired legacy path after reset
- WHEN graph-v1 authority or a lifecycle gate is read
- THEN the current store epoch/incarnation and graph authority remain unchanged
- AND diagnostics MAY report drift or modification of retired audit evidence
- AND the old bytes do not become authority or invalidate the current graph

#### Scenario: Interrupted reset remains blocked and recoverable

- GIVEN reset is interrupted before the marker and new epoch/incarnation are durably committed
- WHEN any authority-bearing operation starts
- THEN it is denied with a detectable incomplete-reset diagnostic
- AND neither legacy data nor partial graph-v1 data is treated as authority
- AND explicit forward recovery MAY complete marker publication and initialize the new epoch without restoring legacy authority

#### Scenario: Retired receipts and bundles are denied

- GIVEN a receipt, bundle, gate, or other authority-bearing artifact belongs to a prior store epoch/incarnation
- WHEN it is presented to graph-v1 or a lifecycle gate
- THEN it is rejected as retired regardless of its bytes or apparent validity
- AND no authority, budget, or gate result changes

#### Scenario: Fresh review is required after reset

- GIVEN reset completed and the new graph-v1 store is empty
- WHEN a lifecycle or delivery gate evaluates a target
- THEN the gate denies until a completely fresh graph-v1 review from genesis issues a new approved receipt bound to the current epoch/incarnation and exact typed target

### Requirement: Validated atomic bundle transfer

The system MUST provide a versioned, deterministic, self-describing bundle containing declared roots, lineage metadata, required predecessor/object closure, and integrity data. Import MUST validate the complete staged bundle before changing authoritative indexes or heads, including schema/version, canonical encoding, identities, predecessor closure, lineage consistency, lifecycle invariants, declared-root completeness, and duplicate/conflict handling. Bundle integrity MUST NOT imply sender authenticity.

#### Scenario: Valid export and import

- GIVEN an authoritative graph and declared roots
- WHEN it is exported and imported into a compatible repository
- THEN imported roots and deterministically reduced transaction state match the export
- AND installation is atomic and idempotent

#### Scenario: Invalid bundle has no effect

- GIVEN a malformed, unsupported, incomplete, cyclic, wrong-lineage, conflicting, authority-forging, or legacy-containing bundle
- WHEN import validation runs
- THEN import is rejected before authoritative publication
- AND authoritative state, receipts, and budgets remain unchanged

#### Scenario: Duplicate objects are safe

- GIVEN an import contains an already-installed object with identical content
- WHEN import completes
- THEN the identical object is accepted without duplication
- AND an identity conflict is rejected without mutation

### Requirement: Resume preserves bounded work

The system MUST persist identity-bound progress sufficient to resume interrupted graph-v1 transaction mutation, recovery, export, and import without recreating a lineage, replaying completed actor work, changing frozen claims, or resetting consumed budgets. Ambiguous, conflicting, or tampered progress MUST fail closed.

#### Scenario: Interrupted review resumes

- GIVEN an interrupted graph-v1 transaction with completed actor work and persisted bounded consumption
- WHEN the same lineage resumes with matching tree bindings and frozen ledger hash
- THEN completed actors are not rerun
- AND actor, refuter, validator, and fix-round counts remain monotonic
- AND final verification is not duplicated

#### Scenario: Invalid checkpoint cannot reset work

- GIVEN resume progress with mismatched inputs, altered claims, conflicting identities, or impossible counters
- WHEN resume is attempted
- THEN it fails closed
- AND it does not create a replacement lineage or restore any budget

### Requirement: Mirrors are non-authoritative

The system MUST represent mirrors through authority-distinct types or capabilities. Mirrors MAY cache, inspect, replicate, or transport verified graph-v1 objects and report declared-root freshness/completeness, but MUST NOT advance heads, authorize transitions, fixes, approvals, escalations, receipts, gates, delivery, or publication. Promotion MUST use the locked authoritative import validation path.

#### Scenario: Mirror cannot pass a gate

- GIVEN a mirror contains a seemingly approved receipt or complete graph
- WHEN a commit, push, PR, release, or publication gate evaluates it
- THEN the gate rejects mirror-only authority
- AND performs no review actor invocation

#### Scenario: Verified mirror promotion

- GIVEN mirror objects are promoted through authoritative import
- WHEN closure, identities, lifecycle state, and locks validate successfully
- THEN only the resulting authoritative graph may support a gate
- AND the mirror remains non-authoritative

### Requirement: Lifecycle receipts and gates remain bounded

Authoritative graph validation MUST preserve the existing bounded review contract: frozen claims are immutable and hash-bound, actor output is untrusted, budgets are monotonic across retry/resume/import/restart, ordinary review ends only as approved or escalated, Judgment Day remains explicitly distinct, no-fix paths run no validator, fix paths use only the permitted scoped validator, and final verification occurs exactly once per ordinary lineage. Lifecycle gates MUST validate an approved authoritative graph-v1 receipt against the exact typed target with zero review actors. Review execution MUST NOT commit, push, create PRs, release, or publish.

#### Scenario: Receipt and gate validation

- GIVEN an approved authoritative graph-v1 receipt bound to an exact typed target
- WHEN a lifecycle gate validates it
- THEN the gate succeeds only if graph closure, receipt, lineage, and target all match
- AND no review actor is launched

#### Scenario: Terminal state is closed

- GIVEN an imported or resumed terminal approved or escalated lineage
- WHEN a mutation attempts to reopen, alter frozen claims, or consume additional bounded work
- THEN the mutation is rejected

#### Scenario: Judgment Day is not implicit

- GIVEN an ordinary lineage is resumed or imported
- WHEN processing continues
- THEN Judgment Day is neither appended nor substituted unless explicitly selected as its distinct lineage

### Requirement: Cross-platform guarantees are explicit

The system MUST define and test supported filesystem and operating-system behavior for path resolution, atomic publication, durable locking, reset, and recovery. Where required primitives or semantics cannot establish the stated authority and crash-safety guarantees, the system MUST fail closed rather than claim portability.

#### Scenario: Supported platform behavior

- GIVEN a supported platform and filesystem with required directory, rename, sync, and exclusive-lock semantics
- WHEN graph mutation, recovery, reset, export, or import runs
- THEN the specified authority and atomicity guarantees hold

#### Scenario: Unsupported primitive fails closed

- GIVEN a platform or filesystem where required authority, lock, or durability guarantees cannot be established
- WHEN an authoritative operation starts
- THEN it is rejected deterministically
- AND no authoritative state or budget changes

## Acceptance Criteria

- Graph-v1 event identities and predecessor closure are deterministic, immutable, complete, and reducible.
- Linked worktrees share exact common-directory authority and lock paths; local mirrors cannot authorize.
- Lock recovery and interrupted publication fail closed or expose only a valid old/new authority.
- Legacy detection blocks every authority-bearing operation before initialization or use and reports the required target-bound reset.
- Reset never runs silently; it durably retires legacy authority under a new store epoch/incarnation, preserves legacy bytes as inert audit evidence without recursively deleting or traversing legacy paths, initializes empty graph-v1, and creates no approval or gate evidence.
- Interrupted reset remains detectably blocked and explicitly recoverable without treating either format as authority.
- No gate passes until a fresh post-reset graph-v1 review issues a new approved receipt for the exact typed target.
- Export/import validates closure and lifecycle invariants before atomic, idempotent installation; resume preserves identities, claims, receipts, and budgets.
- Mirror-only data cannot satisfy lifecycle or delivery gates.
- No signing, network transport, distributed consensus, automatic conflict merging, or review-policy expansion is required.
