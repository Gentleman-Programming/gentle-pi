# Design: Consume gentle-ai release artifacts instead of hand-copying

> **Rewritten 2026-08-01** against the reconciled `proposal.md`, `explore.md` (§2 ledger) and the three
> reconciled specs. Consumer-side only. The manifest shape, canonicalization, tree preimage and archive
> layout are **owned by the provider** (`publish-gentle-ai-release-artifacts` design D1–D3). gentle-pi
> decodes them exactly and re-authors no format.

## Technical Approach

One rule: **the provider declares, gentle-pi derives, a gate fails on hand-edited derived content.**

The consumer has **two trust moments**, not one, and they are already asymmetric in the shipped code:

| Moment | Runs | Network | Anchor | Verified today at |
|---|---|---|---|---|
| **Pin time** — `scripts/sync-gentle-ai-release.mjs` | maintainer / pin-bump CI job | required | minisign-signed `checksums.txt` + trusted-comment repo/tag binding | the pinned digests exist because a human already did this — `gentle-ai-installer.mjs:56-61` |
| **Install time** — `postinstall` | end-user machine | download only | the checked-in pinned digest (now: the lock) | `installSignedRelease` :604 compares `sha256File(archive)` to `asset.sha256` |
| **Pack time** — `prepack`/every PR | CI | **none** | mirrors + lock | `verify-package-files.mjs` reconciles `contracts/` today |

The assets archive inherits this exact shape: the full plan §5 trust order runs at **pin time**; install time
enforces the locked digests, identical to the binary. No minisign verifier and no trusted key are shipped to
end users — that would be a *new*, larger trust surface, not a stronger one.

## Architecture Decisions

### D1 — Bootstrap decoder and trust order

`lib/release-artifact.ts` (+ generated `runtime/release-artifact.mjs`, added to the `sources` list in
`scripts/build-git-commit-transaction-runner.mjs:9-14`). Stdlib only. It decodes the provider's envelope and
**supported contract major (1)** and nothing else. Exact order, no step reorderable:

