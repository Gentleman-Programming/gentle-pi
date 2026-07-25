# Delta for Review Routing

## ADDED Requirements

### Requirement: Verbatim tier reflection

When organic-parity is active, review depth/tier presented to the user MUST be rendered verbatim from the native start result's reported tier and MUST NOT be re-derived or recomputed by the consuming runtime.

#### Scenario: Tier passthrough

- GIVEN the native start result reports a tier
- WHEN the result is rendered
- THEN the displayed tier equals the native result's tier with no local recomputation

#### Scenario: Missing tier fails closed

- GIVEN organic-parity is active and the native start result omits tier
- WHEN the result is rendered
- THEN no tier is fabricated locally

### Requirement: Disabled/unmanaged delivery as success

When the native result reports the single literal `delivery: "disabled/unmanaged"` (the only value gentle-ai emits), the consuming runtime MUST render this as a successful non-delivery outcome, MUST exit with a success status, and MUST NOT report it as a failure. Any other delivery value MUST fail closed as schema-incompatible.

#### Scenario: Disabled/unmanaged delivery

- GIVEN the native result reports `delivery: "disabled/unmanaged"`
- WHEN the outcome is rendered
- THEN the runtime exits successfully and communicates a non-delivery choice, not a failure

#### Scenario: Unknown delivery value fails closed

- GIVEN the native result reports any other `delivery` value
- WHEN the result is decoded
- THEN decoding fails closed as schema-incompatible and no outcome is fabricated
