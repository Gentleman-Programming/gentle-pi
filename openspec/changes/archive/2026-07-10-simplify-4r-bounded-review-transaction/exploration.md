## Exploration: simplify-4r-bounded-review-transaction

The corrected direction is a code-backed review transaction with two disjoint convergence policies. Ordinary 4R runs one selected 0/1/4 lens set, freezes findings, permits at most one selective inferential refuter batch and one consolidated fix batch, runs exactly one terminal scoped validator when fixes exist, runs one final verification, and terminates only as `approved` or `escalated`. The validator receives only frozen ledger IDs and the fix diff: it may verify those IDs and detect fix-line regressions, but cannot add findings, request a fix, launch another reviewer, or iterate. Judgment Day remains the only iterative mode. Commit, push, PR, and release gates validate the resulting receipt and never restart review for the same lineage.

### Current State

#### Runtime behavior confirmed in source

No current runtime hook launches a reviewer or stores a receipt. Review repetition is prompt-driven: command hooks emit advice while parent, SDD, PR, and release instructions independently request fresh review at later boundaries.

| Boundary | Current behavior | Required behavior |
|---|---|---|
| Post-apply | `assets/sdd-orchestrator-workflow.md` requests fresh-context validation for high-risk phases; `assets/orchestrator*.md` says post-SDD design/apply uses Judgment Day. | Start ordinary 0/1/4 review once when no valid implementation receipt exists. Judgment Day MUST require explicit selection and MUST NOT be an automatic post-SDD promotion. |
| Pre-commit | `extensions/gentle-ai.ts` classifies the cached/intended tracked diff, emits non-blocking advice, and then preserves independent command safety. | Validate the exact intended commit tree against the receipt. Never route or launch a reviewer. |
| Pre-push | The extension compares `merge-base...HEAD`, emits advice, and separately applies dangerous-command confirmation. | Validate `HEAD^{tree}` and receipt evidence. Never create a new review budget. |
| Pre-PR | The extension emits advice for the branch diff; parent instructions request a fresh lens or full 4R. | Validate receipt, tree, lineage, and base relationship only. |
| Release | `skills/release/SKILL.md` requires a fresh review before pushing a code release. | Validate the immutable tag/commit tree and verification evidence. Publication incidents remain separate bounded operational work. |

`lib/review-triggers.ts` currently owns 0/1/4 classification and event ceilings. `extensions/gentle-ai.ts` collects synchronous Git numstat evidence, calls that classifier, and `applyReviewAdvice()` always returns `undefined`. The collection excludes untracked files and can fail open after a two-second Git timeout. These properties are acceptable for advice but cannot authorize a content-addressed receipt.

The static `assets/chains/4r-review.chain.md` already invokes each of the four lenses exactly once, but it targets an ambient “current diff” and writes report files. Dynamic parent contracts can then refute, fix, and re-review outside the chain, so the chain's one-pass shape does not enforce one-shot convergence.

#### Current contract text that must be removed or split

The present canonical contract incorrectly shares iterative convergence between ordinary 4R and Judgment Day. The amendment must make the mode boundary explicit rather than merely lowering a shared round counter.

