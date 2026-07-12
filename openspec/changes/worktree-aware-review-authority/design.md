# Design: Route terminal review authority by the live candidate

## Decision summary

Keep review authority repository-wide in the Git common directory, but separate **authority inventory** from **terminal applicability**.

- `INSPECT` continues to report every compact lineage in repository-wide authority. It derives the requested `cwd`'s live content/scope binding, but a bare inspection reports terminal applicability as `policy-unresolved` when a structural match exists because it does not know the future START policy. It therefore does not claim that a terminal blocks START. An optional ordinary inspection input containing `policyHash` completes the comparison.
- Ordinary `START` validates repository-wide compatibility authority first, then `startCompactReview` captures the requested live snapshot before scanning terminal receipts. Exactly one complete match reuses/blocks on that terminal; no match creates the existing fresh compact lineage; more than one match fails closed as ambiguous.
- Applicability uses existing repository authority, snapshot, state, and receipt fields. It adds no worktree identity and changes no persisted schema.
- Missing `control/reset-state.json` is distinguished from malformed reset state by a typed internal error and mapped to a stable `reset-state-unavailable` controller outcome before any mutation.

## Goals and boundaries

### Goals

1. Let materially different candidates in linked worktrees reach fresh compact START.
2. Reuse terminal authority only for the complete existing repository/content/scope/policy binding.
3. Preserve receipt integrity, explicit-lineage behavior, compatibility authority, and reset safety.
4. Make missing durable reset state deterministic and fail closed.

### Non-goals

- No worktree path, worktree ID, or branch name in candidate, lineage, state, or receipt identity.
- No receipt/state schema or common-directory layout change.
- No migration, supersession, deletion, or rewrite of existing authority.
- No change to graph-v1 mutation rules, Judgment Day, gate validation, or reset authorization.

## Current symbols and responsibilities

| Symbol | Current responsibility | Design change |
|---|---|---|
| `executeReviewControllerOperation` in `extensions/gentle-ai.ts` | Routes INSPECT, START, and RECOVER | Separates compatibility blocking from candidate-specific terminal applicability; maps missing reset state to a typed outcome. |
| `inspectReviewAuthorityForController` in `extensions/gentle-ai.ts` | Combines legacy and compact repository inspection | Keeps repository-wide inventory authoritative and adds terminal-applicability metadata without filtering the inventory. |
| `durableResetRecoveryRequest` in `extensions/gentle-ai.ts` | Reads and validates `reset-state.json` | Throws a typed error only for an absent file; malformed/integrity errors remain distinct. |
| `resolveRepositoryAuthorityV1` in `lib/review-repository.ts` | Resolves canonical common-directory authority and validates pinned repository identity | Supplies the explicit `repository_id` and authority-scope tuple for both live and terminal ephemeral bindings; no identity format change. |
| `captureReviewSnapshot` / `SnapshotV1` in `lib/review-snapshot.ts` | Captures START content, paths, untracked scope, and policy | Remains the single START snapshot. A read-only live-binding helper reuses its candidate-field derivation and adds the resolved `repository_id` without persisting a new identity or snapshot schema. |
| `startCompactReview` in `lib/review-facade.ts` | Captures candidate, derives lineage, scans terminal states, creates state | Captures once before applicability, compares repository-bound validated terminal receipts, and handles zero/one/multiple matches deterministically. |
| `CompactReviewStoreV2.loadTerminalReceipt` | Validates terminal state/receipt equivalence | Supplies receipt/state fields after store resolution has proven repository scope; no store or receipt format change. |
| `CompactReviewStartBlockedError` | Reports an applicable approved/escalated target | Retained for exactly one applicable terminal. |

## Architecture

### 1. Ephemeral live candidate binding

Add an internal, non-persisted view in `lib/review-snapshot.ts`. Repository identity enters this binding explicitly from the ordinary authority resolver; it is not inferred from a worktree root:

```ts
interface LiveReviewCandidateBinding {
  repository_id: string;
  base_tree: string;
  complete_snapshot_tree: string;
  initial_review_tree: string;
  genesis_paths: string[];
  intended_untracked: string[];
}
```

The operation first calls `resolveRepositoryAuthorityV1(cwd)`. Its pinned `repository_id` is the authoritative repository identity: the resolver canonicalizes `git rev-parse --git-common-dir`, confines `store_root` below that directory, reads or atomically establishes `<store_root>/IDENTITY`, verifies the pinned object format and root-commit anchors against the live repository, and derives `repository_id` from that validated pinned identity. Failure at any step aborts applicability inspection; it is never converted to “not applicable.”

The helper receives that resolved `RepositoryAuthorityV1` (or at minimum its `repository_id`) together with `cwd`, and copies `authority.repository_id` into `LiveReviewCandidateBinding`. The remaining fields are an in-memory projection of existing `SnapshotV1` derivation. The helper uses the same temporary-index/tree construction and canonical path discovery as `captureReviewSnapshot`, then removes its temporary index/object directory. It does not write under compact authority, create a lineage, materialize a receipt, or retain a snapshot directory.

`captureReviewSnapshot` and the read-only helper must share the low-level Git derivation rather than duplicate commands. START still uses the persisted `SnapshotV1`, because later review phases need its isolated object store. START projects that snapshot together with the already resolved `authority.repository_id`; INSPECT uses only the ephemeral binding. `repository_root` is deliberately excluded because linked worktrees legitimately have different roots.

### 2. Repository-bound terminal applicability comparator

