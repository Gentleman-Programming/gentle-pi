# Delta for Review Transaction

## ADDED Requirements

### Requirement: Safe native result admission

Pi MUST admit only provider-issued `gentle-ai.review-result-artifact/v2` manifests whose lineage, target, authority revision, repository context, subject hash, lens, and ordered slot exactly match fresh STATUS. Admission diagnostics MUST be restricted to the negotiated allowlist `invalid_finding_location` and `candidate_causality_unproven`, with bounded finding IDs, repository-relative locations, and bounded reasons. Pi MUST preserve opaque provider failures and MUST NOT expose raw native prose, private paths, candidate contents, or rejected payloads.

#### Scenario: Exact artifact binding

- GIVEN a result manifest with an exact STATUS binding and valid schema
- WHEN the transaction admits the result
- THEN the manifest is forwarded losslessly and no local provider authority is reconstructed

#### Scenario: Safe diagnostic allowlist

- GIVEN a native admission failure containing one allowlisted diagnostic with bounded fields
- WHEN the diagnostic is decoded
- THEN Pi exposes only the safe typed fields and retains the native failure outcome

#### Scenario: Unsafe diagnostic

- GIVEN an unknown code, malformed fields, absolute/private location, control characters, or raw prose
- WHEN admission diagnostics are decoded
- THEN the diagnostic is rejected and the transaction remains fail-closed without a retry instruction

### Requirement: Lost-output capture reconciliation

When capture output is lost or unknown, Pi MUST query target-scoped fresh STATUS before selecting any action. If STATUS proves the exact capture committed, Pi MUST continue without another capture. Otherwise Pi MUST follow only the provider-declared action, MUST NOT replay rejected bytes, and MUST preserve the exact failure and status evidence.

#### Scenario: Committed capture recovery

- GIVEN the transport result is unknown
- WHEN fresh STATUS proves the matching capture record exists
- THEN the result is treated as committed and the lens is not rerun

#### Scenario: No committed capture

- GIVEN the transport result is unknown and STATUS does not prove commitment
- WHEN reconciliation completes
- THEN no generic replay is emitted and only the provider-declared bounded recovery or terminal action is returned

### Requirement: RDD-disabled delivery boundary

When RDD is globally and effectively `off`, Pi MUST NOT start, recover, retry, reset, or reclaim RDD authority. Delivery evidence MUST remain `disabled/unmanaged`; Pi MUST NOT fabricate a receipt, approval, or review obligation.

#### Scenario: Disabled review mode

- GIVEN read-only mode status reports global/effective `off`
- WHEN parity verification and delivery evidence are produced
- THEN no RDD mutation occurs and the evidence reports `disabled/unmanaged`

## MODIFIED Requirements

### Requirement: One-shot ordinary transaction

Ordinary MUST run selected 0/1/4 initial lenses once, controller-check deterministic evidence, permit one inferential refuter batch with independent concrete proof, escalate insufficient or malformed evidence, and permit one correction transaction under the original changed-line budget without rerunning initial lenses or refutation. A separate status-mediated admission recovery MAY relaunch one exact slot to produce a newly authored result; it MUST NOT rerun other lenses or refutation, expand scope, or consume the ordinary correction budget.
(Previously: one-shot ordinary work had no Pi-side result-capture recovery exception.)

#### Scenario: Bounded ordinary work

- GIVEN any finding count
- WHEN ordinary runs
- THEN initial review, refutation, correction, and any admission recovery remain bounded, with at most one exact-slot relaunch and no ordinary scope expansion

## Acceptance Criteria

Every scenario MUST be covered by strict-TDD tests that fail before implementation and pass in `pnpm test`; tests MUST prove exact native bindings and fail-closed behavior.