| Surface | Current text/contract | Amendment |
|---|---|---|
| `openspec/specs/review-orchestration/spec.md` | “full 4R MUST use at most two per lens”; one standard or three full-4R refuters; two-of-three voting; “up to two scoped fix/re-review rounds”; Judgment Day uses “the same limit.” | Replace ordinary behavior with one 0/1/4 pass, evidence-class routing, at most one inferential refuter batch, at most one fix batch, exactly one terminal scoped validator when fixes exist, and one final verification to `approved | escalated`. Move iterative scoped re-judgment into an explicit Judgment Day-only requirement. |
| `openspec/specs/review-routing/spec.md` | Pre-commit/pre-push event ceilings and advice “without ... requiring a receipt.” | Keep 0/1/4 classification only for transaction start. Replace lifecycle event routing with receipt validation and independent command safety. |
| `skills/_shared/review-ledger-contract.md` | “Full 4R runs at most two complete sweeps per lens”; `none` completes a “review → fix → re-review loop”; shared re-review clauses; three full-4R refuters; two-of-three voting; two shared fix/re-review rounds. | Retain the path for compatibility, but split it into **Ordinary bounded validation** and **Judgment Day iterative** sections. Ordinary permits one terminal validator only after a fix batch and gives it frozen ledger IDs plus the fix diff; iterative scoped re-judgment and its two-round limit remain Judgment Day-only. |
| `assets/agents/review-{risk,resilience,readability,reliability}.md` | Each repeats the two-sweep wording, the session re-review loop, and “Re-review receives only the authoritative ledger and the fix diff.” | Make each lens one terminal discovery call against an explicit immutable snapshot. Move post-fix checking into a separate terminal scoped-validator contract that cannot discover findings or schedule work. |
| `assets/agents/review-refuter.md` | Supports general/correctness/impact/reproducibility roles and returns `refuted | stands`, enabling three actors and voting. | Accept one complete batch of inferential severe findings only and return one `refuted | corroborated | inconclusive` result per ID. Deterministic and insufficient findings never reach this actor. |
| `assets/orchestrator-delegation.md` | Parent owns “scoped re-review”; full 4R allows two sweeps; three refuters and voting; ordinary severe rows may enter two fix/re-review rounds. | Replace with the bounded ordinary sequence and a structurally separate explicit Judgment Day sequence. A completed ordinary fix batch authorizes exactly one scoped validator, then one final verification; neither step can return to fixing or discovery. |
| `assets/orchestrator.md`, `skills/gentle-ai/SKILL.md`, `README.md` | Fresh review before commit/push/PR; ordinary two-round scoped convergence; three full-4R refuters; post-SDD Judgment Day. | Replace same-lineage fresh-review instructions with transaction start/receipt validation. Define the one terminal ordinary validator and remove automatic Judgment Day selection plus looping ordinary convergence language. |
| `assets/sdd-orchestrator-workflow.md` | Triggered review findings “follow the scoped re-review contract.” | Post-apply may start ordinary review once; a fixed ordinary transaction runs its one terminal validator before final verification; later lifecycle boundaries read the receipt. Iterative scoped re-judgment is referenced only for explicitly selected Judgment Day. |
| `skills/release/SKILL.md` | “Run a fresh review before pushing a code release.” | Require a valid receipt for the immutable release tree; never reopen code review after a publication failure. |
| `assets/chains/4r-review.chain.md` | Runs four ambient-diff reports with file outputs. | Keep only as a compatibility wrapper for one explicit snapshot/lens set. Capture outputs outside the read-only snapshot and provide no fix, refuter, re-review, or gate behavior. |
| Scoped validator agent/contract (new or dedicated existing role) | No ordinary actor currently has the required terminal, non-discovery authority. | Accept only frozen ledger IDs plus the fix diff; return per-ID/fix-line validation and terminal `approved | escalated`; reject new findings, fix requests, reviewer launches, and repeat invocation. |

#### Assets that must preserve Judgment Day iteration

Judgment Day is already explicitly activated by `skills/judgment-day/SKILL.md` and already uses two blind judges, zero refuters, a dedicated fix agent, and at most two fix/re-judge rounds. Preserve that product behavior in:

- `skills/judgment-day/SKILL.md`
- `skills/judgment-day/references/prompts-and-formats.md`
- `assets/agents/jd-judge-a.md`
- `assets/agents/jd-judge-b.md`
- `assets/agents/jd-fix-agent.md`

These assets still require contract cleanup: change “the same two-round limit” to an explicitly Judgment Day-owned limit, bind every round to a Judgment Day transaction/mode, and prevent generic orchestrator text from invoking them automatically. Their scoped re-review clauses must NOT be copied back into ordinary lens assets.

#### Tests that must be removed, split, or repointed

