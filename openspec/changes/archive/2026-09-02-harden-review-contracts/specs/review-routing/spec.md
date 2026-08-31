# Delta for Review Routing

## ADDED Requirements

### Requirement: Runtime contract validation at routing boundaries

`review/start`, `review/finalize`, and `review/validate` MUST reject malformed or recursively widened transient inputs before route selection, authority mutation, reducer execution, or gate validation. Validation MUST enforce exact nested shapes, enums, canonical strings, and safe numeric ranges without changing existing 0/1/4 lens selection rules.

#### Scenario: Invalid routing input cannot influence route

- GIVEN a start or finalize input with an invalid nested value or unknown key
- WHEN routing receives the input
- THEN it MUST fail with a deterministic contract-area error
- AND it MUST NOT classify, select lenses, mutate authority, or launch actors

### Requirement: Identity-bound validation

Routing validation for compact authority MUST verify the loaded-runtime contract/version/schema identity before mutation or terminal validation. A mismatch MUST fail closed and MUST NOT be treated as a scope change, alternate route, or approval. Read-only graph-v1 compatibility remains governed by existing rules.

#### Scenario: Runtime mismatch at validation

- GIVEN an otherwise valid compact validation request and an incompatible loaded runtime identity
- WHEN validation runs
- THEN it MUST return an explicit identity mismatch
- AND it MUST launch no actors or delivery action

## Acceptance Criteria

- Boundary tests prove invalid values cannot alter deterministic routing or gate outcomes.
- Identity mismatch tests prove compact validation fails closed without classifying a new route.
- Existing trivial, standard, full-4R, exact-gate, and dangerous-command safety composition tests remain passing.
