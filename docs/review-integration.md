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

## Native risk-gated verification (gentle-pi#662)

Separate from the review-authority transport above, the host also exposes one read-only native operation: `gentle-ai review assess --cwd <repo> [--base-ref <ref> --committed-only] --json` (gentle-ai#4295). It is decoded by `lib/review-risk-assessment.ts` and wired through `lib/native-review-cli.ts` exactly like the existing `reviewMode` STATUS reader -- a bounded subprocess with a typed decode, never a mutation. A non-zero exit, a failure envelope, or an older binary without the verb all fail closed to `high` risk.

The `gentle_review` tool's `assess` operation (`extensions/gentle-ai.ts`) combines that assessment with the rendered `Receipt-driven development:` line to decide whether a delegated writer's change needs a separate `gentle-ai-verify` run, following this tier table:

| Native risk tier | Verification when RDD is `off`/`unknown` |
| --- | --- |
| passive | structural readback by the parent; no separate verifier, no tests |
| medium | writer self-verification stands; a separate `gentle-ai-verify` run is added only when the writer profile is a small model (mini or low effort) |
| high | writer self-verification plus a separate `gentle-ai-verify` run, always |
| unknown / assess failed | treated as high |

When RDD is `on`, the writer's own self-verification is the record and the native review is the independent check, except a passive-risk change, which still gets a structural readback instead. The small-model bias raises the medium tier to high for verification purposes only; an unknown RDD line never lowers a tier below `off`. The parent's own spot check (re-running one reported command before delivery) stays required in every tier.

## Review checklist

- [ ] The adapter surface is still `Buffer → Buffer/error`.
- [ ] The coordinator executes only exact Go-issued materialize/submission tokens.
- [ ] Typed transport refusal remains fail-closed.
- [ ] No package code or static prompt uses review authority to decide, authorize, rewrite, or block delivery commands.

← [Back to README](../README.md)
