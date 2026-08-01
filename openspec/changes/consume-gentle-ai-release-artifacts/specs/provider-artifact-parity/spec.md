# Provider Artifact Parity Specification

## Purpose

Defines how gentle-pi verifies, mirrors, and generates from gentle-ai's release-artifact contract and semantic capability snapshot instead of hand-transcribing them. Format ownership, manifest fields, and snapshot content are defined upstream in gentle-ai's `release-artifact-contract` and `semantic-capability-snapshot` specs; this capability governs consumption only.

## Requirements

### Requirement: Archive verified with existing integrity discipline, unweakened

gentle-pi MUST verify the signed assets archive with the same discipline already applied to the platform binary: minisign signature and trusted repo/tag binding, matched checksum entry, archive digest, manifest and bundled-schema validation, confined no-symlink extraction, and normalized-mode safety. None of these guarantees may weaken for the assets archive.

#### Scenario: Tampered archive rejected
- GIVEN a downloaded assets archive whose digest does not match its signed checksum entry
- WHEN installation verifies it
- THEN installation fails closed and no files are extracted

#### Scenario: Symlink or traversal entry rejected
- GIVEN a canonical entry that is a symlink, hardlink, or escapes the confined extraction root
- WHEN extraction runs
- THEN that entry is rejected and installation fails closed

### Requirement: Unsupported contract major fails closed before layout is trusted

WHEN the manifest declares a contract major gentle-pi does not support, it MUST reject the archive with an actionable error naming the unsupported major and MUST NOT infer or guess a layout to continue.

#### Scenario: Unsupported major rejected
- GIVEN a manifest declaring an unsupported contract major
- WHEN the bootstrap decoder processes it
- THEN it fails closed naming the major, and no entries are extracted or trusted

### Requirement: Offline mirrors and a canonical lock bind provider identity

gentle-pi MUST check in a complete provider-derived mirror (contracts, docs, semantic snapshot) plus one canonical lock binding release identity, contract major, archive digest, tree digest, canonical entries, and generated-output digests. Pack-time vendoring (offline, deterministic, CI/`prepack`) and install-time extraction (live signed release, `postinstall`) are distinct evidence classes and MUST NOT be conflated. Every per-PR check MUST run offline against mirrors and the lock; only an explicit pin-bump job downloads.

#### Scenario: Per-PR check runs without network
- GIVEN an ordinary pull request with no pin bump
- WHEN CI validates mirrors against the lock
- THEN validation completes with no network access

#### Scenario: Mirror drifts from the lock
- GIVEN a checked-in mirror file no longer matches its locked digest
- WHEN the drift gate runs
- THEN it fails naming the drifted file; no hand-edit forces green

### Requirement: Bootstrap snapshot evidence never substitutes for release evidence

A local unsigned bootstrap snapshot MAY prove decoder, layout, extraction, install, and generator behavior, labeled `development/bootstrap`. It MUST NOT satisfy release provenance, final acceptance, the immutable version pin, or package pin evidence — only a live signed release supplies those.

#### Scenario: Bootstrap result blocked from final acceptance
- GIVEN only bootstrap-snapshot evidence exists for a pin candidate
- WHEN final acceptance is evaluated
- THEN acceptance is blocked pending a live signed-release run

### Requirement: Generated baselines and vendored skills are one-way and drift-gated offline

`REQUIRED_*` baselines and the next capability-table row MUST be generated (`--check`/`--write`) from the shipped semantic snapshot. Vendored shared-skill files MUST be written only by the vendor/sync script; Pi deltas MUST be separate overlay records. Both classes MUST be drift-detected offline when hand-edited. `skills/issue-creation/SKILL.md` MUST be excluded from vendoring entirely.

#### Scenario: Hand-edited generated output detected
- GIVEN generated baseline output was manually edited
- WHEN CI runs the generator with `--check`
- THEN it fails offline, naming the mismatched file

#### Scenario: Hand-edited vendored file detected
- GIVEN a vendored skill file was edited directly instead of through its overlay
- WHEN the drift gate runs
- THEN it fails with an actionable "edit the overlay, not the vendored file" message

#### Scenario: Repo-identity skill unaffected
- GIVEN gentle-ai's `skills/issue-creation/SKILL.md` changes
- WHEN the drift gate runs
- THEN gentle-pi's copy is unaffected and not flagged

### Requirement: Unmapped provider operation stops generation actionably

WHEN a new provider operation or envelope field has no client mapping, the generator MUST stop and report an actionable message naming the operation and the required decoder work. It MUST NOT let the operation appear supported merely because a snapshot listed it.

#### Scenario: New operation without client code
- GIVEN the semantic snapshot lists an operation gentle-pi has no decoder for
- WHEN the generator runs
- THEN it fails naming the operation and the required client work; no supported mapping is emitted

### Requirement: Pi agent/chain assets get a phase-coverage gate, never byte vendoring

`assets/agents/**` and `assets/chains/**` are Pi runtime bindings with no provider counterpart. They MUST be checked by a phase-coverage/name-alias gate against the provider's declared surface, never by byte-hash vendoring.

#### Scenario: Provider adds a phase with no Pi binding
- GIVEN the provider declares a phase gentle-pi has no agent/chain binding for
- WHEN the coverage gate runs
- THEN it fails naming the missing binding
