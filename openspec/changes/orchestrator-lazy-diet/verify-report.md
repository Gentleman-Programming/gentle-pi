# Verification Report: orchestrator-lazy-diet

**Change**: orchestrator-lazy-diet
**Mode**: Full artifacts (spec + design + tasks + apply-progress + review-ledger)
**Branch**: feat/orchestrator-lazy-diet (uncommitted working tree)
**Runner**: `pnpm test` (`node --experimental-strip-types --test tests/*.test.ts && pnpm run test:harness`), Strict TDD
**Verdict**: **PASS WITH WARNINGS** (1 CRITICAL requires orchestrator/user decision before archive; all other requirements independently confirmed)

All findings below were independently re-derived from the filesystem/test run in this session — not copied from apply-progress.md's claims — except where explicitly noted as "per apply-progress.md" cross-reference.

## 1. Test Execution Evidence

- `pnpm test` → exit code 0. `node:test` summary: **306 pass / 0 fail / 0 skipped**, `tests/orchestrator-budget.test.ts` included (1 budget + 27 disposition-sweep + 3 core-alone + 2 no-double-delivery + 2 cache = 35 tests, all green).
- `pnpm run test:harness` (`tests/runtime-harness.mjs`) ran as part of the same `pnpm test` invocation and completed without error (exit 0 overall).
- No typecheck script exists in `package.json`; `pnpm test` is the full contract.

## 2. Spec Compliance Matrix (independently re-verified, not trusted from prose)

