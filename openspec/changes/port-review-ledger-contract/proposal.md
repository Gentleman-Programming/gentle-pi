# Proposal: Port the review-ledger contract into gentle-pi

## Intent

**Problem statement.** gentle-pi's review surfaces (4R lenses + judgment-day) are the PRE-LEDGER design that gentle-ai fixed on 2026-07-08. Each pass re-samples the full target with fresh context, re-reviews churn (find → fix → full re-review → NEW findings), keeps no persisted findings ledger, and has no convergence guarantee. gentle-ai's battle evidence (5 cycles, convergence 5→1→1→0, 54 findings resolved) proves the ledger design. We want ONE conceptual contract across both products.

## Scope

### In Scope
- Author canonical `skills/_shared/review-ledger-contract.md` (port of gentle-ai's 97-line source, `wc -l` verified): exhaustive first pass (loop until N=2 dry sweeps, ceiling 4/lens; R2 MAY use N=1), findings ledger schema (`id`, `lens`, `location`, `severity`, `status`, `evidence`), store-branched persistence (openspec `review-ledger.md` / engram topic / inline `none`), scoped re-review, execution-mode clause.
- Hand-copy the judge-oriented clause block INTO the copy-pasteable prompt templates of: `assets/agents/review-{risk,readability,reliability,resilience}.md`, `assets/agents/jd-judge-a.md`, `jd-judge-b.md`, `skills/judgment-day/SKILL.md` hard rules, `skills/judgment-day/references/prompts-and-formats.md` Judge Prompt template.
- `assets/agents/jd-fix-agent.md` + the Fix Agent Prompt template get the DISTINCT fix-agent clause set (status→fixed only; NO exhaustive-pass/emission clauses) — JD-001 lesson.
- `assets/orchestrator.md` "4R Review Triggers": add a Review Execution Contract section (persistence branches; subagent-primary only — no inline execution mode, per orchestrator.md:92), expressed as section-content agnostic to final section location.
- `assets/sdd-orchestrator-workflow.md` Review Workload Guard: reference ledger persistence.
- TypeScript drift-guard test (`tests/review-ledger-contract.test.ts`, `pnpm test`) asserting per-role clause slices with fence-scoped assertions — JD-013 lesson.

### Out of Scope
- Frontmatter `name:` fields of judgment-day + 5 skills — owned by parallel change `sync-skill-collision-prefixes` (this change owns BODY content only).
- Runtime review-gate logic in `extensions/gentle-ai.ts` / `lib/review-triggers.ts` (trigger gating, not ledger prose).
- Any change to review lens severity vocabulary or 4R trigger cadence.

## Capabilities

### New Capabilities
- `review-ledger-contract`: exhaustive-first-pass loop, persisted findings ledger, scoped re-review, and judge/fix role split, replicated across all gentle-pi review surfaces and enforced by a drift-guard test.

### Modified Capabilities
- None (no existing specs in `openspec/specs/`).

## Approach

Follow gentle-ai ADR 1: one authored canonical source, hand-replicated into each static asset, parity enforced by a table-driven presence test — no build-time generation (agent/skill files are copied whole, not marker-injected). Apply the two hard-won lessons: clauses live INSIDE the copy-pasteable templates (JD-003/JD-013), and the fix role carries its own clause set with no sweep/emission clauses (JD-001). Ledger persistence reuses gentle-pi's existing openspec+engram stores as-is. Keep wording as close to the canonical gentle-ai source as the Pi runtime allows.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `skills/_shared/review-ledger-contract.md` | New | Canonical authoring source |
| `assets/agents/review-*.md` (4) | Modified | Judge ledger block in templates |
| `assets/agents/jd-judge-{a,b}.md` | Modified | Judge ledger block |
| `assets/agents/jd-fix-agent.md` | Modified | Distinct fix-agent clause set |
| `skills/judgment-day/SKILL.md` + `references/prompts-and-formats.md` | Modified | Ledger + scoped re-judge in templates |
| `assets/orchestrator.md` | Modified | Review Execution Contract section |
| `assets/sdd-orchestrator-workflow.md` | Modified | Ledger persistence reference |
| `tests/review-ledger-contract.test.ts` | New | Per-role clause drift-guard |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Clauses drift or land in trailing prose | High | Fence-scoped, per-role clause-slice test (JD-013) |
| Fix agent inherits emission clauses | Med | Separate `requiredFixAgentClauses` slice; assert exclusion (JD-001) |
| Section relocation by parallel changes | Med | Orchestrator edits authored as location-agnostic section content |
| Name collision with `sync-skill-collision-prefixes` | Low | Body-only boundary stated; no frontmatter edits here |
| Diff exceeds 400-line review budget | Med | sdd-tasks may slice: (1) source+test, (2) review-*, (3) jd-*+skill, (4) orchestrator |

## Rollback Plan

File-level only; no data migration. Revert the asset and test commits per work unit and re-run `pnpm test` to confirm the pre-ledger baseline.

## Dependencies

- Coordinate with parallel changes `sync-skill-collision-prefixes` (frontmatter names), `persona-single-channel` and `orchestrator-lazy-diet` (may relocate orchestrator.md sections).

## Success Criteria

- [ ] Canonical `_shared` source exists with all four normative clause groups.
- [ ] Every judge surface carries the judge clause block inside its prompt template; fix-agent carries only the fix clause set.
- [ ] `pnpm test` drift-guard passes (per-role slices, fence-scoped).
- [ ] Ledger persistence branches (openspec/engram/none) present in orchestrator content.
