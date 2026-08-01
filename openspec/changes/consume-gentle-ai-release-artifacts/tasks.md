# Tasks: Consume gentle-ai release artifacts instead of hand-copying

> Consumer-side only, gentle-pi repository. This tracker is **independent**: no child PR crosses
> into gentle-ai, and the only bridge from the provider is a published immutable signed release (R).
> All eight slices below merge to one gentle-pi feature/tracker branch; only the tracker merges to `main`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | P1a ~250, P1b ~320, P2a ~350, P2b ~260, P3a ~300, P3b ~280, P3c ~220, P4 ~180 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 → PR 8 |
| Delivery strategy | exception-ok |
| Chain strategy | feature-branch-chain — PR 1 targets the tracker branch; each child PR targets its immediate predecessor branch; only the tracker merges to `main` |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| P1a | Bootstrap decoder + tree digest + bounded extractor | PR 1 (base: tracker) | `pnpm test -- release-artifact` | `pnpm run check:transaction-runner` | delete `lib/release-artifact.ts`/`runtime/release-artifact.mjs`; sources entry reverted |
| P1b | Signed sync path + mirrors + lock + reconciliation | PR 2 (base: PR1) | `pnpm test -- verify-package-files sync-gentle-ai-release` | N/A — offline gate, no live binary invocation | delete sync script/mirrors/lock; restore `contractHashes` |
| P2a | POSIX assets install + integrity manifest + resolver | PR 3 (base: PR2) | `pnpm test -- gentle-ai-binary gentle-ai-installer` | `pnpm run test:harness` | revert to binary-only bundle on POSIX |
| P2b | Windows split provenance + cross-check + bundle lifecycle | PR 4 (base: PR3) | `pnpm test -- gentle-ai-binary gentle-ai-installer` | `pnpm run test:harness` (Windows fixture) | revert Windows cross-check + prune; POSIX path untouched |
| P3a | Generators: baselines, generated floor, capability row | PR 5 (base: PR4) | `pnpm test` | `node scripts/build-gentle-ai-baselines.mjs --check` | hand-authored floor/table restored |
| P3b | Skill vendor + overlay | PR 6 (base: PR5) | `pnpm test` | `node scripts/build-skill-overlays.mjs --check` | checked-in skills restored |
| P3c | Phase-coverage gate + generic evidence harness | PR 7 (base: PR6) | `pnpm test` | `node scripts/verify-package-files.mjs --check` | remove gate/harness; prior manual checks return |
| P4 | Pin-bump automation + default-branch receiver | PR 8 (base: PR7) | `pnpm test -- bump-gentle-ai-pin` | manual `workflow_dispatch` replay against a published tag | remove bump script/receiver; manual verified bump resumes |

## PR 1 — P1a: Bootstrap decoder + tree digest (Req: "Archive verified with existing integrity discipline, unweakened"; "Unsupported contract major fails closed before layout is trusted")

- [ ] 1.1 Rebase the tracker branch onto `main` after PR #262 and PR #263 merge; verify `INSTALLER_VERSION` is the sole pin literal and gate/projection floor verification is already additive-tolerant — do not re-implement either.
- [ ] 1.2 RED: `lib/release-artifact.ts` decoder tests — unsupported major rejected naming it against a structurally-valid `artifact-manifest-unsupported-major.fixture.json`; unknown key; `tree.manifest_included:true`; absolute/`..`/backslash/NUL/over-length/duplicate/unsorted path; non-`file` type; non-`0644` mode; bad digest shape; missing bundled schema; `$id` mismatch; `compatibility.unknown_mandatory` not `reject`.
- [ ] 1.3 RED: tree digest tests — known-vector preimage `"gentle-ai.release-artifact-tree/v1\x00"` + entry lines, input-order independence, manifest exclusion.
- [ ] 1.4 RED: bounded-extraction tests (threat-matrix: archive extraction) — listing exceeding `MAX_ASSET_ENTRIES`/`MAX_ASSET_FILE_BYTES`/`MAX_ASSETS_UNPACKED_BYTES` rejected with zero bytes written; extra archive member; missing member; listed-size vs `entries[].size` disagreement; link/device/dir member rejected.
- [ ] 1.5 RED: `--bootstrap-archive` test — must be passed explicitly (never auto-discovered), records `signature_status: not-applicable/local-unsigned`, and is barred from pin/acceptance evidence.
- [ ] 1.6 GREEN: create `lib/release-artifact.ts` — `decodeArtifactManifest`, `treeDigest`, `SUPPORTED_CONTRACT_MAJOR = 1`, D1 steps 1-11 in order, D2 staged extractor (stage0 listing → stage3 exact path-set equality → stage4 extract → stage5 per-file recheck).
- [ ] 1.7 GREEN: add generated `runtime/release-artifact.mjs`; register it in the `sources` list, `scripts/build-git-commit-transaction-runner.mjs:9-14`.
- [ ] 1.8 Verify: `pnpm test -- release-artifact`; `pnpm run check:transaction-runner`.

