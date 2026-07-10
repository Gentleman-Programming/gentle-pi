# Design: Bounded Review Graph Parity

## 1. Design goals and constraints

This design replaces mutable numbered review snapshots as historical authority with an immutable, predecessor-linked, content-addressed event graph. Its reset mechanism follows the logical-retirement contract in `specs/review-graph/spec.md`.

The design MUST provide:

- deterministic graph-v1 event identity and deterministic state reduction;
- one exact authority and mutation-lock domain under Git's common directory;
- crash-safe graph mutation and publication;
- portable, versioned graph-v1 bundle export and import;
- durable graph-v1 resume without repeating actor work or resetting bounded budgets;
- explicit non-authoritative mirror types and runtime checks;
- pre-activation detection of legacy review authority;
- an exact, deliberate, repository-bound logical reset;
- a durable retirement marker and a fresh graph-v1 store epoch/incarnation in a namespace separate from legacy storage;
- immutable treatment of legacy bytes as in-place, inspection-only evidence;
- authority entry points that never read retired bytes as authority and never let retired-byte drift affect current graph authority;
- rejection of every receipt, bundle, checkpoint, root, and event from a retired epoch/incarnation; and
- gates that remain denied until a fresh review in the current incarnation produces an approved receipt for the exact typed target.

The design MUST NOT:

- translate legacy revisions or state into graph events;
- mutate legacy files or directories during reset, initialization, recovery, import, or normal graph operation;
- enumerate or traverse the contents of legacy directory trees;
- retain legacy state as fallback, parallel, or gate-bearing authority;
- initialize graph-v1 over detected legacy authority without exact reset confirmation;
- infer reset consent from startup, review start, resume, import, inspection, or another command;
- silently continue an interrupted reset;
- use legacy evidence to preserve lineage identity, approval, consumed budget, or review credit;
- make current authority contingent on the continued metadata or contents of retired paths;
- let a mirror, checkpoint, actor result, retirement diagnostic, or legacy file authorize a graph transition;
- change ordinary or Judgment Day actor, refuter, validator, fix, terminal, or final-verification policy; or
- let review execution commit, push, create pull requests, release, or publish.

Where the proposal and specification differ on reset mechanics, the specification is authoritative for this design: reset is a logical authority transition, while legacy bytes stay where they are and become permanently non-authoritative.

## 2. Architectural decisions

### 2.1 Graph-v1 is the only selectable authority after activation

Each lineage is a single-parent event chain. Event objects are immutable and addressed by a SHA-256 identity derived from canonical event content, including predecessor identity. A root set names one graph head per lineage. `ReviewStateV1` remains the deterministic reduced compatibility projection returned by the public API; mutable snapshots are not historical authority.

The active authority is selected only by the graph-v1 authority selector. A selected graph store contains graph-backed lineages only. Legacy roots never appear in a graph root set, event, receipt, checkpoint, or bundle manifest.

### 2.2 Legacy handling has distinct pre-reset and post-reset rules

Before any retirement marker exists, every authority-bearing operation performs a bounded pre-activation probe of a fixed set of known legacy root names. The probe uses no-follow metadata checks on those roots only. It does not open their files, list their children, hash their contents, or interpret their review meaning. A detected root blocks graph-v1 activation and directs the operator to `inspect` and explicit reset.

After a complete retirement marker selects a current graph-v1 incarnation, authority-bearing operations do not probe retired paths. They validate only:

1. the exact repository capability;
2. the retirement marker when the selected store was reset-initialized;
3. the graph-v1 authority selector;
4. the selected `STORE` descriptor;
5. the current root pointer quorum and complete graph closure; and
6. the current epoch/incarnation on receipts, bundles, and checkpoints.

This ordering is essential. A retired path may later show different metadata because an obsolete process or an operator touched it. That drift may be reported by `inspect`, but it cannot block, select, invalidate, advance, or otherwise affect graph authority.

### 2.3 Reset is logical retirement

Reset changes authority, not legacy storage. Under the store-wide lock it:

1. validates exact target-bound confirmation;
2. durably records retirement authorization;
3. creates a fresh random epoch and authority incarnation;
4. initializes an empty graph-v1 authority in an incarnation-specific namespace;
5. publishes that incarnation through the graph-v1 authority selector;
6. verifies that every authority API resolves only the new empty graph;
7. marks the retirement transition complete; and
8. requires a fresh graph-v1 review before any gate can pass.

Legacy bytes stay in their original locations. Graph-v1 treats those bytes as immutable inspection evidence and has no write-capable path to them. Reset does not derive graph data from those bytes and does not preserve any review credit.

A reset may also retire a previously selected graph-v1 incarnation. The prior incarnation remains stored under its own identity for inspection, but the selector no longer names it and no authority API can use it.

### 2.4 One control lock serializes authority transitions and graph mutation

The store-wide mutation lock remains outside incarnation-specific storage:

```text
<common-dir>/gentle-ai/reviews/control/authority.lock/
```

Graph append, root publication, import publication, logical reset, reset recovery, and byte-restorative graph repair acquire this lock. The existing unique owner token, durable owner metadata, owner-checked release, and fail-closed stale-owner recovery semantics remain.

The protocol does not add a legacy-writer fencing subsystem. Old writers can alter retired bytes, but they cannot alter the graph-v1 selector, marker, selected incarnation, or current graph through a supported API. Authority therefore depends on graph-v1 capability and identity checks, not on old-writer quiescence.

### 2.5 Crash safety comes from monotonic publication phases

Logical reset uses ordinary durable publication primitives:

- exclusive creation of an incarnation directory and immutable objects;
- canonical file writes with file synchronization and read-back;
- atomic replacement of graph-v1 control files;
- a two-of-three authority selector quorum;
- no-follow validation for graph-v1 managed paths; and
- explicit verification before completion.

