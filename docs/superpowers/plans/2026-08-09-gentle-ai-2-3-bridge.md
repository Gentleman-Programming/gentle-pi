# Gentle AI 2.3 Local Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement one work unit at a time. Do not commit, push, publish, or touch HSS review authority without explicit user authorization.

**Goal:** Build a reversible, package-local bridge from `gentle-pi` main to Gentle AI `2.3.0-rc.2`, while fixing the correction FINALIZE transport defects documented by upstream issue #279.

**Architecture:** Preserve the package-local integrity boundary. Upgrade the negotiated v2 decoders for the provider's additive protocol-minor schemas, fix FINALIZE evidence/binding transport without changing native lifecycle semantics, then add raw-release-asset installation for the published 2.3 prerelease binaries. Validate all lifecycle behavior only in synthetic temporary repositories.

**Tech Stack:** TypeScript/Node test runner, ESM runtime mirrors, Go provider CLI invoked as a black box, pnpm 11.1.1.

## Global Constraints

- Strict TDD: RED -> verify RED -> GREEN -> TRIANGULATE -> REFACTOR.
- Maximum 400 authored changed lines per work unit.
- No PATH fallback and no unverified executable override.
- Do not access or mutate the HSS lineage, candidate, evidence, or authority.
- Keep provider-owned identities canonical; never infer authority or lifecycle state.
- Retain 2.2.3 fixture compatibility at decoder level while making 2.3.0-rc.2 the local package pin.
- Do not redesign provider lifecycle semantics or turn failed validation into success.
- No commits, pushes, releases, or PRs without a separate explicit user instruction.

---

## Work Unit 0: Repair the dev-binary projection fixture

**Files:**
- Modify: `tests/devbinary/native-review-parity.devtest.ts`

**Status:** Completed by applying the exact one-file diff from upstream PR #291.

**Verified RED baseline:**
- Package-local 2.2.3: 5 tests, 3 passed, 2 failed (legacy plain-CLI consent expectations).
- Global 2.3.0-rc.2: 5 tests, 2 passed, 3 failed (same two consent expectations plus empty-candidate preflight behavior).

## Work Unit 1: Accept protocol-minor v2.2 schemas without weakening validation

**Files:**
- Modify: `lib/review-integration-v2.ts`
- Modify: `runtime/review-integration-v2.mjs`
- Modify/add focused decoder fixtures/tests under `tests/` and `contracts/review-integration/v2/`

**Interfaces:**
- Consumes: provider capabilities schema `gentle-ai.review-integration.capabilities/v2.2`, protocol `{major:2, minor:2}`, status schema `...status/v5`, consent schema `...consent/v3`.
- Produces: the existing `ReviewCapabilitiesV2`, `ReviewStatusV3`, and `ReviewConsentV2` internal types without losing provider raw envelopes.

- [ ] RED: add exact 2.3.0-rc.2 capability/status/consent fixtures captured from synthetic repositories.
- [ ] Verify RED: current decoder must reject the new schema versions for the expected reason.
- [ ] GREEN: accept the known v2.0 and v2.2 capability identities, protocol minor 0..2, status v3/v5, and consent v2/v3.
- [ ] Preserve exact-field validation. Consent v3's `agent` is accepted only on v3 and must be a non-empty canonical process string.
- [ ] Do not accept unknown protocol major, unknown mandatory features, non-additive fields, or unsupported schema versions.
- [ ] TRIANGULATE: existing 2.2.3 fixtures remain green; malformed mixed-version fixtures fail closed.
- [ ] REFACTOR: keep version discrimination in small named helpers and mirror behavior exactly in `runtime/`.

## Work Unit 2: Fix FINALIZE evidence transport and captured identity decoding

**Files:**
- Modify: `lib/native-review-cli.ts`
- Modify: `runtime/native-review-cli.mjs`
- Modify: focused native CLI tests under `tests/`

**Interfaces:**
- Extend `NativeFinalizeRequest` with `capturedEvidence?: boolean`.
- Normalize `authority_revision`, `target_identity`, `paths_digest`, and `raw_payload_sha256` to `sha256:<64 lowercase hex>` during captured-evidence decoding.
- Keep `candidate_tree` as a Git tree ID.

- [ ] RED: bare provider digest identities currently cause `correction-evidence-binding-drift`.
- [ ] RED: FINALIZE cannot emit `--captured-evidence=true`.
- [ ] RED: raw evidence plus captured discovery is not rejected before launch.
- [ ] Verify every RED failure.
- [ ] GREEN: accept bare or prefixed SHA-256 values and return canonical identities.
- [ ] GREEN: emit exactly `--captured-evidence=true` when requested.
- [ ] GREEN: reject `capturedEvidence` together with `evidenceDocument` or `evidenceFile` before native launch.
- [ ] TRIANGULATE: candidate tree remains unchanged; malformed/uppercase/non-64 hashes fail closed.
- [ ] REFACTOR and keep the TS/runtime mirrors identical.

