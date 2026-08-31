# Tasks — harness-audit-test-infra (Change A)

Strict TDD applies. RED evidence = current Windows baseline (211 failing / 1005 passing). This change covers the four test-infrastructure specs only; Change B `harness-audit-product-hygiene` carries the product-fix, hygiene, and README specs.

## T1 — Platform-aware test selection (`specs/windows-ci` AC3–AC6)

- [x] Create `tests/support/platform.ts` with `posixOnly(reason)` / `skipOnWindows(reason)` helpers for `node:test`.
- [x] Apply platform guards to Windows-incompatible tests: mode-only (`deriveChangedPathManifest … mode`, `mode-only divergence`), symlink suite, `mode 0600` latch assertions, Darwin/Linux installer bundle tests, `--orphan` worktree tests, executable-POSIX-mode installer test. Guards are skips with reasons — never deletions or POSIX weakening.
- [x] Normalize path-separator assertions in rendered error messages (`tests/openspec-guardrails.test.ts` collision regex, any other `/`+`\` brittle regex).
- [x] Evidence: `pnpm test` on Windows — previously-failing platform tests report as skipped; POSIX behavior untouched.

## T2 — Test fixture git-config isolation (`specs/test-isolation`)

- [x] Add `tests/support/git.ts`: `sandboxGitEnv()` (GIT_CONFIG_GLOBAL/SYSTEM → empty temp file when unset, `GIT_CONFIG_NOSYSTEM=1`), `configureSandbox()` for intentional sandbox config, and `expectNoCrlfWarnings()` regression helper.
- [x] Adopt the env in `tests/review-test-fixtures.ts` for every repo it creates.
- [x] Sweep remaining ad-hoc git spawns in tests (repository facade, push gate, release fast-path, reviewer candidate views, lock/latch, runtime-harness) to use the isolated env.
- [x] Add AC4 regression: with sandbox `core.autocrlf=true` forced, sandbox `git status`/`commit` stderr shows no `LF will be replaced by CRLF`.
- [x] Evidence: previously failing git-output/lock/worktree/latch tests pass on Windows; count the delta in apply-progress.

## T3 — Budget guard (`specs/budget-guard-windows`)

- [x] Fix `tests/orchestrator-budget.test.ts` to invoke the fixture via `pathToFileURL(...).href`.
- [x] Evidence: `getOrchestratorPrompt … 8,192 B` + long-root budget tests pass on Windows.

## T4 — Tool-dependency tests (`specs/test-tool-dependencies`)

- [x] Gate pi-spawning tests (opaque-adapter, relay host-relay) on `PI_BIN` override; skip cleanly otherwise.
- [x] Make the relay harness stub Windows-executable (platform-aware name or `node` executor) — eliminates `spawn … ENOENT` on win32.
- [x] Stub `gh` for release fast-path within test env (fake `gh` script on PATH); keep "caller-supplied CI never trusted" semantics; normalize remaining error-text regexes.
- [x] Evidence: touched tests skip or pass deterministically on Windows and Linux.

## T5 — Windows CI (`specs/windows-ci` AC1–AC2, AC7)

- [x] Add `verify-windows` job (`windows-latest`, pnpm install --frozen-lockfile, pnpm test, check:runtime-modules, verify-package-files) to `.github/workflows/ci.yml`.
- [x] Validate YAML parses; gates match ubuntu job.
- [x] Evidence: YAML parse + dry-run of job commands locally (Windows runner behavior confirmed by CI after push — delivery-side).

## T6 — This change's own closure

- [x] Write `apply-progress.md` with per-task evidence + Windows fail-pass-skip deltas.
- [x] Run full `pnpm test` on Windows; record pass/fail/skip counts vs the 211 baseline.
- [x] Write `verify-report.md` against the 4 specs' acceptance criteria.
- [x] Write `sync-report.md`; archive this change per repo convention at close (self-discipline).

---

## Review Workload Forecast

- Estimated changed lines: **~350–450** (support modules, guards across ~8 test files, fixtures, stub, CI job).
- 400-line budget risk: **Medium** — near the line; if apply drifts past 450, the orchestrator stops and asks before continuing.
- Chained PRs recommended: **Yes** — this is Change A; Change B follows on its own pipeline.
- Decision needed before apply: **No** (pre-approved by the A+B split).
- `exception-ok` is never inferred; any over-budget drift requires explicit acceptance.