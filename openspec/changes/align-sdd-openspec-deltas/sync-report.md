# Sync Report: align-sdd-openspec-deltas

## Status

Not archived yet. This active change intentionally keeps its delta under `openspec/changes/align-sdd-openspec-deltas/specs/sdd-openspec/spec.md` until release review is complete.

No canonical `openspec/specs/sdd-openspec/spec.md` existed before this change, so there was no existing canonical block to mutate during this session. The new `sdd-sync` phase and delta helpers define the supported file-backed sync semantics for future SDD changes.

## What Changed

- Added `assets/agents/sdd-sync.md` as a first-class SDD executor.
- Added `sdd-sync` to SDD agent ordering in `extensions/gentle-ai.ts`.
- Updated `assets/chains/sdd-full.chain.md` and `assets/chains/sdd-verify.chain.md` to run `sdd-sync` between `sdd-verify` and `sdd-archive`.
- Updated `assets/agents/sdd-archive.md` so archive requires completed sync or explicitly approved archive-time sync fallback.
- Updated `assets/agents/sdd-sync.md` and `assets/agents/sdd-archive.md` to block on missing or non-passing verification evidence.
- Updated README diagrams and artifact model docs for `verify → sync → archive`.
- Updated `/gentle-ai:status` drift detection so missing packaged SDD assets count as stale.
- Updated runtime harness assertions so lazy SDD preflight and `/sdd-init` install `sdd-sync.md`.
- Updated package verification to require core SDD agents, chains, strict-TDD support files, and `sdd-sync`.

## Validation

```text
pnpm test
pnpm run prepack
npm pack --dry-run
```

Results:

- `pnpm test`: PASS, 20 node tests plus runtime harness.
- `pnpm run prepack`: PASS, including package resource verification.
- `npm pack --dry-run`: PASS, tarball includes `assets/agents/sdd-sync.md`, updated chains, `lib/openspec-*`, and new OpenSpec tests.
- Fresh release-readiness review: PASS after noting that intended untracked files must be staged/committed before GitHub tagging.

## Risks

- Existing installed `.pi` assets remain stale until the user intentionally refreshes with `/gentle-ai:install-sdd --force`.
- Helper functions support `ADDED`, `MODIFIED`, and `REMOVED`; `RENAMED` is intentionally not implemented yet.
- This change adds native helper/prompt semantics; a fully automatic sync/archive command path remains a follow-up.

## Next Recommended

Stage and commit intended release files, tag `v0.3.4`, publish to npm, push to GitHub, and create the GitHub release.
