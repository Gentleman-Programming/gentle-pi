# Exploration: Native review authority parity

## Decision

The smallest correct architecture is **native CLI delegation for new ordinary reviews plus a read-only SDD binding/status bridge**. Pi must not copy, translate, or mirror native authority, and must not create a second review. Existing Pi compact-v2 and graph-v1 data remain compatible readers/gates; Judgment Day remains graph-v1. Pi continues to preserve one-shot command authorization after a successful native gate.

## Verified native evidence

Evidence was checked against gentle-ai commit `d7a29b88b3cf1b4a76fe42a02f918bfa21578cc7` (the installed gentle-ai 2.1.0 build revision), using commit-pinned source rather than the current checkout.

### CLI operations

- `gentle-ai review start` is the native ordinary-review entry point. It accepts repository scope (`--cwd`), optional lineage/policy/focus/trace inputs, captures intended untracked paths and the current snapshot, derives risk/lenses/budget, and returns JSON containing the operation, lineage, state, risk, selected lenses, changed-file/line counts, and correction budget. Invalid flags/arguments and repository/snapshot failures return non-zero errors; successful start persists authority.
- `gentle-ai review finalize` accepts repeated reviewer `--result` inputs and optional `--validation`, `--refuter`, `--evidence`, `--correction-lines`, `--failed`, `--lineage`, `--cwd`, and `--trace`. It returns the native operation, lineage, state, action, store revision, and terminal receipt path where applicable. It rejects multiple stdin inputs, malformed JSON, unknown/stale lineage, invalid transitions, unbounded correction, and invalid evidence with non-zero errors. Canonical IDs, hashes, transitions, and receipt bytes are native-owned.
- `gentle-ai review validate` accepts `--gate` plus repository/lineage/base and compatible-base/release evidence flags. It reloads authority and receipt, derives live Git evidence, performs the gate, rechecks authority/target, and returns native gate/receipt evidence. Missing, stale, scope-changed, invalidated, or escalated authority fails closed with a non-zero result.
- `gentle-ai review bind-sdd` exists in the pinned source. It is a CAS-bound association operation, not an authority import. Its contract includes the repository/change identity, native lineage/receipt binding, and `--expected-binding-revision=`. The first bind accepts an empty expected revision (the source tests around `internal/cli/review_facade_test.go:516+` explicitly cover this); retries must supply the observed binding revision and reject stale or semantically different values. Successful JSON exposes the binding operation and resulting binding revision; malformed/mismatched input and CAS conflicts fail non-zero without copying review records.

`--help` is handled by each command's flag parser and is non-mutating. JSON is emitted only on success; errors are written as CLI errors and do not authorize a lifecycle command.

## Native storage, lineage, and CAS

Native ordinary authority is stored under the repository Git common directory in the native compact transaction store (`gentle-ai/review-transactions/v2` in the pinned 2.1.0 source), not Pi's `<common-dir>/gentle-ai/reviews/compact-v2`. Records contain the native review state/chain, immutable snapshot and policy bindings, revisions/predecessor expectations, and terminal receipt materialization. Store replacement and SDD binding use content-derived compare-and-swap. An approved lineage is found by native lineage/terminal-state lookup and receipt validation; absence, more than one eligible claimant, malformed records, cross-repository/change identity, or stale revision is failure—not a reason to synthesize a record.

## SDD binding and status consumption

`bind-sdd` records the association between an approved native lineage and an SDD change/path binding with a binding revision. `sdd-status` consumes that association read-only: it checks the exact change identity and OpenSpec path, approved native terminal state, receipt/live-gate evidence, and the expected binding revision. It may report verification readiness or the next parent lifecycle action, but it does not mutate review authority, create a mirror, or infer approval from task checkboxes. A missing binding, stale revision, malformed binding, ambiguous claimant, or path mismatch is a deterministic blocked/non-ready result.

The bridge therefore has two distinct revisions: native store/authority revision and SDD binding revision. Every allow path reloads both and rederives the live target before returning success.

## Current Pi seams

Pi's `extensions/gentle-ai.ts` currently routes ordinary `START`, `FINALIZE`, `STATUS`, and `VALIDATE` directly to TypeScript compact-v2 helpers (`startCompactReview`, `finalizeCompactReview`, `discoverCompactReview`, and `validateCompactReviewGate`). `lib/review-compact-store.ts` owns the Pi compact-v2 root and CAS behavior; `lib/sdd-status.ts` and the `sdd-status` command own read-only SDD reporting. The controller already has the native-validation hotfix: the one-shot lifecycle authorization is registered only after an approved validation and is rederived at bash execution against the exact typed command/target/receipt. That seam must remain; only the ordinary authority source changes.

## Architecture and compatibility

1. Add a typed, injectable process adapter in Pi for native `review start`, `finalize`, `validate`, and `bind-sdd`; use argument arrays and strict response schemas, never shell interpolation or authority-file writes.
2. Route **new ordinary** Pi operations through native authority. Map native JSON/error outcomes into the existing public Pi envelopes and blocked/action semantics.
3. Route existing active Pi compact-v2 lineages through a supported read-only/gate-compatible path. Do not migrate, rewrite, or duplicate them; report them as legacy/read-only where mutation would otherwise be attempted.
4. Keep graph-v1 ordinary readers/receipts/gates compatible and read-only. Keep Judgment Day mutation entirely graph-v1. Same-lineage graph-v1 plus native/compact authority remains fail-closed.
5. Let `sdd-status` consume only the native bind-SDD result and revalidated approved evidence. It must never import Pi compact records or fabricate a binding.
6. Preserve Pi's exact one-shot command authorization and bash-time target rederivation after native `review validate` allows.

## Migration and non-goals

There is no migration for existing Pi compact-v2, graph-v1, or Judgment Day authority. New ordinary reviews opt into native authority. Legacy active Pi compact lineages remain readable/gate-compatible or take an explicit supported read-only route; no destructive reset, authority copying, schema translation, duplicate review, graph-v1 port, policy/budget change, tool-name change, or SDD archive approval from discovery alone is in scope.

## Overlap and boundaries

`complete-native-review-lifecycle` already covers immutable snapshots, frozen findings, bounded correction, terminal receipts, native CAS, and graph-v1 compatibility; this change must reuse those guarantees rather than duplicate lifecycle logic. `worktree-aware-review-authority` concerns candidate/terminal applicability and persisted-layout compatibility, not authority ownership. SDD status/OpenSpec changes should consume the bind-SDD contract, not introduce a second binding model. Keep this change limited to the process adapter, native routing, bind/status bridge, legacy compatibility, and focused CLI/CAS/concurrency tests.

## Risks and readiness

The main risks are stale binding races, accidentally authorizing from actor output, and silently duplicating legacy authority. Mitigate with strict schemas, empty-revision first-bind coverage, revision-CAS retry tests, native reload-before-allow, and no-write failure tests. This corrected evidence is sufficient for proposal: implement native delegation and the supported bind-SDD bridge; do not invent a Pi-side store bridge or duplicate review lifecycle.