## PR 2 — P1b: Signed sync path + mirrors + canonical lock (Req: "Offline mirrors and a canonical lock bind provider identity"; "Bootstrap snapshot evidence never substitutes for release evidence")

- [ ] 2.1 RED: `scripts/sync-gentle-ai-release.mjs` tests (threat-matrix: network trust boundary) — forged minisign signature rejected; wrong trusted-comment repo/tag binding rejected; missing checksum line rejected; duplicate checksum line rejected.
- [ ] 2.2 GREEN: create `scripts/sync-gentle-ai-release.mjs` (`--write`, pin-bump job only, network) — downloads `checksums.txt`/`.minisig`/archive, runs D1 trust order via `lib/release-artifact.ts`, writes mirrors + lock.
- [ ] 2.3 GREEN: write mirrors — `contracts/review-integration/{v1,v2}/**`, `contracts/release-artifact/v1/schemas/artifact-manifest.schema.json`, `capabilities/review-integration-v2.semantic.json`, `docs/gentle-ai/review-integration.md`.
- [ ] 2.4 GREEN: create `capabilities/gentle-ai-release.lock.json` (canonical LF, 2-space, path-sorted, one trailing LF); assert `lock.release.version === INSTALLER_VERSION`.
- [ ] 2.5 RED: `scripts/verify-package-files.mjs` reconciliation tests — unlisted-on-disk mirror file, listed-but-missing file, and digest drift each fail naming the exact file.
- [ ] 2.6 GREEN: `scripts/verify-package-files.mjs` — delete the ~60-entry `contractHashes` map; reconcile on-disk mirrors against `lock.entries` via `reconcileContractsOnDisk`.
- [ ] 2.7 RED: evidence-S/R labeling test — a sync result run against `--bootstrap-archive` is labeled `development/bootstrap` and never relabeled as release evidence.
- [ ] 2.8 GREEN: wire evidence labeling into `sync-gentle-ai-release.mjs` (plan §12 ledger shape).
- [ ] 2.9 GREEN: `.github/workflows/ci.yml` — add offline mirror/lock reconciliation to the per-PR gate; only the pin-bump job invokes `sync-gentle-ai-release.mjs --write` with network.
- [ ] 2.10 Verify: `pnpm test`; `node scripts/verify-package-files.mjs --check` offline, no network access.

## PR 3 — P2a: POSIX assets install + integrity manifest + resolver (depends: sibling `consolidate-review-parity-runtime` archived)

- [ ] 3.1 **Guard (first task)**: assert `openspec/specs/package-runtime/spec.md` exists; fail loudly naming `consolidate-review-parity-runtime` if it is still `archive: pending`. Do not proceed past this task until it passes.
- [ ] 3.2 RED: `assetsTreeSha256` test — order-independent, mode-sensitive digest over sorted manifest entries.
- [ ] 3.3 RED: manifest/assets tests (threat-matrix: documentation-like paths) — extra file in installed tree rejected; symlinked asset rejected; asset with mode `0755` rejected; asset named `install.sh`/`README.sh` lands non-executable.
- [ ] 3.4 RED: TOCTOU replacement mid-verify across the whole file set plus manifest detected.
- [ ] 3.5 RED: `resolveGentleAiBinary` still rejects a forged assets digest.
- [ ] 3.6 RED: assets missing ⇒ bundle invalid ⇒ `recoverInterruptedPublication` restores prior backup (fake `rename` seam).
- [ ] 3.7 GREEN: `lib/gentle-ai-binary.ts` (+ runtime) — add manifest keys `assetsAsset`, `assetsArchiveSha256`, `assetsTreeSha256`, `contractMajor`, `layoutVersion`; `isCanonicalManifest` key-count/string-equality discipline extended, not weakened.
- [ ] 3.8 GREEN: exported `resolveGentleAiAssets(packageRoot, platform)` — exact path-set equality against manifest entries first, then per-file `lstat`/confinement/mode checks, then whole-set `sameFile` TOCTOU re-check.
- [ ] 3.9 GREEN: `scripts/gentle-ai-installer.mjs` — assets descriptor; stage assets extraction into `.gentle-ai/v<version>/assets/` via the `lib/release-artifact.ts` extractor; extend `existingSignedBundleMatches` to validate the assets tree (covers `recoverInterruptedPublication` for free; no new publish operation).
- [ ] 3.10 Verify: `pnpm test -- gentle-ai-binary gentle-ai-installer`; `pnpm run test:harness`.

