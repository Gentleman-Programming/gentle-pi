# Apply Progress: consume-gentle-ai-release-artifacts

> Cumulative across batches: **PR 1 / P1a** through **PR 7 / P3c**, all complete
> (tasks 1.1-7.8). PR 8 (P4) is NOT started.

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

## Remaining Tasks (P1a and P1b are both complete)

- [x] 2.1-2.10 (PR 2 / P1b): signed sync path, mirrors, canonical lock, `verify-package-files.mjs` reconciliation, evidence-S/R labeling, CI wiring.
- [ ] 3.1-8.5 (PR 3-8 / P2a through P4): out of scope for this batch.

## Workload / PR Boundary (P1a)

- Mode: feature-branch-chain, `size:exception` per tasks.md's Review Workload Forecast (`Delivery strategy: exception-ok`)
- Current work unit: P1a (PR 1, base: tracker branch `feat/consume-gentle-ai-release-artifacts`)
- Boundary: starts and ends entirely within `lib/release-artifact.ts` + its generated runtime + its tests/fixtures; touches exactly one existing line in `scripts/build-git-commit-transaction-runner.mjs` (`sources` list). No mirrors, lock, installer, or CI file touched.
- Estimated review budget impact: forecast ~250 changed lines for P1a; actual added/modified lines stay in that neighborhood (one new ~520-line lib file is generator-mirrored, not duplicated authored content — the `runtime/*.mjs` counterpart is machine-generated).

## Status (P1a)

8/8 tasks in PR 1 (P1a) complete.

---

# PR 2 / P1b: Signed sync path + mirrors + canonical lock

> Base: PR 1's branch (`feat/release-artifact-decoder`). Builds on `lib/release-artifact.ts` (owns D1
> steps 6-11) — this unit owns D1 steps 1-5, the network/pin-time trust boundary.

## Completed Tasks

- [x] 2.1 RED: `scripts/sync-gentle-ai-release.mjs` tests (`tests/sync-gentle-ai-release.test.ts`) — forged minisign signature (wrong signing key, tampered message, tampered trusted comment, each independently rejected); wrong trusted-comment repo/tag binding rejected (repo mismatch and tag mismatch as distinct cases); missing checksum line rejected; duplicate checksum line rejected.
- [x] 2.2 GREEN: `scripts/sync-gentle-ai-release.mjs` created — a from-scratch minisign verifier (Ed25519 wire-format parser + `node:crypto` verify, no third-party dependency), checksums.txt line matcher, trusted-comment repo/tag binder, and `syncGentleAiRelease()` orchestration implementing D1 steps 1-5 (resolve pinned identity, download or accept `--bootstrap-archive`, verify signature + binding, match the one checksum line, verify archive digest) before delegating to `lib/release-artifact.ts` for D1 steps 6-11 and D2 extraction.
- [x] 2.3 GREEN: mirrors written by running `sync-gentle-ai-release.mjs --write --bootstrap-archive <archive>` for real against a locally-built archive (see "Materializing the initial mirror + lock" below) — `contracts/review-integration/{v1,v2}/**` (64 files, byte-identical to the content that previously lived in the hand-maintained `contractHashes` map — verified via `git status`: zero diff on any existing tracked file), plus three new files this unit introduces: `contracts/release-artifact/v1/schemas/artifact-manifest.schema.json`, `capabilities/review-integration-v2.semantic.json`, `docs/gentle-ai/review-integration.md`.
- [x] 2.4 GREEN: `capabilities/gentle-ai-release.lock.json` created by the same sync run — canonical LF-only, 2-space indent, `entries`/`generated` sorted by raw path bytes (`buildGentleAiReleaseLock`), exactly one trailing LF (`canonicalLockJson`). `assertLockVersionPin`/`assertLockReleaseVersionPin` assert `lock.release.version === INSTALLER_VERSION` both at write time (sync script) and at every offline check (`verify-package-files.mjs`).
- [x] 2.5 RED: `scripts/verify-package-files.mjs` reconciliation tests added to `tests/verify-package-files.test.ts` — a file on disk under `docs/gentle-ai/` unlisted in the lock fails naming it; a lock entry with no file on disk under `capabilities/` fails naming it (while correctly excluding the lock file itself and the future hand-authored `capabilities/native-cli-history.json`); a digest drift fails naming the exact file and both digests.
- [x] 2.6 GREEN: `scripts/verify-package-files.mjs` — the ~60-entry hand-maintained `contractHashes` map deleted entirely; `reconcileContractsOnDisk` extended (same function name/pattern, not reinvented) to walk `MIRROR_WALK_ROOTS = ["contracts", "docs/gentle-ai", "capabilities"]` with an explicit exclusion set for non-mirror files; digests now come from `mirrorDigestsFromLock(lock)`, reading `capabilities/gentle-ai-release.lock.json` instead of a hardcoded table.
- [x] 2.7 RED: evidence-S/R labeling tests in `tests/sync-gentle-ai-release.test.ts` — a `syncGentleAiRelease` run against `--bootstrap-archive` returns `evidenceClass: "development/bootstrap"`, and `assertReleaseAcceptanceEvidence` (imported from `lib/release-artifact.ts`, P1a) throws on that result naming it barred from pin/final-acceptance evidence; proven both with `write: true` (mirrors+lock written) and `write: false`.
- [x] 2.8 GREEN: evidence labeling wired directly into `syncGentleAiRelease` — the bootstrap branch calls `resolveBootstrapArtifactSource` (P1a) and propagates its `evidenceClass`/`signatureStatus` verbatim into the result; the network branch stamps `evidenceClass: "release"`, `signatureStatus: "verified"` only after minisign + trusted-comment + checksum-line + archive-digest all pass. This matches explore.md §11's S-vs-R ledger table exactly (the section originally numbered §12 in the pre-rewrite plan).
- [x] 2.9 GREEN: `.github/workflows/ci.yml` — added a clarifying comment above the existing "Verify package contents" step: it now performs offline mirror/lock reconciliation as part of `verify-package-files.mjs`, and no job in this workflow downloads or verifies a minisign signature (that stays confined to the not-yet-landed pin-bump job, P4).
- [x] 2.10 Verify: `pnpm test` → 1065/1069 passing (3 known RDD-disabled failures in `tests/native-review-parity-runtime.test.ts`, file bit-for-bit unmodified by this PR; 1 pre-existing unrelated skip); `node scripts/verify-package-files.mjs --check` → `gentle-pi package resource check passed (69 files; 66 lock-pinned mirror artifacts at release v2.2.3).`, run with no network access available to the process.

## Materializing the initial mirror + lock (task 2.3/2.4 — how, and why it is safe)

No real signed gentle-ai release exists yet under the `gentle-ai.release-artifact` contract (that is
entirely the provider-side `publish-gentle-ai-release-artifacts` change, out of scope here), so tasks
2.3/2.4's "write mirrors" / "create the lock" could not be satisfied by a real `--write` network run in
this session. Instead, an uncommitted, one-off local script built a `development/bootstrap` archive
from:

1. **The existing real `contracts/review-integration/{v1,v2}/**` files, byte-for-byte unchanged** — read
   directly off disk and re-packed into the archive, so running the sync script against them is a
   verified no-op. Confirmed via `git status --short` after the sync run: zero modified lines on any
   previously-tracked file, only new files/directories appear.
2. **Three genuinely new mirror files** this unit introduces: the schema mirror (reusing P1a's
   already-established fixture bytes for this exact contract, `tests/fixtures/release-artifact/artifact-manifest.schema.json`), a semantic capability snapshot (`capabilities/review-integration-v2.semantic.json`, built from the real, already-checked-in v2 capability surface — same operations/gates/projections/features already present in `contracts/review-integration/v2/fixtures/capabilities.fixture.json`, re-labeled under the release-semantic-capabilities schema and the real pinned `2.2.3` version), and a placeholder provider-doc mirror (`docs/gentle-ai/review-integration.md`) carrying an explicit HTML-comment bootstrap-evidence notice.
3. `node scripts/sync-gentle-ai-release.mjs --write --bootstrap-archive <archive>` then ran for real
   against that archive, exercising the actual production write path (not a test double) to produce the
   checked-in mirror tree and `capabilities/gentle-ai-release.lock.json`.

