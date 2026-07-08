# Tasks: Orchestrator Lazy Diet

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,500-1,900 (fixture copy ~312, 3 new lazy files ~350-450 combined, orchestrator.md rewrite ~300, new test suite ~150-200, seam +test-repoint ~40, apply-progress ~60) |
| 400-line budget risk | High |
| Chained PRs recommended | No — `exception-ok` accepted |
| Suggested split | Single PR, `size:exception` (below units aid review navigation only) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (single PR, ordered commits)

| Unit | Goal | Notes |
|------|------|-------|
| 1 | Seam + RED tests | tiny diff, isolates the failing-test commit |
| 2 | Core + 3 lazy files | bulk of the diff, verbatim moves |
| 3 | Wiring + repoint + measure | GREEN, closes the loop |

## Phase 1: Seam (Foundation)

- [x] 1.1 `extensions/gentle-ai.ts:52` — add `GENTLE_PI_TEST_ASSETS_DIR` env override: `const ASSETS_DIR = process.env.GENTLE_PI_TEST_ASSETS_DIR ?? join(PACKAGE_ROOT, "assets");`
- [x] 1.2 `extensions/gentle-ai.ts:2126` — add `getOrchestratorPrompt` to the `__testing` export object.

## Phase 2: RED — Failing Tests First

- [x] 2.1 Copy current `assets/orchestrator.md` (23,047 B / 312 lines) byte-for-byte to `tests/fixtures/orchestrator.pre-diet.md` — freeze baseline (Spec: No Normative Content Loss).
- [x] 2.2 Create `tests/orchestrator-budget.test.ts`. Test: set `GENTLE_PI_TEST_ASSETS_DIR` to a short fixture dir (stub `orchestrator.md` + 3 lazy files) before first call; `assert.ok(Buffer.byteLength(__testing.getOrchestratorPrompt(),"utf8") <= 10240)` — fails against current 23,047 B (Spec: Always-On Injection Byte Budget).
- [x] 2.3 Same file: disposition-mapped union test — extract frozen-fixture normative lines, assert each against its documented disposition (`CORE_VERBATIM` / `LAZY_VERBATIM` / `CORE_SUMMARIZED_INTO`, per design Appendix) instead of one blanket sweep (Spec: No Normative Content Loss + Pointer reachability).
- [x] 2.4 Same file: core-alone assertions on the raw core string (no lazy union) — "4-file rule", "400 changed lines", the 6 named Mandatory Delegation Trigger labels, and `review-risk`/`review-reliability`/`review-resilience`/`review-readability`.
- [x] 2.5 Same file: no-double-delivery test — full relocated bodies absent from `getOrchestratorPrompt()`'s return, only pointers/paths present (Spec: No Double-Delivery).
- [x] 2.6 Same file: cache/substitution tests — `assert.doesNotMatch(rendered, /\{\{/)`; two calls return the same string reference (Spec: Cache and Path Substitution Integrity).
- [x] 2.7 Run `pnpm test` — confirm 2.2-2.6 fail RED, nothing else broken. (35 new tests: 24 pass / 11 fail RED as expected; full suite 306 total, 295 pass / 11 fail, all 11 isolated to the new file.)

## Phase 3: Author Core + Lazy Files (GREEN, verbatim moves)

- [x] 3.1 Create `assets/orchestrator-delegation.md`: full Work Routing Ladder examples + Pi Subagent Model Routing, full Delegation Rules table + Mandatory Delegation Triggers detail + Cost/Context Balance + Canonical Workflows + Review Lens Selection, LB2/LB5 (Language Boundary extended), full 4R rationale + `lib/review-triggers.ts` note + verbatim `### Review Execution Contract` body from `:301-312` — byte-identical, no reflow.
- [x] 3.2 Create `assets/orchestrator-memory.md`: verbatim `### SDD phases` table + artifact keys + lifecycle rule from current Memory Contract.
- [x] 3.3 Create `assets/orchestrator-skills.md`: verbatim Skill Registry Protocol detail + Intent-Driven Skill Discovery body.
- [x] 3.4 Rewrite `assets/orchestrator.md` core using design Appendix drafted blocks, adjusted for the landed state: Identity Contract pointer (already landed, ~150 B, keep as-is), Language Boundary (LB1 pointer landed + LB3/LB4 verbatim in core + new LB2/LB5 pointer), Work Routing Ladder / Delegation Rules / Memory Contract / Skill Registry / Intent-Driven Skill Discovery / 4R Review Triggers condensed blocks, plus a condensed Review Execution Contract core rendering reconciled against the real `:301-312` text.

## Phase 4: Wire Placeholders

- [x] 4.1 `extensions/gentle-ai.ts:118-133` — add `getDelegationPath()/getMemoryPath()/getSkillsPath()` (mirror `getSddWorkflowPath`) and 3 `.replaceAll("{{GENTLE_PI_DELEGATION_PATH}}"…)` etc. calls inside the `orchestratorPromptCache` block.

## Phase 5: Repoint Regression Assertion

- [x] 5.1 `tests/gentle-ai.test.ts:40` — repoint ONLY the `assets/orchestrator.md` loop entry to read core + `assets/orchestrator-delegation.md` (union); leave `README.md` and `skills/gentle-ai/SKILL.md` entries unchanged.
- [x] 5.2 (discovered, not in original list) — repointed 5 more pre-existing whole-file assertions in `tests/artifact-language.test.ts`, `tests/review-ledger-contract.test.ts`, `tests/persona-single-channel.test.ts` (x3), and `tests/runtime-harness.mjs` that also asserted on `assets/orchestrator.md` content moved to lazy files — see apply-progress.md Deviations.

## Phase 6: Measure and Verify

- [x] 6.1 Re-measure `wc -c` on core, all 3 lazy files, and `getOrchestratorPrompt()`'s substituted return; record before (23,047 B) / after bytes, delta, and method (`Buffer.byteLength`; tokens ≈ bytes/4) in `apply-progress.md`.
- [x] 6.2 Run `pnpm test` full suite — confirm 271 baseline + new tests (2.2-2.6, repointed 5.1) all pass GREEN. (306/306 unit+integration + runtime harness, all green.)