Every phase is monotonic. Opening a repository never advances reset. If a crash leaves an older durable phase, authority APIs deny until explicit resume either completes the same identity-bound transition or reports a fail-closed inconsistency.

No reset phase depends on changing a retired path. This makes recovery independent of old-byte drift.

### 2.6 Epoch and incarnation are the invalidation boundary

Every active store has a random 256-bit `store_epoch` and an `authority_incarnation_id`. The incarnation commits to repository identity, epoch, initialization kind, reset ID, authorization hash, and selector generation.

Event bodies, root-set bodies, bundle manifests, checkpoints, authoritative reads, and authoritative receipts carry the exact current epoch/incarnation. Their content identities commit those fields. A prior artifact cannot be rebound by editing only its wrapper because complete closure validation will detect the mismatch.

A reset-initialized repository never adopts a foreign or retired incarnation as authority. A retired bundle may be validated into an explicitly non-authoritative mirror, but it cannot publish roots, mint a receipt, or satisfy a gate.

### 2.7 Review progress and transfer progress remain distinct

Review actor invocation and budget consumption are authoritative events published before external work begins. Import/export checkpoints are operational metadata only. A checkpoint skips work solely when its input identities, reducer version, staged bytes, repository identity, selector generation, epoch, and incarnation match exactly.

Reset state can deny authority while incomplete, but it cannot approve, escalate, mint receipts, satisfy gates, or consume review budgets.

### 2.8 Mirrors and retired stores are non-authoritative capabilities

Mirror APIs and retired-incarnation inspection APIs may cache, inspect, replicate, or transport verified graph-v1 objects and bundles. They cannot publish the authority selector, mutate a selected lineage, issue authoritative receipts, validate gates, or complete reset recovery.

Promotion always uses the locked importer and requires exact equality with the current selected incarnation. There is no promotion path from legacy bytes.

## 3. Proposed module boundaries

`lib/review-transaction.ts` remains the compatibility facade. Persistence, retirement control, transfer, and mirror behavior are separated from review policy.

| Module | Responsibility | Authority-bearing |
| --- | --- | --- |
| `lib/review-canonical.ts` | Canonical JSON v1, domain-separated SHA-256 helpers, bounded decoding | No |
| `lib/review-graph-schema.ts` | Native graph event schemas and validation | No |
| `lib/review-repository.ts` | Sanitized Git execution, exact common-directory resolution, repository identity, private authority capability, and managed-root validation | Establishes location and identity |
| `lib/review-legacy-detector.ts` | Fixed-root pre-activation probes and post-retirement drift diagnostics without content traversal | Denies only before a retirement marker; diagnostics never authorize or deny afterward |
| `lib/review-reset.ts` | Exact confirmation, logical-retirement state machine, new-incarnation initialization, selector publication, and explicit recovery | Yes, only under the control lock |
| `lib/review-lock.ts` | Store-wide graph/reset mutation lock, owner-checked release, and conservative recovery | Protects mutation |
| `lib/review-object-store.ts` | Immutable graph objects, incarnation-local roots, `STORE`, and authority-selector publication | Yes |
| `lib/review-graph-reducer.ts` | Complete chain validation and deterministic event-to-`ReviewStateV1` reduction | Yes with a selected authoritative root |
| `lib/review-checkpoint.ts` | Identity-bound transaction/import/export checkpoints | No |
| `lib/review-bundle.ts` | Deterministic export, staged validation, installation, and locked publication | Publication is authoritative |
| `lib/review-mirror.ts` | Explicit non-authoritative cache, retired-incarnation inspection, and transport API | Never |
| `lib/review-transaction.ts` | Public transaction facade, receipt binding, and gate integration | Yes through repository authority |
| `extensions/gentle-ai.ts` | `gentle_review` routing for graph operations, inspect, and logical reset | Calls authority APIs only |

Policy modules, snapshot capture, trigger classification, and controller actor routing remain behavior sources. They do not move into persistence or reset modules.

## 4. Canonical encoding and identities

### 4.1 Canonical JSON v1

`CanonicalJsonV1` retains the existing contract:

- JSON null, booleans, strings, finite numbers, arrays, and objects only;
- object properties with undefined values omitted;
- undefined array members and all non-JSON values rejected;
- object keys sorted by JavaScript UTF-16 code-unit order;
- standard JSON string/number encoding with negative zero encoded as zero;
- non-negative safe integers for counters, sequence values, lengths, and generations; and
- UTF-8 bytes with no byte-order mark or trailing newline.

### 4.2 Domain-separated identities

The following identities use SHA-256 over a fixed domain prefix followed by canonical UTF-8 bytes:

| Identity | Canonical body |
| --- | --- |
| `event_id` | Full event body, including predecessor, epoch, and incarnation |
| `root_set_id` | Full root-set body, including predecessor root and incarnation |
| `pointer_hash` | One current-root pointer slot |
| `authority_selector_hash` | Repository ID, selector generation, epoch, incarnation, store-relative path, and reset ID |
| `bundle_id` | Full graph-v1 bundle manifest |
| `checkpoint_hash` | Full checkpoint body |
| `repository_id` | Canonical repository identity body |
| `authority_id` | Repository ID plus graph format |
| `legacy_evidence_summary_hash` | Fixed known-root names and shallow no-follow metadata observed before authorization |
| `reset_authorization_hash` | Exact confirmation body |
| `reset_state_hash` | Full logical-reset state body |
| `authority_receipt_hash` | Receipt body plus live selector and exact typed target |

`authority_incarnation_id` commits to:

- `repository_id`;
- `store_epoch`;
- `initialization_kind`;
- `initialized_by_reset_id`;
- `reset_authorization_hash`; and
- `selector_generation`.

The pre-reset evidence summary is consent context only. It is not graph history, is never imported, and is not re-evaluated as an authority condition after authorization is durable.