The compact receipt schema does not contain `repository_id`, so receipt bytes alone cannot prove repository applicability. Do not add such a field. Instead, construct an ephemeral terminal binding from two authoritative sources:

```ts
interface TerminalReviewCandidateBinding {
  repository_id: string;
  receipt: CompactReceiptEnvelopeV2;
}
```

`repository_id` MUST come from the same validated `RepositoryAuthorityV1` used to resolve the compact store; receipt fields MUST come from `CompactReviewStoreV2.loadTerminalReceipt()`. The comparator accepts a `LiveReviewCandidateBinding`, optional requested policy hash, and this terminal binding. Repository identity is therefore an explicit equality check, not an implicit assumption.

| Material dimension | Live value | Terminal value |
|---|---|---|
| Repository | `live.repository_id` | `terminal.repository_id` from the terminal store's resolved authority context |
| Base tree | `live.base_tree` | `receipt.body.base_tree` |
| Complete/current candidate tree | `live.complete_snapshot_tree` | `receipt.body.final_candidate_tree` |
| Changed paths | `live.genesis_paths` hashed with the receipt's existing compact-path domain/canonicalization | `receipt.body.genesis_paths_hash` |
| Intended untracked | `live.intended_untracked` hashed with the receipt's existing compact-untracked domain/canonicalization | `receipt.body.intended_untracked_hash` |
| Policy | requested `policyHash` | `receipt.body.policy_hash` |

The exact same-common-directory invariant is:

1. Resolve `operationAuthority = resolveRepositoryAuthorityV1(cwd)` once for the requested operation.
2. Discover terminals only below `assertManagedStorePathV1(operationAuthority.common_directory, join(operationAuthority.store_root, "compact-v2"))`; reject a non-directory, symlink, invalid lineage entry, or path escape.
3. Construct every `CompactReviewStoreV2` for that scan with the same authority context, not from an arbitrary receipt path or caller-supplied bundle path. The terminal binding receives `operationAuthority.repository_id` only after `loadTerminalReceipt()` proves receipt/state equivalence.
4. Before returning an applicability decision, and before START blocks on a terminal or attempts CAS creation, re-resolve `cwd` and require exact equality of `common_directory`, `store_root`, `repository_id`, and `authority_id` with `operationAuthority`. Any resolution error or mismatch fails closed as repository-authority/integrity failure; it MUST NOT become “not applicable” or fresh START. Existing store mutation checks remain the final CAS-side guard.

This invariant preserves linked worktrees because they resolve the same canonical common directory, store root, pinned repository ID, and authority ID. It rejects cross-repository or bundle confusion because applicability never accepts a detached receipt: a copied/transplanted compact store is read only through the destination repository's managed root, and `resolveRepositoryAuthorityV1` rejects a pinned identity whose object format or root anchors do not match that live repository. A receipt or bundle supplied from another root cannot enter the comparator. Even if two repositories have equal Git content, different canonical common directories/store roots remain different authority scopes; they cannot reuse each other's terminal store. A legitimate different repository therefore sees only its own store and may START a fresh lineage there; a repository-ID mismatch inside one resolved store is corruption/transplant evidence and fails closed rather than being treated as an ordinary material difference. Imported authority, if supported by another workflow, must first become valid authority in the destination store under that workflow's existing validation and is not treated as a detached terminal receipt here.

The receipt's `initial_review_tree` remains integrity-checked by `loadTerminalReceipt`; it is not substituted for the live current candidate. This matters after an approved correction, where `final_candidate_tree` is the gate-validatable candidate and may differ from the initially reviewed tree.

The comparator must not use directory path, branch name, worktree administrative path, receipt path, mtime, or lineage ID as candidate identity. Canonical common directory and store root are authority-provenance guards, not new candidate identity fields.

### 3. INSPECT reports inventory separately from applicability

`inspectReviewAuthorityForController` continues to return the unfiltered `compact_authority` result from `inspectCompactReviewAuthorityV2`. Add a separate discriminated field:

```ts
const COMPACT_TERMINAL_APPLICABILITY = {
  APPLICABLE: "applicable",
  NOT_APPLICABLE: "not-applicable",
  POLICY_UNRESOLVED: "policy-unresolved",
  AMBIGUOUS: "ambiguous",
} as const;
```

Controller INSPECT accepts an optional JSON-string `input` for an ordinary candidate probe:

```json
{"mode":"ordinary","policyHash":"<sha256>","projection":{"kind":"complete"}}
```

Behavior:

1. Run repository-wide legacy/graph/reset/compact integrity inspection first.
2. If compatibility authority is blocked, reset-in-progress, mixed/ambiguous, or compact-invalid, return the existing fail-closed routing. Candidate applicability cannot weaken it.
3. Resolve the repository authority and derive the requested `cwd`'s ephemeral live binding with its explicit `repository_id`.
4. Discover terminal stores only through that authority context, load every validated terminal receipt, construct its ephemeral terminal binding with the same resolved `repository_id`, and compare all structural fields including repository identity.
5. If INSPECT supplied `policyHash`, include policy in the match:
   - one match: `applicable` and the exact lineage/action;
   - no match: `not-applicable`, `status: "ready"`, `next_action: "start-ordinary-review"`;
   - multiple matches: `ambiguous`, `status: "blocked"`, `next_action: "stop-and-report-ambiguous-compact-terminal-authority"`.
6. If INSPECT did not supply policy:
   - no structural match: `not-applicable` and ready;
   - one or more structural matches: `policy-unresolved`, include only candidate lineage IDs, and return `status: "ready"`, `next_action: "start-ordinary-review-to-resolve-policy-binding"`.

