# Apply Progress: Sync Skill Collision Prefixes

**Mode**: Strict TDD
**Status**: 19/19 tasks complete. Ready for verify.

## Completed Tasks

### Phase 1: RED — Regression Test (Infrastructure)
- [x] 1.1 Created `tests/skill-collision-prefixes.test.ts`, importing `__testing.parseFrontmatter` from `extensions/skill-registry.ts` (matches `tests/skill-registry.test.ts:7` pattern).
- [x] 1.2 Built `PREFIXED_NAMES: Record<dir, expectedName>` for the 6 collision dirs.
- [x] 1.3 Asserted each `skills/<dir>/SKILL.md` frontmatter `name` equals its expected prefixed value.
- [x] 1.4 Added guard assertions for `skill-registry`, `release`, `work-unit-commits`, `gentle-ai`, `comment-writer`, `cognitive-doc-design` (no `gentle-ai-` prefix).
- [x] 1.5 Ran `pnpm test` (scoped file) — confirmed RED: 12 tests, 6 pass (guards), 6 fail (prefixed-name assertions against unprefixed current state).

### Phase 2: GREEN — Frontmatter Rename
- [x] 2.1 `skills/branch-pr/SKILL.md:2` → `name: gentle-ai-branch-pr`
- [x] 2.2 `skills/chained-pr/SKILL.md:2` → `name: gentle-ai-chained-pr`
- [x] 2.3 `skills/issue-creation/SKILL.md:2` → `name: gentle-ai-issue-creation`
- [x] 2.4 `skills/judgment-day/SKILL.md:2` → `name: gentle-ai-judgment-day` (line 2 ONLY — body untouched, owned by `port-review-ledger-contract`)
- [x] 2.5 `skills/skill-creator/SKILL.md:2` → `name: gentle-ai-skill-creator` (line 62 body template `name: {skill-name}` verified untouched)
- [x] 2.6 `skills/skill-improver/SKILL.md:2` → `name: gentle-ai-skill-improver`
- Verified GREEN: 12/12 tests pass after renames.

### Phase 3: GREEN — In-Repo Reference Sync
- [x] 3.1 `assets/orchestrator.md:286` — `branch-pr` → `gentle-ai-branch-pr`
- [x] 3.2 `assets/orchestrator.md:287` — `chained-pr` → `gentle-ai-chained-pr` (line 308 `judgment-day` trigger-identifier prose left untouched, verified)
- [x] 3.3 `README.md:58,314,316,416,433,434,436,439,440,441` — updated the 6 collision names to prefixed form; `cognitive-doc-design`, `comment-writer`, `work-unit-commits`, and the `/skill-creation` prompt name left unchanged
- [x] 3.4 `prompts/skill-creation.md:7` — `skill-creator` → `gentle-ai-skill-creator` (name only; path `skills/skill-creator/SKILL.md` unchanged)
- [x] 3.5 `skills/skill-improver/SKILL.md:12` — cross-ref `skill-creator` → `gentle-ai-skill-creator`

### Phase 4: Verification
- [x] 4.1 `pnpm test` on `tests/skill-collision-prefixes.test.ts`: 12/12 pass.
- [x] 4.2 Repo-wide grep for the 6 original unprefixed names (excluding `skills/**` directory paths, `.codegraph/`, `.engram/`, `openspec/changes/**` planning prose, and `pnpm-lock.yaml`). Remaining matches are: the test file's `Record` map keys (source dir names, intentional), already-prefixed strings containing the bare token as substring, and the documented out-of-scope files (`scripts/verify-package-files.mjs`, `lib/review-triggers.ts`, `tests/review-triggers.test.ts`, `assets/orchestrator.md:308`). No dangling unprefixed references found.
- [x] 4.3 Full `pnpm test` suite (`node --experimental-strip-types --test tests/*.test.ts && pnpm run test:harness`): 216/216 pass, 0 fail, exit code 0. No regressions.

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `tests/skill-collision-prefixes.test.ts` | Created | 43 |
| `skills/branch-pr/SKILL.md` | Modified | 1 (line 2) |
| `skills/chained-pr/SKILL.md` | Modified | 1 (line 2) |
| `skills/issue-creation/SKILL.md` | Modified | 1 (line 2) |
| `skills/judgment-day/SKILL.md` | Modified | 1 (line 2 ONLY) |
| `skills/skill-creator/SKILL.md` | Modified | 1 (line 2 ONLY; line 62 template untouched) |
| `skills/skill-improver/SKILL.md` | Modified | 2 (lines 2, 12) |
| `assets/orchestrator.md` | Modified | 2 (lines 286-287; line 308 untouched) |
| `README.md` | Modified | 4 edits covering lines 58, 314, 316, 416, 433, 434, 436, 439, 440, 441 |
| `prompts/skill-creation.md` | Modified | 1 (line 7) |
| `openspec/changes/sync-skill-collision-prefixes/tasks.md` | Modified | 19 checkboxes ticked |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1-1.5 (RED) | `tests/skill-collision-prefixes.test.ts` | Unit | N/A (new file) | ✅ Written — 6 prefixed-name assertions failed against unprefixed frontmatter | N/A (RED phase) | N/A | N/A |
| 2.1-2.6 (GREEN) | `tests/skill-collision-prefixes.test.ts` | Unit | ✅ 12/12 baseline (guards) | ✅ (from Phase 1) | ✅ 12/12 passed after 6 renames | ✅ 6 collision dirs × 1 assertion each + 6 guard dirs (12 total cases covering both prefixed and unprefixed scenarios) | ➖ None needed — mechanical one-line edits |
| 3.1-3.5 (Reference sync) | N/A (docs/prose, no test coverage by design) | N/A | N/A | N/A | N/A | N/A | ➖ None needed |

### Test Summary
- **Total tests written**: 12 (6 prefixed-name assertions + 6 guard assertions)
- **Total tests passing**: 12/12 (scoped file), 216/216 (full suite)
- **Layers used**: Unit (12)
- **Approval tests** (refactoring): None — no refactoring tasks, only additive test + mechanical renames
- **Pure functions created**: 0 (reused existing `parseFrontmatter`/`readSkillName` helper is a thin file-read wrapper, not new production logic)

## Deviations from Design
None — implementation matches design.md exactly (byte-exact prefixed names verified against `~/.pi/agent/npm/node_modules/gentle-pi/skills/*/SKILL.md` before editing).

## Issues Found
None.

## Coordination Note (carried from tasks.md)
`skills/judgment-day/SKILL.md` line 2 (frontmatter `name:`) was the ONLY line touched in that file. Body is owned by the parallel change `port-review-ledger-contract`. This change should merge first to avoid rebase conflicts on that file.

## Workload / PR Boundary
- Mode: single PR
- Current work unit: Unit 1 — RED test + 6 frontmatter renames + reference sync + verification
- Boundary: entire change is one deliverable scope (all 19 tasks)
- Estimated review budget impact: ~130-150 changed lines, well under the 400-line budget (Low risk per tasks.md forecast)

## Status
19/19 tasks complete. Ready for verify.
