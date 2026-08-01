# Proposal: Consume gentle-ai release artifacts instead of hand-copying

> **Reconciled 2026-08-01** against `gentle-ai-pi-release-artifact-plan.md` (decisions D1–D12).
> **Consumer-side only.** Provider publishing is `publish-gentle-ai-release-artifacts` in gentle-ai;
> Wave 1 host behavior is `gentle-ai-main-behavior-parity` in gentle-pi.

## Intent

gentle-pi hand-transcribes what gentle-ai already declares, and pays the tax on every release.

| Parity tax | Evidence today |
|---|---|
| Capability rows re-derived by booting each released binary | 12 hand-authored rows, `lib/native-review-cli.ts` |
| Contract bytes pinned by hand | ~60 `contractHashes` entries, `scripts/verify-package-files.mjs` |
| Recurring per-release ritual | worktrees `v2.1.9-integration`, `v2.1.10-compatibility`, `v2.1.11-parity` |

The distribution pipe **already exists and its payload is discarded**: `.goreleaser.yaml` ships
`docs/review-integration.md` and `contracts/review-integration/v1/**` inside all four platform
archives, and `scripts/gentle-ai-installer.mjs` (~:181-187) keeps only the executable. Meanwhile
`contracts/review-integration/v2/**` — the only version gentle-pi speaks — is never packaged at all.

**Principle:** one repository declares, one consumes, and a gate fails when derived content is
hand-edited.

## The two consumption moments

Conflating them was a defect in the previous plan. They have different inputs, evidence classes, and
failure modes.

| | **Pack time** (vendoring) | **Install time** (extraction) |
|---|---|---|
| Runs | gentle-pi CI + `prepack` | end-user `postinstall` |
| Input | checked-in mirrors + canonical lock | signed `checksums.txt`, minisign signature, assets archive |
| Network | none, except an explicit pin-bump job | required unless explicitly skipped |
| Output | npm tarball contents and generated baselines | one atomic `.gentle-ai/v<version>/` bundle |
| Failure | drift gate names exact files; no hand-edit to force green | fail closed before publish; prior bundle preserved or restored |

## Scope

### In scope (gentle-pi only)

- Signed sync path, minimal bootstrap decoder for the known envelope and **supported contract major**,
  complete checked-in contracts/docs/snapshot mirrors, and a canonical lock.
- The **same** signed assets archive installed on Linux, macOS, and Windows, published atomically with
  the binary under one integrity manifest carrying two distinct provenances.
- Deterministic generators (`--check` in CI, `--write` on pin bump) producing the `REQUIRED_*` floors
  and the next `NATIVE_CLI_CONTRACTS` row from the semantic snapshot; `contractHashes` replaced by
  mirror/lock reconciliation.
- Offline drift gates, portable shared-skill vendor + overlay, and a **generic** immutable-evidence
  harness usable by later changes.
- Pin-bump script plus a `repository_dispatch` receiver workflow on the **default branch**.

### Out of scope

| Excluded | Why |
|---|---|
| Any gentle-ai implementation | Provider owns the contract, snapshot, archive, and notification (D1). |
| **PR #262** — one authoritative version pin | Already on `main`. `INSTALLER_VERSION` is the sole literal; release URL, Windows source tag, `GENTLE_AI_VERSION`, and the version regex in `assertExactGentleAiVersion` all derive from it (D7). |
| **PR #263** — additive-tolerant gate/projection floors | Already on `main`; mandatory features stay exact (D7, D9). |
| The v1 negotiation lane | gentle-pi remains v2-only (accepted 2026-07-29). |
| The 12 frozen historical capability rows | They describe immutable releases. The burden removed is the *next* row. |

### Non-goals (explicit)

1. **No generated client code** for new provider operations or envelope fields. An unmapped operation
   stops generation with an actionable message naming it and the decoder work required — it never
   appears supported because a snapshot listed it.
