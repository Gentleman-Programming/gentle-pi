# Review Correction Lifecycle Specification

## Purpose

Govern the evidence-first correction lifecycle for the one bounded correction transaction an ordinary review permits: how candidate-bound verification evidence is captured, its closed outcome domain, and the three terminal branches that follow.

## Requirements

### Requirement: Evidence-first capture ordering

STATUS MUST collect candidate-bound verification evidence via `review capture-evidence` before `targeted_validation` becomes available. `targeted_validation` MUST NOT run against a correction attempt that has not yet recorded evidence.

#### Scenario: Evidence precedes validation

- GIVEN a correction transaction after a bounded edit
- WHEN STATUS is polled
- THEN candidate-bound verification evidence MUST be captured before `targeted_validation` is offered

### Requirement: Closed outcome domain

`review capture-evidence --outcome` MUST accept exactly one of `passed`, `verification_failed`, or `procedural_tooling_failed`. Any other value MUST be rejected without effect.

#### Scenario: Outside-domain outcome rejected

- GIVEN an `--outcome` value outside the closed domain
- WHEN `capture-evidence` runs
- THEN the request is rejected and no budget, attempt, or transaction state changes

### Requirement: Three terminal branches

Only `passed` unlocks `targeted_validation`. `verification_failed` MUST leave the correction transaction OPEN: no attempt, changed-line charge, or budget is consumed, and a subsequently changed candidate MUST be captured into a distinct immutable evidence directory without replacing the failed bytes. `procedural_tooling_failed` MUST execute a terminal escalation before any retry becomes eligible.

#### Scenario: Passed unlocks validation

- GIVEN evidence recorded with outcome `passed`
- WHEN STATUS advances
- THEN `targeted_validation` becomes available and only then

#### Scenario: Verification failed keeps the transaction open

- GIVEN evidence recorded with outcome `verification_failed`
- WHEN the contributor changes the candidate and resubmits
- THEN the correction transaction remains OPEN, no attempt/changed-line/budget is charged, and the new evidence lands in a distinct immutable directory alongside the failed one, not replacing it

#### Scenario: Procedural tooling failure escalates

- GIVEN evidence recorded with outcome `procedural_tooling_failed`
- WHEN STATUS reconciles the result
- THEN a terminal escalation executes before any retry becomes eligible

## Acceptance Criteria

Tests MUST cover evidence-before-validation ordering, outcome-domain rejection, and all three terminal branches, including the distinct-evidence-directory invariant on `verification_failed`.
