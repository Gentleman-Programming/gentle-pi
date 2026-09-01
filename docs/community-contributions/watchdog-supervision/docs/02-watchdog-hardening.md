# Watchdog hardening

## Problem 1 — SOFT review decisions could become destructive

### Observed behaviour

A watchdog review triggered by soft context pressure could return `blocked` or `abort_reroute`. Treating that model decision as sufficient authority could terminate a worker that was still making useful progress.

### Change

Markers:

- `WATCHDOG_SOFT_REVIEW_ADVISORY_V1`
- `WATCHDOG_SOFT_DECISION_BARRIER_V1`

Policy:

```text
SOFT watchdog condition
    -> supervisor review allowed
    -> non-continue result is advisory
    -> worker continues

HARD watchdog condition
    -> destructive recovery may be considered
```

### Why

Context pressure is a useful warning but not proof of a loop or failure.

---

## Problem 2 — review-count escalation could promote non-structural pressure

### Change

Marker:

- `WATCHDOG_STRUCTURAL_ESCALATION_V1`

Review-count escalation is restricted to structural signals such as repeated calls, repeating tool sequences, strongly redundant reads and repeated identical errors.

Soft context/turn/tool pressure remains soft until its explicit hard threshold is reached.

---

## Problem 3 — asynchronous reviews can become stale

### Failure mode

```text
watchdog snapshot
      |
      +--> supervisor starts review
      |
worker continues
      +--> new tool calls / real progress
      |
supervisor returns "blocked"
```

The returned decision describes an older state.

### Changes

Markers:

- `WATCHDOG_STALE_REVIEW_GUARD_V1`
- `WATCHDOG_STALE_REVIEW_PRE_ABORT_V1`

Before a destructive action, authoritative cycle state is re-read. A
non-continue decision is discarded only when the worker advanced a monotonic
semantic checkpoint or completed a successful state transition after the review
snapshot. Repeated calls, failed calls and no-op reads are retained as
structural evidence; they do not by themselves invalidate the recovery
decision.

### Real validation

The live controller log showed repeated:

- `WATCHDOG_STALE_REVIEW_PRE_ABORT_INVALIDATED`

while the worker was reading, editing, testing and persisting results. Those decisions did not abort the progressing worker.

See `evidence/watchdog-behaviour.md`.
