# Apply Progress: align-sdd-openspec-deltas

## Slice 1 — Prompt/docs parity

Status: complete

## Completed Tasks

- [x] 1.1 Read `/Users/alanbuscaglia/work/gentle-ai/internal/assets/skills/_shared/openspec-convention.md` and port relevant path/model rules.
- [x] 1.2 Updated `assets/agents/sdd-spec.md` with `openspec/changes/{change}/specs/{domain}/spec.md` layout.
- [x] 1.3 Updated `assets/agents/sdd-spec.md` with ADDED/MODIFIED/REMOVED sections and copy-full-then-edit MODIFIED workflow.
- [x] 1.4 Updated `assets/agents/sdd-spec.md` to state Engram mode has no canonical merge layer.
- [x] 1.5 Updated `assets/agents/sdd-archive.md` with file-backed sync/archive semantics, CRITICAL blocker, destructive merge approval, and mode-specific archive reporting.
- [x] 1.6 Updated README with canonical vs change spec model and mode boundaries.

## Slice 2 — Native delta helpers

Status: complete

## Completed Tasks

- [x] 2.1 RED: added tests for parsing canonical requirement blocks.
- [x] 2.2 RED: added tests for parsing ADDED/MODIFIED/REMOVED delta sections.
- [x] 2.3 GREEN: implemented minimal markdown parser in `lib/openspec-deltas.ts`.
- [x] 2.4 RED: added tests for applying ADDED while preserving existing requirements.
- [x] 2.5 RED: added tests for applying MODIFIED by full matching requirement block replacement.
- [x] 2.6 RED: added tests for applying REMOVED by deleting the matching requirement block.
- [x] 2.7 GREEN: implemented `applyDeltaSpec`.
- [x] 2.8 TRIANGULATE: added failure tests for missing MODIFIED/REMOVED targets and duplicate/conflicting operations.

## Slice 3 — Guardrails and asset freshness

Status: complete

## Completed Tasks

- [x] 3.1 RED/GREEN: added fixture test and helper for detecting another active change touching the same `specs/{domain}/spec.md`.
- [x] 3.2 Added `detectActiveDomainCollisions` helper for archive/preflight guardrails.
- [x] 3.3 Added `detectLegacyFlatSpec` helper and tests for legacy flat `openspec/changes/{change}/spec.md`.
- [x] 3.4 Added `analyzeDeltaDestructiveness` helper and test for REMOVED requirements and large MODIFIED blocks.
- [x] 3.5 Added explicit `sdd-sync` phase and updated chains accordingly.
- [x] 4.1 RED: added runtime-harness test showing stale `.pi` SDD assets are surfaced by `/gentle-ai:status`.
- [x] 4.2 GREEN: implemented non-destructive asset drift detection in `/gentle-ai:status`.
- [x] 4.3 Confirmed README already documents `/gentle-ai:install-sdd --force` as explicit refresh path.

## sdd-sync addition

Status: complete pending fresh review

## Completed Tasks

- [x] Added `assets/agents/sdd-sync.md`.
- [x] Added `sdd-sync` to SDD agent ordering/model routing.
- [x] Updated `sdd-full` and `sdd-verify` chains to run `sdd-sync` between verify and archive.
- [x] Updated `sdd-archive` so archive requires completed sync or explicit archive-time sync fallback.
- [x] Updated README flow and artifact model wording.
- [x] Updated runtime harness to assert `sdd-sync.md` is installed during SDD preflight and `/sdd-init`.

## Files Changed

- `assets/agents/sdd-spec.md`
- `assets/agents/sdd-archive.md`
- `assets/agents/sdd-sync.md`
- `assets/chains/sdd-full.chain.md`
- `assets/chains/sdd-verify.chain.md`
- `README.md`
- `extensions/gentle-ai.ts`
- `lib/openspec-deltas.ts`
- `lib/openspec-guardrails.ts`
- `tests/openspec-deltas.test.ts`
- `tests/openspec-guardrails.test.ts`
- `tests/runtime-harness.mjs`
- `openspec/changes/align-sdd-openspec-deltas/tasks.md`
- `openspec/changes/align-sdd-openspec-deltas/sync-report.md`

## TDD Cycle Evidence

| Cycle                   | RED                                                                                           | GREEN                                                                                      | TRIANGULATE / REFACTOR                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Slice 2 native helpers  | `pnpm test` failed because `../lib/openspec-deltas.ts` did not exist.                         | Added `lib/openspec-deltas.ts`; `pnpm test` passed.                                        | Added failure tests for missing MODIFIED/REMOVED targets and duplicate/conflicting operations; LSP diagnostics clean. |
| Slice 2 review fixes    | Regression tests failed for ADDED before post-Requirements sections and duplicate separators. | Fixed append spacing and cleaned trailing separators; `pnpm test` passed.                  | Added explicit REMOVED missing-target coverage.                                                                       |
| Slice 3 guardrails      | `pnpm test` failed because `../lib/openspec-guardrails.ts` did not exist.                     | Added guardrail helpers; `pnpm test` passed.                                               | Added collision, legacy flat spec, and destructive delta tests.                                                       |
| Slice 3 asset freshness | Runtime harness failed because `/gentle-ai:status` did not report stale SDD assets.           | Added status drift detection and warning; `pnpm test` passed.                              | Drift detection is non-destructive and points to `/gentle-ai:install-sdd --force`.                                    |
| sdd-sync phase          | Runtime harness would not assert the new phase until added.                                   | Added `sdd-sync` asset, chains, routing, docs, and install assertions; `pnpm test` passed. | Archive now prefers explicit sync and allows archive-time sync only with parent approval.                             |

## Validation

| Command                                                                                                | Result | Notes                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                            | PASS   | Node tests and runtime harness passed.                                                                              |
| LSP diagnostics on `assets/agents/sdd-sync.md`, `tests/runtime-harness.mjs`, `extensions/gentle-ai.ts` | PASS   | No diagnostics for new asset/test; one pre-existing TypeScript hint remains elsewhere in `extensions/gentle-ai.ts`. |

## Remaining Tasks

- Optional migration of `gentle-models-effort` legacy flat spec.
- Optional `RENAMED` delta support later if needed.
- Fresh review of explicit `sdd-sync` addition.
