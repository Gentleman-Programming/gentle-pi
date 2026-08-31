# Tasks — harness-audit-product-hygiene (Change B)

Starts after Change A (`harness-audit-test-infra`) closes and is archived. Strict TDD applies; RED evidence per task.

## T1 — skill-registry dedup fix (`specs/skill-registry-dedup`)

- [x] RED: confirm `project-local skill registry extension wins over installed package copy` fails on Windows (baseline; already observed in the audit).
- [x] Fix `extensionSourcePath` in `extensions/skill-registry.ts`: on `fileURLToPath` throw, fall back to a logical path from the URL (`hostname + pathname`), never `undefined` for `file:` URLs; `comparablePath` lower-cases on win32.
- [x] Add regression unit test for the drive-less URL form (must pass on Linux, and on Windows must not throw / not return undefined).
- [x] Evidence: targeted file tests pass on both platforms.

## T2 — Repo hygiene (`specs/repo-hygiene` AC1–AC3)

- [x] Add `"packageManager": "pnpm@11.1.1"` to `package.json`.
- [x] Delete untracked `package-lock.json`; add `package-lock.json` to `.gitignore`.
- [x] Rename `openspec/changes/gentle-models-effort/apply.md` → `apply-progress.md`.
- [x] Evidence: `package-lock.json` absent; git status clean of npm artifacts; rename applied.

## T3 — OpenSpec change closure/archive (`specs/repo-hygiene` AC4–AC7)

- [x] For each of the 6 orphaned changes: read `apply-progress.md` + `tasks.md`, verify completion against code; decide done vs superseded (documented reason).
- [x] Archive each verified change per repo convention with `ARCHIVE-REPORT.md`.
- [x] Resolve proposal-only changes (`cross-repo-bundle-trust`, `review-contract-cleanup`) — archive-as-abandoned with documented reason, or leave active with explicit note.
- [x] Evidence: `gentle-ai sdd-status` shows ≤1 active change after completion.

## T4 — review-git-env scoped-config sanitization (`specs/review-git-env-scoped-config`)

- [x] RED: `REVIEW_GIT_ENV_UNSAFE` on an env carrying `GIT_CONFIG_COUNT`/scoped keys (reproducible on Windows with agent-harness env).
- [x] `reviewGitEnvironment()` strips scoped-config keys (AC1) while keeping the throw for routing keys (AC2).
- [x] Unit tests for AC1/AC2/AC3; consent-latch/repository tests pass without scrub (AC4).
- [x] Evidence: targeted tests pass on Windows and Linux.

## T5 — README mechanism-first + honesty (`specs/readme-product-proof`)

- [x] Fix stale version examples (0.14.0/v0.15 story → current 2.2.x reality).
- [x] Add "How it works" state-flow section (clarify → SDD phases → apply/verify → native review authority boundary; gates as real states).
- [x] Honesty pass: neutralize claims not backed by the repo; anchor the capability table to the mechanism section.
- [x] Verify every referenced command/path exists (cross-check `gentle-ai --help`, `/gentle:*` commands).
- [x] Evidence: README diff only where AC2–AC5 require; commands verified.

## T6 — This change.s own closure

- [x] `apply-progress.md` with per-task evidence.
- [x] Full `pnpm test` on Windows; verify-report against the 3 specs' acceptance criteria.
- [x] `sync-report.md`; archive per repo convention at close.

---

## Review Workload Forecast

- Estimated changed lines: **~150–350**.
- 400-line budget risk: **Low–Medium**.
- Chained: continues the A→B sequence (B follows A); no further split required.
- `size:exception` never inferred.