2. **No copied provider state machines, topology algorithms, or authority graphs** in TypeScript.
3. **No Pi agent/chain vendoring.** `assets/agents/**` and `assets/chains/**` are Pi runtime bindings.
   gentle-ai's agent assets target other runtime dialects and it has **no chains directory at all**.
   They get a **phase-coverage / name-alias gate**, never a byte-hash vendor gate. Repo-identity
   skills (`skills/issue-creation/SKILL.md`) are never vendored and get no gate.
4. **No mixed-repository PR chains.** One tracker per repository; the bridge is a published immutable
   release (D6).
5. **No mutable provider `main`** — binary or bytes — as final release evidence (D11).
6. **No mandatory-feature superset acceptance.** The provider advertises
   `compatibility.unknown_mandatory: "reject"` (`capabilities.fixture.json:95-100`); only gates and
   projections relax to required floors (D9).

## Bootstrap evidence boundary

| Class | Source | May prove | May **not** prove |
|---|---|---|---|
| **S** — bootstrap | local `goreleaser --snapshot`, unsigned, never uploaded | decoder, layout, extraction, install, generator behavior | authenticity, pin acceptance, final provenance |
| **R** — live signed release | downloaded checksums + minisign + archive | release identity, authenticity, package pin, production acceptance | anything outside the declared contract |

S unblocks P1–P3 development immediately; gentle-pi does not wait idle for R. Every S result is
labeled `development/bootstrap` and no S result is ever relabeled as R.

## Capabilities

### New Capabilities

- `provider-artifact-parity`: consumer verification of release identity, contract major, manifest,
  archive and tree digests, canonical entries; checked-in mirrors and lock; deterministic generation;
  offline drift gates; default-branch receiver contract.
- `provider-capability-negotiation`: required floors for operations/schemas/gates/projections, exact
  and rejected mandatory features, and actionable unmapped-operation failure.

### Modified Capabilities

- `package-runtime`: install-time provisioning extends from binary-only to a binary **plus** assets
  bundle published atomically under one integrity manifest, with interrupted-publication recovery and
  split Windows provenance.
  *Note:* `package-runtime` has no entry in `openspec/specs/`; its only definition lives in the
  unarchived sibling `consolidate-review-parity-runtime` (`state.yaml` → `archive: pending`). That is
  a hard sequencing dependency for P2.

## Approach: work units P1–P4

All four are repository-local to gentle-pi, delivered as children of one gentle-pi feature-branch
tracker, in strict dependency order.

| Unit | Delivers | Starts when | Rollback boundary |
|---|---|---|---|
| **P1** | Bootstrap envelope/major decoder, signed sync path, complete checked-in mirrors, canonical lock | provider contract accepted; S available | remove decoder/sync/mirrors/lock; installer behavior unchanged |
| **P2** | Same assets archive on all platforms; atomic bundle + integrity manifest; interrupted-publication recovery; split Windows provenance | P1 interface stable **and** `consolidate-review-parity-runtime` archived | revert assets install/manifest; restore binary-only bundle |
| **P3** | Generators, offline drift gates, portable shared-skill vendor + overlay, generic immutable-evidence harness | P1/P2 integrated; S provides the full payload | remove pipeline/overlays/harness; prior manual checks return; P1/P2 trust code untouched |
| **P4** | Bump script + default-branch `repository_dispatch` receiver; manual/bootstrap activation first | P3 regeneration is authoritative | remove automation; manual verified bump remains |

```text
P1 -> P2 -> P3 -> P4 -> merge tracker
      ^
      └── requires: consolidate-review-parity-runtime archived

R (immutable signed release, published by gentle-ai) -> final acceptance for P1..P4
```

Live `repository_dispatch` is enabled only after P4's receiver reaches `main`; future automated bump
PRs target `main`, never a temporary tracker.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `scripts/gentle-ai-installer.mjs` | Modified | assets descriptor; stop discarding the payload |
| `runtime/gentle-ai-binary.mjs` (+ `lib/gentle-ai-binary.ts`) | Modified | integrity manifest covers assets, contract major, layout |
| `scripts/verify-package-files.mjs` | Modified | mirror/lock reconciliation replaces `contractHashes` |
| `contracts/**`, `docs/review-integration.md`, snapshot mirror, lock file | New/Modified | provider-derived, one-way, checked in |
| `lib/review-integration-v2.ts`, `lib/native-review-cli.ts` | Modified | generated floors and the next capability row |
| `skills/_vendor/**` + overlays | New | portable shared skills only |
| `assets/agents/**`, `assets/chains/**` | Gate only | phase-coverage / name-alias check; **not vendored** |
| `.github/workflows/ci.yml`, new receiver workflow | Modified/New | offline gates every PR; download only on pin bump |

