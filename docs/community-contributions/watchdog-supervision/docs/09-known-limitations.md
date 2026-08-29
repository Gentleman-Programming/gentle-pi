# Known limitations and open questions

## 1. Resume storage is latest-state oriented

The persistent resume mechanism currently relies on the persisted cycle state available to the controller. A durable archive keyed by objective fingerprint could support resuming older interrupted work.

## 2. Objective fingerprinting is deliberately conservative

The binding is designed to prefer false negatives over cross-task contamination. Semantically equivalent objectives with materially different wording may not match.

## 3. Semantic evidence can still be incomplete

Successful result summaries are clipped. If the decisive fact is absent from the retained evidence, the resumed worker may legitimately need to reacquire it.

## 4. Project profile breadth

The project profile baseline improves reliability but may be broader than ideal from a least-privilege perspective.

## 5. Supervisor output remains probabilistic

The semantic checkpoint and watchdog review are model-generated. Deterministic controller barriers are therefore still necessary around destructive actions.

## 6. Termination grace timeout

The current 90-second value was selected from observed real execution behaviour. Upstream may prefer a configuration value, adaptive timeout, or explicit phase-finalization state.

## 7. Test coverage for controller race conditions

The behaviour has been validated in real executions. Upstream-quality automated tests should be added for:

- stale asynchronous review invalidation;
- SOFT review non-authority;
- task-scoped recovery evidence;
- resume objective binding;
- semantic checkpoint carry-forward;
- ACK-to-`phase_complete` grace.
