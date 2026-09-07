# Gentle AI review integration architecture

← [Back to README](../README.md)

Gentle Pi is a transport consumer, not a review authority. Gentle AI generates the current runtime contract; the package forwards the bounded work it receives and preserves the provider's outcome.

## Ownership boundary

| Component | Responsibility |
| --- | --- |
| Pi reviewer adapter | A pure opaque adapter: `Buffer → Buffer/error`. It accepts a Go-materialized prompt as bytes, invokes Pi, and returns raw final bytes or a typed transport error. |
| Host coordinator | Executes the exact Go-issued materialize/submission tokens, launches the adapter, and submits its untouched result only through the supplied token. |
| Gentle AI (Go) | Go owns worktree, lineage, candidate freeze, lens selection, correction, validator, approval burn, and review semantics. Delivery commands remain ordinary repository-policy operations. |

The adapter does not parse bindings, select work, rebuild prompts, inspect repository state, retry, classify results, or create authority. The coordinator does not infer a command or replace a provider-issued token. The package has no durable receipt or policy authority.

## Transport behavior

1. Gentle AI emits an opaque materialization or submission token for the selected Pi runtime.
2. The host coordinator executes that exact token and gives only the materialized bytes to the adapter.
3. The adapter returns raw output bytes to the coordinator.
4. The coordinator sends those bytes only through the exact Go-issued submission token.

A typed Pi transport refusal fails closed. The coordinator reports the refusal without an agentless lifecycle fallback, local retry policy, synthetic result, or alternate approval path.

## Dynamic contract delivery

Package static assets intentionally omit lifecycle instructions, candidate routing, recovery procedures, receipt semantics, and any delivery-gate or delivery-authorization behavior. Since Gentle AI stopped generating Pi APPEND_SYSTEM composition, Gentle Pi mirrors the provider contract bundle's `orchestration/pi.md` review execution contract locally (`contracts/review-provider-contract-mirror/`) and injects that verified, mirrored text into the primary session's system prompt at session start. Gentle AI writes nothing into the Pi system prompt; the host follows only that mirrored contract. When the mirrored contract is absent or unreadable, Gentle Pi does not invent a fallback; delivery remains ordinary repository policy.

## Integration constraints

- Keep Pi transport opaque: raw prompt bytes in, raw result bytes or a typed error out.
- Preserve Go-issued materialize and submission tokens exactly; they are the only authority-bearing inputs the host may execute.
- Treat a transport failure as unavailable evidence, never as an approval, completion, or permission to substitute a local workflow.
- Keep command safety and user interaction in the host, without interpreting provider authority state.
- Keep durable review state, admissions, correction accounting, and approvals in Gentle AI. Keep delivery decisions in ordinary repository policy.

## Review checklist

- [ ] The adapter surface is still `Buffer → Buffer/error`.
- [ ] The coordinator executes only exact Go-issued materialize/submission tokens.
- [ ] Typed transport refusal remains fail-closed.
- [ ] No package code or static prompt uses review authority to decide, authorize, rewrite, or block delivery commands.

← [Back to README](../README.md)
