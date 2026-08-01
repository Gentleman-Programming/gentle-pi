# Apply Progress: consume-gentle-ai-release-artifacts

> Cumulative across batches: **PR 1 / P1a** (tasks 1.1-1.8, complete) and **PR 2 / P1b**
> (tasks 2.1-2.10, complete). PR 3 (P2a) and later are NOT started.

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
