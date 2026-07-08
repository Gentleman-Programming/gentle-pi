# Apply Progress: Orchestrator Lazy Diet

**Mode**: Strict TDD
**Runner**: `pnpm test` (baseline 271 green; 306 after initial apply; 307 after the post-apply budget fix round below, all green)
**Do NOT commit**: per instructions, no commit was created.

**Post-apply fix round (surgical, this pass)**: the "shorter/typical install path will normally fall under 10,240 B" claim below was empirically false — a real installed path (`~/.pi/agent/npm/node_modules/gentle-pi/assets`, ≥59 chars) is LONGER than this dev checkout's path, not shorter, and the substituted return measured 111 B (dev-checkout length) to well over budget at realistic install lengths before this fix. Fixed by condensing the core `### Review Execution Contract` block (heading + bold lead-in + 3 bullets, 850 B → 456 B raw, a 394 B cut) instead of keeping it verbatim in both `assets/orchestrator.md` and `assets/orchestrator-delegation.md`; the full verbatim block now lives ONLY in `orchestrator-delegation.md`. See "Byte Measurements" and "Deviations" below for the re-measured numbers and a realistic-path-length test (`tests/orchestrator-budget.test.ts`) that can actually fail again if this regresses.

## Completed Tasks

### Phase 1: Seam (Foundation)
- [x] 1.1 `extensions/gentle-ai.ts:52` — `ASSETS_DIR` now reads `process.env.GENTLE_PI_TEST_ASSETS_DIR ?? join(PACKAGE_ROOT, "assets")`.
- [x] 1.2 `extensions/gentle-ai.ts` `__testing` export object — added `getOrchestratorPrompt`.

### Phase 2: RED — Failing Tests First
- [x] 2.1 Froze `tests/fixtures/orchestrator.pre-diet.md` byte-for-byte from `assets/orchestrator.md` at the "Final re-baseline" state (23,047 B / 312 lines, `diff` confirmed byte-identical before any edit).
- [x] 2.2 `tests/orchestrator-budget.test.ts` — budget test on `__testing.getOrchestratorPrompt()`'s return via a dynamically-mirrored short-path stub dir (module-cache-safe: env var set + dynamic `import()` before any static import of the module in this file, per the design's first-read-wins constraint).
- [x] 2.3 Disposition-mapped union test — 27 explicit `{lines, target, label}` ranges spanning all 312 fixture lines, each asserted against its ONE documented target file (`core` / `delegation` / `memory` / `skills`), not a blanket sweep.
- [x] 2.4 Core-alone token tests (3 tests: trigger labels, "400 changed lines", 4 lens names) reading `assets/orchestrator.md` directly, no lazy union.
- [x] 2.5 No-double-delivery tests (2 tests): delegation/memory/skills-only markers absent from the rendered core; all 3 new pointer paths present.
- [x] 2.6 Cache/substitution tests (2 tests): no leftover `{{`, second call returns the memoized string.
- [x] 2.7 Confirmed RED: `node --experimental-strip-types --test tests/orchestrator-budget.test.ts` → 24 pass / 11 fail (budget test + 3 disposition ranges pointing at not-yet-created lazy files + no-double-delivery tests, all ENOENT/assertion failures as expected). Full-suite run confirmed nothing else broke: 306 total (271 baseline + 35 new), 295 pass / 11 fail — all 11 failures isolated to the new file.

