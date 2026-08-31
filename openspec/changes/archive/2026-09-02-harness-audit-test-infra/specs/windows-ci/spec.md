# Spec — Windows CI and platform-aware test selection

## Context

CI runs only ubuntu (`.github/workflows/ci.yml`) yet Windows is a documented target. The suite must be green (or explicitly skipped) on Windows, and a Windows CI job must enforce it.

## Acceptance criteria

- AC1: `.github/workflows/ci.yml` gains a `verify-windows` job on `windows-latest` running the same gates as the ubuntu job: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm run check:runtime-modules`, `node scripts/verify-package-files.mjs`.
- AC2: The job runs the exact present gate commands (env `GENTLE_PI_REQUIRE_NATIVE_BINARY: "1"` inherited where the ubuntu job sets it).
- AC3: A shared platform-skip helper exists (e.g. `tests/support/platform.ts`) exposing predicates such as `skipOnWindows`/`posixOnly` for `node:test` `{ skip }` options.
- AC4: Every test exercising POSIX-only semantics (symlinks, executable-mode, `mode 0600` exact bits on non-POSIX, Darwin/Linux installer bundles, `worktree add --orphan` behavior) is skipped on the platforms where the semantics cannot be honored — skipped, never deleted, never weakened on POSIX.
- AC5: Rendered error-message assertions that embed file paths accept both `/` and `\` separators (e.g. `openspec-guardrails` collision list), or normalize before matching.
- AC6: After AC3–AC5, the full suite passes on Windows except tests explicitly skipped by AC4.
- AC7: `pnpm test` on Linux remains unchanged in pass/fail behavior (no regression from platform guards).

## Non-constraints

- CI push/merge wiring and badge updates are delivery concerns, not apply concerns; CI behavior is validated by CI itself after push. The workflow file must be syntactically valid YAML and the gates correct.