# Exploration — port-review-ledger-contract

## Problem

gentle-pi's review flows are the PRE-LEDGER design that gentle-ai fixed today (gentle-ai change `review-ledger-contract`, archived at /home/gentleman/work/gentle-ai/openspec/changes/archive/2026-07-08-review-ledger-contract/ with full proposal/spec/design/ledger). Symptoms of the old design: each review pass re-samples the full target with fresh context, re-reviews churn (find → fix → full re-review → NEW findings), no persisted findings ledger, no convergence guarantee.

## Verified facts (2026-07-08 audit)

- skills/judgment-day/SKILL.md (v1.4) + references/prompts-and-formats.md: no "review ledger", no "loop until dry", no scoped re-review. Verbatim: SKILL.md:21 "After any fix agent runs, immediately re-launch both judges in parallel"; :43 "Re-judge in parallel after fixes; repeat until approved, escalated, or user asks to stop"; references:70 "Approved criteria after Round 1: zero confirmed CRITICALs and zero confirmed real WARNINGs".
- assets/agents/review-*.md (4 lenses) + assets/orchestrator.md "## 4R Review Triggers" — same pre-ledger review model, on-demand channels.
- assets/agents/jd-*.md subagent files exist (judge-a, judge-b, fix-agent equivalents — verify names).

## The contract to port (canonical source in gentle-ai)

/home/gentleman/work/gentle-ai/internal/assets/skills/_shared/review-ledger-contract.md (97 lines, `wc -l` verified): (1) exhaustive first pass — loop until N=2 consecutive dry sweeps, ceiling 4/lens (R1 stays 2, R2 may use 1); (2) persisted findings ledger, id `{LENS}-{NNN}`, severity BLOCKER|CRITICAL|WARNING|SUGGESTION, status open|fixed|verified|wont-fix|info, persisted per artifact store (openspec review-ledger.md in change dir / engram topic / inline with compaction caveat); (3) scoped re-review — verify ledger findings + fix-touched lines only; untouched-line findings log as `info`, never reopen a round; (4) role split: judges emit ledger rows, fix agent only sets status to fixed and NEVER runs sweeps or adds rows (gentle-ai JD-001 lesson); (5) drift-guard tests with per-role clause slices and fence-scoped assertions where templates exist (gentle-ai JD-013 lesson: content must live INSIDE the copy-pasteable prompt templates, not in trailing prose).

Battle evidence from today: 5 judgment-day cycles across 2 repos, convergence 5→1→1→0 findings; 54 findings found/fixed/verified.

## Open questions for proposal

1. Which gentle-pi surfaces carry review-flow normative text? (skills/judgment-day/*, assets/agents/review-*.md + jd-*.md, orchestrator.md 4R section, gentle-ai skill body, sdd-orchestrator-workflow.md.)
2. Test strategy: gentle-pi is TypeScript — is there an existing test harness asserting asset/skill content (pnpm test)? Port the drift-guard clause test as a TS test over the markdown assets.
3. Ledger persistence per artifact store: gentle-pi's SDD flows use openspec + engram — the contract's persistence branch applies as-is.
4. Naming interaction: judgment-day skill may be renamed by sync-skill-collision-prefixes (parallel change) — coordinate; content changes here, name changes there.

## Constraints

- Strict TDD (pnpm test); the contract wording should stay as close to gentle-ai's canonical as the Pi runtime allows (one conceptual contract across both products).