## 5. Graph and authority schemas

### 5.1 Native event envelope

A graph event contains:

| Field | Contract |
| --- | --- |
| `schema` | Exact graph-v1 event schema |
| `store_epoch` | Exact selected store epoch |
| `authority_incarnation_id` | Exact selected incarnation |
| `initialized_by_reset_id` | Reset ID or null for a clean bootstrap |
| `lineage_id` | Stable lineage identity |
| `sequence` | Zero-based monotonic sequence |
| `predecessor_event_id` | Null only for lineage genesis |
| `kind` | `lineage-created`, `operation-prepared`, `operation-completed`, or `gate-evaluated` |
| `operation` | Bounded operation identity when applicable |
| `payload` | Canonical transition payload |
| `reduced_state_hash` | Hash of deterministic reduced state |
| `event_id` | Domain-separated hash of the body |

Sequence zero is always `lineage-created` with a null predecessor. Every later event has exactly one predecessor in the same lineage. Unknown event kinds and unknown properties are rejected. There is no event capable of carrying legacy state or a legacy revision.

### 5.2 Root set

A root entry contains one lineage ID, head event ID, sequence, and reduced-state hash. Entries are sorted, unique, bounded, and validated against complete closures.

A root-set body contains repository ID, authority ID, store epoch, authority incarnation, reset ID, generation, predecessor root-set ID, and root entries. The empty reset-initialized root has generation zero, no predecessor, and no lineages.

### 5.3 Store descriptor and authority selector

The incarnation-local `STORE` descriptor contains:

- exact graph-v1 schema and format;
- repository and authority identities;
- reducer version and format limits;
- store epoch and authority incarnation;
- initialization kind: clean bootstrap, bundle adoption, or logical reset;
- reset ID and authorization hash when reset-initialized;
- selector generation; and
- empty-root identity for reset initialization.

The graph-v1 authority selector contains:

- repository and authority identities;
- monotonically increasing selector generation;
- selected store epoch and incarnation;
- selected incarnation-relative path;
- initialization kind and reset ID;
- selected root-set identity; and
- selector hash.

Three selector slots use the same two-of-three quorum rule as current root pointers. A valid selector requires two matching canonical slots and an exactly matching `STORE` descriptor.

### 5.4 Logical-reset state schema

The durable reset-state envelope contains a canonical body and `reset_state_hash`. Its body contains:

| Field | Purpose |
| --- | --- |
| `schema` | Exact logical-reset state schema |
| `reset_id` | Random identity for one transition |
| `repository_id` | Exact repository target |
| `common_directory_hash` | Exact common-directory target |
| `authorization_hash` | Hash of the exact confirmation body |
| `legacy_evidence_summary_hash` | Consent snapshot from fixed-root shallow probes |
| `sequence` | Monotonic state update number |
| `phase` | Monotonic publication phase |
| `previous_selector_generation` | Selector generation observed at authorization |
| `previous_authority_incarnation_id` | Prior selected incarnation, if any |
| `new_store_epoch` | Fresh epoch generated for this transition |
| `new_authority_incarnation_id` | Fresh incarnation generated for this transition |
| `new_incarnation_relative_path` | Fixed graph-v1 path derived from the incarnation |
| `empty_root_set_id` | New incarnation's generation-zero root |
| `published_selector_generation` | New selector generation after publication |
| `failure_code` | Stable fail-closed diagnostic when applicable |

Allowed phases are:

1. `authorized` — exact consent and all new identity material are durable;
2. `initializing` — the incarnation-local descriptor and empty root are being installed;
3. `publishing` — selector quorum publication is in progress;
4. `verifying` — the selector and complete empty graph are being reopened independently;
5. `complete` — the new incarnation is the sole authority and the retirement binding is final; and
6. `failed-closed` — an invariant mismatch requires operator inspection.

There are no per-legacy-path progress fields. State progression is concerned only with marker, graph initialization, selector publication, and verification.

Updates increment `sequence`, write canonical bytes to an exclusive temporary control file, synchronize and atomically replace the state file, and read it back. Any malformed state, sequence regression, hash mismatch, repository mismatch, unexpected incarnation path, or impossible phase transition blocks authority.

The complete state is authority-bearing negative/import-eligibility metadata, not a receipt or review event. A reset-initialized `STORE` requires exact agreement with the complete marker. A non-authoritative history summary may explain timestamps and outcome, but cannot replace the retained binding.

## 6. Exact Git common-directory layout

```text
<git-common-dir>/gentle-ai/reviews/
├── control/
│   └── authority.lock/
│       └── owner.json
├── graph-v1/
│   ├── control/
│   │   ├── reset-state.json
│   │   ├── reset-history/<reset-id>.json
│   │   ├── AUTHORITY.0
│   │   ├── AUTHORITY.1
│   │   └── AUTHORITY.2
│   ├── incarnations/<authority-incarnation-id>/
│   │   ├── STORE
│   │   ├── CURRENT.0
│   │   ├── CURRENT.1
│   │   ├── CURRENT.2
│   │   ├── objects/events/sha256/ab/<62-hex>
│   │   ├── roots/sha256/ab/<62-hex>
│   │   ├── staging/imports/<operation-id>/
│   │   ├── operations/imports/<operation-id>.json
│   │   ├── operations/exports/<operation-id>.json
│   │   └── cache/reductions/
│   └── mirrors/
└── <legacy roots remain in their original locations as retired evidence>
```

The graph-v1 system owns only `control/authority.lock` and the `graph-v1` subtree. It has no mutation API for legacy roots. Managed graph-v1 paths must be regular files or directories as expected, never symlinks or redirected path types.

Linked worktrees resolve the same common directory, lock, reset marker, selector, incarnation stores, graph objects, roots, and checkpoints. Worktree-local copies remain non-authoritative.

### 6.1 Deterministic Git process and environment contract

