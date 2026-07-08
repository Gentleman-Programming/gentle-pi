# Tasks: Port the review-ledger contract into gentle-pi

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2 new files (~97 + ~150 lines) + 10 modified files (~15-40 lines each) ≈ 500-650 lines |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR (size:exception) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (internal checkpoints, still one PR)

| Unit | Goal | Notes |
|------|------|-------|
| 1 | RED test | `tests/review-ledger-contract.test.ts` written failing |
| 2 | Canonical + hand-copies | `_shared` source, all 10 surfaces, in dependency order |
| 3 | Verification | Full `pnpm test` pass |

## Phase 1: RED — Drift-guard test

- [x] 1.1 Create `tests/review-ledger-contract.test.ts`. Define frozen named arrays: `requiredJudgeClauses`, `requiredJudgePromptClauses` (own array, not positionally sliced), `requiredFixAgentClauses`, `judgeOnlyMarkers`.
- [x] 1.2 Add `extractFencedBlockAfterHeading` matching headings by exact line equality (Pi hardening, not substring).
- [x] 1.3 Assert judge clauses on whole-file surfaces (`review-*`×4, `jd-judge-a/b`, `SKILL.md`); assert fenced Judge/Fix Prompt blocks in `prompts-and-formats.md`; assert `jd-fix-agent.md` + Fix fence contain `requiredFixAgentClauses` and NOT `judgeOnlyMarkers`; assert full enum rows (`BLOCKER|CRITICAL|WARNING|SUGGESTION`, `open|fixed|verified|wont-fix|info`, 5 lens codes) on judge/fix + SKILL.md surfaces only.
- [x] 1.4 Assert `orchestrator.md` carries openspec/engram/none persistence branches plus named `subagent execution-mode` and `fix execution-mode` clauses, no inline-mode clause.
- [x] 1.5 Run `pnpm test` — confirm all new assertions FAIL. Spec req: "Drift-guard test enforces per-role clause parity". RED evidence: 0 pass / 22 fail on first run of `tests/review-ledger-contract.test.ts` (captured in apply-progress.md).

## Phase 2: GREEN — canonical source, then hand-copies in order

- [x] 2.1 Create `skills/_shared/review-ledger-contract.md` (near-verbatim port: 4 clause groups + subagent-only execution-mode, no inline clause). Req: "Exhaustive first-pass...", "Persisted findings ledger", "Ledger persistence honors the artifact store", "Scoped re-review contract".
- [x] 2.2 Append judge clause block to `## Output contract` in `assets/agents/review-risk.md`, `review-readability.md`, `review-reliability.md`, `review-resilience.md`.
- [x] 2.3 Append judge clause block to Rules in `assets/agents/jd-judge-a.md` and `jd-judge-b.md`. Req: "Judgment-day ledger and scoped re-judge".
- [x] 2.4 Add fix-only clause set to `assets/agents/jd-fix-agent.md` (status→`fixed`; explicit no-sweep/no-emit); exclude judge block. Req: "Judge and fix-agent role split".
- [x] 2.5 Add new `## Ledger and Re-Judge Contract` section to `skills/judgment-day/SKILL.md` between `## Output Contract` and `## References`, BODY only (no frontmatter `name:` edit — owned by `sync-skill-collision-prefixes`).
- [x] 2.6 Insert judge clauses inside the Judge Prompt fence and fix clauses inside the Fix Agent Prompt fence in `skills/judgment-day/references/prompts-and-formats.md`. Req: "Clauses live inside copy-pasteable prompt templates".
- [x] 2.7 Add "Review Execution Contract" subsection to `assets/orchestrator.md` (persistence branches only; subagent-primary, no inline-mode clause, per `orchestrator.md:92`).
- [x] 2.8 Add one-line ledger-persistence reference to the Review Workload Guard in `assets/sdd-orchestrator-workflow.md`.
- [x] 2.9 Replace "If clean, say exactly: `No findings.`" at `assets/chains/4r-review.chain.md` lines 12, 21, 30, 39 with the canonical empty-ledger-record clause. Req: "Persisted findings ledger" (zero-findings scenario). Together, 2.2-2.9 cover: "Contract coverage across every review surface".

## Phase 3: Verification

- [x] 3.1 Run `pnpm test` — confirm FULL SUITE PASSES (all clause/fence/enum/persistence assertions GREEN). Result: 238/238 pass, exit 0, plus `test:harness` clean.
- [x] 3.2 `rg` sanity sweep across all 11 touched files for stray inline-mode wording (JD-001 residue lesson from `review-ledger.md`). Result: only 3 hits, all explicit "no inline mode" negation statements (test comment, canonical doc, orchestrator.md) — zero residue.