This preserves repository-wide observability while preventing a policy-free advisory call from deciding that a future START is blocked. Existing tests that expect bare INSPECT to say `terminal` must supply the terminal policy when they intend to assert applicability; bare INSPECT instead reports terminal inventory plus unresolved applicability.

Active compact authority remains repository-visible and follows existing in-progress routing. Candidate-aware filtering applies only to terminal compact applicability.

### 4. START derives once before terminal selection

For ordinary START, controller flow becomes:

```text
parse and validate ordinary input, complete projection, and policy
  -> inspect repository compatibility/integrity authority
  -> block legacy / graph-mixed / ambiguous / reset-in-progress / compact-invalid
  -> call startCompactReview
       -> resolve operationAuthority from cwd
       -> captureReviewSnapshot(cwd, complete, policy) exactly once
       -> project snapshot with operationAuthority.repository_id
       -> resolve explicit lineage rules
       -> discover stores through operationAuthority and load every terminal receipt
       -> compare complete candidate binding
       -> 0 matches: derive fresh lineage and existing CAS START
       -> 1 match: CompactReviewStartBlockedError
       -> >1 matches: CompactReviewTerminalAmbiguityError
```

The controller must not reject START merely because repository inspection reports approved/escalated terminal history. Terminal selection occurs only after the facade has the actual START policy and captured snapshot.

Update `derivedLineageId` to include `policy_hash` alongside the existing base tree, initial/complete tree, genesis paths, and intended-untracked fields. Otherwise the same content under a materially different policy deterministically collides with the old lineage before fresh-lineage routing. Repository ID need not enter the hash because lineage storage is already repository-scoped.

#### Explicit lineage

An explicit existing lineage is resolved before unrelated terminal matching, but after live snapshot capture:

- graph-v1 with the same ID remains fail closed;
- an existing compact terminal with the same ID and complete matching binding returns the existing blocked/reuse action;
- an existing compact terminal with the same ID but any content/scope/policy mismatch returns a typed binding-mismatch error and never falls through to a fresh START under that ID;
- active same-lineage CAS/idempotency behavior remains unchanged.

#### Multiple terminals

Do not use `.find()` as the authority decision. Collect all exact matches after every receipt has passed `loadTerminalReceipt()`:

- zero exact matches do not block a fresh lineage, regardless of unrelated terminal count;
- one exact match is applicable;
- more than one exact match is impossible under healthy idempotency but is treated as ambiguous authority, with sorted lineage IDs and no mutation.

Add `CompactReviewTerminalAmbiguityError` and `CompactReviewLineageBindingMismatchError` as typed facade errors. Controller maps either to `status: "blocked"`, `lineage_created: false`, and a stable next action. Invalid receipt/state loading remains fail closed and is never treated as “no match.”

### 5. Compatibility authority remains fail closed

Candidate matching is reached only after compatibility classification permits compact ordinary START.

| Authority condition | Routing |
|---|---|
| Legacy or blocked legacy | Existing destructive-reset authorization path; no candidate bypass. |
| Graph-v1/compact same-lineage or mixed authority | Existing ambiguity/mixed failure; no migration or mutation. |
| Compact-invalid | Block/reset path; invalid data is not skipped while scanning terminals. |
| Reset in progress | Recovery path only; no START. |
| Active compact lineage(s) | Existing in-progress reporting and CAS behavior. |
| Valid unrelated terminal receipt(s) | Visible in inventory but not blockers for a different complete binding. |
| Exactly matching terminal receipt | Existing validate/change-scope action. |

Existing terminal receipts are loaded read-only and never rewritten, superseded, forked, or deleted by applicability checks or another candidate's START.

## Missing reset-state control flow

Add an internal typed error and external typed outcome using const-object-derived types:

```ts
const REVIEW_CONTROLLER_OUTCOME = {
  RESET_STATE_UNAVAILABLE: "reset-state-unavailable",
} as const;

class ReviewResetStateUnavailableError extends Error {
  readonly code = REVIEW_CONTROLLER_OUTCOME.RESET_STATE_UNAVAILABLE;
  readonly statePath: string;
}
```

`durableResetRecoveryRequest` catches only filesystem `ENOENT` for the exact `control/reset-state.json` path and throws `ReviewResetStateUnavailableError`. JSON, integrity, repository mismatch, authorization, and unsafe-path failures remain their existing distinct errors; they must not be collapsed into “unavailable.”

`inspectReviewAuthorityForController` catches the typed error only when legacy inspection says `reset-in-progress`. It returns the repository inspection with:

```json
{
  "outcome": "reset-in-progress",
  "reset_state_outcome": "reset-state-unavailable"
}
```

It omits `reset_request`, because no durable challenge can be proven.

RECOVER control flow is exact:

1. Parse and validate the supplied controller input. Interactive authorization remains independently required by the outer controller tool.
2. Call `durableResetRecoveryRequest(defaultCwd)` before `pendingAuthorizations.clear()` and before `destructiveResetReviewAuthorityV1`.
3. On `ReviewResetStateUnavailableError`, return:

```json
{
  "operation": "recover",
  "status": "blocked",
  "outcome": "reset-state-unavailable",
  "mutation_performed": false,
  "next_action": "stop-and-restore-durable-reset-state"
}
```

The response may include the fail-closed inspection above, but must not include or fabricate a reset request.
4. Do not clear pending authorizations, invoke reset recovery, acquire a mutation lock, append a journal entry, create a lineage/receipt, or write any file.
5. Only an available and fully validated durable request proceeds to the existing clear-and-resume flow.

