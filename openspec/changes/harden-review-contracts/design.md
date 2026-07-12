# Design: Contract-bound compact review boundaries

## Decision summary

Keep the existing compact-v2 lifecycle and persistence formats, but put one strict transient contract layer in front of every compact operation. Native code will parse unknown input into exact typed values before authority discovery, derive validator scope from immutable review state and Git evidence, expose bounded repair reports from authority rather than actor text, and reject compact mutation or gate validation when the loaded runtime contract is incompatible.

No new review state, actor, operation, correction round, persisted schema, or graph-v1 mutation path is introduced.

## Design goals

1. Reject malformed or recursively widened `review/start`, `review/finalize`, and `review/validate` inputs before authority access or mutation.
2. Preserve native ownership of IDs, rows, paths, hashes, transitions, receipts, and terminal outcomes.
3. Make the targeted-validator request reproducible from frozen authority, correction evidence, and purpose-bound verification evidence.
4. Keep the four package reviewer lenses contract-equivalent without changing their specializations or override precedence.
5. Bind compact authority use to a stable loaded-runtime contract identity without migrating stored compact-v2 or graph-v1 data.
6. Keep implementation isolated from the protected CodeGraph explorer and existing compact-authority work and below the 2,000 authored-line ceiling.

## Architecture

```text
Pi tool / library caller
        |
        v
strict transient operation parser
  - exact keys recursively
  - type/enum/string/range checks
  - deterministic contract-area errors
        |
        v
review facade / compact gate
  - loaded-runtime compatibility check
  - authority discovery and Git derivation
        |
        +--> compact reducer (native canonicalization and transitions)
        |
        +--> compact store (CAS, immutable binding, receipts)
        |
        +--> authority-derived report / validator request
```

The transient parser and persisted-record validator remain separate. The former may become stricter without changing what existing stored graph-v1 or compact-v2 records mean.

## Component decisions

### 1. Strict transient contract module

Add `lib/review-compact-contract.ts` as the only parser for compact operation payloads and nested actor evidence. Its exported functions accept `unknown`, reject recursively unknown fields, and return validated values:

```ts
parseCompactStartInput(value: unknown): CompactFacadeStartInput
parseCompactFinalizeInput(value: unknown): CompactFacadeFinalizeInput
parseCompactGateInput(value: unknown): CompactGateContractInput
parseCompactDerivedGateTarget(value: unknown): DerivedCompactGateTarget
parseCompactValidationProof(value: unknown): CompactValidationProofInput
parseCompactTargetedValidation(value: unknown): CompactTargetedValidationInput
```

The module uses small local assertion primitives rather than adding a schema dependency. Every object parser owns an exact required/optional key set; nested parsers never pass through spread properties.

TypeScript declarations remain useful to callers, but reducers and stores must only receive values returned by these parsers. Public facade functions parse again at entry so direct library callers cannot bypass extension-level checks.

#### Validation conventions

| Value | Rule |
|---|---|
| Object | Plain, non-null, non-array object with exact keys |
| Array | Explicit array; each item parsed independently |
| Canonical string | Non-empty, already trimmed; no coercion |
| Digest | Lowercase 64-character hex |
| Lineage ID | Existing compact lineage grammar, maximum 128 characters |
| Integer | `Number.isSafeInteger`; operation-specific lower/upper bound |
| Boolean | Literal boolean; no truthy coercion |
| Enum | Exact value from a const runtime object |
| Evidence list | Canonical strings, duplicate-free; canonical sort required where order is authority-bearing |
| Optional value | Omitted or valid; explicit `null` is rejected |

Errors use `CompactReviewContractError` with stable `area` and `code` fields and a concise message such as `review/finalize.validation.follow_ups[0] contains unknown field repair_round`. Errors identify the invalid boundary only; they do not recommend another transition.

#### Exact transient shapes

