# Delegate the supported native review subset to gentle-ai 2.1.0

## Decision

Pi will delegate only the native operations that gentle-ai 2.1.0 safely exposes: ordinary review `START`, `FINALIZE`, and `VALIDATE`, plus `bind-sdd` and status for an exact bound OpenSpec change. Pi will preserve its existing compact-v2 and graph-v1 read-only and gate-compatible routes.

Gentle-ai 2.1.0 does not expose a read-only native command for general ordinary review status or complete claimant inventory. Pi therefore will not inspect native files, probe mutating commands, or infer native state. Ordinary native `STATUS` and any request requiring complete mixed native/Pi authority inventory will fail closed with the explicit typed result `native-status-unsupported` and indicate that an upstream read-only native status contract is required.

This is the smallest safe same-PR subset for delivery with issue #118. It preserves exact one-shot lifecycle-command authorization and creates no copy, migration, mirror, or duplicate review.

## Intent

Use native authority wherever gentle-ai 2.1.0 provides a supported command, without pretending that Pi can safely discover native state it cannot observe. The change should provide native lifecycle mutation, gate validation, and exact OpenSpec association while making unsupported status and mixed-authority decisions explicit and non-mutating.

## Scope

### Typed native process adapter

Add an injectable argument-array adapter for:

- `gentle-ai review start`;
- `gentle-ai review finalize`;
- `gentle-ai review validate`;
- `gentle-ai review bind-sdd`;
- the native SDD status command only for an exact, already-bound OpenSpec change.

The adapter accepts an explicit working directory, validates successful JSON against operation-specific schemas, and maps non-zero exits, timeouts, unavailable binaries, and malformed or incompatible responses to typed failures. It never uses shell interpolation and never reads, writes, translates, repairs, or inventories native authority files.

### Supported ordinary native routing

- `START` invokes native `review start` and maps its result into Pi's existing public envelope.
- `FINALIZE` invokes native `review finalize`; native code retains ownership of canonicalization, transitions, hashes, CAS, and receipts.
- `VALIDATE` invokes native `review validate` for the exact gate and target. Only a schema-valid native allow may reach Pi's one-shot lifecycle authorization path.
- Lost or ambiguous mutating output requires exact-operation replay or explicit recovery; Pi must not start a replacement lineage.

### Explicit unsupported status boundary

Gentle-ai 2.1.0 has no read-only native review status or inventory command. Its `start` and `finalize` commands mutate authority, `bind-sdd` only associates an already-known lineage, and `sdd-status` reports readiness for a bound change rather than general review state.

Therefore:

- ordinary native `STATUS` returns the typed result `native-status-unsupported` with follow-up-required evidence;
- any operation that requires complete inventory across native, Pi compact-v2, and graph-v1 claimants returns `native-status-unsupported` rather than claiming that no native authority exists;
- Pi does not read native storage files, invoke mutating commands as probes, infer state from receipts or Pi artifacts, or fall back to local mutation;
- unsupported status never creates a lineage, binding, approval, receipt, or command authorization.

A read-only native status/inventory contract is an upstream gentle-ai follow-up. It must expose validated ordinary lineage state and claimant discovery without mutation before Pi can implement general native `STATUS` or complete mixed-authority detection.

### OpenSpec binding and bound SDD status

After native approval and validation, Pi may invoke native `review bind-sdd` for the exact repository, change, OpenSpec path, lineage, receipt, and expected binding revision. The first bind uses the native empty expected-revision contract; retries use the observed revision. Stale, conflicting, malformed, cross-repository, or path-mismatched binds fail closed.

For an exact bound change, Pi may invoke the native SDD status contract and map its readiness result into Pi's SDD envelope. This path is not a general review status or claimant inventory. Missing, stale, ambiguous, or invalid binding evidence remains blocked and must not be inferred from task completion or local review artifacts.

### Existing Pi authority compatibility

