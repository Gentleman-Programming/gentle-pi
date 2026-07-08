# Design: Orchestrator Lazy Diet

## Technical Approach

Split always-on `assets/orchestrator.md` into a thin core plus three path-substituted lazy reference files, reusing the proven `{{...PATH}}` + single-cache pattern already used for `{{GENTLE_PI_SDD_WORKFLOW_PATH}}` in `getOrchestratorPrompt` (`extensions/gentle-ai.ts:123-133`). Core keeps only every-turn load-bearing rules as terse summaries + pointers; each split section moves **verbatim** into its lazy file so nothing normative is lost. Drift is locked by two Node `node:test` suites under `pnpm test`: a byte-budget test and a frozen-fixture union test. Maps to proposal capability `orchestrator-prompt-budget`.

## Inventory (measured, wc -c)

Method: `awk 'NR>=a && NR<=b' assets/orchestrator.md | wc -c` per section line-range, self-verified against the exact **22,626 B** file total (`wc -c assets/orchestrator.md`; sum of the rows below reconciles exactly, no rounding). These are the judges' verified figures — not back-fit estimates. Core byte figures are DRAFTED text, measured with the same method; see "Core Budget (rebuilt, measured)" below for the actual condensed wording.

| Section (lines) | Bytes (measured, wc -c) | Disposition | Core→ / Lazy→ |
|---|---:|---|---|
| Header + bind (1-4) | 117 | Core (full) | core |
| Identity Contract (5-21) | 831 | Core (pointer, JD-003) | core 148 — VERBATIM reuse of persona-single-channel's delivered pointer text; content-final, never re-edited; see Appendix |
| Core Role (22-27) | 349 | Core (full) | core |
| Language Boundary (28-43) | 2,118 | Split (JD-008) | core 1,393 — LB1 pointer VERBATIM reuse of persona-single-channel's delivered text + LB3/LB4 (artifact/comment-language) kept VERBATIM in core, not lazy (a delegation-scoped lazy file may never be read during Inline Direct work) / delegation.md verbatim (LB2 subagent-English + LB5 exceptions); see Appendix |
| Mental Model (44-54) | 571 | Core (full) | core |
| Work Routing Ladder (55-124) | 3,742 | Split | core 1,196 (condensed 3-tier summary, drafted + measured) / delegation.md verbatim (full examples, Pi Subagent Model Routing); see Appendix |
| Delegation Rules (125-195) | 5,493 | Split | core 1,468 (condensed core question + 6 named Mandatory Delegation Triggers + pointer, drafted + measured) / delegation.md verbatim (table, Cost and Context Balance, Canonical Workflows, Review Lens Selection detail); see Appendix |
| SDD Workflow pointer (196-205) | 998 | Core (unchanged) | core — already terse; largest single core block, first trim target if core creeps further |
| Memory Contract (206-244) | 3,609 | Split | core 951 (intro + Non-SDD delegation kept VERBATIM + pointer, drafted + measured) / memory.md verbatim (SDD phase table, artifact keys, lifecycle rule); see Appendix |
| Skill Registry Protocol (245-267) | 1,628 | Split | core 720 (condensed resolve-once + pointer, drafted + measured) / skills.md verbatim; see Appendix |
| Intent-Driven Skill Discovery (268-290) | 1,498 | Split | core 350 (pointer only, drafted + measured) / skills.md verbatim; see Appendix |
| Safety (291-297) | 286 | Core (full) | core |
| 4R Review Triggers (298-312) | 1,386 | Split | core ~825 (condensed gate semantics + 4 lens names + pointer, drafted + measured — see Appendix); content owned by port-review-ledger-contract / delegation.md verbatim (full rationale, `lib/review-triggers.ts` detail) |
| **Total** | **22,626** | | |

### Reserved: incoming Review Execution Contract (JD-004)

`port-review-ledger-contract` merges BEFORE this change (see Merge-order dependency below) and adds a new "Review Execution Contract" subsection to `assets/orchestrator.md` (its design.md:99: persistence branches only, no inline-mode clause, authored location-agnostic). That subsection is NOT part of the 22,626 B baseline above and has ZERO reserved headroom in the original budget. Bounded estimate from that change's design.md:117-126 (persistence-branches prose: openspec/engram/none bullets + the `none`-compaction caveat): originally estimated **~750-900 B**; now drafted and measured (see "Appendix: drafted core texts (measured)") at **573 B** for a representative condensed rendering — under the original bound because the representative rendering omits that change's surrounding narrative prose (chain-transport reconciliation, cross-references) and keeps only the three persistence-branch bullets. This row is included in the Core Budget total below; it MUST be re-verified against the real landed subsection per the hard commitment below, since 573 B is a rendering of THIS design's own condensation, not the other change's actual prose.

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

