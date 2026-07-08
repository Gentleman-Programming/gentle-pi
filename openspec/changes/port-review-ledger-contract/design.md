# Design: Port the review-ledger contract into gentle-pi

## Technical Approach

Replicate gentle-ai's battle-tested review-ledger contract into gentle-pi as ONE
conceptual contract. Author a single canonical source at
`skills/_shared/review-ledger-contract.md` (near-verbatim port of the 97-line
gentle-ai original, `wc -l` verified), hand-copy its normative clauses into each Pi review surface,
and enforce parity with a TypeScript drift-guard test under `node:test`
(`pnpm test`). No build-time generation — Pi ships static markdown assets as-is,
so this mirrors gentle-ai ADR 1. The three hard-won JD mitigations are ported as
MITIGATIONS, not just prose: fix-role clause isolation (JD-001), template-embedded
placement inside fenced prompts (JD-003/JD-013), and full-enum-row assertions
(JD-004). This is a prompt-and-test change; no runtime/model semantics change.
Lens codes stay: R1 risk, R2 readability, R3 reliability, R4 resilience, JD
judgment-day.

## Adaptation Table (canonical gentle-ai vs Pi)

| Aspect | gentle-ai canonical | Pi adaptation |
|--------|---------------------|---------------|
| Canonical path | `internal/assets/skills/_shared/review-ledger-contract.md` | `skills/_shared/review-ledger-contract.md` |
| Adapter multiplicity | 13 families (claude/cursor/kimi/kiro/…) | single Pi runtime — one copy per surface |
| Agent asset paths | `internal/assets/{family}/agents/review-*.md` | `assets/agents/review-*.md` (flat) |
| Drift-guard test | Go `review_ledger_contract_test.go` | TS `tests/review-ledger-contract.test.ts`, `pnpm test` |
| Execution modes | subagent + inline across adapters | Pi is subagent-primary ONLY (real `review-*`/`jd-*` subagents); no inline-mode clause — dropped entirely, aligning with `assets/orchestrator.md:92`'s stop-not-inline delegation policy |
| Delegation verb | orchestrator "merges subagent rows" | identical — Pi has native subagent delegation |
| Fenced templates | `prompts-and-formats.md` Judge/Fix templates | same file exists; the ONLY surface among this change's targets with real fences (scoped claim — other unrelated Pi assets may contain fences elsewhere, out of scope here) |
| Store branches | openspec / engram / none | identical (openspec + engram + none) |
| Contract prose | verbatim | near-verbatim; only paths + test name differ |

Only paths, adapter count, and test language change. The four normative clause
groups (exhaustive first pass, ledger schema, persistence branches, scoped
re-review) and both execution-mode sentences are copied word-for-word so both
products carry one contract.

## Architecture Decisions

### Decision: One canonical source, hand-copied, test-enforced (no generation)
**Choice**: Author once in `_shared`; hand-copy into each surface; a `pnpm test`
presence test asserts parity.
**Alternatives considered**: (a) marker-injected block rendered by TS at pack
time; (b) hand-maintain per surface with no test.
**Rationale**: Pi has no render pipeline for prompt prose; agent/skill files are
copied whole, never marker-injected. A generator is over-engineering for static
prose; drift (the top risk) is fully covered by a presence test. (b) leaves drift
unguarded. Follows gentle-ai ADR 1.

### Decision: Near-verbatim port over Pi-rewritten wording
**Choice**: Keep gentle-ai wording; change only paths and the test name.
**Alternatives considered**: Rewrite the contract in Pi-native phrasing.
**Rationale**: "One conceptual contract across both products" is the stated goal;
divergent wording reintroduces cross-product drift and defeats a shared mental
model. Cost: a couple of gentle-ai-flavored path examples in prose (acceptable).

### Decision: Fix role carries a DISTINCT clause set (JD-001 mitigation)
**Choice**: `jd-fix-agent.md` and the Fix Agent Prompt fence get ONLY fix clauses
(fix confirmed findings; set status→`fixed`; NEVER run the exhaustive first pass
or emit ledger rows). The judge block is excluded and asserted ABSENT.
**Alternatives considered**: paste the full judge block everywhere (the original
JD-001 bug).
**Rationale**: The fix agent that receives sweep/emission clauses contradicts its
"fix only confirmed" role. The test's `judgeOnlyMarkers` negative assertion
(JD-011) makes reintroducing the judge block fail the build.

