# Proposal: Orchestrator Lazy Diet

## Intent

**Problem statement:** `assets/orchestrator.md` (22,626 B ≈ 5,650 tokens, bytes/4) is injected always-on into every Pi parent session via `getOrchestratorPrompt` (`extensions/gentle-ai.ts:123-133`, appended at :2208). It is 92% of gentle-pi's always-on parent budget. Most of it is long-tail protocol prose, examples, and per-phase tables that are only needed on specific triggers, not every turn. A proven lazy-pointer pattern already exists in the same file: the `## SDD Workflow (lazy-loaded)` section points to `assets/sdd-orchestrator-workflow.md` (12,425 B) by substituted path (`{{GENTLE_PI_SDD_WORKFLOW_PATH}}`) and is NOT double-injected. gentle-ai already applied this diet to its Claude orchestrator (7.8 KB core + 13.8 KB lazy).

**Success:** a thin always-on core (target ≤8 KB) carrying only every-turn load-bearing rules, long-tail detail moved to on-demand lazy reference files, zero normative content lost, and drift locked by tests under `pnpm test`.

## Scope

### In Scope
- Split `assets/orchestrator.md` into a thin always-on core plus new lazy reference files, reusing the existing `{{...PATH}}` substitution + cache pattern in `getOrchestratorPrompt`.
- Section-by-section disposition table (below): always-on core vs lazy file.
- Byte-budget test: assert `assets/orchestrator.md` size ≤ budget (8,192 B).
- Frozen-fixture union/migration test: the union of (new core + all referenced lazy files) contains every normative section from the pre-diet fixture — nothing lost.
- Cache/substitution test: `getOrchestratorPrompt` still substitutes every placeholder (no leftover `{{`) and caches.
- Measured before/after bytes and ≈tokens with stated method.

### Out of Scope
- Content dedupe of Identity Contract / Language Boundary against the wrapper — owned by `persona-single-channel`.
- Rewriting 4R / Review Lens content — owned by `port-review-ledger-contract`.
- Runtime lazy-load enforcement / any behavior change beyond prompt size.

## Coordination (parallel changes)

- `persona-single-channel` must land FIRST. It owns the CONTENT of Identity Contract + Language Boundary (dedupes them against the wrapper). This change then moves the already-deduped single copy. Disposition treats those sections as **content owned by `persona-single-channel`, placement owned here**.
- `port-review-ledger-contract` owns the CONTENT of the 4R / Review Lens sections. Same treatment: **content owned there, placement owned here**. Note `tests/gentle-ai.test.ts:40` currently asserts `assets/orchestrator.md` contains all four `review-*` lens names — that assertion must follow the content owner (kept as a core pointer or repointed to the review lazy file); coordinate so neither change breaks it.

## Disposition table

Section byte sizes are approximate (character-count method; exact per-section bytes measured during design/apply). Total = 22,626 B verified.

| Section (lines) | ~Bytes | Disposition | Notes |
|---|---:|---|---|
| Header + bind note (1-4) | 180 | Core | |
| Identity Contract (5-21) | 820 | Core | content owned by persona-single-channel |
| Core Role (22-27) | 380 | Core | |
| Language Boundary (28-43) | 2,350 | Core summary + lazy detail | 3-4 line summary in core; extended exceptions/comment-writer detail placed in lazy language ref; content owned by persona-single-channel |
| Mental Model (44-54) | 760 | Core (condensed) | |
| Work Routing Ladder (55-124) | 4,700 | Split | tiers + SDD triggers → core; examples + Pi Subagent Model Routing → lazy delegation ref |
| Delegation Rules (125-195) | 5,650 | Split | delegation table + Mandatory Delegation Triggers → core; Cost/Context Balance + Canonical Workflows → lazy delegation ref; Review Lens Selection → core pointer (content owned by port-review-ledger-contract) |
| SDD Workflow lazy pointer (196-205) | 1,150 | Core (unchanged) | already thin pointer |
| Memory Contract (206-244) | 3,550 | Split | one-liner + prompt-forwarding line → core; SDD phase read/write table + artifact keys + lifecycle rules → lazy memory ref |
| Skill Registry Protocol (245-267) | 1,520 | Split | resolve-once summary → core; detail → lazy skills ref |
| Intent-Driven Skill Discovery (268-290) | 1,430 | Lazy | one-line pointer in core; body → lazy skills ref |
| Safety (291-297) | 360 | Core | |
| 4R Review Triggers (298-313) | 1,680 | Core summary + lazy detail | gate summary → core; detail placement owned by port-review-ledger-contract |

