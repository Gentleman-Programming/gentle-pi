# Tasks: Bounded Review Graph Parity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,800–3,000 |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR under the existing recorded `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

**Existing delivery decision:** proceed as one single PR under the already approved `size:exception`; do not silently re-slice or create chained PRs. The estimate covers destructive reset, epoch/incarnation invalidation, Git fencing, inspect/recover/repair, cleanup of superseded native activation work, and fault-injection tests.

## Execution Rules

- Strict TDD applies to every remaining implementation unit: **RED → GREEN → TRIANGULATE → REFACTOR**. Record commands and evidence in apply progress.
- Keep tests with the behavior they verify. Each unit has a clear rollback boundary.
- Every authority mutation uses the graph-v1 control lock and private repository capability. Mirrors and checkpoints never authorize.
- Do not implement legacy migration, translation, coexistence, native activation fencing, signing, network transport, consensus, GC, or review-policy changes.
- Keep final integration verification unchecked until all implementation units are complete.

## Work Units

### 1. Canonical primitives, schemas, and repository authority

- [x] Preserve the delivered Unit 1 implementation only where it matches the revised spec/design; re-run its RED → GREEN → TRIANGULATE → REFACTOR evidence and correct drift.

**Targets:** `lib/review-canonical.ts`, `lib/review-graph-schema.ts`, `lib/review-repository.ts`, their focused tests, and required shared exports.

**Verify:** canonical identity, graph-v1 schema rejection, exact Git common-directory resolution, linked/bare/relocated repository behavior, symlink/path rejection, and unforgeable repository capability. Include the centralized hostile inherited-Git-environment policy required by design §6.1; no worktree-local authority.

**Rollback:** remove or disable only inactive graph-v1 primitives/tests; do not restore a legacy mutation path.

### 2. Locking, immutable objects, root publication, and graph reduction

- [x] Preserve the delivered Unit 2 implementation only where it matches the revised spec/design; re-run focused crash and concurrency evidence and correct drift.

**Targets:** `lib/review-lock.ts`, `lib/review-object-store.ts`, `lib/review-graph-reducer.ts`, and focused lock/object/graph/fault utilities and tests.

**Verify:** graph-v1 immutable event/root closure, explicit genesis, same-lineage predecessor validation, three-slot `CURRENT` publication, owner-token and stale/ambiguous recovery, fsync boundaries, and valid-old-or-valid-new crash outcomes. Preserve graph-v1 locking while moving reset/mutation control through the shared control lock.

**Rollback:** unreachable graph objects may remain; never delete or reactivate legacy authority through rollback.

### 3. Compatibility facade, authoritative resume, receipts, and lifecycle gates

- [x] Preserve the delivered Unit 3 implementation only where it matches the revised spec/design; re-run lifecycle and resume evidence and correct drift.

**Targets:** `lib/review-transaction.ts`, `lib/review-checkpoint.ts`, lifecycle/gate modules, and `extensions/gentle-ai.ts` routing/tests.

**Verify:** graph-event-backed prepared/completed idempotency, identity-bound checkpoints, monotonic budgets, immutable frozen claims, terminal closure, Judgment Day separation, exactly-once final verification, runtime-branded authoritative reads/receipts, exact typed targets, zero actors in gates, and fail-closed reset/epoch/incarnation checks.

**Rollback:** revert facade changes before graph authority activation only; after activation allow only graph-aware read/repair paths.

### 4. Bundle transfer and explicit mirror boundary

- [x] Preserve the delivered Unit 4 implementation only where it matches the revised spec/design; re-run transfer, mirror, and hostile Git routing evidence and correct drift.

**Targets:** `lib/review-bundle.ts`, `lib/review-mirror.ts`, `lib/review-checkpoint.ts`, `extensions/gentle-ai.ts`, and bundle/mirror/checkpoint tests.

**Verify:** deterministic framed export, complete staged closure validation, atomic idempotent import, mirror-only denial, inspection-only handling of foreign/pre-reset bundles, exact current-incarnation admission, and `REVIEW_BUNDLE_EPOCH_MISMATCH` on replay or rebinding. Exercise `inspect`, `recover`, `repair`, import, export, and gate paths through the same Git environment rejection policy.

**Rollback:** remove transfer APIs/staging without changing authoritative roots; preserve no path that can promote a mirror directly.