### Decision: Template-embedded placement + fence extraction (JD-003/JD-013)
**Choice**: In `prompts-and-formats.md`, clauses live INSIDE the fenced Judge
Prompt / Fix Agent Prompt blocks (not trailing prose). The test extracts each
fenced block and asserts against the extraction only. For `review-*`/`jd-*`/
`SKILL.md`, the whole file IS the delivered prompt, so clauses go in the Output
contract / Rules / Hard Rules prose and whole-file assertions apply.
**Rationale**: Pi composes judge/fix prompts from the fenced templates; a clause
in surrounding prose never reaches the composed prompt (the exact JD-013 failure).

## Data Flow — review → ledger → fix → re-review

```
Orchestrator ──run lens──▶ Review lens (subagent)
                              │ loop until N dry sweeps (N=2; R2 MAY N=1; ceiling 4)
                              ▼
                          Ledger rows {id,lens,location,severity,status=open,evidence}
Orchestrator ──persist──▶ Store branch: openspec file │ engram topic │ none/inline
Orchestrator ──delegate─▶ Fix agent ──set status=fixed──▶ Ledger
Orchestrator ──re-review▶ Scoped pass (ledger + fix diff only)
                              │ untouched-line finding → status=info (no new round)
                              ▼ loop only while confirmed ids unverified → APPROVED
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `skills/_shared/review-ledger-contract.md` | Create | Canonical source: 4 clause groups + two-mode clause + full-enum schema |
| `assets/agents/review-{risk,readability,reliability,resilience}.md` | Modify (4) | Judge block appended to `## Output contract` (subagent-mode clause) |
| `assets/agents/jd-judge-{a,b}.md` | Modify (2) | Judge block appended to Rules |
| `assets/agents/jd-fix-agent.md` | Modify | Fix clause set only; judge block excluded |
| `skills/judgment-day/SKILL.md` | Modify | New dedicated `## Ledger and Re-Judge Contract` section (canonical structure, gentle-ai `skills/judgment-day/SKILL.md:50-74`) between `## Output Contract` and `## References`; NOT embedded into `## Hard Rules` (BODY only; no frontmatter `name:`) |
| `skills/judgment-day/references/prompts-and-formats.md` | Modify | Judge block INSIDE Judge Prompt fence; fix clauses INSIDE Fix Agent Prompt fence |
| `assets/orchestrator.md` | Modify | "Review Execution Contract" subsection — persistence branches only (NO inline-mode clause; Pi is subagent-only per `assets/orchestrator.md:92`), authored location-agnostic |
| `assets/sdd-orchestrator-workflow.md` | Modify | Review Workload Guard gains a one-line ledger-persistence reference |
| `assets/chains/4r-review.chain.md` | Modify (4 lens sections: lines 12, 21, 30, 39) | Replace "If clean, say exactly: `No findings.`" with the canonical empty-ledger-record clause ("If the first pass finds nothing, persist an empty ledger record rather than skip persistence"); document how the `review-*-report.md` file handoff maps to ledger persistence (see Ledger Persistence note below) |
| `tests/review-ledger-contract.test.ts` | Create | Per-role clause drift-guard (below) |

`skills/_shared/` does not exist yet in gentle-pi (verified: no such directory today); this change CREATES it for the first time via `review-ledger-contract.md`. `skills/skill-registry/SKILL.md:51` already references `skills/_shared/skill-resolver.md` — that is a PRE-EXISTING dangling reference this change does not create or resolve (out of scope; `skill-resolver.md` is not authored here).

## Interfaces / Contracts

Canonical ledger row, rendered identically in every surface:

```
| id     | lens         | location         | severity | status | evidence         |
|--------|--------------|------------------|----------|--------|------------------|
| R1-001 | risk         | lib/x.ts:42      | CRITICAL | open   | secret hardcoded |
| JD-004 | judgment-day | lib/y.ts:88      | WARNING  | info   | theoretical path |
```

