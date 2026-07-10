# Design Review Ledger

| id | severity | status | evidence |
|---|---|---|---|
| JD-DES-001 | BLOCKER | verified | State lacks authoritative idempotency request/result journal. |
| JD-DES-002 | BLOCKER | verified | Receipt hash is self-referential without a hash-excluded body/envelope. |
| JD-DES-003 | BLOCKER | verified | Scoped validator lacks immutable canonical row claims/evidence. |
| JD-DES-004 | BLOCKER | verified | Actor/controller authority boundary is overstated and unenforceable against same-user shell access. |
| JD-DES-005 | CRITICAL | verified | Scope-change child lineage can be replayed to reset budgets. |
| JD-DES-006 | CRITICAL | verified | Gate targets do not bind exact push ref updates, PR head/base, or release tag/commit. |
| JD-DES-007 | CRITICAL | fixed | Receipt body now binds exact `review_projection` with the snapshot/state routing context. |

Fix rounds used: 2 of 2. Final scoped re-judgment: pending.
