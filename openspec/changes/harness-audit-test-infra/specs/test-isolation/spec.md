# Spec — Test fixture git-config isolation

## Context

Sandbox repos created by tests inherit the user's global git config (`core.autocrlf=true` on most Windows machines). CRLF warnings then pollute git stderr that tests parse strictly, causing ~24+ false failures that vary per machine. `core.filemode` also defaults differently on Windows.

## Acceptance criteria

- AC1: A single central helper (in `tests/review-test-fixtures.ts` or a new `tests/support/git.ts`) is the only place test repos are created; it initializes every sandbox repo with an isolated git environment: `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` pointed at empty/absent files (or equivalent `-c` flag set), and `-c core.autocrlf=false`.
- AC2: Every git process spawned by tests uses the isolated environment, directly or through the helper — including tests that currently spawn `git` ad hoc.
- AC3: Mode-only assertions (`deriveChangedPathManifest … mode`, `mode-only divergence`) are gated behind a capability check: on platforms where git cannot report an executable-bit change (Windows/`core.filemode=false`), the test skips.
- AC4: The CRLF-warning pollution class is regression-guarded: a test asserts sandbox `git status`/`git commit` stderr contains no `LF will be replaced by CRLF` warning while the user's real global config may be anything (simulate `core.autocrlf=true` set in the sandbox environment to prove isolation).
- AC5: The Windows suite delta from this spec alone is measurable: the ~24 git-output/repo-lock/worktree/latch failures listed in explore.md drop to (a) passing or (b) explicitly skipped by an AC3/AC4-class gate; no silent weakening.

## Non-constraints

- Do not change the user's global git config, `.gitattributes`, or system `core.autocrlf`; isolation happens per sandbox repo.
- Runtime/harness `tests/runtime-harness.mjs` may adopt the same helper where it spawns git, but its behavior contract is unchanged.