Every review entry point receives an explicit `cwd`; repository selection never falls back to ambient Git discovery. Before common-directory resolution, snapshot capture, gate validation, reset/inspect, recovery/repair, or import/export, `lib/review-repository.ts` applies one shared process policy:

1. Canonicalize and metadata-check the explicit `cwd` without using Git environment hints.
2. Reject inherited repository/config routing variables before any Git process or managed-store access. The deny set includes directory, worktree, common-directory, index, object, alternate, namespace, path-prefix, discovery, configuration-injection, replacement-ref, shallow-file, and graft-file controls.
3. Build a minimal child environment. Strip inherited `GIT_*` values, then install only controller-owned constants for disabled system/global configuration, disabled optional locks, and stable locale.
4. Spawn the absolute Git executable with `shell: false`, fixed arguments, explicit child `cwd`, bounded output, and no caller-composed revision or option.
5. Require one absolute canonical common-directory result of the expected type, derive repository identity from it, and repeat resolution under the control lock before mutation or gate authorization.

All downstream APIs accept the private resolved repository capability, not raw caller paths.

## 7. Legacy evidence detection and diagnostics

### 7.1 Fixed-root pre-activation probe

The implementation maintains a versioned set of known legacy root names. For each name it performs at most one no-follow metadata probe. The result records:

- relative root name;
- observed root kind;
- opaque shallow metadata identity;
- observed size and modification time when available; and
- the invalidated artifact classes represented by the legacy format.

The probe is bounded by the static root-name set. It never opens a legacy file, lists a legacy directory, reads review payloads, validates receipts, reconstructs lineages, or calculates a tree-content digest.

Pre-retirement outcomes are:

- `virgin` — no retirement marker, no graph selector, and no known legacy roots;
- `active-clean` — a clean-bootstrap or bundle-adopted graph selector exists, no complete retirement marker exists, and no known legacy root is observed;
- `blocked-legacy` — one or more known legacy roots exist and no graph selector exists;
- `blocked-mixed` — known legacy roots and a graph selector or unbound graph-v1 candidate coexist before retirement;
- `reset-in-progress` — a non-complete logical-reset marker exists; or
- `blocked-ambiguous` — repository, path type, permissions, marker, or selector cannot be validated.

`virgin` permits clean graph-v1 bootstrap, and `active-clean` permits continued use of its selected graph. The blocked outcomes permit read-only inspection and exact reset confirmation, not authority use.

### 7.2 Post-retirement drift diagnostic

After a complete marker exists, `inspect` may repeat the same fixed-root shallow probes and compare the result with the consent snapshot. The output is explicitly labeled `retired_evidence_drift` and is informational.

The diagnostic:

- is not called by graph reads, mutation, resume, import, export, receipt issuance, or gate validation;
- cannot change reset state, selector generation, graph roots, receipts, or budgets;
- cannot turn retired bytes into authority;
- cannot invalidate a current graph or current receipt; and
- cannot trigger another reset automatically.

A malformed retired path type is likewise diagnostic after retirement. Security checks still protect graph-v1-owned paths independently.

## 8. Explicit logical-reset protocol

### 8.1 Inspection and exact confirmation

`gentle_review inspect` returns:

- canonical common-directory path;
- repository ID and common-directory hash;
- fixed-root evidence summary and its hash;
- every retired artifact class;
- the current graph selector, if any;
- the exact required command; and
- the exact confirmation challenge.

The challenge is:

```text
RETIRE REVIEW AUTHORITY <repository-id> AT <common-directory-hash> EVIDENCE <legacy-evidence-summary-hash>
```

The command carries the same repository ID, common-directory hash, evidence-summary hash, and exact challenge as structured fields. Missing, partial, stale, wildcard, normalized, environment-derived, or yes/no confirmation is rejected. The command's repository is re-resolved, so text captured for another common directory cannot authorize reset.

The diagnostic states that legacy bytes will remain in place, graph-v1 will never use them as authority, every prior receipt and bundle will be retired, and a fresh review will be required.

### 8.2 Logical-reset algorithm

Under the control mutation lock:

1. Re-resolve repository and common-directory identity through the sanitized process boundary.
2. Require no existing active reset transition. Re-run the fixed-root shallow probe and require an exact match with the submitted target and evidence-summary hash. A mismatch returns a new challenge without publishing reset state.
3. Read and validate the prior graph-v1 selector if present. Allocate a random reset ID, fresh epoch, next selector generation, and new authority incarnation. Derive a fixed incarnation-relative path from the incarnation ID.
4. Durably publish and read back the `authorized` reset state containing the prior selector binding, new identity material, and authorization hash. No legacy path is changed.
5. Advance to `initializing`. Exclusively create the new incarnation namespace, write its `STORE` descriptor, install the incarnation-bound generation-zero root set, and publish the incarnation-local current-root quorum. Reuse exact matching bytes on resume; reject any conflict.
6. Persist the empty-root identity in reset state and advance to `publishing`.
7. Publish the graph-v1 authority selector quorum for the new epoch/incarnation and next selector generation. The selector references only the new incarnation namespace.
8. Advance to `verifying`. Through a fresh repository capability, resolve the selector, descriptor, and root quorum; validate repository and authority identity, reset binding, epoch, incarnation, empty closure, and empty lineage set.
9. Exercise the same shared authority guard used by all entry points and prove it does not consult retired roots. Validate representative prior receipts, bundles, and checkpoints as retired because their epoch/incarnation differs.
10. Publish the non-authoritative reset-history summary containing target IDs, consent-summary hash, phase timestamps, retired artifact classes, old/new incarnation IDs, and outcome. It contains no legacy review payload.
11. Persist `complete`, read back the marker, selector, `STORE`, and root quorum, then return success.
12. Release the lock. Success creates no lineage, approval, receipt, or gate authorization.

