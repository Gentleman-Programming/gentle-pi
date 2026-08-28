# Proposal: Organic RDD Parity

## Intent

Keep Gentle Pi aligned with the provider-owned native review lifecycle without recreating review authority or delivery policy in Pi. The active implementation preserves native mode, candidate-scoped consent, and immutable relay transport semantics.

## Historical record

This change originally explored capability-gated parity work and an unrelated archived work-routing recovery. That planning predated the removal of Pi-owned delivery gates, command authorization, commit-runner behavior, and consent latches. Those removed mechanisms are not part of the active proposal or its acceptance criteria.

## Scope

### In Scope

- Reflect native review mode as provider-owned lifecycle state; Pi never enables it implicitly.
- Relay a provider-issued candidate consent envelope losslessly and execute only its returned follow-up invocation after an explicit answer.
- Preserve provider-selected risk, candidate identity, lifecycle transitions, and host-relay transport without Pi-side reconstruction.
- Treat review status and informational VALIDATE as review evidence only.
- Keep commit, push, pull-request, and release delivery under ordinary repository policy.

### Out of Scope

- Pi-owned delivery gates, publication-target revalidation, one-shot command authorization, or a commit runner.
- Pi-owned persistent consent latches.
- Re-enabling clone or global review mode as part of implementation or tests.
- Changes to archived OpenSpec artifacts.

## Capabilities

### Modified Capabilities

- `organic-review-parity`: provider-owned review mode, candidate consent, and opaque transport behavior.
- `review-routing`: native lifecycle transitions remain authoritative; delivery is not a lifecycle decision.

## Affected Areas

| Area | Impact | Description |
| --- | --- | --- |
| `extensions/gentle-ai.ts` | Consumer | Relays typed native lifecycle results and consent bindings. |
| `lib/native-review-cli.ts` | Consumer | Executes the package-local native CLI with exact provider-owned arguments. |
| `lib/review-host-relay.ts` | Transport | Returns untouched provider-materialized reviewer output through the supplied submission form. |
| `README.md`, `docs/native-authority-architecture.md` | Documentation | Describe ordinary delivery policy and native review ownership. |

## Success Criteria

- Native review mode and candidate consent remain provider-owned.
- Pi transports exact lifecycle and relay inputs without reconstructing authority.
- No Pi-owned latch, delivery gate, publication authorization, or commit-runner claim remains in active documentation.
- Delivery commands remain governed by ordinary repository policy.
- Focused lifecycle, transport, and documentation-contract tests pass.
