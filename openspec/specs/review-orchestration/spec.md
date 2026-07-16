# Review Orchestration Specification

## Purpose

Define bounded review orchestration.

## Requirements

### Requirement: Precision-gated ledger

Ordinary MUST run 0/1/4 lenses once against `initial_review_tree`. Before corroboration, the authoritative store MUST freeze canonical ID-sorted rows containing immutable identity, claim, and evidence fields and bind them by `frozen_ledger_hash`. `refuted` remains terminal; WARNING/SUGGESTION is one-time `info`. Summaries and actor output are inert; only controller APIs MAY authorize, and store-integrity mismatch fails closed.
(Previously: two sweeps/fallback authority.)

#### Scenario: Precision limits

- GIVEN an ordinary 0/1/4 route
- WHEN discovery runs
- THEN each lens runs once and speculation is rejected

#### Scenario: Frozen terminal rows

- GIVEN frozen canonical rows
- WHEN orchestration runs
- THEN claims/evidence stay immutable and terminal/info rows schedule nothing

#### Scenario: Authoritative persistence

- GIVEN summary/store disagreement
- WHEN authority is checked
- THEN the store prevails or integrity failure closes the gate

### Requirement: Constant batched refutation and voting

The controller MUST verify `deterministic` evidence directly. All `inferential-severe` rows MAY go once to one read-only refuter returning per-ID `refuted | corroborated | inconclusive`. A complete row MAY cite independent concrete proof rather than duplicating reviewer proof references. Empty/malformed proof and invalid/insufficient evidence become `inconclusive` and escalate.
(Previously: three refuters.)

#### Scenario: Evidence routing

- GIVEN deterministic or insufficient evidence
- WHEN corroborated
- THEN zero refuters run and the controller corroborates or escalates

#### Scenario: Inferential batch

- GIVEN inferential-severe rows
- WHEN authorized
- THEN one actor at most receives the full list once

#### Scenario: Fail-closed result

- GIVEN invalid/inconclusive output
- WHEN merged
- THEN it escalates with no second refuter

### Requirement: Bounded convergence and Judgment Day

Ordinary MAY enter `correction_required` once and authorize one correction transaction within the original changed-line budget. It uses one positive pre-edit forecast, one correction bound to the frozen IDs and genesis paths, one validator result for original criteria plus correction regression, and one final verification. Failed targeted validation, budget exhaustion, malformed evidence, or final-verification failure escalates; it never reruns initial lenses or refutation, changes frozen claims, adds work, or launches discovery actors. No-fix uses zero validators. Explicit Judgment Day replaces ordinary, uses two blind judges/zero refuters, and alone permits discovery re-judgment rounds.
(Previously: shared iteration.)

#### Scenario: Fix path

- GIVEN an ordinary correction attempt passes targeted validation
- WHEN advancing
- THEN one final verification runs without rerunning initial review

#### Scenario: No-fix or failure

- GIVEN no fix, a failed targeted validation, or exhausted correction/final verification
- WHEN reduced
- THEN no-fix has zero validators and every failed correction or final verification escalates without another attempt

#### Scenario: Judgment Day

- GIVEN explicit Judgment Day
- WHEN review runs
- THEN two blind judges and zero refuters run

#### Scenario: Judgment Day limit

- GIVEN findings survive round two
- WHEN evaluated
- THEN no third round runs and the transaction escalates

### Requirement: Installed refuter boundary

Installation/forced refresh MUST provide `review-refuter` with exactly `read`, `grep`, `find` and no mutation, shell, delegation, or memory-write permission. This guarantee MUST cover only isolated package-managed installs; explicit project/user overrides MAY shadow it and MUST NOT be rewritten or claimed compliant.

#### Scenario: Package permissions

- GIVEN package installation/forced refresh in an isolated agent home
- WHEN refuter identity, tools, and forbidden attempts are verified
- THEN the asset MUST exist, expose exactly `read`, `grep`, `find`, and deny every forbidden capability

#### Scenario: Explicit override

- GIVEN a project/user definition shadows the package refuter
- WHEN verified
- THEN verification MUST NOT modify the override or claim its permissions are package-compliant

### Requirement: No delivery or publication

Orchestration MAY implement/verify but MUST NOT deliver/publish. SDD adds no review/Judgment Day; gates validate exact receipts with zero actors. A real scope change MUST claim the deterministic parent+target child once, assign one fresh explicit budget, and leave the parent closed. Incidents stay separate.
(Previously: delivery-only boundary.)

#### Scenario: SDD completion

- GIVEN SDD completes approved
- WHEN advancing
- THEN no review/Judgment Day runs

#### Scenario: Scope or incident

- GIVEN new scope or an incident
- WHEN work starts
- THEN scope uses its claimed child/budget and incidents reset nothing

#### Scenario: Verification stop

- GIVEN implementation/verification complete
- WHEN orchestration finishes
- THEN files remain undelivered/unpublished

### Requirement: Native SDD readiness evidence

For both OpenSpec and Engram native status, adapter readiness MUST be true only when `nextRecommended` is `verify` or `archive`, `blockedReasons` is empty, and published `reviewGate.result` is `allow`. Missing gate evidence, `review`, `resolve-review`, blockers, and every non-allow or stale gate result MUST remain false.

#### Scenario: Post-review allow

- GIVEN OpenSpec or Engram status recommends verify/archive with no blockers and an allow gate
- WHEN readiness is decoded
- THEN readiness is true

#### Scenario: Missing, stale, or blocked evidence

- GIVEN any other action, blocker, missing gate, or non-allow gate
- WHEN readiness is decoded
- THEN readiness is false

## Acceptance Criteria

All scenarios MUST pass automated tests.