## PR 4 — P2b: Windows split provenance + cross-check + bundle lifecycle (depends: PR 3)

- [ ] 4.1 RED: Windows subprocess cross-check tests (threat-matrix: subprocess invocation) — non-zero exit, oversized output, non-JSON output each fail closed with no bundle published.
- [ ] 4.2 RED: split-provenance test — one manifest records both SumDB binary provenance and signed-archive assets provenance.
- [ ] 4.3 RED: cross-check mismatch fails closed and never writes the snapshot, never creates authority.
- [ ] 4.4 RED: `pruneSupersededBundles` never touches the live bundle, runs only after the new bundle's rename succeeds, and its failure is non-fatal and logged.
- [ ] 4.5 RED: `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1` skips binary and assets symmetrically with the same loud disposition; no partially configured bundle directory is created.
- [ ] 4.6 GREEN: `windowsSourceManifest` gains the assets keys; Windows downloads the same signed archive and verifies against locked digests exactly as POSIX (D5).
- [ ] 4.7 GREEN: sealed `gentle-ai.exe review capabilities --contract gentle-ai.review-integration/v2` cross-check — fixed argv, no shell, bounded output, sealed environment (reuses the existing `go install` invocation seam); fails closed on mismatch.
- [ ] 4.8 GREEN: `pruneSupersededBundles(runtimeRoot)` — removes `v<other-version>` directories only after the new rename succeeds; never the live bundle.
- [ ] 4.9 Verify: `pnpm test -- gentle-ai-binary gentle-ai-installer`; `pnpm run test:harness` (Windows fixture path).

## PR 5 — P3a: Generators — baselines, generated floor, capability row (depends: PR 4)

- [ ] 5.1 RED: generator test — `--write` may ADD a required name to `lib/gentle-ai-required-floor.generated.ts`.
- [ ] 5.2 RED: generator test — a name disappearing from the snapshot's `required` block makes `--write`/`--check` FAIL naming it (monotone regeneration; no silent removal).
- [ ] 5.3 RED: an advertised mandatory feature absent from Pi's set fails naming it (never auto-added).
- [ ] 5.4 RED: unmapped-operation test — exact message `gentle-ai <v> advertises operation "<op>" with no NativeCliCapability column...`.
- [ ] 5.5 RED: pinned version missing `envelopeFlags` in `capabilities/native-cli-history.json` fails generation.
- [ ] 5.6 GREEN: create `capabilities/native-cli-history.json` — 12 frozen rows moved verbatim, prose re-emitted as `notes` comments.
- [ ] 5.7 GREEN: create `scripts/build-gentle-ai-baselines.mjs` (`--write`/`--check`, CLI shape of `build-git-commit-transaction-runner.mjs:34-60`) — emits `lib/gentle-ai-required-floor.generated.ts` and the next `NATIVE_CLI_CONTRACTS` row (13 of 17 flags mapped via `review.<op>`, 4 envelope flags from history).
- [ ] 5.8 GREEN: `lib/review-integration-v2.ts`, `lib/native-review-cli.ts` (+ runtime) consume the generated floor/row instead of hand-authored constants.
- [ ] 5.9 GREEN: `.github/workflows/ci.yml` — add `build-gentle-ai-baselines.mjs --check` to the per-PR gate.
- [ ] 5.10 Verify: `pnpm test`; `node scripts/build-gentle-ai-baselines.mjs --check`.

## PR 6 — P3b: Skill vendor + overlay (depends: PR 5)

- [ ] 6.1 RED: overlay anchor missing upstream ⇒ fails the exact message `edit the overlay, not the vendored file: skills/_vendor/<name>/overlay.md` (fixture pair).
- [ ] 6.2 RED: hand-edit of a vendored `skills/_vendor/**` file detected by the drift gate.
- [ ] 6.3 GREEN: create `scripts/build-skill-overlays.mjs` (`--write`/`--check`) — vendored body + ordered anchored `[anchor]/[replace]` blocks in `overlay.md` → `skills/<name>/SKILL.md`.
- [ ] 6.4 GREEN (5 independent revertible admissions): per-file portability comparison then admit first-tier candidates — `comment-writer`, `work-unit-commits`, `branch-pr`, `chained-pr`, `cognitive-doc-design`.
- [ ] 6.5 GREEN (4 independent revertible admissions): per-file portability comparison then admit second-tier candidates — `judgment-day`, `skill-creator`, `skill-improver`, `skill-registry`.
- [ ] 6.6 GREEN: confirm `skills/issue-creation/SKILL.md` is excluded entirely from vendoring and carries no gate.
- [ ] 6.7 GREEN: `.github/workflows/ci.yml` — add `build-skill-overlays.mjs --check` to the per-PR gate.
- [ ] 6.8 Verify: `pnpm test`; `node scripts/build-skill-overlays.mjs --check`.