**Ledger persistence branches (Pi stores).**
- `openspec`: write `openspec/changes/{change-name}/review-ledger.md`.
- `engram`: upsert topic `sdd/{change-name}/review-ledger`; ad-hoc JD without a
  change → `review/{target-slug}/ledger`, `target-slug` = `pr-{number}` when
  reviewing a PR, else the branch name kebab-cased, else a kebab-case slug of the
  user-stated target.
- `none`: keep the ledger inline; do NOT write files/Engram; complete the
  review → fix → re-review loop within the session because it is not persisted
  across compaction. (JD-005: this caveat is hand-copied into every surface, not
  left in a note.)

**Ledger persistence vs. the 4R chain report-file handoff.** `4r-review.chain.md`
passes `review-{lens}-report.md` between its four sequential steps
(`reads:`/`output:` chain config, lines 12-39). This file relay is NOT a second
persistence mechanism competing with the store branches above — each lens still
persists its ledger rows via the openspec/engram/none branch exactly as any
other review surface does; the report file is the SAME ledger content
serialized so the next chain step can read prior lenses' findings as input. The
chain's per-lens "If clean, say exactly: `No findings.`" wording is replaced
with the canonical empty-ledger-record clause so a clean lens still persists an
empty ledger record through the same branch rather than skip persistence.

## Testing Strategy (strict TDD — `pnpm test`, RED first)

`tests/review-ledger-contract.test.ts` (`node:test` + `node:assert/strict`,
reads assets via `readFileSync` from `process.cwd()`, matching existing suites):

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Judge whole-file surfaces carry every judge clause | Iterate `[review-*×4, jd-judge-a, jd-judge-b, SKILL.md]` against frozen `requiredJudgeClauses` |
| Unit | Fenced templates carry the right clauses IN the fence | `extractFencedBlockAfterHeading` on Judge Prompt → judge clauses; Fix Agent Prompt → fix clauses (JD-013) |
| Unit | Fix role isolation | `jd-fix-agent.md` + Fix Agent fence assert `requiredFixAgentClauses` AND `assertNotContains(judgeOnlyMarkers)` (JD-001/JD-011) |
| Unit | Full enum rows present | SCOPED to canonical + judge/fix prompt surfaces that carry the ledger schema (`review-*`×4, `jd-judge-{a,b}`, `jd-fix-agent`, `SKILL.md` Ledger and Re-Judge Contract section) — NOT every asset this change touches; assert complete `BLOCKER\|CRITICAL\|WARNING\|SUGGESTION`, `open\|fixed\|verified\|wont-fix\|info`, `risk\|readability\|reliability\|resilience\|judgment-day` — no truncation passes (JD-004) |
| Integration | Persistence branches | `orchestrator.md` asserts openspec/engram/none sentences; both named execution-mode clauses asserted explicitly — judge `subagent execution-mode` and fix `fix execution-mode` (no inline-mode clause; dropped per JD-001) |

Clause constants are frozen string arrays (`Object.freeze` / `as const`):
`requiredJudgeClauses` (exhaustive-pass with N=2/R2-N=1/ceiling-4; full-enum
schema; three persistence bullets incl. `none` compaction caveat; scoped
re-review; subagent execution-mode), `requiredFixAgentClauses` (fix-only; set
status→`fixed`; explicit "does NOT run the exhaustive first pass or emit a ledger";
fix execution-mode), `judgeOnlyMarkers` (exhaustive-first-pass heading,
ledger-emission clause, judge execution-mode clause).

`requiredJudgePromptClauses` (the subset asserted inside the Judge Prompt
fence) is authored as its OWN explicit named array, not derived by positional
slicing off `requiredJudgeClauses`. Canonical's
`requiredJudgePromptClauses = requiredLedgerClauses[:len(requiredLedgerClauses)-4]`
(gentle-ai `internal/components/sdd/review_ledger_contract_test.go:98`) is
index-fragile: reordering `requiredLedgerClauses` silently changes which
clauses the fence check covers. The TS port avoids this by naming each
sub-array explicitly (e.g. `judgePromptClauses`, `judgeWholeFileOnlyClauses`)
and composing `requiredJudgeClauses` from them, so no clause's membership
depends on array position.

