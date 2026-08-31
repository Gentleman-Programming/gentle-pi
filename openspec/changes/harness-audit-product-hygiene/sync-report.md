# Sync Report — harness-audit-product-hygiene

## What shipped in the working tree (stacked on feat/harness-audit-test-infra; no push)

**Product fixes:**
- `extensions/skill-registry.ts` — drive-less file: URL dedup fallback + case-insensitive comparison on win32 (real Windows bug fixed; regression test added).
- `lib/review-repository.ts` — `reviewGitEnvironment()` sanitizes agent-harness scoped git config (`GIT_CONFIG_COUNT`/KEY/VALUE) while keeping fail-closed for routing keys; without this, review authority was unusable locally on harness machines.

**Repo hygiene:** `packageManager: pnpm@11.1.1`, `package-lock.json` removed+ignored, `gentle-models-effort/apply.md` → `apply-progress.md`.

**OpenSpec closure:** 8 changes archived with dispositions (5 done, 1 superseded, 2 abandoned) + ARCHIVE-REPORTs; ledger test paths updated.

**README:** version policy fixed; "How it works" mechanism-first section; honesty pass (commands verified).

## Verified state (Windows)

- Suite: **1080 pass / 0 fail / 45 skipped, exit 0** (a suite that began the audit at 1005/211/0).
- Runtime modules match; runtime-harness exit 0.

## Deviations / notes

1. **repo-hygiene AC7 (≤1 active change):** 5 active changes remain beyond this one — `align-sdd-openspec-deltas` is genuinely in-flight (1 task open) and `gentle-models-effort`, `orchestrator-lazy-diet`, `persona-single-channel`, `port-review-ledger-contract` carry complete loops (verify-report) but their post-apply delivery lifecycle (commit/push/PR) was intentionally never performed; archiving them as done without delivery records would misstate their final state. They should be archived at delivery time with real final-state facts.
2. **Attempt-budget accounting:** B's first acquire (350) underestimated the working-tree diff (includes A's slices + 8 OpenSpec archive moves on the same branch). Corrected via maintainer reset + re-acquire; documented in apply-progress T6.
3. No commits/pushes/PRs created (delivery deferred by policy; owner approval required).

## Handoff to delivery

- Two stacked feature branches: `feat/harness-audit-test-infra` (4 slices) and → B slices (to be created). Suggested B slice order: (1) fix(skill-registry)+test, (2) fix(review-repository env)+test, (3) chore(repo hygiene), (4) docs(openspec archive 8 changes + ledger paths), (5) docs(readme mechanism-first), (6) docs(openspec) B artifacts.
- After push, the new `verify-windows` CI job validates the Windows baseline continuously.
- Archive `harness-audit-product-hygiene` at delivery close (self-discipline).