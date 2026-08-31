# Exploration: bounded-review-graph-parity

## Executive summary

The current implementation has a durable per-lineage revision store and explicit state reducer, but it is not yet architecturally equivalent to the target bounded-review graph in Gentleman-Programming/gentle-ai PR #1093. The principal parity gap is that the store persists mutable lineage snapshots (`HEAD` plus numbered JSON revisions), rather than a validated, predecessor-linked, content-addressed event graph with portable bundles and resumable import/export. The existing implementation also has an OS-backed exclusive lock and crash-safe publication primitives, but their scope and recovery semantics need to be made explicit and strengthened for the target lifecycle.

This is exploration only; no implementation was performed.

## Current implementation verified

Primary file: `lib/review-transaction.ts`.

- `reviewStoreRootForRepository()` resolves `git rev-parse --git-path gentle-ai/reviews`, so storage is repository-local and Git-aware. The code does not itself establish the target's exact common-directory layout or portability contract.
- `ReviewTransactionStore` stores each lineage beneath `lineages/<lineage-id>/`, with `HEAD` and `revisions/<revision>.json`; it validates schema, revision number, state hash, and HEAD/state agreement on read.
- Mutations run through `withLock()`, using `openSync(lockPath, "wx")`, writing the PID, fsyncing the lock file, and removing it in `finally`. This is an OS/filesystem exclusive-create lock, but stale-lock ownership, crash recovery, and lock durability/cleanup semantics are not represented as lifecycle invariants.
- `writeRevision()` writes a temporary revision, fsyncs it, renames it into place, fsyncs the revisions directory, then writes/fsyncs/renames `HEAD` and fsyncs the lineage directory. Fault injection exists for selected publication points and rollback removes a published revision if HEAD was not published.
- State transitions are reducer-driven and journaled with idempotency keys, request hashes, pending/completed status, and exact revision advancement checks. Pending operations block mutation/replay.
- Lineage relationships are represented in state/claims (`parent_lineage_id`, child claims), but persisted revisions are addressed by lineage and revision, not by predecessor-linked event identity.
- Canonical hashes protect JSON state, receipts, frozen ledgers, and claims. There is no discovered bundle export/import API, bundle schema, import validation pipeline, or resumable transfer checkpoint.

## Exact parity gaps against PR #1093 architecture

### 1. Predecessor-linked content-addressed event store — gap

The target requires immutable events whose identity commits to canonical event content and predecessor identity, allowing a graph/lineage to be reconstructed and independently validated. Current persistence hashes complete state snapshots and uses sequential filenames (`0.json`, `1.json`, etc.) plus a mutable `HEAD`. A revision hash is not the storage identity, and the predecessor relationship is not encoded as an event-store edge. This prevents content-addressed graph portability and leaves snapshot publication as the authoritative history mechanism.

Required design questions for the next phase: event envelope/schema, predecessor hash rules, genesis representation, event-to-state reduction, duplicate event handling, fork/merge policy, and validation of unreachable/orphan objects.

### 2. Git common-directory placement — partial / contract gap

The implementation asks Git for `gentle-ai/reviews` through `git rev-parse --git-path`, which is a good repository association mechanism. It does not demonstrate the exact PR architecture's common-dir resolution for linked worktrees, nor define which objects, locks, indexes, and bundles live in the common directory versus worktree-local paths. The architecture should make this boundary testable rather than relying on the resolved path alone.

### 3. OS-backed crash-safe locking — partial

Exclusive file creation and fsync are present. However, the current lock contains only a PID and has no owner token, acquisition timestamp, process liveness/recovery policy, or durable distinction between an active lock and a crash orphan. Cleanup is unconditional after the action, so crash behavior depends on the filesystem artifact remaining and future callers' inability to distinguish stale from active ownership. The target needs explicit lock acquisition/recovery semantics and tests for concurrent access, process death, and interrupted publication.

### 4. Validated bundle export/import — missing

No export/import surface or bundle format was found in `lib/review-transaction.ts` or the test search. The target requires bundles that carry the required event/object closure and metadata, are content-address validated before installation, reject malformed or conflicting objects, and do not mutate authoritative state until validation succeeds. Import should be atomic and idempotent, with explicit handling for already-present objects and missing predecessors.

### 5. Resume semantics — partial and not portable

The request journal supports idempotent reducer operations and blocks unresolved pending operations, which covers local retry of a known operation. It does not provide portable resume tokens/checkpoints for interrupted export/import or graph synchronization. There is no discovered durable progress model for “validated through event X, awaiting predecessor/object Y,” nor a recovery protocol that resumes without replaying unsafe side effects.

### 6. Explicit non-authoritative mirror boundary — missing / underspecified

The current store is treated as the authoritative source for reads and mutations. No separate mirror API, mirror metadata, freshness marker, replication direction, or guard preventing mirror data from authorizing lifecycle transitions was found. The target requires an explicit boundary: mirrors may cache/transport verified graph data but cannot authorize gates, fixes, terminal state, or publication. This must be encoded in types, validation, and call paths—not only documentation.

### 7. Exact lifecycle/state invariants — partial

The reducer and assertions enforce meaningful invariants: clean genesis, schema/hash validation, monotonic revisions, one pending operation, idempotency-key/request-hash consistency, receipt binding, and terminal immutability. The target's exact event-graph lifecycle invariants are not yet represented, including predecessor continuity, immutable event identity, graph completeness, import atomicity, resume state validity, authoritative-versus-mirror authority, and terminal closure across resumed processes and imported bundles.

## Recommended next phase focus

Design a canonical event graph and storage/bundle protocol first, then map existing reducer state and journal operations onto it. Treat the current snapshot store as an implementation detail or migration source, not as the target event identity. Specify authoritative and mirror APIs separately, and define crash/recovery/import invariants before task decomposition.

## Risks

- Retrofitting event identity after consumers depend on revision filenames could create incompatible history and migration ambiguity.
- Weak stale-lock handling can deadlock recovery or permit unsafe concurrent mutation after a crash.
- Importing partially validated graph data risks authoritative-state corruption unless validation and publication are strictly separated.
- Treating the existing request journal as full resume semantics would leave interrupted bundle synchronization under-specified.