### 5. Destructive legacy reset, incarnation invalidation, and operator recovery

- [x] Replace the old migration/activation-fence plan with the explicit destructive reset implementation; complete RED → GREEN → TRIANGULATE → REFACTOR.

**Depends on:** Units 1–4.

**Targets:** add `lib/review-legacy-detector.ts` and `lib/review-reset.ts`; update `lib/review-object-store.ts`, `lib/review-transaction.ts`, `lib/review-repository.ts`, `lib/review-bundle.ts`, `lib/review-checkpoint.ts`, lifecycle/gate modules, and `extensions/gentle-ai.ts` routing; add reset, detector, replay, Git-policy, crash, and cross-platform tests; update operator documentation.

**RED:** Add tests proving: legacy and mixed-state detection blocks every authority-bearing operation before graph use; `inspect` reports exact target, inventory hash, invalidated classes, and confirmation challenge; partial/ambiguous/normalized confirmation is rejected; reset cannot run from startup/start/import/resume/gate; inventory changes require reconfirmation; reset marker is durable before deletion; each quarantine/delete/init phase is crash-recoverable and remains blocked; quarantine cannot escape its reset-id path; obsolete legacy reappearance blocks completion; and graph-v1 locking remains authoritative without native exchange/ACL fencing.

**GREEN:** Implement the exact confirmation protocol from design §8; use the shared graph-v1 control lock; persist hash-bound reset state and crash phases; quarantine and delete all legacy authority, receipts, approvals, escalations, ledgers, findings, frozen hashes, lineages, journals, counters, and gate evidence; initialize an empty generation-zero graph-v1 store only after deletion; generate fresh random `store_epoch` and content-addressed `authority_incarnation_id`; bind `STORE`, events, roots, checkpoints, bundles, authoritative reads, and receipts to that incarnation; retain complete reset provenance as fail-closed control metadata; add old receipt/bundle/object replay denial and `REVIEW_RECEIPT_EPOCH_MISMATCH`; reject unsafe known Git routing variables, including empty values, before Git/store access; expose explicit `inspect`, `recover`, and `repair` operations; and require a fresh current-incarnation review before any gate passes.

**TRIANGULATE:** Run subprocess crash injection at every reset phase, repeated reset/recovery, legacy reappearance, mixed-state reset, copied pre-reset objects, old receipt/bundle replay, manifest/root rebinding, checkpoint replay, foreign-incarnation inspection-only import, virgin bundle adoption, all denied Git variables and config injection, ordinary/bare/linked/relocated repositories, and supported/unsupported filesystem cases. Prove no legacy or partial graph state authorizes, no budgets change, and fresh review is required.

**REFACTOR:** Remove semantic legacy parsing and any fallback authority; centralize detector/reset/Git-policy validation; keep reset history diagnostic only; preserve graph-v1 lock recovery and public compatibility errors; document destructive consequences, forward-only recovery, platform limits, and no native activation guarantee.

**Rollback:** before reset confirmation, disable inactive reset code without mutating legacy state. After reset begins, never restore or reinterpret quarantine; only explicit forward recovery to a verified empty graph-v1 store is permitted.

### 6. Remove superseded native activation-fence work

- [x] Remove the now-unneeded partial N-API/native activation implementation and its packaging surface, without removing or weakening graph-v1 locking.

**Targets/discovery:** remove `lib/review-native-fence.ts`, `native/gentle_review_native.cc`, `scripts/build-native-addon.mjs`, the `native:build` package/script entries and native dependency/config entries, native activation/migration tests and fixtures, and documentation describing migration, activation exchange, DACL/ACL fencing, or native activation. Search package manifests, test configuration, lockfiles, and docs for references before deletion.

**Verify:** no import, script, package entry, test, fixture, or documentation path references removed native activation; graph-v1 `lib/review-lock.ts` and its platform-qualified locking tests remain intact and pass. Confirm no `migrate` routing remains; retain `inspect`, `recover`, `repair`, and `reset` documentation.

**Rollback:** restore only the removed inactive files/configuration if cleanup must be reverted; do not restore migration or native activation authority behavior.

## Final Integration Verification

