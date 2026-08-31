# Explore — harness-audit-hardening

Read-only exploration evidence gathered 2026-09-02 on Windows (Node 24.13.1, git 2.53.0.windows.2, pnpm 11.1.1).

## Baseline: test suite on Windows

- `node --experimental-strip-types --test tests/*.test.ts` (post `pnpm install`): **211 failing / 1005 passing**.
- Before installing `@earendil-works/pi-coding-agent` (npm-built `node_modules`): 249 failing — ~104 of them `ERR_MODULE_NOT_FOUND` caused by the missing devDependency, not product code.
- CI (`.github/workflows/ci.yml`) runs **ubuntu-latest only**; none of the Windows failures are observable there.

### Failure classification (106 unique failing tests after env fix)

| Theme | Count | Root cause |
| --- | --- | --- |
| git-output strict parsing / repo-lock / worktree / release | ~24 | User-global `core.autocrlf=true` leaks into sandbox repos; `LF will be replaced by CRLF` warnings pollute git stderr that tests assert on; `core.filemode` semantics differ on Windows |
| symlink / control-char / mode-only | ~11 | No symlink privilege (or Developer Mode) on Windows; `chmodSync(0o755)` does not set git executable bit on NTFS; `git worktree add --orphan` behavior |
| dev-binary override / installer POSIX-only / opaque pi-subprocess / relay / budget / skill-registry / domain collisions | ~23 | Dynamic `import("<Windows absolute path>")` → `ERR_UNSUPPORTED_ESM_URL_SCHEME` (budget fixture); `fileURLToPath` on drive-less `file:///home/...` URLs throws `ERR_INVALID_FILE_URL_PATH` (skill-registry dedup); tests spawning real `pi`/`gh` un-stubbed; Darwin/Linux-only installer tests running on win32; Windows path separators in rendered error messages (`openspec\changes\...` vs regex `/openspec\/changes\/.../`) |

## Key evidence (file:line / reproduction)

- `extensions/skill-registry.ts` `extensionSourcePath()`: `fileURLToPath` throws on win32 for `file:///home/...` (no drive); `catch` returns `undefined`, `shouldSkipDuplicateExtensionLoad` then records-and-loads instead of skipping the installed copy. Verified with `node -e`:
  - `fileURLToPath('file:///home/...')` → `ERR_INVALID_FILE_URL_PATH`
  - `fileURLToPath('file:///C:/...')` → works
- `tests/orchestrator-budget.test.ts` `measureOrchestratorPromptBytes()`: `import(<win path>)` → `ERR_UNSUPPORTED_ESM_URL_SCHEME` (protocol `c:`).
- CRLF warnings observed in every git-heavy failing test block (e.g. `repository facade mutates under the portable atomic mkdir authority lock`).
- `tests/openspec-guardrails.test.ts` `detectActiveDomainCollisions`: rendered path uses `\` on Windows; regex expects `/`.
- `skills/` load from this checkout: this working tree is the live installed harness (system prompt resolves `gentle-pi` skills here); code changes take effect on next Pi start.
- `git status`: only untracked `package-lock.json` (npm artifact; repo is pnpm). No `packageManager` field in `package.json`.
- 13 changes in `openspec/changes/` active; 6 have `apply-progress.md` + `tasks.md` but no `verify-report.md`/`sync-report.md` and are not archived; `gentle-models-effort` uses nonstandard `apply.md`; `cross-repo-bundle-trust` and `review-contract-cleanup` are proposal-only.
- `pnpm install --frozen-lockfile` on this machine hit `ERR_PNPM_EPERM` twice renaming native binary packages (`@yuuang/ffi-rs-win32-x64-msvc`, `@ff-labs/fff-bin-win32-x64`) — likely AV/Defender transient lock, recoverable on retry; not tracked as product bug.
- README install examples still point at `npm:gentle-pi@0.14.0` and describe the v0.15+ "unstable RDD" split while `package.json` is `2.2.0`.

## Out of scope (observed, not pursued)

- Review runtime/RDD redesign, packaging rearchitecture, PolyGraph, uv/engram flows (Engram not active in this session).
- The 106 Windows failures include POSIX-only semantics that cannot be fixed in code (symlinks, exec bit); they must be explicitly skipped, not "made to pass".