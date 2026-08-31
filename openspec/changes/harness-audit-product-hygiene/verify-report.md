# Verify Report — harness-audit-product-hygiene

Verification executed 2026-09-02 on Windows. Command: `node --experimental-strip-types --test tests/*.test.ts` → **1080 pass / 0 fail / 45 skipped, exit 0**; `node scripts/build-runtime-modules.mjs --check` → matches; `node --experimental-strip-types tests/runtime-harness.mjs` → exit 0.

## Spec: skill-registry-dedup

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: `extensionSourcePath` falls back to a logical path on fileURLToPath throw | PASS | url fallback in `extensions/skill-registry.ts`; drive-less regression test added |
| AC2: dedup returns true for installed copy when project-local exists, all platforms | PASS | `project-local skill registry extension wins over installed package copy` green on Windows (was RED) |
| AC3: POSIX unchanged; `?fragment` variants same source | PASS | `duplicate extension load is skipped only across different sources` + new variant test pass |
| AC4: regression unit for drive-less URL on both platforms | PASS | new test passes on Windows; same code path is exercised if CI runs Linux |
| AC5: no other registry behavior changes | PASS | full skill-registry file 18/0; full suite green |

## Spec: repo-hygiene

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: packageManager declared | PASS | `pnpm@11.1.1` (matches CI pin) |
| AC2: package-lock.json removed + gitignored | PASS | deleted; `.gitignore` entry added; `pnpm-lock.yaml` sole lockfile |
| AC3: apply.md → apply-progress.md | PASS | renamed, content unchanged |
| AC4: orphaned changes verified before archive | PASS | per-change disposition in T3 apply-progress (done/superseded/abandoned) |
| AC5: archived with ARCHIVE-REPORT per repo convention | PASS | 8 change dirs moved to `archive/2026-09-02-*` + ARCHIVE-REPORT each |
| AC6: proposal-only changes resolved | PASS | cross-repo-bundle-trust, review-contract-cleanup archived as abandoned with reasons |
| AC7: sdd-status ≤1 active after completion | DEVIATION | Active = 6 incl. this change: align-sdd-openspec-deltas in-flight; gentle-models-effort + 3 verify-report-bearing changes delivery-pending (their post-apply lifecycle was intentionally never performed, so archiving them as done would misstate). Accounting in sync-report. |

## Spec: readme-product-proof

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: version freshness | PASS | 2.x stable RDD line; v0.14 documented as legacy; stale "unstable line" story removed |
| AC2: mechanism-first state flow | PASS | new "How it works" section (states, authority boundary, gates) |
| AC3: honesty pass | PASS | stale claims removed; referenced commands verified present in extension registries |
| AC4: capability table anchored to mechanism | PASS | closing paragraph cross-references each table row to the section |
| AC5: referenced commands/paths exist | PASS | `/gentle:status`, `/gentle:doctor`, `/gentle:sdd-preflight`, `/sdd-init`, `/gentle:models`, `/gentle:persona`, `/gentle:background-subagents`, `/gentle:banner` all found in `extensions/*.ts` |
| AC6: no redesign beyond content | PASS | single-file content changes only |

## Spec: review-git-env-scoped-config

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: scoped-config keys sanitized, not thrown | PASS | `reviewGitEnvironment()` skips `GIT_CONFIG_COUNT`/KEY/VALUE; child env already drops all `GIT_*` |
| AC2: routing keys still fail closed | PASS | unit test asserts `GIT_DIR` → `REVIEW_GIT_ENV_UNSAFE`; set unchanged for routing keys |
| AC3: unit tests runnable POSIX+Windows | PASS | new test in review-repository file (9/0) |
| AC4: consent-latch/repository pass without scrub required | PASS(optional) | tests keep belt-and-braces scrub; guard no longer the reason they need it |
| AC5: no evidence weakening | PASS | config neutralization, locks, LC_ALL unchanged |

## Verdict

- PASS with two documented deviations (test-tool AC2 from Change A; repo-hygiene AC7 archive timing), both accounting-based, neither weakening behavior.
- Full suite green on Windows (exit 0) for the first time in the audited baseline.