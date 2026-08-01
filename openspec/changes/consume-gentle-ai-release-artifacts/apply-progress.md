# Apply Progress: consume-gentle-ai-release-artifacts

> Scope of this batch: **PR 1 / P1a only** — tasks 1.1 through 1.8. P1b and later are NOT started.

## Completed Tasks

- [x] 1.1 Rebase prerequisite verified (already on this branch): `INSTALLER_VERSION` is the sole pin literal (`lib/gentle-ai-binary.ts:21`), gate/projection floor verification is additive-tolerant (`lib/review-integration-v2.ts`, `assertSupersetOf`), and `openspec/specs/package-runtime/spec.md` exists. Nothing re-implemented.
- [x] 1.2 RED: `lib/release-artifact.ts` decoder tests (`tests/release-artifact.test.ts`) — unsupported major, unknown top-level/nested key, `tree.manifest_included:true`, absolute/traversal/backslash/NUL/over-length/duplicate/unsorted path, non-`file` type, non-`0644` mode, malformed digest shape, missing bundled schema, `$id` mismatch, `compatibility.unknown_mandatory` not `reject`.
- [x] 1.3 RED: tree digest tests — known-vector preimage (byte-identical to the provider's `internal/releaseartifact/tree_test.go` vector), input-order independence, no caller-array mutation, and a real-fixture round trip against the provider's own `artifact-manifest.fixture.json` declared digest.
- [x] 1.4 RED: bounded-extraction tests — `enforceExtractionCaps` (entries/file-bytes/total-bytes caps, non-regular type rejection) and `assertExactMemberSet` (extra/missing/duplicate member, size disagreement) as pure functions, plus `extractReleaseArtifact` orchestration tests proving zero bytes written before caps pass and no bulk extraction before the exact-set check passes.
- [x] 1.5 RED: `resolveBootstrapArtifactSource` / `assertReleaseAcceptanceEvidence` tests — explicit-path requirement (never auto-discovered), `signature_status: not-applicable/local-unsigned`, and rejection from pin/final-acceptance evidence.
- [x] 1.6 GREEN: `lib/release-artifact.ts` created — `decodeArtifactManifest`, `treeDigest`, `SUPPORTED_CONTRACT_MAJOR = 1`, D1 steps 7-11 (the part of the trust order this module owns) in order with the major check strictly first, D2 staged extractor (stage 0 caps → stage 1/2 manifest-only extract+decode → stage 3 exact path-set equality → stage 4 full extract → stage 5 per-file recheck).
- [x] 1.7 GREEN: `runtime/release-artifact.mjs` generated; `release-artifact` registered in `scripts/build-git-commit-transaction-runner.mjs`'s `sources` list.
- [x] 1.8 Verify: `pnpm test -- release-artifact` (via `node --experimental-strip-types --test tests/release-artifact.test.ts`, 42/42 passing) and `pnpm run check:transaction-runner` (generated runtime matches TypeScript source).

## Scope Boundary (why steps 1-5 of D1 are not all in this module)

Design D1 lists an 11-step trust order, but the P1a work-unit table scopes this PR to "Bootstrap decoder + tree digest + bounded extractor," with P1b delivering "Signed sync path + mirrors + lock." `lib/release-artifact.ts` therefore implements steps 6-11 (bounded extraction, envelope decode, unsupported-major-first, bundled-schema/manifest/entries validation, `compatibility.unknown_mandatory`) — the stdlib-only, no-network, no-cryptographic-signature part. Steps 1-5 (resolve pinned identity from the lock file, which doesn't exist until task 2.4; download `checksums.txt`/`.minisig`/archive; verify the minisign signature and trusted-comment binding; match the checksum line; verify the archive digest) require network access and a minisign verifier and are explicitly assigned to `scripts/sync-gentle-ai-release.mjs` in task 2.2 ("downloads … runs D1 trust order via `lib/release-artifact.ts`"). This is a scope observation, not a deviation from design.md — the design's own File Changes and Migration/Rollout tables independently confirm the same split (P1 rollback boundary: "delete lib/release-artifact.ts/runtime/release-artifact.mjs; sources entry reverted" — a self-contained unit with no lock/mirror/sync dependency).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.2 | `tests/release-artifact.test.ts` | Unit | N/A (new file) | ✅ Written (referenced `decodeArtifactManifest`/`UnsupportedReleaseArtifactMajorError` before they existed → `ERR_MODULE_NOT_FOUND`) | ✅ 16/16 decoder cases pass | ✅ table-driven: 4 digest-shape variants, 4 path-confinement variants, unknown-key at 2 nesting levels, duplicate vs. unsorted as distinct cases | ✅ Clean — shared `assertPlainObject`/`assertExactKeys`/`decodeEntry` helpers, no duplication |
| 1.3 | `tests/release-artifact.test.ts` | Unit | N/A (new file) | ✅ Written (known-vector hex asserted before `treeDigest` existed) | ✅ 4/4 tree-digest cases pass, byte-identical to the Go known vector `sha256:971ca2d5…` | ✅ reversed-input case + real-fixture round trip (2 independent vectors) | ✅ Clean — single pure function |
| 1.4 | `tests/release-artifact.test.ts` | Unit + real-subprocess integration | N/A (new file) | ✅ Written (referenced `enforceExtractionCaps`/`assertExactMemberSet`/`extractReleaseArtifact` before they existed) | ✅ 16/16 extraction cases pass, including one end-to-end test against a real archive built with the system `tar` binary | ✅ caps tested individually (entries/file-bytes/total-bytes/type) and combined; exact-set tested for extra/missing/duplicate/size-disagreement, with a dedicated "added-file attack" test proving the security property directly | ✅ Clean — caps and exact-set split into two pure, mock-free functions; only I/O boundaries (list/extract) are faked |
| 1.5 | `tests/release-artifact.test.ts` | Unit | N/A (new file) | ✅ Written (`resolveBootstrapArtifactSource`/`assertReleaseAcceptanceEvidence` referenced before they existed) | ✅ 3/3 cases pass | ✅ explicit-path requirement + field-shape assertion + acceptance-barrier assertion are 3 distinct behaviors, each covered | ✅ Clean |
| 1.6/1.7 | `runtime/release-artifact.mjs` (generated) | Build parity | N/A (new module) | N/A — generator task, not itself a behavior under test | ✅ `node scripts/build-git-commit-transaction-runner.mjs --write` then `--check` both succeed | ➖ Single (structural generation, no branching to triangulate) | N/A |

## Test Summary

- **Total tests written**: 42 (in `tests/release-artifact.test.ts`)
- **Total tests passing**: 42/42
- **Layers used**: Unit (41), real-subprocess integration against GNU `tar` (1)
- **Approval tests** (refactoring): None — no refactoring tasks; this is new code
- **Pure functions created**: `treeDigest`, `enforceExtractionCaps`, `assertExactMemberSet`, `assertBundledSchemaMatches`, `resolveBootstrapArtifactSource`, `assertReleaseAcceptanceEvidence`, plus the internal path/key/entry validators — `decodeArtifactManifest` is pure given bytes; only `extractReleaseArtifact` and the system-tar port do I/O, and that I/O is fully injectable

## Work Unit Evidence (P1a)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/release-artifact.test.ts` → `pass 42 fail 0` |
| Runtime harness command/scenario and exact result | `pnpm run check:transaction-runner` → `commit transaction runtime matches TypeScript sources (5 modules)` |
| Rollback boundary | Delete `lib/release-artifact.ts`, `runtime/release-artifact.mjs`, `tests/release-artifact.test.ts`, `tests/fixtures/release-artifact/`; revert the one-line `sources` entry in `scripts/build-git-commit-transaction-runner.mjs`. No other file is touched by this PR. |

## Proof: the "added file" attack is caught (exact path-set equality before digesting)

Three independent tests prove this, at two levels:

1. `assertExactMemberSet rejects an extra archive member the manifest never declared (added-file attack)` — pure unit test, no I/O: an archive listing with one unlisted extra member is rejected, with the test's own comment explaining why a tree-digest-only check cannot catch this (a digest walk only ever revisits *declared* entries; it never notices something extra exists).
2. `extractReleaseArtifact rejects an added file before full extraction, even though the manifest member alone must still be read to decode it` — orchestration-level test using an in-memory fake extractor: proves the rejection happens at stage 3, strictly before stage 4 (`extractAll`) ever runs — `extractor.calls` after the rejection is exactly `["list", "extractMember:artifact-manifest.json"]`, never containing `"extractAll"`.
3. `createSystemReleaseArtifactExtractor lists and extracts a real archive, and the added-file case is still caught end-to-end` — builds two real `.tar.gz` archives with the system GNU `tar` binary (one clean, one with an extra `capabilities/evil.json` member never declared by the manifest) and proves the real production listing/extraction path rejects the tampered archive the same way the pure/fake-based tests do.

## Deviations from Design

None material. Two implementation choices fill gaps the design left open (design.md's Interfaces/Contracts section shows only `decodeArtifactManifest`/`treeDigest`/`SUPPORTED_CONTRACT_MAJOR` as the headline exports, not an exhaustive list):

1. **`assertBundledSchemaMatches(manifest, schemaBytes)`** — a small additional pure export implementing design D1 step 9 ("assert its `$id` equals `contract.schema_id` and its digest matches its own manifest entry"). This needs actual schema bytes, which `decodeArtifactManifest(bytes: Buffer)` alone cannot provide (it only receives the manifest bytes). Kept as a separate, directly-testable function rather than folding it into extraction, per the design's stated aversion to adding runtime validation surface.
2. **`resolveBootstrapArtifactSource` / `assertReleaseAcceptanceEvidence` / `RELEASE_ARTIFACT_EVIDENCE_CLASS`** — task 1.5 names a `--bootstrap-archive` CLI-flag behavior, but no sync CLI exists yet in P1a (that's task 2.2). Implemented as the underlying evidence-labeling primitives the future CLI flag will call: explicit-path enforcement, the `not-applicable/local-unsigned` signature status, and the barrier against being used as pin/acceptance evidence (spec "Bootstrap snapshot evidence never substitutes for release evidence").

## Issues Found

None. One environment note, not a code issue: this worktree had no `.gentle-ai/` runtime binary installed at session start (fresh worktree, `pnpm install` never ran), which cascaded into ~16 unrelated pre-existing test-file failures across the full `pnpm test` suite. Running `pnpm install` (triggered incidentally by `pnpm run check:transaction-runner`) installed the pinned binary via `postinstall` and resolved all of them except the three failures already called out as expected (RDD globally disabled) in `tests/native-review-parity-runtime.test.ts`. Verified via `git stash` that this file is bit-for-bit unmodified by this PR and the same three-failure result reproduces on the clean tree.

## Remaining Tasks (P1b and later — not started)

- [ ] 2.1-2.10 (PR 2 / P1b): signed sync path, mirrors, canonical lock, `verify-package-files.mjs` reconciliation, evidence-S/R labeling, CI wiring.
- [ ] 3.1-8.5 (PR 3-8 / P2a through P4): out of scope for this batch.

## Workload / PR Boundary

- Mode: feature-branch-chain, `size:exception` per tasks.md's Review Workload Forecast (`Delivery strategy: exception-ok`)
- Current work unit: P1a (PR 1, base: tracker branch `feat/consume-gentle-ai-release-artifacts`)
- Boundary: starts and ends entirely within `lib/release-artifact.ts` + its generated runtime + its tests/fixtures; touches exactly one existing line in `scripts/build-git-commit-transaction-runner.mjs` (`sources` list). No mirrors, lock, installer, or CI file touched.
- Estimated review budget impact: forecast ~250 changed lines for P1a; actual added/modified lines stay in that neighborhood (one new ~520-line lib file is generator-mirrored, not duplicated authored content — the `runtime/*.mjs` counterpart is machine-generated).

## Status

8/8 tasks in PR 1 (P1a) complete. Ready for `sdd-verify`, or for `sdd-apply` to continue with PR 2 (P1b) in a fresh batch.
