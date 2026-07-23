# Validation record

## Result at a glance

| Surface | Result | Meaning |
| --- | --- | --- |
| Source focused regression | PASS | The repaired behavior is demonstrated in the source checkout. |
| Source package-resource verifier | PASS | Required package resources and pinned contract artifacts match. |
| Package-local Gentle AI v2.1.11 provisioning | VERIFIED | The package-local provider was provisioned before post-install observation. |
| Local provider inspect | PASS | Provider inspection succeeds after that verified provisioning. |
| Authorized fresh ordinary START | OBSERVED | Returns the sanitized provider diagnostic in `observed-start-failure.json`; reconciliation reports no lineage and action `start`. |
| Pi adapter diagnostic propagation | PROVEN | The adapter preserves and exposes the sanitized `review/start` diagnostic rather than raw negotiated failure content. |
| Native Gentle AI root cause | UNRESOLVED | v2.1.11 emits only generic `non-zero` / `operation_outcome_unknown`; native maintainers must add stage-level sanitized failure evidence. |

## RED / GREEN evidence

- **RED:** not observed. The repair already existed when this handoff began, so a pre-repair failure was not run or reconstructed.
- **GREEN:** source command passed: `node --experimental-strip-types --test --test-name-pattern="negotiated unknown START reconciled to start without lineage exposes only sanitized diagnostics" tests/review-controller-native-routing.test.ts` (1 pass, 0 failures).
- **TRIANGULATE:** source command passed: `node scripts/verify-package-files.mjs` (`84 files; 19 exact byte-identical v2.1.11 contract artifacts`).
- **REFACTOR:** not performed; this handoff only packages the existing repair and evidence.

## Post-install evidence and authority boundary

The provider diagnostic is intentionally limited to operation `review/start`, error code `non-zero`, exit code `1`, timeout `false`, output limit `false`, and the sanitized stderr string in `observed-start-failure.json`. It contains no target, repository, user, lineage, receipt, credential, or raw negotiated payload value.

Status reconciliation reports no lineage and action `start`. Therefore no replay is safe, and this evidence cannot authorize a commit. The generic native diagnostic is sufficient to prove Pi adapter propagation but insufficient to identify the native failure stage; native maintainers must add stage-level sanitized failure evidence.
