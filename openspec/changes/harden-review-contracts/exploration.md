# Exploration: Harden Review Contracts

## Executive finding

The minimum coherent hardening is a contract-boundary change, not a new review workflow. Runtime inputs currently reach the compact facade and reducers through TypeScript interfaces plus partial ad hoc checks. That leaves malformed nested payloads, unknown fields, caller-controlled validator handoff, prompt drift, and runtime/authority identity ambiguity as separate failure classes. They should be hardened together because each protects the same `review/start -> review/finalize -> review/validate` authority boundary.

## Investigation notes

CodeGraph was attempted first. The workspace index/manifest was not present and no CodeGraph execution tool was exposed in this delegated environment, so the documented read/grep fallback was used. No implementation was performed.

Relevant seams found:

| Area | Current seam | Hardening implication |
|---|---|---|
| Operation inputs | `lib/review-facade.ts` accepts broad operation objects and optional nested payloads | Add runtime schemas at each operation boundary, including exact nested shapes and numeric/string constraints. |
| Finalize payloads | `lib/review-compact.ts` has `CompactReviewResultInput`, refuter, finding, and targeted-validation interfaces; validation is distributed and permissive in places | Validate before reducer logic and reject unknown keys recursively. |
| Legacy reducer seam | `lib/review-policy-ordinary.ts` constructs validator requests and checks hashes, but request shape checks are shallow | Preserve the frozen-row/hash model while making the input and generated handoff runtime-validated. |
| Persistent authority | `lib/review-compact-store.ts` already uses exact-key checks for stored records | Reuse the strictness convention for transient operation payloads; do not weaken persisted compatibility. |
| Lens prompts | Four `assets/agents/review-*.md` files and `tests/review-ledger-contract.test.ts` carry the canonical contract | Establish one canonical prompt contract/source or a single parity fixture so lens prompts cannot drift. |
| Runtime identity | Repository/authority and compact store code already validate persisted identity fields | Add loaded-runtime identity binding and explicit mismatch failures without changing graph-v1 read-only behavior. |
| Coverage | `tests/review-compact.test.ts`, policy/controller/gate tests, ledger-contract tests, and runtime/package tests exist | Extend these seams with focused regression and one end-to-end facade/store integration path. |

## Minimum scope

1. **Runtime schemas for operation inputs**
   - Define runtime validators for `review/start`, `review/finalize`, and `review/validate` inputs.
   - Cover nested lens results, findings, refuter batches, correction forecasts, targeted validation checks, follow-ups, and final evidence.
   - Enforce required/optional fields, enum values, canonical strings, safe integer/range rules, and array/object expectations before state transitions.

2. **Recursive unknown-field rejection**
   - Reject extra keys at the top level and every nested object, including actor-produced findings and validator evidence.
   - Keep persisted schema validation separate from transient input validation so existing readable graph-v1 artifacts remain compatible.
   - Ensure errors identify the rejected contract area without leaking an alternate transition path.

3. **Canonical reviewer lens prompts**
   - Preserve the existing four lens roles and their contract language.
   - Centralize the required prompt clauses or introduce a canonical parity source consumed by the four assets/tests.
   - Keep reviewer output untrusted: prompts describe the contract, while native code remains authoritative for IDs, scope, causal disposition, and transitions.

4. **Validator correction-evidence handoff**
   - Build the validator request from frozen correction IDs, frozen rows, original acceptance evidence, correction regression evidence, and frozen ledger hash.
   - Do not permit caller input to redefine requested IDs, rows, paths, or correction purpose.
   - Validate the generated handoff before dispatch and validate returned evidence against that exact handoff.

5. **Scoped repair reporting**
   - Report only the frozen correction IDs and paths for the one bounded repair.
   - Treat validator follow-ups as inert observations; reject added findings, scope, IDs, or extra repair rounds.
   - Make reports distinguish correction-required, scoped validation, and escalation outcomes clearly.

6. **Loaded-runtime identity**
   - Bind the loaded runtime’s contract/version/schema identity to the authority/store context at load/use time.
   - Fail closed on mismatched runtime identity rather than allowing a process with different contract code to mutate or validate authority.
   - Preserve existing repository identity, compact authority fixes, CodeGraph explorer changes, and graph-v1 read-only compatibility.

7. **Regression and integration coverage**
   - Add tests for unknown keys at each nesting level and malformed enum/type/range values.
   - Add prompt parity tests for all four lenses.
   - Add validator tampering tests for IDs, frozen rows, evidence, paths, and follow-ups.
   - Add scoped repair-report assertions and loaded-runtime identity mismatch tests.
   - Add one facade-to-store integration test covering start, finalize, bounded correction handoff, validation, and terminal reporting.

## Explicit non-goals

- No new review states, actors, refuter policy, or correction budget.
- No graph-v1 migration or mutation enablement.
- No broad rewrite of authority storage or CodeGraph tooling.
- No commits, PR creation, publication, or normalization of unrelated uncommitted changes.
- No alteration of existing uncommitted CodeGraph explorer or compact authority fixes; implementation must isolate its diff from them.

## Risks and decisions to carry forward

- Strict schemas may expose existing tests/fixtures that relied on ignored fields; update only intentional contract fixtures, not production semantics.
- Recursive exact-key checks must be applied to operation inputs, while persisted artifact compatibility rules remain unchanged.
- Prompt centralization must preserve package-owned asset installation and explicit project/user override behavior.
- Runtime identity checks must use stable loaded-runtime metadata and must not make graph-v1 read-only reads fail unnecessarily.
- The 2,000-line single-PR ceiling is ample but requires contract code and tests to remain focused on the listed seams.

## Ready for proposal

Yes. The proposal should authorize contract-first hardening across facade schemas, nested finalize payloads, canonical lens prompts, validator handoff/reporting, runtime identity, and focused integration coverage, while explicitly preserving the existing uncommitted CodeGraph and compact-authority work.