Reset never runs from a constructor, startup hook, normal start, import, resume, repair, or gate command.

### 8.3 Mixed prior authority

If legacy roots and a graph-v1 selector coexist before reset, inspection labels the repository `blocked-mixed`. Confirmation states that both the legacy authority and the previously selected graph incarnation will be retired. The new selector generation names only the fresh empty incarnation.

Old graph objects remain under their prior incarnation directory. They are available only through explicit non-authoritative inspection. No merge or precedence rule carries them into the new root.

## 9. Crash states and explicit recovery

Opening the repository never advances reset state. It reports the observed state and exact recovery command.

| Observed state | Authority behavior | Explicit recovery |
| --- | --- | --- |
| Legacy roots, no reset marker | All graph operations and gates deny; legacy evidence is unchanged | Inspect and submit exact logical-reset confirmation |
| `authorized`, no new store | Deny; prior authority is retired for the pending transition and no successor is selected | Resume with the same reset ID and authorization binding |
| `initializing`, descriptor or empty root incomplete | Deny | Resume exact-byte initialization in the same incarnation; conflicts fail closed |
| `publishing`, selector has no valid quorum | Deny | Resume publication of the already bound selector body |
| Valid new selector, phase still `publishing` | Deny because transition is incomplete | Resume and independently verify the selected empty graph |
| `verifying`, graph checks incomplete | Deny | Repeat verification without consulting retired roots, then complete |
| `failed-closed` or malformed marker | Deny | Operator inspects graph-v1 control evidence and applies exact metadata repair or a supported forward recovery |
| `complete`, selector and graph agree | Current graph is available but empty; gates deny without a fresh receipt | Start a fresh graph-v1 review |
| `complete`, retired evidence metadata changed | Current graph behavior is unchanged; inspect may report drift | No authority recovery is required |
| `complete`, selector or selected graph is inconsistent | Deny | Repair exact graph-v1 control or object bytes from trusted identical evidence; never select a retired incarnation |

Recovery properties:

- recovery is idempotent and forward-only;
- no automatic resume occurs on open;
- no recovery step reads legacy review semantics or writes legacy paths;
- retired-evidence drift never changes recovery routing;
- an incomplete graph initialization cannot pass a gate;
- an older durable reset phase after crash is safe because it blocks and revalidates graph-v1 state; and
- reset and recovery consume zero review, refuter, validator, fix, judge, final-verification, or lifecycle budget.

## 10. Graph locking and publication

The control lock preserves the existing single-writer contract:

1. exclusive directory creation acquires the lock;
2. canonical owner metadata contains a random token, process identity evidence, repository ID, authority ID, and owner hash;
3. owner metadata is synchronized before mutation;
4. release requires the exact live token and observed owner identity;
5. stale recovery requires an exact expected owner hash and proof that ownership is dead; and
6. ambiguous ownership fails closed with no force-steal path.

Graph event/root installation, root-pointer quorum, and authority-selector quorum use immutable content before pointer publication. Logical reset does not weaken graph object immutability, descendant-only root publication within one incarnation, exact-byte repair, or terminal closure.

## 11. Portable graph-v1 bundles

### 11.1 Manifest

A bundle manifest contains only graph-v1 material:

- repository and authority identity;
- store epoch and authority incarnation;
- initialization kind and reset ID;
- selector generation;
- source root-set ID;
- reducer version;
- declared lineage roots;
- sorted object IDs; and
- bounded object count and byte totals.

It contains no legacy source, legacy content, evidence summary, reset history, or legacy-derived review metadata.

### 11.2 Export

Export resolves the selected graph-v1 incarnation, validates the marker when applicable, and verifies that `STORE`, selector, root set, and every event share one exact incarnation. It binds one verified root-set snapshot, emits canonical objects in deterministic order, and publishes through destination-local staging. Export does not inspect retired roots.

### 11.3 Import

Import validates framing, versions, canonical bytes, object identities, complete closure, lineage consistency, lifecycle invariants, repository compatibility, forks, duplicates, limits, and one exact incarnation before authoritative publication.

Authority admission has two cases:

- A genuinely virgin repository with no selector, marker, graph incarnation, or known legacy root may atomically adopt a valid bundle as first initialization.
- An initialized repository accepts authoritative publication only when bundle epoch, incarnation, reset binding, and selector generation match the live incarnation and the proposed root is identical to or a valid descendant of the live root.

A reset-initialized repository cannot adopt another incarnation. A retired or foreign bundle returns `REVIEW_BUNDLE_EPOCH_MISMATCH`; an explicit mirror operation may retain verified graph objects for inspection, but authoritative roots remain unchanged.

Import never reads legacy bytes, rewrites incarnation fields, mints a receipt, or serves as reset. Repeating an identical current-incarnation import is idempotent.

## 12. Resume and checkpoints

### 12.1 Authoritative review resume

`operation-prepared` persists invocation identity and counter reservation before external work. Restart behavior remains:

- completed idempotency keys return canonical stored results;
- unresolved prepared operations block unrelated mutation;
- the same invocation is not automatically launched again;
- completion requires the exact prepared event, operation, request hash, invocation identity, and output shape;
- terminal lineages cannot reopen; and
- final verification is represented once and cannot increment on replay.

Authority selection and reset-state validation run before resume. No checkpoint from a retired incarnation is reusable.

### 12.2 Checkpoint contract

A transfer checkpoint binds:

- operation ID and kind;
- input identity;
- repository and authority IDs;
- selector generation;
- store epoch and authority incarnation;
- reset ID;
- authority root-set ID;
- reducer version;
- phase and sequence;
- completed graph object IDs; and
- staged artifact identity when applicable.

Checkpoint reuse requires exact equality with the selected incarnation. Reducer-version changes invalidate reducer-dependent work but never change graph authority or budgets.

## 13. Mirrors, receipts, and lifecycle gates

