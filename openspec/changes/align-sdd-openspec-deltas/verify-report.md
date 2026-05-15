# Verify Report: align-sdd-openspec-deltas — Slices 1-3 + sdd-sync

## Status

PASS locally for Slices 1-3 and explicit `sdd-sync` phase addition. Fresh reviews have no unresolved blockers.

## Scope Verified

### Slice 1

- `assets/agents/sdd-spec.md` encodes the OpenSpec-compatible file layout, delta sections, MODIFIED full-block workflow, collision/legacy warnings, and Engram-only boundary.
- `assets/agents/sdd-archive.md` encodes file-backed archive semantics, explicit destructive merge approval, mode-specific archive reporting, and Engram-only boundary.
- `README.md` documents OpenSpec-compatible behavior as part of `gentle-pi`, with no external OpenSpec install requirement.

### Slice 2

- `lib/openspec-deltas.ts` provides native helpers for parsing and applying ADDED/MODIFIED/REMOVED deltas.
- `tests/openspec-deltas.test.ts` covers happy paths and failure/regression paths for native helpers.

### Slice 3

- `lib/openspec-guardrails.ts` provides native helpers for:
  - detecting active same-domain change collisions;
  - detecting legacy flat `openspec/changes/{change}/spec.md` artifacts;
  - analyzing destructive deltas via REMOVED requirements and large MODIFIED blocks.
- `tests/openspec-guardrails.test.ts` covers those guardrails.
- `/gentle-ai:status` reports stale installed `.pi` SDD assets and points to `/gentle-ai:install-sdd --force`.
- `tests/runtime-harness.mjs` covers non-destructive asset drift reporting.

### Explicit sdd-sync phase

- `assets/agents/sdd-sync.md` defines sync-without-archive semantics.
- `assets/chains/sdd-full.chain.md` and `assets/chains/sdd-verify.chain.md` run `sdd-sync` between `sdd-verify` and `sdd-archive`.
- `assets/agents/sdd-archive.md` now requires completed sync for file-backed modes or explicitly approved archive-time sync fallback.
- `extensions/gentle-ai.ts` includes `sdd-sync` in SDD agent ordering/model routing.
- Runtime harness asserts `sdd-sync.md` is installed by lazy SDD preflight and `/sdd-init`.

## Spec Coverage

| Requirement                               | Status                                         | Evidence                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| File-backed canonical spec store          | Covered for prompts/docs                       | README and agent prompts describe `openspec/specs/{domain}/spec.md` as source of truth.                                          |
| Change specs use domain subdirectories    | Covered                                        | `sdd-spec` requires `openspec/changes/{change}/specs/{domain}/spec.md`.                                                          |
| Delta requirements update canonical specs | Covered by native helpers and sync prompt      | `applyDeltaSpec` applies ADDED/MODIFIED/REMOVED; `sdd-sync` owns file-backed canonical sync.                                     |
| Modified requirements preserve scenarios  | Covered by prompt contract and helper behavior | `sdd-spec` requires full-block MODIFIED; `applyDeltaSpec` replaces the full canonical block.                                     |
| Cross-change collision warning            | Covered by helper/test                         | `detectActiveDomainCollisions` detects other active changes touching the same domain spec.                                       |
| Destructive merge guard                   | Covered by prompt contract and helper/test     | `sdd-sync` and `sdd-archive` require explicit approval; `analyzeDeltaDestructiveness` reports REMOVED and large MODIFIED blocks. |
| Installed SDD asset freshness visible     | Covered by status/runtime test                 | `/gentle-ai:status` reports stale `.pi` SDD assets and explicit force-refresh command.                                           |
| Legacy flat specs detected                | Covered by helper/test                         | `detectLegacyFlatSpec` reports flat `spec.md` and whether domain specs also exist.                                               |
| Sync-without-archive                      | Covered by prompt/chain/runtime install checks | `sdd-sync` exists as a phase and chains call it before archive.                                                                  |

## Validation Commands

```text
pnpm test
```

Result: PASS, 20 node tests plus runtime harness.

```text
lsp_diagnostics assets/agents/sdd-sync.md
lsp_diagnostics lib/openspec-deltas.ts
lsp_diagnostics lib/openspec-guardrails.ts
lsp_diagnostics tests/openspec-deltas.test.ts
lsp_diagnostics tests/openspec-guardrails.test.ts
lsp_diagnostics tests/runtime-harness.mjs
```

Result: PASS for new files and tests. `extensions/gentle-ai.ts` has one pre-existing TypeScript hint unrelated to this change.

## Review Findings Addressed

Fresh Slice 2 reviewer found:

- BLOCKER: ADDED requirements could join directly to a following `##` section. Fixed with regression coverage and append spacing.
- NOTE: Multiple ADDED requirements could duplicate separators. Fixed by cleaning trailing separators from parsed requirement blocks.
- NOTE: Missing REMOVED target was claimed but untested. Fixed with explicit test.
- NOTE: SDD state/report artifacts were stale. Updated.

Fresh Slice 3 reviewer found no blockers. Notes addressed:

- Hardened `/gentle-ai:status` drift detection so unreadable or directory-shaped installed asset paths are counted as stale instead of throwing.
- Updated `tasks.md` acceptance checklist and verification evidence to match completed work.

Fresh `sdd-sync` reviewer found blockers. Addressed:

- `sdd-sync` now blocks if `verify-report.md` is missing, not clearly passing, or contains unresolved `FAIL`, `BLOCKED`, `CRITICAL`, or verification blockers.
- `sdd-archive` now blocks on missing/non-passing verify reports, not only `CRITICAL` issues.
- Status drift detection now counts missing packaged SDD assets as stale, so partial installs missing new `sdd-sync.md` are visible.

## Risks / Follow-ups

- Native helpers currently support `ADDED`, `MODIFIED`, and `REMOVED`; `RENAMED` is not implemented.
- Helpers are not yet wired into an automatic archive command; they provide tested behavior and guardrails for phase agents/future integration.
- Existing legacy flat specs remain unmigrated.

## Next Recommended

Stop here for a focused PR, or run `pnpm run prepack` if package verification is desired.