- `tests/review-ledger-contract.test.ts` currently injects `scopedReReviewClauses` into `requiredReviewLensClauses`, requires two-sweep precision, three full-4R refuters, two-of-three voting, and a shared two-round limit. Split initial discovery, ordinary terminal validation, and Judgment Day re-judgment fixtures. Assert that a fixed ordinary transaction invokes one validator with only frozen ledger IDs plus the fix diff, and that the validator cannot add findings, request fixes, launch actors, or repeat.
- `tests/review-triggers.test.ts` currently asserts `EVENT_CEILING` and caps pre-commit/pre-push at standard. Preserve 400/401, triviality, hot-path, dominant-lens, and stable-lens-order tests at transaction start; remove gate event ceilings.
- `tests/review-gate.test.ts` explicitly proves advice contains no receipt and never blocks. Replace those assertions with staged-tree/HEAD/base/tag receipt checks, invalidation results, and command-safety composition.
- `tests/runtime-harness.mjs` currently proves `gh pr create` and review advice remain non-blocking. Repoint it to registered start/status/validate operations, persisted reload, receipt-valid/invalid gate behavior, and unchanged dangerous-command authority.
- `tests/orchestrator-budget.test.ts` currently requires fresh-review and advice-only wording in the always-on prompt. Repoint those load-bearing assertions to one-shot start, conditional exactly-once scoped validation, one final verification, explicit Judgment Day selection, and receipt-only gates.
- `tests/gentle-ai.test.ts` should continue to reject a generic `reviewer` name, but its lifecycle guidance assertions must accept receipt validation instead of unconditional fresh review.
- `tests/openspec-deltas.test.ts` must cover the canonical routing/orchestration delta while distinguishing the ordinary terminal validator from iterative Judgment Day re-judgment.
- `tests/sdd-agent-tools.test.ts` and `tests/package-manifest.test.ts` should preserve the package-managed refuter's exact read-only tool boundary while updating its output/role contract; they do not justify retaining three refuter calls.
- Archived OpenSpec changes and migration fixtures are audit history and MUST NOT be rewritten. Live tests must stop treating archived iterative ordinary 4R as the current product contract.

### Recommended Pi-Native Architecture

Use shared snapshot, persistence, hashing, and receipt infrastructure with two disjoint transition policies. A discriminated transaction mode is mandatory; ordinary transitions must have no callable re-review edge.

| Component | Responsibility | Suggested location |
|---|---|---|
| Snapshot builder | Build a complete content-addressed target including staged, unstaged, deleted, renamed, and non-ignored untracked content without mutating the real index. | New `lib/review-snapshot.ts` |
| Transaction store/core | Atomic Git-dir persistence, lineage/generation identity, revisions, idempotency keys, canonical hashes, evidence, and receipts. | New `lib/review-transaction.ts` |
| Ordinary policy | Authorize one 0/1/4 lens set, freeze findings, authorize at most one selective refuter batch and one fix batch, require exactly one terminal scoped validator when a fix occurs, then require one final verification and `approved | escalated`. | Separate reducer/policy in `lib/review-transaction.ts` or a focused sibling module |
| Judgment Day policy | Require explicit mode selection, authorize exactly two blind judges, and allow at most two scoped fix/re-judgment rounds. | Separate reducer/policy sharing the transaction core |
| Pi adapter/gates | Register explicit start/update/validate/status operations and replace lifecycle advice with receipt checks while preserving dangerous-command ordering. | `extensions/gentle-ai.ts` plus focused helpers |
| Review actors | Return bounded structured results only; the terminal ordinary validator receives only frozen IDs and the fix diff and cannot mint findings, request fixes, launch actors, or iterate. No actor may mint receipts, change mode, or reset lineage counters. | Existing package-owned actors plus a dedicated scoped-validator contract |

#### Mode-specific state machines

```text
ordinary:
unreviewed → reviewing → findings-frozen
  → [selective-refutation]
  → [single-fix-batch → scoped-validation]
  → final-verification → approved | escalated

judgment-day (explicit selection only):
unreviewed → blind-judging → findings-frozen
  → [fix → scoped-re-judgment] x 0..2
  → approved | escalated
```

The no-fix path advances directly from frozen/corroborated findings to final verification. The fix path MUST pass through `scoped-validation` exactly once. That validator is terminal and non-iterative: it can verify only frozen IDs and detect regressions on fix-touched lines, and any failed or contradictory result escalates rather than scheduling work. A failed fix, failed final verification, newly detected fix-line regression, malformed/inconclusive evidence, or exhausted authorization escalates. Ordinary 4R cannot change its mode to Judgment Day; a maintainer must explicitly select exceptional Judgment Day work under its own declared policy.

