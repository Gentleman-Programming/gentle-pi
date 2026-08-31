# Apply Progress — harness-audit-test-infra

Date: 2026-09-02. Platform: Windows (Node 24.13.1, git 2.53.0.windows.2). Strict TDD: RED baseline measured before changes (211 failing / 1005 passing after fixing the local env module resolution), GREEN evidence recorded per task. No subagent runtime available in this session; apply executed inline by the parent with the native `sdd-attempt` ledger as authority.

## Baseline

- `node --experimental-strip-types --test tests/*.test.ts` before this change: **211 fail / 1005 pass / 0 skip** (Windows, pnpm-installed deps).
- Final (after all tasks): **1077 pass / 1 fail / 45 skipped**.
- The single remaining failure is `project-local skill registry extension wins over installed package copy` — the real `fileURLToPath` dedup bug, deliberately scoped to Change B `harness-audit-product-hygiene` (specs/skill-registry-dedup).

## T1 — Platform-aware test selection — DONE

- `tests/support/platform.ts` (new): `skipOnWindows`, `posixOnly`, `skipWhenNoGitExecutableMode`, `gitExecutableModeSupported`.
- Guards applied (all skips carry explicit Windows reasons, POSIX strength unchanged):
  - `tests/review-candidate-view.test.ts`: 4 symlink tests + 1 exec/symlink-scope test + 2 mode-only tests (`skipWhenNoGitExecutableMode`) + 1 control-char fixture test → 7 skipped on win32 (was 13 fails).
  - `tests/gentle-ai-installer.test.ts`: Darwin/Linux bundle test, extractors-POSIX-path test, executable-POSIX-mode test → `{ skip: process.platform === "win32" }` (matches the repo's existing provider-contract-bundle idiom and the pre-existing `-` POSIX-mode skip).
- Windows-specific product fixes uncovered while RED (recorded because they are required for the platform tests to be meaningful at all):
  - `lib/review-candidate-view.ts`: `candidateGitEnvironment()` — checkout-index/read-tree/worktree git now run with an isolated, deterministic git env (config-neutralized, LF-byte-stable). Before this, user `core.autocrlf=true` corrupted materialized candidate bytes (`\r\n` vs `\n`) and broke 6 tests; byte-deterministic materialization is also a correctness fix for the hash-verified candidate freeze.
  - `lib/review-candidate-view.ts`: `-c core.longpaths=true` on checkout-index + Windows batch-size cap (2 KB) — git-for-windows rejects checkout-index paths at ~213 chars with `Filename too long`; any large candidate would fail to materialize on Windows. Now handled; the incompressible-scope e2e test passes.
- Path-separator-normalized assertions: `tests/openspec-guardrails.test.ts` collision regex now accepts `\` and `/`.

## T2 — Test fixture git-config isolation — DONE

- `tests/support/env.ts` (new): `scrubInheritedGitEnvironment()` (removes ambient `GIT_CONFIG_COUNT`/scoped keys + routing keys from the test-process env), `sandboxGitEnv()` (isolated env for spawned git: empty global/system config, `GIT_CONFIG_NOSYSTEM=1`, `LC_ALL=C`), `emptyGitConfigPath()`.
- Root cause of the ~24 git-output/lock/latch failures: **the ambient environment exports `GIT_CONFIG_COUNT=2` + `credential.interactive=false` (the signature of agent harnesses that disable git credential prompts), and `lib/review-repository.ts` `reviewGitEnvironment()` fails closed on ANY inherited `GIT_CONFIG_*` key.** That fail-closed guard breaks ALL local review authority on real machines running under such a harness — recorded as a Change B product-correctness item (see below).
- Adoption: `tests/review-test-fixtures.ts` (single choke point, 7 importing files), `review-consent-latch.test.ts`, `review-candidate-view.test.ts`, `review-gate.test.ts`, `review-snapshot.test.ts`, `review-object-store.test.ts`, `native-review-parity-runtime.test.ts`, `runtime-harness.mjs`, `review-transaction.test.ts` (git helper).
- RED→GREEN per file (Windows): review-consent-latch 3/3, review-candidate-view 69 pass/7 skip, review-gate 23 pass/1 skip, review-transaction 11/0, snapshot 9/0, object-store 7/0, parity-runtime (in full suite).
- **Change B product item (documented, not fixed here):** `lib/review-repository.ts` should sanitize scoped `GIT_CONFIG_*` keys (like `publicationProbeGitEnvironment` already does) instead of throwing on them, keeping fail-closed only for true routing keys (GIT_DIR, GIT_WORK_TREE, …). Without this, review authority cannot run locally on harness-style machines.

## T3 — Budget guard — DONE

- `tests/fixtures/measure-orchestrator-prompt.mjs` imports the extension via `pathToFileURL(...).href` instead of a bare Windows absolute path (`ERR_UNSUPPORTED_ESM_URL_SCHEME` fixed).
- `getOrchestratorPrompt` 8,192 B budget tests + long-assets-root test now pass on Windows (previously crashed).

## T4 — Tool-dependency tests — DONE

- Explored Windows-executable test stubs (`script.ts` with `.cmd` wrapper, then a node-copy `.exe`): both rejected — `spawn` with `shell:false` returns `EINVAL` for `.cmd`, and node flag collisions break a node-exe copy. Documented in `specs/test-tool-dependencies` deviation: **the subprocess transport suites skip on win32 with an explicit reason** (fake `pi`/`gentle-ai` are shebang scripts that require a native executable; the production adapter spawns real binaries on Windows):
  - `tests/opaque-pi-reviewer-adapter.test.ts`: `harness()` calls `t.skip(...)` on win32 → 4 transport tests skip, 1 contract test passes.
  - `tests/review-host-relay.test.ts`: same → 20 subprocess tests skip, 8 contract/handshake tests pass.
  - `tests/review-gate.test.ts` + `tests/review-transaction.test.ts`: fake-git PATH-interception blocks (`which` + `#!/bin/sh` script) guarded to POSIX; the remaining gate logic stays green on win32.

## T5 — Windows CI — DONE

- `.github/workflows/ci.yml` gains `verify-windows` job (windows-latest): pnpm 11.1.1, Node 24, `actions/setup-go` `>=1.25.10` (the Windows native binary is built from source, GOTOOLCHAIN=local), `pnpm install --frozen-lockfile`, `pnpm test`, `check:runtime-modules`, `verify-package-files`. Matches the ubuntu job's gates. Actual Windows-runner behavior is validated by CI after push (delivery-side).
- YAML parses; same gate commands verified locally.

## T6 — This change's closure

- `sdd-attempt acquire` → `proceed` (token retained), settle pending.
- Native status: `sdd-status harness-audit-test-infra` → apply ready (22/22 tasks now complete).
- verify-report and sync-report follow; archive per repo convention at close.

## Evidence summary

| Metric | Before | After |
| --- | --- | --- |
| Passing tests (Windows) | 1005 | 1077 |
| Failing tests | 211 | 1 (Change B scope) |
| Skipped (explicit platform/tool reasons) | 0 | 45 |
| `check:runtime-modules` | OK | OK (candidate-view is not runtime-generated) |
| `runtime-harness` (test:harness) | FAIL (env) | exit 0 |

Changed lines: 20 tracked files, +210/−74; new `tests/support/{env,platform}.ts` ~+140. Under the 450-line apply budget (forecast 550–850 was the umbrella; A's slice is ~424).