## Work Unit 3: Preserve provider-owned targeted validation bindings

**Files:**
- Modify: `lib/review-compact-contract.ts`
- Modify: `runtime/review-compact-contract.mjs` if present/used
- Modify: `extensions/gentle-ai.ts`
- Modify/add focused controller and compact-contract tests under `tests/`

**Interfaces:**
- Targeted validation native document has exactly:
  - `targeted_validation_request_hash`
  - `correction_target_identity`
  - `original_criteria`
  - `correction_regression`
  - `follow_ups`
- Both identities come from `ReviewStatusV3.validationRequest`, not caller payload.
- Legacy `validation_proof` keeps its three-field shape.

- [ ] RED: targeted serializer currently emits only three fields.
- [ ] RED: same-process capture then FINALIZE retransmits raw evidence instead of discovery.
- [ ] RED: fresh-process validation cannot discover persisted captured evidence.
- [ ] Verify every RED failure.
- [ ] GREEN: bind targeted validation to provider status identities and fail closed when absent/non-canonical.
- [ ] GREEN: use `capturedEvidence: true` after evidence capture; omit raw evidence transport from the subsequent FINALIZE.
- [ ] GREEN: fresh-process continuation routes from target status and uses captured discovery without recapture or actor rerun.
- [ ] TRIANGULATE: legacy validation proof unchanged; passing and failed outcome semantics stay truthful.
- [ ] REFACTOR without introducing local authority storage reads.

## Work Unit 4: Pin and verify the published 2.3.0-rc.2 raw assets

**Files:**
- Modify: `scripts/gentle-ai-installer.mjs`
- Modify: `lib/gentle-ai-binary.ts` only if generated pin metadata requires it
- Modify: `runtime/gentle-ai-binary.mjs` only if generated pin metadata requires it
- Modify/add installer and binary integrity tests under `tests/`
- Modify: package verification expectations if asset format is encoded there

**Interfaces:**
- Published release tag: `v2.3.0-rc.2`.
- Darwin arm64 SHA-256: `e1c5f3389147b00b46bb3cffb4dc7ebe3751ef1775576ed1338fc429ae08a5e3`.
- Asset is a raw executable, not a tar archive.

- [ ] RED: installer rejects the raw release asset format and the runtime rejects package version 2.3.0-rc.2.
- [ ] Verify RED.
- [ ] GREEN: represent asset format explicitly (`archive` vs `raw-binary`) and install raw binaries without archive extraction.
- [ ] GREEN: pin all supported published platform digests from the release manifest; do not trust PATH or mutable URLs.
- [ ] GREEN: verify executable digest, canonical integrity manifest, regular-file/non-symlink constraints, mode, and self-reported digest.
- [ ] TRIANGULATE: archive-path installer tests remain valid; truncation, digest mismatch, symlink, and version mismatch fail closed.
- [ ] Run the negotiated status/start/consent journey against the package-local 2.3.0-rc.2 binary in synthetic repos.
- [ ] REFACTOR and run package-file verification.

## Work Unit 5: Full verification and reversible local installation

**Files:**
- No new product behavior.
- Installation affects only the local Pi package location after verification and backup.

- [ ] Run focused tests for every work unit.
- [ ] Run sanitized `pnpm test`; classify the one known graph-v1 environmental baseline failure separately if it persists.
- [ ] Run `pnpm run test:dev-binary` against package-local 2.3.0-rc.2 and document any intentionally obsolete plain-CLI assertions.
- [ ] Run `pnpm prepack` / package-file verification and `git diff --check`.
- [ ] Run TypeScript/LSP diagnostics and changed-line accounting per work unit.
- [ ] Audit the final diff for security and lifecycle correctness.
- [ ] Back up the currently installed `gentle-pi 2.1.2` package and hash the backup.
- [ ] Install/link the verified local bridge without modifying HSS review authority.
- [ ] Request a full Pi restart; `/reload` is insufficient for extension/package replacement.
- [ ] In the new process, verify loaded package/binary capabilities before any HSS operation.
- [ ] Keep rollback instructions and backup path ready.

## Self-Review

- Spec coverage: protocol schemas, issue #279's eight acceptance criteria, trusted binary installation, restart, and rollback are each assigned to one work unit.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: provider schema types remain the existing internal v2 interfaces; only transport/version discrimination changes.
- Scope: no provider lifecycle redesign, HSS authority mutation, review result falsification, publication, or PR creation.