### 13.1 Authority capabilities

An authoritative read carries a private runtime brand plus repository ID, authority ID, selector generation, epoch, incarnation, reset ID, common-directory identity, root-set ID, head event ID, and reduced state.

An authoritative receipt carries a separate private runtime brand plus the receipt envelope and the same authority binding. Deserialization, structural casts, mirrors, retired stores, and diagnostics cannot mint either brand.

### 13.2 Receipt invalidation

A compatibility helper may still create a plain receipt envelope, but a lifecycle gate requires a live authoritative receipt.

After logical reset:

- a legacy receipt lacks graph authority binding and is rejected;
- a receipt from any prior graph incarnation is rejected with `REVIEW_RECEIPT_EPOCH_MISMATCH`;
- prior event/root bytes are outside the selected incarnation and cannot back an authoritative read;
- a prior bundle is mirror-only and cannot create a selected root or receipt;
- the empty current root has no approved lineage from which a receipt can be issued; and
- only an approved lineage whose complete closure belongs to the selected incarnation can produce a valid receipt.

### 13.3 Shared authority-entry algorithm

Every authority-bearing entry point uses one guard:

1. resolve the exact repository/common-directory capability through the sanitized Git policy;
2. acquire the control lock when a consistent mutation or gate window is required;
3. read and validate graph-v1 reset state and authority-selector quorum;
4. if no selector exists, run the bounded fixed-root probe and either permit virgin bootstrap or deny;
5. if a clean-bootstrap or bundle-adopted selector exists without a complete retirement marker, run the same fixed-root probe before authority use and deny on legacy or mixed state;
6. if a complete retirement marker exactly binds the selected reset-initialized store, do not access retired roots;
7. verify selected `STORE`, epoch, incarnation, reset binding, root quorum, and complete one-incarnation closure;
8. validate operation-specific request, receipt, bundle, checkpoint, and exact typed target bindings;
9. repeat repository and selected graph checks before issuing one-shot authorization; and
10. deny on any graph-v1 ambiguity.

A lifecycle gate runs zero review actors. Old-byte drift is outside this algorithm.

## 14. CLI and tool surface

The `gentle_review` operation enum provides:

- `start`, `advance`, `status`, and `validate` with graph-v1 behavior;
- `export` and `import` for graph-v1 bundles;
- `recover` for proof-based control-lock and logical-reset recovery;
- `repair` for exact digest-named graph-v1 byte restoration only;
- `inspect` for repository identity, pre-activation block, retired-evidence drift, reset state, graph integrity, checkpoints, lock owner, selector/root quorums, and mirror completeness; and
- `reset` for exact confirmed logical retirement or explicit reset-ID-bound resume.

There is no migration operation. Start, import, repair, recovery, and gate validation cannot invoke reset as a side effect. Every operation enters through the shared sanitized repository capability.

## 15. Threat matrix

| Boundary | Threat | Consequence | Control | Failure mode |
| --- | --- | --- | --- | --- |
| Git routing | Linked worktree selects worktree-local authority | Split authority and locks | Fixed-argument common-directory resolution and private repository capability | Fail before store access |
| Inherited Git environment | Routing or configuration variables redirect resolution or snapshots | Gate/reset/import acts on attacker-selected repository | Reject known routing variables, strip remaining inherited `GIT_*`, use fixed child environment and direct arguments | `REVIEW_GIT_ENV_UNSAFE` |
| Git result ambiguity | Git emits relative, changed, or non-canonical common-directory data | Authority capability targets the wrong directory | Bounded output, canonical absolute path, repeated under-lock identity check | `REVIEW_REPOSITORY_RESOLUTION_AMBIGUOUS` |
| Pre-activation legacy detection | Legacy authority is missed before first selector publication | Two candidate authorities may appear usable | Fixed versioned root-name probes before virgin bootstrap and reset authorization | Block activation on any known root or ambiguity |
| Legacy path traversal | Crafted legacy tree causes unbounded work or reaches unrelated data | Availability or data-safety failure | Root-only no-follow metadata probes; no content reads or child listing | Return bounded ambiguity before activation; informational diagnostic afterward |
| Reset consent | Startup or ambiguous confirmation retires reviews | Unintended authority loss | Exact repository/common-directory/evidence-summary challenge | No marker publication |
| Wrong target | Confirmation is replayed in another repository | Wrong authority is retired | Re-resolve target and match repository ID plus common-directory hash | Reject before `authorized` |
| Evidence race before authorization | Legacy root metadata changes after inspect | Consent no longer describes the target | Repeat shallow probe under lock; changed summary requires a new challenge | No marker publication |
| Old writer after completion | Retired bytes change | Audit evidence drifts | Current authority never probes retired roots; optional drift diagnostic is non-authoritative | Graph and gates continue from selected incarnation |
| Reset crash | Process stops between marker, graph initialization, selector publication, and completion | Successor authority is incomplete or ambiguous | Durable monotonic phases, selector quorum, explicit resume, complete-marker binding | Gates deny until forward recovery |
| Incarnation path redirection | Crafted graph-v1 path escapes managed root | Wrong files become authority | Incarnation ID-derived paths, no-follow checks, private repository capability | `failed-closed` |
| Partial initialization | New graph is partly published | Invalid authority could be selected | Immutable objects, root quorum, selector quorum, reset remains active until verification | Deny |
| Receipt replay | Legacy or prior-incarnation receipt passes | Delivery is authorized by retired authority | Runtime brand, selector generation, epoch/incarnation, current root/head, exact target | `REVIEW_RECEIPT_EPOCH_MISMATCH`; zero actors |
| Lock contention | Reset races graph mutation/import | Corrupt roots or inconsistent selection | One control mutation lock | Contended or ambiguous |
| Lock recovery | Stale owner is misclassified | Concurrent mutation | Exact owner hash/token and proof-based recovery | Fail closed |
| Bundle graph | Missing, cyclic, forked, or conflicting closure | Forged or incomplete authority | Complete staged validation before locked publication | Import aborts unchanged |
| Prior bundle replay | Approved old graph is imported after reset | Retirement is bypassed | Exact selector generation and incarnation on manifest, objects, roots, and receipt | `REVIEW_BUNDLE_EPOCH_MISMATCH` |
| Incarnation rebinding | Caller edits manifest or receipt fields around old objects | Old authority appears current | Content identities commit incarnation; private capability and complete closure | Reject mismatch |
| Mirror | Cache mints receipt or gate proof | Stale data authorizes delivery | Separate API/private brand/live selected-graph verification | Deny authority operation |
| Resume | Retired checkpoint resets budget or skips work | Bounded contract is violated | Exact selector, epoch, incarnation, input, and reducer binding | Reject checkpoint |
| Publication | Crash exposes a partial root or selector | Partial authority | Immutable object first, then two-of-three pointer quorum | Exact prior or successor selection; otherwise deny |
| Drift diagnostic coupling | Informational retired-byte change alters authority result | Current reviews become externally controllable | Separate diagnostic API and tests proving zero authority-state dependencies | Treat as diagnostic only |

