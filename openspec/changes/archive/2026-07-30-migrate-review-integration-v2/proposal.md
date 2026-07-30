# Proposal: migrate gentle-pi to `review-integration/v2` (v2-only)

## Intent

gentle-ai's `gentle-ai.review-integration/v2` replaces Base64 `candidate_diff` reviewer
transport with immutable `base_tree` + `candidate_tree` + ordered `changed_path_manifest`,
mandatory `artifact_subjects`, and an evidence-first correction lifecycle. Pi still speaks
v1 only, so it cannot drive a v2 provider at all. Pi pins one exact gentle-ai version and
its installer fetches that exact binary, so Pi never negotiates against an older provider —
a dual-lane migration would buy nothing and double the decoder surface permanently.

## Scope

### In Scope
- New v2 decoder module; delete `lib/review-integration-v1.ts`, `runtime/review-integration-v1.mjs`, and both v1 tests in the same commit.
- `lib/native-review-cli.ts`: all six `--contract` call sites plus decoder imports.
- Net-new correction lifecycle: evidence-first ordering, `review capture-evidence` with closed `--outcome`, and the `verification_failed` / `procedural_tooling_failed` / `passed` branches.
- Bind candidate-view materialization to the v2 collection-input trees and full manifest fields.
- `scripts/verify-package-files.mjs`: bidirectional directory walk so unlisted `contracts/**` files fail instead of passing silently.
- Regenerate `runtime/*.mjs` via `scripts/build-git-commit-transaction-runner.mjs` (never hand-edit); update the source module list.
- Docs: `docs/native-authority-architecture.md`, `README.md`, `skills/gentle-ai/SKILL.md`, `skills/_shared/review-ledger-contract.md`.

### Out of Scope
- Any v1 negotiation lane, dual-lane fallback, or compatibility shim.
- Deleting `contracts/review-integration/v1/**` — v2 schemas `$ref` into them.
- Re-mirroring `contracts/review-integration/v2/**` and `docs/review-integration.md` (already byte-identical; verified with `diff -r`).
- Pi's unrelated internal "compact-v2" (`lib/review-compact*.ts`) — owned by `harden-review-contracts`.

## Capabilities

### New Capabilities
- `review-correction-lifecycle`: evidence-first capture ordering, closed `--outcome` domain, and the three terminal branches. Zero existing footprint in Pi.

### Modified Capabilities
- `review-transaction`: contract identity moves to v2; decoder surface, `start/v3`, `status/v3`, `consent/v2`, `failure/v2`, `operation/v2`, `repair/v2`.
- `review-orchestration`: reviewer dispatch binds to provider-issued `artifact_subject`, `base_tree`, `candidate_tree`, and `changed_path_manifest`.

## Approach

### Decision 1 — new module, v1 deleted in the same commit

Rejected: in-place rewrite of `review-integration-v1.ts`.

The module name is not decoration. Every decoder pins contract identity through
`requireIdentity` / `requireVersionedIdentity` at the literal-type level, so a file named
`-v1` exporting `.../v2` identity would be a permanent lie in four literal name lists:
`scripts/build-git-commit-transaction-runner.mjs` (`sources` array), `verify-package-files.mjs`
`requiredPaths` (both `lib/` and `runtime/` entries), the two v1 test files, and `README.md`.
Rename cost is one-time and mechanical; the false name is permanent and collides with Pi's
separate internal "compact-v2" vocabulary. Git records rename+modify, keeping the diff
reviewable. Same-commit deletion is mandatory — otherwise a dead v1 lane stays compiled into
`runtime/` and shipped in the published package.

### Decision 2 — shell boundary: compliant by construction; binding source needs adjustment

Two halves, different answers.

**No-shell half: already satisfied, no change.** Lens agents reach the candidate only through
`Read` against a chmod-read-only worktree injected by `injectReviewCandidateView`; they get no
Git shell. `assertRecordSafe` re-verifies every entry's mode, symlink status, writability, and
content hash, rejects injected untracked entries, and re-runs `write-tree` to confirm the index
still equals the frozen tree. This is stricter than the contract's allowlist, not a gap.

**Frozen-identity half: needs a v2 binding-source adjustment.** Pi already fails closed on
divergence — `restoreForFinalizeFromNative` rejects with "live candidate does not match the
native frozen projection" and `assertCurrentBindingMatchesLiveCandidate` rejects
`current-binding-live-candidate-drift`. But it compares against a v1-shaped
`NativeCandidateProjectionDescriptor`, and `restoreProjectionFromNative` validates scope by
sorted-path equality only (`JSON.stringify(scope.paths) !== JSON.stringify([...descriptor.paths].sort())`).
v2 ships richer manifest state: `status`, `old_mode`/`new_mode`, `deleted`, `type_changed`,
`mode_only`, `intended_untracked`. Path-set equality cannot detect a mode-only or type-change
divergence. So: source the descriptor from `next_transition.collect.inputs[].{artifact_subject,
base_tree, candidate_tree, changed_path_manifest}` and compare field-wise, not path-wise.

