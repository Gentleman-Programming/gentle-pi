# Design: Orchestrator Lazy Diet

## Technical Approach

Split always-on `assets/orchestrator.md` into a thin core plus three path-substituted lazy reference files, reusing the proven `{{...PATH}}` + single-cache pattern already used for `{{GENTLE_PI_SDD_WORKFLOW_PATH}}` in `getOrchestratorPrompt` (`extensions/gentle-ai.ts:123-133`). Core keeps only every-turn load-bearing rules as terse summaries + pointers; each split section moves **verbatim** into its lazy file so nothing normative is lost. Drift is locked by two Node `node:test` suites under `pnpm test`: a byte-budget test and a frozen-fixture union test. Maps to proposal capability `orchestrator-prompt-budget`.

## Inventory (measured, wc -c)

Method: `awk 'NR>=a && NR<=b' assets/orchestrator.md | wc -c` per section line-range, self-verified against the exact **22,626 B** file total (`wc -c assets/orchestrator.md`; sum of the rows below reconciles exactly, no rounding). These are the judges' verified figures — not back-fit estimates. Core byte figures are DRAFTED text, measured with the same method; see "Core Budget (rebuilt, measured)" below for the actual condensed wording.

| Section (lines) | Bytes (measured, wc -c) | Disposition | Core→ / Lazy→ |
|---|---:|---|---|
| Header + bind (1-4) | 117 | Core (full) | core |
| Identity Contract (5-21) | 831 | Core (pointer, JD-003) | core ~149 — VERBATIM reuse of persona-single-channel's delivered pointer text; content-final, never re-edited |
| Core Role (22-27) | 349 | Core (full) | core |
| Language Boundary (28-43) | 2,118 | Split (JD-008) | core ~1,459 — LB1 pointer VERBATIM reuse of persona-single-channel's delivered text + LB3/LB4 (artifact/comment-language) kept VERBATIM in core, not lazy (a delegation-scoped lazy file may never be read during Inline Direct work) / delegation.md verbatim (LB2 subagent-English + LB5 exceptions) |
| Mental Model (44-54) | 571 | Core (full) | core |
| Work Routing Ladder (55-124) | 3,742 | Split | core ~1,274 (condensed 3-tier summary, drafted + measured) / delegation.md verbatim (full examples, Pi Subagent Model Routing) |
| Delegation Rules (125-195) | 5,493 | Split | core ~1,344 (condensed core question + 6 named Mandatory Delegation Triggers + pointer, drafted + measured) / delegation.md verbatim (table, Cost and Context Balance, Canonical Workflows, Review Lens Selection detail) |
| SDD Workflow pointer (196-205) | 998 | Core (unchanged) | core — already terse; largest single core block, first trim target if core creeps further |
| Memory Contract (206-244) | 3,609 | Split | core ~785 (intro + Non-SDD delegation kept VERBATIM + pointer, drafted + measured) / memory.md verbatim (SDD phase table, artifact keys, lifecycle rule) |
| Skill Registry Protocol (245-267) | 1,628 | Split | core ~663 (condensed resolve-once + pointer, drafted + measured) / skills.md verbatim |
| Intent-Driven Skill Discovery (268-290) | 1,498 | Split | core ~288 (pointer only, drafted + measured) / skills.md verbatim |
| Safety (291-297) | 286 | Core (full) | core |
| 4R Review Triggers (298-313) | 1,386 | Split | core ~788 (condensed gate semantics + 4 lens names + pointer, drafted + measured); content owned by port-review-ledger-contract / delegation.md verbatim (full rationale, `lib/review-triggers.ts` detail) |
| **Total** | **22,626** | | |

### Reserved: incoming Review Execution Contract (JD-004)

`port-review-ledger-contract` merges BEFORE this change (see Merge-order dependency below) and adds a new "Review Execution Contract" subsection to `assets/orchestrator.md` (its design.md:99: persistence branches only, no inline-mode clause, authored location-agnostic). That subsection is NOT part of the 22,626 B baseline above and has ZERO reserved headroom in the original budget. Bounded estimate from that change's design.md:117-126 (persistence-branches prose: openspec/engram/none bullets + the `none`-compaction caveat): **~750-900 B**, drafted and measured at ~755 B for a representative condensed rendering. This row is included in the Core Budget total below.

