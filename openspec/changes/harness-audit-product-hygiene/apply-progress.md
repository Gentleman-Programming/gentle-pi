# Apply Progress — harness-audit-product-hygiene

Date: 2026-09-02. Platform: Windows (Node 24.13.1). Companion to Change A `harness-audit-test-infra` (test infrastructure, archived 2026-09-02).

## T1 — skill-registry dedup fix — DONE (RED→GREEN)

- RED: `project-local skill registry extension wins over installed package copy` failed on Windows (audit baseline).
- Fix (`extensions/skill-registry.ts`): `extensionSourcePath()` falls back to a logical path (`hostname + pathname`) when `fileURLToPath` throws on drive-less POSIX `file:` URLs (`ERR_INVALID_FILE_URL_PATH` on win32) — never silently `undefined`; `shouldSkipDuplicateExtensionLoad` compares via `sameComparablePath` (case-insensitive on win32; `comparablePath` keeps its value semantics so uniqueExistingDirs/registry output are unchanged).
- Regression test added (drive-less URL over query variants). File: **18 pass / 0 fail** (was 15 pass / 3 fail — the 2 collateral failures from the early case-fold attempt were fixed by scoping the case fold to comparisons only).
- Evidence: `tests/skill-registry.test.ts` green on Windows.

## T2 — Repo hygiene — DONE

- `package.json` + `"packageManager": "pnpm@11.1.1"`.
- `.gitignore` + `package-lock.json`; deleted the untracked npm artifact.
- `gentle-models-effort/apply.md` → `apply-progress.md` (content unchanged).
- Evidence: `ls package-lock.json` fails; tracked names verified.

## T3 — OpenSpec change closure/archive — DONE

- Verified task completion per repo convention (checked task boxes are authoritative — stated in the repo's own change ledgers):
  - Done: bounded-review-graph-parity (17/17), complete-native-review-lifecycle (9/9), native-review-authority-parity (42/42), organic-rdd-parity (5/5), worktree-aware-review-authority (41/41).
  - Superseded: harden-review-contracts (apply-progress records blocked-before-implementation; requirements delivered by later parity work).
  - Abandoned: cross-repo-bundle-trust, review-contract-cleanup (proposal-only, never approved).
- All 8 moved to `openspec/changes/archive/2026-09-02-*/` with `ARCHIVE-REPORT.md` (disposition + reason). `tests/review-ledger-contract.test.ts` HISTORICAL_LIFECYCLE_SPECS paths updated to the archive location.
- Active changes after T3: 6 (align-sdd-openspec-deltas in-flight, gentle-models-effort + 3 verify-report-bearing loops delivery-pending, this change). AC7 deviation: delivery-pending closures are not archived because their post-apply lifecycle (commits/PRs) was intentionally never performed; archiving them as "done" without delivery records would misstate — documented in sync-report.

## T4 — review-git-env scoped-config sanitization — DONE (RED→GREEN)

- RED: `REVIEW_GIT_ENV_UNSAFE` on ambient `GIT_CONFIG_COUNT`/scoped keys (causes of A's latch/repo/watch tower batches).
- Fix (`lib/review-repository.ts`): `reviewGitEnvironment()` silently skips `GIT_CONFIG_COUNT` and `GIT_CONFIG_KEY_*/VALUE_*` (all `GIT_*` keys are already excluded from the child env); every other routing/config key still throws `REVIEW_GIT_ENV_UNSAFE`.
- Unit test (AC1/AC2/AC3): scoped keys sanitized + config neutralization stays; `GIT_DIR` still fails closed. File: **9 pass / 0 fail**.
- AC4 condition: tests keep their belt-and-braces scrub (allowed by the spec).

## T5 — README mechanism-first + honesty — DONE

- Version policy rewritten: current 2.x is the stable RDD line; `v0.14.0` is the documented legacy pre-RDD install (stale "unstable line" story removed).
- New "How it works" section: explicit state flow (clarify → proposal/spec/design/tasks → apply/verify → sync/archive), review-authority boundary (native `gentle-ai` CLI owns evidence; delivery by ordinary repo policy), clarify-as-gate, workload guard — and the capability table anchored to that mechanism.
- Honesty: referenced commands verified to exist in the extension registries (`/gentle:*`, `/sdd-init`); no invented metrics introduced.

## T6 — This change's closure

- Attempts: apply acquire→proceed→settle; budget accounting corrected via maintainer reset (underestimate: acquire 350 vs working-tree diff incl. A slices + OpenSpec archive moves); re-acquire (8,000 cap) → settle `complete`.
- Full suite (Windows): **1080 pass / 0 fail / 45 skipped — exit 0** (first fully-green run of the audited tree). `check:runtime-modules` matches; `runtime-harness` exit 0.
- verify-report + sync-report follow; archive at close.

Changed-line accounting (ledger-accurate): the governance-relevant diff is A+B on top of origin/main (two stacked feature branches); the OpenSpec archives account for most of the raw line count via file moves.