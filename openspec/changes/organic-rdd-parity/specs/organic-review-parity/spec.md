# Organic Review Parity Specification

## Purpose

Keep Gentle Pi aligned with the provider-owned native review lifecycle while preserving Pi's role as a typed consumer and opaque transport adapter.

## Requirements

### Requirement: Native review mode ownership

The system MUST treat native review mode as user-owned provider state. Pi MUST NOT enable review mode implicitly and MUST NOT use review mode or review authority to decide a delivery command.

#### Scenario: Mode is off

- GIVEN native review mode is off
- WHEN a review lifecycle operation is considered
- THEN Pi reports the provider-owned lifecycle state and does not create authority or enable mode

#### Scenario: Delivery command

- GIVEN a commit, push, pull-request, or release command
- WHEN the command is evaluated
- THEN ordinary repository policy decides delivery without an RDD mode or receipt authorization check

### Requirement: Candidate-scoped provider consent

When native START returns a consent envelope, Pi MUST present the complete provider-issued envelope losslessly, preserving its machine tokens, commands, target identity, and invocation. Pi MUST execute only the returned follow-up invocation for the explicit answer.

#### Scenario: Consent is granted or declined

- GIVEN a provider-issued consent envelope for one candidate
- WHEN the user explicitly answers `granted` or `declined`
- THEN Pi executes the matching exact provider invocation once for that candidate

#### Scenario: No persistent Pi latch

- GIVEN a consent outcome
- WHEN later candidates are considered
- THEN Pi does not use a clone-local consent latch to suppress provider-owned consent behavior

### Requirement: Opaque native transport

Pi MUST relay provider-selected lifecycle transitions and provider-materialized reviewer transport without reconstructing authority, prompts, or reviewer output.

#### Scenario: Materialized reviewer slot

- GIVEN a provider `review.capture-result` slot with materialize and submission inputs
- WHEN Pi runs the host relay
- THEN it submits untouched output only through the supplied provider submission form

## Acceptance Criteria

Automated tests MUST cover isolated mode fixtures, candidate-scoped consent relay, opaque lifecycle/transport routing, and ordinary delivery policy.