`extractFencedBlockAfterHeading` matches headings by EXACT LINE EQUALITY (not
substring). This is deliberate Pi-side HARDENING beyond canonical, NOT a
ported mitigation: gentle-ai's own `extractFencedBlockAfterHeading`
(`internal/components/sdd/review_ledger_contract_test.go:191-198`) still uses
`strings.Index` substring search, and the resulting prefix-collision risk
remains unresolved upstream info debt (archived ledger JD-014, status
`info`). Likewise, scoping `assertNotContains(judgeOnlyMarkers)` to the
extracted Fix Agent Prompt FENCE content (not just the whole file) is
Pi-side hardening that closes a gap gentle-ai itself left open (archived
ledger JD-015, status `info`) — Pi implements both as extra rigor beyond,
not inherited from, canonical.

Assertions match on section CONTENT, never line numbers,
so `orchestrator-lazy-diet` relocation and `sync-skill-collision-prefixes`
frontmatter renames do not break the guard.

RED→GREEN: write the failing clause/fence/enum tests first (fail because no
surface carries the contract), author `_shared`, replicate into surfaces until
green.

## Tradeoffs (required by config rule `require_tradeoffs`)

| Fork | Option A | Option B | Decision + rationale |
|------|----------|----------|----------------------|
| Wording | Verbatim gentle-ai port | Pi-rewritten phrasing | **A.** One conceptual contract is the goal; rewriting reintroduces cross-product drift. Cost: a few gentle-ai path examples remain in prose. |
| Mechanism | Single canonical + hand-copy + presence test (gentle-ai ADR 1) | Build-time generation / marker injection | **A.** Pi ships static markdown; no render pipeline; generation is over-engineering. Drift is fully covered by the test. |
| Fix role | Distinct fix clause set + negative assertion | Reuse full judge block everywhere | **A.** Reusing the judge block IS the JD-001 bug; negative `judgeOnlyMarkers` assertion guards regression. |
| Placement | Clauses inside fenced templates + fence extraction | Trailing-prose "append to templates above" note | **A.** Prose never reaches Pi's composed prompt (JD-003/JD-013); fence extraction is the only reliable guard. |

## Sequencing / Coordination

- **Hard merge order**: this change lands AFTER `persona-single-channel` and
  BEFORE `orchestrator-lazy-diet`. Rationale: `persona-single-channel` must
  settle `assets/orchestrator.md`'s channel structure first so this change's
  Review Execution Contract subsection lands on a stable base; landing before
  `orchestrator-lazy-diet` means the diet's relocation (see below) moves this
  change's already-merged content rather than requiring a second merge pass.
- `assets/orchestrator.md` edits are authored as location-agnostic section content;
  `orchestrator-lazy-diet` may relocate the section later — the test asserts content
  presence, not position.
- **Cross-change test dependency**: `tests/gentle-ai.test.ts:40`
  (`"runtime guidance routes review intent to concrete lenses"`) is a
  cross-change dependency — it asserts the union of review-lens names surfaced
  in orchestrator guidance. `orchestrator-lazy-diet`'s open question is
  ANSWERED here: the four `review-*` lens names (`review-risk`,
  `review-readability`, `review-reliability`, `review-resilience`) STAY in the
  orchestrator core summary; they are not trimmed out during the diet, because
  `tests/gentle-ai.test.ts:40`'s union assertion depends on their presence
  there.
- Only judgment-day BODY content changes here; `sync-skill-collision-prefixes` owns
  the frontmatter `name:` fields. The test must not assert on frontmatter names.

## Migration / Rollout

No data migration; file-level only. Diff is broad; if it exceeds the 400-line
review budget, `sdd-tasks` may slice into work units: (1) `_shared` source + test,
(2) `review-*` assets, (3) `jd-*` + judgment-day skill, (4) orchestrator +
workflow. Rollback = revert asset/test commits per unit and re-run `pnpm test` to
confirm the pre-ledger baseline.

## Open Questions

- [ ] None blocking. Confirm `sync-skill-collision-prefixes` lands the judgment-day
  rename so the two changes do not touch the same lines in conflicting order.
