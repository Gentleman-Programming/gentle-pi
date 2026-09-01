# Validation results

## Purpose

The controller modifications were validated with a real bounded coding task rather than only by inspecting router source.

The application-specific workload is not part of Gentle-Pi. It was selected because it exercised:

- source discovery;
- source reads;
- an actual edit;
- regression-test creation;
- multiple test suites;
- syntax diagnostics;
- Engram persistence;
- phase termination;
- final evidence validation.

## Public provenance and reproducibility boundary

The validation summaries below describe two bounded local runs. Their public
metadata is intentionally limited so the package remains reproducible at the
controller level without publishing a private workload, local paths, raw logs
or commands that identify the private environment.

| Run | Outcome | Controller provenance | Runtime configuration | Timestamp and artifact policy | Scope |
| --- | --- | --- | --- | --- | --- |
| `WATCHDOG-TERMINATION-GRACE-SUCCESS` | Accepted | Packaged `reference-source/phase-router.ts`; see [`../SOURCE-SHA256.txt`](../SOURCE-SHA256.txt) | Local worker and external supervisor; model attribution is constrained by [`../MODEL_EVIDENCE_AND_LIMITS.md`](../MODEL_EVIDENCE_AND_LIMITS.md) | The retained log contains local timestamps without a recorded UTC offset; this public package does not invent one. Raw logs and exact commands are deliberately excluded. | One bounded implementation phase, persistence, terminal completion and evidence validation. |
| `WATCHDOG-PRE-GRACE-ABORT` | Aborted before terminal completion | Same experimental controller lineage | Same controller class; no public claim of identical model/runtime settings | No timezone-qualified timestamp or raw-log artifact is published; the source record did not preserve a publishable offset. Exact commands are deliberately excluded. | Demonstrates the pre-grace failure mode only. |

The public evidence therefore supports the stated controller outcomes and test
scope, not independent replay of the application workload. A downstream
reproduction should supply its own workload, runtime configuration, commands,
timezone-qualified timestamps and raw artifacts.

## Final successful execution

Observed controller sequence:

```text
RESUME_CHECKPOINT_INJECTED
...
ENGRAM_SAVE_ACK #163
ENGRAM_ACK_BARRIER_ARMED
WATCHDOG_TERMINATION_GRACE
...
phase_complete
PHASE_COMPLETE_END OK
WORKER_AGENT_END
EVIDENCE_VALIDATION_START
EVIDENCE_VALIDATION_END -> accepted
EVIDENCE_ACCEPTED
AUTO DONE
```

Final controller result:

- completed phases: 1
- recoveries: 0
- final evidence: accepted

## Workload validation

The phase reported:

- one stale boundary corrected;
- one focused upper-boundary regression added;
- focused suite A: 20 tests passed;
- focused suite B: 28 tests passed;
- Python `py_compile`: successful for relevant files.

These application details demonstrate end-to-end execution only. No application-specific rule is embedded in the controller changes.

## Model-evidence boundary

The validation artifacts distinguish a model being executed from a model passing
or failing a benchmark. The public, sanitised inventory and its attribution
limits are documented in [`../MODEL_EVIDENCE_AND_LIMITS.md`](../MODEL_EVIDENCE_AND_LIMITS.md).

## Watchdog validation observed during the preceding run

The log also showed:

- semantic checkpoints being saved;
- SOFT `blocked` decisions being ignored;
- stale asynchronous reviews being invalidated while the worker continued to make tool progress.

This was important because it tested the controller under actual asynchronous timing rather than a purely sequential simulation.
