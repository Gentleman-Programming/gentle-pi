# Verify Report — harness-audit-test-infra

Verification executed 2026-09-02 on Windows (Node 24.13.1, git 2.53.0.windows.2, pnpm 11.1.1). Command: `node --experimental-strip-types --test tests/*.test.ts`, `node scripts/build-runtime-modules.mjs --check`, `node --experimental-strip-types tests/runtime-harness.mjs`. Result: **1077 pass / 1 fail / 45 skipped** (baseline 1005/211/0), runtime modules match, harness exit 0.

## Spec: windows-ci

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: `verify-windows` job on windows-latest with same gates | PASS | `.github/workflows/ci.yml` (added job; pnpm install --frozen-lockfile, pnpm test, check:runtime-modules, verify-package-files) |
| AC2: env GENTLE_PI_REQUIRE_NATIVE_BINARY=1 inherited | PASS | Job sets it; Go setup added (`setup-go` >=1.25.10) because Windows builds the binary from source (GOTOOLCHAIN=local) |
| AC3: shared platform-skip helper exists | PASS | `tests/support/platform.ts` (`skipOnWindows`, `posixOnly`, `skipWhenNoGitExecutableMode`) |
| AC4: POSIX-only tests skip, never weaken | PASS | 45 skipped with explicit reasons; POSIX paths verified intact (guards only add `{ skip: ... }`) |
| AC5: rendered error paths accept both separators | PASS | `openspec-guardrails` collision regex `openspec(?:[\\/]+)...`; snapshot path compare normalized |
| AC6: suite passes on Windows except explicit skips | PASS | 1077 pass / 45 skip / 1 fail — the 1 fail is `skill-registry` dedup, Change B scope (documented, not a regression of this change) |
| AC7: Linux behavior unchanged | PARTIAL (deferred to CI) | Guards are additive skips; POSIX-only skip options return `{ skip: false }`; Linux equivalence re-verified by CI after push |

## Spec: test-isolation

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: central git-env isolation helper | PASS | `tests/support/env.ts` (`sandboxGitEnv`, `scrubInheritedGitEnvironment`); adopted in review-test-fixtures + 7 direct files + runtime-harness |
| AC2: every git process spawned by tests isolated | PASS (with 2 product fixes) | direct spawns swept in gate/snapshot/object-store/transaction/parity-runtime; additionally production `review-candidate-view.ts` git now runs `candidateGitEnvironment()` (byte-deterministic checkout) |
| AC3: mode-only assertions gated by capability | PASS | `skipWhenNoGitExecutableMode` on both mode-only tests (win32) |
| AC4: no-`LF will be replaced by CRLF` regression guard | PASS | `\r\n`-vs-`\n` failures eliminated (6 candidate-view materialization tests + latch/worktree/repo tests); sandbox empty config proves isolation under user autocrlf=true |
| AC5: Windows delta measurable | PASS | 211→1 failing; counts recorded in apply-progress |

Documented product finding (Change B): `lib/review-repository.ts` `reviewGitEnvironment()` throws on inherited scoped `GIT_CONFIG_*` keys (e.g. `GIT_CONFIG_COUNT` + `credential.interactive=false`, the signature of agent harnesses), breaking ALL local review authority on such machines. Change B must sanitize scoped config while keeping fail-closed for routing keys.

## Spec: budget-guard-windows

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: measurement via file:// specifier; budget tests pass on Windows | PASS | `measure-orchestrator-prompt.mjs` uses `pathToFileURL(...).href`; `getOrchestratorPrompt` 8,192 B + long-root tests pass |
| AC2: fixture contract unchanged | PASS | Only the import specifier changed |
| AC3: Linux keeps passing | PARTIAL (CI) | No Linux-relevant change; CI re-verifies |

## Spec: test-tool-dependencies

| AC | Result | Evidence |
| --- | --- | --- |
| AC1: pi-spawning tests skip cleanly when un-runnable | PASS (deviation) | Opaque-adapter + relay harness call `t.skip` on win32 with explicit reason; 24 tests skip, 9 contract tests still run/pass. Attempts to build a Windows spawnable stub failed: `spawn` with `shell:false` returns `EINVAL` for `.cmd`, and a node-copy `.exe` collides with node CLI flags. Documented in apply-progress. |
| AC2: relay stub Windows-executable | SUPERSEDED by AC1 deviation | The skip path replaces the stub-name fix; relay transport coverage remains on POSIX (CI ubuntu). |
| AC3: gh release fast-path stubbed or skipped | PASS | The release fast-path + fake-git PATH blocks are POSIX-guarded (`review-gate`, `review-transaction`); non-interception gate logic passes on Windows (23/0/1 and 11/0). |
| AC4: skipped tests report as skipped | PASS | All skips are `{ skip: reason }` / `t.skip(reason)` with reasons; suite reports 45 skipped. |

## Verdict

- Overall: PASS with one documented deviation (test-tool-dependencies AC2 → skip on win32) and two production fixes (candidate-view deterministic git env; longpaths + batch cap) that were mandatory for the test-isolation AC to hold on Windows.
- The 1 remaining test failure belongs to Change B (skill-registry dedup), tracked in `harness-audit-product-hygiene/specs/skill-registry-dedup`.
- Linux-equivalence ACs (windows-ci AC7, budget AC3) are re-verified by the new windows job + existing ubuntu job in CI after delivery.