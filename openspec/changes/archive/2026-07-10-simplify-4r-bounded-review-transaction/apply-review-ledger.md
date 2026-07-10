# Apply Review Ledger

Round: 2/2 — JD-APP-001, JD-APP-003, and JD-APP-010 fixed; final scoped re-judgment pending

| id | severity | status | evidence |
|---|---|---|---|
| JD-APP-001 | BLOCKER | fixed | Runtime uses a linear, constant-token-space lifecycle scan with no command-distance cap; shell line continuations and long valid direct/wrapped forms fail closed before execution. |
| JD-APP-002 | BLOCKER | fixed | Generic mutation is no longer exposed; persisted authority advances only through exact ordinary/Judgment Day reducer transitions or the exact gate controller. |
| JD-APP-003 | CRITICAL | fixed | Push gates resolve each destination ref's current state: create requires absence, while update requires the exact declared old object before object→peeled-commit→tree validation. |
| JD-APP-004 | CRITICAL | fixed | Snapshot capture resolves repository root, uses a durable isolated object store plus temporary index, survives live GC, and carries explicit terminal cleanup policy. |
| JD-APP-005 | CRITICAL | fixed | Frozen rows normalize severe/info semantics fail closed and ordinary discovery rejects rows outside selected lenses. |
| JD-APP-006 | CRITICAL | fixed | Ordinary exposes explicit no-fix escalation and automatically advances corroborated zero-fix-budget state to final verification. |
| JD-APP-007 | CRITICAL | fixed | Snapshot computes diff evidence/route/lenses and state creation verifies and consumes that derived binding instead of caller routing. |
| JD-APP-008 | CRITICAL | fixed | Pending reducer operations complete atomically and replay; child claims publish in the same parent revision/journal transaction. |
| JD-APP-009 | CRITICAL | fixed | Named judges and Judgment Day contracts distinguish initial discovery from controller-requested scoped re-judgment. |
| JD-APP-010 | CRITICAL | fixed | README commit/push/PR guidance now requires approved receipt plus exact typed target with zero actors; the stale fresh-context review-lens instruction is contract-forbidden. |

## Round 1 verification

- Focused review/runtime tests: 80/80 passed.
- Full package tests: 337/337 passed plus runtime harness.
- Package resource verification: 49 files passed.
- `git diff --check`: passed.

## Round 2 fix verification

- Safety net before Round 2 edits: 28/28 focused tests passed.
- RED: lifecycle continuation, drifted push destination, and stale README contract assertions failed before implementation.
- Focused review/runtime tests: 80/80 passed.
- Full package tests: 337/337 passed plus runtime harness.
- Package resource verification: 49 files passed.
- `git diff --check`: passed.
- Status remains `fixed` pending final scoped re-judgment; no row is marked `verified` here.
