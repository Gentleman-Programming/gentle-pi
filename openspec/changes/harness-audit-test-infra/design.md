# Design — harness-audit-test-infra (Change A)

## Context

Test-infrastructure hardening only. Design decisions below are scoped to the four A specs; product-fix decisions (skill-registry) live in Change B's design.

## 1. One shared test-support module, not per-file patches

- New `tests/support/platform.ts`: `skipOnWindows`/`posixOnly` predicates + `platformSkip(reason)` producing `{ skip: reason }` for `node:test`.
- New `tests/support/git.ts`: `sandboxGitEnv()` returning an isolated env object (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` → empty temp files unless caller provides, `GIT_CONFIG_NOSYSTEM=1`, `-c core.autocrlf=false` appended), `configureSandbox()` for intentional config, `expectNoCrlfWarnings()` regression helper.
- `tests/review-test-fixtures.ts` adopts the git helper for every repo it creates (central fixture module).

**Tradeoff — env-based vs flag-based isolation:** `GIT_CONFIG_GLOBAL` → empty file is chosen over spray-painting `-c` flags: isolates ALL git config inheritance (user `core.filemode`, hooks, aliases) in one mechanism and works identically on win32 (empty temp file). Downside: sandbox-configured tests must go through `configureSandbox()`. Accepted.
Discarded: mutating the user's global gitconfig (invasive, leaks state). Discarded: `.gitattributes eol=lf` alone (fixes contents, not stderr warnings).

**Windows-only semantics:** mode-only, symlink, `mode 0600`-exact, Darwin/Linux bundle, `--orphan`, executable-mode tests get `platformSkip` on win32 (or capability probes, e.g. probe whether sandbox git reports an exec-bit change). Full strength kept on POSIX (CI ubuntu).

## 2. Budget guard

Fix `tests/orchestrator-budget.test.ts` to call the fixture through `pathToFileURL(...).href`. Mechanical; no design tradeoff.

## 3. Tool-dependency tests (pi/gh)

- Opaque-adapter/relay tests: gate on `PI_BIN` env override; without it, `platformSkip`-style skip with a clear reason.
- Relay harness stub: Windows-executable name (`gentle-ai.cmd` on win32) or invoked through `node`.
- Release fast-path: stub `gh` via a fake script injected on PATH inside the test env; existing "caller-supplied CI never trusted" semantics preserved; error-text regexes normalized for path separators.
- Tradeoff: stubbing `gh` costs fixture code but keeps the gate tested everywhere; skipping would leave it untested. Accepted: stub `gh`, skip-only for the real `pi` CLI (a genuine Pi stub is out of scope).

## 4. CI

Add `verify-windows` job to `ci.yml`, strict (no `continue-on-error`), running the same gates as ubuntu. Tradeoff (runner cost vs signal): Windows is the documented target; the failure class is otherwise invisible. Accepted. Windows-runner behavior is validated by CI after push (delivery-side).

## 5. Delivery/slicing

Pre-approved A+B split. Forecast ~350–450 lines (Medium risk). If apply drifts past 450, the orchestrator stops and asks (never infers `size:exception`).