An identical retry against unchanged missing state follows the same branch and returns the same discriminated outcome.

## Data flow

### Candidate-specific INSPECT

```text
cwd
 -> resolve and pin repository authority
 -> repository-wide compatibility/compact inventory under that authority
 -> ephemeral live Git candidate fields + explicit repository_id
 -> terminal receipt read + integrity validation under the same authority
 -> repository identity + structural comparison
 -> optional policy comparison
 -> applicability metadata + non-authoritative inventory
```

### Ordinary START

```text
START input (cwd + complete projection + policy)
 -> resolve repository authority + compatibility fail-closed guard
 -> persisted SnapshotV1 capture + explicit repository_id projection
 -> managed-store receipt load + repository/complete binding comparison
 -> applicable terminal block/reuse OR fresh derived lineage
 -> existing atomic compact store replace
```

### RECOVER with missing state

```text
RECOVER input + UI authorization
 -> exact reset-state read
 -> ENOENT typed error
 -> stable blocked outcome
 -> zero mutation
```

## File changes

| File | Planned change |
|---|---|
| `lib/review-snapshot.ts` | Factor shared candidate derivation and expose an ephemeral read-only live binding with explicit resolved `repository_id` for INSPECT. Do not alter `SnapshotV1`. |
| `lib/review-facade.ts` | Add authority-context-bound terminal discovery and receipt applicability comparison, policy-bound derived lineage, explicit-lineage mismatch handling, and multiple-match ambiguity handling. |
| `lib/review-compact-store.ts` | Add a schema-neutral internal/read-only discovery seam that accepts one resolved `RepositoryAuthorityV1` and attaches that context to loaded terminal bindings; retain existing public `cwd` resolution and all persisted formats. |
| `extensions/gentle-ai.ts` | Add optional INSPECT candidate input, inventory/applicability output separation, START compatibility routing, typed reset-state-unavailable mapping, and controller error mappings. |
| `tests/review-snapshot.test.ts` | Prove ephemeral capture returns existing fields, is worktree-root aware, and leaves no retained snapshot/authority mutation. |
| `tests/review-facade.test.ts` | Cover each material binding dimension, policy-derived lineage, explicit lineage mismatch, multiple matches, receipt integrity, and receipt preservation. |
| `tests/review-controller.test.ts` | Add linked-worktree INSPECT/START integration, bare INSPECT policy-unresolved behavior, compatibility cases, retry idempotency, and missing reset-state outcome/no-mutation assertions. |

No change is planned for `review-compact.ts`, receipt schemas, gate schemas, repository identity format, or repository authority layout. The compact-store change is limited to a read-only authority-context discovery seam; it must not alter state/receipt bytes, store paths, mutation behavior, or compatibility semantics.

## Strict TDD plan

Strict TDD is active; the required runner is `pnpm test`. Each production step starts with a failing regression and records RED/GREEN evidence.

### RED/GREEN sequence

1. **Missing reset state**
   - RED: interrupt RESET, remove only `reset-state.json`, call RECOVER twice, and assert the exact typed outcome plus byte-for-byte unchanged authority/receipt/journal inventory after the removal baseline.
   - GREEN: add the typed ENOENT error and controller mapping before any mutation call.
2. **Facade full-binding comparison**
   - RED: terminal A; vary independently repository authority, base tree, complete/final candidate tree, changed-path hash, intended-untracked hash, and policy. Each difference must prevent reuse while an exact binding blocks/reuses A. Prove a detached/copied receipt cannot enter applicability, a transplanted compact store with mismatched pinned identity fails closed, and two linked worktrees with one common directory retain the same repository binding.
   - GREEN: introduce the authority-context-bound terminal binding and single comparator, then include policy in derived lineage.
3. **Explicit lineage and multiple terminals**
   - RED: prove explicit mismatch fails closed and duplicate exact terminal matches report sorted ambiguity without mutation.
   - GREEN: add typed facade errors and deterministic collection logic.
4. **Linked-worktree controller routing**
   - RED: create linked worktrees sharing one common-directory authority; prove an identical complete binding plus policy reuses the terminal and a material difference reaches fresh START.
   - GREEN: move terminal applicability behind START snapshot capture and add INSPECT applicability metadata.
5. **INSPECT without START policy**
   - RED: bare INSPECT must retain repository inventory, derive structural candidacy, report `policy-unresolved`, and leave future different-policy START ready.
   - GREEN: add optional INSPECT input and tri-state applicability routing.
6. **Compatibility and receipt preservation**
   - RED: graph-v1, legacy, mixed, compact-invalid, and reset-in-progress remain blocked; after candidate B starts, candidate A's receipt bytes/hash and gate validation remain unchanged.
   - GREEN: tighten only compatibility guard composition; do not modify stores or receipts.
7. **REFACTOR/TRIANGULATE**
   - Remove duplicated field comparison, retain const-derived outcome types, and run `pnpm test` after refactoring.

Tests should use existing repository/worktree fixtures, `CompactReviewStoreV2.loadTerminalReceipt`, and current controller call helpers. Production code receives no test-only worktree switch or alternate identity.

## Concurrency and idempotency

