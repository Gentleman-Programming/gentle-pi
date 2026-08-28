# Review Runtime Specification

## Purpose

Define truthful, fail-closed review and lifecycle behavior against the released, package-provisioned Gentle AI contract.

## Requirements

### Requirement: Reviewers inspect the immutable candidate snapshot

The controller MUST provide every selected reviewer with a read-only, resolvable view of the frozen candidate identified by the review authority. Reviewer dispatch MUST fail closed before any actor starts when the snapshot cannot be resolved or its content identity cannot be verified. Reviewers MUST NOT fall back to the live working directory.

#### Scenario: Frozen content differs from the live worktree

- GIVEN a review snapshot has been frozen and the live worktree is subsequently changed
- WHEN a selected reviewer reads the candidate
- THEN the reviewer reads the frozen snapshot content and not the live worktree content

#### Scenario: Snapshot resolution fails

- GIVEN a selected reviewer has no resolvable controller-owned snapshot context
- WHEN dispatch is requested
- THEN dispatch is denied before actor execution and the failure identifies snapshot resolution or identity verification

### Requirement: START and FINALIZE use the same supported candidate projection

The supported review path MUST derive candidate identity and intended paths using the released runtime contract consistently across START and FINALIZE. A genuine candidate or path change MUST remain review-specific evidence, not delivery authority. No reset, direct object writing, store deletion, force option, or lifecycle bypass MAY be used as review recovery.

#### Scenario: Unchanged intended content is reviewed

- GIVEN a review is finalized for an intended candidate and its supported path set
- WHEN the same candidate, including supported staged initially-untracked content, is inspected for review
- THEN its projection remains consistent with the finalized review evidence
- AND any commit follows repository policy without Pi authorization

#### Scenario: Candidate content or paths changed

- GIVEN the review candidate or intended path set differs from the approved receipt
- WHEN review status runs
- THEN it reports the review mismatch, preserves existing authority, and requires a supported review recovery action

#### Scenario: Projection support is unavailable

- GIVEN the installed runtime does not expose a released projection/reconciliation contract required by review
- WHEN the operation would require a fabricated mirror, hash, tree, or envelope
- THEN the review operation fails closed and reports an upstream dependency instead of creating security-relevant data locally

### Requirement: Genuine candidate mismatches have honest diagnostics

The system MUST distinguish a real mismatch from a Pi-created projection mismatch. Mismatch diagnostics MAY expose only candidate, receipt, path, and diff data provided by the installed released validation contract. The system MUST NOT reconstruct authoritative trees, hashes, or path differences from private authority storage.

#### Scenario: Released runtime supplies comparison data

- GIVEN validation denies a genuine candidate or path mismatch
- WHEN the released runtime supplies comparison context
- THEN the response reports the denial code and the available expected/actual candidate and path-difference data

#### Scenario: Released runtime lacks path-diff support

- GIVEN validation denies a mismatch but the released runtime does not expose receipt/path-diff data
- WHEN diagnostics are produced
- THEN the response states that the data is unavailable and links or records the concrete upstream diagnostics dependency

### Requirement: FINALIZE input is publicly discoverable and schema-compatible

The public FINALIZE tool definition MUST document the nested `review_result.lens_results[]` shape, including `lens`, `findings`, and `evidence`; require results for every selected lens; document paired final evidence and `final_verification_passed`; and include a minimal valid no-correction example. Documentation MUST match the installed runtime and MUST distinguish the Pi wrapper contract from native CLI result-file inputs.

#### Scenario: Caller constructs a successful no-correction FINALIZE

- GIVEN all selected lenses produced result entries with findings and evidence
- WHEN the caller supplies the documented nested input with final evidence and `final_verification_passed: true`
- THEN FINALIZE accepts it and can produce an approved result without a correction

#### Scenario: Required lens or paired final data is missing

- GIVEN a FINALIZE input omits a selected lens result or supplies only one of final evidence and final verification status
- WHEN FINALIZE validates the input
- THEN it rejects the input with an actionable schema error and does not advance authority

### Requirement: Native and legacy policy identity remain distinct

The supported native ordinary START path MUST obtain policy identity only through the released native contract, including its documented policy path or internally derived identity. Production code and documentation MUST NOT invent, hard-code, or calculate a Pi-defined canonical policy hash. Legacy compact validation MAY remain supported only through its explicitly legacy contract.

#### Scenario: Native ordinary START is requested

- GIVEN the released native runtime provides the ordinary policy source
- WHEN native START is invoked
- THEN the controller delegates policy identity through that native source and exact retries bind the same policy identity

#### Scenario: No released policy source exists

- GIVEN a caller cannot obtain policy identity through the released native contract
- WHEN START would require an invented hash
- THEN START fails closed without creating authority

### Requirement: Pull-request delivery is outside review authority

Pi MUST NOT validate, resolve, or authorize pull-request delivery targets. Branch and owner-qualified `owner:branch` head semantics for a pull request remain repository-policy concerns; review evidence has no pull-request delivery effect.

#### Scenario: Pull request is requested

- GIVEN a configured remote and pull-request head
- WHEN pull-request delivery is requested
- THEN repository policy determines its resolution and execution
- AND Pi review evidence does not authorize or deny publication

### Requirement: Lifecycle discovery is filtered by candidate identity

Implicit lifecycle discovery MUST filter review authority by the live candidate identity before applying the zero/one/multiple-match invariant. Historical or unrelated worktrees MUST NOT contaminate discovery. Corrected candidates and staged initially-untracked candidates MUST remain discoverable, while multiple true matches MUST fail closed.

#### Scenario: Unrelated historical lineage exists

- GIVEN unrelated historical or escalated lineages share the Git common directory
- WHEN validation implicitly discovers authority for the current candidate
- THEN unrelated lineages are excluded and the matching current lineage is selected

#### Scenario: Multiple true candidate matches exist

- GIVEN two or more valid lineages match the current candidate identity
- WHEN implicit discovery runs
- THEN discovery fails closed and requires explicit disambiguation

### Requirement: Issue dispositions and evidence remain truthful

Release evidence MUST assign exactly one terminal work-unit disposition to each scoped issue (#96, #113, #119, #122, #123, #124, #128, #129, #133, #137). A disposition MUST cite focused tests, runtime/source evidence, a named root fix, or a real upstream tracker URL. Upstream-blocked issues MUST NOT be reported as fixed; valid authority MUST remain intact.

#### Scenario: Verification matrix is produced

- GIVEN implementation and runtime verification are complete
- WHEN the issue disposition matrix is recorded
- THEN every issue has one evidence-linked disposition and no unsupported closure claim

#### Scenario: Upstream contract is missing

- GIVEN projection/reconciliation or diagnostics behavior is not available in the released runtime
- WHEN the work unit is finalized
- THEN the issue remains truthfully upstream-blocked with a concrete tracker URL and no fabricated mirror or reset

### Requirement: Review evidence has no delivery authority

Candidate parity corrections MUST preserve receipt integrity and actor distrust while keeping review evidence separate from delivery. The implementation MUST NOT authorize, deny, wrap, inspect, or otherwise interpose on commit, push, PR, or release commands.

#### Scenario: Delivery command is attempted

- GIVEN a commit, push, PR, or release command is requested
- WHEN Pi review evidence exists or is absent
- THEN ordinary repository policy controls the command regardless of that evidence