| Requirement | Status | Evidence |
|---|---|---|
| Always-On Injection Byte Budget | **CRITICAL** (see §3) | Test passes only against a synthetic short-path stub; real return value is over budget in every real environment measured. |
| Lazy Sections Reachable via In-Core Pointers | PASS | `rg` confirms 3/3 lazy placeholders present in core (`DELEGATION_PATH` x3, `MEMORY_PATH` x1, `SKILLS_PATH` x2) plus the pre-existing `SDD_WORKFLOW_PATH`; all 3 new lazy files (`orchestrator-delegation.md`, `orchestrator-memory.md`, `orchestrator-skills.md`) have >=1 reachable pointer — no orphan. |
| No Normative Content Loss | PASS | Independently re-implemented the disposition sweep in Python (not the shipped test) against the frozen fixture (byte-identical to `git show HEAD:assets/orchestrator.md`, confirmed via `diff`): 194/194 normative lines matched verbatim in their assigned target file, 0 mismatches. Also confirmed the 24 "uncovered" fixture line numbers in the disposition map are all blank lines (no silently-skipped content). |
| Cache and Path Substitution Integrity | PASS | `assert.doesNotMatch(rendered, /\{\{/)` and memoization tests both pass; independently confirmed via direct `node --experimental-strip-types -e` invocation of `__testing.getOrchestratorPrompt()`. |
| No Double-Delivery of On-Demand Content | PASS | Independently verified: extracted the 5 largest relocated blocks (Work Routing body, Delegation table+triggers, Memory phases table, Skill detail, 4R body+REC) as raw byte slices and confirmed each is `in` its lazy file and NOT `in` the core file — 5/5 correct. |
| Existing Content Assertions Repointed, Not Deleted | PASS | Read the full diff of all 5 repointed test files (`artifact-language.test.ts`, `review-ledger-contract.test.ts`, `persona-single-channel.test.ts` x3 assertions, `runtime-harness.mjs`, `gentle-ai.test.ts:40`) — every diff only *widens* the read (adds `+ readFile(lazy-file)` to the union) and keeps the original assertion string/regex intact. No assertion was deleted, loosened, or had its target string weakened. |
| Measured Before/After Size Recorded | PASS | `wc -c` independently run: core 10,107 B (matches claim), delegation 12,928 B, memory 2,959 B, skills 3,388 B (all match apply-progress.md exactly). Fixture 23,047 B confirmed byte-identical to pre-change `HEAD:assets/orchestrator.md`. Method (`wc -c`, tokens≈bytes/4) stated. |
| Coordinated Relocation of Externally-Owned Content | PASS | Covered by the same disposition sweep — the frozen fixture already encodes the post-merge state of `persona-single-channel` and `port-review-ledger-contract` (confirmed fixture == HEAD, and HEAD is past both merges per the design's "Final re-baseline" section), and every fixture line including those sections is verbatim-preserved in core∪lazy. |

## 3. Arbitration: Byte Budget Requirement (explicitly requested)

**Question**: the spec ties the budget to `getOrchestratorPrompt()`'s *return value*; the design mandated a short-path-stub test methodology (JD-005) specifically to decouple the test from real path length; real paths push the return 100-150B over. Is the requirement met as written?

**Independent measurements (not trusted from apply-progress.md)**:

| Path | Substituted return (Buffer.byteLength) | vs 10,240 B budget |
|---|---:|---|
| Dev checkout (`/home/gentleman/work/gentle-pi`), measured directly via `__testing.getOrchestratorPrompt()` | **10,351 B** | **+111 B over** |
| Installed path (`~/.pi/agent/npm/node_modules/gentle-pi`), computed from actual placeholder-substitution arithmetic (raw core 10,107 B + per-occurrence path-length deltas for all 4 placeholders, cross-checked to within 1 B against the directly-measured dev figure) | **~10,506 B** | **~+266 B over** |

**Verdict: the requirement is NOT met as written for any real deployment path, and the apply-progress.md's own mitigating claim is factually wrong.**

Reasoning:
1. The spec's normative sentence explicitly names `getOrchestratorPrompt`'s return, not the raw core file. The raw core (10,107 B) does fit under budget with 133 B headroom — but that is not what the spec governs.
2. `tests/orchestrator-budget.test.ts`'s budget assertion runs exclusively against a `mkdtemp` short-path stub directory (~15 chars). By construction this test **can never fail** due to real deployment path length, only due to raw content growth. This means the "Budget regression caught" scenario ("a future edit that pushes the file over the budget... `pnpm test` MUST fail before merge") is satisfied only for content edits, not for the actual violation type observed here (path-length-driven overage on the governed quantity).
3. apply-progress.md's own risk note speculates: "If a shorter/typical install path is used... the real substituted return will normally fall under 10,240 B." I measured the actual installed package path (`~/.pi/agent/npm/node_modules/gentle-pi`) as instructed and found the opposite: it is **worse** than the dev checkout (~266 B over vs ~111 B over), because `node_modules` nesting is longer than a typical shallow dev checkout, and 3 of the 4 placeholders resolve to the same `orchestrator-delegation.md` path used 3 times (each occurrence multiplies the path-length cost). This directly contradicts the optimism used to justify treating the overage as "not a blocker."
4. No design amendment or spec carve-out was ever written to formalize this as an accepted deviation. It exists only as a prose paragraph in `apply-progress.md` ("Honest headroom note"), never sent back through judgment-day, and `review-ledger.md`'s Round 3 entries (all "verified"/APPROVED) predate this discovery — the ledger has no JD-011 or later entry addressing it.

**This is a CRITICAL finding**, not a WARNING: a normative requirement, read plainly, is unmet in every real environment tested, and the current test suite is structurally incapable of ever catching it (it always measures a synthetic stub, never the real deployment path). This is a genuine gap between "tests are green" and "the requirement is actually satisfied in production."

**Recommended resolution (for the orchestrator/user, not applied here)** — pick one, both require a small follow-up before archive:
- (a) Trim ~130-270 more raw bytes from the core (the design already flags the SDD Workflow pointer, 998 B, as the first trim target) to buy real headroom over the worst realistic path length, then re-measure the actual installed-path return; or
- (b) Formally amend the spec/design with a documented, judged path-length carve-out (e.g., redefine the budget as applying to raw core content, or add an explicit installed-path tolerance) and route it through a fresh judgment-day round, updating `review-ledger.md`.

Do not accept the current apply-progress.md prose note as a substitute for either — it is undocumented in the spec and contradicted by the installed-path measurement.

## 4. Design Coherence

- Fixture freeze order followed the design's hard merge-order commitment: `git show HEAD:assets/orchestrator.md` (23,047 B / 312 lines) matches the fixture exactly, and the design's "Final re-baseline (hard commitment executed, 2026-07-09, post-merge of all three prior changes)" section documents this state — consistent.
- Three lazy files by domain, verbatim-move decision, and placeholder wiring (`getDelegationPath/getMemoryPath/getSkillsPath` mirroring `getSddWorkflowPath`) all match the design's "Decision: Wire new placeholders into the existing cache" section — confirmed via `rg` against `extensions/gentle-ai.ts`.
- Test seam (JD-005: `GENTLE_PI_TEST_ASSETS_DIR` env override + `__testing.getOrchestratorPrompt` export) implemented exactly as specified — confirmed via `rg`.
- The only design-vs-reality gap is §3 above (budget-on-real-path), which the design's own Addendum implicitly anticipated risk for (JD-005's rationale) but never resolved to a real pass/fail commitment.