Hard commitment: the budget MUST be re-verified with `wc -c` against the actual rebased `assets/orchestrator.md` (post persona-single-channel, post port-review-ledger-contract) before the frozen fixture (`tests/fixtures/orchestrator.pre-diet.md`) is frozen. If the landed Review Execution Contract subsection differs from this estimate, update this table and the Core Budget total before proceeding to RED tests.

## Architecture Decisions

### Decision: Verbatim-to-lazy, fresh-summary-in-core
**Choice**: Every split section is copied **whole and unaltered** into its lazy file; core gets a newly written terse summary + pointer.
**Alternatives**: (a) condense in core with no lazy copy — loses normative lines; (b) move raw, no core summary — kills every-turn guidance.
**Rationale**: Guarantees the union invariant (fixture lines ⊆ core∪lazy) while the always-on cost is only the terse core. The intentional duplication costs nothing at runtime because lazy files load only on trigger.
**Byte-identical constraint (JD-010)**: lazy copies are byte-identical to the frozen-fixture source lines — no reflow, rewrapping, or markdown re-formatting during the move. The union test compares raw line bytes, not semantic equivalence, so any accidental re-format of a moved line is a normative-line-lost failure.

### Decision: Three lazy files by domain
**Choice**: `orchestrator-delegation.md` (routing detail, full delegation triggers, cost/canonical, Review Lens + 4R, Language extended detail), `orchestrator-memory.md` (SDD phase table, artifact keys, lifecycle), `orchestrator-skills.md` (registry detail + intent discovery).
**Alternatives**: one combined lazy file; one-file-per-section (7+).
**Rationale (require_tradeoffs)**: | Option | Load latency | Always-on cost | Placeholders |
|---|---|---|---|
| 1 file | 1 read, over-fetch unrelated detail | same | 1 |
| 3 files (chosen) | read only the triggered domain | same | 3 |
| 7+ files | minimal per-read | same | 7+, high wiring/test surface |
Three domains match the actual trigger boundaries (delegate / remember / skill-resolve) so a trigger loads only relevant bytes, without the wiring and cache-substitution surface of per-section files. Language extended detail folds into delegation.md because subagent-output language is a delegation-output concern.

### Decision: Core budget rebuilt from measured drafts — revised threshold ≤10,240 B (JD-002)

**Method**: every "Split" core row below is an actually-drafted condensed text (not an aspirational estimate), measured with `Buffer.byteLength`/`wc -c` the same way as the Inventory. Pointer-sentence bytes are NOT a separate add-on line item — each is already included inside its row's measured total (the pointer sentence is the last paragraph of that row's drafted text).

| Core row | Bytes (drafted, measured) | Basis |
|---|---:|---|
| Header + bind | 117 | unchanged, full |
| Identity Contract | 149 | persona-single-channel's delivered pointer, verbatim |
| Core Role | 349 | unchanged, full |
| Language Boundary | 1,459 | persona's LB1 pointer (verbatim) + LB3 + LB4 (verbatim, JD-008) + new LB2/LB5 pointer |
| Mental Model | 571 | unchanged, full |
| Work Routing Ladder | 1,274 | condensed 3-tier summary + pointer |
| Delegation Rules | 1,344 | core question + 6 named Mandatory Delegation Triggers + pointer (table/cost/canonical/Review-Lens-detail move to lazy) |
| SDD Workflow pointer | 998 | unchanged, already terse |
| Memory Contract | 785 | intro + Non-SDD delegation (verbatim) + pointer |
| Skill Registry Protocol | 663 | condensed resolve-once + pointer |
| Intent-Driven Skill Discovery | 288 | pointer only |
| Safety | 286 | unchanged, full |
| 4R Review Triggers | 788 | condensed gate semantics + 4 lens names + pointer |
| **Subtotal (13 rows)** | **9,071** | |
| Review Execution Contract (reserved, JD-004) | 755 | bounded estimate, see Inventory reserved row |
| **Core total** | **9,826** | |