`.github/workflows/publish.yml` already publishes with `npm publish --provenance --access public
--tag "${DIST_TAG}"` under `workflow_dispatch` — P4 reuses that mechanism rather than inventing one.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Half-published bundle (binary present, assets missing) | Med | all-or-nothing atomic publish; fail closed before swap; recovery test |
| Offline / `GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1` leaves assets absent | Med | assets skip exactly as loudly and as skippably as the binary; never half-configured |
| Unsupported contract major arrives | Med | fail closed with an actionable error **before** trusting layout; preserve installed bundle and mirrors |
| Bootstrap (S) and live (R) semantics differ unexpectedly | Med | invalidate bootstrap assumptions and block acceptance; reconcile deterministic inputs with the provider |
| Generated/vendor diff hides behavioral change | Med | separate generated evidence from authored logic; bounded slices; lock/diff summaries |
| Vendored file edited instead of the overlay | Med | per-PR gate with "edit the overlay, not the vendored file" |
| Cross-repository credentials unavailable | Med | core install/generation independent; manual verified bump; credential errors fail visibly |
| Stale `.gentle-ai/vX.Y.Z/` bundles accumulate | Low | frozen historical rows stay valid; P2 defines bundle lifecycle |

## Rollback Plan

Each unit is independently revertible in reverse order, P4 → P1. Reverting P4 leaves the manual
verified bump. Reverting P3 restores hand-maintained baselines and manual checks without touching
trust code. Reverting P2 restores the binary-only bundle. Reverting P1 restores the checked-in
`contracts/` tree and the `contractHashes` map. The provider's assets archive then becomes unused but
harmless. Provider slices must not be reverted while consumer slices are live.

## Dependencies

- **Provider change** `publish-gentle-ai-release-artifacts` must define the contract, semantic
  snapshot, and assets archive. gentle-pi authors no competing format (D1).
- **Bootstrap snapshot S** from the provider branch unblocks P1–P3 development.
- **Immutable signed release R** is required for final acceptance and pin evidence, and is the only
  cross-repository bridge (D11).
- **`consolidate-review-parity-runtime` must be archived** before P2 integrates or opens.
- PRs **#262** and **#263** are already on `main` and are prerequisites, not work units.

## Success Criteria

- [ ] A gentle-ai pin bump is one pin change plus regenerated artifacts — no hand-transcribed contract
      bytes, capability rows, or duplicated version strings.
- [ ] Every per-PR check passes **offline** against checked-in mirrors and the lock; only a pin-bump
      job downloads.
- [ ] Linux, macOS, and Windows install byte-identical assets from the same signed archive, while
      Windows keeps its Go SumDB source-build binary path and regenerates no authority locally.
- [ ] An unsupported contract major fails closed with an actionable error before any layout is trusted.
- [ ] An unknown **mandatory** feature is rejected; an added gate or projection is tolerated and
      narrowed to the supported required floor.
- [ ] A new unmapped provider operation fails generation with a message naming it and the decoder work
      required — never a silent pass.
- [ ] A hand-edit to any mirrored, generated, or vendored file fails a per-PR gate naming the file.
- [ ] The assets bundle publishes atomically with the binary or not at all, proven by an
      interrupted-publication recovery test.
- [ ] `repository_dispatch` is activated only after the receiver is on `main`, and bump PRs target
      `main`.
- [ ] No S-class result is recorded as release, pin, or final-acceptance evidence.
- [ ] Non-consumable surfaces (new client decoders, Pi agent/chain bindings, repo-identity skills) are
      documented as such, never silently assumed covered.
