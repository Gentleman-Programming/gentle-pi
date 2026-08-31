# Proposal: Complete Native Review Lifecycle

## Intent

Complete the already-landed gentle-ai review parity with a minimal frozen-ledger lifecycle that preserves quality while bounding discovery, correction, agent calls, and tokens. Genesis scope is immutable; review may identify one finite correction set, not create an iterative review loop.

## Scope

### In Scope

- Implement and test only the immutable genesis path set.
- Run exactly one initial defect-discovery review and freeze only accepted blocking finding IDs.
- Permit at most one correction, restricted to frozen IDs and original paths.
- Run one post-fix validation using the original acceptance tests plus correction-specific regression proof, with no broad defect discovery.
- Record later observations as non-blocking follow-ups that cannot expand scope or trigger correction.
- Reject, revert, or escalate when correction breaks an original criterion.
- Remove ordinary-review assertions, fixtures, and agent language that still authorize fix-line review or another scoped review pass.

### Out of Scope

- New schema generations or migrations.
- New operation journals, checkpoints, lineage discovery, retirement, or causality taxonomies.
- New seals, gate producers, bundle behavior, or archive behavior.
- Broad black-box permutations or any second discovery/fix cycle.
- Changes to the explicit Judgment Day lifecycle.
- Removal of published-version migration fixtures that still have a live forced-sync consumer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-transaction`: Bind ordinary review to immutable genesis paths, one frozen blocking set, one optional correction, and targeted non-discovery validation.
- `review-orchestration`: Record post-freeze observations as non-blocking follow-ups and prevent them from scheduling new review or correction work.

## Approach

Reuse the existing repository-derived graph-v1/CAS authority, semantic chain, exact append idempotency, resume, receipts, gates, and bundles unchanged. Bind correction to genesis paths and frozen IDs, replace ordinary fix-line review with targeted acceptance/regression evidence, and record follow-ups inside inert validation evidence rather than adding a review transition. Preserve the accepted single-PR `size:exception`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `lib/review-snapshot.ts` | Modified | Persist canonical genesis paths with the immutable snapshot identity |
| `lib/review-transaction.ts` | Modified | Bind state, events, replay, and receipts to genesis paths and follow-ups |
| `lib/review-policy-ordinary.ts` | Modified | Enforce correction and targeted-validation invariants |
| `extensions/gentle-ai.ts` | Modified | Accept and report the minimal lifecycle evidence |
| Ordinary validator/orchestrator/skill assets | Modified | Remove fix-line review language and require targeted evidence |
| Existing review contract, policy, transaction, and controller tests | Modified | Replace broad-review assertions; remove tests for discarded transitions |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Validation becomes a second review | Medium | Restrict evidence to original acceptance tests and correction-specific regression proof |
| Correction expands scope | Medium | Reject before append using canonical genesis paths and frozen IDs |
| Existing graph/receipt compatibility regresses | Low | Extend existing v1 bodies without changing authority, retry, resume, gate, or bundle semantics |

## Rollback Plan

Revert lifecycle commits together; retain existing graph-v1 stores and behavior without migration.

## Dependencies

- Approved Gentleman-Programming/gentle-ai#1104.
- Existing gentle-pi review parity landed by `52f60d97`, `c13b677e`, and `bd1f0a6a`.
- Existing gentle-pi graph-v1 review lifecycle.

## Success Criteria

- [ ] Genesis paths never expand; correction maps exactly to frozen accepted blocking IDs.
- [ ] One discovery review and at most one correction are enforced.
- [ ] Post-fix validation runs original acceptance tests plus focused regression proof without broad discovery.
- [ ] Later observations remain non-blocking; original-criterion regressions reject, revert, or escalate.
- [ ] No ordinary agent, assertion, fixture, or transition retains fix-line review or another scoped review pass.
- [ ] Existing retry, resume, receipt, gate, and bundle behavior remains compatible.
