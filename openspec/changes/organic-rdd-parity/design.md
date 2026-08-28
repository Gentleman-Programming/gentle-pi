# Design: Organic RDD Parity

## Current Architecture

Gentle AI owns review mode, candidate identity, risk, consent, lifecycle transitions, review evidence, and authority persistence. Gentle Pi is a consumer and transport adapter: it requests typed native status, presents a provider-issued consent envelope without changing its machine tokens, and follows only the provider-returned transition.

## Historical reconciliation

Earlier revisions of this change described Pi capability flags, a clone-local consent latch, a delivery-aware VALIDATE path, and publication authorization. Those mechanisms were removed from the active architecture. This design records the current boundary rather than preserving superseded behavior as a requirement.

## Architecture Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Native mode is user-owned. | Pi does not enable review mode or convert an off mode into a delivery decision. |
| 2 | Consent is candidate-scoped and provider-issued. | Pi localizes and relays the complete envelope; it does not persist a Pi-owned consent latch. |
| 3 | Native lifecycle routing is authoritative. | Pi requests status and executes only exact returned transitions or collection instructions. |
| 4 | Reviewer transport is opaque. | The host relay uses the provider-materialized prompt and submission form without parsing or rebuilding reviewer output. |
| 5 | Delivery is separate. | Commit, push, pull-request, and release operations follow ordinary repository policy; review state never authorizes or blocks them. |
| 6 | VALIDATE is informational at the controller boundary. | It exposes review information and never supplies command authorization or a publication gate. |

## Data Flow

```text
native STATUS / START
  -> provider-owned mode and candidate identity
  -> optional provider consent envelope
  -> Pi presents the complete envelope losslessly
  -> exact provider-owned answer invocation
  -> provider-selected transition
  -> opaque host relay only for provider materialize/submission slots

controller VALIDATE
  -> informational review result

delivery command
  -> ordinary repository policy
```

## File Boundaries

| File | Responsibility |
| --- | --- |
| `extensions/gentle-ai.ts` | Typed lifecycle consumer, consent relay, and informational controller result. |
| `lib/native-review-cli.ts` | Exact native command execution and typed decoding. |
| `lib/review-host-relay.ts` | Opaque provider prompt/result transport. |
| `README.md` | Delivery remains ordinary repository policy. |
| `docs/native-authority-architecture.md` | Native authority and legacy compatibility ownership. |

## Testing Strategy

- Use isolated temporary HOME/XDG state and disposable Git repositories for native runtime fixtures.
- Isolate pinned-binary tests from ambient dev-binary environment and registration state while retaining explicit dev-binary test opt-in coverage.
- Exercise provider transition routing, recovery hydration, host-relay transport, and informational VALIDATE behavior.
- Assert documentation names native review semantics and ordinary delivery policy without asserting retired publication authorization.

## Non-goals

- Reintroducing Pi-owned review authority, consent persistence, delivery gating, or commit execution.
- Mutating clone/global review mode in tests outside disposable fixture state.
