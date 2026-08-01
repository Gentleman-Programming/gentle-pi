# Provider Capability Negotiation Specification

## Purpose

Defines gentle-pi's v2-only negotiation of the provider's advertised capability surface (operations, gates, projections, schemas, mandatory features) against a required floor generated from the semantic snapshot. Gates, projections, operations, and schemas are additive-tolerant required floors; mandatory features are exact and rejected on any unknown addition, matching the provider's `compatibility.unknown_mandatory: "reject"` declaration. This exact-rejection behavior already shipped in PR #263 against `main`; this spec documents the contract this change must not regress, not new work.

## Requirements

### Requirement: Gates, projections, operations, and schemas verify a required floor, tolerating additions

Verification of the advertised gates, projections, operations, and schemas MUST decode unknown additions safely, verify every name in the generated required floor is present, and MUST still reject any list that omits a required name.

#### Scenario: Provider adds a gate
- GIVEN advertised gates equal the required floor plus one new gate name
- WHEN verification runs
- THEN it passes and the new name is decoded but not required

#### Scenario: Required name missing
- GIVEN the advertised surface (gates, projections, operations, or schemas) omits a name present in the required floor
- WHEN verification runs
- THEN it fails, naming the missing required name, with no tolerance suppressing the failure

### Requirement: Unknown mandatory features are exact and rejected, never tolerated as a superset

Mandatory features MUST be verified for exact match against the required set. An advertised mandatory feature not present in the required set MUST be rejected with an actionable error; it MUST NOT be silently accepted merely because the advertised list is a superset of the required list.

(Previously: an earlier draft of this requirement stated that any superset of the required mandatory floor passes verification. That contradicted the provider's `unknown_mandatory: reject` policy and the exact-rejection behavior already shipped in PR #263.)

#### Scenario: Unknown mandatory feature rejected
- GIVEN advertised mandatory features equal the required set plus one unrecognized feature
- WHEN verification runs
- THEN it fails with an actionable error naming the unrecognized mandatory feature, and does not proceed as if it were supported

#### Scenario: Exact mandatory match passes
- GIVEN advertised mandatory features exactly equal the required set
- WHEN verification runs
- THEN verification passes

### Requirement: Negotiation scope confined to protocol v2

gentle-pi remains v2-only. No v1 negotiation lane exists or is introduced by this capability.

#### Scenario: Non-v2 payload rejected
- GIVEN a capability payload advertising a protocol major/minor other than v2
- WHEN negotiation evaluates it
- THEN it is rejected as incompatible, independent of floor or mandatory-exactness rules