#### Complete snapshot and authoritative state

For `current-changes`, use a mode-`0700` transaction workspace, a non-existent temporary `GIT_INDEX_FILE`, an isolated `GIT_OBJECT_DIRECTORY`, the real object directory as an alternate, `git read-tree`, `git add -A -- .`, and `git write-tree`. Materialize the snapshot read-only for actors and prove the real index is unchanged. Use argument arrays rather than shell interpolation.

Persist machine authority outside the reviewed worktree under `git rev-parse --git-path gentle-ai/reviews/<lineage-id>/`. OpenSpec, Engram, and Pi session entries may mirror human-readable summaries or pointers, but they cannot mint approval. Existing `review-ledger.md` artifacts remain audit records, not receipts.

The receipt must bind the lineage, generation, declared mode, `initial_review_tree`, `final_candidate_tree`, policy hash, frozen-ledger hash, evidence hash, consumed mode-specific counters, and terminal state. `initial_review_tree` is what the 0/1/4 discovery pass saw; `final_candidate_tree` is the candidate accepted by final verification, after scoped validation when fixes exist and otherwise potentially equal to `initial_review_tree`. Unknown schemas or mode/counter contradictions fail closed.

#### Evidence routing and budgets

| Evidence class | Ordinary 4R handling |
|---|---|
| Deterministic | Controller-verifiable proof; mark corroborated and never invoke an LLM refuter. |
| Inferential severe | Send all admitted rows once to one detached, read-only refuter batch. |
| Insufficient | Mark inconclusive and escalate without a fix or replacement actor. |

```yaml
ordinary_4r:
  full_reviews: 1          # exactly
  refuter_batches: 1       # maximum
  fix_batches: 1           # maximum
  scoped_validators: 1     # exactly when a fix batch exists; otherwise 0
  final_verifications: 1  # exactly
judgment_day:
  blind_judge_sets: 1
  fix_rounds: 2
  scoped_rejudgments: 2
```

Counters belong to the lineage and cannot reset at a gate, phase, thread, command, or generation. A genuine scope change produces `scope-changed` and requires an explicit new lineage with its own fresh budget; that new lineage does not inherit the exhausted old-lineage budget, and its creation cannot reopen or silently reset the old lineage. Judgment Day counters are unreachable unless `mode: judgment-day` was explicitly selected.

#### Receipt-only lifecycle gates

| Gate | Deterministic result |
|---|---|
| Post-apply | If no valid receipt exists, explicitly start the ordinary transaction once. Do not auto-select Judgment Day. |
| Pre-commit | Compare the exact intended commit tree, policy, ledger, evidence, lineage, and terminal state. |
| Pre-push | Compare `HEAD^{tree}` with the receipt's `final_candidate_tree`. |
| Pre-PR | Validate tree equality, base relationship, receipt schema, and approved terminal state. |
| Release | Validate immutable tag/commit tree and required verification evidence. |

Gate outcomes are `allow | scope-changed | escalated`. `require-scoped-review` is not a valid ordinary gate result. A gate never launches a lens, validator, refuter, fix actor, judge, or re-judgment for the same lineage. `scope-changed` is not a budget reset: only an explicit new-lineage start can review the changed scope.

### Affected Areas

#### Runtime and canonical specifications

- `lib/review-triggers.ts` — retain start-time 0/1/4 classification; remove lifecycle event ceilings.
- `lib/review-snapshot.ts` (new) — complete temporary-index/object snapshots and exact gate trees.
- `lib/review-transaction.ts` (new) — schemas, disjoint mode policies, conditional terminal-validator authorization, budgets, frozen findings, evidence, named receipt trees, explicit new-lineage creation, and atomic Git-dir store.
- `extensions/gentle-ai.ts` — transaction operations/commands and receipt validation before independent command safety.
- `package.json`, `pnpm-lock.yaml` — direct TypeBox dependency and a tested minimum Pi peer version if typed APIs require it.
- `openspec/specs/review-routing/spec.md` — start-only route classification and receipt-only lifecycle behavior.
- `openspec/specs/review-orchestration/spec.md` — ordinary bounded validation and explicit iterative Judgment Day as separate requirements.
- `openspec/changes/simplify-4r-bounded-review-transaction/{proposal.md,specs/**}` — downstream artifacts currently omit the required ordinary post-fix validator and use `completed` in places; amend them in their own SDD phases to require the validator, `approved | escalated`, named receipt fields, and explicit new-lineage scope handling.

