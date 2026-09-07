# Delegated verification

How the Gentle Pi orchestrator decides who verifies a bounded writer's work. The always-on parent prompt renders a `Receipt-driven development: on|off|unknown` line; the delegation overlay (`assets/orchestrator-delegation.md`, trigger 5) keys the verification rule on it. This page is package-owned; `docs/review-integration.md` mirrors the Gentle AI contract and must stay byte-identical to it.

## Receipt-driven development on

The bounded writer runs the exact commands the parent lists under `## Verification`, in the foreground, and reports each as `<command>: <observed result>`. That report is the verification of record and the native review is the independent check. `gentle-ai-verify` is on-demand: a `partial` or `blocked` writer, an expensive or external check the parent wants on a cheaper profile, or a parent spot check.

## Receipt-driven development off or unknown (gentle-pi#662)

The host exposes one read-only native operation: `gentle-ai review assess --cwd <repo> [--base-ref <ref> --committed-only] --json` (gentle-ai#4295). It is decoded by `lib/review-risk-assessment.ts` and wired through `lib/native-review-cli.ts` exactly like the existing `reviewMode` STATUS reader -- a bounded subprocess with a typed decode, never a mutation. A non-zero exit, a failure envelope, or an older binary without the verb all fail closed to `high` risk.

The `gentle_review` tool's `assess` operation (`extensions/gentle-ai.ts`) combines that assessment with the rendered `Receipt-driven development:` line to decide whether a delegated writer's change needs a separate `gentle-ai-verify` run, following this tier table:

| Native risk tier | Verification when RDD is `off`/`unknown` |
| --- | --- |
| passive | structural readback by the parent; no separate verifier, no tests |
| medium | writer self-verification stands; a separate `gentle-ai-verify` run is added only when the writer profile is a small model (mini or low effort) |
| high | writer self-verification plus a separate `gentle-ai-verify` run, always |
| unknown / assess failed | treated as high |

When RDD is `on`, the writer's own self-verification is the record and the native review is the independent check, except a passive-risk change, which still gets a structural readback instead. The small-model bias raises the medium tier to high for verification purposes only; an unknown RDD line never lowers a tier below `off`. The parent's own spot check (re-running one reported command before delivery) stays required in every tier.

