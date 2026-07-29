# Exploration: migrate gentle-pi to `review-integration/v2` (v2-only)

Phase: `sdd-explore`. Change: `migrate-review-integration-v2`. Artifact store: hybrid
(this file plus Engram topic `sdd/migrate-review-integration-v2/explore`).

## Context

gentle-ai introduced a new negotiated contract lane `gentle-ai.review-integration/v2`
alongside v1. Contract v2 replaces the Base64 `candidate_diff` reviewer transport with
immutable Git tree IDs (`base_tree` + `candidate_tree`) plus an ordered
`changed_path_manifest`.

**Scope decision (user): v2 only, no backward compatibility.** Pi drops the v1
negotiation lane entirely rather than running dual-lane. Pi pins an exact gentle-ai
version and its installer fetches that exact binary, so Pi never negotiates against an
older provider in practice.

**Known consequence:** `.gentle-ai/` currently holds installed runtimes v2.1.2 through
v2.2.0. Under v2-only, a half-upgraded install fails hard instead of degrading. The pin
and the installer become the only gate.

## Current state

`lib/review-integration-v1.ts` (869 lines) exports
`REVIEW_INTEGRATION_CONTRACT = "gentle-ai.review-integration/v1"` and every strict
decoder: `decodeReviewCapabilitiesV1`, `decodeReviewStartV1`, `decodeReviewStatusV1`,
`decodeReviewFailureV1`, `decodeReviewOperationV1`. Each decoder pins the contract
identity through `requireIdentity` / `requireVersionedIdentity`, so the module is
v1-typed at the literal-type level rather than by convention.

`lib/native-review-cli.ts` (1813 lines) imports those decoders and threads
`REVIEW_INTEGRATION_CONTRACT` through six `--contract` call sites: capabilities
(L1570), start (L1623), finalize (L1687), validate (L1714), bind-sdd (L1733), status
(L1756).

### Reviewer transport — correction to a prior assumption

Pi's reviewer transport does **not** ship Base64 patches, and does not follow
gentle-ai's documented Git-command-allowlist recipe either. `lib/review-candidate-view.ts`
(914 lines, `CandidateViewRegistry`) materializes a real, chmod-read-only Git worktree
scoped to the changed-path manifest, and points lens sub-agents at it through the `Read`
tool via `injectReviewCandidateView`, wired into `subagent_run` in
`extensions/gentle-ai.ts`. Lens agents get no shell access to Git at all.

Verified: `base64` and `candidate_diff` both occur zero times in
`lib/review-candidate-view.ts` and `extensions/gentle-ai.ts`.

Whether this already satisfies the contract's "a runtime that cannot enforce a
per-command shell boundary exposes no shell and reports incomplete inspection" clause is
an open design question, not something to assume either way.

### Naming collision

Pi has a separate, pre-existing internal "compact-v2" system (`lib/review-compact*.ts`,
Judgment Day graph-v1) that shares vocabulary with gentle-ai's protocol but is an
unrelated thing — it is the subject of the open `harden-review-contracts` change. This is
a naming-collision risk to disambiguate in docs and commit messages, not a dependency.

## Affected areas

**Delete** (v1-only code and tests):
- `lib/review-integration-v1.ts`
- `runtime/review-integration-v1.mjs` (generated)
- `tests/review-integration-v1.test.ts`
- `tests/native-review-integration-v1.test.ts`

**Keep on disk despite dropping the v1 code lane** — the v2 schemas `$ref` into them:
- `contracts/review-integration/v1/schemas/projection.schema.json`
- `contracts/review-integration/v1/schemas/authority-repair-assessment.schema.json`
- `contracts/review-integration/v1/schemas/targeted-validation-request.schema.json`
- `contracts/review-integration/v1/schemas/status-v2.schema.json` (fragments)
- `contracts/review-integration/v1/schemas/capabilities-v1.4.schema.json` (fragments)