- **Start:** `cwd`, optional `lineageId`, `policyHash`, optional complete `projection`. Projection accepts only `{ kind: "complete" }`.
- **Finalize:** `cwd`, optional `lineageId`, optional `review_result`, `correction_line_forecast`, `validation_proof`, `validation`, `final_evidence`, and `final_verification_passed`.
- **Lens result:** exact `lens`, `findings`, and `evidence` keys. Findings use only `id`, `lens`, `location`, `severity`, `claim`, `evidence_class`, `causal_disposition`, and `proof_refs`.
- **Refuter result:** exact `finding_id`, `outcome`, and `proof_refs`; the batch may contain only the frozen inferential IDs.
- **Validation proof:** exact original-criteria and correction-regression evidence groups. It contains evidence only, never IDs, rows, paths, findings, rounds, or transition requests.
- **Targeted validation result:** exact request hash, correction IDs, two purpose-bound checks, an explicitly empty `fix_caused_findings` array, and inert follow-ups.
- **Follow-up:** exact `finding_id`, `location`, `summary`, and `proof_refs`; no severity, disposition, action, round, path authorization, or transition field.
- **Final evidence:** non-empty canonical string paired with an explicit boolean result.
- **Validate:** exact repository/lineage and lifecycle target fields at the tool boundary; the derived target is parsed again after each derivation and final recheck.

Mutually dependent fields are checked before authority access. For example, `final_evidence` and `final_verification_passed` must appear together; validator output requires `validation_proof`; refuter results require a canonical request hash.

### 2. Boundary placement

`extensions/gentle-ai.ts` keeps JSON decoding and operation routing but delegates compact payload validation to the new parser. Existing `as never`, numeric coercion, and distributed shallow checks are removed from the compact START/FINALIZE path.

`startCompactReview`, `finalizeCompactReview`, and `validateCompactReviewGate` also validate their complete inputs immediately. Their first observable repository action must occur after parsing succeeds. Tests will use a store/Git probe hook to prove malformed input does not call legacy inspection, authority discovery, snapshot capture, lock acquisition, state replacement, or receipt loading.

`lib/review-compact.ts` retains semantic canonicalization and transition invariants. Shape validation does not replace reducer checks: strict parsing proves the payload form; reducer logic still decides causal admission, native IDs, correction IDs, escalation, and state transitions.

### 3. Authority-derived validator handoff

Introduce these compact contracts in `lib/review-compact.ts`:

```ts
interface CompactValidationProofInput {
  original_criteria: CompactValidationEvidenceInput;
  correction_regression: CompactValidationEvidenceInput;
}

interface CompactValidatorRequestBody {
  schema: "gentle-ai.compact-validator-request/v1";
  lineage_id: string;
  candidate_tree: string;
  fix_diff_hash: string;
  correction_ids: string[];
  correction_paths: string[];
  frozen_rows: CompactFinding[];
  frozen_ledger_hash: string;
  original_criteria: CompactPurposeEvidence;
  correction_regression: CompactPurposeEvidence;
}

interface CompactValidatorRequest {
  body: CompactValidatorRequestBody;
  request_hash: string;
}
```

The two purpose values are native constants (`original-criteria` and `correction-regression`), not caller strings. `frozen_rows` are selected from canonical `state.findings` by exact `state.correction_ids`; `frozen_ledger_hash` is domain-hashed from the complete canonical finding ledger. Correction paths, candidate tree, and fix hash come from the Git-derived correction snapshot.

#### Two-call finalize handoff without a new state

1. After the positive forecast and bounded edit, the caller invokes FINALIZE with `validation_proof` and no `validation` result.
2. The facade captures the current correction snapshot, validates it against frozen genesis paths/untracked paths/budget, builds and self-validates `CompactValidatorRequest`, and returns it. Authority remains `correction_required`; no mutation occurs.
3. The one validator receives only that request and returns one strict `validation` result.
4. The caller replays the identical `validation_proof` plus the validator result.
5. The facade re-captures Git evidence and reconstructs the request. Candidate tree, fix hash, paths, rows, IDs, ledger hash, evidence purposes, and request hash must match exactly before `completeCompactCorrection` can mutate authority.

