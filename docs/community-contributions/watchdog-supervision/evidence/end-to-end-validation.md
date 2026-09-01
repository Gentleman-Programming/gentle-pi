# End-to-end validation evidence

## Objective of this evidence

Demonstrate that the controller can complete a real bounded implementation phase through persistence, terminal phase completion and final evidence validation.

## Public run record

| Field | Value |
| --- | --- |
| Run ID | `WATCHDOG-TERMINATION-GRACE-SUCCESS` |
| Outcome | Accepted after one completed phase and zero recoveries. |
| Controller provenance | Packaged `reference-source/phase-router.ts`; integrity record: [`../SOURCE-SHA256.txt`](../SOURCE-SHA256.txt). |
| Runtime attribution | A local worker plus external supervisor. See [`../MODEL_EVIDENCE_AND_LIMITS.md`](../MODEL_EVIDENCE_AND_LIMITS.md) for the supported model-level claims. |
| Timestamp handling | The retained log shows local timestamps but did not preserve a publishable UTC offset. This document does not infer one. |
| Commands and raw artifacts | Deliberately excluded because they identify a private workload and environment. |
| Test scope | One bounded implementation phase, persistence, terminal completion, evidence validation, two focused suites and syntax diagnostics. |

The evidence below is a sanitised event extract. It is sufficient to support the
controller outcome stated here; it is not a portable workload replay.

## Successful terminal sequence

From the real controller log:

```text
2026-08-29 17:10:35  ENGRAM_SAVE_ACK             P1  saved observation #163
2026-08-29 17:10:35  ENGRAM_ACK_BARRIER_ARMED    P1
2026-08-29 17:10:36  WATCHDOG_TERMINATION_GRACE  P1
2026-08-29 17:11:03  phase_complete              P1
2026-08-29 17:11:03  PHASE_COMPLETE_END          P1  OK
2026-08-29 17:11:03  WORKER_AGENT_END            P1
2026-08-29 17:11:07  EVIDENCE_VALIDATION_START   P1
2026-08-29 17:11:31  EVIDENCE_VALIDATION_END     P1  evidence -> accepted
2026-08-29 17:11:31  EVIDENCE_ACCEPTED           P1
```

The UI reported:

```text
AUTO DONE
completed_phases=1
recoveries=0
```

## Why this matters

A previous run had reached a valid Engram ACK but was aborted when context pressure reached the HARD watchdog threshold before the worker could call `phase_complete`.

After adding the bounded termination grace, the same terminal protocol completed successfully.

## Application workload result

The bounded task also completed its own engineering validation:

- focused suite A: 20 tests passed;
- focused suite B: 28 tests passed;
- syntax diagnostics passed;
- final evidence was accepted.

The workload domain is not part of the controller contribution.
