# PR #1075 Review Fixes

## Objective

Close the three verified review findings on the per-repository profile pin before PR #1075 is merged.

## Problem

The share guidance does not re-include the declaration when `.pi/` is ignored, missing Git identities are cached indefinitely and can make panel state stale after `git init`, and one pin-scope notification emits a worktree-derived path without terminal sanitization.

## Why

These gaps make the shareable pin workflow misleading, can make the panel disagree with launch-time resolution, and weaken the established terminal-text safety boundary.

## Scope

- Correct the generated Git ignore rules and documentation.
- Preserve positive Git identity caching while allowing a prior miss to recover.
- Sanitize pin-scope notification data.
- Add focused regression coverage, including a real temporary Git repository for ignore behavior.

## Constraints

- Keep the patch minimal and limited to PR #1075 review findings.
- Technical artifacts remain in English.
- Do not commit, push, post, or merge.
- Preserve existing pin precedence and launch behavior.
- Keep unrelated `.pi` content ignored.

## TDD

- Mode: strict TDD enabled.
- Source: `openspec/config.yaml` (`strict_tdd: true`).
- Runner: `pnpm test`; focused RED/GREEN commands use Node's test runner.
- Required cycle: RED -> GREEN -> REFACTOR.

## Tasks

- [x] **T1 — Make repository declarations safely committable.** Replaced the ineffective single negation with ordered parent re-inclusion and child re-ignore rules; UI/docs share one rule set, and a real Git repository proves only the declaration is visible.
- [x] **T2 — Recover from a cached Git identity miss.** Positive identities remain cached, while misses are retried; a real `git init` regression proves the panel can discover an identity that appears later.
- [x] **T3 — Sanitize the pin-scope notification.** The complete note is sanitized before it reaches `ctx.ui.notify`, with an OSC/control-character regression covering the worktree-derived path.
- [x] **T4 — Verify the combined candidate.** Required checks were observed after the final source changes; new regressions pass, typecheck and diff checks pass, while the combined suite retains five documented pre-existing `gentle-agents` failures.

## Acceptance Criteria

- A repository ignoring `.pi/` can add only `.pi/gentle-ai/profile.json` after applying the suggested rules; unrelated `.pi` files remain ignored.
- A missing Git identity is retried and can resolve later without losing safe positive caching.
- Pin-scope notification text contains no raw terminal control characters from worktree-derived values.
- All required verification commands have observed results recorded below.

## Progress

- Tracking created before the first source or test write.
- T1 complete: safe declaration-only Git ignore rules implemented and documented.
- T2 complete: negative Git identity results are no longer cached.
- T3 complete: pin-scope notification text now crosses the terminal boundary sanitized.
- T4 complete: final verification outcomes recorded without hiding base failures.

## Checks

- T1 RED: `node --experimental-strip-types --test tests/profile-pin.test.ts` failed because `REPO_PROFILE_DECLARATION_GITIGNORE_RULES` did not exist.
- T1 GREEN: the same command passed 18/18 tests, including the real-Git ignore regression.
- T2 RED: `node --experimental-strip-types --test tests/profile-pin.test.ts` failed 1/19 because the second lookup still returned `undefined` after `git init`.
- T2 GREEN: the same command passed 19/19 after restricting the cache to successful identities.
- T3 RED: the focused `gentle-ai.test.ts` run failed because `__testing.profilePinScopeNote` was not yet exposed.
- T3 GREEN: the same focused run passed 1/1 after sanitizing the complete note and exposing the pure seam.
- `node --experimental-strip-types --test tests/profile-pin.test.ts tests/gentle-ai.test.ts tests/gentle-agents.test.ts`: rc=1; 162 passed, 5 failed. All 38 profile-pin/gentle-ai pin regressions passed; the five failures are the documented pre-existing `gentle-agents` research/provenance/remediation failures at lines 743, 2072, 2091, 2219, and 2376.
- `pnpm run typecheck`: rc=0; `types: 200 recorded diagnostic(s), no regressions`.
- `git diff --check`: rc=0; no output.

## Next Step

Parent spot-check and delivery steps; this writer must not commit, push, post, or merge.
