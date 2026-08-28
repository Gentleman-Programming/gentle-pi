# Package Runtime Specification

## Purpose

Define reproducible package-local Gentle AI provisioning and platform-safe persistence without replacing user-managed runtime assets or weakening durability guarantees.

## Requirements

### Requirement: Package-local provisioning supplies the pinned compatible runtime

The package MUST provision and verify the pinned released Gentle AI binary in its package-local location. Native Gentle AI execution MUST use only the verified package-local absolute binary; it MUST NOT fall back to ambient PATH or a globally installed binary. No binary override contract is defined by this change. Existing Pi package/user asset override behavior MUST remain preserved, and package-content verification MUST remain present without unrelated replacement.

#### Scenario: Consumer installs the package without a global binary

- GIVEN the package is installed on a supported Node.js 24 environment and no global Gentle AI binary is available
- WHEN native Gentle AI execution resolves its runtime
- THEN it provisions or uses the verified pinned package-local absolute binary and the supported review path can invoke it

#### Scenario: Unrelated Pi asset override exists

- GIVEN a supported user-managed or project-managed override exists for an unrelated Pi package asset
- WHEN the package provisions or resolves the native Gentle AI runtime
- THEN the unrelated override remains effective and its asset is not overwritten, while native Gentle AI execution still uses the verified package-local absolute binary

#### Scenario: No approved binary override contract exists

- GIVEN a user, project, or ambient environment supplies a different Gentle AI binary path
- WHEN native Gentle AI execution resolves its runtime
- THEN the package ignores that untyped binary path and uses the verified package-local absolute binary; a future override requires a separately specified explicit typed contract

#### Scenario: Pinned artifact is missing or unverifiable

- GIVEN the package-local binary or its verification metadata is absent, invalid, or incompatible
- WHEN the runtime is requested
- THEN resolution fails closed with an actionable provisioning error

### Requirement: Windows persistence uses owned, durable operations

For persistence operations owned by the package, the system MUST support Windows writable-file durability without calling unsupported read-only-file or directory fsync operations. It MUST preserve same-directory atomic replacement for mutable state, no-replace or hard-link publication for immutable records and bundles, lock ownership, retry behavior, and fail-closed recovery. If the failing operation is owned by the released Gentle AI binary rather than Pi, the package MUST record an upstream-blocked disposition with a real tracker and MUST NOT create a shadow persistence implementation.

#### Scenario: Pi-owned state is persisted on Windows

- GIVEN a Windows repository and a package-owned review persistence operation
- WHEN identity, locks, graph objects, compact state, checkpoints, reset state, bundles, or supersession records are written
- THEN the operation completes using supported writable-file durability and atomic publication semantics

#### Scenario: Unsupported directory durability operation is encountered

- GIVEN the platform does not support directory fsync
- WHEN package-owned persistence commits a state change
- THEN the unsupported directory operation is skipped or handled by the platform-specific contract while file durability and fail-closed publication guarantees remain intact

#### Scenario: Package does not own the failing persistence path

- GIVEN executable call-path evidence identifies the released Gentle AI binary as the owner of the Windows failure
- WHEN the work-unit disposition is recorded
- THEN the package does not duplicate the implementation and records the concrete upstream tracker and unreleased dependency

### Requirement: Package verification provides release evidence

The package MUST verify its runtime contents and record focused, full-suite, runtime-harness, and package-content verification evidence before release. Full `pnpm test` and package-content verification MUST pass on the supported Node.js 24 environment. RDD review is independent evidence: its absence or presence never governs ordinary delivery.

#### Scenario: Release verification succeeds

- GIVEN the pinned runtime, package contents, and changed behavior are installed
- WHEN focused suites, the runtime harness, full `pnpm test`, and package verification run
- THEN all required evidence is recorded for the final verification matrix

#### Scenario: Verification fails

- GIVEN any required test, package-content check, or runtime compatibility check fails
- WHEN package verification is evaluated
- THEN the failed package verification is recorded, while ordinary delivery remains governed by repository policy independently of RDD review evidence