- Existing Pi compact-v2 ordinary lineages retain their current read-only, export, and gate-compatible routing and reject lifecycle mutation.
- Existing graph-v1 ordinary lineages retain their current read-only and gate-compatible routing and reject lifecycle mutation.
- Judgment Day remains mutable on graph-v1 under its existing explicit workflow.
- When routing can establish a known Pi authority kind without needing native inventory, it continues to use the compatible Pi reader or gate.
- When a decision requires proving the absence or presence of native claimants, Pi fails with `native-status-unsupported`; it does not choose a winner or silently declare the authority clean.

### Public and safety compatibility

Pi's public operation names, request/response envelopes, and blocked/action semantics remain stable except for the explicit typed unsupported result where native status evidence cannot safely be obtained.

Exact one-shot command authorization remains mandatory:

1. native `review validate` allows the exact gate and target;
2. Pi registers one authorization for the exact typed lifecycle command;
3. bash-time execution reloads and rederives the target and receipt evidence;
4. replay, stale evidence, changed target, or mismatch fails closed.

Dangerous-command safety remains independent and authoritative.

## Affected areas

- `extensions/gentle-ai.ts`: route supported native operations and return `native-status-unsupported` at unsupported boundaries.
- A process boundary under `lib/`: typed argument-array execution and strict response validation.
- Pi compact-v2 and graph-v1 routing: preserve read-only/gate-compatible behavior and mutation rejection.
- `lib/sdd-status.ts` and the SDD status command: consume only exact native binding/readiness evidence.
- Lifecycle authorization: preserve native validation as a prerequisite and bash-time rederivation.
- Focused strict-TDD coverage for adapter behavior, unsupported status, no-probe/no-fallback guarantees, binding CAS, legacy compatibility, and authorization replay or mismatch.

## Non-goals

- Implementing ordinary native `STATUS` without an upstream read-only native contract.
- Producing a complete mixed native/Pi claimant inventory or proving native-authority absence.
- Reading or interpreting gentle-ai native authority, receipt, transaction, or binding files directly.
- Invoking `start`, `finalize`, or any other mutating command as a discovery probe.
- Migrating, importing, copying, translating, mirroring, deleting, or repairing native, compact-v2, or graph-v1 authority.
- Reimplementing native lifecycle state, CAS, canonicalization, hashing, receipts, risk, lenses, budgets, correction, or gates in TypeScript.
- Starting a second review after lost, ambiguous, or already-committed native output.
- Changing review policy, public tool names, envelope shapes beyond the typed unsupported result, actor permissions, or Judgment Day behavior.
- Adding destructive reset/recovery or silently resolving mixed authority.
- Treating SDD completion, actor output, discovery, or process success as approval.
- Committing, pushing, opening the PR, releasing, or publishing as part of review or SDD operations.
- Delivering the required upstream gentle-ai read-only status/inventory command in this repository or PR.

## Required upstream follow-up

Gentle-ai must add a non-mutating, machine-readable ordinary review status and claimant-inventory contract. At minimum, it must support explicit repository scope, validated lineage/authority identity, ordinary state and revision reporting, unambiguous no-claimant versus claimant results, malformed/mixed authority evidence, and stable typed JSON/error semantics without creating or transitioning authority.

Only after that contract is released and versioned may Pi replace `native-status-unsupported` with general native `STATUS` and complete mixed-authority inventory.

## Risks and mitigations

### False clean or incomplete mixed-authority result

**Risk:** Pi inventories only its own stores and incorrectly concludes that no native claimant exists.

**Mitigation:** any decision requiring native claimant inventory returns `native-status-unsupported`. Pi never treats incomplete inventory as clean.

### Accidental mutation during discovery

**Risk:** a status path invokes `start` or `finalize` to discover state and changes authority.

**Mitigation:** the adapter exposes no status-via-mutation behavior; tests prove unsupported status performs no native process call and no local fallback mutation.

### Duplicate authority after ambiguous output

**Risk:** Pi starts a replacement review after a native operation committed but its output was lost.

