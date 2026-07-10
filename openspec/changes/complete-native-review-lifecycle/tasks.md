# Tasks: Complete Native Review Lifecycle

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated authored changed lines | 500–700 (additions + deletions) |
| 400-line budget risk | High — accepted `size:exception` |
| Suggested split | One coherent exception PR; work-unit commits |
| Delivery strategy / chain | exception-ok / size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal / likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | Inert evidence; exception PR | `node --experimental-strip-types --test tests/review-snapshot.test.ts tests/review-policy-ordinary.test.ts tests/review-transaction.test.ts tests/review-graph-schema.test.ts` | N/A: Git/policy/store unit boundary | Snapshot, policy, transaction, schema, paired tests |
| 2 | Contract cleanup; exception PR | `node --experimental-strip-types --test tests/review-controller.test.ts tests/review-ledger-contract.test.ts tests/review-bundle.test.ts tests/review-policy-judgment-day.test.ts` | `pnpm run test:harness` — ordinary start→fix→targeted validation | Controller, ordinary contracts, paired tests |

## Phase 1: Remove Obsolete Lifecycle (TDD)

- [x] 1.1 **RED** — Replace `tests/review-{graph-schema,transaction}.test.ts` follow-up-transition tests with failures proving `ordinary-follow-up` is rejected and ID-sorted, action-free follow-ups only live in `validation_evidence` without changing phase, counters, candidate, receipts, or delivery.
- [x] 1.2 **GREEN** — Remove uncommitted `ordinary-follow-up` schema/transition/reducer/input/top-level-state additions from `lib/review-{graph-schema,transaction}.ts`; persist and validate inert follow-ups only in `ValidationEvidenceV1`.
- [x] 1.3 **REFACTOR** — Delete redundant NEW compatibility tests/fixtures from the additive attempt; do not layer adapters around discarded behavior.

## Phase 2: Targeted Ordinary Proof (TDD)

- [x] 2.1 **RED** — In snapshot/policy/transaction/controller tests, cover canonical genesis paths, Git root selection (nested/relative/absolute; outside/unresolved fails closed), documentation-like paths, staged/mixed/empty-index no-mutation trees, exact frozen IDs, and pre-append scope rejection.
- [x] 2.2 **GREEN** — Update `lib/review-{snapshot,policy-ordinary,transaction}.ts` and `extensions/gentle-ai.ts`: retain internal Git correction binding; ordinary validator accepts only ledger/acceptance/per-ID regression/original-criterion proof and inert follow-ups—never diff, candidate, changed lines, discovery, or re-review.
- [x] 2.3 **RED/GREEN** — Require one validator after a fix, zero without one, and reject/revert/escalate failed acceptance, missing/duplicate/failed proof, or original-criterion regression.

## Phase 3: Contract Cleanup and Regression Evidence

- [x] 3.1 **RED** — In `tests/review-ledger-contract.test.ts`, add negative drift assertions for `assets/agents/review-validator.md`, `skills/_shared/review-ledger-contract.md`, `assets/orchestrator-delegation.md`, `skills/gentle-ai/SKILL.md`, and `README.md`; retain Judgment Day fix-diff/scoped re-judgment assertions.
- [x] 3.2 **GREEN** — Replace ordinary fix-line/fix-diff/scoped-re-review language in every listed surface with targeted-proof wording; preserve Judgment Day unchanged.
- [x] 3.3 **Regression/measure** — Preserve graph/CAS, retry/resume, receipts/gates, bundles, route/lens, Judgment Day, and live `tests/fixtures/v0.13/**`/`v0.14/**` forced-sync tests. Run both work units, `pnpm test`, `git diff --check`, and `git diff --numstat`; report authored additions/deletions plus explicit cleanup deletions/replacements.
