# Provider Behavior Parity Specification

## Purpose

Define how Gentle Pi **consumes immutable-release evidence** for provider-owned Wave 1 behavior (#1819, #1915) and how it records explicit wrong-host no-action boundaries (#2074, #910).

This capability owns **assertions only**. It does not own the provider pin, install, sync, generators, drift gates, checked-in mirrors, lock, bump automation, or the generic immutable-evidence harness — all of those belong to `consume-gentle-ai-release-artifacts`. Provider authority algorithms, #2050, the umbrella #256 carry-forward tracks, later waves, and any Gentle AI repository change are outside this specification.

## Requirements

### Requirement: Foundation-owned evidence harness

Pi MUST obtain provider-behavior evidence exclusively through the generic immutable-evidence harness provided by `consume-gentle-ai-release-artifacts`. This capability MUST NOT define, vendor, or maintain its own release-artifact format, package fixture ownership, provider pin, or evidence-acquisition mechanism.

#### Scenario: Evidence acquired through the foundation

- GIVEN a Wave 1 assertion requires provider behavior evidence
- WHEN the assertion resolves its evidence source
- THEN it consumes the foundation's harness output and defines no local pin, mirror, archive format, or acquisition path

#### Scenario: No duplicate ownership

- GIVEN the foundation already owns pin, sync, install, mirrors, and lock
- WHEN this capability is implemented
- THEN it introduces no competing version constant, mirror, lock entry, or generator

### Requirement: Qualifying evidence class

Provider-behavior assertions MUST be satisfied only by evidence derived from an **immutable signed release** verified by the foundation. A local unsigned GoReleaser snapshot MAY support development but MUST be labelled `development/bootstrap` and MUST NOT satisfy final acceptance. A mutable provider `main` build, a source checkout, or a hand-assembled archive MUST NEVER substitute for release evidence.

#### Scenario: Live signed release evidence

- GIVEN the foundation verified an immutable signed release and published its evidence record
- WHEN a provider-behavior assertion consumes that record
- THEN the assertion may reach final acceptance and records the exact release identity it relied on

#### Scenario: Bootstrap evidence is not acceptance

- GIVEN only a local unsigned snapshot is available
- WHEN a provider-behavior assertion runs against it
- THEN the result is labelled `development/bootstrap` and MUST NOT be recorded as final acceptance

#### Scenario: Mutable provider build refused

- GIVEN evidence originates from provider `main`, a source checkout, or an unverified archive
- WHEN the assertion evaluates its evidence source
- THEN the evidence is refused and the assertion does not pass

### Requirement: Absent evidence blocks verification

When no qualifying evidence exists, a provider-behavior assertion MUST report `blocked` and MUST name the missing dependency. It MUST NOT pass, MUST NOT self-skip, MUST NOT report a passing zero-cost flow, and MUST NOT downgrade itself to an informational note.

#### Scenario: No qualifying release yet

- GIVEN no immutable signed release contains the required provider behavior
- WHEN a provider-behavior assertion is requested
- THEN it reports `blocked` naming the release-artifact foundation dependency, and verification does not pass

#### Scenario: Self-skip is forbidden

- GIVEN the harness reports that evidence is unavailable or the pinned provider lacks the capability
- WHEN the assertion handles that condition
- THEN it surfaces `blocked` or `unsupported` as a non-passing outcome and never silently succeeds

### Requirement: #1819 corrected-delivery evidence consumption

Gentle AI owns corrected current-changes delivery topology and selector-free receipt discovery. Pi MUST assert only the **transport and the provider-declared outcome** carried by immutable-release evidence: that the exact gate request was forwarded unchanged and that the provider's allow or deny verdict was preserved. Pi MUST NOT reconstruct receipt discovery, commit topology, squash detection, path-drift analysis, or any authority graph in TypeScript.

#### Scenario: Provider allow outcome is transported

- GIVEN release evidence records a provider allow verdict for an exact one-commit corrected current-changes delivery
- WHEN Pi consumes that evidence
- THEN Pi asserts the exact request was forwarded and the verdict preserved, deriving no local topology conclusion

#### Scenario: Provider denial outcome is transported

- GIVEN release evidence records a wrong-candidate, path-drift, extra-commit, or non-squashed denial
- WHEN Pi consumes that evidence
- THEN Pi preserves the denial verbatim and performs no duplicate or compensating provider validation

#### Scenario: Local reconstruction refused

- GIVEN an implementation would compute a delivery-topology verdict inside Pi
- WHEN the capability is verified
- THEN that reconstruction is rejected as provider-owned behavior

### Requirement: #1915 retry-successor evidence consumption

Gentle AI owns retry-successor authority and evidence-graph validation. Pi MUST assert only that a provider-declared terminal `retry-final-verification` successor outcome — `approved` or `escalated` — is decoded and surfaced without false corruption reporting and without weakening frozen bindings. Pi MUST NOT implement a local authority graph, evidence-digest evolution rule, or correction-accounting invariant.

#### Scenario: Terminal successor outcome preserved

- GIVEN release evidence records a record-backed terminal retry successor with an `approved` or `escalated` outcome
- WHEN Pi decodes the status and gate response
- THEN the terminal outcome remains authoritative and no false authority-corruption result is produced

#### Scenario: Authority graph reconstruction refused

- GIVEN an implementation would validate provider evidence-graph or authority-evolution invariants inside Pi
- WHEN the capability is verified
- THEN that reconstruction is rejected as provider-owned behavior

### Requirement: Explicit host no-action boundaries

Pi MUST record #2074 and #910 as explicit no-action, wrong-host dispositions and MUST NOT create any parity surface for them.

- **#2074** concerns Claude Code user-registry migration and legacy MCP cleanup. Pi has no corresponding host surface and MUST NOT read, write, migrate, or delete Claude user or legacy MCP configuration.
- **#910** concerns Gentle AI Windows installer, upgrade, Engram, and GGA PowerShell host resolution. Pi MUST NOT add a duplicate PowerShell resolver or fallback ladder.

Neither issue may carry a fixture, journey, evidence record, or coverage claim. Asserting coverage for either would be a false claim.

#### Scenario: Wrong-host issue recorded

- GIVEN the parity inventory includes #2074 or #910
- WHEN Pi evaluates its available host surfaces
- THEN it records an explicit no-action disposition and changes no Claude file, PowerShell resolver, or provider installer behavior

#### Scenario: No false coverage claim

- GIVEN a report enumerates Wave 1 issue coverage
- WHEN #2074 and #910 are listed
- THEN they appear as no-action dispositions and never as passing fixtures, journeys, or covered assertions

### Requirement: RDD-disabled boundary

Provider-behavior evidence consumption MUST NOT start, recover, retry, reset, reclaim, or otherwise create receipt-driven review authority. Delivery evidence MUST report `disabled/unmanaged`.

#### Scenario: Evidence consumption creates no review authority

- GIVEN RDD is globally and effectively `off`
- WHEN provider-behavior evidence is acquired and asserted
- THEN no RDD operation is invoked, no receipt or approval is fabricated, and delivery evidence reports `disabled/unmanaged`

## Acceptance Criteria

- Strict-TDD tests MUST prove every scenario above, failing before the behavior exists and passing in `pnpm test`.
- Tests MUST prove that `blocked` and `unsupported` are non-passing outcomes, using an assertion so a regression fails loudly instead of producing false success.
- Tests MUST prove that no provider topology or authority graph is computed inside Pi.
- Tests MUST NOT invoke a mutable provider checkout, and MUST NOT introduce a local pin, mirror, lock, or archive-format definition.
- Read-only `gentle-ai review mode status` MUST report global and effective `off` before and after verification.
