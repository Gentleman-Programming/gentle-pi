# Proposal: Bounded Review Graph Parity

## Intent

Bring Gentle Pi's durable review transaction storage into truthful architectural parity with the bounded-review graph model represented by Gentleman-Programming/gentle-ai PR #1093.

The change will replace mutable snapshot history as the authority with an immutable, predecessor-linked, content-addressed event graph. It will establish an exact Git common-directory authority boundary, crash-safe single-writer mutation, validated portable bundle export/import, durable graph-v1 resume semantics, explicit non-authoritative mirrors, and enforceable lifecycle and gate invariants.

Legacy review authority will not be translated or preserved as authority. When legacy state is detected, review operations fail closed until an operator explicitly confirms a logical reset. That reset durably retires legacy authority with a marker, creates a fresh graph-v1 store epoch/incarnation, leaves legacy bytes untouched as inert audit evidence, rejects legacy and prior-incarnation receipts and bundles, and requires a completely fresh review before any gate can pass.

This proposal defines product and architectural outcomes only; it does not implement them or promise compatibility with legacy storage layouts, authority, receipts, or native interfaces.

## Problem and current-state gap

The current review store has durable lineage revisions, canonical state hashes, reducer-driven transitions, idempotency journaling, exclusive-create locks, and careful fsync/rename publication. These are useful foundations, but the persisted authority is still a mutable lineage snapshot sequence (`HEAD` plus numbered revisions), not an independently verifiable event graph.

As a result:

- persisted revision location is not derived from immutable event identity;
- predecessor continuity is not the authoritative history relation;
- the exact shared boundary across linked Git worktrees is implicit rather than contractual;
- interrupted mutation and conservative recovery are not specified for the graph authority model;
- review history cannot be exported and imported as a fully validated portable closure;
- local idempotent retry does not provide portable, durable graph-v1 synchronization resume;
- mirror data has no explicit type or authority restriction;
- lifecycle and delivery gates cannot yet prove that their decisions came from a complete authoritative graph; and
- legacy authority has no explicit fail-closed retirement path that prevents old receipts or approvals from being reused after graph-v1 activation.

This gap matters because review approval, escalation, and delivery gates are authority-bearing operations. Their history must survive process failure, worktree changes, and controlled transfer without silently changing the reviewed lineage or granting authority to incomplete, cached, or retired data.

## Product outcome

After this change, a caller using graph-v1 review transactions can:

1. create and advance a review lineage whose authoritative history is an immutable chain of content-addressed events;
2. reopen or resume the same graph-v1 lineage after interruption without rerunning completed review actors, resetting bounded budgets, or changing frozen claims;
3. use linked worktrees while sharing exactly one authoritative review graph and lock domain in the repository's Git common directory;
4. export a portable bundle and import it elsewhere only after the complete required object closure and all invariants have been validated;
5. use mirrors for verified caching or transport without allowing mirror state to authorize transitions, receipts, fixes, gates, or delivery; and
6. receive clear diagnostics when legacy state blocks operation, explicitly retire that authority through a target-bound logical reset, retain the legacy bytes as inert audit evidence, and then begin a completely fresh review in a new epoch/incarnation with no inherited authority.

## Scope

### 1. Authoritative predecessor-linked event graph

Define and adopt an immutable graph-v1 event envelope whose content address commits to canonical event data and its predecessor identity. The authoritative lineage head points to an event identity; lineage state is reconstructed or verified by deterministic reduction over the predecessor chain.

The first slice includes:

- canonical event encoding and deterministic identity;
- an explicit genesis representation;
- predecessor continuity and lineage identity validation;
- immutable object installation with duplicate-content idempotency;
- detection and rejection of identity/content conflicts, missing predecessors, cycles, invalid forks, and unreachable authority candidates;
- deterministic state reduction and state-hash verification; and
- a bounded, authoritative head/index publication mechanism that never rewrites event objects.

