# Delta for Review Orchestration

## ADDED Requirements

### Requirement: Strict transient operation contracts

The review facade and orchestration boundary MUST validate `review/start`, `review/finalize`, and `review/validate` inputs at runtime before authority access or state transition. Validation MUST enforce required and optional fields, object and array shapes, enums, canonical strings, safe integer/range constraints, and recursively reject unknown keys. Contract errors MUST identify the failing area without proposing an alternate transition.

#### Scenario: Invalid operation input is rejected before mutation

- GIVEN a public review operation with a malformed type, enum, canonical string, range, or unknown top-level key
- WHEN the operation is submitted
- THEN it MUST return a deterministic contract-area error
- AND no authority access, state transition, or mutation MUST occur

#### Scenario: Nested unknown keys are rejected

- GIVEN a finalize payload containing an unknown key inside a finding, refuter result, targeted check, follow-up, or final evidence object
- WHEN the payload is validated
- THEN the operation MUST fail closed
- AND the nested contract area MUST be identified

### Requirement: Canonical reviewer evidence contract

The four package-owned reviewer lens prompts MUST satisfy one canonical parity contract for required output, evidence, and untrusted-actor clauses while preserving each lens's distinct role. Drift detection MUST fail when any required shared clause is absent or materially inconsistent. Project/user overrides MUST remain supported and MUST NOT be rewritten or represented as package-owned compliance.

#### Scenario: All package lenses satisfy parity

- GIVEN the four package-owned lens assets
- WHEN parity verification runs
- THEN each asset MUST contain every required shared contract clause
- AND each asset MUST retain its distinct risk role

#### Scenario: Prompt drift is detected

- GIVEN one package-owned lens omits or materially changes a required shared clause
- WHEN parity verification runs
- THEN verification MUST fail with the affected lens and clause

### Requirement: Bounded repair reporting

Repair reports MUST be derived only from the frozen correction IDs and paths for the single ordinary correction. Reports MUST distinguish correction-required, scoped-validation, approved, and escalated outcomes. Validator follow-ups MUST be inert observations and MUST NOT authorize new findings, paths, scope, repair rounds, or transitions.

#### Scenario: Scoped report after correction

- GIVEN frozen correction IDs and paths and a validator response
- WHEN a repair report is produced
- THEN it MUST contain only those frozen IDs and paths
- AND follow-ups MUST have no transition authority

#### Scenario: Widened repair report fails closed

- GIVEN validator evidence containing an added ID, path, finding, scope, or repair round
- WHEN the response is processed
- THEN the result MUST escalate or reject
- AND no widened repair work MUST be scheduled

## Acceptance Criteria

- Automated tests prove pre-transition rejection for representative top-level and nested invalid payloads.
- Automated tests prove parity and drift detection for all four package lens assets.
- Automated tests prove reports cannot widen frozen correction scope and terminal outcomes are unambiguous.
- Existing ordinary bounds, actor distrust, and no-delivery behavior remain unchanged.
