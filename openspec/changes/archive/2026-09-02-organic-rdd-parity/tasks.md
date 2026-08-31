# Tasks: Organic RDD Parity

## Historical Record

The original task plan covered an earlier capability-gated parity experiment and an unrelated archived recovery track. Its proposed Pi-owned consent latch, delivery-aware VALIDATE behavior, publication authorization, and commit-runner references are superseded and must not be implemented.

## Reconciled Work Units

- [x] Preserve provider-owned review mode and candidate-scoped consent semantics.
- [x] Preserve exact provider lifecycle transition and host-relay transport ownership.
- [x] Remove Pi-owned delivery authorization, publication-gate, commit-runner, and consent-latch claims from active documentation.
- [x] Update test fixtures so pinned package cases ignore ambient dev-binary state and explicit dev tests retain isolated opt-in coverage.
- [x] Run lifecycle, transport, documentation-contract, runtime-module, package-file, packed-package, and diff-integrity validation.

## Current Acceptance Criteria

1. Pi never enables review mode implicitly and never uses review mode to decide delivery.
2. A provider-issued consent envelope remains complete, candidate-scoped, and losslessly relayed; no Pi-owned latch persists consent.
3. Native lifecycle and host-relay transport remain provider-selected and opaque.
4. Controller VALIDATE is informational and cannot authorize a later delivery command.
5. Commit, push, pull-request, and release delivery follow ordinary repository policy.
6. Tests use disposable state and preserve the repository worktree outside their temporary fixtures.

## Delivery Boundary

No task in this change stages, commits, pushes, creates pull requests, changes review mode, or mutates review authority. Repository delivery remains outside this OpenSpec change.
