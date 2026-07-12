# Delta for Review Transaction

## ADDED Requirements

### Requirement: Typed fail-closed recovery when reset state is absent

RECOVER MUST return a stable typed fail-closed controller outcome when authority reports `reset-in-progress` but `control/reset-state.json` is absent. The outcome MUST indicate that durable reset state is unavailable, MUST NOT infer authorization or fabricate recovery state, and MUST perform no authority, receipt, journal, or reset-state mutation.

#### Scenario: Missing durable reset state

- GIVEN authority reports `reset-in-progress`
- AND `control/reset-state.json` is absent
- WHEN RECOVER is requested
- THEN RECOVER MUST return the typed reset-state-unavailable fail-closed outcome
- AND MUST NOT authorize, resume, reset, delete, rewrite, or otherwise mutate authority
- AND MUST preserve all existing receipts and journal state

#### Scenario: Exact retry stability

- GIVEN the same `reset-in-progress` authority remains and `control/reset-state.json` remains absent
- WHEN the identical RECOVER request is retried
- THEN it MUST return the same typed outcome and equivalent deterministic result
- AND MUST perform no additional mutation

## MODIFIED Requirements

### Requirement: Atomic lineage and receipt authority

Each mutation MUST atomically append `{operation, idempotency_key, request_hash, status, authorization?, canonical_result?}` to the persisted journal. Exact key+request replay returns its stored result across revisions/restarts; mismatch or unresolved pending work fails closed. `ReceiptEnvelopeV1` holds body plus `SHA-256(canonical(body))`; the body excludes the hash and binds lineage/mode, base/complete trees, exact `review_projection`, initial/final trees, route/lenses/policy, ledger/evidence hashes, budget/counters, and terminal state. Write/integrity failure preserves prior authority. Candidate-aware controller routing MUST preserve this authority contract: identical candidate binding reuses the existing terminal result, while a materially different candidate starts one fresh lineage without mutating the old receipt.
(Previously: atomic authority covered transaction replay and scope changes but did not specify shared-terminal candidate routing or absent reset-state RECOVER behavior.)

#### Scenario: Different candidate preserves prior authority

- GIVEN an approved or terminal receipt for candidate A
- AND candidate B has a materially different complete binding in the same Git common directory
- WHEN B is routed to fresh compact START
- THEN A's receipt and journal history MUST remain intact and gate-validatable
- AND B MUST receive at most one newly created lineage for its exact request

#### Scenario: Missing reset state is not a mutation

- GIVEN RECOVER observes `reset-in-progress` without durable reset state
- WHEN it returns its typed fail-closed result
- THEN no lineage, receipt, journal entry, authorization, or reset-state file MUST be created or changed

## Acceptance Criteria

All scenarios MUST be covered by strict-TDD regression tests run with `pnpm test`.