**Method**: every "Split" core row below is an actually-drafted condensed text — the literal prose is written out, word for word, in "Appendix: drafted core texts (measured)" below — not an aspirational estimate. Each drafted block was written to a scratch file and measured with `wc -c` (cross-checked against `Buffer.byteLength` semantics: plain ASCII/UTF-8 markdown, no multi-byte characters in any drafted block, so the two methods agree). Pointer-sentence bytes are NOT a separate add-on line item — each is already included inside its row's measured total (the pointer sentence is the last paragraph of that row's drafted text in the Appendix).

| Core row | Bytes (drafted, measured) | Basis |
|---|---:|---|
| Header + bind | 117 | unchanged, full (untouched source bytes) |
| Identity Contract | 148 | persona-single-channel's delivered pointer, verbatim — see Appendix |
| Core Role | 349 | unchanged, full (untouched source bytes) |
| Language Boundary | 1,393 | persona's LB1 pointer (verbatim) + LB3 + LB4 (verbatim, JD-008) + new LB2/LB5 pointer — see Appendix |
| Mental Model | 571 | unchanged, full (untouched source bytes) |
| Work Routing Ladder | 1,196 | condensed 3-tier summary + pointer — see Appendix |
| Delegation Rules | 1,468 | core question + condensed table + 6 named Mandatory Delegation Triggers + pointer — see Appendix |
| SDD Workflow pointer | 998 | unchanged, already terse (untouched source bytes) |
| Memory Contract | 951 | intro + Non-SDD delegation (verbatim) + pointer — see Appendix |
| Skill Registry Protocol | 720 | condensed resolve-once + pointer — see Appendix |
| Intent-Driven Skill Discovery | 350 | pointer only — see Appendix |
| Safety | 286 | unchanged, full (untouched source bytes) |
| 4R Review Triggers | 825 | condensed gate semantics + 4 lens names + pointer — see Appendix |
| **Subtotal (13 rows)** | **9,372** | |
| Review Execution Contract (reserved, JD-004) | 573 | bounded representative rendering, measured — see Appendix |
| **Core total** | **9,945** | |

**Honesty note on individual-row overages**: measured against the previous round's estimates, Delegation Rules (+124 B), Memory Contract (+166 B, driven entirely by the VERBATIM Non-SDD-delegation bullets, which cannot be shortened without losing normative content), Skill Registry Protocol (+57 B), Intent-Driven Skill Discovery (+62 B), and 4R Review Triggers (+37 B) all busted their prior per-row allocation once actually drafted. These overages are offset by Work Routing Ladder (−78 B), Language Boundary (−66 B), Identity Contract (−1 B), and — the largest single offset — the Review Execution Contract reserved row coming in **182 B under** its bounded estimate (573 B actual vs. 755 B estimate). Net: the 13-row subtotal rose from the previous round's 9,071 B estimate to a measured 9,372 B (+301 B), but the Core total including the reserved row rose only from 9,826 B to 9,945 B (+119 B), because the reserved-row saving absorbed most of the per-row growth.

**Choice**: The original ≤8,192 B threshold does NOT close — the honestly-drafted core totals **9,945 B**. Revise the budget threshold to **≤10,240 B (10 KB)**, giving **295 B** headroom over the measured 9,945 B for wording variance during the actual RED→GREEN apply pass. If that headroom proves too tight once `port-review-ledger-contract` lands its real (non-representative) Review Execution Contract subsection, the SDD Workflow pointer (998 B, the largest single unchanged core block) is the first trim target.

**Rationale**: Two corrections drive the actual measured total above the pre-drafting estimates: (1) JD-008's resolution keeps LB3/LB4 fully verbatim in core, because a delegation-scoped lazy file may never be read during Inline Direct work and these are every-turn artifact/comment-language rules; (2) JD-007's core-alone assertion requirement means the Delegation Rules and 4R rows must carry the actual Mandatory Delegation Trigger names and the 4 lens names as real text, not a hand-waved checklist — both measured larger than the pre-drafting guesses once actually written out (see Appendix). Even so, the measured 9,945 B is still a **≈56.0% reduction** from the 22,626 B baseline (22,626 → 9,945; (22,626 − 9,945) / 22,626 ≈ 0.5605), and the always-on token cost drops from ≈5,657 tokens to ≈2,486 tokens (bytes/4 estimate) — a real diet, just not the original 8,192 B target.

