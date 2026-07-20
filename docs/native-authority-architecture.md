# Native Authority Architecture After #191

← [Back to README](../README.md)

U8 closed the U1-U7 slimming work. Issue [#191](https://github.com/Gentleman-Programming/gentle-pi/issues/191) then extracted Pi command projection and publication revalidation from graph-v1 authority storage. New ordinary review authority is native; Pi retains permanent consumer infrastructure and explicit graph-v1 Judgment Day.

## Current Ownership

| Surface | Owner after #191 |
| --- | --- |
| Ordinary START, FINALIZE, target status, validation, SDD binding, recovery, and reconciliation | Package-local Gentle AI v2.1.11 through `gentle-ai.review-integration/v1` |
| Canonical consumer identities | Permanent Pi module `lib/review-canonical.ts` |
| Git common-directory and repository identity | Permanent Pi module `lib/review-repository.ts` |
| Immutable reviewer candidate views | Permanent Pi module `lib/review-candidate-view.ts` |
| Typed command targets, remote binding, release projection, and publication rechecks | Permanent Pi module `lib/review-publication-gate.ts` |
| Direct commit transaction and dangerous-command safety | Pi; independent of review authority |
| Explicit Judgment Day and historical graph semantic replay | Pi graph-v1 until a separately proven replacement exists |
| Historical graph receipt validation | Pi graph-v1 transaction, reachable only for historical graph authority and explicit Judgment Day |

Pi no longer owns an ordinary compact store, compact gate, compatibility facade, supersession writer, graph bundle transport, mirror, checkpoint, reset writer, graph reducer mirror, or standalone revision/HEAD transaction backend.

## Dependency Boundary

The permanent modules have direct production consumers after #191:

| Permanent module | Direct production consumers |
| --- | --- |
| `review-canonical.ts` | `extensions/gentle-ai.ts` and eight live review modules |
| `review-repository.ts` | `extensions/gentle-ai.ts`, graph object store, legacy detector, snapshot, and transaction |
| `review-candidate-view.ts` | `extensions/gentle-ai.ts` |
| `review-publication-gate.ts` | `extensions/gentle-ai.ts` and graph-v1 receipt validation in `review-transaction.ts` |

The remaining ordinary reducer is not dead authority. Historical graph event replay calls it to validate semantic adjacency. Deleting it would weaken graph integrity even though controller mutation is read-only.

## Reproducible Metrics

Run from the repository root:

```bash
node scripts/measure-native-authority-slimming.mjs origin/main HEAD WORKTREE
git diff --shortstat origin/main..HEAD
git diff --shortstat HEAD
git diff --shortstat origin/main
wc -l docs/native-authority-architecture.md scripts/measure-native-authority-slimming.mjs lib/review-publication-gate.ts
```

The measurement script defines package footprint as unpacked bytes selected by `package.json#files` plus npm's always-included `package.json`, `README.md`, and `LICENSE`. Source LOC is physical lines in `extensions/**/*.ts`, `lib/**/*.ts`, `runtime/**/*.mjs`, and `scripts/**/*.mjs`. Test LOC is physical lines in `tests/**/*.ts` and `tests/**/*.mjs`.

| Snapshot | Package files | Package bytes | Source files / LOC | Test files / LOC | Local import edges | Review import edges |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `origin/main` (`2f00a308`) | 222 | 4,051,652 | 55 / 28,588 | 64 / 23,759 | 130 | 107 |
| U1-U4 `HEAD` (`0c3a87d4`) | 214 | 3,966,197 | 50 / 27,979 | 61 / 23,111 | 109 | 86 |
| U1-#191 worktree at `0c3a87d4` | 208 | 3,706,418 | 48 / 24,604 | 56 / 21,029 | 75 | 53 |

Relative to `origin/main`, U1-#191 removes 14 package files and 345,234 unpacked bytes, 3,984 source LOC, 2,730 test LOC, 55 local import edges, and 54 review import edges. Relative to the committed U1-U4 `HEAD`, the unstaged U5-#191 work removes 6 package files and 259,779 unpacked bytes, 3,375 source LOC, 2,082 test LOC, 34 local import edges, and 33 review import edges.

The committed U1-U4 baseline is `origin/main..HEAD`. U5-U8 and #191 are in the unstaged `HEAD` worktree delta. The complete delivery candidate is `origin/main` versus the worktree.

| Diff boundary | Files | Additions | Deletions |
| --- | ---: | ---: | ---: |
| Committed U1-U4: `git diff --shortstat origin/main..HEAD` | 21 | 770 | 2,027 |
| Unstaged U5-#191, including three untracked delivery artifacts | 33 | 1,591 | 6,940 |
| Accumulated U1-#191, including three untracked delivery artifacts | 46 | 2,302 | 8,908 |

The two unit ranges are intentionally reported separately. `git diff --shortstat` excludes untracked files, so the architecture report, measurement script, and publication-gate module contribute 726 added lines to the reported U5-#191 and accumulated totals. Unit-range additions and deletions are not arithmetically additive because U5-#191 also edits or removes paths already changed by U1-U4; the accumulated comparison is Git's final origin-to-worktree result.

## Retired Modules

U1-U8 retire nine review modules present on `origin/main`:

| Unit range | Retired modules |
| --- | --- |
| U1-U4 | `review-bundle`, `review-checkpoint`, `review-graph-reducer`, `review-mirror`, `review-reset` |
| U5-U8 | `review-authority-supersession`, `review-compact-gate`, `review-compact-store`, `review-facade` |

U8 found no additional zero-consumer code module. Remaining graph, ordinary-policy, compact-contract, runtime-contract, snapshot, trigger, risk, and refuter modules retain production, contract, or semantic-replay consumers.

The packaged `contracts/review-integration/v1/` schemas and fixtures plus `docs/review-integration.md` are byte-identical v2.1.11 provider artifacts, not dead Pi compatibility documentation. Package verification proves their hashes.

## Published Maintenance Boundary

Gentle AI v2.1.11 exposes explicit, audited maintenance commands outside negotiated ordinary review. Pi invokes `review abandon`, `review quarantine-legacy`, and `review reconcile-authority` only after fresh interactive approval of exact LF-only authorization text; headless execution and absent, malformed, or stale bindings fail closed.

`abandon` is restricted by native re-derivation to a caller-named pristine compact-v2 reviewing or invalidated lineage. `quarantine-legacy` accepts only the published malformed freeze-findings diagnostic and disposition. Reconciliation accepts the exact dual anomaly suffix `anomalies=unchanged_target,malformed_recovery_authorization` only in that order. `repair-legacy-alias` derives repository, revision, diagnostic, and disposition from freshly read native inventory before its own approval and can only quarantine one qualified historical alias chain. `review dispose-result` remains unexposed pending design. Recovery routes only the provider-selected negotiated `action_disposition`.

## Windows Evidence

Current code contains Windows-aware paths but does not prove complete Windows support:

| Surface | Code evidence | Supported claim |
| --- | --- | --- |
| Native binary install | Selects `gentle-ai.exe`, Windows archives, and trusted `System32\\tar.exe` | Installer has an explicit Windows path |
| Repository identity | Uses hard-link no-replace publication and skips unsupported directory fsync on `win32` | Atomic visibility and conflict rejection are designed; no power-loss directory-entry durability claim |
| Graph object store and lock | File publication uses hard links; directory lock movement has a Windows branch; directory fsync is skipped | Fail-closed branches exist, but Linux simulation does not prove NTFS behavior |
| Native diagnostics | Recognizes drive-letter and UNC paths | Windows paths can be normalized and sanitized |
| Candidate views and complete runtime | Uses chmod, symlink, Git worktree, process, and filesystem behavior without an executed Windows acceptance run in this closure | No end-to-end Windows support claim |

The only platform-specific repository test is skipped outside Windows. U8 therefore records Windows as evidence-partial and unverified end to end; it does not close or mutate any Windows issue.

## #191 Outcome

#191 moved typed command targets, configured push destinations, push-ref probes, release projection, release fast-path evaluation, and publication rechecks into `review-publication-gate.ts`. The extension imports that module directly for ordinary native publication. `review-publication-gate.ts` imports no graph transaction, object store, graph schema, lock, or snapshot module.

`review-transaction.ts` imports the shared target primitives only for historical graph receipt validation. Its reducer, replay, object-store, lock, snapshot, and ordinary semantic-replay dependencies remain reachable from explicit graph-v1 Judgment Day, so no additional module deletion is justified.

The next delivery boundary is one branch-wide High-tier 4R, followed by the size-exception PR, merge readiness, and release.

← [Back to README](../README.md)