#### Packaged contracts and documentation

- `skills/_shared/review-ledger-contract.md` — compatibility path with mode-separated contracts.
- `assets/orchestrator.md`, `assets/orchestrator-delegation.md`, `assets/sdd-orchestrator-workflow.md` — one ordinary owner, no automatic Judgment Day, receipt-only later gates.
- `skills/gentle-ai/SKILL.md`, `README.md`, `skills/release/SKILL.md` — remove fresh same-lineage review and looping ordinary re-review language; document the single terminal validator and receipt-only gates.
- `assets/agents/review-{risk,resilience,readability,reliability}.md` — explicit snapshot, one terminal discovery call, and frozen-finding schema; a dedicated validator contract owns bounded post-fix validation.
- Scoped validator asset/contract (new or dedicated existing role) — frozen-ID/fix-diff input, fix-line regression detection, terminal output, and explicit authority prohibitions.
- `assets/agents/review-refuter.md` — inferential-only single batch and three-way output.
- `assets/chains/4r-review.chain.md` — one-shot snapshot compatibility wrapper.
- `skills/judgment-day/SKILL.md`, its reference, and `assets/agents/jd-*` — preserve explicit two-judge/two-round iteration while isolating it from ordinary 4R.
- `assets/support/review-transaction-contract.md` (likely new), `lib/sdd-preflight.ts`, package verification, managed-asset migration, and installer fingerprints — ship and safely refresh the new contracts without rewriting user/project shadows.

#### Test suites

- New `tests/review-snapshot.test.ts` and `tests/review-transaction.test.ts`; transaction coverage must assert the full ordinary budget, conditional exactly-once validator, `approved | escalated` terminal set, exact receipt field names, and explicit new-lineage creation without old-budget inheritance or reset.
- Rewrite/repoint `tests/review-gate.test.ts`, `tests/review-triggers.test.ts`, `tests/review-ledger-contract.test.ts`, `tests/runtime-harness.mjs`, `tests/orchestrator-budget.test.ts`, `tests/gentle-ai.test.ts`, and `tests/openspec-deltas.test.ts`.
- Preserve and adapt package/permission coverage in `tests/package-manifest.test.ts` and `tests/sdd-agent-tools.test.ts`.
- Add transition tests proving ordinary 4R must run one scoped validator after fixes, skips it when no fix exists, always runs one final verification, cannot repeat validation or return to fixing/discovery, cannot transition to Judgment Day, and cannot be restarted by commit/push/PR/release gates.

### Approaches

1. **Shared transaction core with disjoint ordinary and Judgment Day policies (recommended)** — share snapshot/store/receipt mechanics while exposing separate transition tables and budgets.
   - Pros: Makes the ordinary terminal validator exactly-once and non-iterative by construction; preserves explicit Judgment Day iteration; reuses common transaction infrastructure; supports deterministic receipt gates.
   - Cons: Requires careful schema/version design and more mode-boundary tests; parent transport of actor results remains explicit.
   - Effort: High, bounded, and testable.

2. **One generic reducer guarded by a mode flag** — keep one broad transition graph and reject iterative operations when mode is ordinary.
   - Pros: Less reducer duplication and a smaller initial API surface.
   - Cons: A broad iterative edge still exists in the ordinary code path; a missing guard can let the scoped validator schedule work, repeat, or promote to Judgment Day. This weakens the authoritative product boundary.
   - Effort: Medium-high with unacceptable convergence risk.

3. **Prompt/assets-only mode split** — rewrite contracts to say one-shot versus iterative but keep mutable ledgers and parent-owned counters.
   - Pros: Smallest initial code change and no new Pi API dependency.
   - Cons: Cannot prove complete snapshots, global budgets, mode isolation, atomic finding freeze, or receipt reuse. Later prompts can still launch another reviewer and call it validation.
   - Effort: Medium initially, high operational risk.

