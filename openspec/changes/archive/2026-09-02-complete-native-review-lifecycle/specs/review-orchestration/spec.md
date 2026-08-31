# Delta for Review Orchestration

## ADDED Requirements

### Requirement: Non-blocking follow-up observations

After ledger freeze, orchestration MUST record later observations in targeted validation evidence as inert follow-ups. Follow-ups MUST NOT expand paths, alter frozen IDs/claims, schedule work, block approval/delivery, or require a transition. Ordinary MUST NOT define `ordinary-follow-up`.

#### Scenario: Later observation

- GIVEN the blocking ledger is frozen
- WHEN a later observation is recorded
- THEN it MUST be stored as an inert follow-up and schedule no work or transition

#### Scenario: Follow-up attempts escalation

- GIVEN a non-blocking follow-up
- WHEN it requests a new finding, path, or correction
- THEN orchestration MUST reject the request and preserve the frozen lifecycle

## ADDED Requirements

### Requirement: Ordinary review-surface cleanup

Ordinary agent contracts, assertions, and fixtures MUST remove all language, assertions, and fixtures that authorize correction-touched-line review, correction-diff discovery, or another ordinary review pass. Tests MUST assert the targeted-proof boundary. Published-version migration fixtures with a live forced-sync consumer MUST remain out of scope.

#### Scenario: Forbidden ordinary review surface

- GIVEN ordinary agent, contract, and test surfaces
- WHEN cleanup is verified
- THEN none MUST authorize correction-line review, discovery, or re-review

#### Scenario: Live forced-sync migration fixture

- GIVEN a published-version migration fixture has a live forced-sync consumer
- WHEN ordinary cleanup is applied
- THEN it MUST remain unchanged

## MODIFIED Requirements

### Requirement: Precision-gated ledger

Ordinary MUST run 0/1/4 lenses in one discovery operation against `initial_review_tree`. Before corroboration, the authoritative store MUST freeze canonical ID-sorted rows containing immutable identity, claim, and evidence fields and bind them by `frozen_ledger_hash`; only accepted blocking IDs MAY enter correction. `refuted` remains terminal; WARNING/SUGGESTION is one-time `info`. Summaries, actor output, and later follow-ups are inert; only controller APIs MAY authorize, and store-integrity mismatch fails closed.
(Previously: post-freeze observations were not explicitly classified as non-blocking follow-ups.)

#### Scenario: Precision limits

- GIVEN an ordinary 0/1/4 route
- WHEN discovery runs
- THEN each lens runs once and speculation is rejected

#### Scenario: Frozen terminal rows

- GIVEN frozen canonical rows or later follow-ups
- WHEN orchestration runs
- THEN claims/evidence stay immutable and terminal, info, and follow-up records schedule nothing

#### Scenario: Authoritative persistence

- GIVEN summary/store disagreement
- WHEN authority is checked
- THEN the store prevails or integrity failure closes the gate

### Requirement: Bounded convergence and Judgment Day

Ordinary MAY authorize one correction batch only for exact accepted blocking IDs and immutable genesis paths. After correction, one validator MUST consume original acceptance-test evidence and exact per-frozen-ID correction regression proof. It MUST NOT review correction-touched lines, inspect the correction diff for new findings, run scoped ordinary re-review, alter claims, add work, launch actors, repeat, or discover. No-correction uses zero validators. Final verification ends `approved | escalated`; original-criterion regression MUST reject, revert, or escalate. Explicit Judgment Day replaces ordinary, uses two blind judges/zero refuters, and alone permits two rounds.
(Previously: ordinary validation could detect correction-line regressions and receive correction-diff review material.)

#### Scenario: Fix path

- GIVEN one exact ordinary correction completes
- WHEN advancing
- THEN one non-discovery validator and one final verification run using original acceptance-test evidence and exact per-frozen-ID correction regression proof

#### Scenario: No-fix or failure

- GIVEN no correction or failed validation, verification, or original criterion
- WHEN reduced
- THEN no-correction has zero validators and failure MUST reject, revert, or escalate

#### Scenario: Judgment Day

- GIVEN explicit Judgment Day
- WHEN review runs
- THEN two blind judges and zero refuters run

#### Scenario: Judgment Day limit

- GIVEN findings survive round two
- WHEN evaluated
- THEN no third round runs and the transaction escalates

## Acceptance Criteria

- Automated tests MUST prove follow-ups are inert validation evidence that schedules no work or transition.
- Automated tests MUST prove ordinary surfaces prohibit fix-line review and re-review, while targeted validation preserves graph-v1, retry, resume, gate, bundle, and Judgment Day semantics.