## 5. Task Completion

- `tasks.md`: 18 checkboxes total (17 originally planned + 1 explicitly-marked-discovered 5.2), **18/18 checked**.
- Cross-checked every phase against the actual working tree:
  - Phase 1 (seam): `ASSETS_DIR` env override and `__testing.getOrchestratorPrompt` export both present — confirmed via `rg`.
  - Phase 2 (RED tests): `tests/fixtures/orchestrator.pre-diet.md` and `tests/orchestrator-budget.test.ts` present with the claimed test counts.
  - Phase 3 (core + 3 lazy files): all 4 files exist with byte counts matching apply-progress.md exactly.
  - Phase 4 (wiring): 3 path getters + 3 `.replaceAll` calls confirmed in `extensions/gentle-ai.ts`.
  - Phase 5 (repoints): `tests/gentle-ai.test.ts:40` + 5 discovered repoints across 4 additional files, all diffs confirmed genuine (widened union reads, no weakening).
  - Phase 6 (measure/verify): byte table and `pnpm test` 306/306 result both independently reproduced.
- No unchecked tasks. No task claims contradicted by the filesystem.

## 6. Issues

### CRITICAL
1. **Byte budget requirement unmet on real return value in every measured deployment path** (dev: +111 B, installed npm path: ~+266 B) — see §3 for full arbitration. The passing test only proves the requirement holds in a synthetic short-path environment that will never occur in production. No formal spec/design carve-out exists; the only acknowledgment is an unjudged prose note in `apply-progress.md`. **Blocks clean archive** until either further core trimming closes the real-path gap or a judged spec/design carve-out is added.

### WARNING
None beyond the above.

### SUGGESTION
1. The memoization test (`tests/orchestrator-budget.test.ts` "memoizes the return across calls") uses `assert.equal` (value equality) rather than reference/call-count instrumentation. Since the function is deterministic given a fixed env, this is an acceptable proxy but does not technically prove "without re-reading the file from disk" per the spec's literal wording — low priority, does not block archive.
2. `apply-progress.md`'s "Deviations from Design" section documents deviations 1-3 well; consider adding the real-installed-path measurement (§3 of this report) as deviation 4, and routing it back through judgment-day, rather than leaving it as an inline risk note.

## 7. Summary

- Tests: 306/306 pass, runtime harness green, `pnpm test` exit 0 — independently reproduced.
- Byte-identical moves: 5/5 large blocks + 194/194 normative lines independently re-verified against the frozen fixture (itself confirmed byte-identical to pre-change HEAD).
- No double-delivery: independently confirmed for all 5 major relocated blocks.
- Test repoints: 6 assertions across 5 files independently diff-reviewed — all genuine widenings, none weakened or deleted.
- Tasks: 18/18 genuinely complete, matches filesystem state.
- Byte budget: **requirement violated on the real return value** in both measured real-world paths; this is the one blocking finding.