- [x] Complete final verification only after Units 1–6 are green: run the full suite plus graph, lock, bundle, mirror, reset, replay-invalidation, Git-policy, lifecycle, portability, crash, inspect/recover/repair, and cleanup suites; verify every revised acceptance criterion, exact canonical changed-line count, no native activation remnants, no split authority, no legacy receipt/bundle replay, no delivery commands, and the recorded single-PR `size:exception` decision.

### 7. Post-escalation remediation: BRGP-003, BRGP-010, and BRGP-011

**Lineage boundary:** The old lineage `bounded-review-graph-parity`, revision 5, is terminal **escalated** and cannot be reopened, amended, or reused. After implementation, a **NEW review lineage** must be started before any lifecycle gate or delivery action.

**Delivery boundary:** Retain the existing approved single-PR `size:exception`; do not create chained PRs or silently change the delivery decision.

- [x] **BRGP-003:** RED tests for complete staged predecessor replay, reducer transition/input integrity, root-state and incarnation binding; GREEN implementation; TRIANGULATE forged, cyclic, forked, stale-incarnation, and multi-event bundles; REFACTOR shared validation.
- [x] **BRGP-010:** RED tests for terminal-lineage rejection, stale/non-authoritative receipt and gate denial, exact typed-target binding, and zero actor execution in gates; GREEN implementation; TRIANGULATE crash/replay/idempotency and negative paths; REFACTOR without changing bounded-review policy.
- [x] **BRGP-011:** RED tests for unsafe inherited Git routing (present and empty values), reset/incarnation invalidation, and inspect/recover/repair fail-closed behavior; GREEN implementation; TRIANGULATE ordinary, bare, linked, relocated, crash, and reappearance cases; REFACTOR through centralized policy paths.

**Strict TDD evidence:** Record RED → GREEN → TRIANGULATE → REFACTOR commands, focused results, and full-suite impact in `apply-progress.md` for each subtask. Keep tests with the behavior they verify.

**Rollback boundaries:** Each BRGP subtask is independent. Before authority mutation, revert only its inactive tests/implementation. After activation, do not restore legacy authority, reopen the terminal lineage, or reuse pre-reset receipts/bundles; rollback may only disable the new path while preserving fail-closed behavior and graph-v1 lock integrity.

### 8. Focused re-verification and new-lineage readiness

- [x] Run focused verification for BRGP-003, BRGP-010, and BRGP-011; confirm revision 5 remains terminal escalated and untouched, no gate or delivery command can use it, and record evidence needed to start a new review lineage. Do not start that lineage in this task.

### 9. Terminal R2 escalation remediation

**Lineage boundary:** R2 revision 5 is terminal **escalated** and immutable. It must not be reopened, amended, or reused. Start a **new review lineage only after implementation** of the remediation below.

- [x] **BRGP2-001 TOCTOU remediation:** Add strict-TDD RED → GREEN → TRIANGULATE → REFACTOR coverage and implementation so destructive reset/quarantine/delete operations use directory-handle/descriptor-anchored, or equivalent race-safe, operations; reject symlink/reparse replacement discovered after validation; and never rely on path prechecks alone. Record focused and regression test evidence in `apply-progress.md`.

**Rollback:** Before destructive mutation, revert only the inactive remediation tests/implementation. Once mutation support is active, disable the unsafe path and preserve fail-closed behavior; never reopen or reuse R2 revision 5 or restore path-precheck-only deletion.

### 10. R3 readiness verification

- [x] Verify implementation evidence for BRGP2-001, including race-injection, symlink/reparse replacement, supported-platform, crash/recovery, and full-suite results; confirm R2 revision 5 remains terminal escalated and immutable, and confirm the new lineage is not started until implementation is complete. Record strict-TDD and rollback evidence in `apply-progress.md`.

### 11. Release-from-main fast path parity (gentle-ai 2b3a091)

**Scope boundary:** Port gentle-ai commit `2b3a091` ("fix(release): allow verified releases from main") into gentle-pi's native release gating: `lib/review-transaction.ts` fast-path evaluation and pre-push remote recheck, `extensions/gentle-ai.ts` controller/consumption routing, and the managed contract wording surfaces. Release from protected `main` may bypass receipt validation only when the tag targets the current immutable `origin/main` SHA (explicitly resolved from the remote, never local `HEAD`), required CI for that exact SHA is successful, the remote head is rechecked immediately before tag push, and no new vulnerability, policy, provenance, signing, generated-artifact, or release evidence requires escalation. Local branch position and worktree dirtiness are not publication inputs. Major and post-incident releases always require explicit extraordinary review. Any failed or unprovable condition falls back to native receipt validation and fails closed on missing, scope-changed, invalidated, or escalated receipts.

