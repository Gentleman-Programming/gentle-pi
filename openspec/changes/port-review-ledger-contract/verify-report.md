## Verification Report

**Change**: port-review-ledger-contract
**Version**: N/A (spec.md, no version header)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 12 |
| Tasks complete (checkbox) | 12 |
| Tasks genuinely complete vs. cited requirement | 11.5/12 (task 2.6 partially — see CRITICAL-1) |

### Build & Tests Execution
**Build**: N/A (no build step; static markdown assets)

**Tests**: `pnpm test` → ✅ 238 passed / 0 failed / 0 skipped (exit 0), includes `tests/review-ledger-contract.test.ts` (22/22) + 216 pre-existing + `test:harness` clean. Verified by direct execution, not by trusting apply-progress.md's report.

```text
$ pnpm test
ℹ tests 238
ℹ pass 238
ℹ fail 0
$ node --experimental-strip-types tests/runtime-harness.mjs   (ran clean, no output = pass)
```

Isolated re-run of the new suite alone: `node --experimental-strip-types --test tests/review-ledger-contract.test.ts` → 22/22 pass.

**Coverage**: not applicable (no coverage tool configured for this repo / node:test has no coverage flag wired into `pnpm test`).

**rg inline-mode sweep** (independently re-run, not trusted from apply-progress): `rg -n -i "inline mode|inline execution mode|inline-mode"` across the repo → 3 hits, all explicit negation statements in `assets/orchestrator.md:325`, `tests/review-ledger-contract.test.ts:71` (comment), `skills/_shared/review-ledger-contract.md:56`. Zero residual inline-mode clause content. Confirms task 3.2's claim.

### Port Fidelity — canonical diff (gentle-ai vs gentle-pi)
`diff` between `internal/assets/skills/_shared/review-ledger-contract.md` (gentle-ai, 97 lines) and `skills/_shared/review-ledger-contract.md` (gentle-pi, 98 lines) shows the four normative clause paragraphs (Exhaustive first pass, Findings ledger schema, Ledger persistence branches, Scoped re-review) are **byte-identical** between products. All deltas are exactly the design's adaptation table:
- Path examples (`internal/x.go`/`internal/y.go` → `lib/x.ts`/`lib/y.ts`) and asset paths (`internal/assets/{family}/...` → `assets/agents/...`)
- Test reference (`review_ledger_contract_test.go` → `tests/review-ledger-contract.test.ts`)
- Adapter multiplicity prose (13 families → single Pi runtime)
- "Execution modes" (plural, subagent+inline) → "Execution mode" (singular, subagent-only; inline mode dropped, one added `Subagent execution-mode` sentence appended after Scoped re-review, plus a new fix-execution-mode sentence)
- "Adopting assets" list paths and one added bullet (Subagent execution-mode as a 5th hand-copy item)

No unrelated content lost. Fidelity: **PASS**.

### Spec Compliance Matrix (9 requirements / 20 scenarios)
| Requirement | Scenario | Test/Evidence | Result |
|---|---|---|---|
| Exhaustive first-pass loop-until-dry | First pass loops until dry | Clause wording asserted on all 7 judge whole-file surfaces + canonical + Judge Prompt fence | ✅ COMPLIANT |
| Exhaustive first-pass loop-until-dry | Loop is bounded | "Hard ceiling: 4 sweeps" clause, same surfaces | ✅ COMPLIANT |
| Persisted findings ledger | Ledger captures required fields | Full schema table asserted verbatim, all judge surfaces | ✅ COMPLIANT |
| Persisted findings ledger | Zero findings still produce a ledger record | 4r-review.chain.md test: 4/4 "No findings." replaced with empty-ledger clause | ✅ COMPLIANT |
| Ledger persistence honors artifact store | Store selects persistence target | openspec/engram/none bullets asserted on canonical + orchestrator.md | ✅ COMPLIANT |
| Ledger persistence honors artifact store | None store writes nothing | `none` bullet text asserted verbatim | ✅ COMPLIANT |
| Scoped re-review contract | Re-review verifies ledger findings within scope | Clause present in canonical + all judge whole-file surfaces + prompts-and-formats.md prose (outside fence) | ✅ COMPLIANT (textually) |
| Scoped re-review contract | Untouched-line finding logged, not escalated | Same clause, `status info` wording | ✅ COMPLIANT (textually) |
| Judge and fix-agent role split | Judge surfaces sweep and emit findings | judge-clause tests, 7 surfaces | ✅ COMPLIANT |
| Judge and fix-agent role split | Fix agent applies fixes without sweeping/emitting | `jd-fix-agent.md` test: fix clauses present, `judgeOnlyMarkers` absent | ✅ COMPLIANT |
| Judgment-day ledger and scoped re-judge | First pass exhaustive and ledgered | jd-judge-a/b tests | ✅ COMPLIANT |
| Judgment-day ledger and scoped re-judge | Re-judge is scoped | SKILL.md "Ledger and Re-Judge Contract" section + prompts-and-formats.md prose | ✅ COMPLIANT |
| **Clauses live inside copy-pasteable prompt templates** | **Clause is inside the template fence** | `extractFencedBlockAfterHeading` on Judge Prompt fence asserts only `requiredJudgePromptClauses` = exhaustive-pass + ledger + persistence — **scoped-re-review is deliberately excluded from this array** (test.ts:79-95) and manual inspection confirms the scoped-re-review clause lives ONLY in trailing prose at `prompts-and-formats.md:99-105`, outside any fence, in the only file in this change with real fences | ❌ **CRITICAL — UNTESTED / VIOLATED** (see CRITICAL-1) |
| Contract coverage across every review surface | Every judge surface carries judge clause set | 7 surfaces, all 4 clauses present as whole-file text | ✅ COMPLIANT |
| Contract coverage across every review surface | Fix-agent surface carries only fix clause set | jd-fix-agent.md test | ✅ COMPLIANT |
| Contract coverage across every review surface | SKILL.md/orchestrator/workflow-guard reference the contract | SKILL.md section, orchestrator.md subsection (persistence + "scoped re-judge" reference), workflow-guard one-liner | ✅ COMPLIANT |
| Contract coverage across every review surface | No surface left uncovered | All 10 inventoried surfaces carry role-correct clauses | ✅ COMPLIANT |
| Drift-guard test enforces per-role clause parity | Fails on judge clause drift | String-match assertions across judge surfaces; structurally sound | ✅ COMPLIANT |
| Drift-guard test enforces per-role clause parity | Fails on fix-agent contamination | `judgeOnlyMarkers` negative assertion, fence-scoped | ✅ COMPLIANT |
| Drift-guard test enforces per-role clause parity | Passes when all surfaces match | 238/238 green, verified by direct execution | ✅ COMPLIANT |

