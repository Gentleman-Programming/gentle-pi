# Delegate the supported native review subset to gentle-ai 2.1.0

## Decision

This proposal records the historical gentle-ai 2.1.0 route: ordinary review `START`, `FINALIZE`, and `VALIDATE`, plus `bind-sdd` and status for an exact bound OpenSpec change. Its former Pi delivery-authorization model is obsolete.

Current ordinary native `STATUS` is read-only. Pi relays schema-valid native status and errors, never inspects native files or probes with mutation, and never infers or mints delivery authority. Ordinary repository policy owns delivery.

This remains historical context for issue #118. It creates no copy, migration, mirror, duplicate review, or delivery authorization.

## Intent

Use native review evidence wherever the current contract provides a supported command, without pretending that Pi can safely reconstruct native state. The change provides native lifecycle mutation, review validation evidence, exact OpenSpec association, and read-only STATUS relay without affecting ordinary delivery policy.

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
- `VALIDATE` invokes native `review validate` for the exact review target and maps its evidence. The former Pi one-shot lifecycle authorization path is obsolete: Pi never mints delivery authority, and ordinary repository policy owns delivery.
- Lost or ambiguous mutating output requires exact-operation replay or explicit recovery; Pi must not start a replacement lineage.

### Current read-only status boundary

The 2.1.0 status limitation above is historical context only. Current native ordinary `STATUS` is read-only and exposes validated ordinary lineage state and claimant discovery without mutation.

Therefore:

- Pi relays native `STATUS` evidence and errors without creating a lineage, binding, approval, receipt, or delivery authorization;
- Pi does not read native storage files, invoke mutating commands as probes, infer state from receipts or Pi artifacts, or fall back to local mutation;
- complete inventory and status errors remain native evidence, not Pi-side authority reconstruction;
- STATUS never binds a candidate view; controller `START` remains the sole binding operation.

### OpenSpec binding and bound SDD status

After native approval and validation, Pi may invoke native `review bind-sdd` for the exact repository, change, OpenSpec path, lineage, receipt, and expected binding revision. The first bind uses the native empty expected-revision contract; retries use the observed revision. Stale, conflicting, malformed, cross-repository, or path-mismatched binds fail closed.

For an exact bound change, Pi may invoke the native SDD status contract and map its readiness result into Pi's SDD envelope. This path is not a general review status or claimant inventory. Missing, stale, ambiguous, or invalid binding evidence remains blocked and must not be inferred from task completion or local review artifacts.

### Existing Pi authority compatibility

- Existing Pi compact-v2 ordinary lineages retain their current read-only compatibility routing and reject lifecycle mutation.
- Existing graph-v1 ordinary lineages retain their current read-only compatibility routing and reject lifecycle mutation.
- Judgment Day remains mutable on graph-v1 under its existing explicit workflow.
- When routing can establish a known Pi authority kind without needing native inventory, it continues to use the compatible Pi reader.
- When native claimant evidence is incomplete or erroneous, Pi relays the native status error; it does not choose a winner or silently declare the authority clean.

### Public and safety compatibility

Pi's public operation names, request/response envelopes, and blocked/action semantics remain stable while current native `STATUS` remains read-only.

The historical exact one-shot command-authorization path is obsolete. Pi relays review evidence and errors only; it does not infer or mint delivery authority. Commit, push, PR, and release decisions always follow ordinary repository policy.

Dangerous-command safety remains independent and authoritative.

## Affected areas

- `extensions/gentle-ai.ts`: route supported native operations and relay read-only native status evidence.
- A process boundary under `lib/`: typed argument-array execution and strict response validation.
- Pi compact-v2 and graph-v1 routing: preserve read-only compatibility behavior and mutation rejection.
- `lib/sdd-status.ts` and the SDD status command: consume only exact native binding/readiness evidence.
- Review evidence: preserve native validation as review evidence only; ordinary repository policy owns delivery.
- Focused strict-TDD coverage for adapter behavior, read-only status, no-probe/no-fallback guarantees, binding CAS, and legacy compatibility.

## Non-goals

- Implementing ordinary native `STATUS` through mutation or Pi-side authority reconstruction.
- Producing a mixed native/Pi claimant inventory through local inference.
- Reading or interpreting gentle-ai native authority, receipt, transaction, or binding files directly.
- Invoking `start`, `finalize`, or any other mutating command as a discovery probe.
- Migrating, importing, copying, translating, mirroring, deleting, or repairing native, compact-v2, or graph-v1 authority.
- Reimplementing native lifecycle state, CAS, canonicalization, hashing, receipts, risk, lenses, budgets, correction, or gates in TypeScript.
- Starting a second review after lost, ambiguous, or already-committed native output.
- Changing ordinary repository delivery policy, public tool names, actor permissions, or Judgment Day behavior.
- Adding destructive reset/recovery or silently resolving mixed authority.
- Treating SDD completion, actor output, discovery, or process success as approval.
- Committing, pushing, opening the PR, releasing, or publishing as part of review or SDD operations.
- Replacing read-only native STATUS with a local simulated status or Pi-side authority reconstruction in this repository or PR.

