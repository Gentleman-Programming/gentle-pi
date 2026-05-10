# gentle-pi-quality-harness Specification

## Purpose

Define Pi quality controls for Strict TDD evidence and standards-driven execution.

## Requirements

### Requirement: Enforce Strict TDD where tests exist

When testing capability is available, behavior changes MUST include RED-GREEN-REFACTOR evidence before verification is marked complete.

#### Scenario: Test-capable behavior change
- GIVEN a behavior change in `packages/coding-agent`
- WHEN apply and verify execute
- THEN evidence includes failing test first, passing test next, and refactor confirmation

#### Scenario: No test capability exception
- GIVEN no applicable test harness exists
- WHEN verify executes
- THEN the report SHALL mark the exception scope and rationale explicitly

### Requirement: Inject project standards

The runtime MUST inject resolved project standards into each phase context and SHALL reject execution if required standards are unavailable.

#### Scenario: Standards available
- GIVEN standards are resolved
- WHEN a phase starts
- THEN the phase receives standards in its execution context