**Mitigation:** require exact-operation replay or explicit recovery and prohibit alternate lineage creation or local fallback.

### Stale binding or authorization evidence

**Risk:** SDD readiness or lifecycle execution relies on outdated binding, target, or receipt evidence.

**Mitigation:** use native binding CAS, exact bound SDD status, native gate validation, and existing bash-time rederivation. Any mismatch fails closed.

### Native installation drift

**Risk:** the installed binary is absent or incompatible.

**Mitigation:** strict schemas and typed process failures; no binding, approval, fallback authority, or command authorization is created.

### Same-PR coupling with issue #118

**Risk:** shared routing or authorization seams increase review and rollback complexity.

**Mitigation:** keep the native adapter and unsupported-status boundary narrow, separate tests by concern, and retain independently reviewable commits while delivering one PR. Shared seams must use one native route, not duplicate adapters or transitional stores.

## Rollback

Rollback is code-only and must not mutate persisted authority.

- Revert native `START`, `FINALIZE`, `VALIDATE`, bind-SDD, and bound SDD-status routing as one coherent integration or as independently reviewable commits.
- Leave all native records, receipts, and bindings untouched; do not translate them into Pi stores.
- Preserve `native-status-unsupported` or an equally fail-closed block wherever rollback cannot prove native-authority absence.
- Do not resume Pi mutation for a candidate that may already have native authority. Keep it blocked until compatible native integration or explicit native recovery is restored.
- Preserve existing compact-v2/graph-v1 read-only and gate compatibility, one-shot authorization protections, and dangerous-command safety.

## Success criteria

- [ ] New ordinary Pi `START` creates or resumes exactly one native gentle-ai 2.1.0 lineage through a typed argument-array adapter.
- [ ] Ordinary `FINALIZE` and `VALIDATE` use native authority while retaining Pi's existing public envelopes and blocked semantics.
- [ ] Native canonical IDs, transitions, hashes, receipts, revisions, and CAS remain native-owned.
- [ ] Ordinary native `STATUS` returns explicit typed `native-status-unsupported` and follow-up-required evidence without reading files or invoking a native process.
- [ ] Requests requiring complete mixed native/Pi claimant inventory return `native-status-unsupported` rather than an incomplete or inferred result.
- [ ] Unsupported status performs no native mutation probe, Pi fallback mutation, binding, approval, receipt creation, or lifecycle authorization.
- [ ] An approved native lineage binds to the exact OpenSpec change through native `bind-sdd`, including empty-revision first bind and stale-revision rejection.
- [ ] Bound SDD status uses only the exact native binding/readiness contract and never presents itself as general review status or inventory.
- [ ] Existing Pi compact-v2 and graph-v1 ordinary lineages preserve read-only/gate-compatible routing and reject mutation; Judgment Day remains unchanged on graph-v1.
- [ ] Missing, non-executable, timed-out, non-zero, malformed, or incompatible native CLI behavior creates no fallback authority, binding, approval, or authorization.
- [ ] Lost or ambiguous native output cannot trigger a duplicate review; exact-operation replay or recovery is required.
- [ ] Pi registers lifecycle authorization only after native validation allows, and authorization remains exact, one-shot, and rederived at bash execution.
- [ ] The upstream read-only native status/inventory contract is documented as required follow-up and is not implemented or simulated in this PR.
- [ ] Strict TDD covers argument arrays, response schemas, native failures, unsupported status and inventory, no-probe/no-fallback guarantees, binding CAS, legacy routing, and authorization replay/mismatch.
- [ ] Combined tests for this change and issue #118 pass in the same PR with one native adapter and no competing authority route.

## Delivery constraints

- Artifact store: OpenSpec.
- Execution mode: automatic corrective proposal pass.
- Delivery: single PR with issue #118.
- Testing: strict TDD.
- Scope: only the supported gentle-ai 2.1.0 native operations and explicit fail-closed unsupported boundaries described above.