This is an additional read-only handoff action inside the existing FINALIZE operation, not a new state, actor, repair round, or mutation. A changed working tree between dispatch and replay changes the native request hash and fails closed.

Validator checks must repeat the exact request-bound evidence lists and correction IDs. Added/substituted IDs, rows, paths, purposes, findings, evidence, or request hashes are contract errors. `fix_caused_findings` must be present and empty; a non-empty array escalates only if it came from an older already-valid internal caller, while the new public transient contract rejects it before mutation.

Follow-ups are parsed as inert observations, stored separately, and never included in `correction_ids`, correction paths, transition decisions, repair eligibility, or receipt eligibility.

### 4. Scoped repair reporting

Extend `CompactFacadeFinalizeResult` with native-derived optional fields:

```ts
interface CompactRepairReport {
  phase: "correction-required" | "scoped-validation" | "approved" | "escalated";
  correction_ids: string[];
  allowed_paths: string[];
  changed_paths?: string[];
  correction_budget: number;
  forecast_lines?: number;
  actual_lines?: number;
}
```

- `correction-required` reports frozen correction IDs and frozen genesis paths as the maximum authorized path boundary.
- `scoped-validation` reports the same IDs plus Git-derived changed paths and line count.
- terminal reports preserve that bounded scope and identify `approved` or `escalated` explicitly.
- actor follow-ups are returned, when needed, under a separate `observations` field marked inert; they never appear in `CompactRepairReport`.
- action text remains for compatibility but is derived from the same state-to-report function, preventing disagreement between prose and structured outcome.

Reports never echo caller-provided rows, paths, purposes, or repair-round requests.

### 5. Loaded-runtime contract identity

Add `lib/review-runtime-contract.ts` with a stable explicit identity independent of package version, process ID, install path, timestamps, or environment:

```ts
interface LoadedReviewRuntimeIdentityV1 {
  schema: "gentle-ai.review-runtime/v1";
  compact_contract: "gentle-ai.review-compact/v2";
  operation_contract: "gentle-ai.review-operation/v1";
  state_schema: "gentle-ai.review-state/v2";
  record_schema: "gentle-ai.review-state-record/v2";
  receipt_schema: "gentle-ai.review-receipt-body/v2";
  canonicalization: "gentle-ai.canonical-json/v1";
  identity_hash: string;
}
```

The hash is domain-derived from all fields except itself. Compatibility is explicit: compact-v2 persisted schemas map to the above contract identity. Existing compact-v2 records therefore require no rewrite. A future runtime must deliberately retain this supported identity or introduce a separately designed compatibility path.

`CompactReviewStoreV2` captures the loaded identity at construction and rechecks it immediately before compact load used for mutation, every `replace`, receipt materialization, and terminal receipt load. `validateCompactReviewGate` checks compatibility on the first load and final recheck. A mismatch throws `REVIEW_RUNTIME_INCOMPATIBLE` before mutation or gate evaluation.

A private/test-only provider seam permits mismatch tests; callers cannot supply runtime identity through START, FINALIZE, validator output, or VALIDATE payloads.

Graph-v1 inspection, export, and existing graph-v1 receipt/gate compatibility do not call the compact runtime assertion. Mixed/legacy inspection and reset/recovery remain unchanged.

### 6. Reviewer prompt parity

Keep all four package-owned files and installation/override behavior unchanged:

- `assets/agents/review-risk.md`
- `assets/agents/review-resilience.md`
- `assets/agents/review-readability.md`
- `assets/agents/review-reliability.md`

Create one parity fixture used by `tests/review-ledger-contract.test.ts`. It defines the required shared clauses and exact native JSON key order, with only the lens name parameterized. Each package prompt must satisfy the same fixture for:

