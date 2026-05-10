# gentle-pi-context-harness Specification

## Purpose

Define Pi-specific session context continuity for SDD artifacts and project standards.

## Requirements

### Requirement: Initialize Pi OpenSpec context

The runtime MUST initialize SDD state using `openspec/config.yaml`, change state, and Pi project standards before executing any phase.

#### Scenario: Init on first phase
- GIVEN a valid project root and change name
- WHEN the first SDD phase starts
- THEN the runtime resolves OpenSpec paths and standards
- AND execution metadata is attached to the phase context

#### Scenario: Missing config blocks execution
- GIVEN `openspec/config.yaml` is missing
- WHEN a phase start is requested
- THEN execution SHALL fail with a structured blocker result

### Requirement: Preserve artifact continuity

The runtime MUST read existing phase artifacts before writing replacements and SHALL preserve prior OpenSpec history.

#### Scenario: Continue existing change
- GIVEN `openspec/changes/{change}/` already exists
- WHEN a later phase runs
- THEN prior artifacts are read before producing the new artifact
