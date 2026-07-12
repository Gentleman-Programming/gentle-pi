# Harden Review Contracts at Runtime Boundaries

## Decision

Harden the existing `gentle_review` compact workflow as one contract-boundary change. The change will strictly validate transient operation inputs and nested actor evidence, keep the four reviewer prompts contract-equivalent, derive validator correction requests only from frozen native authority, report bounded repairs without widening scope, and bind mutation/validation to the loaded runtime identity.

This work preserves the existing `review/start -> review/finalize -> review/validate` workflow. It does not introduce a new review model, state machine, actor, correction round, or storage migration.

## Intent

The current TypeScript interfaces and distributed checks do not fully protect runtime boundaries. Malformed nested payloads, recursively unknown fields, caller-influenced validator handoffs, prompt drift, ambiguous repair reports, and runtime/authority identity mismatch can reach different parts of the review lifecycle with inconsistent handling.

These are one product and operational problem: maintainers need review authority to mean the same thing at every boundary, regardless of which caller, actor output, installed prompt asset, or loaded runtime supplied the data. Hardening them together reduces ambiguous failures, prevents accidental scope expansion, and makes terminal review outcomes explainable without changing the workflow users already operate.

## Desired outcomes

- Invalid `review/start`, `review/finalize`, and `review/validate` inputs fail before any state transition or authority mutation.
- Unknown fields are rejected at every transient payload level, including nested findings, refuter output, targeted validation, follow-ups, and final evidence.
- All four reviewer lenses communicate one canonical output and evidence contract while retaining their distinct risk roles.
- Validator requests are native-derived from frozen correction authority; callers and validators cannot redefine correction IDs, rows, paths, evidence purpose, or scope.
- Repair reporting clearly distinguishes correction required, scoped validation, approval, and escalation while exposing only the bounded repair scope.
- A runtime with incompatible contract identity cannot mutate or validate compact authority.
- Existing graph-v1 read-only behavior, persisted compatibility, CodeGraph explorer work, and compact-authority fixes remain intact.

## Scope

### In scope

1. **Runtime operation schemas**
   - Add strict runtime validation for the public inputs to `review/start`, `review/finalize`, and `review/validate`.
   - Validate required and optional fields, nested object and array shapes, enums, canonical strings, and safe numeric ranges before reducer logic.
   - Reject recursively unknown fields with errors that identify the invalid contract area without suggesting an alternate transition.

2. **Nested finalize and evidence contracts**
   - Apply strict validation to lens results, findings, refuter batches, correction forecasts, targeted validation checks, follow-ups, and final verification evidence.
   - Keep actor output untrusted; native code remains authoritative for IDs, causal classification, scope, hashes, transitions, and receipts.

3. **Canonical lens prompt contract**
   - Establish a canonical source or parity fixture for clauses shared by the four package-owned reviewer lens prompts.
   - Preserve each lens's existing role and project/user override behavior.
   - Add drift detection so a lens cannot silently omit required evidence or output constraints.

4. **Validator correction-evidence handoff**
   - Construct the validator request from frozen correction IDs, frozen rows, the frozen ledger hash, original acceptance evidence, and correction regression evidence.
   - Validate the generated request before dispatch and validate returned evidence against that exact request.
   - Reject attempts to add or substitute IDs, rows, paths, findings, purposes, follow-ups with transition authority, or repair rounds.

5. **Scoped repair reporting**
   - Restrict repair reports to frozen correction IDs and paths for the single bounded correction.
   - Treat permitted validator follow-ups as inert observations only.
   - Make correction-required, validating, approved, and escalated outcomes unambiguous without adding states.

6. **Loaded-runtime identity binding**
   - Bind stable loaded-runtime contract/version/schema identity to compact authority/store use.
   - Fail closed when incompatible runtime identity attempts mutation or validation.
   - Avoid imposing new mutation requirements on graph-v1 read-only inspection and export paths.

7. **Focused regression and integration coverage**
   - Cover unknown nested keys and malformed type, enum, string, and range values.
   - Cover prompt parity across all four lenses.
   - Cover validator tampering, scoped reporting, runtime mismatch, and a facade-to-store lifecycle through bounded correction and terminal reporting.

