# Tasks: Sync Skill Collision Prefixes

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~130-150 (6 one-line frontmatter edits, ~12 reference-line edits, ~80-line new test file) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | exception-ok |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | RED test + 6 frontmatter renames + reference sync + verification | PR 1 | Single PR; comfortably under 400-line budget, no split needed |

## Coordination Note

`skills/judgment-day/SKILL.md` line 2 (frontmatter `name:`) is the ONLY line this
change touches in that file. The body is owned by the parallel change
`port-review-ledger-contract`. This change applies FIRST in the merge sequence;
coordinate to avoid a rebase conflict on `skills/judgment-day/SKILL.md`.

## Phase 1: RED — Regression Test (Infrastructure)

- [x] 1.1 Create `tests/skill-collision-prefixes.test.ts`; import `__testing.parseFrontmatter` from `../extensions/skill-registry.ts` (pattern: `tests/skill-registry.test.ts:7`)
- [x] 1.2 Build a `Record<dir, expectedName>` map for the 6 collision dirs → `gentle-ai-branch-pr`, `gentle-ai-chained-pr`, `gentle-ai-issue-creation`, `gentle-ai-judgment-day`, `gentle-ai-skill-creator`, `gentle-ai-skill-improver`
- [x] 1.3 Assert each `skills/<dir>/SKILL.md` frontmatter `name` equals its expected prefixed value
- [x] 1.4 Add guard assertions: `skill-registry`, `release`, `work-unit-commits`, `gentle-ai`, `comment-writer`, `cognitive-doc-design` frontmatter `name` carries NO `gentle-ai-` prefix
- [x] 1.5 Run `pnpm test`; confirm the new test FAILS RED against current unprefixed frontmatter

## Phase 2: GREEN — Frontmatter Rename

- [x] 2.1 `skills/branch-pr/SKILL.md:2` — `name: branch-pr` → `name: gentle-ai-branch-pr`
- [x] 2.2 `skills/chained-pr/SKILL.md:2` — `name: chained-pr` → `name: gentle-ai-chained-pr`
- [x] 2.3 `skills/issue-creation/SKILL.md:2` — `name: issue-creation` → `name: gentle-ai-issue-creation`
- [x] 2.4 `skills/judgment-day/SKILL.md:2` — `name: judgment-day` → `name: gentle-ai-judgment-day` (line 2 ONLY; do not touch body — see Coordination Note)
- [x] 2.5 `skills/skill-creator/SKILL.md:2` — `name: skill-creator` → `name: gentle-ai-skill-creator` (do NOT touch line 62 body template `name: {skill-name}`)
- [x] 2.6 `skills/skill-improver/SKILL.md:2` — `name: skill-improver` → `name: gentle-ai-skill-improver`

## Phase 3: GREEN — In-Repo Reference Sync

- [x] 3.1 `assets/orchestrator.md:286` — `` `branch-pr` `` → `` `gentle-ai-branch-pr` ``
- [x] 3.2 `assets/orchestrator.md:287` — `` `chained-pr` `` → `` `gentle-ai-chained-pr` `` (leave `:308` untouched — owned by `port-review-ledger-contract`)
- [x] 3.3 `README.md:58,314,316,416,433,434,436,439,440,441` — update the 6 collision names to prefixed form; leave `cognitive-doc-design`, `comment-writer`, and the `/skill-creation` prompt name unchanged
- [x] 3.4 `prompts/skill-creation.md:7` — name `` `skill-creator` `` → `` `gentle-ai-skill-creator` `` ONLY; keep path `` `skills/skill-creator/SKILL.md` `` unchanged
- [x] 3.5 `skills/skill-improver/SKILL.md:12` — cross-ref `` `skill-creator` `` → `` `gentle-ai-skill-creator` ``

## Phase 4: Verification

- [x] 4.1 Run `pnpm test`; confirm `tests/skill-collision-prefixes.test.ts` (all 6 prefixed assertions + 6 guard assertions) passes GREEN
- [x] 4.2 Grep repo for the 6 original unprefixed names outside directory paths; confirm no dangling reference remains except the documented out-of-scope files: `scripts/verify-package-files.mjs:38-47`, `lib/review-triggers.ts:69,157`, `tests/review-triggers.test.ts:154,211`, `assets/orchestrator.md:308`
- [x] 4.3 Run full `pnpm test` suite; confirm no regressions elsewhere
