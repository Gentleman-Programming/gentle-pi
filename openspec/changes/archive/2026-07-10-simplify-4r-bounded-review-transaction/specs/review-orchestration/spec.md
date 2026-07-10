# Delta for Review Orchestration

## MODIFIED Requirements

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

The controller MUST verify `deterministic` evidence directly. All `inferential-severe` rows MAY go once to one read-only refuter returning per-ID `refuted | corroborated | inconclusive`. Invalid/insufficient evidence becomes `inconclusive` and escalates.
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

Ordinary MAY authorize one fix batch. After fixes, one validator receives only requested frozen IDs, their exact hash-bound canonical rows, and the fix diff; resolutions are separate. It MAY resolve IDs/detect fix-line regression but MUST NOT alter claims, add work, launch actors, or repeat. No-fix uses zero validators. One final verification ends `approved | escalated`. Explicit Judgment Day replaces ordinary, uses two blind judges/zero refuters, and alone permits two rounds.
(Previously: shared iteration.)

#### Scenario: Fix path

- GIVEN ordinary fixes complete
- WHEN advancing
- THEN one validator and one final verification run without new work

#### Scenario: No-fix or failure

- GIVEN no fix or failed validation/verification
- WHEN reduced
- THEN no-fix has zero validators and any failure escalates

#### Scenario: Judgment Day

- GIVEN explicit Judgment Day
- WHEN review runs
- THEN two blind judges and zero refuters run

#### Scenario: Judgment Day limit

- GIVEN findings survive round two
- WHEN evaluated
- THEN no third round runs and the transaction escalates

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

## Acceptance Criteria

Tests MUST prove frozen rows, authority, budgets, modes, gates, and no delivery.