**Choice**: The original ≤8,192 B threshold does NOT close — the honestly-drafted core totals **9,826 B**, 1,634 B (≈20%) over. Revise the budget threshold to **≤10,240 B (10 KB)**, giving ~414 B headroom over the measured 9,826 B for wording variance during the actual RED→GREEN apply pass.

**Rationale**: Two corrections drive the overage past the original aspirational 7.8-7.9 KB: (1) JD-008's resolution keeps LB3/LB4 fully verbatim in core (+~1.1 KB versus the original ~350 B Language Boundary guess), because a delegation-scoped lazy file may never be read during Inline Direct work and these are every-turn artifact/comment-language rules; (2) JD-007's core-alone assertion requirement means the Delegation Rules and 4R rows must carry the actual Mandatory Delegation Trigger names and the 4 lens names as real text, not a hand-waved "~1,600 B checklist" — the honestly condensed versions measure 1,344 B and 788 B respectively, both larger than the original guesses. Even at the revised 10,240 B, this is still a **56.6% reduction** from the 22,626 B baseline (22,626 → 9,826), and the always-on token cost drops from ~5,657 tokens to ~2,457 tokens (bytes/4 estimate) — a real diet, just not the original 8,192 B target. If a future change needs the original 8,192 B, the SDD Workflow pointer (998 B, the largest single unchanged core block) is the first trim target, not headroom already spent here.

### Decision: Wire new placeholders into the existing cache
**Choice**: Add `getDelegationPath()/getMemoryPath()/getSkillsPath()` and three `.replaceAll("{{GENTLE_PI_DELEGATION_PATH}}"…)` etc. calls inside the existing `orchestratorPromptCache` block; cache stays a single trimmed string.
**Rationale**: Reuses the working substitution+cache; no behavior change beyond content.

## Data Flow

    buildGentlePrompt(persona)
       └─(:200)─ getOrchestratorPrompt()  ← cached once
                    readFileSync(orchestrator.md)
                    .replaceAll {{SDD_WORKFLOW}} , {{DELEGATION}} , {{MEMORY}} , {{SKILLS}}
                    → thin core injected always-on
    on trigger → orchestrator reads assets/orchestrator-{delegation,memory,skills}.md

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `assets/orchestrator.md` | Modify | slim to thin core; add 3 lazy pointers |
| `assets/orchestrator-delegation.md` | Create | routing/delegation/review/language detail (verbatim) |
| `assets/orchestrator-memory.md` | Create | memory phase table + keys + lifecycle (verbatim) |
| `assets/orchestrator-skills.md` | Create | skill registry + intent discovery (verbatim) |
| `extensions/gentle-ai.ts` (:119-133) | Modify | 3 path getters + 3 substitutions in cache block |
| `tests/orchestrator-budget.test.ts` | Create | byte-budget + frozen-fixture union tests |
| `tests/fixtures/orchestrator.pre-diet.md` | Create | frozen post-dedup baseline |
| `tests/gentle-ai.test.ts` (:40) | Modify | review-lens assertion reads core + delegation ref (union) |

## Interfaces / Contracts

Pointer wording per moved section is embedded as the closing paragraph of each condensed core row in "Core Budget (rebuilt, measured)" above (not restated here, to avoid two drifting copies of the same sentence). Each pointer names its lazy path placeholder (`{{GENTLE_PI_DELEGATION_PATH}}`, `{{GENTLE_PI_MEMORY_PATH}}`, `{{GENTLE_PI_SKILLS_PATH}}`) and, for Delegation/Work Routing/4R, the concrete content that moved (table, examples, cost/context balance, canonical workflows, Review Lens Selection detail, `lib/review-triggers.ts` detail). Mirrors the SDD pointer pattern at :196-202.

## Testing Strategy (strict TDD, `pnpm test`)

