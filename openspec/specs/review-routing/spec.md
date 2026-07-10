# Review Routing Specification

## Purpose

Define deterministic review depth and runtime behavior without turning review advice into a workflow gate or weakening command safety.

## Requirements

### Requirement: Deterministic route classification

Only ordinary start MUST classify persisted `base_tree -> complete_snapshot_tree` as `trivial | standard | full-4R`. State/receipt MUST also bind the exact `review_projection`, `initial_review_tree`, ordered lenses, and policy hash so classification is reconstructable. Triviality requires only docs/comments/formatting/typos; executable/configuration uncertainty is non-trivial. Standard selects one dominant lens, defaulting to readability. Gates/Judgment Day never classify.
(Previously: ambient/lifecycle diffs were classified.)

#### Scenario: Objectively trivial snapshot

- GIVEN only objectively trivial complete-snapshot changes
- WHEN ordinary starts
- THEN route MUST be `trivial` with zero lenses

#### Scenario: Ambiguous executable or configuration snapshot

- GIVEN executable/configuration uncertainty
- WHEN ordinary starts
- THEN route MUST be at least `standard` with one lens

#### Scenario: Ordinary non-trivial snapshot

- GIVEN non-trivial, non-hot-path scope
- WHEN ordinary starts
- THEN route MUST be `standard` with the highest-impact lens

### Requirement: Size and hot-path escalation

At ordinary start, non-trivial hot paths or over 400 changed lines MUST select `full-4R` with risk, resilience, readability, reliability in order.
(Previously: escalation applied outside start.)

#### Scenario: 399 and 400 line boundaries

- GIVEN 399 or 400 non-trivial changed lines
- WHEN start routes
- THEN size alone MUST yield `standard`

#### Scenario: 401 line boundary

- GIVEN 401 non-trivial changed lines
- WHEN start routes
- THEN route MUST be four-lens `full-4R`

#### Scenario: Hot path

- GIVEN a non-trivial hot path
- WHEN start routes
- THEN route MUST be `full-4R`

#### Scenario: Objectively trivial hot-path edit

- GIVEN an objectively trivial hot path
- WHEN start routes
- THEN route remains zero-lens `trivial`

### Requirement: Pre-commit and pre-push ceiling

Pre-commit/pre-push MUST NOT classify or review. Pre-commit MUST resolve the exact intended commit tree. Pre-push MUST consume the complete stable-ordered ref-update set, binding each source/destination ref and exact object/peeled-commit/tree IDs—never `HEAD` as proxy. Const-tagged `create` binds absent-old plus new identity; `update` binds both sides. New/update trees MUST match receipt final/base semantics; deletion, unsupported, ambiguous, or unresolved forms fail closed.
(Previously: these events rerouted full 4R to one standard lens.)

#### Scenario: Pre-delivery validation

- GIVEN a resolved commit or push target and receipt
- WHEN gated
- THEN exact semantics MUST be checked with zero actors

### Requirement: Non-blocking safety composition

All lifecycle gates MUST use `GateTargetV1` and receipts only. PR targets bind base/head refs, commits, and trees; release targets bind tag ref/object, peeled commit, and commit tree. Every identity MUST resolve. Target hash and result MUST be journaled. Post-apply MAY explicitly start ordinary without a receipt, never Judgment Day. Dangerous-command confirmation remains authoritative.
(Previously: routing emitted non-blocking advice without requiring receipts.)

#### Scenario: Same-lineage gate

- GIVEN a resolved target matches an approved receipt
- WHEN gated
- THEN it MUST allow with zero actors

#### Scenario: Changed scope

- GIVEN target semantics differ
- WHEN validated
- THEN return `scope-changed` with zero actors
- AND parent+target MUST identify one claimed child with one fresh explicit budget

#### Scenario: Dangerous command

- GIVEN command safety requires confirmation
- WHEN a receipt allows
- THEN command safety MUST still control execution

### Requirement: Delivery boundary

Routing/validation MUST perform no delivery, publication, or publication-only version change.
(Previously: the boundary covered routing advice but not receipt validation.)

#### Scenario: Validation completes without delivery

- GIVEN a routing/validation result
- WHEN complete
- THEN no delivery/publication action occurs

## Acceptance Criteria

All scenarios MUST be independently verifiable through automated routing and runtime safety-composition tests.