**Compliance summary**: 19/20 scenarios compliant, 1 CRITICAL (scoped-re-review clause not inside the Judge Prompt fence).

### Issues Found

**CRITICAL**:
1. **Scoped re-review clause is not embedded inside the Judge Prompt fence in `skills/judgment-day/references/prompts-and-formats.md`, violating Requirement "Clauses live inside copy-pasteable prompt templates."** The spec text is explicit and lists four clause types that MUST be inside the template body: "The exhaustive-pass, ledger, persistence, **and scoped re-review** clauses MUST be embedded inside the copy-pasteable prompt template body… not in surrounding narrative or trailing prose." `prompts-and-formats.md` is design.md's own stated "ONLY surface among this change's targets with real fences" (design.md:28) — the exact place this requirement matters. The Judge Prompt fence (lines 5-60) correctly embeds exhaustive-first-pass, ledger schema, and persistence, but the scoped-re-review paragraph is placed at lines 99-105 in a trailing `## Ledger and Re-Judge Contract` section, entirely outside any fence — the exact JD-013 failure mode the design's own decision section describes and claims to have mitigated. The drift-guard test's `requiredJudgePromptClauses` array (test.ts:79-95) deliberately excludes `scopedReReviewClauses` with a comment rationalizing the exclusion ("governs the re-judge round that follows the fix agent, not the judge's own prompt") — this rationale is not supported by the spec text, which does not scope the requirement to "the judge's own first-pass prompt" but to every "copy-pasteable prompt template." There is also no separate fenced "Re-Judge Prompt" template anywhere that could legitimately house this clause instead. Net effect: an operator who copies the Judge Prompt fence verbatim (the documented adopting mechanism) never receives the scoped-re-review instructions in any composed prompt — reintroducing the exact drift class this whole change exists to prevent. Not disclosed in apply-progress.md's Deviations section (only 3 unrelated deviations are listed). Task 2.6 is checked complete and explicitly cites this requirement, but the requirement is not fully satisfied.
   - **Fix**: either (a) move the scoped-re-review paragraph inside the Judge Prompt fence (or a new dedicated Re-Judge Prompt fence) and add `scopedReReviewClauses` to `requiredJudgePromptClauses` in the test, or (b) if design intends scoped-re-review to genuinely be a judge-completes-first-pass-only concern with re-judge context supplied out-of-band, amend the spec requirement's wording to exempt it explicitly and document why — currently the code and spec disagree and the test was authored to make the disagreement invisible.

**WARNING**: None.

**SUGGESTION**:
1. `openspec/changes/orchestrator-lazy-diet/design.md` and `openspec/changes/persona-single-channel/design.md`/`review-ledger.md` are also modified in the working tree but are not part of this change's File Changes table, tasks.md, or apply-progress.md. These appear to be forward-looking cross-references from other in-flight SDD changes (accurately reflecting this change's landed content) rather than accidental edits, but they sit uncommitted alongside this change's diff — confirm they are intentionally excluded from this PR before committing, or split them out.
2. Drift-guard test comment (test.ts:79-95) documents an interpretive narrowing of the spec's four-clause list without a corresponding spec/design amendment — worth reconciling regardless of how CRITICAL-1 is resolved, so future readers of the test don't take its narrower interpretation as spec-authoritative.

### Verdict
**FAIL** — one CRITICAL: the "Clauses live inside copy-pasteable prompt templates" requirement is violated for the scoped-re-review clause in the only fenced-template surface this change touches, and the drift-guard test was authored to not catch it. All other 8 requirements / 19 scenarios are genuinely compliant with passing runtime evidence (238/238 `pnpm test`, independently re-run). Route back to `sdd-apply` to relocate/duplicate the scoped-re-review clause into the Judge Prompt fence (or amend spec+design if the exclusion is intentional) and extend the drift-guard test accordingly, then re-verify.