## 16. Test and fault-injection strategy

Strict TDD applies during implementation. Tests are organized by invariant.

### 16.1 Canonical, event, and root tests

- canonical-byte and domain-hash golden vectors;
- event identity changes for every body or predecessor mutation;
- only native graph event kinds are accepted;
- legacy-only kinds, root modes, and unknown fields are rejected;
- explicit genesis and complete acyclic same-lineage closure;
- duplicate object idempotency and conflicting-byte rejection;
- empty generation-zero root-set validation; and
- property tests mutating edges, sequence, lineage, state hash, epoch, incarnation, or body.

### 16.2 Exact repository-resolution tests

- denied Git routing/configuration variables fail before spawning Git or touching any review store, including empty-string values;
- every authority-bearing entry point uses the same environment matrix;
- fake Git output covers relative, multiline, NUL-containing, nonexistent, redirected, permission-denied, and changed-between-probe common directories;
- fixed arguments, `shell: false`, pathspec separation, NUL-safe snapshot framing, bounded output, and absolute Git executable are proven; and
- ordinary, bare, linked, and relocated worktrees resolve deterministically.

### 16.3 Legacy evidence and confirmation tests

- fixed known legacy roots block virgin graph activation;
- probes perform only root-level no-follow metadata operations and never inspect descendants or payloads;
- linked worktrees produce the same target and consent summary;
- inspect performs no mutation;
- exact confirmation succeeds only for the current repository, common directory, and pre-authorization summary;
- missing, partial, yes/no, stale, other-repository, normalized, and wildcard confirmation fails before marker publication;
- changed root metadata under lock requires a new challenge; and
- reset is never invoked by startup, start, import, resume, repair, or gate validation.

### 16.4 Logical-reset state-machine and fault tests

Inject process termination around:

- authorization-marker temporary write, file synchronization, replacement, and read-back;
- incarnation directory creation;
- `STORE` publication;
- empty-root installation;
- each incarnation-local current-root pointer slot;
- reset-state transitions;
- each authority-selector slot and initial quorum;
- independent graph verification;
- reset-history diagnostic publication; and
- final complete-state publication.

Restart assertions require authority denial until explicit resume, unchanged legacy bytes, no legacy semantic read, idempotent forward completion, a new epoch/incarnation bound to retained reset state, an incarnation-bound empty graph, rejection of every prior root/bundle/receipt, and zero review-budget consumption.

For fixtures containing nested legacy trees, capture byte hashes and root metadata before reset and assert exact equality after successful reset, every injected crash point, resume, import, graph mutation, and gate validation.

### 16.5 Old-writer and drift-isolation tests

- graph mutation, import, and reset serialize through the control lock;
- active and ambiguous lock owners block reset;
- simulated old writers alter retired files and add nested retired content after completion;
- current graph reads, mutations, receipts, imports for the current incarnation, and gates produce the same results before and after that drift;
- `inspect` may report `retired_evidence_drift` without changing any authority byte, selector, root, receipt, or budget;
- every authority entry point is instrumented to prove it does not access retired roots after complete marker publication; and
- no code path treats legacy and graph state as alternative authorities.

### 16.6 Reduction and lifecycle tests

- genesis-to-terminal ordinary no-fix, ordinary fix/validator, escalation, and Judgment Day flows;
- frozen claims and ledger hash remain immutable;
- actor/refuter/validator/fix/judge/final-verification counters are monotonic;
- no validator on no-fix, one final verification, and terminal closure;
- exact idempotent replay and durable prepared-operation resume;
- every legacy receipt and unbranded envelope fails gate validation;
- approved epoch A receipt fails after reset selects epoch B, even though A bytes remain in place;
- wrapper-only epoch/incarnation edits cannot mint private authority;
- prior graph objects cannot back an authoritative read after selector advancement;
- the empty post-reset graph cannot issue a receipt;
- a fresh epoch B review can pass only its exact typed target; and
- a second reset to epoch C retires both A and B without restoring review credit.

### 16.7 Bundle, checkpoint, and mirror tests

- deterministic graph-only bundle bytes and complete closure;
- malformed framing, missing/extra objects, conflicts, cycles, forks, unsupported versions, and limits;
- legacy fields, kinds, and modes are rejected;
- import cannot run while logical reset is incomplete;
- an epoch A bundle presented after epoch B selection returns `REVIEW_BUNDLE_EPOCH_MISMATCH` and leaves selector, roots, receipts, and budgets unchanged;
- explicit mirror import of an old bundle remains non-authoritative;
- manifest-only rebinding and mixed-incarnation closures fail;
- any retained reset marker prevents first-import adoption, even if selected graph control data is damaged;
- a genuinely virgin compatible repository may adopt a valid bundle;
- current-incarnation import is idempotent and descendant-only;
- checkpoint incarnation mismatch prevents reuse;
- reducer changes force revalidation without resetting budgets; and
- mirror promotion uses the authoritative importer and control lock.