### Out of scope

- New review states, actors, lens-selection rules, refuter policy, correction budgets, or extra correction/validation rounds.
- Migration of graph-v1 authority or enabling graph-v1 mutation.
- A broad rewrite of compact authority storage, reducers, package installation, or CodeGraph tooling.
- Changes to dangerous-command safety, lifecycle publication gates, commit/push/PR/release behavior, or SDD completion semantics.
- Normalizing unrelated fixtures or uncommitted work merely to satisfy stricter schemas.
- Modifying, reverting, or absorbing the existing CodeGraph explorer changes or compact-authority fixes into this change.

## Affected areas

| Area | Intended effect | Boundary |
|---|---|---|
| Review facade | Validate operation inputs before authority access | No workflow or operation-name changes |
| Compact review reducer/contracts | Enforce exact nested transient shapes | No new states or transition authority |
| Ordinary policy validator handoff | Derive and verify correction evidence from frozen authority | Caller cannot redefine validation scope |
| Compact store/runtime loading | Check compatible loaded-runtime identity | Persisted compatibility remains separate |
| Four reviewer prompt assets | Preserve shared clauses through canonical parity | Lens specialization and overrides remain |
| Repair/terminal reporting | Expose exact bounded correction and outcome | No additional repair opportunity |
| Review tests and fixtures | Prove strict rejection and lifecycle integration | Update only intentionally valid contract fixtures |

## Business and product rules

- Native authority, not actor text or caller payloads, decides IDs, scope, causal disposition, transitions, receipt eligibility, and terminal status.
- Validation is fail-closed: malformed, unknown, mismatched, or inconclusive contract data cannot authorize progress.
- Strict transient input validation must not silently redefine persisted artifact compatibility.
- One ordinary review retains one bounded correction and one targeted validator.
- Validator follow-ups have no transition or repair authority.
- Runtime identity must be stable and deterministic enough to compare across load/use boundaries; it must not depend on incidental process state.
- Existing project/user reviewer asset overrides remain supported and are not rewritten by canonical package prompt work.

## Compatibility

- **Compact-v2 authority:** Existing readable authority remains usable when its persisted schema and loaded runtime identity are compatible. This proposal adds boundary checks; it does not rewrite stored records.
- **Graph-v1 authority:** Existing graph-v1 ordinary lineages remain readable, receipt/gate-validatable, and exportable but immutable. New runtime identity enforcement must not break read-only compatibility.
- **Mixed/legacy handling:** Existing fail-closed inspection, reset, recovery, and quarantine behavior remains unchanged.
- **Prompts:** The four package-owned lenses retain their current roles and installation behavior. Project/user definitions may continue to override package assets.
- **Callers and fixtures:** Payloads that already conform should retain behavior. Callers or fixtures relying on ignored extra fields or malformed values must receive explicit validation errors and be corrected rather than grandfathered.
- **Concurrent work:** Existing CodeGraph explorer and compact-authority modifications are treated as protected baseline work. Implementation must isolate touched hunks and must not revert, reformat, or claim those changes.

## Acceptance boundaries

The change is accepted only when all of the following are demonstrated:

- [ ] Each public compact operation rejects invalid top-level and nested payloads before state mutation.
- [ ] Tests cover unknown keys at representative depths for findings, refuter data, validator checks, follow-ups, and final evidence.
- [ ] Type, enum, canonical-string, integer, and range violations return deterministic contract-area errors.
- [ ] Valid existing compact-v2 lifecycle behavior remains unchanged.
- [ ] All four reviewer lens assets satisfy one canonical parity contract without collapsing their distinct lens instructions.
- [ ] Validator dispatch input is derived from frozen correction authority and cannot be replaced or widened by caller data.
- [ ] Returned validator evidence is checked against the exact frozen request; added findings, IDs, paths, scope, or rounds fail closed.
- [ ] Repair reports contain only frozen correction IDs and paths and clearly identify correction-required, scoped-validation, approval, or escalation outcomes.
- [ ] Runtime identity mismatch blocks compact mutation and validation with an explicit failure.
- [ ] Graph-v1 read-only inspection/export and existing receipt/gate validation compatibility remain operational.
- [ ] One facade-to-store integration path proves start, finalize, bounded correction handoff, targeted validation, and terminal reporting.
- [ ] Existing CodeGraph explorer and compact-authority changes remain unmodified by this change.

