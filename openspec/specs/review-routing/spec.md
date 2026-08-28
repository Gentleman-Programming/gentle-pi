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

### Requirement: Commit and push are outside review routing

Pre-commit and pre-push MUST NOT classify, start, resume, validate, or otherwise invoke review. Pi has no commit or push delivery gate. Ordinary commit and push always follow repository policy.

#### Scenario: Commit or push is requested

- GIVEN a repository commit or push command
- WHEN it is requested
- THEN Pi review routing does not inspect it as a delivery target
- AND repository policy determines execution

### Requirement: Review-only safety composition

Review routing binds only review candidates, findings, and evidence. It MUST NOT derive delivery targets, journal delivery authorization, or turn a receipt into commit, push, PR, or release authority. Post-apply MAY explicitly start ordinary review without a receipt, never Judgment Day. Dangerous-command confirmation remains authoritative under repository policy.

#### Scenario: Review result is available

- GIVEN a resolved candidate matches an approved receipt
- WHEN routing completes
- THEN the receipt remains review evidence only
- AND ordinary delivery follows repository policy

#### Scenario: Changed scope

- GIVEN review candidate semantics differ
- WHEN review routing evaluates the candidate
- THEN it returns the review-specific next action with zero actors until an explicit review starts

#### Scenario: Dangerous command

- GIVEN command safety requires confirmation
- WHEN a command is requested
- THEN command safety remains authoritative under repository policy

### Requirement: Delivery boundary

Routing and validation MUST perform no delivery, publication, publication-only version change, or delivery authorization. Pi mints no delivery authority: ordinary commit, push, PR, and release always follow repository policy.

#### Scenario: Validation completes without delivery

- GIVEN a routing or validation result
- WHEN complete
- THEN no delivery or publication action is authorized or performed

## Acceptance Criteria

All scenarios MUST be independently verifiable through automated routing and runtime safety-composition tests.