- START resolves one repository authority and captures one snapshot before terminal scanning, so one request compares one immutable candidate tree within one explicit repository scope.
- Applicability revalidates the authority tuple (`common_directory`, `store_root`, `repository_id`, `authority_id`) before deciding or mutating; an authority race fails closed.
- Derived lineage includes all material START dimensions, including policy. Repository identity need not be added to the lineage hash because lineages are physically scoped by the validated common-directory store; different repository scopes cannot collide in one authority. Concurrent exact starts target the same repository-scoped lineage; existing store CAS permits at most one creation.
- Terminal receipts are validated on every applicability read. A concurrent state/receipt inconsistency fails closed rather than becoming “not applicable.”
- INSPECT is advisory and read-only. START always re-derives the live snapshot and does not trust prior INSPECT applicability.
- Sorted matching lineage IDs make ambiguity and retry output deterministic.

## Rollout and rollback

This is a single-PR controller/facade change with no artificial delivery line cap. Rollout requires strict-TDD evidence from `pnpm test`, followed by the mandatory native bounded implementation review and receipt validation before delivery.

Rollback is a code revert of the controller routing, comparator, ephemeral capture, read-only compact-store discovery seam, and typed recovery mapping. No data migration or cleanup is required because persisted state, receipts, journal formats, and common-directory layout do not change. Receipts created before, during, or after rollout remain readable and gate-validatable.

## Verification checklist

- [ ] Bare INSPECT reports repository terminal inventory without asserting policy-dependent applicability.
- [ ] Policy-bound INSPECT and START identify exactly one matching terminal across linked worktrees.
- [ ] Worktree path differences are ignored; `LiveReviewCandidateBinding.repository_id` explicitly equals the repository ID attached to terminal store discovery.
- [ ] Same-common-directory resolution proves linked-worktree reuse, while authority tuple mismatch, detached receipts, transplanted stores, and resolution races fail closed.
- [ ] Repository identity, base, final candidate, paths, untracked scope, and policy each affect applicability.
- [ ] Different policy derives a fresh lineage instead of colliding with the old derived ID.
- [ ] Explicit lineage mismatch and duplicate matching terminals fail closed without mutation.
- [ ] Legacy, graph, mixed, invalid, and reset authority cannot be bypassed.
- [ ] Missing reset state returns `reset-state-unavailable` twice with zero mutation.
- [ ] Original receipt bytes/hash and gate validity survive another candidate's START.
- [ ] `pnpm test` passes before native bounded review begins.

---

# Amendment: Separate implementation progress from parent lifecycle actions

## Amendment decision summary

This amendment adds the smallest ownership boundary required by `specs/sdd-orchestration/spec.md`; it does not alter the validated issue #118 review-authority design above.

- Every newly generated task checkbox ends with exactly one ownership comment: `<!-- sdd-owner: implementation -->` or `<!-- sdd-owner: parent -->`.
- An unmarked legacy checkbox remains implementation-owned. A line that mentions `sdd-owner` but does not contain exactly one supported terminal marker is malformed, remains unresolved in implementation accounting, and blocks with a visible task-artifact error.
- Native status keeps `taskProgress` as the implementation progress field for compatibility and adds `deferredParentActions` plus `taskArtifactErrors`. Parent-owned actions never make `applyState` ready or incomplete.
- After implementation completion, routing always reaches the mandatory post-apply bounded-review boundary, whether parent markers are pending, checked, or absent. Explicit parent markers improve visibility and detail; they do not create the review obligation. This legacy-safe fallback prevents an unmarked task artifact from bypassing review.
- At that boundary, the parent/orchestrator reuses an approved receipt only when native authority proves it valid for the live candidate. A missing receipt routes to explicit parent `review/start`; scope-changed, invalidated, escalated, ambiguous, or otherwise invalid authority fails closed. Task text and checkbox state never prove receipt approval.
- `sdd-apply` executes, checks, and reports implementation-owned tasks only. It cannot start review/refutation/correction/validation actors, create or approve receipts, or validate lifecycle gates.
- The full SDD chain must yield at this parent boundary rather than letting the apply executor absorb review ownership. Only after an approved content-bound receipt exists may the parent resume at independent SDD verification; sync, archive, and delivery routing additionally require that verification to be ready/successful under the existing flow.

## Ownership marker contract

### Canonical syntax

The marker is a terminal HTML comment on the same line as the Markdown checkbox:

```markdown
- [ ] Add parser regression coverage. <!-- sdd-owner: implementation -->
- [ ] Start or reuse native bounded review. <!-- sdd-owner: parent -->
- [ ] Validate the same receipt at the pre-commit gate. <!-- sdd-owner: parent -->
```

Only the two lowercase values above are supported. This is one marker with two values, not a generic taxonomy. The marker carries ownership only; it does not encode phase, gate type, review mode, ordering, actor, or delivery state.

`sdd-tasks` MUST emit exactly one canonical marker on every generated checkbox. Implementation tasks use `implementation`. Bounded-review and lifecycle-gate actions use `parent` and remain explicit checkboxes so they stay visible until the parent performs them. Parent-owned tasks should be grouped under a clearly named parent lifecycle section and ordered according to the existing review/gate workflow; status does not parse their prose to infer semantics.

### Deterministic parsing

Replace the checkbox counter with one line-oriented parser. For each line matching the existing Markdown checkbox prefix (`- [ ]`, `- [x]`, or `- [X]`):

1. If the line contains no case-insensitive `sdd-owner` token, classify it as `implementation`. This is the legacy default.
2. If the line ends, allowing only trailing whitespace, in exactly one canonical comment `<!-- sdd-owner: implementation -->`, classify it as `implementation`.
3. If the line ends in exactly one canonical comment `<!-- sdd-owner: parent -->`, classify it as `parent`.
4. If `sdd-owner` appears anywhere but rules 2 or 3 do not match exactly, or appears more than once, classify the line as malformed.

