# Frozen Findings Ledger — round 2 (graph-identity pinned-subset 4R)

- review_stage: post-apply (new lineage — prior transaction terminal escalated, not reopened)
- target: pinned root-set subset identity implementation (resolves prior RESL-001)
- snapshot (faithful, incl. untracked): 211f786c9226a9f2
- lenses: review-risk, review-reliability, review-resilience, review-readability (one sweep each; high tier — repository authority validation)
- refuter: one batch, one finding (RESL2-002) → corroborated
- correction: one transaction, 3 findings targeted → 2 fixed, 1 stopped on architecture blocker
- scoped fix-delta validator: one → verdict **approve** (2-fix delta; snapshot 211f786c, suites review-repository 7/7 + review-reset 12/12, full suite 414/414)

## Severe findings

| id | lens | severity | claim | status |
|---|---|---|---|---|
| RESL2-001 / RELY2-001 | resilience/reliability | BLOCKER/CRITICAL | Broken pin (pinned root removed via `git branch -D`) bricked the store; destructive reset depended on the same failing validation. | **fixed → verified** (resolveRepositoryAuthorityForRecoveryV1 + gated allowBrokenIdentity; quarantine+re-pin; ordinary path stays fail-closed) |
| RESL2-002 | resilience | CRITICAL | Torn-read race on concurrent first pin: loser reads partial IDENTITY, throws malformed, non-retriable. | **fixed → verified** (atomic temp+fsync+linkSync install; bounded parse-only retry) |
| RISK2-001 | risk | CRITICAL | Bundle import spoofable via fetched victim roots + forged IDENTITY; import omits common_directory binding the transaction gate enforces. | **OPEN — escalated** (architecture: needs cross-repo trust primitive; common_directory differs across clones so the bounded fix would break portability; gentle-ai bundle.go uses a structurally different model with no portable field to mirror) |

## Non-blocking info rows (never drive correction)

RELY2-002 (WARN): no test for the three malformed-IDENTITY fail-closed branches.
RELY2-003 (SUGG): linked-worktree reverse-order pin untested.
RESL2-003 (WARN): fsync calls outside the try/catch break the ReviewRepositoryError type contract.
RISK2-002 (WARN): transplant test only covers disjoint histories, not fetched-root ingestion (the RISK2-001 vector).
READ2-001 (WARN): third drifted OBJECT_ID regex.
READ2-002 (WARN): duplicate write-once durability pattern vs installImmutable.
READ2-003 (SUGG): test repo bootstrap duplicated instead of reusing helper(t).

## Transaction terminal state: **escalated**

RISK2-001 remains open and is genuine architecture, not a bounded-correction gap. No further review/refuter/correction/validation runs under this transaction. The cross-repo bundle-trust model requires an explicit design decision (candidate: signed identity / trust list / physical-path binding à la gentle-ai bundle.go), tracked as a separate change. Maintainer decision pending on whether to defer graph-v1 identity from the parity release.
