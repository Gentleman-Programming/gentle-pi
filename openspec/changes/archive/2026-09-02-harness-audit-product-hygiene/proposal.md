# Proposal — harness-audit-product-hygiene (Change B)

## Problem statement (B scope)

Companion change to `harness-audit-test-infra` (A, test infrastructure). B covers the remaining audit findings that touch product code and repository state:

1. **Real product bug** — `extensions/skill-registry.ts` `shouldSkipDuplicateExtensionLoad` dedups the installed copy incorrectly on Windows: `fileURLToPath` throws on drive-less `file:///home/...` URLs (`ERR_INVALID_FILE_URL_PATH`), the `catch` returns `undefined`, and the installed copy registers as new.
2. **Repo/bootstrap hygiene** — no `packageManager` field; npm-generated untracked `package-lock.json` in a pnpm repo (npm-built `node_modules` makes ~104 tests fail with `ERR_MODULE_NOT_FOUND`).
3. **OpenSpec change litter** — 13 active changes: 6 with apply-progress but no verify/sync/archive, 2 proposal-only, `gentle-models-effort` uses nonstandard `apply.md`.
4. **README drift and landing quality** — version examples stale (0.14.0 vs 2.2.0); landing can be mechanism-first and honest per product-proof-saas (no invented metrics; show real states).

## Goals

- Fix the dedup bug with regression coverage.
- Restore package-manager and OpenSpec hygiene so the harness's own review discipline is credible.
- README landing aligned with mechanism-first honesty.

## Non-goals

- No change to review/RDD contracts or native CLI.
- No commits/pushes/PRs without explicit user request.
- No subagent runtime available in this session; phases execute inline by the parent.

## Delivery

- Starts after A closes and is archived. Forecast ~150–350 lines. Engineered for a single review under the 400-line budget; `size:exception` never inferred.