### 16.8 Cross-platform durability tests

Run the logical-reset state machine on supported CI platforms with:

- exclusive marker and incarnation creation;
- canonical file synchronization and read-back;
- atomic control-file replacement;
- two-of-three selector publication;
- path-type and redirected-path refusal for graph-v1 managed storage; and
- conservative recovery when metadata durability is uncertain.

Unsupported authority, lock, or synchronization semantics fail closed before authority changes.

## 17. Rollout and rollback

### 17.1 Rollout sequence

1. Ship graph-only schemas, fixed-root pre-activation detection, and gate denial. Detected legacy state blocks while logical reset remains disabled.
2. Move graph mutation/import locking to the durable control namespace and verify contention/recovery tests.
3. Ship read-only inspect with exact target-bound retirement diagnostics and explicit statement that legacy bytes remain in place.
4. Ship incarnation-specific graph storage and authority-selector quorum while keeping graph gates disabled.
5. Enable explicit logical reset and forward recovery behind the deliberate operator command. No other operation calls it.
6. Enable graph transaction mutation, authoritative receipts, and lifecycle gates only after selector, marker, graph closure, incarnation, sanitized repository resolution, old-byte isolation, and receipt-denial tests pass.
7. Enable graph-only bundles and mirror promotion after import cannot bypass reset/incarnation rules.
8. Retire superseded transition modules, native activation experiments, schemas, tests, and documentation from the supported surface.

Every intermediate release is fail-closed. No rollout step accepts legacy authority, preserves legacy review credit, or activates a gate from incomplete graph state.

### 17.2 Rollback before authorization marker

Before `authorized` is durable, rollback may disable inactive graph/reset code. Legacy bytes remain untouched. A version that detects unsupported legacy state may continue to block.

### 17.3 Rollback after reset begins

After `authorized`, rollback to legacy-authoritative behavior is forbidden. Recovery is forward-only through a graph/reset-aware version:

- resume the same reset ID and identity material;
- initialize or verify the empty graph incarnation;
- publish or verify the bound selector;
- complete reset state; and
- run a fresh review.

The retained legacy evidence is not a rollback source. External backups and retired graph stores are inspection material only and cannot be selected as current authority.

### 17.4 Rollback after reset completes

Software rollback is allowed only to a version that understands graph-v1 selectors, the control lock, logical-reset state validation, local epochs/incarnations, old-byte isolation, and prior-receipt rejection. Older authority readers or writers must not be used.

Graph repair remains exact-byte restorative or descendant-only within the current incarnation. It never selects an older selector generation, decreases root generation, resets budgets, or restores retired authority. Bundle import failure leaves current roots unchanged; checkpoint or mirror maintenance does not change authority.

## 18. Planned file changes

Expected implementation changes, without implementation in this phase:

- update `lib/review-legacy-detector.ts` to perform fixed-root pre-activation probes, expose a separate post-retirement drift diagnostic, and remove post-retirement blocking from all authority paths;
- rewrite `lib/review-reset.ts` around exact confirmation, the logical-reset phases, new incarnation initialization, selector publication, and explicit forward recovery, with no mutation capability for legacy paths;
- update `lib/review-lock.ts` so graph mutation, import, reset, and recovery share the control lock namespace while preserving owner-token recovery semantics;
- update `lib/review-graph-schema.ts` to enforce graph-only event kinds and mandatory current-incarnation bindings;
- update `lib/review-object-store.ts` with incarnation-specific stores, `STORE.store_epoch`, selector generation, authority-incarnation binding, empty-root initialization, and two-of-three authority-selector publication;
- update `lib/review-checkpoint.ts` to bind checkpoints to selector generation, epoch, incarnation, reset ID, and exact graph inputs;
- update `lib/review-bundle.ts` to carry graph-only roots plus incarnation provenance, reject retired fields, prevent post-reset incarnation adoption, and route mismatched bundles to explicit mirror inspection only;
- update `lib/review-repository.ts` with graph-v1 control/incarnation paths, exact target hashing, centralized inherited-Git-variable rejection/stripping, fixed child environments, direct arguments, and private resolved capabilities;
- refactor `lib/review-transaction.ts` so every authority-bearing entry point uses the shared selector/marker/incarnation guard and never accesses retired paths after activation;
- update `extensions/gentle-ai.ts` with inspect/logical-reset routing and remove the superseded transition operation;
- retire `lib/review-migration.ts`, `lib/review-native-fence.ts`, related package assets, and related exports from the supported graph-v1 surface;
- replace reset tests that assert legacy storage mutation with `tests/review-reset.test.ts` coverage for marker/selector publication, byte preservation, crash recovery, drift isolation, and old-artifact denial;
- add table-driven repository-resolution tests across every authority-bearing entry point;
- update graph, lock, bundle, checkpoint, mirror, transaction, controller, and lifecycle gate suites for graph-only authority, selector advancement, post-reset incarnation invalidation, old-bundle inspection-only behavior, and exact receipt denial; and
- update operator documentation with exact logical-reset consequences, recovery commands, in-place evidence retention, no-authority-rollback boundary, and fresh-review requirement.

The change remains authority-critical and likely exceeds 1,000 changed lines with tests. Tasks should split it into independently fail-closed slices: (1) graph-only schemas and pre-activation block, (2) control lock plus logical-reset marker and selector, (3) graph transaction/receipt/resume integration, and (4) bundles/mirrors and superseded-surface cleanup. No intermediate slice may accept legacy authority or pass a gate from incomplete graph-v1 state.