1. Resolve pinned release identity from `INSTALLER_VERSION` (#262) + `capabilities/gentle-ai-release.lock.json`.
2. Download `checksums.txt`, `checksums.txt.minisig`, archive — **or** accept `--bootstrap-archive <path>`,
   which must be passed explicitly, is never auto-discovered, and stamps every record `development/bootstrap`.
3. Verify the minisign signature **and** trusted-comment repository/tag binding **before** any extracted byte
   is trusted. (`--bootstrap-archive` records `signature_status: not-applicable/local-unsigned` and is barred
   from pin/acceptance evidence.)
4. Find **exactly one** checksum line for the expected archive name; missing or duplicate ⇒ reject.
5. Verify the archive digest against that signed line.
6. Bounded, confined, no-link, mode-restricted extraction (D2).
7. Decode the envelope: `schema`, `contract.{id,major,minor,schema_id,schema_path}`.
8. **Unsupported major ⇒ fail closed naming the major, before any layout is inferred.** No fallback parse, no
   field probing, no partial trust. Proven against the provider's `artifact-manifest-unsupported-major.fixture.json`,
   which is structurally valid, so rejection can only come from the major.
9. Load the schema at `contract.schema_path` **from inside the archive**; absent ⇒ reject; assert its `$id`
   equals `contract.schema_id` and its digest matches its own manifest entry.
10. Validate manifest + entries: `additionalProperties:false` (unknown key ⇒ reject), `tree.manifest_included`
    must be `false`, entry `type === "file"`, `mode === "0644"`, `sha256:` + 64 lowercase hex, confined
    relative path (provider D3 rules), unique, ascending raw-byte order, and recompute the tree preimage
    `"gentle-ai.release-artifact-tree/v1\x00"` + `path\0type\0mode\0size\0digest\n`.
11. `compatibility.unknown_mandatory` must still read `reject`; anything else is a contract violation.

| Alternative | Rejected because |
|---|---|
| Verify minisign at `postinstall` | Ships a trusted key and a verifier to every end user; adds a new network dependency to install; the pin already carries that evidence. |
| Add a JSON-Schema validator (`ajv`) | A runtime dependency inside the install trust path is a bigger surface than a ~200-line hand-written decoder over a frozen shape. The bundled schema is still loaded, identity-checked and digest-checked. |
| Infer layout from `entries[]` when the major is unknown | Explicitly forbidden by the spec; a guessed layout is a silent downgrade. |

### D2 — Bounded extraction: size is checked **before** bytes are written

`entries[].size` exists precisely so the consumer can bound extraction ahead of the write. A post-hoc digest
check is too late against a decompression bomb — the disk is already full.

```
stage 0  tar -tzv archive              # LISTING ONLY, writes nothing
         ├─ member count  <= MAX_ASSET_ENTRIES
         ├─ per-member size <= MAX_ASSET_FILE_BYTES
         ├─ sum(sizes) <= MAX_ASSETS_UNPACKED_BYTES
         └─ every type char '-' (regular); any link/dev/fifo/dir-escape => reject
stage 1  tar -xzf archive -C staging artifact-manifest.json     # one named member
stage 2  decode + validate manifest (D1 steps 7-11)
stage 3  listing set == {manifest} U entries[] EXACTLY, and listed size == entries[].size
stage 4  tar -xzf archive -C staging                            # only now
stage 5  per file: lstat regular non-symlink, confined, size, sha256, mode & 0o111 == 0
```

Stage 3 is the load-bearing one: an extra archive member, a missing one, or a size that disagrees with the
manifest is rejected **before** stage 4 writes anything. `MAX_DOWNLOAD_BYTES` (100 MiB, `:23`) already bounds
the compressed side.

| Alternative | Rejected because |
|---|---|
| Extract, then digest | The bomb has already landed. |
| A JS tar implementation | A second extractor path weaker than `trustedSystemExtractor` (`:156-166`), plus a new dependency. |

### D3 — Atomic bundle: reuse the existing single rename, add no publish operation

`publishBundle` (`:528-549`) is already the one all-or-nothing rename, called exactly once by
`installSignedRelease` (`:615`) and once by the Windows path (`:588`). Design adds **nothing** to publication:

```
staging/
├── gentle-ai(.exe)   binary via its platform trust path
├── assets/           bounded, verified extraction (D2)
└── integrity.json    ONE manifest covering both provenances
        └── publishBundle()  rename(v<V>, .backup-…) ; rename(staging, v<V>)
```

`existingSignedBundleMatches` / `existingWindowsSourceBundleMatches` are extended to validate the assets tree.
Because `recoverInterruptedPublication(runtimeRoot, bundleIsValid, options)` (`:502-517`) takes that *same*
predicate (`:573`, `:596`), interrupted-publication recovery is covered with zero new code: a bundle with a
binary but no assets is **invalid by construction**, never "good enough". Half-published state is therefore
unobservable rather than merely unlikely.

**Stale-bundle lifecycle**: `cleanupStaleStagingBundles` (`:519`) already removes `.v<V>.staging-*`; backups are
removed on success (`:547`) or reconciled by recovery. P2 adds `pruneSupersededBundles(runtimeRoot)`, which
removes `v<other-version>` directories **only after** the new bundle's rename succeeds, never the live one, and
whose failure is non-fatal and logged. `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1` skips both or neither — the skip
check already precedes `installGentleAi`, so no new branch can get it wrong.

### D4 — Integrity manifest extension without weakening any guarantee

`isCanonicalManifest` (`lib/gentle-ai-binary.ts:95-99`) demands exact key count **and** exact JSON-string
equality. That stays byte-for-byte unmodified: the key set grows, the discipline does not.

| Manifest keys added | POSIX | Windows |
|---|---|---|
| `assetsAsset`, `assetsArchiveSha256`, `assetsTreeSha256` | yes | yes (same signed archive, D5) |
| `contractMajor`, `layoutVersion` | yes | yes |

`resolveGentleAiBinary` keeps validating the **whole** manifest — a missing or forged assets digest fails binary
resolution — but does **not** walk the assets tree; the hot path stays one file hash. A new exported
`resolveGentleAiAssets(packageRoot, platform)` does the N-file work, lazily, only for snapshot readers:

- walk `<bundle>/assets`, then assert the found path set **exactly equals** the manifest entry set (a tree
  digest over "files I found" cannot detect an added file — the exact-set check can);
- per file `lstat` regular-non-symlink (`assertRegularNonSymlink`, `:50-53`), confined (`isConfined`, `:45-48`),
  size, sha256, and `mode & 0o111 === 0`;
- recompute `assetsTreeSha256`;
- the same before/after `sameFile` TOCTOU re-check (`:101-103`, `:122-131`) across the **whole** file set plus
  the manifest, not only the first and last file.

`assertPosixExecutable` is never applied to an asset. Only the single named binary may carry the exec bit.

| Alternative | Rejected because |
|---|---|
| Hash the tree inside `resolveGentleAiBinary` | Turns a one-file hash into an N-file walk on every native review call. |
| A second manifest file for assets | Two manifests can disagree; one cannot. |

### D5 — Windows split provenance, one bundle, two provenances

`windowsSourceManifest` (`:65-86`) keeps every existing field (method, package, module, tag, architecture,
`binarySha256`, `moduleChecksum`, `goVersion`, goos/goarch/buildMode/compiler/cgoEnabled) and gains the same
assets keys. Windows downloads the **same** platform-independent signed archive (no goos/goarch axis), verifies
it against the locked digests exactly as POSIX does, and publishes both in the one `publishBundle` rename
(`:588`). A live `gentle-ai.exe review capabilities --contract gentle-ai.review-integration/v2` call **may**
cross-check the signed snapshot (compare operation/gate/projection/schema/feature name sets) and MUST fail
closed on mismatch — it never writes the snapshot and never creates authority. Superseded conclusion S4 stands
reversed: locally regenerated bytes have no release provenance.

### D6 — Mirrors, lock, and offline gates

| Checked in | Written by | Role |
|---|---|---|
| `contracts/review-integration/{v1,v2}/**` | sync script only | byte mirror |
| `contracts/release-artifact/v1/schemas/artifact-manifest.schema.json` | sync script only | the schema the decoder validates against offline |
| `capabilities/review-integration-v2.semantic.json` | sync script only | semantic snapshot mirror |
| `docs/gentle-ai/review-integration.md` | sync script only | provider doc mirror |
| `capabilities/gentle-ai-release.lock.json` | sync script only | the canonical lock |
| `capabilities/native-cli-history.json` | hand-authored, append-only | the 4 non-derivable envelope flags |

`docs/review-integration.md` is **Pi-authored** (it backlinks `../README.md`), stays un-gated here, and is
deliberately not converted into an overlay target in this change.

**Lock contents** (canonical: LF, 2-space, entries sorted by raw path bytes, one trailing LF):
`release{repository,tag,version,commit}` · `contract{id,major,minor,schemaId,schemaPath,layoutVersion}` ·
`archive{asset,sha256,digestSource:"signed-checksums.txt"}` · `tree{algorithm,canonicalization,digest}` ·
`entries[]{path,type,mode,size,digest}` copied verbatim from the manifest ·
`generated[]{path,sha256}` for every mirror file and every generator output.

`lock.release.version` is **not** a second version literal: a gate asserts it equals `INSTALLER_VERSION`,
preserving #262's single authoritative pin.

`scripts/verify-package-files.mjs` deletes the ~60-entry `contractHashes` map (`:78-145`) and reconciles the
on-disk mirror tree against `lock.entries` using its existing walk shape (`reconcileContractsOnDisk`, `:155`):
unlisted-on-disk, listed-but-missing, and digest drift each fail naming exact files. Every per-PR check is
offline; only the pin-bump job downloads.

### D7 — Generators: derived data, frozen floor, visible removals

`scripts/build-gentle-ai-baselines.mjs --write|--check` (same CLI shape as
`build-git-commit-transaction-runner.mjs:34-60`) reads **only** the checked-in snapshot mirror and lock.

| Output | Rule |
|---|---|
| `lib/gentle-ai-required-floor.generated.ts` (consumed by `lib/review-integration-v2.ts`) | **Monotone regeneration.** `--write` may ADD a name; a name disappearing from the snapshot's `required` block makes the generator **fail** naming it. A removal is a compatibility event requiring a hand-authored deletion — never absorbed silently. This is how a generated file still behaves as a frozen floor (provider D4: a floor computed at generation time stops being a floor). |
| Mandatory features | Exact set, no tolerance. An advertised mandatory name absent from Pi's set is a hard failure naming it — it is never auto-added, because a mandatory feature needs client code. Preserves #263 unchanged. |
| Next `NATIVE_CLI_CONTRACTS` row | 13 of 17 flags derive from snapshot `operations[]` via a `review.<op>` → column map. The 4 envelope flags (`mode`, `riskEvidence`, `hint`, `delivery`) have no snapshot field (`lib/native-review-cli.ts:639-641,689`) and come from `capabilities/native-cli-history.json`; the generator **fails** if the pinned version lacks an `envelopeFlags` block. |
| The 12 frozen historical rows | Moved **once, verbatim**, with their prose as `notes` re-emitted as comments. They describe immutable releases, are input data rather than output, and are never regenerated. |
| Unmapped operation | Exit non-zero: `gentle-ai <v> advertises operation "<op>" with no NativeCliCapability column. Add the column and its decoder in lib/native-review-cli.ts, then re-run --write.` Never a silent pass. |

Generated data lands in its own file so reviewers can separate it from authored decode logic.

### D8 — Skill vendor and overlay

| Overlay representation | Tradeoff | Decision |
|---|---|---|
| Unified-diff patch | Breaks on any upstream line-number shift; unreadable review diff | Rejected |
| Full fork + hash of the forked-from upstream | Makes "what did Pi actually change?" invisible in review | Rejected |
| **`overlay.md` sidecar with ordered anchored replace blocks** | Fails loudly when an anchor disappears upstream — exactly the signal a pin bump needs — and each block reads as one intentional Pi delta | **Chosen** |

```
skills/_vendor/<name>/SKILL.md     written only by the sync script
skills/_vendor/<name>/overlay.md   hand-authored ordered [anchor]/[replace] blocks
skills/<name>/SKILL.md             generated by scripts/build-skill-overlays.mjs --write|--check
```

The allowlist is a list of **candidates requiring a per-file portability comparison before admission**, not an
approved set: `comment-writer` (differs by exactly one deliberate Pi sentence), `work-unit-commits` (missing one
requirement gentle-ai has), `branch-pr`, `chained-pr`, `cognitive-doc-design`. Second tier —
`judgment-day`, `skill-creator`, `skill-improver`, `skill-registry` — is admitted one file at a time, each an
independent revert. `skills/issue-creation/SKILL.md` is **excluded entirely and gets no gate**: each copy
describes a different repository, which is identity, not drift.

Drift gate message (exact): `edit the overlay, not the vendored file: skills/_vendor/<name>/overlay.md`.

### D9 — Phase-coverage gate for `assets/agents/**` and `assets/chains/**`

Never byte-vendored. Verified dialect difference: `tools:` is a comma string upstream and a lowercase YAML list
in Pi, upstream templates `{{CLAUDE_MODEL}}`, and upstream has **no** `chains/` directory at all. Byte-vendoring
would destroy Pi's binding layer. Offline gate in `verify-package-files.mjs`, driven by the snapshot mirror plus
a checked-in `assets/phase-coverage.json`: every provider-declared phase has a Pi agent binding, and every Pi
binding names a declared phase or is listed Pi-only. Declared alias: `sdd-proposal` ↔ `sdd-propose`. Declared
Pi-only: `gentle-ai-explore`, `gentle-ai-worker`, `gentle-ai-verify`, `sdd-status`, `sdd-sync`,
`review-validator`. Failure names the missing binding.

## Data Flow

```
signed release R ──► sync-gentle-ai-release.mjs --write        (pin-bump job ONLY, network)
   checksums.txt + .minisig + assets.tar.gz
        │  D1 trust order 1-11, D2 bounded extraction
        ├──► contracts/**, capabilities/*.semantic.json, docs/gentle-ai/**, schema   (mirrors)
        ├──► capabilities/gentle-ai-release.lock.json                                (lock)
        └──► skills/_vendor/**                                                       (vendor)
                 │
   EVERY PR (offline) ──┬─ verify-package-files.mjs   mirrors + lock + phase coverage
                        ├─ build-gentle-ai-baselines.mjs --check
                        └─ build-skill-overlays.mjs --check
                 │
   postinstall ──► installer: binary trust path + assets (lock digests, D2) ──► staging
                        └─ ONE integrity.json ──► publishBundle() single rename ──► .gentle-ai/v<V>/
                                                        └─ resolveGentleAiAssets() on read (D4)
```

## File Changes

| File | Action | Unit |
|---|---|---|
| `lib/release-artifact.ts` (+ `runtime/release-artifact.mjs`, `sources` entry) | Create | P1 |
| `scripts/sync-gentle-ai-release.mjs` | Create | P1 |
| `contracts/review-integration/v1/**`, `contracts/release-artifact/v1/schemas/**`, `capabilities/review-integration-v2.semantic.json`, `docs/gentle-ai/review-integration.md` | Create (mirror) | P1 |
| `capabilities/gentle-ai-release.lock.json` | Create | P1 |
| `scripts/verify-package-files.mjs` | Modify — lock reconciliation replaces `contractHashes` | P1 |
| `scripts/gentle-ai-installer.mjs` | Modify — assets descriptor, D2 staged extraction, extended bundle predicates, `pruneSupersededBundles` | P2 |
| `lib/gentle-ai-binary.ts` (+ runtime) | Modify — manifest keys, `resolveGentleAiAssets()` | P2 |
| `scripts/build-gentle-ai-baselines.mjs`, `lib/gentle-ai-required-floor.generated.ts`, `capabilities/native-cli-history.json` | Create | P3 |
| `lib/review-integration-v2.ts`, `lib/native-review-cli.ts` (+ runtime) | Modify — consume generated floor / generated row | P3 |
| `scripts/build-skill-overlays.mjs`, `skills/_vendor/**`, `skills/*/overlay.md` | Create | P3 |
| `assets/phase-coverage.json` | Create | P3 |
| `tests/evidence/**` — generic immutable-evidence harness (plan §12 ledger shape, S vs R classes) | Create | P3 |
| `scripts/bump-gentle-ai-pin.mjs`, `.github/workflows/gentle-ai-release-received.yml` | Create | P4 |
| `.github/workflows/ci.yml` | Modify — offline `--check` set; download only in the pin-bump job | P1/P3/P4 |

## Interfaces / Contracts

```typescript
// lib/release-artifact.ts — consumes the provider shape; defines none of it.
const ENTRY_TYPE = { FILE: "file" } as const;
type EntryType = (typeof ENTRY_TYPE)[keyof typeof ENTRY_TYPE];

interface ArtifactEntry { path: string; type: EntryType; mode: "0644"; size: number; digest: string }
interface ArtifactContract { id: string; major: number; minor: number; schemaId: string; schemaPath: string }

export const SUPPORTED_CONTRACT_MAJOR = 1;
export function decodeArtifactManifest(bytes: Buffer): ArtifactManifest; // unknown major => throws, names it
export function treeDigest(entries: readonly ArtifactEntry[]): string;   // provider preimage, verbatim
```

## Testing Strategy

Strict TDD (`openspec/config.yaml: strict_tdd: true`) — RED before production in every unit.

| Layer | What | Approach |
|---|---|---|
| Unit — decoder | Unsupported major rejected naming it, with a structurally valid fixture; unknown key; `manifest_included:true`; absolute/`..`/backslash/NUL/over-length/duplicate/unsorted path; non-`file` type; non-`0644` mode; bad digest shape; missing bundled schema; `$id` mismatch | table-driven `node:test` over provider fixtures |
| Unit — tree digest | Known-vector preimage; input-order independence; manifest exclusion | checked-in expected hex |
| Unit — bounded extraction | Listing exceeding entry/file/total caps rejected **with zero bytes written**; extra member; missing member; size disagreement; link/device member | fake extractor seam + `t.TempDir()`-equivalent |
| Unit — bundle atomicity | Assets missing ⇒ bundle invalid ⇒ recovery restores backup; publish is exactly one rename; prune never touches the live bundle | existing `options.rename` seam |
| Unit — manifest/assets | Extra file in tree rejected; symlinked asset; asset with `0755`; TOCTOU replacement mid-verify; `resolveGentleAiBinary` still rejects a forged assets digest | `lstat` seam |
| Unit — Windows | Split provenance recorded in one manifest; cross-check mismatch fails closed; cross-check never writes the snapshot | fixture + fake `execFile` |
| Unit — generators | Floor addition accepted; floor **removal** fails naming it; unknown mandatory rejected; unmapped operation message; pinned version without `envelopeFlags` fails | golden + failure cases |
| Unit — overlay/gates | Missing anchor ⇒ exact "edit the overlay, not the vendored file" message; drifted mirror named; missing phase binding named; `issue-creation` never flagged | fixture pairs |
| Integration | Full offline `--check` set over the real tree | `pnpm test` in CI |
| Evidence — S | Bootstrap archive via `--bootstrap-archive`, labeled `development/bootstrap` | plan §12 ledger |
| Evidence — R | Live signed release: signature, repo/tag binding, digests, install, all three platforms | pin-bump-only job; the sole final-acceptance class |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths / executable classification | **Applicable** — the assets tree carries `.md`/`.json`/`.sh`-shaped names into a runtime directory | Entries admitted only as `type:"file"` mode `0644`; assets written and verified non-executable; `assertPosixExecutable` never applied to an asset | An entry named `install.sh` lands non-executable; an archive whose member is mode `0755` is rejected |
| Archive extraction *(added row)* | **Applicable** — a second archive through the trusted extractor | D2 staged bound-before-write; `lstat` regular/non-symlink/confined re-check after extraction | `../escape`, symlink, hardlink, absolute-path, and oversize members each rejected with zero bytes written |
| Network trust boundary *(added row)* | **Applicable** — pin-time download | Signature and repo/tag binding verified before extraction; exactly one checksum line; bootstrap input must be explicit and is barred from pin evidence | Forged signature; wrong trusted-comment repo/tag; missing and duplicate checksum lines; a bootstrap record rejected as acceptance evidence |
| Subprocess invocation *(added row)* | **Applicable** — Windows `gentle-ai.exe review capabilities` cross-check | Fixed argv, no shell, bounded output, sealed environment already used by `go install` | Non-zero exit, oversized output, and non-JSON output each fail closed with no bundle published |
| PR commands | **Applicable in P4** — the receiver opens a bump PR | Dispatched tag validated against `^v\d+\.\d+\.\d+$` before use; explicit `--base main`; head branch derived only from the validated tag; no payload interpolation into a composed command | Tag carrying shell metacharacters; `--head` injection attempt; implicit-base rejection |
| Git repository selection | **N/A** — no `git -C`, no cwd-derived authority; capabilities are repository-independent by contract | — | — |
| Commit state | **N/A** — no index or worktree mutation | — | — |
| Push state | **N/A** — no ref resolution; publishing reuses the existing `workflow_dispatch` `publish.yml` | — | — |

## Migration / Rollout

Feature-branch chain, one tracker in gentle-pi, strict order **P1 → P2 → P3 → P4**.

| Unit | Boundary | Independently revertible | 400-line forecast |
|---|---|---|---|
| **P1** | Decoder + sync path + complete mirrors + lock + lock-based reconciliation. Installer behavior untouched. | Delete decoder/sync/mirrors/lock; restore `contractHashes` | **High** → split **P1a** (decoder + tests, no mirrors) / **P1b** (sync script + mirrors + lock + `verify-package-files.mjs`) |
| **P2** | Assets install on all platforms, extended integrity manifest, `resolveGentleAiAssets`, recovery + prune, Windows split provenance. **Carries the only `package-runtime` delta.** | Revert to the binary-only bundle | **High** → split **P2a** (POSIX assets + manifest + resolver) / **P2b** (Windows provenance + cross-check + lifecycle) |
| **P3** | Generators, generated floor, capability row, vendor + overlay, phase-coverage gate, evidence harness | Remove pipeline/overlays/harness; prior manual checks return; P1/P2 trust code untouched | **High** → split **P3a** (baselines + floor + row) / **P3b** (vendor + overlay + drift gate) / **P3c** (phase coverage + evidence harness) |
| **P4** | Bump script + default-branch `repository_dispatch` receiver | Remove automation; manual verified bump remains | Medium |

> **Hard sequencing rule — must not be lost.** `package-runtime` has no base in `openspec/specs/`; its only
> definition lives in the unarchived sibling `consolidate-review-parity-runtime` (`archive: pending`).
> **P2 MUST NOT open until that sibling is archived and `openspec/specs/package-runtime/spec.md` exists.**
> Enforce it mechanically, not by memory: P2's first task is a guard that asserts that file's existence and
> fails otherwise. P1, P3 and P4 carry no `package-runtime` delta and are unblocked today.
>
> **Stall escape hatch**: P2 and P3 touch disjoint files, so if the sibling is still pending when P1 lands, P3
> may be re-parented onto P1 and P2 rebased after it. That is a rebase only — no unit's content changes.

Live `repository_dispatch` activates only after P4's receiver reaches `main`; bump PRs target `main`, never a
temporary tracker. Provider slices must not be reverted while consumer slices are live.

## Open Questions

- [ ] **This worktree's base predates #262/#263** — `gentle-ai-installer.mjs:22` still hardcodes the release URL
      version, and `lib/review-integration-v2.ts:715-720` still uses `enumArray(…{min:5,max:5})` +
      `assertExactSet` for gates/projections. The design assumes the post-#262/#263 `main`. The tracker MUST be
      rebased onto that `main` before P1 opens, or P1 will re-introduce work already delivered.
- [ ] The provider's branch A vs branch B assembly decision (their D5) is **consumer-neutral**: archive name,
      manifest and canonicalization are identical either way. No consumer rework on a negative result.
- [ ] The four second-tier portable-skill candidates need a per-file diff before admission; schedule them as
      four independent, individually revertible admissions inside P3b.