The existing bounded-review policy—frozen ledger rules, receipts, request identity, bounded actor/refuter/validator counts, terminal states, and gate bindings—remains the behavioral source for new graph-v1 reviews. No legacy authority or consumed budget is carried into graph-v1.

### 2. Exact Git common-directory boundary

Make the repository authority boundary explicit and testable. Authoritative graph-v1 event objects, lineage heads/indexes, transaction journals, locks, retirement markers, and import/resume metadata resolve beneath the exact Git common directory so linked worktrees share one authority and one concurrency domain.

Worktree-local state may contain disposable caches or presentation data only. It must not become an alternative authority. Bare repositories, linked worktrees, relocated worktrees, and unsupported or non-Git contexts must have deterministic behavior and fail closed when the authoritative boundary cannot be established.

### 3. Crash-safe single-writer mutation

Provide OS-backed mutual exclusion for authoritative graph-v1 mutation, import, reset, and recovery operations. Concurrent mutation must be rejected or serialized, and ambiguous ownership or interrupted publication must fail closed rather than risk competing authority.

Publication must leave either the previous valid graph-v1 authority or the next fully valid graph-v1 authority observable—never a partially authoritative transition. Recovery must be idempotent and must not consume a fresh review, refutation, validation, fix, or lifecycle budget. This proposal does not prescribe a cross-process write-fencing protocol or expose one as a compatibility contract.

### 4. Explicit logical legacy reset

Before graph-v1 activation, use bounded detection at the exact Git common-directory boundary to determine whether known legacy review authority exists. Detected or ambiguous legacy state blocks graph-v1 initialization and every authority-bearing operation until an explicit logical reset completes.

When legacy authority is detected:

- fail closed before graph-v1 initialization or gate evaluation;
- report what legacy authority was found, why it cannot be trusted by graph-v1, which authority-bearing artifacts will be retired, and the exact explicit reset action required;
- never run the reset implicitly, during startup, as a side effect of another command, or from ambiguous confirmation;
- require a deliberate logical reset request with clear confirmation tied to the exact repository/common-directory target;
- perform reset under the authoritative mutation lock;
- durably publish a retirement marker that prevents legacy state from being selected as authority;
- create a fresh store epoch/incarnation and initialize an empty graph-v1 authority in a separate namespace;
- leave every legacy file and directory untouched in place as inert, inspection-only audit evidence, with no recursive deletion, quarantine, enumeration, traversal, or other legacy filesystem mutation;
- ensure authority-bearing graph-v1 operations never consult retired bytes and that later retired-byte drift cannot select, block, invalidate, or advance current authority;
- record enough non-authoritative reset diagnostics to explain the authority transition without preserving reusable approvals, receipts, ledgers, bundles, checkpoints, or counters;
- reject all legacy and prior-incarnation receipts, approvals, escalations, ledgers, findings, frozen hashes, lifecycle state, request journals, review/refuter/validator/fix counters, bundles, checkpoints, roots, events, and gate evidence; and
- require a completely fresh graph-v1 review from genesis in the current epoch/incarnation before any lifecycle or delivery gate can pass.

A reset never derives graph events from legacy revisions, never preserves lineage continuity, never credits prior review work, never restores authority from retired data, and never mutates legacy files or directories.

### 5. Validated portable graph-v1 bundle export/import

Introduce a versioned portable bundle that carries declared graph-v1 roots, the required predecessor/object closure, lineage metadata, and integrity information.

Export must produce a deterministic, self-describing bundle from authoritative graph-v1 data. Import must stage and validate the entire bundle before changing authoritative indexes or heads. Validation includes schema/version support, canonical encoding, object identity, predecessor closure, lineage consistency, lifecycle invariants, duplicate/conflict handling, and declared-root completeness.

Installation is atomic and idempotent. Already-present identical objects are accepted; conflicting objects, malformed metadata, missing predecessors, incomplete closure, invalid authority claims, and unsupported versions are rejected without changing authoritative state. Import cannot bypass a detected legacy-state block or serve as a legacy reset.

