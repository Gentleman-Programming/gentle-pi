# Frozen Findings Ledger — post-apply 4R review

- review_stage: post-apply
- target: full uncommitted working tree of bounded-review-graph-parity implementation
- base HEAD: bd1f0a6a
- tracked-diff snapshot: sha256 prefix 4dd5bfdc545d9746 (1886 diff lines) + 22 untracked files (11 libs, 11 test files)
- lenses run: review-risk, review-readability, review-reliability, review-resilience (one exhaustive sweep each; full-4R tier: release path + >400 authored changed lines)
- refuter: NOT invoked — zero inferential severe findings; all severe findings deterministic → corroborated directly
- correction budget: one correction transaction (consumed) — 5 of 6 findings fixed, RESL-001 stopped on spec conflict
- scoped fix-delta validator: one (consumed) — verdict **approve** on fix delta (post-correction snapshot 488958b6359d4441, suite 408/408); one INFO note appended (review-lock.ts:89-99 — power-loss crash between mkdir and rename leaves an orphaned stale-* directory requiring manual quarantine cleanup; narrow residual, non-blocking)
- final statuses: RISK-001 verified · RISK-002 verified · RELY-001 verified · RESL-002 verified · RESL-003 verified · RESL-001 **open (corroborated, uncorrected)**
- transaction terminal state: **escalated** — RESL-001 requires an explicit maintainer architecture decision (repository-identity model: root-commit portability vs common-dir stability vs pinned-subset hybrid; see apply-progress.md correction unit 4). No further review, refuter, correction, or validation may run under this transaction.

## Severe findings (drive correction)

| id | lens | location | severity | claim | evidence_class | status |
|---|---|---|---|---|---|---|
| RISK-001 | risk | lib/review-transaction.ts:2154-2214, :1752-1786; extensions/gentle-ai.ts:2261-2296 | BLOCKER | Release fast path resolves the "current immutable origin/main SHA" via `git ls-remote` against a caller-supplied `evidence.remote` string never checked against the repository's configured `origin`; an attacker-controlled endpoint can report any SHA, defeating the fast path's core security property. | deterministic | corroborated |
| RISK-002 | risk | extensions/gentle-ai.ts:2271-2296; lib/review-transaction.ts:2205-2207 | BLOCKER | "CI successful for exact SHA" is enforced only by comparing caller-supplied JSON fields; no independent CI verification exists, so `{ci:{status:"success"}}` self-reports satisfy the gate. | deterministic | corroborated |
| RESL-001 | resilience | lib/review-repository.ts:100-116; lib/review-object-store.ts:105-111; lib/review-transaction.ts:748-750 | BLOCKER | `repository_id`/`authority_id` recomputed on every call from `git rev-list --max-parents=0 --all`; any new unrelated root commit (orphan branch, subtree merge) changes the identity and permanently orphans the graph-v1 store, with destructive reset as the only recovery. | deterministic | corroborated |
| RESL-002 | resilience | lib/review-lock.ts:42-47,116-130; extensions/gentle-ai.ts:2930,2937,2950,2980,3003,3017,3023,3086 | BLOCKER | Production never supplies `mutationLockPlatform`; default `UNQUALIFIED_PLATFORM.moveNoReplace()` unconditionally throws, so lock `recover()`/`recoverIncomplete()` can never succeed in production — a crash while holding the mutation lock permanently wedges all review-store mutations. Working adapter exists only in test fixtures. | deterministic | corroborated |
| RESL-003 | resilience | lib/review-object-store.ts:85-97,124-133,136-141; lib/review-reset.ts:160-162; lib/review-bundle.ts:220-230 | CRITICAL | Generation-0 (genesis) 3-slot CURRENT publication has a crash window (1 of 3 slots written) where `readQuorum()` fails forever and both exposed recovery operations (repair, reset-resume) call `readQuorum()` first and throw identically — no automated path reconstructs the pointer from the durably-installed root-set object. | deterministic | corroborated |
| RELY-001 | reliability | lib/review-transaction.ts:2152,2177-2183; tests/review-gate.test.ts:1682-1715 | CRITICAL | "Major release" fast-path denial fires only for `vX.0.0`; for a pre-1.0 project (this repo is 0.15.0) the branch is unreachable, so breaking `v0.x.0` releases traverse the fast path without the extraordinary review the contract promises. Only `v2.0.0` is tested. | deterministic | corroborated |

## Non-blocking info rows (never drive correction or block approval)

| id | lens | severity | claim (abridged) |
|---|---|---|---|
| RELY-002 | reliability | WARNING | Authority identity derived from all-refs root-commit set is availability-fragile under ordinary git workflows (overlaps RESL-001 root cause). |
| RELY-003 | reliability | WARNING | Graph-replay validator special-cases `operation-prepared`/`gate` via object-spread instead of recomputing through the real reducer; no adversarial tampering test exists for those branches. |
| RESL-004 | resilience | WARNING | `resolveRemoteGateRef` spawns `git ls-remote` with no timeout; a hung remote blocks the release gate indefinitely instead of failing closed in bounded time. |
| READ-001 | readability | WARNING | review-transaction.ts (~2300 lines) mixes four concerns; triple-nested unnamed ternary classifies graph event kinds (:1627-1644). |
| READ-002 | readability | SUGGESTION | Fast-path block appended at file tail rather than fitting existing sectioning. |
| READ-003 | readability | WARNING | Duplicate canonical-JSON/SHA-256 implementations (private canonicalHash vs shared review-canonical.ts). |
| READ-004 | readability | WARNING | Two git-root resolutions; release gate uses the older, less-hardened one (no env sanitation, no -C). |
| READ-005 | readability | WARNING | `reviewStoreRootForRepository` and `reviewStoreRootForRepositoryV1` both exported with zero callers. |
| READ-006 | readability | WARNING | `validateReviewGate` / `validateAuthoritativeReviewGate` byte-identical duplicate exports. |
| READ-007 | readability | WARNING | Two divergent path-confinement implementations (component-wise vs single-shot realpath). |
| READ-008 | readability | WARNING | Two bare undocumented error codes (`REVIEW_RECEIPT_EPOCH_MISMATCH`, `REVIEW_BUNDLE_EPOCH_MISMATCH`) inconsistent with surrounding descriptive throws. |
| READ-009 | readability | SUGGESTION | Test-only module-global lock-platform setter silently alters production factory behavior once imported. |