**New lazy reference files** (path-substituted like the SDD workflow one):
`assets/orchestrator-delegation.md`, `assets/orchestrator-memory.md`, `assets/orchestrator-skills.md` (review + language detail placement coordinated with the two parallel changes).

## Budget justification (≤8 KB)

Core must hold: identity/role/mental model (~2.0 KB), routing ladder + delegation table + Mandatory Delegation Triggers (~2.6 KB), SDD lazy pointer (~1.15 KB), memory + skills + review summaries and lazy pointers (~1.6 KB), safety (~0.4 KB) ≈ 7.75 KB. This matches the proven gentle-ai core (7.8 KB), fits every-turn load-bearing content, and cuts ~65% (22,626 → ≤8,192 B; ~5,650 → ~2,048 tokens). The budget test threshold is 8,192 B. Lazy files are excluded from the always-on total because they load only on their trigger.

## Capabilities

### New Capabilities
- `orchestrator-prompt-budget`: defines the always-on core byte budget, the lazy-reference contract (path substitution + cache), and the nothing-lost union rule between core and lazy files.

### Modified Capabilities
- None (no existing specs in `openspec/specs/`).

## Approach

1. Land `persona-single-channel` first; rebase this change onto the deduped result.
2. Freeze current `assets/orchestrator.md` normative content as a test fixture (baseline for the union rule).
3. Add byte-budget + union + cache tests (RED under strict TDD).
4. Extract long-tail sections into the new lazy files; slim core to summaries + substituted pointers; wire new `{{...PATH}}` placeholders into `getOrchestratorPrompt` alongside the existing SDD one (GREEN).
5. Measure before/after (bytes via `fs.statSync().size` / `Buffer.byteLength`; tokens via bytes/4) and record in the design/verify artifacts.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `assets/orchestrator.md` | Modified | slimmed to thin always-on core |
| `assets/orchestrator-delegation.md` `-memory.md` `-skills.md` | New | lazy reference files |
| `extensions/gentle-ai.ts` (:118-133) | Modified | add path placeholders + substitution for new lazy files; keep cache |
| `tests/orchestrator-budget.test.ts` (new) | New | byte-budget + union + cache tests |
| `tests/gentle-ai.test.ts` (:40) | Modified | review-lens assertion follows content owner (coordinated) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Normative rule dropped during split | Med | frozen-fixture union test asserts nothing lost |
| Overlap/conflict with the two parallel changes | High | ownership split (content vs placement); sequence persona-single-channel first |
| Placeholder not substituted → literal `{{...}}` injected | Low | cache/substitution test asserts no leftover `{{` |
| Core creeps back over budget later | Med | byte-budget test fails CI at >8,192 B |

## Rollback Plan

Revert the commit(s): restore the single `assets/orchestrator.md`, remove the new lazy files, and drop the added placeholders in `getOrchestratorPrompt`. No data/state migration involved — the change is prompt assets + tests only.

## Dependencies

- `persona-single-channel` merged first (Identity/Language content).
- `port-review-ledger-contract` for final 4R/review content (placement coordinated).

## Success Criteria

- [ ] `assets/orchestrator.md` ≤ 8,192 B; before/after bytes + ≈tokens recorded with method.
- [ ] Union test proves every pre-diet normative section exists in core or a lazy file.
- [ ] `getOrchestratorPrompt` substitutes all placeholders (no `{{`) and still caches; `pnpm test` green.
- [ ] Disposition table implemented as specified; no section silently deleted.