## PR 7 — P3c: Phase-coverage gate + generic evidence harness (depends: PR 6)

- [ ] 7.1 RED: phase-coverage gate — a provider-declared phase with no Pi agent/chain binding fails naming it; a Pi binding naming no declared phase (and not listed Pi-only) fails.
- [ ] 7.2 RED: `skills/issue-creation/SKILL.md` is never flagged by the phase-coverage gate (repo-identity, not drift).
- [ ] 7.3 GREEN: create `assets/phase-coverage.json` — declared alias `sdd-proposal` ↔ `sdd-propose`; declared Pi-only bindings `gentle-ai-explore`, `gentle-ai-worker`, `gentle-ai-verify`, `sdd-status`, `sdd-sync`, `review-validator`.
- [ ] 7.4 GREEN: `scripts/verify-package-files.mjs` — add the phase-coverage gate, driven by the snapshot mirror plus `assets/phase-coverage.json`.
- [ ] 7.5 RED: generic evidence-harness test — an S-class (bootstrap) record can never be relabeled R; an R-class record requires live signed-release inputs.
- [ ] 7.6 GREEN: create `tests/evidence/**` — generic immutable-evidence harness implementing the plan §12 ledger shape (S vs R classes), reusable by later changes.
- [ ] 7.7 GREEN: `.github/workflows/ci.yml` — assemble the full offline `--check` set (mirrors/lock, baselines, skill overlays, phase-coverage) as one integration gate.
- [ ] 7.8 Verify: `pnpm test`; `node scripts/verify-package-files.mjs --check` (phase-coverage included).

## PR 8 — P4: Pin-bump automation + default-branch receiver (depends: PR 7)

- [ ] 8.1 RED: PR-command tests (threat-matrix: PR commands) — a dispatched tag carrying shell metacharacters is rejected; a `--head` injection attempt is rejected; an implicit base (no explicit `--base main`) is rejected.
- [ ] 8.2 GREEN: create `scripts/bump-gentle-ai-pin.mjs` — validate the dispatched tag against `^v\d+\.\d+\.\d+$` before any use; explicit `--base main`; head branch derived only from the validated tag; no payload interpolation into a composed command; runs `sync-gentle-ai-release.mjs --write`, `build-gentle-ai-baselines.mjs --write`, `build-skill-overlays.mjs --write`.
- [ ] 8.3 GREEN: create `.github/workflows/gentle-ai-release-received.yml` — default-branch `repository_dispatch` receiver; stays inactive until this workflow itself is merged to `main`.
- [ ] 8.4 GREEN: `.github/workflows/ci.yml` — confirm the pin-bump job remains the only job with network access.
- [ ] 8.5 Verify: `pnpm test -- bump-gentle-ai-pin`; dry-run dispatch against a fixture tag; confirm a real bump PR opens targeting `main` (never a temporary tracker) only once this receiver has landed there.

## Ordering Notes

- Independence: every task here is gentle-pi-only. No child PR opens against gentle-ai. The sole
  cross-repository bridge is a published immutable signed release (R); provider work is tracked
  entirely in `publish-gentle-ai-release-artifacts` and is out of scope here.
- Chain strategy is `feature-branch-chain`: PR 1 targets the tracker branch, each child PR targets its
  immediate predecessor branch, and only the tracker merges to `main`.
- Task 3.1 is a hard block, not a formality: P2 (PR 3, PR 4) MUST NOT open before
  `consolidate-review-parity-runtime` reaches `archive` and `openspec/specs/package-runtime/spec.md`
  exists.
- **Stall escape hatch**: P2 and P3 touch disjoint files. If the sibling archive is still pending when
  PR 2 (P1b) lands, PR 5 (P3a) may be re-parented onto PR 2's branch and PR 3/PR 4 (P2a/P2b) rebased
  after P3 lands instead — a pure rebase, no content change in any unit.
- No S-class (`development/bootstrap`) evidence is ever recorded or promoted as release, pin, or
  final-acceptance evidence — that is R-only, and R exists solely as the provider's published signed
  release.
- Network access stays confined to the pin-bump job (`sync-gentle-ai-release.mjs --write`,
  `scripts/bump-gentle-ai-pin.mjs`); every other CI job in every PR above runs offline.
