# Route review authority by the live candidate across linked worktrees

## Intent

Fix issue [#118](https://github.com/Gentleman-Programming/gentle-pi/issues/118) by making controller review routing candidate-aware. A request from any linked-worktree `cwd` must reuse terminal authority only when its live candidate has the same content, scope, and policy binding; a materially different candidate must reach a fresh compact START.

This remains the primary runtime change. The same PR will also correct a tightly related SDD harness ownership defect that repeatedly makes successful apply work appear incomplete: SDD planning, apply, and native status must distinguish implementation-owned tasks from parent/orchestrator-owned post-apply bounded-review and lifecycle-gate actions.

Together, these changes preserve Git common-directory authority, prevent unrelated terminal lineages from blocking linked worktrees, and keep mandatory review routing at the correct orchestration boundary.

## Current gap

Controller INSPECT/START routing classifies shared repository authority before deriving the requested `cwd`'s live candidate. Because linked worktrees share the Git common directory, one terminal compact lineage can therefore block a materially different candidate before compact START compares candidate state.

Reset recovery has a separate fail-closed gap: when authority reports `reset-in-progress` but `control/reset-state.json` is absent, recovery leaks an untyped filesystem failure instead of returning a stable typed controller outcome.

The SDD harness also treats every unchecked task checkbox as apply work, even when a checkbox describes mandatory post-apply review or delivery-gate validation owned by the parent/orchestrator. This creates a circular false failure: `sdd-apply` must not start review actors, mint receipts, or validate lifecycle gates, but native status refuses to consider apply complete while those parent-owned actions remain unchecked. Repeated apply continuations therefore cannot make legitimate progress and obscure the correct next route.

## Proposed change

### Issue #118 runtime correction

1. Derive the requested `cwd`'s live candidate binding before deciding whether shared terminal compact authority applies.
2. Compare terminal authority against the complete existing candidate/receipt binding: repository identity, base tree, candidate tree, changed paths, intended-untracked paths, and policy.
3. Reuse and validate the existing terminal receipt when those values are identical, regardless of linked-worktree directory.
4. When any material binding value differs, do not select the unrelated terminal as a blocker; route the request to compact START's fresh-lineage behavior.
5. Preserve explicit same-lineage behavior and idempotency: replaying the same candidate must not create a duplicate lineage or mutate its receipt.
6. Convert absent reset-state recovery into a typed, fail-closed controller result. It must not infer authorization, fabricate recovery state, or mutate authority.

### Same-PR SDD ownership correction

1. Add an explicit ownership marker that distinguishes implementation-owned task checkboxes from parent/orchestrator-owned lifecycle actions in SDD task artifacts.
2. Make `sdd-apply` responsible only for implementation-owned work. It must never start bounded-review actors, mint or approve review receipts, or validate pre-commit, pre-push, pre-PR, release, or other delivery gates.
3. Make native SDD status determine apply completion from implementation-owned checkboxes only.
4. Keep incomplete parent/orchestrator-owned review and gate actions visible as deferred lifecycle routing after apply; do not silently discard or auto-complete them.
5. Preserve the mandatory parent flow: after implementation and verification evidence are ready, the parent/orchestrator starts or reuses the bounded-review authority, then validates the resulting receipt at each required lifecycle gate.
6. Apply this correction to planning, apply instructions, and native status interpretation so generated plans and runtime routing use the same ownership boundary.

## Scope

### In scope

- Candidate-aware INSPECT/status and START routing in the review controller.
- Reuse of terminal authority based on existing content/scope/policy identity rather than worktree path.
- Fresh compact lineage routing for materially different candidates in the same Git common directory.
- Typed fail-closed handling when durable reset state is absent during RECOVER.
- An explicit task ownership marker for implementation versus parent/orchestrator lifecycle actions.
- SDD planning guidance that labels post-apply bounded review and lifecycle gates as parent/orchestrator-owned.
- `sdd-apply` completion rules that exclude parent-owned review and gate execution.
- Native SDD status that computes apply completion from implementation-owned tasks while reporting parent-owned actions as deferred routing.
- Strict-TDD regression coverage using `pnpm test`.
- Delivery as one cohesive, user-approved single PR with no artificial changed-line cap; the implementation must still remain as small as the accepted systemic correction permits.

### Non-goals

- Weakening, removing, bypassing, or making bounded review optional.
- Allowing `sdd-apply` to start review actors, create or approve receipts, or validate lifecycle gates.
- Treating deferred parent lifecycle actions as completed before the parent/orchestrator executes them.
- A generic task taxonomy, planner schema redesign, or arbitrary ownership hierarchy beyond the explicit implementation-versus-parent lifecycle marker.
- Changing bounded-review correction budgets, receipt validation rules, gate semantics, or parent/orchestrator authority.
- Adding worktree-directory identity to candidate, lineage, or receipt schemas.
- Changing receipt schemas, common-directory store layout, or terminal validation semantics.
- Rewriting, migrating, deleting, superseding, or forking existing receipts.
- Changing graph-v1, legacy, mixed-authority, ambiguity, reset authorization, or destructive-reset behavior.
- Broad review-authority redesign beyond the controller routing and absent reset-state seam.
- Splitting this approved cohesive scope into chained PRs solely to satisfy an artificial line limit.

## Affected areas

| Area | Expected change |
|---|---|
| Review controller | Derive and use the requested live candidate when classifying shared compact terminal authority. |
| Compact START integration | Allow materially different candidates to reach existing fresh-lineage logic; retain same-candidate idempotency. |
| Compact authority store | Continue using shared Git common-directory discovery without layout or schema changes. |
| Reset recovery | Map missing durable reset state to a typed fail-closed outcome with no mutation. |
| SDD task planning | Mark implementation checkboxes separately from parent/orchestrator-owned post-apply review and lifecycle actions. |
| SDD apply contract | Execute and report only implementation-owned tasks; prohibit review actors, receipt creation/approval, and delivery-gate validation. |
| Native SDD status/dispatcher | Base apply completion on implementation-owned tasks and expose unresolved parent-owned actions as visible deferred routing. |
| Parent/orchestrator lifecycle | Retain exclusive responsibility for starting/reusing bounded review and validating its receipt at required lifecycle gates. |
| Tests | Add linked-worktree routing, receipt preservation, idempotency, missing-reset-state, ownership parsing, apply-completion, and deferred-routing regressions. |

## Compatibility and ownership invariants

- Identical repository/base/candidate trees, changed paths, intended-untracked paths, and policy reuse the same terminal authority across linked worktrees.
- Any material difference in that binding can reach fresh START.
- A worktree path difference alone neither creates a lineage nor prevents receipt reuse.
- Existing terminal receipts remain intact, readable, and gate-validatable.
- Explicit same-lineage requests retain current blocking/replay behavior.
- Graph-v1, legacy, mixed, ambiguous, and reset-in-progress authority remains fail-closed under existing rules.
- Repeated review operations remain idempotent.
- Apply completion means all implementation-owned work is complete; it does not claim bounded-review approval or lifecycle-gate validation.
- Parent-owned lifecycle actions remain mandatory and visible until routed and executed by the parent/orchestrator.
- No SDD apply agent may launch review/refutation/validation actors, mint a receipt, or authorize delivery.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| An incomplete comparison reuses authority for a different candidate. | Compare the full existing content/scope/policy binding and cover each material dimension with regressions. |
| Candidate-aware routing accidentally bypasses legacy or ambiguous authority safety. | Keep repository-wide compatibility inspection authoritative; specialize only terminal compact applicability. |
| Fresh routing mutates or invalidates an existing receipt. | Treat terminal receipts as immutable and verify the original receipt remains gate-validatable after another candidate starts. |
| Missing reset state triggers unsafe recovery. | Return a typed fail-closed result before mutation; never reconstruct or infer reset authorization. |
| A new identity concept causes compatibility drift. | Do not add worktree-path identity or receipt schema fields unless implementation evidence demonstrates necessity. |
| Status excludes a real implementation task because ownership is absent or malformed. | Define a deterministic default/fail-closed interpretation for the explicit marker and cover legacy and malformed task artifacts with regression tests. |
| Separating completion is mistaken for skipping review. | Keep parent-owned actions visible in native status and require explicit post-apply routing; apply completion must not imply review approval. |
| Apply crosses the orchestration boundary to clear deferred actions. | Enforce the prohibition in apply instructions and tests; only the parent/orchestrator may invoke bounded review and lifecycle gates. |
| The same-PR correction expands into a general planning redesign. | Limit changes to the explicit ownership marker and the planning/apply/status behavior required to consume it. |

## Rollback

Revert the candidate-aware controller routing, typed recovery mapping, and SDD ownership-marker interpretation together or by their independent code seams. Because the change does not migrate authority stores, alter receipt schemas, or complete deferred lifecycle actions, rollback requires no authority-data conversion. Existing receipts and shared common-directory authority remain usable throughout.

If only the SDD ownership correction is reverted, legacy all-checkbox apply status behavior returns; mandatory bounded review and lifecycle validation remain unchanged and parent-owned.

## Success criteria

### Issue #118 and recovery

- An identical live binding requested from another linked-worktree `cwd` reuses and validates the existing terminal receipt.
- A materially different live binding in the same common directory reaches fresh compact START and receives a distinct lineage.
- Repeating the same candidate preserves current idempotent/blocking behavior and creates no duplicate lineage.
- The original terminal receipt is unchanged and remains gate-validatable after routing another candidate.
- Existing graph-v1, legacy, mixed/ambiguous, and reset safety behavior remains unchanged.
- RECOVER with absent `control/reset-state.json` returns a stable typed fail-closed outcome and performs no authority mutation.
- The implementation introduces no worktree-path identity and no receipt schema change unless a separately demonstrated necessity is approved.

### SDD ownership and routing

- Generated or amended SDD task plans explicitly distinguish implementation-owned checkboxes from parent/orchestrator-owned post-apply review and lifecycle actions.
- Native status reports apply complete when every implementation-owned checkbox is complete, even while parent-owned lifecycle actions remain pending.
- Pending parent-owned actions remain visible and route the parent/orchestrator to bounded review and subsequent gate validation rather than back to `sdd-apply`.
- Re-running `sdd-apply` after implementation completion does not false-fail because review or gate actions are still pending.
- `sdd-apply` starts no review actor, creates or approves no receipt, and validates no delivery gate.
- Bounded review remains mandatory and the parent/orchestrator can start or reuse it after apply, then validate the same content-bound receipt at required lifecycle gates.
- Legacy task artifacts and missing or malformed ownership markers receive deterministic, tested behavior without silently skipping implementation work.
- The correction introduces no generic task taxonomy redesign beyond the explicit ownership marker.

### Delivery and verification

- Strict-TDD evidence passes with `pnpm test`.
- The runtime fix and tightly related harness correction ship in the approved single PR without an artificial changed-line cap.
- No success criterion claims review approval, gate validation, commit, push, or PR publication before the parent/orchestrator performs the corresponding lifecycle action.
