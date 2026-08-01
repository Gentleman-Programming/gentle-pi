# Delta for Package Runtime

> **Sequencing dependency**: `package-runtime` has no entry in `openspec/specs/`. Its only definition
> lives in the unarchived sibling change `consolidate-review-parity-runtime`
> (`state.yaml`: `archive: pending`, `status: apply-complete-review-approved`). This delta is authored
> against that base spec's `Package-local provisioning supplies the pinned compatible runtime`
> requirement, copied in full below and then edited. `consolidate-review-parity-runtime` MUST be
> archived before this delta's P2 work unit (all-platform assets install + atomic bundle) integrates
> or opens; it does not block P1 planning, design, or the bootstrap-decoder work unit.

## MODIFIED Requirements

### Requirement: Package-local provisioning supplies the pinned compatible runtime and assets bundle

The package MUST provision and verify the pinned released Gentle AI binary together with its accompanying platform-independent assets bundle (contracts, generated capability snapshot, docs) in its package-local location, published as one atomic bundle under one integrity manifest. The manifest MUST carry the release-artifact contract major and layout version alongside binary and assets provenance. Native Gentle AI execution MUST use only the verified package-local absolute binary; it MUST NOT fall back to ambient PATH or a globally installed binary. No binary override contract is defined by this change. Existing Pi package/user asset override behavior MUST remain preserved, and package-content verification MUST remain present without unrelated replacement. On Windows, the binary MUST continue using its distinct Go SumDB exact-tag source-build trust path, while assets MUST come from the same signed assets archive consumed on Linux and macOS, both bound within the one atomic bundle and manifest.

(Previously: provisioning and verification covered only the binary. This extends the same guarantees to the binary + assets bundle, published and rolled back atomically as a single unit, and binds Windows' distinct binary provenance with the shared assets provenance in one manifest.)

#### Scenario: Consumer installs the package without a global binary

- GIVEN the package is installed on a supported Node.js 24 environment and no global Gentle AI binary is available
- WHEN native Gentle AI execution resolves its runtime
- THEN it provisions or uses the verified pinned package-local absolute binary and its assets bundle, and the supported review path can invoke it

#### Scenario: Unrelated Pi asset override exists

- GIVEN a supported user-managed or project-managed override exists for an unrelated Pi package asset
- WHEN the package provisions or resolves the native Gentle AI runtime and assets bundle
- THEN the unrelated override remains effective and its asset is not overwritten, while native Gentle AI execution still uses the verified package-local binary and assets

#### Scenario: No approved binary override contract exists

- GIVEN a user, project, or ambient environment supplies a different Gentle AI binary path
- WHEN native Gentle AI execution resolves its runtime
- THEN the package ignores that untyped binary path and uses the verified package-local absolute binary; a future override requires a separately specified explicit typed contract

#### Scenario: Pinned artifact is missing or unverifiable

- GIVEN the package-local binary, the assets bundle, or their verification metadata is absent, invalid, or incompatible
- WHEN the runtime is requested
- THEN resolution fails closed with an actionable provisioning error

#### Scenario: Half-published bundle is never observable

- GIVEN a bundle publish is interrupted after the binary is written but before assets are written, or vice versa
- WHEN any caller resolves the runtime or its assets
- THEN it observes either the complete prior bundle or the complete new bundle, never a partial mix

#### Scenario: Interrupted publication recovers

- GIVEN a publish was interrupted mid-swap, leaving a staged incomplete bundle
- WHEN provisioning next runs
- THEN it detects the incomplete stage, discards it, and either restores the complete prior bundle or completes a fresh atomic publish, with no manual repair step required

#### Scenario: Offline/skip path is symmetric for binary and assets

- GIVEN `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1` is set
- WHEN provisioning runs
- THEN both binary and assets provisioning are skipped with the same loud, actionable disposition, and no partially configured bundle directory is created

#### Scenario: Offline with skip unset and no network

- GIVEN the skip environment variable is not set and no network is available
- WHEN provisioning attempts to fetch the binary or the assets bundle
- THEN both fail loudly with an actionable error; neither silently degrades

#### Scenario: Windows split provenance bound in one bundle

- GIVEN a Windows install where the binary is source-built and verified via Go SumDB for the exact release tag, and the assets archive is the same signed archive used on Linux and macOS
- WHEN the atomic bundle publishes
- THEN one integrity manifest records both the binary's SumDB provenance and the assets archive's signed provenance, and neither cross-check regenerates or overrides the signed assets snapshot
