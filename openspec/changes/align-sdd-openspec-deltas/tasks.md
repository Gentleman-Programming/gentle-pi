# Tasks: align-sdd-openspec-deltas

## Review Workload Forecast

| Field                   | Value                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | 350-650 depending on native helper scope and tests                                                                |
| 400-line budget risk    | Medium                                                                                                            |
| Chained PRs recommended | Yes if native parser/archive helpers and asset migration are done together; No if split into prompt/docs first    |
| Suggested split         | PR 1: prompt/docs/spec convention → PR 2: native delta helper tests → PR 3: asset drift/status + legacy migration |
| Delivery strategy       | ask-on-risk                                                                                                       |
| Chain strategy          | pending                                                                                                           |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

## Implementation Tasks

### 1. Prompt and convention parity with `gentle-ai`

- [x] 1.1 Read `/Users/alanbuscaglia/work/gentle-ai/internal/assets/skills/_shared/openspec-convention.md` and port the relevant path/model rules into `gentle-pi` docs or SDD assets.
- [x] 1.2 Update `assets/agents/sdd-spec.md` with domain subdirectory layout: `openspec/changes/{change}/specs/{domain}/spec.md`.
- [x] 1.3 Update `assets/agents/sdd-spec.md` with ADDED/MODIFIED/REMOVED sections and the copy-full-then-edit workflow for MODIFIED requirements.
- [x] 1.4 Update `assets/agents/sdd-spec.md` to state Engram mode has no canonical merge layer and must not create `sdd/canonical/*` topics.
- [x] 1.5 Update `assets/agents/sdd-archive.md` with file-backed merge semantics, dated archive move, CRITICAL verify blocker, destructive merge warning, and Engram observation-ID archive behavior.
- [x] 1.6 Update README SDD/OpenSpec section with canonical vs change spec model and mode boundaries.

### 2. Native delta validation/apply helpers

- [x] 2.1 RED: add tests for parsing requirement blocks from canonical specs.
- [x] 2.2 RED: add tests for parsing ADDED/MODIFIED/REMOVED delta sections.
- [x] 2.3 GREEN: implement minimal markdown parser in `lib/openspec-deltas.ts` scoped to OpenSpec heading conventions.
- [x] 2.4 RED: add tests for applying ADDED to canonical specs while preserving existing requirements.
- [x] 2.5 RED: add tests for applying MODIFIED by replacing the full matching requirement block.
- [x] 2.6 RED: add tests for applying REMOVED by deleting the matching requirement block.
- [x] 2.7 GREEN: implement `applyDeltaSpec` behavior.
- [x] 2.8 TRIANGULATE: add failure tests for missing MODIFIED/REMOVED targets and duplicate/conflicting operations.

### 3. Archive and collision guardrails

- [x] 3.1 Add fixture/test for detecting another active change touching the same `specs/{domain}/spec.md`.
- [x] 3.2 Add helper or prompt rule that warns on active same-domain collisions before archive.
- [x] 3.3 Add test/guard for legacy flat `openspec/changes/{change}/spec.md` so archive does not silently skip it.
- [x] 3.4 Add destructive merge warning test for broad REMOVED sections or large MODIFIED replacement blocks.
- [x] 3.5 Add explicit `sdd-sync` phase and update chains accordingly.
  - Decision update: add `sdd-sync` as a first-class phase for sync-without-archive; keep archive-time sync only as an explicitly approved fallback.

### 4. Installed asset freshness

- [x] 4.1 RED: add runtime-harness test showing `.pi/agents/sdd-spec.md` drift from `assets/agents/sdd-spec.md` is surfaced by `/gentle-ai:status` or preflight.
- [x] 4.2 GREEN: implement non-destructive drift detection.
- [x] 4.3 Document `/gentle-ai:install-sdd --force` as the explicit refresh path.

### 5. Example migration and verification

- [ ] 5.1 Migrate or mark `openspec/changes/gentle-models-effort/spec.md` as legacy.
- [x] 5.2 Add a current fixture/example under `openspec/changes/*/specs/{domain}/spec.md` if this change is not used as the example.
- [x] 5.3 Run `pnpm test` and record RED/GREEN/TRIANGULATE evidence.
- [x] 5.4 Run `pnpm run prepack` if tests pass and package verification is needed.

## Acceptance Checklist

- [x] File-backed SDD specs use `openspec/specs/` as canonical and `openspec/changes/{change}/specs/` as deltas.
- [x] Engram-only mode is explicitly documented as working memory with no canonical merge.
- [x] MODIFIED requirements preserve scenarios by copying full blocks before editing.
- [x] Archive/sync behavior is tested or covered by native helpers, not only prose.
- [x] Cross-change same-domain collisions are warned.
- [x] Legacy flat specs are detected instead of silently skipped.
- [x] Stale installed `.pi` assets are visible to the user.
- [x] Package verification includes the new `sdd-sync` asset and core SDD chains/agents.
