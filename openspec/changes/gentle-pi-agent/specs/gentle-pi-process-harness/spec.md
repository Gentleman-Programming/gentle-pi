# gentle-pi-process-harness Specification

## Purpose

Define deterministic Pi SDD phase flow, isolation, and result contracts.

## Requirements

### Requirement: Enforce phase DAG order

The runtime MUST enforce configured phase dependencies and MUST NOT execute a phase whose required predecessor artifact is missing.

#### Scenario: Valid phase progression
- GIVEN proposal and specs artifacts exist
- WHEN design phase is requested
- THEN the design phase executes

#### Scenario: Dependency missing
- GIVEN proposal artifact is absent
- WHEN spec phase is requested
- THEN execution SHALL return `blocked` with missing-artifact reason

### Requirement: Isolated phase execution and progress

Each phase MUST execute in an isolated context and SHALL emit apply-progress updates plus a final structured envelope.

#### Scenario: Progress during apply
- GIVEN apply phase is running
- WHEN each task checkpoint completes
- THEN progress state updates are emitted in order

#### Scenario: Envelope compliance
- GIVEN any phase completes
- WHEN result is returned
- THEN it includes status, summary, artifacts, next step, and risks
