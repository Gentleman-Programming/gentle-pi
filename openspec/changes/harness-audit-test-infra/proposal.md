# Proposal — harness-audit-test-infra (Change A)

## Problem statement (A scope)

The gentle-pi suite cannot be verified on Windows — its documented target platform. CI runs only ubuntu; locally on Windows 211/1207 tests fail, dominated by environment leakage and platform-unsafe tests rather than product defects:

1. **CI blind to Windows** — `.github/workflows/ci.yml` runs ubuntu only.
2. **Git-config leakage** — sandbox repos inherit the user's global `core.autocrlf`; CRLF warnings pollute strictly-parsed git stderr (~24 failures), and mode/symlink/`--orphan` semantics differ on Windows (~11 more).
3. **POSIX-only tests run on win32 instead of skipping** (Darwin/Linux bundles, executable-mode, `mode 0600`).
4. **Guards unverifiable on Windows** — the orchestrator prompt-budget fixture crashes via dynamic `import()` of a Windows absolute path (`ERR_UNSUPPORTED_ESM_URL_SCHEME`).
5. **Tests shell out to real `pi`/`gh`** un-stubbed; the relay stub file name is not Windows-executable (`spawn … ENOENT`).

Change B (`harness-audit-product-hygiene`) carries the product-fix (skill-registry dedup), repo/OpenSpec hygiene, and README work from the same audit.

## Goals

- Green (or explicitly skipped) suite on Windows, enforced by a new Windows CI job.
- Deterministic, machine-independent test fixtures (no user git-config leakage).
- Honest platform-gated tests: skipped ≠ deleted; POSIX strength unchanged.

## Non-goals

- No change to review/RDD contracts, native CLI, or production runtime behavior (fixes to live code live in Change B).
- No commits/pushes/PRs in this pipeline without explicit user request.
- No subagent runtime is available in this session; phases execute inline by the parent (documented delegation trigger).

## Delivery

- Split pre-approved (A+B); review forecast ~350–450 lines (Medium budget risk); apply stops and asks again if it drifts past 450.