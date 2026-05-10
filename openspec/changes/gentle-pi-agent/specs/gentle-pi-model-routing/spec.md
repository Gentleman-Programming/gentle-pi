# gentle-pi-model-routing Specification

## Purpose

Define phase-aware Pi model/provider routing policy for coding-agent runtime execution.

## Requirements

### Requirement: Route by phase policy

The runtime MUST select model/provider configuration using phase-aware policy and SHALL keep routing decisions deterministic for identical inputs.

#### Scenario: Phase-specific routing
- GIVEN proposal and apply phases with distinct policy entries
- WHEN each phase starts
- THEN the runtime selects the configured route for that phase

#### Scenario: Missing route policy
- GIVEN no route exists for a requested phase
- WHEN execution is requested
- THEN runtime SHALL return `blocked` with routing-policy-missing reason

### Requirement: Preserve Pi specialization boundary

Routing policy MUST remain scoped to Pi runtime contracts and MUST NOT introduce generic multi-runtime portability abstractions.

#### Scenario: Pi-scoped route definition
- GIVEN a routing configuration update
- WHEN it is validated
- THEN only Pi-supported provider/model policy fields are accepted
