# Spec — Repository and OpenSpec hygiene

## Context

pnpm is the package manager (pnpm-lock.yaml tracked, pnpm-workspace.yaml, pnpm 11.1.1 in CI) but `package.json` has no `packageManager` field and an npm-generated `package-lock.json` sits untracked in the working tree; npm-built `node_modules` makes ~104 tests fail with `ERR_MODULE_NOT_FOUND`. OpenSpec has 13 active changes, 6 with `apply-progress.md` + `tasks.md` but no verify/sync/archive, 2 proposal-only, and `gentle-models-effort` uses a nonstandard `apply.md`.

## Acceptance criteria

- AC1: `package.json` declares `"packageManager": "pnpm@11.1.1"` (matching CI's pinned version).
- AC2: The npm-generated `package-lock.json` is removed from the working tree and `package-lock.json` is added to `.gitignore` so npm artifacts cannot reappear untracked; `pnpm-lock.yaml` remains the single lockfile.
- AC3: `gentle-models-effort/apply.md` is renamed to `apply-progress.md` (convention) with content unchanged.
- AC4: Each of the 6 orphaned apply-ed changes (bounded-review-graph-parity, complete-native-review-lifecycle, harden-review-contracts, native-review-authority-parity, organic-rdd-parity, worktree-aware-review-authority) is verified for actual task completion before archiving: its tasks are done or explicitly superseded, no `- [ ]` remains that the code contradicts, and the repo's `pnpm test` evidence supports closure.
- AC5: Verified/done changes are archived using the repository convention (`openspec/changes/archive/<date>-<name>/` + `ARCHIVE-REPORT.md`), including the ensure-archive-for-this-change discipline applied to this change at close.
- AC6: Proposal-only changes (`cross-repo-bundle-trust`, `review-contract-cleanup`) are either archived as abandoned (documented reason in ARCHIVE-REPORT) or left active only if genuinely in-flight; the final state is explicit in the archive report.
- AC7: `gentle-ai sdd-status` no longer reports more than one active change after apply completes (this change itself is the only active one, or the choice is documented).

## Non-constraints

- Archiving is a file move + report inside the repo; no git history rewrite.
- Do not delete spec content of archived changes; the archive dir preserves them for audit.