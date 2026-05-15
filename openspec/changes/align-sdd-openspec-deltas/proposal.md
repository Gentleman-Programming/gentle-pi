# Proposal: Align SDD OpenSpec delta handling

## Problem

`gentle-pi` has SDD phase agents and OpenSpec-style directories, but its current SDD assets and examples do not consistently encode the spec-evolution model already accepted in `gentle-ai`: canonical file-backed specs in `openspec/specs/`, change deltas in `openspec/changes/{change}/specs/{domain}/spec.md`, and archive-time merge into canonical specs.

This creates drift between `gentle-pi` and `gentle-ai`, especially around spec updates, archive semantics, legacy flat `spec.md` artifacts, and stale installed `.pi` assets.

## Goals

- Port the accepted `gentle-ai` OpenSpec convention into `gentle-pi` SDD assets.
- Make `openspec`/`both` (hybrid) modes treat `openspec/specs/` as the canonical source of truth.
- Make change specs use `openspec/changes/{change}/specs/{domain}/spec.md`.
- Document that `engram` mode is working memory only and intentionally has no canonical spec merge layer.
- Add guardrails for cross-change collisions, legacy flat spec artifacts, destructive archive merges, and stale `.pi` asset drift.

## Non-Goals

- Do not install or require the external OpenSpec CLI/package.
- Do not add canonical spec merge behavior to `engram` mode.
- Do not replace the SDD phase model with OPSX wholesale.
- Do not archive or rewrite unrelated historical changes except through explicit migration tasks.

## Affected Areas

- `assets/agents/sdd-spec.md`
- `assets/agents/sdd-archive.md`
- `assets/agents/sdd-apply.md` and `assets/agents/sdd-verify.md` only if artifact naming compatibility is needed
- `assets/chains/*.chain.md`
- `lib/sdd-preflight.ts` / install asset freshness behavior
- `README.md`
- `openspec/changes/*` examples and fixtures
- `tests/runtime-harness.mjs` or new focused tests

## Capabilities

### New Capabilities

- `sdd-openspec`: Defines the canonical OpenSpec-compatible SDD file layout, delta authoring rules, sync/archive merge behavior, and accepted mode boundaries for `gentle-pi`.

### Modified Capabilities

- None yet. `gentle-pi` currently has no canonical source spec for SDD/OpenSpec behavior.

## Success Criteria

- `sdd-spec` instructs executors to write file-backed specs under `openspec/changes/{change}/specs/{domain}/spec.md`.
- `sdd-spec` includes ADDED/MODIFIED/REMOVED guidance, including copy-full-then-edit for MODIFIED requirements.
- `sdd-archive` merges file-backed deltas into `openspec/specs/{domain}/spec.md`, then moves the change to `openspec/changes/archive/YYYY-MM-DD-{change}/`.
- The docs explicitly say Engram-only mode is working memory and does not maintain canonical specs.
- Tests or fixtures prove at least one new-domain archive path and one modified-requirement merge path.
- Installed `.pi` SDD asset drift is surfaced or refreshed intentionally.

## Risks

- Prompt-only merge rules can still be inconsistently applied unless backed by code tests or deterministic helpers.
- Force-refreshing `.pi` assets may overwrite local customizations; freshness handling needs a safe reviewable path.
- Migrating existing flat `spec.md` artifacts may create noisy diffs if bundled with runtime changes.

## Rollback

- Revert asset prompt changes and docs.
- Leave existing OpenSpec change artifacts active; do not delete them.
- If a `.pi` refresh path is changed, provide a non-destructive fallback that only warns about drift.
