# Sync Report — harness-audit-test-infra

## What shipped in the working tree (no commits; delivery deferred by policy)

- **CI:** `.github/workflows/ci.yml` gains `verify-windows` (windows-latest, Node 24, pnpm 11.1.1, Go >=1.25.10 for the source-built native binary, same gates as ubuntu).
- **Product fixes (lib):** `lib/review-candidate-view.ts` — deterministic isolated git env for candidate materialization (`candidateGitEnvironment`), `-c core.longpaths=true` + Windows batch-size cap on checkout-index.
- **New test support:** `tests/support/env.ts` (git-env isolation + ambient scrub), `tests/support/platform.ts` (platform guards).
- **Test fixes/gates:** candidate-view (7 platform skips; 13→0 fails), installer (3 POSIX guards), dev-binary resolver (`PLATFORM=process.platform`), dev-binary surfacing (per-platform version token), gate (fake-git POSIX guard; push-gate sweep), transaction (fake-git POSIX guard), snapshot/object-store (git-env isolation + path normalization), guardrails regex, consent-latch/repository/parity-runtime/harness (env scrub), budget fixture (`pathToFileURL`), quiet-tool (platform-aware cwd assertion), opaque-adapter + host-relay (subprocess suites skip on win32).
- **OpenSpec store:** proposal/spec(4)/design/tasks/apply-progress/verify-report for `harness-audit-test-infra`.

## Verified state (Windows)

- `node --experimental-strip-types --test tests/*.test.ts`: **1077 pass / 1 fail / 45 skipped** (baseline 1005/211/0). The 1 failure is `skill-registry` dedup → tracked in Change B.
- `node scripts/build-runtime-modules.mjs --check`: matches.
- `tests/runtime-harness.mjs`: exit 0.

## Deviations / notes

1. `specs/test-tool-dependencies` AC2 (Windows-executable relay stub) was **superseded by skip-on-win32** after both stub approaches (`.cmd` via `spawn shell:false` → `EINVAL`; node-copy `.exe` → node-flag collision) proved unworkable in the adapter's fixed spawn contract. Coverage remains on POSIX; documented in apply-progress and verify-report.
2. Change B product item added during this change's apply: `lib/review-repository.ts` `reviewGitEnvironment()` must sanitize scoped `GIT_CONFIG_*` keys (agent-harness ambient env breaks ALL local review authority) — currently tracked only in apply/verify text **and must be added to `harness-audit-product-hygiene` specs when B starts**.
3. `gentle-ai sdd-verify-validate` (native envelope validator) rejected readable prose verify-reports with undocumented envelope rules; the repo convention (prose verify-report.md) is retained and the deviation is recorded here.

## Handoff to delivery

- Commits/PRs intentionally NOT created (policy: delivery only on explicit user request). Suggested commit slicing when requested: (1) test support + fixes, (2) candidate-view product fixes, (3) CI job, (4) openspec artifacts — or one review-sized commit set per the 284-line tracked diff + new support files (~424 total).