# Design: Simplify 4R into a Bounded Review Transaction

## Technical Approach

Implement a local content-addressed transaction with separate ordinary and Judgment Day reducers. A bound snapshot drives routing and exact candidate review. Only controller APIs transition state or mint receipts; actor output is untrusted data with no authorization effect.

## Architecture Decisions

| Decision | Choice and rationale | Rejected tradeoff |
|---|---|---|
| Snapshot | Isolated Git objects/index capture `base_tree` and `complete_snapshot_tree`. A bound `review_projection` (`complete` or resolved `intended-commit`) selects the exact `initial_review_tree`; start records route/lenses/policy from the base-to-complete diff. | Conflating the full workspace with an intended commit makes partial delivery unverifiable. |
| Policies | `lib/review-policy-{ordinary,judgment-day}.ts` expose disjoint transitions over shared primitives. | One guarded reducer leaves iterative edges reachable. |
| Trust | State/receipts live below `git rev-parse --git-path gentle-ai/reviews`; mirrors are non-authoritative. Hash/chain mismatches fail closed. `0700`/`0600` and unkeyed hashes do not prevent coherent same-user rewrites; stronger isolation/attestation is out of scope. | Claiming shell-capable same-user actors cannot forge local files. |
| Replay | Locks, immutable revisions, fsynced `HEAD`, and a persisted request/result journal make exact retries stable. Reused keys with another request and unresolved pending operations fail closed. | A last-key field loses completed results after later revisions. |
| Scope | `child_lineage_id = SHA-256(canonical(parent_lineage_id, target_tree))`. An atomic parent-scoped target claim returns the same child on replay; that child receives one explicit fresh budget. | Replayable tokens can fan out lineages and reset counters. |

## Data Flow

```text
working tree ─snapshot/projection─> initial review tree ─reducer─> final candidate
        base/complete/route/policy ───────────────┘             │
resolved gate target ─controller validation─> receipt body/envelope + journaled result
```

Ordinary runs one route-bound `0|1|4` lens set, freezes canonical rows, and permits at most one inferential refuter and fix batch. After fixes, one validator receives only requested IDs, their exact hash-bound frozen rows, and the fix diff. Resolutions are separate records; changed claims, new work, regression, or repetition escalates. Both paths run one final verification.

Judgment Day is explicit at `start`: two blind judges, zero refuters, and at most two fix/re-judgment rounds. Ordinary cannot change mode or re-judge.

## Interfaces / Contracts

Runtime values use const-object-derived types and flat interfaces:

```text
StateV1: schema, lineage_id, parent_lineage_id?, mode, revision, phase,
base_tree, complete_snapshot_tree, review_projection, initial_review_tree,
current_candidate_tree, final_candidate_tree?, route, lenses, policy_hash,
frozen_ledger?, evidence_hash, budget, counters, request_journal, terminal_state?

CanonicalFrozenRowV1: id, lens, location, severity, status_at_freeze,
evidence_class, evidence_claim
FrozenLedgerV1: canonical ID-sorted rows, frozen_ledger_hash
RequestJournalEntryV1: operation, idempotency_key, request_hash,
pending_authorization?, status, canonical_result?
ChildClaimV1: parent_lineage_id, target_tree, child_lineage_id, budget

ReceiptBodyV1: schema, lineage/mode, base_tree, complete_snapshot_tree,
review_projection, initial_review_tree, final_candidate_tree, route/lenses/policy_hash,
frozen_ledger_hash, evidence_hash, budget/counters, terminal_state
ReceiptEnvelopeV1: body, receipt_hash
```

`receipt_hash` is SHA-256 of canonical `ReceiptBodyV1`; the envelope is never its own preimage. Frozen row and store hashes are recomputed before use; any integrity error escalates. Exact journal replay returns its stored result.

An `as const` `GATE_TARGET_KIND` keys `GateTargetByKind`; `GateTargetV1 = GateTargetByKind[keyof GateTargetByKind]`. Branches contain: intended commit tree; stable-ordered push updates with source/destination refs and exact object/peeled-commit/tree IDs; PR base/head refs, commits, and trees; or release tag ref/object, peeled commit, and tree. Push updates are const-tagged `create | update`; create binds explicit absent-old plus new identity, while update binds both sides. Every present value must resolve—no `HEAD` fallback. Commit/PR-head/release/new-push trees must equal `final_candidate_tree`; PR base and updated-push old trees must equal `base_tree`. Delete, unsupported, ambiguous, or unresolved forms fail closed. The journaled result binds canonical target hash. Gates launch zero actors and remain subordinate to dangerous-command policy.

## File Changes

| Files | Action | Purpose |
|---|---|---|
| `lib/review-{snapshot,transaction,policy-ordinary,policy-judgment-day}.ts` | Create | Snapshot, store, schemas, reducers. |
| `lib/review-triggers.ts`, `extensions/gentle-ai.ts` | Modify | Typed operations, exact gates, safety composition. |
| `assets/`, `skills/`, `README.md` | Modify | Bounded actor/orchestrator contracts. |
| `lib/sdd-preflight.ts`, migration/package files | Modify | Managed-contract rollout. |
| `tests/review-*.test.ts`, contract/runtime tests | Create/Modify | Invariants and negative gates. |

## Testing Strategy

Strict TDD covers Git/index immutability, route bindings, journal replay/restart, receipt preimages, frozen-row tampering, fsync/lock faults, deterministic child replay/budgets, reducer ceilings, and exact/unresolved gate targets. Finish with `pnpm test` and package verification.

## Migration / Rollout / Rollback

Old ledgers remain audit-only; unknown receipts fail closed. Update only package-owned v0.14 assets; leave archives/overrides untouched. Rollback disables gates and leaves v1 stores inert. Remote/cross-clone validation escalates.

## Risks

- Coherent same-user store forgery may be undetectable without external isolation; local integrity checks are not attestation.
- Crashed active transactions retain sensitive snapshots until recovery cleanup.
- Replicated prose or shadowed actor overrides may retain obsolete authority; parity and output validation fail closed.

## Open Questions

None.