Examples of malformed input include unsupported values, uppercase values, duplicate comments, a non-terminal marker, and an unterminated ownership comment. A misspelling that does not contain `sdd-owner` is indistinguishable from ordinary legacy task text and therefore follows the safe legacy default: implementation-owned.

Malformed lines fail closed in two ways:

- add the exact line and a stable diagnostic to `taskArtifactErrors` and `blockedReasons`;
- account for the line as one unresolved implementation task regardless of whether its checkbox is `[ ]` or `[x]`.

Therefore malformed input can never make implementation appear complete or silently move work outside apply accounting. `nextRecommended` becomes `fix-task-ownership-marker`, and no implementation or lifecycle executor should act until the artifact is corrected. This is a task-artifact repair route, not a new task category.

## Native status shape and compatibility

Use const-object-derived owner values in `lib/sdd-status.ts`:

```ts
const SDD_TASK_OWNER = {
  IMPLEMENTATION: "implementation",
  PARENT: "parent",
} as const;

type SddTaskOwner = (typeof SDD_TASK_OWNER)[keyof typeof SDD_TASK_OWNER];
```

Retain the flat `SddTaskProgress` shape. The authoritative OpenSpec status adds two fields while preserving `taskProgress`:

```ts
interface SddStatus {
  // Existing field; now explicitly implementation-owned progress.
  taskProgress: SddTaskProgress;
  // Parent-owned review and lifecycle checkboxes, reported but excluded from apply.
  deferredParentActions: SddTaskProgress;
  // Stable diagnostics containing the exact malformed checkbox line.
  taskArtifactErrors: string[];
  // Existing fields remain unchanged.
}
```

`taskProgress.total`, `complete`, `remaining`, and `unchecked` include implementation-owned and malformed checkboxes only. `deferredParentActions` uses the same counters for valid parent markers. Checked parent actions remain visible in its completion count; unchecked parent actions remain in its exact `unchecked` list. Malformed lines never enter `deferredParentActions`.

All constructors, including empty and non-authoritative status, populate the additive fields with zero-value progress and an empty error list. Rendered JSON exposes them directly. Human-readable status and phase instructions label the two lists separately so an unchecked parent action is never described as an apply task or verification blocker.

The schema remains `gentle-pi.sdd-status` version 1 because this is an additive response change and the meaning of `taskProgress` is unchanged for every legacy artifact: all unmarked checkboxes still count exactly as before. Existing callers that ignore unknown fields remain compatible. Existing marked artifacts did not have defined semantics, so recognizing the new marker introduces no prior contract break.

### Apply and routing semantics

Compute apply readiness from `taskProgress` only:

| Condition | `applyState` / `dependencies.apply` | Route |
|---|---|---|
| Missing/partial core artifact, no implementation checkbox, unsafe context, review recovery block, or ownership parse error | `blocked` | Existing blocker, `resolve-review`, or `fix-task-ownership-marker` as applicable |
| At least one unresolved implementation task | `ready` | `sdd-apply` |
| All implementation tasks complete | `all_done` | Never `sdd-apply` |
| Implementation complete, regardless of parent-marker presence or checkbox state, and no authoritative approved receipt is established for the live candidate | `all_done` | `parent-lifecycle`; missing receipt requires explicit parent `review/start` |
| Implementation complete and review authority is scope-changed, invalidated, escalated, ambiguous, or invalid | `all_done` | Fail closed through the existing review-authority recovery/escalation route; never verify/sync/archive |
| Implementation complete and an existing receipt is authoritatively approved and valid for the live candidate | `all_done` | Reuse that receipt and allow the independent `sdd-verify` route; only verified readiness may unlock later sync/archive routing |

`parent-lifecycle` is a parent/orchestrator handoff, not an SDD phase and not proof of review approval. The parent reads `deferredParentActions.unchecked` when present for visibility, but the mandatory boundary does not depend on that list. It applies the existing authority-first lifecycle rules: reuse a valid approved content-bound receipt; explicitly start ordinary bounded review when the receipt is missing; and fail closed for scope-changed, invalidated, escalated, ambiguous, or otherwise invalid authority. Later lifecycle gates validate the same receipt. Status MUST NOT inspect action prose, treat checked or absent markers as authority, mint authority, launch an actor, or mark any parent checkbox complete.

When native status lacks authoritative review-overlay evidence, implementation completion deterministically routes to `parent-lifecycle`; it MUST NOT assume that absence of a parent marker means review is complete. Controller-provided authority may prove an existing receipt reusable, but task text cannot. Pending parent actions remain archive blockers, while absent markers are not permission to archive. Parent actions are not apply blockers and are not reported as unchecked implementation tasks. After receipt approval, independent verification remains required before sync/archive readiness; delivery-gate actions remain deferred until their native gate boundary. This amendment deliberately does not turn `lib/sdd-status.ts` into a lifecycle scheduler or redesign the existing review-authority overlay.

Malformed ownership takes precedence over ordinary phase routing. Existing `resolve-review` recovery behavior retains precedence when controller-provided review authority is expected and invalid; neither route is weakened by the ownership split.

## Agent and chain contracts

### `assets/agents/sdd-tasks.md`

Add a mandatory ownership section to the task-generation rules:

- emit one canonical marker on every checkbox;
- use `implementation` for RED/GREEN/TRIANGULATE/REFACTOR, code, tests, artifact updates, and implementation verification owned by apply;
- use `parent` only for bounded-review and lifecycle-gate actions that the parent must perform;
- keep parent actions explicit, ordered, and separate from implementation finish evidence;
- never create additional owner values or infer ownership from headings alone.

