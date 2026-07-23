# Review diagnostic propagation handoff

The Pi adapter repair is proven: after verified package-local Gentle AI v2.1.11 provisioning, local provider inspection succeeds and an authorized fresh ordinary START returns a sanitized provider diagnostic. The raw negotiated failure payload is not exposed.

## Review first

1. Read `patch.diff` for the four-file repair.
2. Run the test-only reproduction in `reproduction.md` from a source checkout.
3. Check `validation.md` before treating the installed package as validated.

## Impact and decision

| Topic | Maintainer conclusion |
| --- | --- |
| Impact | A caller receives the operation-scoped, sanitized provider diagnostic needed to explain a failed negotiated START reconciliation. |
| Pi adapter conclusion | Repaired and proven: the post-install ordinary START reports only the sanitized `review/start` diagnostic captured in `observed-start-failure.json`. |
| Remaining native root failure | Gentle AI v2.1.11 emits only the generic `non-zero` / `operation_outcome_unknown` diagnostic. Native maintainers must add stage-level sanitized failure evidence. |
| Repair invariant | For a negotiated unknown START reconciled to `start` with no lineage, expose only sanitized diagnostics for `review/start`; never expose `native_failure` or raw payload content. |
| Source base | `v1.2.0` at `113906a34c1b527ba2d65806b7638bff32b8e916`. |
| Source branch | `fix/review-diagnostic-propagation` at `4d5214b410d352712be20917e81f9ce5974d039a`, with the repair present as working-tree changes. |

## Evidence boundary

**Proven:** the focused source regression passes; package-local Gentle AI v2.1.11 provisioning was verified; local provider inspection succeeds; and the authorized fresh ordinary START returned the sanitized diagnostic recorded in `observed-start-failure.json`.

**Native escalation required:** the remaining native failure is generic (`non-zero` / `operation_outcome_unknown`) and lacks stage-level sanitized failure evidence. Native maintainers must add that evidence before the root cause can be diagnosed.

**Authority boundary:** status reconciliation reports no lineage and action `start`. No replay is safe, and this evidence cannot authorize a commit. This bundle does not authorize creating, replaying, or inspecting a real review lineage.

## Tracker paths

- Upstream tracker #122: [`../122-receipt-tree-path-diagnostics.md`](../122-receipt-tree-path-diagnostics.md)
- Gentle AI #1248 mapping: [`../README.md`](../README.md) (the #122 row)

## Safety statement

This bundle contains no private authority material, credentials, tokens, native receipts, real review snapshots, target values, repository identities, or user identities. `patch.diff` redacts a test-only sentinel value and excludes this handoff directory, so it is a review artifact rather than an apply-ready patch.