### Recommendation

Proceed with approach 1. The transaction core should share mechanics, not convergence authority: ordinary 4R and Judgment Day need separate legal transitions and counters. Ordinary 4R runs the selected 0/1/4 lens set once, permits at most one selective refuter batch and one fix batch, requires exactly one terminal scoped validator when fixes exist, then runs one final verification and terminates as `approved | escalated`. The validator's frozen-ID/fix-diff input and inability to discover, request work, launch actors, or repeat must be schema- and transition-enforced. Judgment Day remains the only iterative mode, explicitly selected with two blind judges and at most two scoped fix/re-judgment rounds. No ordinary failure, gate, or parent decision may silently switch modes.

Plan implementation as reviewable work units: snapshot/store foundations; ordinary one-shot reducer; explicit Judgment Day reducer; Pi/gate integration; and contract/asset migration. Split tests with the behavior they prove rather than placing all tests in a final mega-slice.

### Changed-Line Forecast

| Work area | Likely changed lines (additions + deletions) |
|---|---:|
| Snapshot, store, schemas, and disjoint reducers | 600–850 |
| Snapshot/transaction state-machine tests | 650–900 |
| Extension operations and lifecycle gate integration | 300–450 |
| Routing/gate/runtime/package test updates | 350–550 |
| Canonical specs, prompts, agents, skills, README, and migration | 550–800 |
| **Total** | **2,450–3,550** |

This is far above the project's 400-changed-line review budget. Strictly honoring that budget implies approximately 7–9 chained/stacked review slices, with each slice pairing behavior, tests, and its contract update.

### Review Workload

Decision needed before apply: Yes

Chained PRs recommended: Yes

400-line budget risk: High

The proposal/tasks phases should establish the chain before apply. A single PR requires an explicit size exception and would materially increase contract-drift and reviewer-fatigue risk.

### Risks

- The terminal scoped validator may detect a surviving ledger issue or fix-line regression but cannot repair or broaden it. This is intentional: the transaction escalates rather than turning validation into another review/fix round.
- A validator with access to the full original diff or mutable ledger can become a hidden second discovery pass. Enforce frozen ledger IDs plus fix diff as the complete input boundary.
- Shared code can accidentally leak Judgment Day transitions into ordinary mode. Separate reducers/policies plus negative transition tests are required.
- Existing “fresh review,” “same two-round limit,” and shared scoped-re-review prose is heavily replicated. Missing one asset can silently recreate the old loop.
- A Git-dir receipt is local. Cross-machine CI/release validation needs an explicit attestation transport without auto-pushing notes, refs, commits, or artifacts.
- Temporary snapshots may contain secrets from non-ignored untracked files. Use mode-`0700` storage, isolated objects, redacted logs, and terminal cleanup.
- Partial staging may not equal `final_candidate_tree`. Default to `scope-changed`; subset-certification algebra should remain out of scope.
- Scope changes can be abused as budget resets unless new-lineage creation is explicit and auditable. Keep the old lineage terminal and issue a separate lineage ID with independent counters.
- User/project actor overrides may shadow package assets. Preserve overrides, validate structured results, and never infer compliance from an actor name.
- A crash between actor completion and result ingestion must resume idempotently or escalate without consuming another actor authorization.
- Shell interception is defense-in-depth, not a universal Git hook. Explicit transaction validation is the authoritative in-harness operation.

### Ready for Proposal

Yes for re-running downstream SDD artifacts; not ready for apply. This exploration now encodes the authoritative correction, but the existing proposal and delta specs still state that ordinary post-fix actor calls are absent and use `completed` in places. Proposal/spec/design/tasks must be amended before implementation to require the conditional exactly-once terminal validator, its frozen-ID/fix-diff boundary, one final verification, `approved | escalated`, `initial_review_tree`/`final_candidate_tree`, and explicit new-lineage scope changes. Judgment Day remains the only iterative mode. Remote receipt transport still needs an explicit first-slice decision; local validation alone does not make receipts portable.