Bundle integrity does not imply sender authenticity. Cryptographic signing, remote identity, and trust policy are outside this first slice unless a later specification adds them explicitly.

### 6. Durable resume for graph-v1

Persist sufficient authoritative progress to resume interrupted graph-v1 transaction mutation, recovery, export, and import. Resume continues from validated graph and checkpoint state rather than replaying completed actor work or recreating a transaction.

The following remain stable across graph-v1 resume:

- lineage and event identities;
- initial review tree and complete snapshot tree bindings;
- frozen ledger hash and frozen claims;
- actor selection and invocation counts;
- refuter, validator, and fix-round consumption;
- approved or escalated terminal outcome;
- graph-v1 receipts and exact typed gate targets; and
- import/export validation progress where safely reusable.

A checkpoint may skip only work whose inputs and validated content identities still match. Ambiguous, conflicting, or tampered progress fails closed; it cannot silently reset budgets or create a replacement lineage. Resume applies only to graph-v1 state created after reset or in a repository with no legacy authority.

### 7. Explicit non-authoritative mirrors

Define mirrors as a separate capability and data boundary. A mirror may cache, replicate, inspect, or transport verified graph-v1 event objects and bundles. It may report freshness and completeness relative to declared roots.

A mirror cannot:

- advance an authoritative head;
- authorize lifecycle transitions, fixes, approvals, escalations, receipts, gates, delivery, or publication;
- satisfy completeness solely from an unverified cache claim;
- overwrite or conflict with an authoritative object; or
- preserve, restore, or reactivate retired legacy authority.

Promotion from mirror data requires the same authoritative graph-v1 import validation and locking path as any other bundle. Types and call paths must make authority explicit rather than relying on naming or documentation alone.

### 8. Lifecycle and gate invariants

Encode and enforce at least these invariants:

- every non-genesis authoritative graph-v1 event has exactly one valid predecessor in the same lineage;
- event identities are canonical, immutable, and content-addressed;
- authoritative heads reference complete, valid, reducible histories;
- frozen findings and their hash-bound claims never mutate; later outcomes are separate records;
- actor output is untrusted and cannot itself authorize transitions;
- bounded review, refutation, validation, and fix budgets are monotonic and cannot reset on retry, graph-v1 resume, import, or process restart;
- ordinary review terminates only as approved or escalated under the bounded transaction contract;
- Judgment Day remains a distinct explicitly selected lineage and cannot be silently substituted or appended;
- a no-fix path runs no validator, a fix path uses only the permitted scoped validator, and final verification occurs exactly once per ordinary graph-v1 lineage;
- imported or resumed terminal graph-v1 state cannot reopen or mutate;
- mirrors never establish authority;
- pre-activation legacy detection blocks every authority-bearing graph-v1 operation until explicit logical reset completes;
- logical reset durably retires prior authority under a fresh epoch/incarnation, leaves legacy bytes untouched, and cannot itself create an approval, receipt, or passing gate;
- legacy and prior-incarnation receipts, bundles, checkpoints, roots, and events are denied as authority;
- no gate passes until a fresh post-reset graph-v1 review in the current incarnation produces a valid approved receipt for the exact typed target;
- lifecycle gates validate an approved authoritative graph-v1 receipt against the exact typed target with zero review actors; and
- commit, push, PR, release, and publication remain outside review transaction execution.

## Legacy transition contract

The legacy transition is logical authority retirement, not conversion, erasure, quarantine, or coexistence:

1. repositories with no legacy review authority may initialize graph-v1 normally;
2. repositories with detected legacy authority fail closed and remain unchanged until explicitly reset;
3. diagnostics identify the authority impact, retained audit evidence, and exact target before confirmation;
4. confirmed reset durably publishes a retirement marker and selects a fresh empty graph-v1 epoch/incarnation under exclusive mutation control;
5. legacy bytes remain untouched in their original locations and are never recursively deleted, quarantined, enumerated, traversed, or used by authority-bearing operations;
6. incomplete marker, initialization, or selector publication leaves all authority-bearing operations blocked and recoverable only through explicit forward operator action;
7. successful reset permanently rejects every legacy or prior-incarnation receipt, bundle, approval, ledger, lineage, journal, checkpoint, root, event, and counter as gate evidence; and
8. the first passing gate after reset requires an entirely new graph-v1 review and a new receipt bound to the current epoch/incarnation and exact target.