**Rewrite:**
- A new v2 decoder module succeeding `review-integration-v1.ts`: protocol major 2 /
  minor 0, 22 required schemas, 10 mandatory + 17 optional features, `start/v3`
  (mandatory `artifact_subjects`), `status/v3` (`repair` required;
  `next_transition.collect.inputs[]` carries `artifact_subject`, `base_tree`,
  `candidate_tree`, and `changed_path_manifest` per input), `consent/v2`, `failure/v2`,
  `operation/v2`, `repair/v2`
- `lib/native-review-cli.ts` — all six `--contract` call sites plus decoder imports
- `runtime/native-review-cli.mjs` — regenerate via
  `scripts/build-git-commit-transaction-runner.mjs`; never hand-edit
- `scripts/verify-package-files.mjs` — see blind spot below

**Update docs:** `docs/native-authority-architecture.md`, `README.md`,
`skills/gentle-ai/SKILL.md`, `skills/_shared/review-ledger-contract.md`,
`openspec/specs/review-transaction/spec.md`.

**Net-new:** the correction-lifecycle evidence-first ordering (`review capture-evidence`
with a closed `--outcome`, and the `verification_failed` / `procedural_tooling_failed`
branches). Zero existing footprint in the native-review-cli client path — this is the
largest new surface in the migration.

**Keep, version-agnostic:** `lib/review-candidate-view.ts`, `lib/review-compact*.ts`,
`scripts/gentle-ai-installer.mjs`, `lib/gentle-ai-binary.ts`.

## Package-verification blind spot

Confirmed by full read of `scripts/verify-package-files.mjs`: `requiredPaths`
(existence-only) and `contractHashes` (a hardcoded path→sha256 map) cover zero
`contracts/review-integration/v2/**` paths. Any new v2 file is invisible to both checks.
The script correctly flagged the three modified v1 files and the changed docs, and said
nothing at all about the thirteen new v2 files.

The fix is a bidirectional directory-walk check so unlisted contract files fail instead
of passing silently. This must land as part of this change, not deferred.

## Sequencing

**Can land before gentle-ai v2.2.1 is published:** the v2 decoder rewrite,
`native-review-cli.ts` migration, deleting the v1 code and tests, fixing the
`verify-package-files.mjs` blind spot, doc updates, and the new correction-lifecycle
logic — all against the already-mirrored, byte-identical contract fixtures.

**Strictly requires the published release:** `GENTLE_AI_RELEASE_ASSETS` sha256 and
binarySha256 pins in `scripts/gentle-ai-installer.mjs` (the script hard-fails prepack on
unpinned digests), the `INSTALLER_VERSION` / `GENTLE_AI_VERSION` bump, and real
(non-skipped) runs of `tests/native-review-parity-runtime.test.ts` and
`tests/gentle-ai-binary.test.ts`.

## Risks

1. **Partial decoder migration.** If `exactRecord`'s exact-key discipline is not ported
   faithfully, Pi silently accepts malformed v2 payloads.
2. **The package-verification blind spot** must be fixed in this change, not deferred.
3. **Self-skipping test pair.** `tests/native-review-parity-runtime.test.ts` and
   `tests/gentle-ai-binary.test.ts` both self-skip when `.gentle-ai/v{VERSION}/gentle-ai`
   is not locally installed (`resolvedBinary === undefined ? baseTest.skip : baseTest`
   and `releaseDigestsPinned && existsSync(repoRuntimeBinary) ? test : test.skip`). A
   release workflow that does not install the binary first reports green with zero real
   binary coverage. Same root cause for both.
4. **Correction-lifecycle evidence-first ordering** is the largest net-new surface.
5. **Naming collision** between Pi's internal "compact-v2" and gentle-ai's protocol
   "compact-v2" needs explicit disambiguation.
6. **Shell-boundary compliance** of the candidate-view strategy is unverified against the
   v2 contract clause.

## Open design questions for `sdd-propose` / `sdd-design`

1. How to organize the new v2 decoder module: in-place rewrite of
   `review-integration-v1.ts`, or a new file with the old one deleted in the same commit.
2. Whether Pi's read-only-worktree candidate-view materialization already satisfies the
   v2 "no enforceable shell boundary → no shell, report incomplete inspection" clause by
   construction, or needs an explicit adjustment.

## Status

Ready for proposal.