The change is not accepted merely because TypeScript types compile, prompts describe desired behavior, or isolated validators pass. Runtime rejection, authority-derived handoff, persisted compatibility, and end-to-end behavior all require executable evidence.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Strict schemas reject tolerated-but-invalid callers or fixtures | Adoption friction and failing tests | Produce precise contract-area errors; update only callers intentionally inside the documented contract |
| Transient and persisted validation become coupled | Accidental compatibility break | Keep operation schemas separate from stored-record validators and add graph-v1/compact-v2 compatibility tests |
| Prompt centralization changes asset installation or overrides | User customizations regress | Preserve package asset paths and override precedence; centralize parity, not ownership |
| Validator handoff hardening accidentally drops required evidence | False escalation or blocked approval | Build from frozen rows plus both original and regression evidence; test exact request/response matching |
| Runtime identity is unstable or over-broad | Legitimate reads or deployments fail | Use stable contract metadata, distinguish read-only legacy access from compact mutation/validation, and test mismatch boundaries |
| Repair reports expose scope not authorized for correction | Extra work or misleading authority | Derive reports from frozen IDs/paths only and treat follow-ups as inert |
| Single PR becomes cognitively expensive | Review quality declines | Keep work within the 2,000-line ceiling, organize by contract seam, and provide focused test evidence and a review map |
| Concurrent uncommitted work is overwritten | Loss of existing CodeGraph or compact-authority changes | Record baseline paths/hunks before implementation, avoid broad formatting, and verify protected diffs remain unchanged |

## Rollback

Rollback is a code-and-asset revert of this change's isolated commits/hunks. It must not rewrite or delete existing authority data, reset review lineages, or revert the protected CodeGraph explorer and compact-authority baseline work.

If strict validation causes an unforeseen compatibility failure, disable or revert the new transient boundary enforcement as a unit rather than weakening selected nested checks ad hoc. Authority created under the hardened runtime must remain readable; any evidence of incompatible persisted identity requires stopping mutation and handling it as an explicit compatibility incident, not bypassing identity checks.

## Delivery strategy

Deliver as one PR with a hard ceiling of 2,000 authored changed lines. The implementation should remain contract-first and reviewable in this order:

1. Runtime schemas and recursive exact-key behavior.
2. Frozen validator handoff and scoped reporting.
3. Canonical prompt parity.
4. Loaded-runtime identity binding.
5. Regression and facade-to-store integration evidence.

The PR must isolate this work from existing uncommitted CodeGraph explorer and compact-authority changes. If the forecast exceeds 2,000 authored lines or requires broad storage/workflow redesign, stop and rescope rather than silently splitting semantics or claiming a size exception.

## Success criteria

- Invalid or widened review data fails deterministically at the boundary closest to entry, before it can influence authority.
- Maintainers can trace a correction request and report back to the same frozen IDs, rows, paths, evidence purpose, and ledger identity.
- Reviewer prompt drift is detected automatically across all four lenses.
- Runtime/authority incompatibility produces a clear fail-closed result instead of ambiguous mutation or validation.
- Existing valid compact behavior and graph-v1 read-only compatibility continue to pass.
- No protected CodeGraph explorer or compact-authority work is modified.
- The complete change is reviewable as one PR within 2,000 authored changed lines.

## Proposal question round

Automatic mode prevents pausing for product clarification. The proposal therefore proceeds with these assumptions for later review:

1. The primary users are maintainers and automation operating compact review authority; stricter rejection is preferable to permissive backward behavior for malformed transient inputs.
2. Compatibility applies to valid callers and persisted readable authority, not to callers that depended on unknown fields being ignored.
3. Loaded-runtime identity should gate compact mutation and validation, while graph-v1 read-only inspection/export remains available.
4. Follow-ups may be reported as inert observations but can never widen correction scope or authorize another repair.
5. The first and only product slice is the coherent contract boundary described here; broader storage, CodeGraph, lifecycle, and publication changes remain non-goals.

Any correction to these assumptions should update this proposal before specification and design are finalized.