## Current status contract

Native ordinary `STATUS` is the non-mutating, machine-readable status and claimant-inventory contract. Pi relays its validated repository scope, lineage/authority identity, state, revision, claimant, and typed error evidence without creating or transitioning authority and without minting delivery authority.

## Risks and mitigations

### False clean or incomplete mixed-authority result

**Risk:** Pi inventories only its own stores and incorrectly concludes that no native claimant exists.

**Mitigation:** Pi relays the read-only native claimant evidence and never treats incomplete or erroneous evidence as a Pi-side clean result.

### Accidental mutation during discovery

**Risk:** a status path invokes `start` or `finalize` to discover state and changes authority.

**Mitigation:** the adapter exposes no status-via-mutation behavior; tests prove read-only STATUS performs no local binding or fallback mutation.

### Duplicate authority after ambiguous output

**Risk:** Pi starts a replacement review after a native operation committed but its output was lost.

**Mitigation:** require exact-operation replay or explicit recovery and prohibit alternate lineage creation or local fallback.

### Stale binding or authorization evidence

**Risk:** SDD readiness or lifecycle execution relies on outdated binding, target, or receipt evidence.

**Mitigation:** use native binding CAS and exact bound SDD status. Pi relays review evidence without converting it into delivery authority.

### Native installation drift

**Risk:** the installed binary is absent or incompatible.

**Mitigation:** strict schemas and typed process failures; Pi creates no binding, approval, fallback authority, or delivery authorization.

### Same-PR coupling with issue #118

**Risk:** shared routing or authorization seams increase review and rollback complexity.

**Mitigation:** keep the native adapter and read-only status boundary narrow, separate tests by concern, and retain independently reviewable commits while delivering one PR. Shared seams must use one native route, not duplicate adapters or transitional stores.

## Rollback

Rollback is code-only and must not mutate persisted authority.

- Revert native `START`, `FINALIZE`, `VALIDATE`, bind-SDD, and bound SDD-status routing as one coherent integration or as independently reviewable commits.
- Leave all native records, receipts, and bindings untouched; do not translate them into Pi stores.
- Preserve read-only native STATUS relay behavior and never replace it with status-via-mutation or Pi-inferred authority.
- Do not resume Pi mutation for a candidate that may already have native authority. Keep it blocked until compatible native integration or explicit native recovery is restored.
- Preserve existing compact-v2/graph-v1 read-only compatibility, review-evidence boundaries, ordinary repository delivery policy, and dangerous-command safety.

## Success criteria

- [ ] New ordinary Pi `START` creates or resumes exactly one native gentle-ai 2.1.0 lineage through a typed argument-array adapter.
- [ ] Ordinary `FINALIZE` and `VALIDATE` use native authority while retaining Pi's existing public envelopes and blocked semantics.
- [ ] Native canonical IDs, transitions, hashes, receipts, revisions, and CAS remain native-owned.
- [ ] Ordinary native `STATUS` relays schema-valid read-only native evidence without reading authority files, probing with mutation, or binding a candidate view.
- [ ] Requests requiring complete mixed native/Pi claimant inventory relay native evidence or typed native errors rather than an incomplete or inferred Pi result.
- [ ] STATUS performs no native mutation probe, Pi fallback mutation, binding, approval, receipt creation, or delivery authorization.
- [ ] An approved native lineage binds to the exact OpenSpec change through native `bind-sdd`, including empty-revision first bind and stale-revision rejection.
- [ ] Bound SDD status uses only the exact native binding/readiness contract and never presents itself as general review status or inventory.
- [ ] Existing Pi compact-v2 and graph-v1 ordinary lineages preserve read-only compatibility routing and reject mutation; Judgment Day remains unchanged on graph-v1.
- [ ] Missing, non-executable, timed-out, non-zero, malformed, or incompatible native CLI behavior creates no fallback authority, binding, approval, or delivery authorization.
- [ ] Lost or ambiguous native output cannot trigger a duplicate review; exact-operation replay or recovery is required.
- [ ] Pi relays native validation as review evidence only and never registers lifecycle delivery authorization.
- [ ] Current read-only native STATUS is relayed rather than implemented through mutation or simulated Pi authority.
- [ ] Strict TDD covers argument arrays, response schemas, native failures, read-only status and inventory, no-probe/no-fallback guarantees, binding CAS, and legacy routing.
- [ ] Combined tests for this change and issue #118 pass in the same PR with one native adapter and no competing authority route.

## Delivery constraints

- Artifact store: OpenSpec.
- Execution mode: automatic corrective proposal pass.
- Delivery: single PR with issue #118.
- Testing: strict TDD.
- Scope: only the supported native operations, read-only STATUS relay, and non-mutating evidence boundaries described above.