- [x] **RED:** Failing tests in `tests/review-gate.test.ts` (fast-path eligibility, remote-SHA binding, CI binding, escalating evidence, major/post-incident/unprovable-version denial, protected-ref and remote-head provability, pre-push recheck), `tests/review-controller.test.ts` (receipt-free fast-path authorization, remote-advance block at consumption, fail-closed fallback without a lineage, non-release evidence rejection, receipt fallback), and contract-wording assertions in `tests/review-ledger-contract.test.ts`, `tests/package-manifest.test.ts`, and `tests/orchestrator-budget.test.ts`.
- [x] **GREEN:** `evaluateReleaseFastPathV1`/`recheckReleaseFastPathRemoteHeadV1` in `lib/review-transaction.ts`; validate-input release evidence parsing, receipt-free fast-path authorization, and consumption-time remote recheck in `extensions/gentle-ai.ts`; fast-path wording in `skills/_shared/review-ledger-contract.md`, `assets/orchestrator.md`, `assets/orchestrator-delegation.md`, `skills/gentle-ai/SKILL.md`, `skills/judgment-day/SKILL.md`, `skills/release/SKILL.md`, and `README.md`.
- [x] **TRIANGULATE:** Dirty-worktree/detached-HEAD eligibility, forged tag identity, missing remote branch, invalidating and escalating dispositions, non-semver tags, remote advance and remote deletion before push, and receipt-validation fallback still allowing an approved receipt; full suite plus runtime harness.
- [x] **REFACTOR:** Shared remote-head resolution through the existing `resolveRemoteGateRef`/`repositoryRootForGate` gate helpers; one fast-path evaluation reused by controller validation, with the consumption recheck bound to the registered authorization.

**Rollback:** Disable the fast path by rejecting `release` evidence in validate input; the release gate then falls back everywhere to unchanged native receipt validation. Never weaken receipt validation itself, and never let a fast-path authorization outlive its exact command/target binding or skip the pre-push remote recheck.

## Deferral: graph-v1 cross-repo bundle trust (RISK2-001) — experimental, deferred

**Decision:** The parity-that-matters (release-from-main fast path, canonical hashing, lock, receipts, gates, pinned-subset identity) is done, green, and ships. `RISK2-001` — bundle cross-repo import is spoofable because `repository_identity`/`root_commit_ids` match alone cannot prove a bundle's lineage content was ever produced by a legitimate export from this repository's own history, and `common_directory` (the binding the transaction gate at `lib/review-transaction.ts:1666` uses) legitimately differs across clones of the same repository, so it cannot be the discriminator (see `reviews/post-apply-4r-round2-ledger.md` row `RISK2-001` and Unit 2 of `apply-progress.md`) — is deferred to its own follow-up change (`openspec/changes/cross-repo-bundle-trust`) because closing it soundly needs a real cross-repo trust primitive, not a bounded correction.

**Guard added instead of a silent gap:** `ReviewBundleImporter.import` (`lib/review-bundle.ts`) now requires an explicit, experimental `acknowledgeUntrustedBundleSource: true` opt-in (default false/absent) before adopting any lineage this store has not already established as its own authority. Without it, import fails closed with a distinct `REVIEW_BUNDLE_UNTRUSTED_SOURCE` error — this makes the previously silent RISK2-001 acceptance path non-silent. Re-importing or extending a lineage this store's authority already recognizes needs no acknowledgement.

**What ships vs. what's deferred:**
- Same-repo/same-clone portability (the scenario the original 6 `tests/review-bundle.test.ts` tests exercise) ships and works, now with the caller passing the explicit opt-in for first-time lineage adoption.
- Untrusted cross-repo import of a brand-new lineage requires explicit operator attestation (`acknowledgeUntrustedBundleSource: true`) pending the follow-up trust primitive; it is not silently accepted.
- Closing RISK2-001 for real (removing the need for operator attestation) requires the cross-repo trust primitive designed in `openspec/changes/cross-repo-bundle-trust`.
