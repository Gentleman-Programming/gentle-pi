# SDD Status Specification

## Purpose

Define read-only OpenSpec readiness from an approved native ordinary review binding.

## Requirements

### Requirement: CAS-bound native SDD association

An approved native lineage MAY be associated with exactly one repository identity, OpenSpec change identity, OpenSpec path, lineage/receipt identity, and binding revision through native `bind-sdd`. The native bind request MUST contain only canonical cwd, change, lineage, and expected binding revision. Repository, authority, receipt, and path identities are result-only evidence owned and validated by native bind. Pi MUST not copy, reconstruct, cache, or duplicate authority.

#### Scenario: Request precondition mismatch or malformed input

- GIVEN canonical cwd, change, lineage, or expected binding revision is malformed or mismatched
- WHEN Pi prepares a bind request
- THEN Pi MUST reject it before invoking native bind and MUST make zero native calls

#### Scenario: First approved bind

- GIVEN one approved native lineage and no existing binding revision
- WHEN Pi binds the exact change using canonical cwd, change, lineage, and an empty expected revision
- THEN native bind MUST own validation of the approved lineage, repository, and receipt and MUST return the resulting binding revision and identity evidence

#### Scenario: Exact replay with observed revision

- GIVEN a previously committed identical binding and its observed binding revision
- WHEN Pi retries the exact bind request with that revision
- THEN native bind MUST return the existing semantic binding idempotently without creating a duplicate association

#### Scenario: Stale CAS or native rejection

- GIVEN the stored binding revision differs from the supplied expected revision, or native rejects the approved lineage, repository, or receipt
- WHEN Pi invokes bind
- THEN the operation MUST remain failed/blocked with no Pi readiness and MUST not copy, replace, fabricate, or infer a binding

#### Scenario: Committed-or-ambiguous result identity mismatch

- GIVEN native bind exits zero but its result is malformed or its echoed repository, path, lineage, receipt, or change identity is inconsistent
- WHEN Pi decodes the result
- THEN Pi MUST block with no authorization or readiness, MUST treat the operation as committed or ambiguous, MUST not claim zero native mutation or automatically retry with different semantics, and MUST require exact replay or supported recovery

### Requirement: Readiness from revalidated binding

SDD status MUST consume native binding read-only and report readiness only after reloading both the native authority and binding revisions, confirming the exact OpenSpec identity/path, and revalidating approved native receipt/live-gate evidence. Task completion, local artifacts, actor output, or discovery alone MUST NOT establish readiness.

#### Scenario: Ready approved change

- GIVEN an exact binding and a revalidated approved native receipt for the current candidate
- WHEN SDD status runs
- THEN it MUST report ready through the existing status contract without mutating authority or starting another review

#### Scenario: Missing or stale binding

- GIVEN no binding exists or the binding revision is stale
- WHEN SDD status runs
- THEN it MUST report blocked/non-ready and MUST NOT infer approval

#### Scenario: Authority or binding changes during status

- GIVEN either native authority or binding changes between initial load and final decision
- WHEN SDD status reloads and rederives the live target
- THEN it MUST fail closed rather than report readiness

### Requirement: SDD does not duplicate review authority

SDD operations MUST neither create a review, copy native records into Pi storage, nor duplicate an existing native lifecycle operation. SDD completion MUST add no review or Judgment Day pass.

#### Scenario: Status without duplicate lifecycle

- GIVEN a native lineage is already approved or terminal
- WHEN SDD status or archive readiness is requested
- THEN it MUST consume evidence read-only and MUST not start or finalize another review
