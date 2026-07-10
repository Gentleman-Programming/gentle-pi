# Proposal: Simplify 4R into a Bounded Review Transaction

## Intent

Replace repeated reviews with one content-addressed transaction and structural stopping rules.

## Scope

### In Scope

- Capture tracked and non-ignored untracked files without mutating the real Git index.
- Ordinary 4R runs one selected 0/1/4 review, at most one refuter and fix batch, a validator only after fixes, then one final verification to `approved | escalated`.
- The validator receives frozen IDs, their hash-bound canonical rows, and the fix diff; it cannot add findings, request fixes, launch actors, or iterate.
- Explicit Judgment Day replaces ordinary review and alone permits two fix/re-judgment rounds.
- SDD adds no review pass; lifecycle gates validate receipts. A real scope change uses one deterministic parent+target child with a fresh explicit budget; replay cannot reset it.

### Out of Scope

- Remote receipts, archived-spec rewrites, delivery, publication, and same-OS cryptographic attestation.

## Capabilities

### New Capabilities

- `review-transaction`: Snapshots, lineage state, mode budgets, frozen evidence, verification, receipts, persistence, and validation.

### Modified Capabilities

- `review-routing`: Restrict 0/1/4 classification to transaction start; lifecycle gates validate receipts while command safety remains independent.
- `review-orchestration`: Replace shared iteration with one-shot ordinary review and explicit, two-round-maximum Judgment Day.

## Approach

Use separate reducers over atomic Git-directory storage. Persist a request/result journal, parent+target child claims, canonical frozen rows, and explicit budgets. Receipt envelopes hash bodies binding base/complete trees, exact `review_projection`, initial/final trees, route/lenses/policy, evidence, and counters. Controller APIs alone reduce state; mismatches fail closed without same-user tamper-proof claims. Typed gates require resolved exact commit, push, PR, and release targets.

## Affected Areas

| Area | Impact |
|---|---|
| `lib/review-*.ts`, `extensions/gentle-ai.ts` | New/modified |
| Canonical specs, `assets/`, `skills/`, `README.md` | Modified |
| `tests/` | New/modified |

## Delivery Forecast

Forecast: **2,450–3,550 changed lines** versus an **800-line budget**; single-PR apply requires `size:exception` approval.

## Risks

| Risk | Mitigation |
|---|---|
| Regression/mode leakage | Separate reducers and terminal validation escalate. |
| Snapshot exposure | Permissions limit other users; redact and clean up. |
| Same-user rewrite | Outside attestation; detectable mismatches fail closed. |

## Rollback Plan

Disable transaction gates, restore prior contracts, and treat v1 receipts as inert.

## Dependencies

- Git temporary-index/object support, typed Pi APIs, and pre-apply `size:exception` approval.

## Success Criteria

- [ ] Ordinary budgets, conditional validation, final verification, and terminal states are enforced.
- [ ] Validators cannot add findings, fixes, actors, or iterations.
- [ ] Receipts bind exact context; child replay cannot refresh budgets.
- [ ] Only Judgment Day iterates, within two rounds.
- [ ] Journal replay is stable; exact resolved gate targets cross with zero actors; tests pass.
