# gentle-pi-safety-harness Specification

## Purpose

Define Pi runtime safety gates for tool permissions and destructive-action protection.

## Requirements

### Requirement: Enforce command permission policy

The runtime MUST evaluate command/tool requests against Pi safety policy and MUST deny disallowed operations before execution.

#### Scenario: Allowed operation
- GIVEN a command is within policy
- WHEN execution is requested
- THEN the command is permitted and logged in phase output

#### Scenario: Disallowed destructive operation
- GIVEN a destructive operation violates policy
- WHEN execution is requested
- THEN execution SHALL be denied with explicit policy reason

### Requirement: Require backup/rollback checkpoints

For state-mutating phases, the runtime MUST create or reference rollback checkpoints before applying mutations.

#### Scenario: Mutation with checkpoint
- GIVEN apply phase will mutate tracked state
- WHEN phase execution begins
- THEN a rollback checkpoint is recorded before mutation continues