## Appendix: drafted core texts (measured)

Every "Split" core row in the table above is reproduced here VERBATIM as drafted — this is the literal text that will be written into the slimmed `assets/orchestrator.md`, not a paraphrase or a re-description of it. Each block was written to its own file and measured with `wc -c`; the byte count in the fence label is that file's exact `wc -c` output for the block's raw text (the fence delimiters themselves are not part of the measured content). `{{GENTLE_PI_DELEGATION_PATH}}`, `{{GENTLE_PI_MEMORY_PATH}}`, and `{{GENTLE_PI_SKILLS_PATH}}` are the placeholders substituted by `getOrchestratorPrompt()` per the existing `{{...PATH}}` pattern (Decision: Wire new placeholders into the existing cache, below).

### Identity Contract — 148 B (bonus: already fully specified by persona-single-channel, reproduced here for completeness)

```text
## Identity Contract

Defined once in the identity/harness section injected above (the `Current persona mode:` line). Honor it; do not restate here.
```

### Language Boundary — 1,393 B

```text
## Language Boundary

Reply-language style and the active persona's Spanish variant are defined once in the identity/harness section above (its `Current persona mode:` line). The rules below are delegation/artifact-scoped and not restated there:

Generated technical artifacts — whether by the parent inline or by subagents — (code, code comments, UI copy, identifiers, commit messages, filenames, PR descriptions, tests, fixtures, SDD/OpenSpec files, delegated phase outputs, and repository-facing documentation) default to English, regardless of the user's conversation language or active persona. Override only when the user explicitly requests another language for that artifact, or when extending a project whose existing convention is non-English.

Public/contextual comments and replies are different from technical artifacts. When using `comment-writer` or drafting a human-facing GitHub, PR review, Slack, Discord, or async comment, write in the target context language by default. Spanish issue/thread -> Spanish comment. English thread -> English comment. Mixed context -> target message language. Explicit user language or tone override wins. Spanish comments default to neutral/professional Spanish unless the user or target context clearly calls for regional tone.

Subagent-facing English delegation and the quote/UI/SDD-artifact exceptions: `{{GENTLE_PI_DELEGATION_PATH}}`.
```

The first paragraph above is the LB1 pointer, reused verbatim from persona-single-channel's delivered "orchestrator.md `## Language Boundary`" pointer text. The second and third paragraphs are LB3 (`orchestrator.md:34`, artifact-English) and LB4 (`orchestrator.md:36`, public-comment language), kept byte-identical to source per the JD-010 byte-identical-move constraint. The closing pointer sentence is new (this design's own text), routing LB2 (subagent-English, `orchestrator.md:32`) and LB5 (exceptions, `orchestrator.md:38-42`) to `orchestrator-delegation.md`.

### Work Routing Ladder — 1,196 B

```text
## Work Routing Ladder

Route work through the smallest harness that is safe. Three tiers:

1. **Inline Direct** — small, mechanical, parent already has enough context (typo, one-file edit, 1-3-file verification, bash for state). No SDD ceremony; do not delegate to look sophisticated, but do not hide behind this once the task stops being small.
2. **Simple Delegation** — inflates parent context, or needs focused exploration/validation/multi-file implementation, short of a full SDD lifecycle. Prefer `subagent_*` tools; use `mode: "task"` when the parent must consume the result and continue, `mode: "background"` only for independent work. Fall back to Pi's native `Agent` tool if `subagent_*` is unavailable — delegation stays mandatory, only the runtime changes. Do not pass `model` for generic subagents unless the user explicitly asks for an override.
3. **SDD** — large, ambiguous, architectural, product-facing, multi-area, or high-review-risk work, or an explicit `/sdd-new`/`/sdd-ff`/`/sdd-continue` request. Do not jump to implementation; create artifacts and gate for approval.

Full examples, model-routing detail, and canonical workflows: `{{GENTLE_PI_DELEGATION_PATH}}`.
```

### Delegation Rules — 1,468 B