There is no compatibility window, parallel authority, automatic conversion, authority-preserving fallback reader, or downgrade path that restores retired review authority. Retained legacy bytes are inspection-only audit evidence, not a rollback source or alternative authority.

## Affected areas

- `lib/review-transaction.ts` graph-v1 storage, reduction, recovery, reset detection, and transaction surface;
- storage schemas and canonical hashing utilities;
- Git repository/common-directory resolution;
- authoritative mutation locking and crash publication paths;
- explicit logical-reset command/API, repository-target confirmation, durable retirement marker, fresh epoch/incarnation initialization, selector publication, and interruption recovery;
- bounded legacy-root detection and inspection-only drift diagnostics with no recursive traversal or mutation;
- bundle serialization, validation, staging, installation, export, and resume checkpoints;
- mirror-facing APIs and authority-typed call paths;
- lifecycle receipts and commit/push/PR/release gate validation;
- rejection of legacy and prior-incarnation receipts, bundles, checkpoints, and other authority-bearing artifacts after confirmed reset;
- fault-injection, concurrency, linked-worktree, portability, corruption, logical-reset, legacy-byte immutability, and lifecycle invariant tests; and
- operator/user documentation for storage location, logical-retirement consequences, retained audit evidence, recovery, bundles, and the requirement for fresh review.

## Out of scope / non-goals

- translating legacy revisions, lineages, approvals, receipts, ledgers, findings, journals, or counters into graph-v1;
- retaining legacy authority as a read-authoritative fallback, rollback source, parallel store, or gate input;
- silently resetting legacy state or inferring consent from startup, import, resume, or another operation;
- preserving review credit, approval status, consumed budgets, lineage identity, or gate eligibility across logical reset;
- promising compatibility with legacy private storage layouts, direct filesystem consumers, native interfaces, or older writers;
- changing the intended ordinary graph-v1 review policy, actor counts, refuter policy, validator scope, terminal outcomes, or delivery-gate behavior;
- adding extra review passes merely because SDD, reset, export, import, or resume occurred, except that logical reset necessarily requires one entirely fresh review because prior authority is retired;
- allowing review transactions to perform commit, push, PR creation, release, or publication;
- replacing independent dangerous-command safety;
- distributed consensus, multi-primary writes, automatic conflict merging, or eventual-consistency authority;
- prescribing a distributed or lease-based write-fencing protocol;
- network transport protocols, hosted synchronization services, bundle registries, or remote access control;
- bundle signing, sender authentication, encryption, or organization trust policy in the first slice;
- garbage collection or retention policy beyond preserving every graph-v1 object reachable from authoritative roots and active recovery/import state;
- deleting, quarantining, relocating, enumerating, traversing, rewriting, or otherwise mutating legacy filesystem trees during reset or graph-v1 operation; and
- redesigning review findings, UI, or reviewer selection unrelated to persistence parity.