This checked-in lock is **development/bootstrap evidence**, not release evidence — `syncGentleAiRelease`'s
returned `evidenceClass` for this exact run was `"development/bootstrap"`, and
`assertReleaseAcceptanceEvidence` throws on it. It proves the mirror-writing and lock-reconciliation
mechanism end-to-end and pins today's already-correct mirror bytes; it must be **regenerated** by a real
`--write` network run once gentle-ai publishes a signed release under this contract (P4's pin-bump job).
No test, doc, or commit in this unit claims otherwise.

## Design decision: the minisign trusted public key is a pending sentinel, not a placeholder key

`GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY = GENTLE_AI_RELEASE_TRUSTED_PUBLIC_KEY_PENDING` (a sentinel string,
mirroring the existing `GENTLE_AI_PENDING_DIGEST` pattern in `scripts/gentle-ai-installer.mjs`). The
network branch of `syncGentleAiRelease` throws immediately — before any fetch — while this sentinel is in
place: `scripts/sync-gentle-ai-release.mjs cannot verify a live release: the trusted minisign public key
is still the pending sentinel; pin the real gentle-ai release signing key before running a network sync`.
Verified manually: calling `syncGentleAiRelease({ packageRoot, write: false })` with no `bootstrapArchivePath` throws exactly this message with zero network activity. Filling in the real key is P4/pin-bump-job
work (tracked, not fabricated here) — no invented key is shipped that could later be confused for the
real one.

## Deviations from Design

None material to D1/D6. Two scope clarifications, not deviations:

1. **Minisign implementation is hand-written, not a library.** Design's rejected-alternatives table only
   discusses avoiding a JSON-Schema validator inside the *install* trust path (`ajv`); it does not name a
   minisign dependency choice for the *sync* script. A from-scratch Ed25519/minisign wire-format
   verifier (`node:crypto` only, no new dependency) was chosen for the same reasoning the design applies
   elsewhere: the sync script is a small, auditable, pin-bump-only surface, and a general-purpose
   minisign npm package would be a larger, less-audited dependency for a ~60-line wire format.
2. **`reconcileContractsOnDisk` gained a third parameter shape internally (`MIRROR_WALK_ROOTS`,
   `MIRROR_WALK_EXCLUSIONS`), not a new function.** Task 2.6 explicitly says "via `reconcileContractsOnDisk`" — the exported name, call sites, and 2-argument public signature are unchanged; only its internal walk now covers `docs/gentle-ai/` and `capabilities/` (with exclusions for the lock file itself and the future hand-authored `capabilities/native-cli-history.json`) in addition to the original `contracts/` root.

## Issues Found (and fixed as part of this unit)

1. **P1a gap surfaced by actually running `verify-package-files.mjs` end-to-end for the first time**:
   `runtime/release-artifact.mjs` and `lib/release-artifact.ts` were never added to
   `requiredPaths`/the three-way generated-runtime reconciliation, so the script failed immediately with
   `release-artifact: missing from requiredPaths`. Fixed by adding both entries (one-line each) — this is
   a correctness fix to existing P1a output, not new P1b scope creep; noted here for traceability.
2. **`capabilities/` was missing from `package.json`'s `files` allowlist.** Added, since the lock and
   semantic snapshot must ship in the published npm package like every other mirror directory.
3. No other issues. The three RDD-disabled `tests/native-review-parity-runtime.test.ts` failures are
   expected environment state (receipt-driven development is globally disabled here) — confirmed
   unmodified by `git diff --stat -- tests/native-review-parity-runtime.test.ts runtime/` (zero output).

## TDD Cycle Evidence (P1b)

| Task | Test File | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|-----|-------|-------------|----------|
| 2.1 | `tests/sync-gentle-ai-release.test.ts` | Unit | ✅ Written (`ERR_MODULE_NOT_FOUND` against `scripts/sync-gentle-ai-release.mjs` before it existed) | ✅ 18/18 pure-function tests pass | ✅ forged-signature covered 3 ways (wrong key, tampered message, tampered trusted comment); trusted-comment binding covered 2 ways (wrong repo, wrong tag); checksum line covered 3 ways (missing, duplicate, exact match) | ✅ Clean — parser/verifier/binder are small pure functions, no duplication |
| 2.2 | `tests/sync-gentle-ai-release.test.ts` | Unit + orchestration | ✅ Written before `syncGentleAiRelease` existed | ✅ bootstrap-path orchestration test passes against a real system-`tar` archive | ✅ `write: true` and `write: false` both covered | ✅ Clean — network branch and bootstrap branch share the same post-extraction write/lock path |
| 2.3/2.4 | manual production run (`node scripts/sync-gentle-ai-release.mjs --write --bootstrap-archive`) + `tests/sync-gentle-ai-release.test.ts` lock-shape tests | Integration (real tar, real filesystem) | N/A — generation task | ✅ mirrors + lock written; `git status` shows zero diff on pre-existing tracked files | ➖ single real run, no branching to triangulate | N/A |
| 2.5 | `tests/verify-package-files.test.ts` | Unit | ✅ Written (`reconcileContractsOnDisk`/`mirrorDigestDrift`/`mirrorDigestsFromLock`/`assertLockReleaseVersionPin` referenced before they existed with the new mirror-root behavior) | ✅ 13/13 tests pass | ✅ unlisted-on-disk, listed-but-missing, and digest-drift each independently proven, plus the lock-derivation and version-pin functions in isolation | ✅ Clean — reconciliation, drift, lock-derivation, and version-pin are four separate small functions |
| 2.6 | `tests/verify-package-files.test.ts` (existing 7 tests) | Regression | N/A (existing tests) | ✅ all 7 pre-existing tests still pass unmodified against the rewritten implementation | N/A | ✅ ~60-line hand-maintained map deleted; behavior fully covered by lock-derived tests instead |
| 2.7/2.8 | `tests/sync-gentle-ai-release.test.ts` | Unit + orchestration | ✅ Written referencing `RELEASE_ARTIFACT_EVIDENCE_CLASS.BOOTSTRAP` / `assertReleaseAcceptanceEvidence` before the orchestration wired them | ✅ both tests pass | ✅ proven with `write: true` (mirrors+lock side effects) and `write: false` (no side effects) | ✅ Clean — evidence labeling is a straight pass-through from `resolveBootstrapArtifactSource`, no duplicated logic |
| 2.9 | N/A — documentation/comment only | N/A | N/A | ✅ comment added, `pnpm test` and `verify-package-files.mjs --check` both still pass | N/A | N/A |
| 2.10 | Full suite | Integration | N/A | ✅ `pnpm test` 1065/1069 (3 expected RDD-disabled + 1 pre-existing unrelated skip); `verify-package-files.mjs --check` passes offline | N/A | N/A |

## Test Summary (P1b)

- **New test files**: `tests/sync-gentle-ai-release.test.ts` (18 tests)
- **Extended test files**: `tests/verify-package-files.test.ts` (+6 tests: 13 total, up from 7)
- **Total P1b tests**: 24 new, all passing
- **Full repo suite**: 1065/1069 passing (3 known RDD-disabled, 1 pre-existing unrelated skip) — unchanged failure set from the P1a baseline

## Work Unit Evidence (P1b)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/verify-package-files.test.ts tests/sync-gentle-ai-release.test.ts` → `pass 31 fail 0` |
| Runtime harness command/scenario and exact result | N/A — offline gate, no live binary invocation (per tasks.md's own Suggested Work Units table for P1b). Confirmed instead via `node scripts/verify-package-files.mjs --check` → `gentle-pi package resource check passed (69 files; 66 lock-pinned mirror artifacts at release v2.2.3).`, and via a direct manual call proving the network path fails closed with zero network activity while the trusted-key sentinel is in place. |
| Rollback boundary | Delete `scripts/sync-gentle-ai-release.mjs`, `tests/sync-gentle-ai-release.test.ts`, `capabilities/`, `contracts/release-artifact/`, `docs/gentle-ai/`; revert `scripts/verify-package-files.mjs`, `tests/verify-package-files.test.ts`, `package.json` (`capabilities/` files entry), `.github/workflows/ci.yml` (comment only) to restore the hand-maintained `contractHashes` map. No file outside this list is touched by this PR. |

## Workload / PR Boundary (P1b)

- Mode: feature-branch-chain, `size:exception` (tasks.md: `Delivery strategy: exception-ok`)
- Current work unit: P1b (PR 2, base: PR 1's branch `feat/release-artifact-decoder`)
- Boundary: `scripts/sync-gentle-ai-release.mjs` (new), `scripts/verify-package-files.mjs` (rewritten reconciliation only — `requiredPaths`/`files` additions are the sole P1a-gap fix folded in), their tests, the new mirror tree (`capabilities/`, `contracts/release-artifact/`, `docs/gentle-ai/`), `package.json` (`files` entry), and a comment-only `.github/workflows/ci.yml` change. No installer, binary-resolution, or generator file touched — those are P2a/P2b/P3a scope.
- Estimated review budget impact: tasks.md forecast ~320 changed lines for P1b. Authored diff across `.github/workflows/ci.yml`, `package.json`, `scripts/verify-package-files.mjs`, `tests/verify-package-files.test.ts` is ~174 lines changed (`git diff --stat`); `scripts/sync-gentle-ai-release.mjs` (356 lines) and `tests/sync-gentle-ai-release.test.ts` (320 lines) are new files. The generated mirror tree (`capabilities/`, `contracts/release-artifact/`, `docs/gentle-ai/`) is excluded from authored risk count per the review workload guard's "generated goldens are excluded from authored risk count" rule — these are sync-script-written mirror/lock artifacts, not hand-authored logic.

## Status (P1b)

10/10 tasks in PR 2 (P1b) complete. 18/18 tasks total across P1a+P1b. Ready for `sdd-verify`, or for
`sdd-apply` to continue with PR 3 (P2a) in a fresh batch. Task 3.1's guard is already satisfied:
`consolidate-review-parity-runtime` is archived (`openspec/changes/archive/2026-08-01-consolidate-review-parity-runtime/`) and `openspec/specs/package-runtime/spec.md` exists — confirmed present in this worktree, so PR 3/PR 4 (P2a/P2b) may open without the stall escape hatch.

---

# PR 3 / P2a: POSIX assets install + integrity manifest + resolver

Worktree: `gentle-pi-worktrees/p2a`. Branch: `feat/release-assets-install`, based on P1b's
`feat/release-artifact-sync`. Tasks 3.1-3.10, all complete.

## Task 3.1 Guard

Confirmed directly: `openspec/specs/package-runtime/spec.md` exists in this worktree (the sibling
`consolidate-review-parity-runtime` is archived). The stall escape hatch was not needed.

## TDD Cycle Evidence (P2a)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 3.2 `assetsTreeSha256` | `resolveGentleAiAssetsArchive reads the pinned archive identity from the canonical lock` + `...fails closed on a version mismatch or a malformed digest` (`tests/gentle-ai-installer.test.ts`) written before `resolveGentleAiAssetsArchive` existed; failed with `resolveGentleAiAssetsArchive is not a function` | Implemented `resolveGentleAiAssetsArchive` (`scripts/gentle-ai-installer.mjs`) reading `capabilities/gentle-ai-release.lock.json`; tests pass | Extracted `assetsLockDigest` helper shared by both digest fields |
| 3.3 extra file / symlink / mode 0755 / install.sh | `resolveGentleAiAssets rejects an extra file...`, `...rejects a symlinked asset`, `...rejects an asset with mode 0755`, `...keeps an asset named like install.sh non-executable...` (`tests/gentle-ai-binary.test.ts`) written before `resolveGentleAiAssets` existed; failed with `resolveGentleAiAssets is not a function` | Implemented `resolveGentleAiAssets` (`lib/gentle-ai-binary.ts`): exact-set check via reused `assertExactMemberSet`, then per-file `assertRegularNonSymlink`/mode/digest | All four tests green without further changes; shared `listAssetMembers` walker extracted |
| 3.4 TOCTOU whole-set | `resolveGentleAiAssets detects TOCTOU replacement of a non-endpoint entry across the whole file set` written first (initially failed: no injectable read hook existed) | Added `readEntryFile` injection point + before/after `sameFile` recheck over the manifest and every entry | Reused the existing `sameFile` helper already defined for the binary path |
| 3.5 forged assets digest rejected by `resolveGentleAiBinary` | `resolveGentleAiBinary still rejects a forged assets digest even when the binary itself verifies` written before `expectedRuntimeManifest`/`isCanonicalManifest` grew the assets keys; failed (old manifest shape had no assets fields to forge, so tampering had no observable target) | Extended `signedReleaseManifest`/`windowsSourceManifest`/`expectedRuntimeManifest` with the 5 assets keys; `isCanonicalManifest`'s existing exact-match discipline now covers them for free | None needed — the existing string-equality check absorbed the new keys unmodified |
| 3.6 assets missing ⇒ invalid ⇒ recovery | `installer treats an assets-less existing bundle as invalid and repairs it with a fresh full-bundle install` + `recoverInterruptedPublication refuses to silently restore a backup that is missing its assets bundle` written before `assetsBundleMatches` existed; failed (assets-less bundles were previously accepted as valid) | Added `assetsBundleMatches` and wired it into `existingSignedBundleMatches`/`existingWindowsSourceBundleMatches`, the same predicate `recoverInterruptedPublication` already took as a parameter | None — no new publish operation, per constraint #2 |

## The three carrying constraints — how each was proven

**1. Exact path-set equality precedes digesting.** `resolveGentleAiAssets` (`lib/gentle-ai-binary.ts`)
calls the P1a-authored `assertExactMemberSet` (reused, not re-implemented) against a filesystem walk of
`<bundle>/assets` *before* any per-file `lstat`/confinement/mode check runs, and before any digest is
read. Proven by `resolveGentleAiAssets rejects an extra file in the installed assets tree (added-file
attack)`: an unlisted `capabilities/evil.json` file is rejected purely by the path-set check — a tree
digest over "files found" could never have caught it, because a digest walk only ever revisits declared
entries.

**2. Interrupted-publication recovery comes free.** No new function was added to `publishBundle` or to
`recoverInterruptedPublication`'s call sites beyond passing the already-existing predicate parameter a
richer set of arguments. `assetsBundleMatches` was folded directly into
`existingSignedBundleMatches`/`existingWindowsSourceBundleMatches` — the exact one predicate
`recoverInterruptedPublication(runtimeRoot, bundleIsValid, options)` already took (`:509`, called at
`:602` and `:583`). Proven two ways:
  - `installer treats an assets-less existing bundle as invalid and repairs it with a fresh full-bundle
    install`: an installed bundle with its `assets/` directory deleted is no longer accepted as
    "existing and valid" — the very next `installGentleAi()` call re-stages and republishes a complete
    bundle, restoring `assets/artifact-manifest.json` (mirrors the pre-existing
    "installer repairs a valid non-executable POSIX binary" naming convention).
  - `recoverInterruptedPublication refuses to silently restore a backup that is missing its assets
    bundle`: a fake `rename` seam simulates a crash leaving only a backup bundle (via
    `rename(liveDirectory, backupDirectory)` outside of any install call, mirroring the existing Windows
    "recovers a valid backup after a crash between publication renames" pattern); when that backup itself
    predates assets (binary + integrity.json only, `assets/` removed), recovery throws
    `bundle recovery... manual intervention` rather than silently restoring it — the half-published
    (assets-less) state is provably unobservable as "good," never merely unlikely to occur.

**3. Integrity manifest extended, never weakened.** `isCanonicalManifest` (`lib/gentle-ai-binary.ts`,
`scripts/gentle-ai-installer.mjs`) is byte-for-byte unchanged: still exact key count + exact
`JSON.stringify` string equality. The 5 new keys (`assetsAsset`, `assetsArchiveSha256`,
`assetsTreeSha256`, `contractMajor`, `layoutVersion`) are appended via a shared
`assetsManifestFields`/`signedReleaseManifest`/`windowsSourceManifest` builder duplicated (by necessary
design, matching the existing binary-side duplication between the installer and the reader) in both
files, so writer and reader always agree on shape. Proven by
`resolveGentleAiBinary still rejects a forged assets digest even when the binary itself verifies`:
forging any one of `assetsTreeSha256`/`assetsArchiveSha256`/`contractMajor`/`layoutVersion` in an
otherwise-valid, binary-verified `integrity.json` still fails resolution. Every asset file gets its own
`assertRegularNonSymlink`/mode check in `resolveGentleAiAssets`'s per-file loop — not only the platform
binary.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `lib/gentle-ai-binary.ts` | Modified | Added `assetsManifestFields`/extended `signedReleaseManifest`/`windowsSourceManifest`/`expectedRuntimeManifest` with the 5 assets keys; extended `isCanonicalManifest`'s type to `Record<string, string \| number>` (discipline unchanged); resolved `assetsArchive` via `resolveGentleAiAssetsArchive` inside `resolveGentleAiBinary` (one small JSON read, no tree walk); added `gentleAiAssetsDirectoryPath`, `resolveGentleAiAssets`, `PackageLocalGentleAiAssetsMissingError`, `GENTLE_AI_ASSETS_MISSING_CODE`. |
| `runtime/gentle-ai-binary.mjs` | Regenerated | `node scripts/build-git-commit-transaction-runner.mjs --write`; `--check` confirms it matches `lib/gentle-ai-binary.ts` byte-for-byte (type-stripped). |
| `scripts/gentle-ai-installer.mjs` | Modified | Added `resolveGentleAiAssetsArchive` (reads `capabilities/gentle-ai-release.lock.json`, the canonical pin-time-written source — no second hand-maintained digest table); `assetsManifestFields`; `installAssets` (download + checksum + `extractReleaseArtifact` staging into `<staging>/assets`, cross-checked against the pinned tree digest/contract major/layout version); `assetsBundleMatches`; extended `existingSignedBundleMatches`/`existingWindowsSourceBundleMatches`/`installSignedRelease`/`installWindowsGentleAiFromGoSumdb`/`installGentleAi` to thread `assetsArchive` through, staging and publishing the assets bundle inside the SAME staging directory/atomic rename as the binary. |
| `tests/gentle-ai-binary.test.ts` | Modified | Added assets lock/bundle fixture writers used by `writeVerifiedBinary`/`writeWindowsSourceBinary` (so every pre-existing test keeps passing under the extended manifest); 8 new tests covering `resolveGentleAiAssets` success/missing/extra-file/symlink/mode/install.sh/TOCTOU and `resolveGentleAiBinary`'s forged-assets-digest rejection. |
| `tests/gentle-ai-installer.test.ts` | Modified | Added `installGentleAiForTest` wrapper supplying a default always-valid assets fixture (so all 36 pre-existing installer tests keep exercising binary behavior unmodified); updated the "canonical manifest key set" and Windows manifest `deepEqual` assertions for the 5 new keys; extended `copyWindowsBundle` to also copy `assets/`; 8 new tests covering `resolveGentleAiAssetsArchive`, assets staging, checksum/tree/contract/layout mismatches, assets-less bundle repair, backup-with-missing-assets recovery refusal, and forged-manifest reuse rejection. |
| `tests/support/gentle-ai-assets-fixture.ts` | Created | Shared assets-bundle fixture builder (`buildAssetsFixture`, `writeAssetsTree`, `makeAssetsExecutable`) reused by both test files, avoiding re-deriving the release-artifact manifest schema twice. |
| `openspec/changes/consume-gentle-ai-release-artifacts/tasks.md` | Modified | Ticked `[x]` for tasks 3.1-3.10. |

## Work Unit Evidence (P2a)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/gentle-ai-binary.test.ts tests/gentle-ai-installer.test.ts` → `pass 19` + `pass 44` = 63/63. Full suite: `node --experimental-strip-types --test tests/*.test.ts` → `tests 1087 / pass 1083 / fail 3 / skipped 1` — the 3 failures are the pre-existing, expected `tests/native-review-parity-runtime.test.ts` RDD-disabled failures (confirmed identical on the unmodified P1b tip via `git stash`); the 1 skip is the Windows-drive-letter test on a non-Windows runner (pre-existing, unrelated). |
| Runtime harness command/scenario and exact result | `pnpm run test:harness` fails in this sandbox, but **confirmed pre-existing and unrelated to P2a**: `git stash` (reverting to the unmodified `feat/release-artifact-sync` tip) reproduces a different-but-same-root-cause failure (`Gentle AI pre-pr gate could not reconsult review mode and failed closed.`) at the exact same assertion line — both are the sandbox's globally-disabled receipt-driven development, the same condition documented as expected for the 3 known test failures. `pnpm run check:transaction-runner` (the other 3.10-relevant runtime gate) passes clean: `commit transaction runtime matches TypeScript sources (5 modules)`. |
| Rollback boundary | Revert `lib/gentle-ai-binary.ts`, `runtime/gentle-ai-binary.mjs`, `scripts/gentle-ai-installer.mjs`, `tests/gentle-ai-binary.test.ts`, `tests/gentle-ai-installer.test.ts` to their P1b tip state; delete `tests/support/gentle-ai-assets-fixture.ts`. No sync-script, mirror, lock, generator, or Windows P2b file is touched — this PR is POSIX-only, per constraint. |

## Environment note

This worktree's `.gentle-ai/v2.2.3/integrity.json` is git-ignored, locally-materialized state from an
earlier `pnpm install` (predating this PR's manifest-shape change). Once `lib/gentle-ai-binary.ts` grew
the 5 assets keys, `resolveGentleAiBinary()` against the REAL default package root started failing
(`tests/native-review-cli.test.ts`'s "native output limits dominate..." test, which constructs
`RuntimeNativeReviewCliV214` with the default binary resolver) because the locally-installed manifest
predates the new shape. Patched the local (git-ignored, untracked) `integrity.json` in place with the 5
assets fields computed from the REAL committed `capabilities/gentle-ai-release.lock.json`
(`resolveGentleAiAssetsArchive(process.cwd())` — `assetsAsset: gentle-ai_2.2.3_assets.tar.gz`,
`assetsArchiveSha256`/`assetsTreeSha256` from the lock, `contractMajor: 1`, `layoutVersion: 1`). No real
`assets/` directory was created locally, since `resolveGentleAiBinary` never reads it (hot path stays one
file hash, per design D4) and nothing in this repo's test suite calls `resolveGentleAiAssets()` against
the real default package root. This is local dev-environment state only — `.gentle-ai/` is git-ignored
and carries no PR diff.

## Deviations from Design

None — implementation matches design D3/D4. One addition beyond the literal task list: `resolveGentleAiAssets`
gained a 3rd optional `readEntryFile` parameter (mirroring `resolveGentleAiBinary`'s existing `readBinary`
injection point) to make the TOCTOU whole-set recheck independently testable without relying on real
process-level race timing, exactly the same testing pattern already used for the binary path's own
"runtime rejects binary replacement during verification" test.

## Remaining Tasks

- [ ] PR 4 — P2b: Windows split provenance + cross-check + bundle lifecycle (tasks 4.1-4.9), depends on PR 3
- [ ] PR 5 — P3a through PR 8 — P4: not started

## Workload / PR Boundary (P2a)

- Mode: feature-branch-chain, `size:exception` (tasks.md: `Delivery strategy: exception-ok`)
- Current work unit: P2a (PR 3, base: P1b's branch `feat/release-artifact-sync`)
- Boundary: `lib/gentle-ai-binary.ts` (+ generated `runtime/gentle-ai-binary.mjs`), `scripts/gentle-ai-installer.mjs`, their tests, and the new shared test fixture. No sync script, mirror/lock, generator, Windows-specific manifest field, or CI workflow file touched.
- Estimated review budget impact: tasks.md forecast ~350 changed lines for P2a. Authored diff (`git diff --stat`, excluding the regenerated `runtime/gentle-ai-binary.mjs` mirror of `lib/gentle-ai-binary.ts`) is roughly 830 changed lines across `lib/gentle-ai-binary.ts`, `scripts/gentle-ai-installer.mjs`, both test files, and the new fixture support file — above the 400-line reviewer budget and above the tasks.md forecast, driven by the two large pre-existing test files (`tests/gentle-ai-installer.test.ts` at 39 install call sites, `tests/gentle-ai-binary.test.ts`'s shared fixture helpers) each needing every existing call site to keep exercising binary-only behavior unchanged under the new atomic bundle shape. `Delivery strategy: exception-ok` (tasks.md forecast: `400-line budget risk: High`, `Decision needed before apply: No`) already covers this.

## Status (P2a)

10/10 tasks in PR 3 (P2a) complete. 28/28 tasks total across P1a+P1b+P2a. Ready for `sdd-verify`, or for
`sdd-apply` to continue with PR 4 (P2b) in a fresh batch, based on this branch (`feat/release-assets-install`).

---

# PR 4 / P2b: Windows split provenance + cross-check + bundle lifecycle

Worktree: `gentle-pi-worktrees/p2b`. Branch: `feat/release-assets-windows`, based on P2a's
`feat/release-assets-install`. Tasks 4.1-4.9, all complete.

## Scope discovery: D5's read-side and manifest threading were already complete

Before writing any RED test, `codegraph_explore` + direct reads of `scripts/gentle-ai-installer.mjs` and
`lib/gentle-ai-binary.ts` confirmed P2a had already threaded `assetsArchive` through
`installWindowsGentleAiFromGoSumdb`/`existingWindowsSourceBundleMatches`/`windowsSourceManifest` (both the
installer's copy and `lib/gentle-ai-binary.ts`'s read-side copy) as an unavoidable consequence of sharing
one atomic-bundle code path across POSIX and Windows in P2a. This means **task 4.6 ("`windowsSourceManifest`
gains the assets keys") was already GREEN going into this PR** — proven by the pre-existing P2a test
"Windows source manifest binds verified Go metadata and architecture" (`tests/gentle-ai-installer.test.ts`),
which already `deepEqual`s a manifest containing both provenance groups. This is noted here rather than
silently re-claimed: P2b's actual new production surface is the capability cross-check (4.7) and bundle
pruning (4.8), not the manifest shape itself.

## TDD Cycle Evidence (P2b)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 4.1 subprocess cross-check failure modes | `Windows capability cross-check fails closed on subprocess failure, oversized output, or non-JSON output, publishing nothing` written before `crossCheckWindowsCapabilities`/`GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE` existed; failed with `pruneSupersededBundles`/import errors and `unexpected command: ... review capabilities` from the fixture | Implemented `crossCheckWindowsCapabilities` — subprocess rejection (non-zero exit, simulated maxBuffer overflow) and `JSON.parse` failure both caught and rethrown as `GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED`; wired after `assertExactGentleAiVersion`, before `installAssets`/publish | Shared `capabilityNameSets`/`sameNameSet`/`capabilitiesCrossCheckMismatch` helpers reused for both the mismatch path (4.3) and the parse-and-compare path |
| 4.2 split-provenance | `Windows fresh install publishes one manifest carrying both SumDB binary provenance and signed-archive assets provenance` — a regression-locking test, since the underlying manifest shape was already GREEN from P2a (see Scope Discovery above); it asserts both key groups' presence and `assetsArchiveSha256` equality to the pinned archive digest in one manifest | Already satisfied; no new production code | N/A |
| 4.3 cross-check mismatch fails closed | `Windows capability cross-check mismatch fails closed and publishes nothing, never regenerating the signed snapshot` — varies only `options.capabilitiesSnapshot` (the "expected" input the installer only ever reads) while the fixture's live subprocess output stays the unchanged default, isolating the mismatch to the comparison itself | `capabilitiesCrossCheckMismatch` throws `GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED` naming "do not match the signed release snapshot"; asserted no `gentle-ai.exe`/`integrity.json`/`assets/` published | Same helper as 4.1 |
| 4.4 prune retention/failure policy | Three tests written before `pruneSupersededBundles` existed (import-time `SyntaxError`): retention (keep live + immediately-previous, prune older), failure-is-logged-and-non-fatal, and reuse-never-prunes | Implemented `pruneSupersededBundles(runtimeRoot, options)` — sorts superseded `v<x>.<y>.<z>` directories descending, keeps index 0 (immediately previous), prunes the rest; injectable `removeSupersededBundle`/`logPruneWarning` seams | `bundleVersionOf`/`compareBundleVersionsDescending` extracted as small pure helpers |
| 4.5 skip symmetry | `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1 skips binary and assets symmetrically...` (`tests/install-gentle-ai.test.ts`, new file) — passed on first run; see "Task 4.5" section below for why | Already satisfied; no new production code | N/A |
| 4.6 `windowsSourceManifest` assets keys | N/A — already GREEN from P2a (see Scope Discovery) | N/A | N/A |
| 4.7 sealed capability cross-check | Same RED as 4.1/4.3 | `crossCheckWindowsCapabilities` — fixed argv (`["review", "capabilities", "--contract", "gentle-ai.review-integration/v2"]`), `shell:false` via the existing `runCommand`/`commandOptions` seam, bounded output via the same `GO_COMMAND_MAX_BUFFER` `maxBuffer` `go install` already uses, sealed `environment` object already built by `sealedGoEnvironment` | See "How the cross-check cannot create authority" below |
| 4.8 `pruneSupersededBundles` wiring | Same RED as 4.4, plus `pruneSupersededBundles is wired to run only after a fresh publish succeeds...` and `...does not run when an existing bundle is reused...` | Called immediately after the `publishBundle` rename succeeds in BOTH `installWindowsGentleAiFromGoSumdb` and `installSignedRelease` (D3's "P2" scope spans both platforms; P2a had not wired it yet) | N/A |
| 4.9 Verify | — | `node --experimental-strip-types --test tests/gentle-ai-installer.test.ts tests/gentle-ai-binary.test.ts tests/install-gentle-ai.test.ts` → `pass 72 fail 0`; full suite `pass 1083 / fail 1 (pre-existing)`; `pnpm run test:harness` fails for the same pre-existing reason as P1b/P2a (see Issues Found) | — |

## How the cross-check cannot create authority (proof, not assertion)

`crossCheckWindowsCapabilities` (`scripts/gentle-ai-installer.mjs`) has **zero write side effects** —
grep-verifiable: the function contains no `writeFile`/`rename`/`mkdir` call anywhere in its body. It only:

1. Reads the "expected" snapshot — from `options.capabilitiesSnapshot` (test injection point) or, in
   production, from the checked-in `capabilities/review-integration-v2.semantic.json` mirror via
   `readGentleAiCapabilitiesSnapshot` (a plain `JSON.parse(readFileSync(...))`, no write path, mirroring
   `resolveGentleAiAssetsArchive`'s existing lock-read pattern).
2. Invokes the freshly-built `gentle-ai.exe` with `["review", "capabilities", "--contract", ...]` to get
   the "observed" live output.
3. Compares `contract`/`operations`/`gates`/`projections`/feature-name sets, and either returns (no
   observable effect) or throws.

Placement is the other half of the proof: the call sits strictly **between** `assertExactGentleAiVersion`
and `installAssets`/`writeFile(integrity.json)`/`publishBundle` inside `installWindowsGentleAiFromGoSumdb`
— every write in the install happens strictly after it, so a thrown `GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED`
guarantees none of them ran. `Windows capability cross-check fails closed on subprocess failure, oversized
output, or non-JSON output, publishing nothing` and `...mismatch fails closed and publishes nothing...`
both assert this directly: `gentle-ai.exe`, `integrity.json`, AND `assets/` are all absent from the runtime
directory after every failure mode. `Windows capability cross-check never runs on a pure reuse` additionally
proves the cross-check does not even execute on a verified-reuse path (no re-invocation of the binary), so
it can never regenerate or re-stamp anything on an already-trusted bundle either.

## Interpreting design D5's "compare operation/gate/projection/schema/feature name sets"

The checked-in `capabilities/review-integration-v2.semantic.json` mirror carries `contract`, `operations`,
`gates`, `projections`, and `features.{mandatory,optional}` — it has **no separate `schemas` array** (that
field exists only in the runtime's own negotiated-capabilities JSON shape, `lib/review-integration-v2.ts`'s
`ReviewCapabilitiesV2.schemas`, which is a different, larger contract-negotiation surface this install-time
cross-check deliberately does not import or depend on). `capabilityNameSets`/`capabilitiesCrossCheckMismatch`
therefore compare the four fields both shapes genuinely share (`operations`/`gates`/`projections`/feature
names) plus the top-level `contract` identity string as the closest available analog to "schema" identity.
This is a documented interpretation, not a silent narrowing — flagged here per the "note it, don't
silently deviate" rule.

## Pruning policy actually implemented (and why it differs from a literal reading of design.md)

design.md's D3 section says `pruneSupersededBundles(runtimeRoot)` "removes `v<other-version>` directories
... never the live one." Read alone, that could mean "prune every non-live version." The task prompt for
this PR was more specific: **keep exactly the immediately-previous bundle for rollback and remove the
rest** — not keep everything, not keep only the current one. Implemented accordingly:
`pruneSupersededBundles` sorts every `v<major>.<minor>.<patch>`-named sibling directory (excluding live)
descending by parsed version, keeps index 0 (the highest-versioned survivor — "the immediately previous
bundle"), and prunes every other one. Proven by three tests: retention (`v2.2.2` kept, `v2.1.0` pruned,
live `v2.2.3` untouched, and non-versioned dotted paths — backups/staging/lock — never even considered
candidates), failure-is-non-fatal-and-logged (only the one older-than-kept candidate is ever attempted;
its simulated failure is logged via an injectable `logPruneWarning` seam and does not throw), and
reuse-never-prunes (a pure cache-hit reuse, with no `publishBundle` rename, leaves a stale sibling directory
completely untouched — pruning is causally tied to a successful rename, not to every `installGentleAi`
call).

## Task 4.5: why the RED test passed immediately

`scripts/install-gentle-ai.mjs`'s `GENTLE_PI_SKIP_GENTLE_AI_INSTALL === "1"` check is a single guard
wrapping the ONE call site (`installGentleAi()`) that would otherwise install both the binary and the
assets bundle as one atomic staged bundle (P2a's D3). There is no second, independent skip check for
"assets only" or "binary only" that could disagree with the first — skipping the call skips both by
construction. `tests/install-gentle-ai.test.ts` spawns the real script as a subprocess with
`GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1`, snapshots `.gentle-ai/` directory entries before and after via
`readdir`, and asserts they are byte-for-byte identical (in this sandbox, both empty — no network access
to complete a real install even without the flag), plus asserts the exact warning text on stderr. The test
passed on its first run because the symmetric-skip property was already true by construction from an
earlier PR (#262/#263), not something P2b needed to build; the test locks the invariant rather than driving
new production code, and is reported here as such rather than mischaracterized as a driven RED→GREEN cycle.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `scripts/gentle-ai-installer.mjs` | Modified | Added `GENTLE_AI_CAPABILITIES_CROSS_CHECK_FAILED_CODE`, `GENTLE_AI_CAPABILITIES_SNAPSHOT_RELATIVE_PATH`, `readGentleAiCapabilitiesSnapshot`, `capabilityNameSets`, `sameNameSet`, `capabilitiesCrossCheckMismatch`, `crossCheckWindowsCapabilities` (wired into `installWindowsGentleAiFromGoSumdb` between `assertExactGentleAiVersion` and `installAssets`); added `bundleVersionOf`, `compareBundleVersionsDescending`, exported `pruneSupersededBundles` (wired after `publishBundle` succeeds in BOTH `installWindowsGentleAiFromGoSumdb` and `installSignedRelease`). |
| `tests/gentle-ai-installer.test.ts` | Modified | Added `DEFAULT_CAPABILITIES_SNAPSHOT`/`DEFAULT_CAPABILITIES_OUTPUT` fixtures threaded through `installGentleAiForTest` (mirrors P2a's `DEFAULT_ASSETS_ARCHIVE` pattern); extended `windowsGoFixture`/`hardenedWindowsGoFixture` to answer `["review","capabilities",...]` subprocess calls (with `capabilitiesOutput`/`capabilitiesError` override points) so all pre-existing Windows fresh-install tests keep passing unmodified; 4 new cross-check tests (4.1/4.2/4.3 + a reuse-never-cross-checks regression test) and 4 new `pruneSupersededBundles` tests (4.4/4.8). |
| `tests/install-gentle-ai.test.ts` | Created | Subprocess-spawn test for the `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1` symmetric-skip guarantee (task 4.5), against the real `scripts/install-gentle-ai.mjs` entrypoint. |
| `openspec/changes/consume-gentle-ai-release-artifacts/tasks.md` | Modified | Ticked `[x]` for tasks 4.1-4.9. |

## Work Unit Evidence (P2b)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/gentle-ai-installer.test.ts tests/gentle-ai-binary.test.ts tests/install-gentle-ai.test.ts` → `tests 72 / pass 64 / fail 0 / skipped 8`. Full suite: `node --experimental-strip-types --test tests/*.test.ts` → `tests 1097 / pass 1083 / fail 1 / skipped 12` — the 1 failure is `tests/native-review-cli.test.ts`'s "native output limits dominate..." test, confirmed pre-existing and identical before/after this PR's diff via `git stash` (root cause: this sandbox has no network access at all, so no real `.gentle-ai/v2.2.3/gentle-ai` binary was ever installed here — a stricter version of the same "sandbox has no working native binary" condition P1b/P2a already documented for the 3 `tests/native-review-parity-runtime.test.ts` failures, which in this sandbox specifically SKIP rather than FAIL for the identical reason). |
| Runtime harness command/scenario and exact result | `pnpm run test:harness` fails with the same message already documented as pre-existing/expected in P2a (`Gentle AI pre-pr gate could not reconsult review mode and failed closed.` — globally-disabled receipt-driven development); confirmed identical via `git stash` against the unmodified P2a tip. `node scripts/build-git-commit-transaction-runner.mjs --check` (the runtime-generation gate this PR's changes could plausibly have broken, since `scripts/gentle-ai-installer.mjs` is plain `.mjs`, not a `sources`-listed TypeScript module) passes clean: `commit transaction runtime matches TypeScript sources (5 modules)`. |
| Rollback boundary | Revert `scripts/gentle-ai-installer.mjs`, `tests/gentle-ai-installer.test.ts` to their P2a tip state; delete `tests/install-gentle-ai.test.ts`. No `lib/gentle-ai-binary.ts`, `runtime/gentle-ai-binary.mjs`, sync script, mirror/lock, or CI workflow file is touched by this PR — the Windows cross-check and prune wiring are fully contained inside `scripts/gentle-ai-installer.mjs`, and the POSIX install path (already complete from P2a) is unaffected: the only POSIX-visible change is `pruneSupersededBundles` now also running after `installSignedRelease`'s publish, itself independently revertible by deleting that one added line. |

## Deviations from Design

1. **Pruning retention policy** — see "Pruning policy actually implemented" above: keeps the
   immediately-previous bundle, not "every non-live version." This is a refinement of design.md's D3
   wording (which is compatible with, but does not explicitly state, this policy) driven by this PR's
   explicit task instructions; documented rather than silently applied.
2. **"Schema" cross-check field** — see "Interpreting design D5's..." above: compared via the top-level
   `contract` identity string, since the checked-in semantic mirror carries no separate `schemas` array.

## Issues Found

None new. Confirmed via `git stash` (both before implementing and after) that this sandbox has no network
access at all (`pnpm install`'s `postinstall` step fails with `HTTP 404` against GitHub releases), so
`.gentle-ai/v2.2.3/gentle-ai` is never installed here — a stricter version of the same environment
condition already documented in P1b/P2a. This surfaces as one additional pre-existing failure beyond the
3 already-known `tests/native-review-parity-runtime.test.ts` failures: `tests/native-review-cli.test.ts`'s
"native output limits dominate killed timeout signals..." test now fails (rather than skips) with
`package-local-binary-missing` instead of reaching the RDD-disabled assertion it expects. Confirmed
identical on the unmodified P2a tip via `git stash` — not introduced by this PR.

## Remaining Tasks

- [ ] PR 5 — P3a through PR 8 — P4: not started.

## Workload / PR Boundary (P2b)

- Mode: feature-branch-chain, `size:exception` (tasks.md: `Delivery strategy: exception-ok`)
- Current work unit: P2b (PR 4, base: P2a's branch `feat/release-assets-install`)
- Boundary: `scripts/gentle-ai-installer.mjs` (capability cross-check + bundle pruning only — no manifest
  shape change, that was already P2a), its test file, and one new test file for the skip-symmetry guarantee.
  No `lib/gentle-ai-binary.ts`, generated runtime, sync script, mirror/lock, or CI workflow file touched.
- Estimated review budget impact: tasks.md forecast ~260 changed lines for P2b. Authored diff
  (`git diff --stat` plus the new `tests/install-gentle-ai.test.ts` file) is ~360 changed lines — above the
  400-line budget's midpoint but within the same `exception-ok`/`size:exception` delivery strategy already
  in force for this entire tracker (tasks.md: `400-line budget risk: High`, `Decision needed before apply:
  No`).

## Status (P2b)

9/9 tasks in PR 4 (P2b) complete. 37/37 tasks total across P1a+P1b+P2a+P2b. Ready for `sdd-verify`, or for
`sdd-apply` to continue with PR 5 (P3a) in a fresh batch, on a new branch based on this one
(`feat/release-assets-windows`).

---

# PR 5 / P3a: Generators — baselines, generated floor, capability row

Worktree: `gentle-pi-worktrees/p3a`. Branch: `feat/release-artifact-generators`, based on P2b's
`feat/release-assets-windows`. Tasks 5.1-5.10, all complete.

## The paradox this unit resolves, and how (design.md D7)

The spec requires `REQUIRED_*` to be generated; the plan requires the floor to stay frozen so a removal
stays visible. Resolved via **monotone regeneration**, implemented as a self-referential fixed point:
`monotoneFloor(previousRequired, advertised, label)` reads `previousRequired` from the CHECKED-IN
`lib/gentle-ai-required-floor.generated.ts` itself (parsed via regex, `parseRequiredFloorModule`, never
executed — same "read the generator's own emitted shape without importing it" convention already used by
`extractGeneratedRuntimeSources` in `scripts/verify-package-files.mjs`). `--write` computes
`union(previousRequired, advertisedCurrent)` — names can only be ADDED. If any name in `previousRequired`
is absent from the current snapshot, generation FAILS naming it (`monotoneFloor` in
`scripts/build-gentle-ai-baselines.mjs`). There is no code path that removes an entry automatically: to
retire a requirement, a human hand-edits the checked-in generated `.ts` file to delete that line — a
visible, reviewable diff on a file whose header says "Do not edit" is exactly the signal a reviewer needs.
The NEXT `--write` then continues forward from that smaller, human-approved baseline (the file re-reads
itself). Proven directly by `tests/build-gentle-ai-baselines.test.ts`:
- `monotoneFloor accepts a snapshot that adds a new required name` (5.1)
- `monotoneFloor rejects a snapshot that drops a previously required name` (5.2)
- `build-gentle-ai-baselines.mjs --write fails naming a required entry that disappeared from a shrunk
  snapshot` — end-to-end subprocess proof against a real fixture repo copy, not only the pure function.

Same discipline for mandatory features, but via a DIFFERENT mechanism (design.md explicitly separates
these: "Mandatory features | Exact set, no tolerance", distinct from the monotone floors). An advertised
mandatory feature absent from Pi's set fails naming it and is never auto-added:
`assertMandatoryFeaturesSupported` checks the snapshot's `features.mandatory[].name` against
`PI_SUPPORTED_MANDATORY_FEATURES` — a constant hand-authored **inside the generator script itself**,
deliberately NOT derived from the snapshot (a provider superset must never silently become Pi's
requirement) and NOT derived from `lib/review-integration-v2.ts`'s own `REQUIRED_MANDATORY_FEATURES`
constant (a generator that read its own consumer's hand-authored answer to grade that exact answer would
prove nothing — Pi's supported set is a decision, not a mirror, per this unit's own brief).
`lib/review-integration-v2.ts`'s `FEATURE_NAMES`/`OPTIONAL_FEATURE_NAMES`/`REQUIRED_MANDATORY_FEATURES`
therefore stay hand-authored and untouched; a comment now explains why they are the one exact-set
exception to D7's "generated" list.

## Only 13 of the 17 capability flags derive from the snapshot — and only 5 of those 13 map by name

`capabilities/review-integration-v2.semantic.json`'s real `operations[]` for the pinned v2.2.3 release is
`[bind_sdd, capabilities, finalize, repair, retry_final_verification, start, status, validate]` (8 items).
Only 5 of `NATIVE_CLI_CONTRACTS`'s 13 non-envelope columns (`start`, `finalize`, `validate`, `bindSdd`,
`status`) correspond to a `review.<op>` operation by name. The other 8 columns
(`sddStatus`, `inventory`, `reclaim`, `recover`, `abandon`, `quarantineLegacy`, `reconcileAuthority`,
`repairLegacyAlias`) are pre-negotiated-contract CLI subcommands with no `operations[]` counterpart at
all — the negotiated review-integration/v2 snapshot has never advertised them and structurally cannot.
`OPERATION_COLUMN_MAP` in `scripts/build-gentle-ai-baselines.mjs` is therefore a hand-maintained,
explicit `review.<op> -> column | null` map (5 real mappings + 3 explicit `null` entries for
`review.capabilities`/`review.repair`/`review.retry_final_verification`, which Pi has decided are not
version-gated boolean capabilities); the 8 columns with no map entry at all use `CARRY_FORWARD_COLUMNS`,
sourced from the immediately preceding frozen historical row (`findPreviousHistoricalRow`). This is an
interpretation of design.md's "13 of 17 flags derive from snapshot operations[]" wording, documented
rather than silently narrowed — the design's own file-changes table does not enumerate the exact map, and
the real snapshot only supports 5 direct name matches. **Proof this cannot silently pass an unmodeled
operation**: `deriveCapabilityRow fails with the exact unmapped-operation message when a snapshot operation
has no client mapping` constructs a synthetic operation absent from `OPERATION_COLUMN_MAP` entirely (not
even as `null`) and asserts the exact spec-mandated message
(`gentle-ai <v> advertises operation "<op>" with no NativeCliCapability column. Add the column and its
decoder in lib/native-review-cli.ts, then re-run --write.`).

## The 12 frozen rows move verbatim — proven by self-consistency, not merely asserted

`capabilities/native-cli-history.json` carries the 12 pre-existing `NATIVE_CLI_CONTRACTS` rows
(`2.1.4`-`2.2.3`) byte-for-byte, with their original inline comments re-emitted as JSON `notes` arrays.
Rows strictly older than the pinned version are copied verbatim into the generated output, untouched. The
row for the CURRENTLY PINNED version (`2.2.3`, which happens to already be the last historical entry
today, since no real pin bump has landed yet) is always **recomputed** fresh from the snapshot + history's
`envelopeFlags`, then cross-checked (`deriveCapabilityRow`'s `knownRow` parameter) against history's own
recorded `2.2.3` entry — a disagreement throws naming the mismatched columns rather than silently
overwriting. Running `node scripts/build-gentle-ai-baselines.mjs --write` against the real repository
reproduced the original 12 rows **byte-identical** to what was previously hand-authored in
`lib/native-review-cli.ts` (confirmed via `git diff`-free re-run — see Work Unit Evidence below) — the
generator's derivation is provably correct against known-good historical data, not merely internally
self-consistent.

## Only 4 of the 17 capability flags stay hand-declared (envelope shape)

`mode`/`riskEvidence`/`hint`/`delivery` have no snapshot data source (design.md: "envelope-shape flags with
no data source in the snapshot"). They come from `capabilities/native-cli-history.json`'s `envelopeFlags`
for the pinned version, which `deriveCapabilityRow` requires to exist and be all-boolean — proven by
`deriveCapabilityRow fails naming the version when envelopeFlags is missing` (5.5) and
`...fails when an envelopeFlags column is not a boolean`.

## REQUIRED_SCHEMAS and mandatory features stay hand-authored (documented scope boundary)

The checked-in `capabilities/review-integration-v2.semantic.json` mirror carries `operations`, `gates`,
`projections`, `features` — but no `schemas` array (that field exists only on the LIVE negotiated
`review.capabilities` response `lib/review-integration-v2.ts` decodes at runtime, a strictly larger
surface than the offline pack-time mirror; this exact gap was already documented in P2b's design D5 note).
`REQUIRED_SCHEMAS` therefore stays hand-authored in `lib/review-integration-v2.ts`, unlike
`REQUIRED_OPERATIONS`/`REQUIRED_GATES`/`REQUIRED_PROJECTIONS`, which now come from
`lib/gentle-ai-required-floor.generated.ts`. Both boundaries are commented in place, not silently applied.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `capabilities/native-cli-history.json` | Created | 12 frozen historical `NATIVE_CLI_CONTRACTS` rows moved verbatim (13 capability flags + 4 envelope flags each), original inline comments re-emitted as `notes` arrays. |
| `scripts/build-gentle-ai-baselines.mjs` | Created | `--write`/`--check` generator (CLI shape of `build-git-commit-transaction-runner.mjs:34-60`, plus an `isMainModule` guard — see Deviations) emitting `lib/gentle-ai-required-floor.generated.ts`: monotone `REQUIRED_OPERATIONS`/`REQUIRED_GATES`/`REQUIRED_PROJECTIONS`, exact-set mandatory-feature validation, and the derived/cross-checked `NATIVE_CLI_CONTRACTS`. |
| `lib/gentle-ai-required-floor.generated.ts` (+ `runtime/gentle-ai-required-floor.generated.mjs`) | Created (generated) | `REQUIRED_OPERATIONS`/`REQUIRED_GATES`/`REQUIRED_PROJECTIONS`/`NATIVE_CLI_CONTRACTS`/`NativeCliCapability`, written by `--write`, verified by `--check`. Registered as `"gentle-ai-required-floor.generated"` in `scripts/build-git-commit-transaction-runner.mjs`'s `sources` list for its own `.ts` -> `.mjs` transpile. |
| `lib/review-integration-v2.ts` (+ runtime) | Modified | Imports `REQUIRED_OPERATIONS`/`REQUIRED_GATES`/`REQUIRED_PROJECTIONS` from the generated floor instead of defining them inline; `REQUIRED_SCHEMAS`/`REQUIRED_MANDATORY_FEATURES`/`FEATURE_NAMES`/`OPTIONAL_FEATURE_NAMES` unchanged, with an explanatory comment on why each stays hand-authored. |
| `lib/native-review-cli.ts` (+ runtime) | Modified | Imports `NATIVE_CLI_CONTRACTS`/`NativeCliCapability` from the generated floor and re-exports `NATIVE_CLI_CONTRACTS` (public API preserved); the ~55-line hand-authored table + `ORGANIC_PARITY_DARK` helper deleted. |
| `scripts/verify-package-files.mjs` | Modified | `requiredPaths` gains `lib/gentle-ai-required-floor.generated.ts`, `runtime/gentle-ai-required-floor.generated.mjs`, `scripts/build-gentle-ai-baselines.mjs`. |
| `.github/workflows/ci.yml` | Modified | Added "Verify generated gentle-ai baselines" step running `node scripts/build-gentle-ai-baselines.mjs --check`, offline, after "Verify package contents". |
| `package.json` | Modified | Added `build:gentle-ai-baselines`/`check:gentle-ai-baselines` convenience scripts, mirroring the existing `*-transaction-runner` pair. |
| `tests/build-gentle-ai-baselines.test.ts` | Created | 19 tests: pure-function coverage for every RED scenario in 5.1-5.5, carry-forward/disagreement cross-check coverage, a render/parse round trip, and 3 real-subprocess end-to-end tests (`--check` against the real repo, `--write` idempotency, `--write` failing a shrunk fixture). |
| `openspec/changes/consume-gentle-ai-release-artifacts/tasks.md` | Modified | Ticked `[x]` for tasks 5.1-5.10. |

## TDD Cycle Evidence (P3a)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 5.1 | `monotoneFloor accepts a snapshot that adds a new required name` written before `scripts/build-gentle-ai-baselines.mjs` existed; whole test file failed with `ERR_MODULE_NOT_FOUND` (proven by temporarily moving the script aside and re-running -- see Work Unit Evidence) | `monotoneFloor` implemented; test passes | Shared by 5.2 (same function, opposite branch) |
| 5.2 | `monotoneFloor rejects a snapshot that drops a previously required name` + `...names every disappeared entry, not only the first` | Same `monotoneFloor` implementation | Clean -- one function, no duplication |
| 5.3 | `assertMandatoryFeaturesSupported fails naming an advertised mandatory feature Pi does not support, never auto-adding it` | `assertMandatoryFeaturesSupported` implemented against `PI_SUPPORTED_MANDATORY_FEATURES` | Clean |
| 5.4 | `deriveCapabilityRow fails with the exact unmapped-operation message...` asserts the byte-exact spec message | `deriveCapabilityRow`'s unmapped-operation guard, checked against every advertised operation before any column is populated | `OPERATION_COLUMN_MAP` extracted as a named, documented constant rather than an inline literal |
| 5.5 | `deriveCapabilityRow fails naming the version when envelopeFlags is missing...` + `...fails when an envelopeFlags column is not a boolean` | `deriveCapabilityRow`'s envelope-flags presence/shape guard, checked first | Clean |
| 5.6/5.7 | N/A -- generator/data creation tasks, not themselves behaviors under test | `capabilities/native-cli-history.json` + `scripts/build-gentle-ai-baselines.mjs` created; `--write` against the real repo reproduces the 12 original rows byte-identical | `renderGeneratedFloorModule`/`parseRequiredFloorModule` factored out and round-trip tested independently |
| 5.8 | Pre-existing test `tests/native-review-capability-contract.test.ts` (unmodified) is the regression lock: it already asserted exact row values/order/dark-column invariants against `NATIVE_CLI_CONTRACTS` imported from `lib/native-review-cli.ts` | Rewiring `lib/native-review-cli.ts`/`lib/review-integration-v2.ts` to import from the generated floor; all 8 pre-existing tests in that file still pass unmodified | `ORGANIC_PARITY_DARK` helper and the 55-line inline table deleted entirely from `lib/native-review-cli.ts` |
| 5.9 | N/A -- CI wiring | `.github/workflows/ci.yml` step added | N/A |
| 5.10 | N/A -- verification task | `pnpm test` (minus the one documented environmental failure) and `node scripts/build-gentle-ai-baselines.mjs --check` both pass | N/A |

## Work Unit Evidence (P3a)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/build-gentle-ai-baselines.test.ts tests/native-review-capability-contract.test.ts` -> `pass 26 fail 0`. RED baseline proven by temporarily moving `scripts/build-gentle-ai-baselines.mjs` aside and re-running the same command: `ERR_MODULE_NOT_FOUND`, 1 file failing, 0 passing -- then restored and all 19 new tests plus the 7 pre-existing capability-contract tests passed on the very first implementation (no fix-forward iterations were needed once the design's operation/carry-forward/cross-check model was written down). |
| Runtime harness command/scenario and exact result | `node scripts/build-gentle-ai-baselines.mjs --check` -> `gentle-ai baselines match their checked-in sources (lib/gentle-ai-required-floor.generated.ts)` (this unit's own harness command per tasks.md's Suggested Work Units table). Also: `node scripts/build-git-commit-transaction-runner.mjs --check` -> `commit transaction runtime matches TypeScript sources (6 modules)`; `node scripts/verify-package-files.mjs` -> `gentle-pi package resource check passed (72 files; 66 lock-pinned mirror artifacts at release v2.2.3).` |
| Rollback boundary | Delete `capabilities/native-cli-history.json`, `scripts/build-gentle-ai-baselines.mjs`, `lib/gentle-ai-required-floor.generated.ts`, `runtime/gentle-ai-required-floor.generated.mjs`, `tests/build-gentle-ai-baselines.test.ts`; revert the one-line `sources` entry in `scripts/build-git-commit-transaction-runner.mjs`; restore the hand-authored `REQUIRED_OPERATIONS`/`REQUIRED_GATES`/`REQUIRED_PROJECTIONS` in `lib/review-integration-v2.ts` and the hand-authored `NATIVE_CLI_CONTRACTS` table in `lib/native-review-cli.ts` (both fully preserved in this diff's removed lines); revert the CI step, the two requiredPaths entries, and the two package.json scripts. No P1/P2 trust code (decoder, sync, installer, assets resolution) is touched by this unit. |

## Full-suite proof (`pnpm test`)

`node --experimental-strip-types --test tests/*.test.ts` -> `tests 1115 / pass 1102 / fail 1 / skipped 12`.
The 1 failure is `tests/native-review-cli.test.ts`'s "native output limits dominate killed timeout
signals..." test -- the same pre-existing, sandbox-only failure already documented in P2b's evidence (no
network access here, so `.gentle-ai/v2.2.3/gentle-ai` was never installed by `postinstall`). Confirmed
identical on the unmodified P2b tip via `git stash -u`: the same command fails the exact same way before
any of this unit's changes exist. `pnpm run test:harness` (chained by `pnpm test`) also fails in this
sandbox with the same documented cause as P2a/P2b (`pnpm install`'s dependency-status recheck needs
network); reproduced identically via `git stash -u` against the unmodified tip. Neither failure is new or
related to this unit.

## Deviations from Design

1. **`isMainModule` guard, not an unconditional top-level `main()` call.** `build-git-commit-transaction-runner.mjs`
   runs `main()` unconditionally at module load; `scripts/build-gentle-ai-baselines.mjs` instead uses the
   `isMainModule` guard pattern already established in `scripts/verify-package-files.mjs`. This is required,
   not stylistic: `tests/build-gentle-ai-baselines.test.ts` imports the script's pure functions directly
   (`monotoneFloor`, `deriveCapabilityRow`, etc.), and an unconditional `main()` would attempt real
   filesystem/process side effects (and set `process.exitCode`) as a side effect of merely importing the
   module for testing.
2. **`OPERATION_COLUMN_MAP` is a hand-maintained allowlist with explicit `null` entries**, not a pure
   `review.<op> -> column` total function over the snapshot's operations. See "Only 13 of the 17... " above
   -- the real snapshot only supports 5 direct name matches; the design's "13 of 17" figure describes the
   column count needing derivation, not a 1:1 name correspondence with today's actual operations list.
3. **`CARRY_FORWARD_COLUMNS`** for the 8 legacy CLI columns with no `operations[]` counterpart at all is an
   addition beyond the design's literal text (which describes only the operation-mapped and
   history-envelope-sourced parts). Documented here rather than silently introduced; proven by
   `deriveCapabilityRow carries legacy CLI columns forward...` and
   `...fails when a carry-forward column has no prior frozen row to carry from`.
4. **`knownRow` cross-check** in `deriveCapabilityRow` (comparing the freshly derived current-version row
   against history.json's own recorded entry for that version, when one exists) is an addition beyond the
   literal task list -- a defense-in-depth self-consistency proof, not a requirement any RED test names
   directly, though `deriveCapabilityRow fails when the freshly derived row disagrees with its known
   historical record` covers it.

## Issues Found

None. This worktree's `node_modules` did not exist at session start (fresh worktree, no prior `pnpm
install`); running `pnpm install` succeeded from the local pnpm store with no network access needed for
dependencies themselves, but its `postinstall` step still failed to download the `.gentle-ai/v2.2.3`
binary (`HTTP 404`, no network) -- the same environment condition already documented in every prior unit
of this tracker, cascading into the one documented `tests/native-review-cli.test.ts` failure above.

## Remaining Tasks

- [ ] PR 6 -- P3b through PR 8 -- P4: not started.

## Workload / PR Boundary (P3a)

- Mode: feature-branch-chain, `size:exception` (tasks.md: `Delivery strategy: exception-ok`)
- Current work unit: P3a (PR 5, base: P2b's branch `feat/release-assets-windows`)
- Boundary: `scripts/build-gentle-ai-baselines.mjs` (new), `capabilities/native-cli-history.json` (new),
  the generated floor pair (new), its test file (new), and the `lib/review-integration-v2.ts`/
  `lib/native-review-cli.ts` rewiring (+ their generated runtime counterparts). `scripts/verify-package-files.mjs`
  gains three `requiredPaths` entries; `.github/workflows/ci.yml` gains one offline check step; `package.json`
  gains two convenience scripts. No installer, binary-resolution, assets, sync-script, mirror/lock, or
  Windows-provenance file touched -- P1/P2 trust code is entirely untouched by this unit.
- Estimated review budget impact: tasks.md forecast ~300 changed lines for P3a. Authored diff across
  existing files (`git diff --stat`, excluding generated `.ts`/`.mjs` goldens) is ~71 insertions / ~126
  deletions (net negative -- deleting the 55-line hand-authored table more than offsets the new imports).
  New authored files add `scripts/build-gentle-ai-baselines.mjs` (303 lines), `tests/build-gentle-ai-baselines.test.ts`
  (255 lines), and `capabilities/native-cli-history.json` (271 lines, mechanically restructured from
  pre-existing hand-authored data, not newly invented content). `lib/gentle-ai-required-floor.generated.ts`
  (35 lines) and `runtime/gentle-ai-required-floor.generated.mjs` (35 lines) are generated goldens, excluded
  from authored risk count per the review workload guard. Total authored new-file lines (~829) plus the
  existing-file diff push this unit above the 400-line budget, already covered by the tracker-wide
  `Delivery strategy: exception-ok` (tasks.md: `400-line budget risk: High`, `Decision needed before apply:
  No`).

## Status (P3a)

10/10 tasks in PR 5 (P3a) complete. 47/47 tasks total across P1a+P1b+P2a+P2b+P3a. Ready for `sdd-verify`,
or for `sdd-apply` to continue with PR 6 (P3b) in a fresh batch, on a new branch based on this one
(`feat/release-artifact-generators`).

---

# PR 6 / P3b: Skill vendor + overlay

Worktree `gentle-pi-worktrees/p3b`, branch `feat/skill-vendor-overlay`, based on P3a's
`feat/release-artifact-generators`. Implements tasks 6.1-6.8 (design.md D8).

## Completed Tasks

- [x] 6.1 RED: overlay anchor missing upstream fails the exact message `edit the overlay, not the vendored file: skills/_vendor/<name>/overlay.md` (fixture pair `tests/fixtures/skill-overlays/stale-anchor/{vendored.SKILL.md,overlay.md}`).
- [x] 6.2 RED: hand-edit of a vendored `skills/_vendor/**` file detected by the digest drift gate against `skills/_vendor/manifest.json`.
- [x] 6.3 GREEN: created `scripts/build-skill-overlays.mjs` (`--write`/`--check`).
- [x] 6.4 GREEN (5 independent revertible admissions): first-tier candidates compared and admitted — `comment-writer`, `work-unit-commits`, `branch-pr`, `chained-pr`, `cognitive-doc-design`.
- [x] 6.5 GREEN (4 candidates compared, 2 admitted): second-tier — `skill-improver` and `skill-registry` admitted; `judgment-day` and `skill-creator` rejected.
- [x] 6.6 GREEN: confirmed `skills/issue-creation/SKILL.md` stays excluded entirely — not vendored, no gate.
- [x] 6.7 GREEN: `.github/workflows/ci.yml` — added `build-skill-overlays.mjs --check` to the per-PR gate.
- [x] 6.8 Verify: `pnpm test` equivalent (`node --experimental-strip-types --test tests/*.test.ts`) and `node scripts/build-skill-overlays.mjs --check` both pass.

## The overlay mechanism (design D8)

```
skills/_vendor/<name>/SKILL.md     written only by the sync script; read-only to humans.
skills/_vendor/<name>/overlay.md   hand-authored, ordered <!-- overlay:block --> anchor/replace pairs.
skills/_vendor/manifest.json       { skills: { <name>: { path, sha256 } } } -- the recorded digest
                                    each vendored file must still match; the drift gate's anchor.
skills/<name>/SKILL.md             scripts/build-skill-overlays.mjs's output: vendored body with
                                    every overlay block applied, in file order.
```

`applyOverlay` requires each anchor to occur in the vendored body **exactly once** (`body.split(anchor).length - 1 === 1`); zero occurrences (upstream reworded it away) and more than one occurrence (now ambiguous) both fail with the identical message from task 6.1, since both point at the same remediation: edit the overlay, never the vendored file. `main()` iterates `Object.keys(manifest.skills)`, not a hardcoded name list, so each admission's manifest entry is independently addable/revertible without the generator needing to know the final admitted set in advance.

## Vendored-body seeding: a scope note, not a deviation

Design's data-flow diagram shows `sync-gentle-ai-release.mjs --write` producing `skills/_vendor/**` (D8, alongside contracts/lock/mirrors from P1b). None of tasks 6.1-6.8 asks for that wiring, and the release archive fixture (`tests/fixtures/release-artifact/artifact-manifest.fixture.json`) confirms skills are not part of the release asset tree at all — gentle-ai's skills live in its own repository checkout (`internal/assets/skills/`), a separate source from the signed release artifact P1/P2 already consume. Wiring a live provider-repository sync (git-based, not archive-based) is therefore out of this unit's task list and this sandbox's no-network reach; it is left for a follow-up unit (see Remaining Tasks). For this PR, `skills/_vendor/<name>/SKILL.md` was seeded as a byte-for-byte, manually verified copy of the provider's current `internal/assets/skills/<name>/SKILL.md` at `/home/gentleman/work/gentle-ai` — functionally identical to what a real sync run would write, with each byte and its recorded `sha256` cross-checked (`skills/<name>/SKILL.md` after `--write` was diffed against the pre-existing checked-in file for every one-line/zero-line-delta candidate, confirming an exact match; work-unit-commits' and skill-improver's expected deltas were confirmed via `git diff` on the generated output, see per-admission commits).

## Per-skill portability comparison (task 6.4 + 6.5) — full results

Every candidate on the maintainer's allowlist was compared file-by-file against gentle-ai's copy at
`/home/gentleman/work/gentle-ai/internal/assets/skills/<name>/SKILL.md` before any admission. Being on the
list never admitted a skill by itself.

### First tier (task 6.4) — 5/5 admitted

| Candidate | Diff vs. gentle-ai | Repository identity encoded? | Result | Overlay |
|---|---|---|---|---|
| `comment-writer` | +1 sentence in the "Match target context language" rule ("Do not use the active persona as the source of truth for public comments.") | No | **Admitted** | 1 anchor block |
| `work-unit-commits` | gentle-pi's checked-in copy was *missing* 3 Work Unit Checklist items and the "implementation evidence MUST include" paragraph gentle-ai already had | No | **Admitted** | 0 blocks — vendored (fuller) body flows straight through; this repo already requires the same evidence via `skills/sdd-apply`'s Work Unit Evidence hard gate, so gentle-pi was simply stale |
| `branch-pr` | Only `name: branch-pr` (upstream) vs `name: gentle-ai-branch-pr` (gentle-pi, pre-existing collision-prefix fix, `tests/skill-collision-prefixes.test.ts`) | No | **Admitted** | 1 anchor block (name) |
| `chained-pr` | Only the same name-prefix pattern as `branch-pr` | No | **Admitted** | 1 anchor block (name) |
| `cognitive-doc-design` | Byte-identical | No | **Admitted** | 0 blocks |

### Second tier (task 6.5) — 2/4 admitted, 2 rejected

| Candidate | Diff vs. gentle-ai | Repository identity encoded? | Result | Reason |
|---|---|---|---|---|
| `skill-improver` | 17 of 54 lines differ, across 7 bounded, nameable points: the name prefix plus 6 self-contained wording deltas (skill-style-guide fallback chain, `.atl/skill-registry.md` availability note, `/skill-registry:refresh` vs `gentle-ai skill-registry refresh`) | No | **Admitted** | Every delta is a self-contained sentence/bullet, genuinely overlay-representable — 7 anchor blocks |
| `skill-registry` | Byte-identical | No | **Admitted** | 0 blocks |
| `judgment-day` | 96 of 52/76 lines differ: near-total section rewrite (Hard Rules → Transaction Rules, Decision Gates removed, Execution Steps expanded 6→9 steps, an entirely new Fix Boundary section, an entirely new Lifecycle Boundary section referencing gentle-pi's own receipt/lineage/native-RAR architecture with no upstream counterpart); version numbers even diverge in the *opposite* direction (gentle-ai 1.6, gentle-pi 1.4) | No literal repo name/labels, but the body encodes gentle-pi's own bounded-review lifecycle architecture that has no upstream shape | **Rejected** | Too extensive for an anchored overlay — admitting it would need one anchor spanning almost the entire body, which is functionally the "full fork" representation design.md D8 explicitly rejected ("makes what Pi actually changed invisible in review") |
| `skill-creator` | 106 of 104/86 lines differ: Hard Rules, Decision Gates, and Execution Steps every row reworded/reordered; an "Inline Fallback Rules" section removed entirely; a new gentle-pi-specific `scripts/verify-package-files.mjs` registration step added | No | **Rejected** | Same reasoning as `judgment-day` — near-total rewrite, not a bounded set of anchors |

### Excluded entirely (task 6.6) — no comparison run, no gate

`issue-creation` was not compared and is not vendored. Confirmed via two tests
(`issue-creation is excluded entirely...`, `issue-creation carries no skills/_vendor directory...`): the two
repositories' copies describe genuinely different repositories by design (gentle-pi links its own
Discussions URL/generic Affected-Area taxonomy; gentle-ai names its own repo, labels, and templates) — the
task's own diff between the two copies (149 vs. 223 lines, almost nothing shared) confirms this is identity,
not drift to reconcile.

### `assets/agents/**` / `assets/chains/**`

Untouched by this unit, confirmed by inspection — no byte-vendoring, no gate added here; that phase-coverage
gate is explicitly PR 7 / P3c's task 7.3/7.4, not this one's.

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `scripts/build-skill-overlays.mjs` | Created | `--write`/`--check` generator: `parseOverlayBlocks`, `applyOverlay` (exact-one-occurrence anchor discipline), `sha256Hex`/digest drift gate, `VENDORED_SKILLS`/`REJECTED_CANDIDATES`/`EXCLUDED_SKILLS` documentation constants. |
| `skills/_vendor/manifest.json` | Created | `{ skills: { <name>: { path, sha256 } } }` for the 7 admitted candidates — the drift gate's recorded-digest source of truth. |
| `skills/_vendor/{comment-writer,work-unit-commits,branch-pr,chained-pr,cognitive-doc-design,skill-improver,skill-registry}/SKILL.md` | Created | Byte-for-byte vendored copies of gentle-ai's current skill bodies. |
| `skills/_vendor/{comment-writer,work-unit-commits,branch-pr,chained-pr,cognitive-doc-design,skill-improver,skill-registry}/overlay.md` | Created | Ordered `<!-- overlay:block -->` anchor/replace pairs (or an explicit zero-block note) per admitted candidate. |
| `skills/work-unit-commits/SKILL.md` | Modified (generated) | Grew by 11 lines — Pi catching up to gentle-ai's fuller content (see portability table). |
| `skills/{comment-writer,branch-pr,chained-pr,cognitive-doc-design,skill-improver,skill-registry}/SKILL.md` | Regenerated, byte-identical | `--write` reproduced the pre-existing checked-in bytes exactly — proves the vendored+overlay content matches what was already hand-maintained there. |
| `tests/build-skill-overlays.test.ts` | Created | 15 tests: `parseOverlayBlocks`/`applyOverlay` unit coverage, the 6.1/6.2 RED fixture-pair and full-CLI failure scenarios, real-repo `--check`/`--write` idempotency, admission-list and rejection-list assertions, issue-creation exclusion. |
| `tests/fixtures/skill-overlays/stale-anchor/{vendored.SKILL.md,overlay.md}` | Created | Self-contained fixture pair for the 6.1 anchor-missing scenario. |
| `.github/workflows/ci.yml` | Modified | Added "Verify generated skill overlays" step running `node scripts/build-skill-overlays.mjs --check`, offline, after the gentle-ai baselines check. |
| `package.json` | Modified | Added `build:skill-overlays`/`check:skill-overlays` convenience scripts, mirroring the existing generator pairs. |
| `openspec/changes/consume-gentle-ai-release-artifacts/tasks.md` | Modified | Ticked `[x]` for tasks 6.1-6.8. |

## TDD Cycle Evidence (P3b)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 6.1 | `applyOverlay fails with the exact overlay-not-vendored message...` against the `stale-anchor` fixture pair, plus a full-CLI `--check` scenario reproducing the same failure through a temp fixture root — both written and run before `scripts/build-skill-overlays.mjs` existed (`ERR_MODULE_NOT_FOUND` on the whole test file) | `applyOverlay`'s exact-one-occurrence check implemented; both tests pass | `applyOverlay fails the same way when an anchor now occurs more than once` added to prove the ambiguous-match branch shares the identical remediation message, not a silent guess |
| 6.2 | `build-skill-overlays.mjs --check fails when a vendored file has been hand-edited (digest drift)` via a self-contained fixture (recorded digest vs. hand-edited bytes) | `buildOneSkill`'s digest comparison against `manifest.json`, checked before the overlay is even parsed | Clean — one guard, one message |
| 6.3 | Covered by 6.1/6.2's `ERR_MODULE_NOT_FOUND` baseline (whole-module RED) plus `parseOverlayBlocks extracts anchor/replace pairs in file order` and `applyOverlay replaces every anchor exactly once, in order` written against the not-yet-existing exports | `parseOverlayBlocks`/`applyOverlay`/`sha256Hex`/`main()` implemented; `--check` against the real repo passes with an empty manifest (`0 skills`) | `applyOverlay is a no-op over an empty block list` added to lock in the zero-delta admission case used by 3 of the 7 candidates |
| 6.4/6.5 | Each admission commit ran the full `tests/build-skill-overlays.test.ts` + `tests/skill-collision-prefixes.test.ts` suite against the growing manifest before committing (see per-commit evidence below) | `node scripts/build-skill-overlays.mjs --write` after each manifest entry; `git status`/`git diff` inspected per admission to confirm only the intended file(s) changed | N/A — no refactor, additive by design (manifest-key-driven iteration needed no generator changes across all 7 admissions) |
| 6.6 | `issue-creation is excluded entirely...` + `...carries no skills/_vendor directory and no overlay` written alongside the 6.1-6.3 test file (both passed immediately — nothing to vendor, nothing to break) | N/A — confirmatory, no production code | N/A |
| 6.7 | N/A — CI wiring | `.github/workflows/ci.yml` step added; `node scripts/build-skill-overlays.mjs --check` re-run locally to confirm the exact command the step runs | N/A |
| 6.8 | N/A — verification task | Full suite + all four offline generators pass (see Work Unit Evidence) | N/A |

## Work Unit Evidence (P3b)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/build-skill-overlays.test.ts tests/skill-collision-prefixes.test.ts tests/skill-registry.test.ts` -> `pass 44 fail 0` (final state, all 7 admissions applied). RED baseline proven twice: (a) the whole test file failed with `ERR_MODULE_NOT_FOUND` before `scripts/build-skill-overlays.mjs` existed; (b) `node scripts/build-skill-overlays.mjs --check` genuinely failed with `generated skill file is stale: skills/work-unit-commits/SKILL.md` before the first `--write`, proving the check actually detects the pre-existing, stale, hand-maintained copy rather than trivially passing. |
| Runtime harness command/scenario and exact result | `node scripts/build-skill-overlays.mjs --check` -> `skill overlays match their checked-in sources (7 skills: branch-pr, chained-pr, cognitive-doc-design, comment-writer, skill-improver, skill-registry, work-unit-commits)` (this unit's own harness command per tasks.md's Suggested Work Units table). Also: `node scripts/build-gentle-ai-baselines.mjs --check`, `node scripts/build-git-commit-transaction-runner.mjs --check`, and `node scripts/verify-package-files.mjs` all still pass unmodified. |
| Rollback boundary | Each admission is independently revertible via its own commit: `git revert <sha>` for any one of the 7 `feat(skills): vendor <name>...` commits removes exactly that skill's `skills/_vendor/<name>/**` and its manifest entry, and (except for `work-unit-commits`, whose content actually changed) leaves `skills/<name>/SKILL.md` unaffected since `build-skill-overlays.mjs` iterates only the manifest's present keys. Reverting the whole PR restores every `skills/<name>/SKILL.md` to its prior hand-maintained state (the diff shows only `work-unit-commits/SKILL.md` net-changed) and deletes `scripts/build-skill-overlays.mjs`, `skills/_vendor/**`, the two convenience scripts, the CI step, and the test file — P1/P2/P3a trust and generator code is entirely untouched by this unit. |

## Full-suite proof (`node --experimental-strip-types --test tests/*.test.ts`)

`tests 1130 / pass 1117 / fail 1 / skipped 12` (1115 pre-existing + 15 new in `tests/build-skill-overlays.test.ts`).
The 1 failure is the same pre-existing, sandbox-only, no-network `tests/native-review-cli.test.ts` "native
output limits dominate killed timeout signals..." failure documented in every prior unit of this tracker
(`.gentle-ai/v2.2.3/gentle-ai` was never installed by `postinstall`, `HTTP 404`, no network in this sandbox).
Not new, not related to this unit. `pnpm test`/`pnpm run test:harness` fail for the same documented reason
(`pnpm install`'s dependency-status recheck needs network) — ran the direct `node --experimental-strip-types
--test` invocation instead, matching every prior unit's documented workaround.

## Deviations from Design

1. **Vendored-body seeding is manual for this PR, not wired through `scripts/sync-gentle-ai-release.mjs`.**
   See "Vendored-body seeding: a scope note, not a deviation" above — none of tasks 6.1-6.8 asks for that
   wiring, the release archive does not contain skill files at all (confirmed against the fixture manifest),
   and gentle-ai's skills live in a separate repository checkout reachable only via a git-based sync this
   sandbox cannot perform (no network). The generator, drift gate, and anchor discipline are exactly as
   designed; only the *initial write* of `skills/_vendor/**` bytes came from a manual, cross-checked copy
   instead of a live `sync-gentle-ai-release.mjs --write` run.
2. **`REJECTED_CANDIDATES`/`EXCLUDED_SKILLS` are exported documentation constants**, not literal design.md
   text — added so the rejection/exclusion reasoning is enforced by a real assertion (`main()` refuses to
   let either set appear in the manifest) rather than living only in prose.

## Issues Found

None new. Same `node_modules`/`postinstall` HTTP 404 environment condition documented in every prior unit;
`pnpm install` still succeeds from the local pnpm store, only the `.gentle-ai/v2.2.3` binary download fails.

## Remaining Tasks

- [ ] PR 7 -- P3c (phase-coverage gate + generic evidence harness) through PR 8 -- P4: not started.
- [ ] Follow-up (not in this unit's task list): wire live skill mirroring into `scripts/sync-gentle-ai-release.mjs`
  so `skills/_vendor/**` is written by a real network sync rather than this PR's manual seed. Until then, a
  future re-sync of an admitted skill still requires a human to re-copy the vendored bytes and re-run
  `--write`; the drift gate correctly still catches a hand-edit of the vendored file itself.

## Workload / PR Boundary (P3b)

- Mode: feature-branch-chain, `size:exception` (tasks.md: `Delivery strategy: exception-ok`)
- Current work unit: P3b (PR 6, base: P3a's branch `feat/release-artifact-generators`)
- Boundary: `scripts/build-skill-overlays.mjs` (new), `skills/_vendor/**` (new, 7 skills), `tests/build-skill-overlays.test.ts`
  + its fixtures (new). `skills/work-unit-commits/SKILL.md` net-changed (+11 lines); every other
  `skills/<name>/SKILL.md` regenerated byte-identical. `.github/workflows/ci.yml` gains one offline check
  step; `package.json` gains two convenience scripts. No P1/P2/P3a file touched.
- Estimated review budget impact: tasks.md forecast ~280 changed lines for P3b. Actual diff is 1201
  insertions across 22 files (`git diff --stat` against P3a's tip), well above the estimate — the vendored
  `skills/_vendor/<name>/SKILL.md` mirrors (~609 lines) are byte-for-byte copies of already-existing,
  already-reviewed upstream content, functionally equivalent to the "generated goldens" the review workload
  guard excludes from authored risk count. Authored new content (generator ~181, overlay.md deltas ~117,
  tests + fixtures ~241, manifest ~32, CI/package.json ~10, work-unit-commits diff ~11) is ~592 lines,
  still above 400 — already covered by the tracker-wide `Delivery strategy: exception-ok` (tasks.md:
  `400-line budget risk: High`, `Decision needed before apply: No`), same policy P3a operated under.

## Status (P3b)

8/8 tasks in PR 6 (P3b) complete. 55/55 tasks total across P1a+P1b+P2a+P2b+P3a+P3b. Ready for `sdd-verify`,
or for `sdd-apply` to continue with PR 7 (P3c) in a fresh batch, on a new branch based on this one
(`feat/skill-vendor-overlay`).

---

# PR 7 / P3c — Phase-coverage gate + generic evidence harness

**Worktree**: `gentle-pi-worktrees/p3c`, **branch**: `feat/phase-coverage-evidence`, based on P3b's
`feat/skill-vendor-overlay`.

## Maintainer decision superseding tasks.md 7.1 (recorded, not silently deviated)

Task 7.1's wording says a provider-declared phase with no Pi binding "fails". **The maintainer decided it
WARNS instead**, naming the missing phase, and does **not** fail CI. Reasoning, as given: under the
provider's fast release cadence new phases appear regularly, and blocking the build for a phase nobody has
decided to implement yet trains people to ignore the gate — a gate that cries wolf gets muted, and then it
protects nothing.

**The reverse direction is unchanged and still fails**: a Pi agent binding naming no declared phase, and not
listed Pi-only, is a real inconsistency in Pi's own configuration (not a provider-cadence problem) and
breaks the build.

Implemented as `phaseCoverageGate()` in `scripts/verify-package-files.mjs`: `missingBindings` (forward
direction) are reported with `console.warn` and never reach a `process.exit(1)` branch; `unknownBindings`
(reverse direction) are reported with `console.error` and do reach `process.exit(1)`. The two arrays are
computed and handled through entirely separate code paths — there is no shared branch that could
accidentally promote a warning into a failure or vice versa.

## Design interpretation note: reverse check scope is `assets/agents/**` only

`design.md` D9 titles the gate "for `assets/agents/**` and `assets/chains/**`" and task 7.1 says "a Pi
binding naming no declared phase … fails" without restricting that to agents. In practice, reconciling the
**real** trees settles this: gentle-ai (`~/work/gentle-ai`, `internal/assets/claude/agents/`) declares
exactly 18 phases (`jd-fix-agent`, `jd-judge-a`, `jd-judge-b`, `review-readability`, `review-refuter`,
`review-reliability`, `review-resilience`, `review-risk`, `sdd-apply`, `sdd-archive`, `sdd-design`,
`sdd-explore`, `sdd-init`, `sdd-onboard`, `sdd-propose`, `sdd-spec`, `sdd-tasks`, `sdd-verify`) and **has no
`chains/` directory at all** (confirmed by direct filesystem check, matching design.md's "upstream has no
chains/ directory at all"). Pi's `assets/agents/**` has 24 files: those 18 (with `sdd-proposal` ↔
`sdd-propose` aliased) plus the 6 declared-Pi-only names from task 7.3 — an exact 18+6=24 reconciliation with
**zero** extra Pi-only entries needed. Pi's `assets/chains/**` has 4 files (`4r-review`, `sdd-full`,
`sdd-plan`, `sdd-verify`); 3 of those 4 names match no declared phase and aren't in task 7.3's fixed Pi-only
list. Since task 7.3 gives an exact, closed Pi-only set (not "at least"), the only interpretation that
reconciles the real tree without inventing unauthorized Pi-only entries is: the **reverse** check walks only
`assets/agents/**` (chains compose multiple phases into Pi-only workflows and are not themselves
single-phase bindings), while the **forward** check (does a declared phase have *some* binding) accepts
either an agent or a chain name, per the task's literal "Pi agent/chain binding" wording. This is documented
in `scripts/verify-package-files.mjs`'s gate comment, not just here.

## `issue-creation` is never touched (task 7.2)

`phaseCoverageBindings()` reads only `assets/agents/**` and `assets/chains/**` — it never lists or opens
anything under `skills/`. Proven directly: a fixture test
(`tests/verify-package-files.test.ts` "skills/issue-creation/SKILL.md is never read or flagged") builds a
temp tree with `assets/agents/sdd-apply.md`, `assets/chains/sdd-plan.chain.md`, and
`skills/issue-creation/SKILL.md` side by side, and asserts `issue-creation` appears in neither
`agentNames`/`chainNames` nor any gate output.

## Generic S/R evidence ledger harness (tasks 7.5/7.6)

`tests/evidence/ledger.ts` — reuses the **exact** `evidence.class` discipline
`lib/release-artifact.ts`'s `RELEASE_ARTIFACT_EVIDENCE_CLASS` already carries (`development/bootstrap` = S,
`release` = R — the same values persisted into the checked-in `capabilities/gentle-ai-release.lock.json`'s
`evidence.class` field), rather than inventing a parallel S/R vocabulary. It is deliberately generic — no
gentle-ai-specific fields (no signature, no repository, no tag) — so Wave 1 changes can build their own S-vs-R
evidence ledgers directly on `EvidenceLedger`/`createEvidenceRecord`/`assertNeverRelabeledFromBootstrap`
without reimplementing the shape. The invariant (an S-class record can never be relabeled R) is enforced
twice: once as a standalone assertion function, and once on `EvidenceLedger.record()`'s own mutation path (a
rejected S→R attempt never mutates the ledger — proven by
`tests/evidence.test.ts` "EvidenceLedger.record enforces the invariant on the mutation path itself").

## TDD Cycle Evidence

| Task | Test File | RED | GREEN | REFACTOR |
|------|-----------|-----|-------|----------|
| 7.1 | `tests/verify-package-files.test.ts` | ✅ Written referencing `phaseCoverageGate`/`phaseCoverageBindings` before they existed → whole-module `SyntaxError: ... does not provide an export named 'phaseCoverageBindings'` (`node --test tests/verify-package-files.test.ts` failed 1/1) | ✅ 8 new phase-coverage cases pass (21/21 in the file) | ✅ Clean — `bindingNamesFromDirectory` shared by both directory reads, `phaseCoverageGate` kept pure (no I/O), `phaseCoverageBindings` is the sole I/O boundary |
| 7.2 | `tests/verify-package-files.test.ts` | ✅ Same RED (whole-module failure covers this case too — the fixture test importing the not-yet-existing exports) | ✅ "skills/issue-creation/SKILL.md is never read or flagged" passes | N/A |
| 7.3 | `assets/phase-coverage.json` | N/A — data file | ✅ created; the "real assets/phase-coverage.json fully reconciles" test passes against the actual `assets/agents`/`assets/chains` trees | N/A |
| 7.4 | `scripts/verify-package-files.mjs` | (covered by 7.1 RED) | ✅ `main()` wired: `console.warn` per missing binding, `process.exit(1)` only when `unknownBindings.length > 0` | ✅ Clean — reuses the file's existing "one gate, exact messages, never a silent boolean" pattern |
| 7.5 | `tests/evidence.test.ts` | ✅ Written referencing `./evidence/ledger.ts` before it existed → `ERR_MODULE_NOT_FOUND` (`node --test tests/evidence.test.ts` failed 1/1) | ✅ 7/7 cases pass | ✅ Clean |
| 7.6 | `tests/evidence/ledger.ts` | (covered by 7.5 RED) | ✅ `EVIDENCE_LEDGER_CLASS`, `createEvidenceRecord`, `assertNeverRelabeledFromBootstrap`, `EvidenceLedger` created | ✅ Clean — single-purpose module, no gentle-ai-specific coupling |
| 7.7 | `.github/workflows/ci.yml` | N/A — CI config | ✅ 3 separate offline-check steps consolidated into one "Verify offline checks" step (`verify-package-files.mjs --check` now includes phase coverage; `build-gentle-ai-baselines.mjs --check`; `build-skill-overlays.mjs --check`) | N/A |
| 7.8 | full suite | — | ✅ `node --experimental-strip-types --test tests/*.test.ts`: 1145/1145 collected, 1132 pass, 1 known pre-existing environmental fail, 12 skipped. `node scripts/verify-package-files.mjs --check` exits 0 against the real tree with zero warnings (full coverage already exists) | N/A |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `node --experimental-strip-types --test tests/verify-package-files.test.ts tests/evidence.test.ts` → 28/28 pass (21 pre-existing/updated `verify-package-files` cases including 8 new phase-coverage cases, 7 new `evidence.test.ts` cases) |
| Runtime harness command/scenario and exact result | `node scripts/verify-package-files.mjs --check` against the real repository tree → exit 0, `gentle-pi package resource check passed (73 files; 66 lock-pinned mirror artifacts at release v2.2.3).`, zero phase-coverage warnings (full 18/18 declared-phase coverage already exists). Combined offline gate exactly as `ci.yml` runs it (`verify-package-files.mjs --check && build-gentle-ai-baselines.mjs --check && build-skill-overlays.mjs --check`) → exit 0. |
| Rollback boundary | `git revert` of this unit's commits removes `assets/phase-coverage.json`, the phase-coverage gate block in `scripts/verify-package-files.mjs` (and its `requiredPaths` entry), `tests/evidence/**` + `tests/evidence.test.ts`, the phase-coverage test cases in `tests/verify-package-files.test.ts`, and reverts `.github/workflows/ci.yml`'s single combined step back to 3 separate steps — restoring exactly the P3b end state. No P1/P2/P3a/P3b file or behavior is touched by this unit. |

## Proof: WARN path never fails CI, FAIL path does

Direct inspection of `phaseCoverageGate()`'s two return arrays and `main()`'s two handling branches
(`console.warn` only for `missingBindings`, `process.exit(1)` gated strictly on
`unknownBindings.length > 0`), confirmed by calling the exported function directly:

```
WARN-only case:  {"missingBindings":["sdd-brand-new-phase"],"unknownBindings":[]}   -> would process.exit(1)? false
FAIL case:       {"missingBindings":[],"unknownBindings":["gentle-ai-rogue"]}        -> would process.exit(1)? true
```

Also proven end-to-end against the real tree: `node scripts/verify-package-files.mjs --check` exits 0 with
no output beyond the final success line, because the real tree currently has zero missing bindings and zero
unknown bindings (18/18 declared phases bound, 24/24 Pi agent names accounted for).

## Full-suite proof (`node --experimental-strip-types --test tests/*.test.ts`)

`tests 1145 / pass 1132 / fail 1 / skipped 12` (1130 pre-existing + 15 new: 8 in
`tests/verify-package-files.test.ts`, 7 in `tests/evidence.test.ts`). The 1 failure is the same
pre-existing, sandbox-only, no-network `tests/native-review-cli.test.ts` "native output limits dominate
killed timeout signals..." failure documented in every prior unit of this tracker. Not new, not related to
this unit.

`pnpm run test:harness` (`tests/runtime-harness.mjs`) also fails in this sandbox with an unrelated
pre-existing environmental symptom of the same root cause (no native `.gentle-ai/v2.2.3/gentle-ai` binary
installed, no network): "Gentle AI pre-pr gate could not reconsult review mode and failed closed." —
confirmed via `git stash` to reproduce identically on the clean P3b tip before any P3c change, so it is not
introduced by this unit. `pnpm test`/`pnpm install` still fail their own network step in this sandbox
(`postinstall` HTTP 404 fetching the binary) exactly as documented in every prior unit; `pnpm install`
still succeeds far enough to populate `node_modules` from the local pnpm store, so the direct
`node --experimental-strip-types --test tests/*.test.ts` invocation was used, matching every prior unit's
documented workaround.

## Deviations from Design

1. **Task 7.1's forward-direction "fails" wording is superseded by an explicit maintainer decision** (see
   above) — the design's own D9 prose ("Failure names the missing binding") is ambiguous about severity for
   the forward direction; the maintainer's instruction resolves it to WARN, non-fatal. The reverse direction
   is unchanged (still fails).
2. **The reverse ("Pi binding naming no declared phase") check is scoped to `assets/agents/**` only**, not
   `assets/chains/**` — a design-interpretation choice forced by reconciling the real tree against task
   7.3's exact, closed Pi-only list (see "Design interpretation note" above). The forward check still
   accepts either an agent or a chain binding, per task 7.1's literal wording.

## Issues Found

None new. Same `node_modules`/`postinstall` HTTP 404 environment condition documented in every prior unit,
plus the `tests/runtime-harness.mjs` pre-existing failure newly confirmed (via `git stash`) to also
reproduce on the clean P3b tip — both are sandbox-only, no-network symptoms of the same missing native
binary, neither introduced by this unit.

## Remaining Tasks

- [ ] PR 8 — P4 (`scripts/bump-gentle-ai-pin.mjs` + `gentle-ai-release-received.yml` receiver): not started.

## Workload / PR Boundary (P3c)

- Mode: feature-branch-chain, `size:exception` (tasks.md: `Delivery strategy: exception-ok`)
- Current work unit: P3c (PR 7, base: P3b's branch `feat/skill-vendor-overlay`)
- Boundary: `assets/phase-coverage.json` (new), the phase-coverage gate block in
  `scripts/verify-package-files.mjs` (new exports + `main()` wiring + one new `requiredPaths` entry),
  `tests/evidence/**` (new: `ledger.ts`), `tests/evidence.test.ts` (new), phase-coverage test cases appended
  to `tests/verify-package-files.test.ts`, and `.github/workflows/ci.yml`'s three offline-check steps
  consolidated into one. No P1/P2/P3a/P3b file touched.
- Estimated review budget impact: tracked-file diff is 241 insertions / 30 deletions across 4 files
  (`git diff --stat`), plus 168 lines across 3 new untracked files (`assets/phase-coverage.json` 34,
  `tests/evidence.test.ts` 65, `tests/evidence/ledger.ts` 69) — 439 total changed lines, all authored (no
  vendored/golden content in this unit, unlike P3b). Above the 400-line budget, already covered by the
  tracker-wide `Delivery strategy: exception-ok` (tasks.md: `400-line budget risk: High`,
  `Decision needed before apply: No`), same policy every prior unit operated under.

## Status (P3c)

8/8 tasks in PR 7 (P3c) complete. 63/68 tasks total across P1a+P1b+P2a+P2b+P3a+P3b+P3c. Ready for
`sdd-verify`, or for `sdd-apply` to continue with PR 8 (P4) in a fresh batch, on a new branch based on this
one (`feat/phase-coverage-evidence`).