| Layer | What | Approach |
|---|---|---|
| Unit | Byte budget (JD-005) | Budget applies to `getOrchestratorPrompt()`'s RETURN value, not the raw file — the raw file still has unresolved `{{...PATH}}` placeholders, and substituted paths add real bytes. Stub `ASSETS_DIR`/cwd so the three new placeholders resolve to short fixture paths, then `assert.ok(Buffer.byteLength(getOrchestratorPrompt(), "utf8") <= 10240)` — RED before split |
| Unit | Union (nothing lost) | freeze `tests/fixtures/orchestrator.pre-diet.md`; extract normative lines (non-blank, trimmed, skip pure ``` fences/`|---|` separators); `union = core + 3 lazy`; per-line `assert.ok(union.includes(line), \`normative line lost: ${line}\`)` — loud per-rule failure |
| Unit | Core-alone load-bearing assertions (JD-007) | In ADDITION to the union sweep (which only proves nothing is fully lost, not core-summary quality): assert load-bearing tokens — "4-file rule", "400 changed lines", the 6 named Mandatory Delegation Trigger labels, and the 4 lens names (`review-risk`, `review-reliability`, `review-resilience`, `review-readability`) — are present in CORE ALONE (core string, no lazy union). Adopt disposition-mapped per-rule assertions (persona-single-channel's pattern): each frozen normative line asserts against its OWN documented disposition (`CORE_VERBATIM` / `LAZY_VERBATIM` / `CORE_SUMMARIZED_INTO`) instead of one blanket union-includes sweep |
| Unit | Substitution/cache | render `getOrchestratorPrompt()`; `assert.doesNotMatch(rendered, /\{\{/)`; call twice → same reference (cache) |
| Regression | `tests/gentle-ai.test.ts:40` (JD-006) | `:40` iterates 3 files (README, `orchestrator.md`, gentle-ai `SKILL.md`) in a uniform loop; ONLY the `orchestrator.md` iteration is repointed to read core + the referenced delegation ref (union) — the README and gentle-ai `SKILL.md` iterations are unchanged. Assert the four `review-*` names + `Review Lens Selection|review lens` appear in the `orchestrator.md` union, keep the forbidden-generic-route checks |

RED→GREEN order: (1) freeze fixture, (2) add budget+union+core-alone tests RED, (3) extract sections verbatim to lazy + slim core + wire placeholders GREEN, (4) repoint the `orchestrator.md` entry of `:40`.

## Migration / Rollout

No data migration. Prompt assets + tests only. Rollback = revert commit: restore single `orchestrator.md`, delete lazy files, drop the three placeholders.

**Merge-order dependency (hard):**
1. `persona-single-channel` merges FIRST — dedupes Identity Contract + Language Boundary against the `buildGentlePrompt` wrapper; those regions are content-final after it lands (core carries ZERO identity/persona/language bytes — see Core Budget Decision). Required for budget feasibility.
2. `port-review-ledger-contract` — finalizes 4R / Review Lens content verbatim, and adds the new Review Execution Contract subsection (reserved row above).
3. `orchestrator-lazy-diet` LAST — rebase onto both, THEN freeze the fixture (post-dedup, post-review) and relocate. Freezing before step 1 would bake duplicated content into the union baseline.

This three-way order is corroborated independently by `port-review-ledger-contract/design.md:202-207` ("Sequencing / Coordination": lands AFTER `persona-single-channel` and BEFORE `orchestrator-lazy-diet`) — the persona→ledger middle link asserted here is no longer this design's claim alone (JD-009).

## Open Questions

- [x] Does `port-review-ledger-contract` keep the four lens names in core or move them fully to lazy? ANSWERED by `port-review-ledger-contract/design.md:211-219`: the four `review-*` lens names STAY in the orchestrator core summary (its `tests/gentle-ai.test.ts:40` union assertion depends on their presence there). This design's 4R core row (788 B) and Delegation core row (1,344 B) both carry the four names accordingly.
- [ ] Confirm final core total after both dependencies actually land (target: within ~414 B headroom of the revised 10,240 B threshold — re-verify with `wc -c` per the Reserved-row hard commitment above).