## Risks and tradeoffs

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Operator resets the wrong repository or misunderstands the authority-retirement impact | Valid review authority and review credit become permanently unusable, although legacy bytes remain | Bind confirmation to the canonical repository/common-directory identity; identify retired artifact classes and retained audit evidence; require an explicit target-bound logical-reset action |
| Reset is interrupted between marker publication and fresh-incarnation activation | The repository has no usable review authority | Keep all authority-bearing operations blocked, emit precise recovery diagnostics, and make explicit forward completion idempotent without restoring retired authority |
| A legacy or prior-incarnation receipt or bundle remains accepted after reset | Delivery could be authorized by retired authority | Bind receipts and bundles to the exact epoch/incarnation, reject retired artifacts at every authority entry point, and require a fresh approved graph-v1 receipt for the exact target |
| Pre-activation legacy detection misses a known root in the shared worktree store | Old and new authority could coexist or be selected inconsistently | Use one versioned, bounded fixed-root probe at the canonical Git common-directory boundary before activation; after retirement, gate every entry point on the marker, selector, and current incarnation rather than retired paths |
| Lock recovery permits competing mutation | Authoritative graph-v1 state or reset state could be corrupted | Use OS-backed exclusive mutation, conservative recovery, atomic publication, and fail closed on ambiguous ownership |
| Import publishes before complete validation | Corrupt or incomplete history becomes authoritative | Stage and validate closure and lifecycle fully, then install immutable objects and atomically publish roots under lock |
| Resume replays actor work or resets counters | Review cost and bounded guarantees are violated | Persist monotonic graph-v1 consumption and stable identities; reuse checkpoints only on exact input identity match |
| Mirror APIs leak authority | Cached or stale data could approve delivery | Separate authority types/capabilities and require authoritative import for promotion |
| Logical retirement increases operational burden | Teams must rerun review and cannot reuse prior authority, even though audit bytes remain available | Make consequences explicit, keep non-authoritative reset diagnostics, document the fresh-review requirement, and reject any shortcut that restores retired authority |
| A reset or graph-v1 operation mutates or recursively traverses legacy paths | Audit evidence may be damaged, leaked, or turned into an availability hazard | Give graph-v1 no write-capable legacy path; use bounded root-only detection before activation; prove byte immutability and no recursive traversal with fault-injection tests |
| An obsolete writer changes retired bytes after reset | Audit evidence drifts or operators suspect current authority changed | Keep retired paths outside every authority-bearing code path; allow only separate informational drift diagnostics that cannot alter current authority |
| Content-addressed history increases storage and complexity | More implementation and operational burden | Keep immutable object format minimal; defer garbage collection and network synchronization |
| Cross-platform filesystem semantics differ | Crash safety may be overstated on some platforms | Specify supported guarantees by platform/filesystem and fail closed where required primitives are unavailable |
| Scope exceeds a reviewable single PR | Reviewer fatigue and hidden integration defects | Plan reviewable slices before apply; keep each slice in a valid fail-closed state and do not activate graph-v1 gates until the complete invariant set is present |

## Rollback and recovery

Before logical-reset authorization is durably marked, rollback is removal or disablement of inactive graph-v1 code and data; legacy bytes and legacy authority remain untouched, and operations continue to fail closed if the running version detects unsupported legacy state.

After logical reset begins, rollback cannot restore retired review authority. A reset failure must leave authority-bearing operations blocked, preserve clear diagnostics about the incomplete marker/incarnation transition, and support explicit forward recovery to the same fresh empty graph-v1 incarnation. Legacy paths remain untouched throughout recovery. Backups and retained legacy bytes may support external inspection or disaster analysis, but the product must not automatically ingest them, translate them into graph-v1, or treat them as authority.

After graph-v1 activation, software rollback is supported only to a version that understands graph-v1 selectors, retirement markers, epoch/incarnation invalidation, and retired-byte isolation. Older authority readers or writers must not be allowed to reactivate retired state or authorize a gate. Recovery favors forward repair of the current graph-v1 incarnation or completion of an interrupted logical reset, never restoration of prior approvals, receipts, bundles, ledgers, or counters.

Bundle import failure leaves graph-v1 authoritative roots unchanged. Crash recovery may clean validated staging state or resume from an identity-bound graph-v1 checkpoint. It must never delete reachable graph-v1 objects or reset graph-v1 lifecycle budgets.

## Success criteria

The proposal is successful when the implemented change can demonstrate all of the following:

1. Event identity changes for any canonical content or predecessor change, and identical graph-v1 events produce identical identities across processes.
2. A graph-v1 lineage can be reconstructed and validated from genesis to authoritative head with no mutable snapshot required as historical authority.
3. Linked worktrees resolve to the same exact Git common-directory store and lock domain; worktree-local mirrors cannot authorize mutation.
4. Concurrent writers serialize safely, interrupted publication recovers to a valid old or new graph-v1 authority, and ambiguous mutation ownership fails closed.
5. Export followed by import reproduces the same declared graph-v1 roots and reduced transaction state on another compatible repository.
6. Malformed, incomplete, conflicting, cyclic, wrong-lineage, unsupported, or authority-forging bundles are rejected with no authoritative mutation.
7. Repeating an identical graph-v1 import is idempotent, and an interrupted import/export resumes without repeating validated work unnecessarily.
8. Restarting or resuming a graph-v1 review transaction does not rerun completed actors, alter frozen claims, reset any budget, add a validator to a no-fix path, or repeat final verification.
9. Mirror-only data cannot produce an authoritative receipt or pass any commit, push, PR, release, or publication gate.
10. Before activation, bounded legacy-root detection blocks graph-v1 initialization and authority use with clear target-specific diagnostics and no legacy-path mutation; after retirement, authority-bearing operations do not consult retired paths.
11. Logical reset never runs silently, requires explicit confirmation bound to the exact repository/common-directory target, durably publishes a retirement marker, and selects a fresh store epoch/incarnation without translating legacy state.
12. A successful reset leaves legacy bytes untouched as inert audit evidence, initializes an empty graph-v1 store in a separate incarnation namespace, and makes every legacy or prior-incarnation receipt, bundle, approval, escalation, ledger, finding, frozen hash, lineage, journal, checkpoint, root, event, and counter unusable as authority.
13. Reset, initialization, recovery, import, and normal graph-v1 operation never recursively delete, quarantine, enumerate, traverse, rewrite, or otherwise mutate legacy filesystem trees; retired-byte drift cannot affect current authority.
14. An interrupted reset leaves all gates blocked and can be completed explicitly forward without restoring retired authority or creating partial graph-v1 authority.
15. No lifecycle or delivery gate passes after reset until a completely fresh graph-v1 review in the current epoch/incarnation produces a new approved receipt bound to the exact typed target.
16. Fault-injection and concurrency tests cover locking, event/object publication, head/index and selector publication, bounded legacy detection, logical-reset marker/incarnation phases, legacy-byte immutability, bundle import, resume, retired receipt/bundle rejection, and terminal lifecycle behavior.

## Delivery and review workload forecast

The logical-retirement decision removes conversion, coexistence, authority-preservation, legacy-erasure, quarantine, and compatibility-window work. It avoids recursive legacy filesystem mutation, but the remaining change still spans core event persistence, schemas, Git common-directory resolution, mutation locking, crash-safe retirement markers and epoch/incarnation selection, bundles, graph-v1 resume, mirror authority typing, gate enforcement, and extensive fault-injection tests.

- **Estimated changed lines:** likely more than 1,000, including tests.
- **400-line budget risk:** High.
- **Chained PRs recommended:** Yes.
- **Decision needed before apply:** Yes—define reviewable implementation slices and an activation boundary that keeps all gates fail-closed until graph-v1, reset invalidation, and receipt validation are complete.

A likely sequence is: (1) graph-v1 object model/common-directory store and bounded legacy detection; (2) explicit logical reset with durable retirement marker, fresh epoch/incarnation, legacy-byte isolation, and gate/receipt/bundle invalidation; (3) graph-v1 transaction reduction/resume and lifecycle integration; and (4) bundles and mirrors. Each slice must preserve a deterministic blocked or valid state; no intermediate slice may accept retired authority or pass a gate from incomplete graph-v1 state.

## Proposal question round

This revision incorporates the approved product decision: legacy review authority is retired logically through a deliberate, target-bound reset. A durable marker and fresh epoch/incarnation become the sole authority; legacy bytes remain untouched in place as inert audit evidence; legacy and prior-incarnation receipts and bundles are denied; and a fresh review is required. No recursive legacy filesystem mutation is permitted. No further proposal assumption is being introduced for user review in this revision.
