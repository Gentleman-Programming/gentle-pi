# Telemetry

`gentle-pi` does not collect anything itself. [`gentle-ai`](https://github.com/Gentleman-Programming/gentle-ai) (issue [#4309](https://github.com/Gentleman-Programming/gentle-ai/issues/4309)) owns anonymous usage telemetry end to end: install and heartbeat events, the exact fields sent, rate limiting, and every opt-out. See gentle-ai's own README/docs for that contract. Gentle Pi's only involvement is a best-effort nudge that asks the local binary to act.

## What Gentle Pi does

On activation of a primary session (never for a named agent or an SDD phase executor), Gentle Pi resolves the package-local `gentle-ai` binary (honoring a registered dev-binary override, same as every other native call) and spawns:

```text
gentle-ai telemetry trigger --json
```

- detached, with stdout/stderr discarded (`stdio: "ignore"`);
- a 3 s deadline: a runaway process is killed, but Gentle Pi never waits for it to exit;
- at most once per process, regardless of how many sessions or sub-agents run afterward.

Rate limiting, enrollment, and every opt-out live entirely in `gentle-ai`; calling the trigger once per session start is safe by construction. A missing binary, an older binary without the `telemetry` verb (which prints `unknown telemetry command` and exits non-zero), or a spawn failure are all treated as "nothing to do" and never affect activation or surface an error to the user.

Install counts for `gentle-pi` and `gentle-engram` come from npm download statistics; neither package emits an install event of its own.

## The trigger contract

`gentle-ai telemetry trigger --json` always exits `0` and prints one line of JSON:

```json
{"schema":"gentle-ai.telemetry-trigger/v1","decision":"enrolled|sent_install|sent_heartbeat|rate_limited|backoff|disabled","source":"<deciding source>"}
```

`gentle-ai telemetry status|enable|disable|preview [--json]` exist for the opt-out flow; `status --json` prints `gentle-ai.telemetry-status/v1`. Gentle Pi's `/gentle:telemetry` slash command runs these in the foreground (bounded to 5 s) through the same binary resolver and relays the result.

## Opting out

Any of the following disables the nudge or the underlying telemetry:

- `/gentle:telemetry disable` — asks the local `gentle-ai` binary to disable telemetry. `/gentle:telemetry status` and `/gentle:telemetry preview` inspect it without leaving Pi.
- `DO_NOT_TRACK=1` — Gentle Pi does not spawn the trigger at all; `gentle-ai` also honors this standard independently.
- `GENTLE_AI_TELEMETRY=0` — same effect, `gentle-ai`'s own environment switch.
- `CI=true` — Gentle Pi does not spawn the trigger in automated/CI runs, since they are not a real usage signal.