```text
## Delegation Rules

Core question: does this inflate parent context without need?

| Action | Inline | Delegate |
|---|---:|---:|
| Read to decide/verify 1-3 files | yes | no |
| Read to explore/understand 4+ files | no | yes |
| Write atomic one-file mechanical change | yes | no |
| Write with analysis across multiple files | no | yes |
| Bash for state (e.g. git status) | yes | no |
| Bash for execution (tests/builds) | no | yes |
| Commit/push/PR after code changes | no | yes, fresh review first |

Mandatory Delegation Triggers — stop rules; once fired, delegate through the best available subagent runtime (prefer `subagent_run`, else Pi's native `Agent`):

1. **4-file rule** — 4+ files to understand → delegate a scout/mapping task.
2. **Multi-file write rule** — 2+ non-trivial files touched → delegate one writer.
3. **PR rule** — before commit/push/PR, run a fresh-context review lens unless trivial docs/text.
4. **Incident rule** — after a wrong cwd/worktree/git/tooling incident, run a fresh audit first.
5. **Long-session rule** — ~20 tool calls, 5 exploratory reads, or 2 non-mechanical edits without delegation → pause and delegate.
6. **Fresh review rule** — fresh-context review lenses for diffs/conflicts/PR readiness/incidents; continuity workers only for implementation needing inherited state.

Full table, Cost and Context Balance, Canonical Workflows, and Review Lens Selection detail: `{{GENTLE_PI_DELEGATION_PATH}}`.
```

The condensed table above deliberately drops the 9-row source table's 2 orchestration-flavor rows ("Read as preparation for multi-file writing", "Recover from wrong cwd/worktree/git/tooling incident" — the latter is already carried in prose by the Incident rule) to 7 rows; the full 9-row table stays verbatim in `orchestrator-delegation.md`.

### Memory Contract — 951 B

```text
## Memory Contract

When Engram or another callable memory package is available, the parent owns context selection and subagents own write-back. Retrieval rules differ by task type, matching the gentle-ai (OpenCode) contract.

### Non-SDD delegation

- Read context: the parent/orchestrator searches memory (the injected Engram search tool), selects relevant observations, and passes them into the subagent prompt. The subagent does NOT search memory itself.
- Write context: the subagent MUST save significant discoveries, decisions, or bug fixes via the injected Engram save tool before returning when memory tools are available.
- Prompt forwarding: when delegating, add a concrete instruction such as: `If you make important discoveries, decisions, or fix bugs, save them to Engram via the available memory save tool with project: '<project>' before returning.`

SDD phase table, artifact keys, and the lifecycle rule: `{{GENTLE_PI_MEMORY_PATH}}`.
```

The `### Non-SDD delegation` heading and its three bullets are byte-identical to `orchestrator.md:210-214` (JD-010 byte-identical-move constraint); only the one-line intro and the closing pointer are this design's own text.

### Skill Registry Protocol — 720 B

```text
## Skill Registry Protocol

The parent resolves skills once per session or before first delegation: read `.atl/skill-registry.md` if present, match task context/target files against the `Trigger / description` column, and pass only matching `Path` values to subagents under `## Skills to load before work`. Subagents must read those exact `SKILL.md` files before reading, writing, reviewing, testing, or creating artifacts, and should not have to rediscover the registry. If the registry is absent, continue but say project-specific skill paths were unavailable.

Fallback-report semantics (`paths-injected`/`fallback-registry`/`fallback-path`/`none`) and the SDD-executor skill distinction: `{{GENTLE_PI_SKILLS_PATH}}`.
```

### Intent-Driven Skill Discovery — 350 B

```text
## Intent-Driven Skill Discovery

For skill-shaped requests, do not treat injected `<available_skills>` as complete; use the registry/filesystem only as a discovery aid, never to override a small request or a user's concrete ask. Discovery order, the common intent-hint table, and fallback behavior when no skill matches: `{{GENTLE_PI_SKILLS_PATH}}`.
```

### 4R Review Triggers — 825 B

```text
## 4R Review Triggers