- one-shot execution against `initial_review_tree`;
- exact finding keys and enum vocabulary;
- concrete proof prefixes;
- candidate-causal severe correction eligibility;
- native ownership and untrusted actor output;
- prohibition on persistence, actors, fixes, validation, delivery, and metadata in native JSON.

Lens-specific instructions remain outside the shared parity assertions. Project/user prompt overrides are neither rewritten nor parity-enforced; package asset precedence and installation paths do not change.

## Data flow

### Start

1. Decode JSON.
2. Parse exact START contract.
3. Assert loaded compact runtime identity.
4. Inspect legacy/mixed authority and capture Git snapshot.
5. Derive lineage/risk/lenses/budget natively.
6. CAS-create compact state.

### Review completion and refutation

1. Parse the full FINALIZE envelope and every nested lens/refuter row.
2. Assert runtime identity, then discover authority.
3. Canonicalize selected lens results and native IDs.
4. Derive the refuter request from canonical inferential severe findings.
5. Require exact replay and complete refuter batch.
6. Persist only reducer-produced state.

### Bounded correction and targeted validation

1. Parse and record positive forecast before edits.
2. After edits, parse purpose-bound validation proof.
3. Derive correction snapshot and validator request from authority plus Git.
4. Return the request without mutation.
5. Parse validator output, reconstruct the request, and compare its hash and fields.
6. Persist one correction and one validation or fail closed.
7. Emit structured repair scope derived from resulting authority.

### Lifecycle validation

1. Parse VALIDATE input before authority discovery.
2. Assert loaded runtime compatibility and load terminal authority/receipt.
3. Parse the first derived target and evaluate it.
4. Re-resolve runtime identity, authority, receipt, publication evidence, and target.
5. Parse the final target and compare both snapshots.
6. Allow only unchanged approved authority and exact target evidence.

## Persisted compatibility

| Surface | Decision |
|---|---|
| Compact state/record/receipt schemas | Unchanged; no new required stored fields |
| Existing valid compact-v2 records | Readable and usable under the explicit compatible runtime identity |
| Invalid transient payloads previously tolerated | Rejected; no grandfathering |
| Graph-v1 ordinary authority | Readable, exportable, and gate-validatable; remains immutable |
| Mixed/legacy authority | Existing fail-closed/reset/recovery behavior unchanged |
| Package lens assets | Same paths and override precedence |
| CodeGraph explorer and compact-authority baseline work | Protected; no broad formatting, reverts, or ownership claims |

## File change map

| File | Intended change |
|---|---|
| `lib/review-compact-contract.ts` | New strict transient parsers, exact-key helpers, and contract errors |
| `lib/review-runtime-contract.ts` | New stable loaded-runtime identity and compatibility assertions |
| `lib/review-facade.ts` | Parse complete inputs first; validator request handoff; authority-derived repair report |
| `lib/review-compact.ts` | Validator request/proof contracts and request/response binding; preserve reducer semantics |
| `lib/review-compact-store.ts` | Enforce runtime compatibility at compact load/mutation/receipt use; persisted shapes unchanged |
| `lib/review-compact-gate.ts` | Parse validate/derived targets and recheck runtime identity at both gate reads |
| `extensions/gentle-ai.ts` | Replace compact coercions/casts with shared parsers; keep graph-v1 routing unchanged |
| Four `assets/agents/review-*.md` files | Align only shared contract clauses where parity exposes drift |
| `tests/review-ledger-contract.test.ts` | Consume one canonical 4R parity fixture |
| `tests/review-compact-contract.test.ts` | New table-driven recursive shape/type/enum/string/range rejection tests |
| `tests/review-facade.test.ts` | Validator handoff tampering, scoped reports, and no-mutation boundary tests |
| `tests/review-compact-gate.test.ts` | Validate input/target/runtime mismatch and graph-v1 compatibility tests |
| `tests/review-controller.test.ts` | Tool-to-facade strict boundary and one facade-to-store bounded-correction lifecycle |
| Package/runtime verification tests as needed | Ensure new modules and unchanged prompt asset paths are packaged |