**Evidence that settles it:** three tests — (a) a review dispatch grants no shell/Bash tool;
(b) a contributor edit between START and dispatch makes materialized `candidate_tree` diverge
from the provider's and the dispatch fails closed rather than exposing a substituted view;
(c) a mode-only or type-change manifest divergence is rejected, which today's path-set
comparison would accept.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/review-integration-v2.ts` | New | v2 decoders, identity, exact-key discipline |
| `lib/review-integration-v1.ts` | Removed | Deleted with its runtime and both tests |
| `lib/native-review-cli.ts` | Modified | Six `--contract` sites, imports, correction lifecycle |
| `lib/review-candidate-view.ts` | Modified | v2 descriptor source + field-wise manifest check |
| `scripts/verify-package-files.mjs` | Modified | Bidirectional contract directory walk |
| `scripts/build-git-commit-transaction-runner.mjs` | Modified | `sources` module-name list |
| `runtime/*.mjs` | Regenerated | Never hand-edited |
| `openspec/specs/review-transaction/spec.md` | Modified | Contract identity and decoder requirements |
| docs, README, skills | Modified | v2 vocabulary; disambiguate internal "compact-v2" |

## Sequencing

| Phase | Work | Gate |
|-------|------|------|
| A — now | Decoder rewrite, CLI migration, v1 deletion, correction lifecycle, candidate-view binding, `verify-package-files.mjs` fix, docs | Mirrored byte-identical v2 fixtures |
| B — after gentle-ai v2.2.1 ships | `GENTLE_AI_RELEASE_ASSETS` sha256 + `binarySha256`, `INSTALLER_VERSION` / `GENTLE_AI_VERSION` bump, real binary test runs | Published release; prepack hard-fails on unpinned digests |

Phase A is the bulk and is fully testable against fixtures. Phase B is a small pin commit.
Delivery: one PR, accepted `size:exception`, 1200-line review budget — no chained PRs.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `exactRecord` exact-key discipline not ported faithfully → Pi silently accepts malformed v2 payloads | Med | Strict TDD: a rejection test per decoder before implementation; fixture round-trip against all 22 required schemas |
| Self-skipping test pair reports green with zero coverage — `native-review-parity-runtime.test.ts` (`resolvedBinary === undefined ? baseTest.skip : baseTest`) and `gentle-ai-binary.test.ts` (`releaseDigestsPinned && existsSync(repoRuntimeBinary)`) | High | Same root cause; make skipping loud — CI asserts the binary is installed, or the suite fails on an unexpected skip. Fix in Phase A, before Phase B depends on it |
| Half-upgraded `.gentle-ai/` (v2.1.2–v2.2.0 present) fails hard under v2-only | Med | Accepted by design; pin + installer are the only gate. Failure must name the expected version |
| Correction lifecycle is the largest net-new surface | Med | Spec its branches explicitly; it is a separate capability, not a decoder detail |
| Manifest field-wise comparison rejects previously-accepted candidates | Low | Intended tightening; cover with the three settling tests |
| "compact-v2" naming collision with Pi's internal system | Med | Disambiguate in docs and commit messages; do not touch `lib/review-compact*.ts` |

## Rollback Plan

Phase A is one PR on `feat/organic-rdd-parity`; revert the merge commit. `contracts/review-integration/v1/**`
stays on disk throughout, so reverting restores a compiling v1 lane with no contract re-mirroring.
Phase B is a pin-only commit — revert independently to fall back to the previous pinned binary.

## Dependencies

- gentle-ai v2.2.1 published (Phase B only).
- Already satisfied: `contracts/review-integration/v2/**` (9 schemas, 4 fixtures), v1-lane deltas, and `docs/review-integration.md` mirrored and verified byte-identical.

## Success Criteria

- [ ] No `gentle-ai.review-integration/v1` identity remains in `lib/`, `runtime/`, or `tests/`.
- [ ] All six `--contract` call sites negotiate v2; `start/v3`, `status/v3`, `consent/v2`, `failure/v2`, `operation/v2`, `repair/v2` decode against the mirrored fixtures.
- [ ] Correction lifecycle covers all three `--outcome` branches.
- [ ] `verify-package-files.mjs` fails on an unlisted `contracts/**` file.
- [ ] The self-skipping test pair fails loudly instead of skipping when the binary is absent.
- [ ] `pnpm test` green with no unexpected skips (baseline: 854 tests, 853 pass, 1 skip).