The generator must not place “start native bounded review” inside an implementation-owned work unit. A work unit may state that implementation finishes with test evidence; the following parent lifecycle section owns review and gate checkboxes.

### `assets/agents/sdd-apply.md`

Before selecting work, `sdd-apply` consumes the status ownership fields and independently applies the same marker contract when reading Engram or inline tasks where native OpenSpec status is unavailable. It:

- selects only unresolved implementation-owned tasks;
- marks only implementation-owned checkboxes complete;
- leaves every parent marker byte-for-byte unchecked unless it was already checked by the parent;
- reports implementation completion when `taskProgress.remaining === 0`, even if `deferredParentActions.remaining > 0`;
- returns `next_recommended: "parent-lifecycle"` whenever implementation completes, even when the deferred list is empty; when parent markers exist, it also lists their exact deferred lines. Only the parent/native authority router may then reuse an approved receipt and advance to verification;
- stops on `taskArtifactErrors` or a malformed marker;
- never treats review or gate evidence as apply completion evidence.

Add an explicit prohibition covering bounded-review, refutation, correction, and validation actors; receipt creation/approval; and pre-commit, pre-push, pre-PR, release, or other delivery-gate validation. This prohibition applies even when a parent-owned checkbox is the only unchecked line and even in automatic/full-chain mode.

### `assets/agents/sdd-status.md` and `assets/support/sdd-status-contract.md`

Document the exact marker grammar, legacy default, malformed behavior, additive fields, and route table above. Status output must show “Implementation tasks” and “Deferred parent lifecycle actions” separately, and must state that marker presence is observability rather than review authority. Verification/archive wording must refer only to unchecked implementation tasks when describing apply completion; nevertheless, every completed implementation routes through the mandatory post-apply review boundary. Archive requires an approved receipt, independent verification readiness, and reconciliation of any explicit deferred mandatory parent actions at their proper lifecycle boundaries.

### `assets/chains/sdd-full.chain.md`

A change is required because the current linear chain places `sdd-verify` immediately after `sdd-apply` without naming the parent boundary. Amend the chain contract so every transition out of completed implementation yields control to the parent/orchestrator unless authoritative routing already proves an approved receipt for the live candidate. This yield is mandatory even when no parent marker exists. The apply agent does not execute that step. The parent explicitly starts bounded review when no receipt exists, reuses only a valid approved receipt, and fails closed on scope-changed, invalidated, escalated, ambiguous, or invalid authority. It resumes the chain at independent verification only after receipt approval; sync/archive routing requires verification readiness as well. Future delivery gates remain parent-owned and execute only at their native gates.

This is a control-boundary clarification, not a new chain actor or review phase. Do not add a review agent section to the chain and do not let chain execution imply a receipt or gate result.

## SDD ownership data flow

```text
sdd-tasks
  -> emits every checkbox with one canonical sdd-owner marker
  -> tasks.md
       -> native parser
            -> taskProgress (implementation + malformed fail-closed)
            -> deferredParentActions (valid parent markers)
            -> taskArtifactErrors
       -> unresolved implementation? sdd-apply
       -> malformed marker? fix-task-ownership-marker
       -> implementation complete? mandatory parent-lifecycle boundary
            -> explicit markers, when present, provide visibility only
            -> missing receipt: parent explicitly starts bounded review
            -> valid approved receipt: parent reuses it
            -> scope-changed / invalidated / escalated / ambiguous / invalid: fail closed
            -> approved receipt: independent sdd-verify may run
            -> verified readiness: existing sync/archive flow may continue
            -> parent validates the same receipt at each applicable delivery gate
            -> parent marks only the actions it actually performed
       -> no downstream route bypasses receipt approval or independent verification
```

For Engram/none modes, the status remains non-authoritative as before. The apply/status agent prompt uses the same marker grammar against the retrieved task artifact; it must not reinterpret parent tasks as implementation or silently tolerate malformed markers. The parent/orchestrator therefore applies the same marker-independent fallback itself: completed implementation yields to bounded-review authority resolution before verification, even when no explicit parent marker exists.

## Amendment file changes

| File | Planned change |
|---|---|
| `assets/agents/sdd-tasks.md` | Require the canonical marker on every generated checkbox and separate parent lifecycle actions from implementation work units. |
| `assets/agents/sdd-apply.md` | Select/complete implementation ownership only, report deferred parent actions, stop on malformed markers, and prohibit all bounded-review/gate ownership. |
| `assets/agents/sdd-status.md` | Teach read-only status reporting the marker, split progress fields, malformed route, and unconditional post-apply parent handoff when authority is not proven approved. |
| `assets/support/sdd-status-contract.md` | Define the additive status schema, deterministic ownership/routing contract, and marker-independent review obligation shared by agents and the runtime. |
| `lib/sdd-status.ts` | Replace `countTasks` with ownership-aware parsing; add status fields/rendering; compute apply completion from separated progress while keeping verify/sync/archive behind authoritative receipt approval and verification readiness. |
| `assets/chains/sdd-full.chain.md` | Yield after every completed apply at the parent lifecycle boundary unless an approved receipt is authoritatively established; do not add a review actor to the chain. |
| `tests/sdd-status.test.ts` | Add parser, compatibility, malformed, separated progress, marker-independent review routing, authority-state, rendering, and archive-blocker regressions. |
| `tests/artifact-language.test.ts` | Assert generated agent/support/chain assets carry the ownership boundary and never assign bounded review to apply. |