Implementation should prefer these existing seams and avoid touching `review-repository.ts` unless a narrow import/type seam is required. Runtime contract identity is not repository identity and must not be added to the pinned repository `IDENTITY` file.

## Test strategy

Strict TDD applies during implementation.

### RED: boundary tables

Table-drive one invalid mutation per case and assert `CompactReviewContractError.area/code` plus unchanged authority revision:

- unknown key at START and projection levels;
- unknown key in FINALIZE, review result, lens result, finding, refuter row, validation proof, validation check, follow-up, and final evidence pairing;
- wrong object/array/boolean/string types;
- unsupported lens/severity/evidence/disposition/outcome enums;
- whitespace, empty, malformed digest, duplicate canonical values;
- non-integer, unsafe, zero, negative, and over-budget forecast values;
- malformed validate target and unknown publication fields.

### GREEN: authority and handoff behavior

- Valid existing compact lifecycle remains byte/behavior compatible at persisted boundaries.
- Invalid public input performs no authority discovery, lock, CAS, receipt materialization, or gate transition.
- Validator request contains exactly frozen correction IDs/rows, complete ledger hash, Git-derived candidate/fix/path evidence, and two native purposes.
- Changed proof, row, ID, path, candidate tree, fix hash, purpose, evidence, request hash, added finding, or extra round rejects before mutation.
- Follow-ups remain inert and cannot enter repair scope or terminal authority decisions.
- Structured reports distinguish correction-required, scoped-validation, approved, and escalated outcomes.

### Runtime and compatibility

- Matching runtime identity permits compact mutation and validation.
- Mismatch blocks `replace`, receipt load/materialization, and both gate reads with `REVIEW_RUNTIME_INCOMPATIBLE`.
- Identity is stable across cwd/install path/process metadata changes.
- Existing compact-v2 fixtures load without rewrite.
- Graph-v1 inspection/export and receipt/gate validation bypass compact runtime identity and continue to work.

### Prompt parity

Run the same parity assertions for all four package lenses and intentionally mutate an in-memory fixture to prove each missing clause/key is detected. Assert distinct lens-specific role text remains present.

### Integration

One controller/facade/store test covers:

`START -> lens FINALIZE -> correction forecast -> edit -> validator-request FINALIZE -> targeted-validation FINALIZE -> independent evidence FINALIZE -> terminal report -> compact gate validation`.

The test asserts request replay binding, one correction/validator only, structured report scope, persisted receipt integrity, and unchanged operation/state names.

### Regression commands

Implementation should run focused Node tests first, then:

```bash
pnpm test
pnpm run prepack
```

## Rollout and rollback

This is a single-PR contract hardening with no feature flag and no data migration. Keep authored changes below 2,000 lines; if strict parsers plus focused tests exceed that ceiling, stop and rescope rather than weakening recursive validation or splitting authority semantics.

Before implementation, record the current diff for protected CodeGraph explorer and compact-authority paths. Use targeted edits only and verify those baseline hunks are unchanged afterward.

Rollback is a revert of the isolated parser/runtime/prompt/test hunks. It must not rewrite authority, delete receipts, reset lineages, modify pinned repository identity, or revert protected concurrent work. If compatibility trouble appears, revert transient hardening as one unit; do not selectively permit unknown nested keys.

## Implementation invariants

- Parsing precedes authority access.
- Persisted schema validation remains separate from transient operation validation.
- Native code alone derives IDs, scope, rows, hashes, transitions, receipts, and reports.
- One ordinary correction and one targeted validator remain the maximum.
- Validator request generation is read-only; mutation occurs only after exact response binding.
- Follow-ups are observations, never authority.
- Runtime identity is explicit contract metadata, not package or process identity.
- Graph-v1 compatibility and package/user prompt overrides remain intact.
- Existing CodeGraph explorer and compact-authority work remains unmodified.