### Phase 3: Author Core + Lazy Files (GREEN, verbatim moves)
- [x] 3.1 Created `assets/orchestrator-delegation.md` — Language Boundary LB2 (line 19) + LB5 (lines 25-29), full Work Routing Ladder body incl. Pi Subagent Model Routing (lines 44-110), full Delegation Rules table + Mandatory Delegation Triggers + Cost/Context Balance + Canonical Lightweight Workflows + Review Lens Selection (lines 112-181, heading+core-question duplicated harmlessly), full 4R Review Triggers body incl. the real landed `### Review Execution Contract` subsection verbatim from `:285-312` (2,526 B, matches the design Addendum's "Final re-baseline" figure exactly).
- [x] 3.2 Created `assets/orchestrator-memory.md` — verbatim `### SDD phases` table + artifact keys + lifecycle rule (lines 203-230).
- [x] 3.3 Created `assets/orchestrator-skills.md` — verbatim Skill Registry Protocol detail (234-253) + Intent-Driven Skill Discovery detail (257-276).
- [x] 3.4 Rewrote `assets/orchestrator.md` core from the design Appendix drafted blocks: Identity Contract unchanged (already-landed 150 B pointer), Language Boundary (LB1 pointer + LB3 + LB4 verbatim + new LB2/LB5 pointer), Mental Model/Core Role/Header/Safety/SDD-Workflow-pointer unchanged verbatim, Work Routing Ladder / Delegation Rules / Skill Registry Protocol / Intent-Driven Skill Discovery condensed per Appendix, Memory Contract (intro + Non-SDD delegation verbatim + pointer), 4R Review Triggers condensed + a real (not representative-estimate) condensed `### Review Execution Contract` rendering — reused the actual landed heading + "**Ledger persistence honors the artifact store.**" + 3 branch bullets verbatim (lines 301-306) plus a new pointer routing the empty-ledger rule and both execution-mode clauses to delegation.
  - All verbatim moves were extracted with `awk 'NR>=a && NR<=b'` (not retyped) to guarantee byte-identical content per JD-010 — zero transcription risk.

### Phase 4: Wire Placeholders
- [x] 4.1 `extensions/gentle-ai.ts` — added `getDelegationPath()`, `getMemoryPath()`, `getSkillsPath()` (mirroring `getSddWorkflowPath`) and 3 `.replaceAll(...)` calls inside the `orchestratorPromptCache` block.

### Phase 5: Repoint Regression Assertions
- [x] 5.1 `tests/gentle-ai.test.ts:40` — repointed ONLY the `assets/orchestrator.md` loop entry to a core+`assets/orchestrator-delegation.md` union read; `README.md` and `skills/gentle-ai/SKILL.md` entries unchanged.
- [x] 5.2 (discovered during Phase 6, not in original task list — see Deviations) — repointed 4 more pre-existing whole-file assertions that the task list did not anticipate, to satisfy the spec's general "Existing Content Assertions Repointed, Not Deleted" requirement and keep the 271-test baseline green:
  - `tests/artifact-language.test.ts` — "orchestrator Memory Contract carries the Engram memory lifecycle rule" (lifecycle rule moved to `orchestrator-memory.md`).
  - `tests/review-ledger-contract.test.ts` — "assets/orchestrator.md Review Execution Contract carries persistence branches and both execution-mode clauses" (empty-ledger + execution-mode clauses moved to `orchestrator-delegation.md`).
  - `tests/persona-single-channel.test.ts` — 3 tests: "LB2 subagent-English delegation kept verbatim", "LB5 exceptions kept verbatim", "dup guard: LB2/LB3/LB4 each occur exactly once" (LB2/LB5 moved to `orchestrator-delegation.md`).
  - `tests/runtime-harness.mjs` — Pi Subagent Model Routing assertions ("do not pass the `model` parameter by default", "SDD model assignment tables apply only to...") moved to `orchestrator-delegation.md`.
  - All 5 repointed by reading the relevant lazy file and unioning its content with the existing read/prompt before asserting — same pattern as 5.1, assertions strengthened with an explanatory comment, never weakened or deleted.

### Phase 6: Measure and Verify
- [x] 6.1 Measured (see table below).
- [x] 6.2 `pnpm test` full suite: 306/306 unit+integration tests pass, runtime harness passes, exit code 0.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.2-2.6 | `tests/orchestrator-budget.test.ts` | Unit | ✅ 271/271 (pre-existing suite green before this file existed) | ✅ Written (35 tests) | ✅ 35/35 passed after Phase 3+4 | ✅ 27 disposition ranges + 3 core-alone + 2 no-double-delivery + 2 cache cases | ✅ merged redundant delegation pointers (5→3 occurrences) to close the budget gap |
| 5.1 | `tests/gentle-ai.test.ts` | Unit | ✅ ran full suite before/after | ✅ (existing test, content changed underneath it — repoint is the fix) | ✅ passed after union repoint | ➖ single repoint | ➖ none needed |
| 5.2 (discovered) | `tests/artifact-language.test.ts`, `tests/review-ledger-contract.test.ts`, `tests/persona-single-channel.test.ts` (x3), `tests/runtime-harness.mjs` | Unit + integration harness | ✅ ran full suite, isolated exact 6 failures | ✅ (existing tests, content moved underneath them) | ✅ all 6 repointed and passing | ➖ each is a single targeted union repoint | ➖ none needed |

### Test Summary
- **Total tests written**: 35 (`tests/orchestrator-budget.test.ts`)
- **Total tests passing**: 306/306 (unit+integration) + runtime harness green
- **Layers used**: Unit (35 new + 6 repointed), Integration/runtime-harness (1 repointed)
- **Approval tests** (refactoring): N/A — this is a content-relocation change, not a refactor of executable logic; the disposition-mapped union test IS the approval test for the content move (proves no normative line lost)
- **Pure functions created**: `getDelegationPath()`, `getMemoryPath()`, `getSkillsPath()` (3 pure path builders, mirroring the existing `getSddWorkflowPath()` pattern)

## Byte Measurements (method: `wc -c`; tokens ≈ bytes/4)

| File | Bytes (raw, `wc -c`) | Lines | Notes |
|---|---:|---:|---|
| `assets/orchestrator.md` (BEFORE) | 23,047 | 312 | frozen in `tests/fixtures/orchestrator.pre-diet.md` |
| `assets/orchestrator.md` (AFTER, core) | 10,107 | 121 | raw file, unresolved `{{...PATH}}` placeholder tokens still present |
| `assets/orchestrator-delegation.md` | 12,928 | — | new, verbatim-moved content |
| `assets/orchestrator-memory.md` | 2,959 | — | new, verbatim-moved content |
| `assets/orchestrator-skills.md` | 3,388 | — | new, verbatim-moved content |
| 3 lazy files total | 19,275 | — | not budgeted (loaded on trigger only) |

**Core delta**: 23,047 → 10,107 B = **−12,940 B (−56.1%)** reduction in the always-on core (raw-file convention, matching how the design's own Appendix/Core-Budget tables measured every figure — unsubstituted placeholder tokens, not substituted paths).

**Token estimate** (bytes/4): before ≈ 5,762 tokens → after (raw core) ≈ 2,527 tokens.

### `getOrchestratorPrompt()` return value (post-substitution) — re-measured after the post-apply fix

| Condition | Bytes | vs 10,240 B budget |
|---|---:|---|
| Short-path stub dir (test methodology, `tests/orchestrator-budget.test.ts`) | ≤ 10,240 (asserted, passing) | **PASS**, exact stub-dependent number varies per `mkdtemp` path length |
| Realistic install path (`tests/orchestrator-budget.test.ts`, mkdtemp + `.pi/agent/npm/node_modules/gentle-pi/assets`, 68 chars, mirroring a real `~/.pi/...` install) | 10,174 | **PASS, 66 B headroom** |
| Real repo absolute paths (this dev checkout: `/home/gentleman/work/gentle-pi`, 31 chars) | 9,957 | **PASS, 283 B headroom** |

**Corrected headroom note (supersedes the pre-fix claim below)**: the pre-fix claim that "a shorter/typical install path will normally fall under 10,240 B" was empirically false and has been struck — real installed paths under `~/.pi/agent/npm/node_modules/gentle-pi/assets` (or equivalent) are LONGER than this dev checkout's 31-char path, not shorter, so the dev-checkout measurement was the OPTIMISTIC case, not a representative one. Fixed (this pass) by condensing the core `### Review Execution Contract` block from 850 B to 456 B raw (a 394 B cut; see "Deviations" #4 below), which:
- dropped the raw core file from 10,107 B to **9,713 B** (`wc -c assets/orchestrator.md`, 121 lines);
- dropped the realistic-install-path (68-char) substituted return from 10,568 B (over budget) to **10,174 B** (66 B headroom);
- dropped this dev checkout's (31-char) substituted return from 10,351 B (111 B over budget) to **9,957 B** (283 B headroom).

`tests/orchestrator-budget.test.ts` now asserts the budget at BOTH a short `mkdtemp` stub path (fast sanity check) AND a realistic-length (≥59 char) synthetic install path built inside a fresh `mkdtemp` scratch dir and measured via a genuinely separate Node process (`tests/fixtures/measure-orchestrator-prompt.mjs`, required because `ASSETS_DIR`/the prompt cache are module-import-time singletons — see JD-005/the file-level comment in the test). The realistic-path test is the one that actually catches a budget regression; the short-path test alone could not.

## Deviations from Design

1. **Repointed 5 additional pre-existing tests beyond the single one named in tasks.md (5.1)**: the task list only named `tests/gentle-ai.test.ts:40`, but 3 other test files (`artifact-language.test.ts`, `review-ledger-contract.test.ts`, `persona-single-channel.test.ts` — 5 assertions across them) plus `tests/runtime-harness.mjs` also directly asserted whole-file content on `assets/orchestrator.md` for text that moved to lazy files. These were discovered only when running the FULL `pnpm test` suite after Phase 4/5, not caught by the narrower `tests/orchestrator-budget.test.ts` run. Repointed all of them to core+lazy union reads, per the spec's general "Existing Content Assertions Repointed, Not Deleted" requirement (not deleted or weakened — same assertions, correct source).
2. **Merged 2 redundant delegation pointers in core to close the substitution-overhead budget gap**: initially assembled core (10,181 B raw) produced a 10,306 B substituted return (66 B over budget) because `{{GENTLE_PI_DELEGATION_PATH}}` appeared 5 times (each substitution costs +14 B over the placeholder token in this repo's path). Merged the Work Routing Ladder pointer into the adjacent Delegation Rules pointer, and merged the 4R-prose pointer into the Review Execution Contract pointer — reducing occurrences from 5 to 3, and raw core from 10,181 B to 10,107 B. This is a content-neutral wording optimization (no normative line lost — verified by the disposition-mapped union test staying green), not a design deviation in substance.
3. **Real Review Execution Contract reconciliation executed as instructed**: per the design's Addendum "Final re-baseline" (hard commitment), the fixture was frozen against the ACTUAL current 23,047 B / 312-line file (not the round-3 judgment's 22,626 B estimate), and the core's condensed Review Execution Contract rendering reuses the REAL landed heading + bold lead-in + 3 bullets verbatim (lines 301-306) instead of the Appendix's "representative" 573 B estimate text — matching the instruction to reconcile against real measured text, not the estimate.
4. **Post-apply fix: condensed the core Review Execution Contract instead of keeping it verbatim (consolidated verify + 2-judge finding)**: deviation 3 above (and the initial apply) kept the core's `### Review Execution Contract` heading + bold lead-in + all 3 persistence-branch bullets byte-identical to `orchestrator-delegation.md`'s copy — 850 B raw, duplicated verbatim in an always-on file, violating the design's "Verbatim-to-lazy, fresh-summary-in-core" decision (`design.md` § Architecture Decisions), which requires every split section to get a freshly-authored terse core summary while the verbatim copy lives ONLY in its lazy file. This also meant the budget test could only pass because it measured a short `mkdtemp` stub path, not a realistic install path (see the corrected headroom note above). Fixed by rewriting the core block to a condensed summary (`assets/orchestrator.md`, `### Review Execution Contract`: 850 B → 456 B raw) that keeps the branch names, the `openspec`/`engram`/`none` distinction, the MEANING of the empty-ledger rule ("Persist even empty ledgers"), and the pointer to `{{GENTLE_PI_DELEGATION_PATH}}` for full detail; the full verbatim block (heading, bold lead-in, 3 bullets, empty-ledger sentence, both execution-mode clauses) stays unchanged, verbatim, ONLY in `assets/orchestrator-delegation.md`. `tests/orchestrator-budget.test.ts`'s disposition map already targeted fixture lines 287-312 (the 4R body + Review Execution Contract) at `delegation` only, not `core`, so no disposition-map range needed to change; what changed is that a NEW realistic-path-length test was added (RED before this fix at 10,568 B, GREEN after at 10,174 B) so the budget assertion can actually fail again if core creeps back toward verbatim duplication. `tests/review-ledger-contract.test.ts`'s union assertion (`orchestratorPath` + `orchestrator-delegation.md`) and `scripts/verify-package-files.mjs` (see below) both continue to pass unchanged.
5. **Package verifier gap closed (orchestrator finding, packaging-critical)**: `scripts/verify-package-files.mjs`'s `requiredPaths` did not include this change's 3 new lazy files (`assets/orchestrator-delegation.md`, `assets/orchestrator-memory.md`, `assets/orchestrator-skills.md`) — a published npm package built without them would break `getOrchestratorPrompt()` at runtime (`ENOENT` on the lazy-file reads triggered by the delegation/memory/skills placeholders). Added all 3 to `requiredPaths`; `node scripts/verify-package-files.mjs` now reports "gentle-pi package resource check passed (44 files)" (was 41).

## Test-file count correction

The Phase 5 test-repoint count is **5 pre-existing test files repointed** (`tests/gentle-ai.test.ts`, `tests/artifact-language.test.ts`, `tests/review-ledger-contract.test.ts`, `tests/persona-single-channel.test.ts`, `tests/runtime-harness.mjs`) **plus 1 new test file created** (`tests/orchestrator-budget.test.ts`) — not "6 test-file repoints." The new file is not a repoint of an existing assertion; it is net-new test authorship. This post-apply fix round adds no further repointed files: the realistic-path budget test and its helper script (`tests/fixtures/measure-orchestrator-prompt.mjs`) are additions inside the already-new `tests/orchestrator-budget.test.ts`, and the REC core condensation required no other test file changes (verified by the full `pnpm test` run below).

## Issues Found
None. The path-length budget-headroom risk flagged in the initial apply pass (see the corrected headroom note above) has been fixed, not merely documented as an accepted tradeoff — the budget now holds at a realistic (≥59-char) install path length, with an automated test that fails if it regresses.

## Files Changed

| File | Action | Lines |
|---|---|---:|
| `extensions/gentle-ai.ts` | Modified | +21 / -3 (env override, 3 path getters, 3 replaceAll calls, `__testing` export addition) |
| `assets/orchestrator.md` | Modified (slimmed; post-apply fix condensed REC further) | 312 → 121 lines (23,047 → 9,713 B) |
| `assets/orchestrator-delegation.md` | Created | 184 lines / 12,928 B |
| `assets/orchestrator-memory.md` | Created | 33 lines / 2,959 B |
| `assets/orchestrator-skills.md` | Created | 50 lines / 3,388 B |
| `tests/fixtures/orchestrator.pre-diet.md` | Created | 312 lines / 23,047 B (frozen baseline) |
| `tests/orchestrator-budget.test.ts` | Created | 36 tests (35 initial + 1 realistic-path-length test added in the post-apply fix round) |
| `tests/fixtures/measure-orchestrator-prompt.mjs` | Created (post-apply fix round) | fresh-process helper for the realistic-path budget test |
| `tests/gentle-ai.test.ts` | Modified | repointed 1 loop entry (task 5.1) |
| `tests/artifact-language.test.ts` | Modified | repointed 1 test (discovered) |
| `tests/review-ledger-contract.test.ts` | Modified | repointed 1 test (discovered) |
| `tests/persona-single-channel.test.ts` | Modified | repointed 3 tests (discovered) |
| `tests/runtime-harness.mjs` | Modified | repointed 3 assertions in 1 test block (discovered) |
| `scripts/verify-package-files.mjs` | Modified (post-apply fix round) | added 3 required paths (`orchestrator-delegation.md`, `orchestrator-memory.md`, `orchestrator-skills.md`) |

5 files repointed + 1 new test file (`tests/orchestrator-budget.test.ts`) in the initial apply, per the "Test-file count correction" section above.

## Status

17/17 listed tasks complete (6 phases), plus 1 unlisted discovered sub-task (5.2, additional repoints) required to reach a fully green `pnpm test`. Post-apply fix round (this pass) closed the realistic-path budget gap, the package-verifier gap, and the test-file-count/headroom documentation errors — `pnpm test` now 307/307 (306 + 1 new realistic-path test), runtime harness green, `node scripts/verify-package-files.mjs` passes (44 files). Ready for re-verify.
