# Tasks: Simplify 4R into a Bounded Review Transaction

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 2,450–3,550; exceeds 800-line budget |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Work units 1 → 7 below |
| Delivery strategy | `exception-ok`; maintainer-approved `size:exception` |
| Chain strategy | `size-exception` |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

Maintainer approved `size:exception`; units remain review/rollback boundaries. Apply MUST NOT commit, push, open PRs, deliver, publish, or bump versions.

### Suggested Work Units

| Unit | Goal | Likely PR |
|---|---|---|
| 1 | Immutable snapshot | Single |
| 2 | Store/schemas | Single |
| 3 | Ordinary reducer | Single |
| 4 | Judgment Day reducer | Single |
| 5 | Operations/gates | Single |
| 6 | Contracts/migration | Single |
| 7 | Verification | Single |

## Phase 1: Snapshot

- [x] 1.1 RED — add `tests/review-snapshot.test.ts` for tracked/untracked capture, ignored exclusion, both projections, and unchanged index/worktree.
- [x] 1.2 GREEN/TRIANGULATE/REFACTOR — create `lib/review-snapshot.ts` using isolated Git objects/index; reject unresolved or unsupported projections.

## Phase 2: Store and Schemas

- [x] 2.1 RED — add `tests/review-transaction.test.ts` for canonical receipt/row hashes, projection binding, tampering, restart replay, key mismatch, pending work, lock/fsync faults, and child replay.
- [x] 2.2 GREEN — create `lib/review-transaction.ts` with const-derived flat V1 schemas, atomic revisions/HEAD, journal, frozen rows, receipts, budgets, and deterministic claims.
- [x] 2.3 TRIANGULATE/REFACTOR — inject filesystem faults; prove prior authority survives and integrity mismatches escalate.

## Phase 3: Ordinary Reducer

- [x] 3.1 RED — add `tests/review-policy-ordinary.test.ts` for 0/1/4 once, one refuter/fix maximum, zero-validator no-fix, scoped validation, final verification, and forbidden transitions.
- [x] 3.2 GREEN/TRIANGULATE/REFACTOR — create `lib/review-policy-ordinary.ts`; keep claims immutable, resolutions separate, counters monotonic, and failures terminal.

## Phase 4: Judgment Day Reducer

- [x] 4.1 RED — add `tests/review-policy-judgment-day.test.ts` for two blind judges, zero refuters, two-round ceiling, exhaustion escalation, and ordinary-mode rejection.
- [x] 4.2 GREEN/TRIANGULATE/REFACTOR — create `lib/review-policy-judgment-day.ts` with disjoint phases, immutable mode/budget, and no third-round edge.

## Phase 5: Operations and Gates

- [x] 5.1 RED — extend `tests/review-triggers.test.ts`, `tests/review-gate.test.ts`, and `tests/gentle-ai.test.ts` for start-only routing, exact targets, fail-closed forms, replay, zero actors, and command safety.
- [x] 5.2 GREEN/TRIANGULATE/REFACTOR — update `lib/review-triggers.ts`, `lib/review-transaction.ts`, and `extensions/gentle-ai.ts` with typed controller operations, gate unions, receipt validation, and scope-child results.

## Phase 6: Actor Contracts, Docs, and Migration

- [x] 6.1 RED — update `tests/review-ledger-contract.test.ts`, `tests/sdd-preflight.test.ts`, `tests/package-manifest.test.ts`, and `tests/runtime-harness.mjs` for bounded authority, ownership, overrides, and no delivery.
- [x] 6.2 GREEN — revise `assets/agents/review-*.md`, `assets/agents/jd-*.md`, `skills/gentle-ai/SKILL.md`, `skills/judgment-day/SKILL.md`, and `README.md`; add v0.14 evidence under `assets/migrations/managed-assets-v0.14.json` and `tests/fixtures/v0.14/`.
- [x] 6.3 TRIANGULATE/REFACTOR — update `lib/sdd-preflight.ts` and `scripts/verify-package-files.mjs`; migrate only untouched package-owned contracts and preserve user routing/overrides.

## Phase 7: Verification

- [x] 7.1 Run focused `node --experimental-strip-types --test tests/review-*.test.ts`, then `pnpm test` and `node scripts/verify-package-files.mjs`.
- [x] 7.2 Trace all spec scenarios and JD-DES-001..007 to passing evidence; confirm no delivery/version mutation.

## Phase 8: Verification Remediation

- [x] 8.1 RED/GREEN — capture explicit Judgment Day mode on real non-trivial snapshots without ordinary route classification.
- [x] 8.2 RED/GREEN — bind intended-commit gates to the actual staged tree and deny stale approved targets.
- [x] 8.3 RED/GREEN — resolve push destination refs against the exact remote so same-name updates work while exact-old/create rules remain fail closed.
- [x] 8.4 RED/GREEN — journal lineage start with an idempotency key, canonical result, restart replay, and mismatch rejection.
- [x] 8.5 RED/GREEN/VERIFY — restore Judgment Day skill metadata to `1.4`, then run focused, full, package, and diff-hygiene gates without delivery.