`extensions/gentle-ai.ts` gates `bash` calls that look like git/gh workflow events. **pre-commit**/**pre-push**: advisory only — notify to consider `review-readability`, do not block. **pre-pr** (`gh pr create`): strong gate — blocks when changed paths match hot globs (`**/auth/**`, `**/update/**`, `**/security/**`, `**/payments/**`) or the diff exceeds 400 changed lines; the reason names all four agents to run first. **post-sdd-phase** (design, apply): strong gate for `judgment-day`, handled by SDD phase orchestration.

When blocked, launch the `4r-review` chain or run `review-risk`, `review-reliability`, `review-resilience`, `review-readability` individually and wait for their reports before retrying.

Full rationale and `lib/review-triggers.ts` detail: `{{GENTLE_PI_DELEGATION_PATH}}`.
```

The four lens names required by the JD-007 core-alone assertion (`review-risk`, `review-reliability`, `review-resilience`, `review-readability`) are present verbatim in the second paragraph.

### Reserved: Review Execution Contract — representative rendering, 573 B

Bounded from `port-review-ledger-contract/design.md`'s "Ledger persistence branches (Pi stores)" prose (its Interfaces / Contracts section). This is a REPRESENTATIVE rendering for budget purposes — the actual landed subsection is authored by that change and may differ in wording (its own design explicitly states the content is "authored location-agnostic"); the Reserved-row hard commitment (Inventory, above) still requires re-verifying with `wc -c` against the real landed subsection before the fixture freeze.

```text
## Review Execution Contract

**Ledger persistence branches (Pi stores).**
- `openspec`: write `openspec/changes/{change-name}/review-ledger.md`.
- `engram`: upsert topic `sdd/{change-name}/review-ledger`; ad-hoc JD without a change → `review/{target-slug}/ledger` (`target-slug` = `pr-{number}` for a PR review, else the branch name kebab-cased, else a kebab-case slug of the user-stated target).
- `none`: keep the ledger inline; do NOT write files/Engram; complete the review → fix → re-review loop within the session because it is not persisted across compaction.
```

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
| `extensions/gentle-ai.ts` (:119-133) | Modify | 3 path getters + 3 substitutions in cache block; add `getOrchestratorPrompt` to the `__testing` export object (:2125-2136); add a `GENTLE_PI_TEST_ASSETS_DIR` env-var override at the `ASSETS_DIR` definition (:52) so tests can stub short fixture paths (JD-005 test seam) |
| `tests/orchestrator-budget.test.ts` | Create | byte-budget + frozen-fixture union tests |
| `tests/fixtures/orchestrator.pre-diet.md` | Create | frozen post-dedup baseline |
| `tests/gentle-ai.test.ts` (:40) | Modify | review-lens assertion reads core + delegation ref (union) |

## Interfaces / Contracts

Pointer wording per moved section is the literal closing sentence of each drafted block in "## Appendix: drafted core texts (measured)" (not restated here, to avoid two drifting copies of the same sentence — the Core Budget table above holds only byte counts and basis notes, not the text itself). Each pointer names its lazy path placeholder (`{{GENTLE_PI_DELEGATION_PATH}}`, `{{GENTLE_PI_MEMORY_PATH}}`, `{{GENTLE_PI_SKILLS_PATH}}`) and, for Delegation/Work Routing/4R, the concrete content that moved (table, examples, cost/context balance, canonical workflows, Review Lens Selection detail, `lib/review-triggers.ts` detail). Mirrors the SDD pointer pattern at :196-202.

**Test seam (JD-005)**: `getOrchestratorPrompt` (`extensions/gentle-ai.ts:123-133`) is added to the existing `__testing` export object (`extensions/gentle-ai.ts:2125-2136`), so `tests/orchestrator-budget.test.ts` can call it directly instead of re-implementing the read+substitute+cache logic. `ASSETS_DIR` (`extensions/gentle-ai.ts:52`, currently `join(PACKAGE_ROOT, "assets")` with no override) gains a `GENTLE_PI_TEST_ASSETS_DIR` environment-variable override, read once at the same call site: `const ASSETS_DIR = process.env.GENTLE_PI_TEST_ASSETS_DIR ?? join(PACKAGE_ROOT, "assets");`. The byte-budget test sets `process.env.GENTLE_PI_TEST_ASSETS_DIR` to a short fixture directory containing minimal stand-in `orchestrator.md` + 3 lazy files before importing/calling `__testing.getOrchestratorPrompt()`, so the budget assertion measures the RETURN value against realistic-length substituted paths without depending on the real repo path length. Because `orchestratorPromptCache` is a module-level singleton (first read wins for the process lifetime, per `persona-single-channel/design.md`'s Testing Strategy note), the env override MUST be set before the first call in a given test process, or the test must run in a fresh process/module instance per fixture.

## Testing Strategy (strict TDD, `pnpm test`)

| Layer | What | Approach |
|---|---|---|
| Unit | Byte budget (JD-005) | Budget applies to `getOrchestratorPrompt()`'s RETURN value, not the raw file — the raw file still has unresolved `{{...PATH}}` placeholders, and substituted paths add real bytes. Test seam: `getOrchestratorPrompt` is exported via `__testing` (`extensions/gentle-ai.ts:2125-2136`); set `process.env.GENTLE_PI_TEST_ASSETS_DIR` to a short fixture dir before the first call so `ASSETS_DIR` (`:52`) resolves the three new placeholders to short fixture paths (module cache is first-read-wins, so set the env var before any call in the test process). Then `assert.ok(Buffer.byteLength(__testing.getOrchestratorPrompt(), "utf8") <= 10240)` — RED before split |
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

- [x] Does `port-review-ledger-contract` keep the four lens names in core or move them fully to lazy? ANSWERED by `port-review-ledger-contract/design.md:211-219`: the four `review-*` lens names STAY in the orchestrator core summary (its `tests/gentle-ai.test.ts:40` union assertion depends on their presence there). This design's 4R core row (825 B) and Delegation core row (1,468 B) both carry the four names accordingly (see Appendix).
- [ ] Confirm final core total after both dependencies actually land (target: within ~295 B headroom of the revised 10,240 B threshold, measured against the 9,945 B drafted-and-measured total in "Core budget rebuilt from measured drafts" — re-verify with `wc -c` per the Reserved-row hard commitment above).


## Addendum (post-round-3, pre-apply facts)

1. **Baseline update pending commit of port-review-ledger-contract**: that change has landed
   in the working tree, post-fix (the `sdd-verify` CRITICAL-1 fix dropped an unbudgeted
   inline-mode-negation sentence and relocated the pre-existing Prohibition sentence out of the
   subsection — see that change's `apply-progress.md` deviations 4-5): `assets/orchestrator.md`
   now measures 23,766 B / 325 lines there, with a real `### Review Execution Contract` (H3, not
   H2) at :314-325 measuring **1,139 B raw** (`awk 'NR>=314 && NR<=325' assets/orchestrator.md |
   wc -c`, re-measured post-trim; supersedes the earlier 1,733 B pre-fix figure). The Reserved row
   therefore becomes a normal SPLIT row at apply: the full 1,139 B section goes verbatim to the
   delegation lazy file; the ~573 B condensed core rendering in the Appendix MUST be reconciled
   against the landed text (and re-measured) as part of the committed hard re-verification, which
   now happens against the post-merge, post-fix file rather than a projection.
2. **Byte-count convention**: Appendix figures count block content without the final trailing
   newline; a fence-inclusive extraction measures each block exactly +1 B (round-3 judges verified
   all 9 rows). Aggregate under the fence-inclusive convention: subtotal 9,381 / total 9,954 /
   headroom 286 B — the ≤10,240 B conclusion is unchanged under either convention.
3. **Sequencing reconciliation**: the previously stated persona→ledger relative order proved
   functionally independent (disjoint orchestrator.md regions); the actual landing order is
   port-review-ledger-contract → persona-single-channel. The only HARD constraint stands:
   orchestrator-lazy-diet lands LAST, after both.

### Final re-baseline (hard commitment executed, 2026-07-09, post-merge of all three prior changes)

Measured against main after #70+#72+#74 merged (`wc -c` = 23,047 B / 312 lines, per-section sum reconciles exactly):

| Section | Bytes (real) | Note |
|---|---:|---|
| Header+bind | 117 | unchanged |
| Identity Contract | 150 | persona pointer ALREADY LANDED (was 831) |
| Core Role | 349 | unchanged |
| Language Boundary | 2,080 | LB1 pointer landed; LB2-LB5 verbatim (was 2,118) |
| Mental Model | 571 | unchanged |
| Work Routing Ladder | 3,742 | unchanged |
| Delegation Rules | 5,493 | unchanged |
| SDD Workflow pointer | 998 | unchanged |
| Memory Contract | 3,609 | unchanged |
| Skill Registry Protocol | 1,628 | unchanged |
| Intent-Driven Skill Discovery | 1,498 | unchanged |
| Safety | 286 | unchanged |
| 4R Review Triggers incl. Review Execution Contract (:285-312) | 2,526 | REC landed at :301 (trimmed, 1,139 B body) |

Budget consequence: Identity (150) and Language (2,080 — of which LB2-LB5 ≈ 1,035 move VERBATIM per JD-008-as-core... NO: LB3/LB4 stay in core per JD-008; LB2/LB5 move) are partially pre-materialized; the Appendix core drafts remain the apply contract for the split rows, with the fixture frozen against THIS 23,047 B baseline.
