# Exploration — worktree-aware-review-authority

## Decision summary

Issue #118 is a controller routing problem, not proof that compact candidate identity needs a worktree-directory field. The live candidate must be derived from the requested `cwd` before controller INSPECT/status routing selects repository-wide terminal authority. If that live binding is identical to the terminal receipt binding—repository identity, base/candidate trees, changed paths, intended-untracked paths, and policy—reuse/validate the existing terminal receipt even when the request comes through another linked-worktree directory. A materially different binding must not reuse it and must receive a fresh lineage.

## Verified current behavior and seam

- `extensions/gentle-ai.ts:executeReviewControllerOperation` handles `INSPECT` and `START`.
- `INSPECT` calls `inspectReviewAuthorityForController(defaultCwd)`, which calls `inspectLegacyReviewAuthorityV1(defaultCwd)` and `inspectCompactReviewAuthorityV2(defaultCwd)` before any live candidate snapshot is derived. It reports repository-wide compact authority as `terminal` when any shared terminal lineage is present.
- `START` repeats that same inspection and returns `status: "blocked"` before reaching `startCompactReview` whenever inspection is not clean.
- The dead-end is therefore before compact START's candidate comparison: controller INSPECT/status routing selects common-directory authority first, so a terminal in one linked worktree blocks the requested worktree before its live binding can be compared.
- `lib/review-facade.ts:startCompactReview` already captures `captureReviewSnapshot({ cwd: input.cwd, ... })` and its terminal scan compares base tree, initial review tree, genesis paths, and intended-untracked paths. It does not currently compare the complete requested candidate binding, but the confirmed follow-up is that compact START already has the material-difference mechanism; controller routing is the first seam to correct. Do not invent a new worktree identity field without source evidence from the complete binding/receipt contract.
- `lib/review-facade.ts:discoverCompactReview` and `lib/review-compact-store.ts` resolve the shared Git common-directory authority. This must remain shared so existing receipts remain readable and gate-validatable.
- `extensions/gentle-ai.ts:durableResetRecoveryRequest` reads `<authority.store_root>/control/reset-state.json` directly. `inspectReviewAuthorityForController` invokes it when legacy inspection returns `reset-in-progress`; absent state currently leaks an untyped filesystem error. `RECOVER` invokes the same helper before `destructiveResetReviewAuthorityV1(..., resume: true)`.

## Smallest correct scope

1. Change controller INSPECT/status routing so it derives the requested `cwd`'s live candidate binding before classifying a shared terminal as applicable. Preserve repository-wide authority inspection for ambiguity, legacy, reset, and recovery safety.
2. Reuse/validate the existing terminal receipt only when the re-derived binding is identical across repository identity, candidate/base trees, changed paths, intended-untracked, and policy. Directory/worktree path alone is neither a required discriminator nor a reason to create a new lineage.
3. Route a materially different candidate to compact START's existing fresh-lineage path. Do not rewrite, migrate, delete, or fork existing terminal receipts.
4. Preserve typed fail-closed RECOVER behavior for absent `control/reset-state.json`: introduce/use the existing controller error/outcome convention rather than guessing reset authorization or mutating authority.

## Exact existing symbols and likely tests

- Controller seam: `executeReviewControllerOperation`, `inspectReviewAuthorityForController`, `durableResetRecoveryRequest` in `extensions/gentle-ai.ts`.
- START/routing: `startCompactReview`, `discoverCompactReview`, `CompactReviewStartBlockedError` in `lib/review-facade.ts`.
- Candidate capture: `captureReviewSnapshot`, `SnapshotV1`, `discoverReviewUntrackedPaths` in `lib/review-snapshot.ts`.
- Shared authority/receipt preservation: `discoverCompactReviewStores`, `CompactReviewStoreV2.loadTerminalReceipt`, `inspectCompactReviewAuthorityV2` in `lib/review-compact-store.ts`.
- Existing controller coverage: `tests/review-controller.test.ts` (INSPECT/START/RECOVER and reset-state fixtures, especially the reset/recovery cases around lines 858–1017).
- Existing candidate/worktree coverage: `tests/review-snapshot.test.ts`, `tests/review-repository.test.ts` (linked worktrees resolve one common-directory authority), and `tests/review-facade.test.ts` if present in the branch.

Required regressions: identical live binding from another linked-worktree cwd reuses/validates the terminal receipt; materially different candidate gets a fresh lineage; same-candidate terminal remains blocked/idempotent; original receipt remains intact and gate-validatable; absent reset state yields a stable typed fail-closed RECOVER result with no mutation.

## Compatibility behavior

| Requested live candidate | Existing shared terminal | Expected behavior |
|---|---|---|
| Identical repository/base/candidate/paths/untracked/policy | Same binding | Reuse/validate existing terminal receipt, regardless of worktree directory. |
| Any material binding difference | Different binding | Do not select the terminal; allow fresh compact lineage routing. |
| Explicit existing lineage | Same lineage | Preserve current explicit-lineage idempotency/blocking and receipt immutability. |
| Existing graph-v1, legacy, ambiguous, or reset authority | Any candidate | Preserve fail-closed compatibility and recovery rules. |

## Non-goals

- No worktree-directory identity field unless implementation evidence proves the existing candidate/receipt binding cannot express the required distinction.
- No changes to common-directory authority layout, receipt schema, terminal receipt validation, graph-v1 compatibility, supersession, or migration semantics.
- No production implementation in exploration.
- No weakening of reset authorization, no inferred reset journal, and no destructive fallback when `reset-state.json` is absent.

## Tooling and validation

CodeGraph was checked first but no callable CodeGraph MCP/CLI was available; targeted reads/grep were used after that fallback. Downstream work remains strict TDD with `pnpm test`.
