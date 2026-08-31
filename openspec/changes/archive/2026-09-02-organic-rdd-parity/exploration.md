# Exploration: organic-rdd-parity

## Current State

Gentle Pi consumes a package-local Gentle AI runtime. Native review mode, candidate identity, consent, transition selection, authority persistence, and validation semantics belong to that runtime. Pi supplies a typed controller and an opaque host relay for provider-issued reviewer materialization and submission.

## Historical Record

This change previously explored a capability-gated local implementation of review-mode, consent, tier, hint, and delivery behavior. That exploration also referenced recovery of an unrelated archived work-routing branch. The current worktree removes Pi-owned delivery and consent-persistence mechanisms, so the previous implementation path is retained only as historical context and does not define active behavior.

## Findings

- Pinned package tests must not inherit a maintainer's environment or persistent dev-binary registration. Testing seams can provide a disposable environment while explicit dev tests opt in deliberately.
- Global native review-mode fixtures must use a disposable Git repository and temporary HOME/XDG state. The package worktree can carry an intentional clone-local mode and is not a lifecycle fixture.
- Native review lifecycle status and transitions must be exercised with their current positional testing seams; obsolete pending-authorization arguments miswire the native client and cancellation signal.
- The provider owns candidate consent and relay transport. Pi must not create a durable latch or replace provider-issued invocation tokens.
- Review output is not delivery authorization. Delivery is ordinary repository policy.

## Recommendation

Keep the native lifecycle boundary narrow: isolate test state, relay exact provider-owned contracts, and document delivery as separate from review. Do not restore removed publication gates, one-shot delivery authorization, commit-runner behavior, or Pi-owned consent persistence.