No issue #118 review controller, facade, snapshot, compact-store, receipt, authority, or recovery design changes are introduced by this amendment.

## Strict-TDD sequence for the amendment

Strict TDD remains active; use `pnpm test` as the required full runner. Keep this sequence independent from the already validated issue #118 cycles above.

1. **RED — legacy and canonical parsing**
   - Add `tests/sdd-status.test.ts` cases for unmarked legacy tasks, explicit implementation markers, explicit parent markers, and mixed checked/unchecked ownership.
   - Assert legacy progress accounting is byte-for-byte equivalent and mixed status separates `taskProgress` from `deferredParentActions`. For completed legacy artifacts, assert the intentional routing correction: no marker means `parent-lifecycle`, not direct verify/sync/archive.
2. **GREEN — parser and additive shape**
   - Introduce const-derived owner values and one parser; populate zero values from every status constructor and update renderers.
3. **RED — malformed fail-closed behavior**
   - Cover unsupported value, uppercase value, duplicate marker, non-terminal marker, and checked malformed line.
   - Assert each is unresolved implementation work, appears in `taskArtifactErrors`/`blockedReasons`, and routes to `fix-task-ownership-marker` without claiming apply completion.
4. **GREEN — apply and dispatcher routing**
   - Base apply completion on implementation progress only; add the unconditional post-apply `parent-lifecycle` boundary and keep parent lines visible.
   - Assert unresolved implementation still routes to `sdd-apply`; completed implementation never returns to apply, and parent-marker absence never permits verify/sync/archive before review authority is approved.
   - Assert a missing receipt routes to explicit parent `review/start`, a valid approved receipt is reusable, and scope-changed, invalidated, escalated, ambiguous, or invalid authority fails closed. Then prove independent verification readiness is required before later routing.
5. **RED/GREEN — asset contracts**
   - Add focused asset-language assertions for task generation, apply prohibition/completion, status contract, and full-chain yield.
   - Amend only the required Markdown assets; do not introduce a chain review actor.
6. **TRIANGULATE**
   - Test parent unchecked/checked combinations, no parent markers, no implementation checkboxes, malformed checked input, non-authoritative stores, review-recovery overlay, rendering, and archive readiness.
   - For legacy artifacts with no parent markers, prove completed implementation still stops at the mandatory review boundary. Cover missing receipt, approved reusable receipt, and fail-closed scope-changed/invalidated/escalated cases, plus the independent verification prerequisite.
   - Run focused `node --experimental-strip-types --test tests/sdd-status.test.ts tests/artifact-language.test.ts`, then `pnpm test`.
7. **REFACTOR**
   - Keep one parser and one progress accumulator, preserve const-object-derived types and flat interfaces, remove prose inference, and rerun focused plus full tests.

Apply-progress must record RED before production edits, focused GREEN evidence, full `pnpm test`, exact persisted implementation checkbox updates, and the untouched deferred parent lines. Only after implementation-owned work and test evidence are complete may the parent begin native bounded review.

## Amendment rollout and rollback

Roll out the task generator, apply/status prompts, support contract, native parser, routing, chain boundary, and focused tests in one cohesive change so producers and consumers agree on the marker from the first release. Existing task files require no migration: absence intentionally remains implementation-owned, and once those legacy implementation tasks complete the deterministic fallback still requires the mandatory post-apply review boundary. Existing status consumers continue to receive `taskProgress`, `applyState`, dependencies, and version 1; the two progress/error fields are additive. Rollout must update native/orchestrator routing atomically enough that an older unmarked artifact cannot fall through to verify/sync/archive without authoritative receipt approval.

Rollback is a pure code/asset revert of this amendment. No task artifact is rewritten during rollout and no review authority data is migrated. After rollback, new marker comments remain harmless Markdown suffixes and the legacy counter will count their checkboxes exactly as before. The old all-checkbox apply behavior returns, while bounded-review authority, receipts, lifecycle-gate enforcement, and the validated issue #118 implementation remain unchanged.

## Amendment verification checklist

- [ ] Every newly generated checkbox has exactly one canonical owner marker.
- [ ] Unmarked legacy checkboxes retain existing implementation accounting and unresolved-work routing; completed legacy artifacts use the mandatory parent-lifecycle fallback.
- [ ] Unsupported, duplicate, misplaced, and checked malformed markers visibly fail closed.
- [ ] `taskProgress` contains only implementation-owned plus malformed unresolved work.
- [ ] `deferredParentActions` keeps valid parent actions visible without making apply incomplete.
- [ ] Completed implementation routes to the mandatory parent lifecycle boundary even when parent markers are absent or already checked; markers provide visibility, not authority.
- [ ] Missing receipt routes to explicit parent `review/start`; a valid approved receipt may be reused; scope-changed, invalidated, escalated, ambiguous, and invalid authority fail closed.
- [ ] Verification starts only after receipt approval, and sync/archive readiness additionally requires independent verification readiness.
- [ ] Unchecked implementation still routes to `sdd-apply`.
- [ ] `sdd-apply` cannot launch review actors, create/approve receipts, or validate any lifecycle gate.
- [ ] The full chain yields to the parent and adds no review actor section.
- [ ] Archive cannot become ready while mandatory deferred parent actions remain unresolved.
- [ ] Issue #118 authority routing, recovery behavior, receipt schemas, and persisted data are untouched.
- [ ] Focused status/asset tests and full `pnpm test` pass before the parent starts bounded review.
