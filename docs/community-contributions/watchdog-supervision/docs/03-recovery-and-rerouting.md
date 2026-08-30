# Recovery evidence and rerouting

## Task-scoped recovery evidence

Marker:

- `TASK_SCOPED_RECOVERY_EVIDENCE_V1`

### Problem

Recovery snapshots are useful across fresh worker contexts, but they become dangerous if evidence from an older task can satisfy or steer a different task.

### Change

Recovery snapshots are bound to the producing task using controller state such as:

- stable continuation lineage ID;
- fingerprint of the source original objective.

The new execution task ID is deliberately not used as a direct snapshot-match
key: it is fresh for every worker context. Snapshots whose continuation lineage
and objective fingerprint cannot both be matched to the active task are
rejected.

### Goal

Preserve recovery continuity without allowing stale cross-task evidence to contaminate the current objective.

---

## Recovery read paths

Marker:

- `RECOVERY_READ_PATH_V1`

Successful read evidence retains the structured read path rather than depending only on later reconstruction from serialized argument text.

This makes resume/recovery evidence less fragile and allows verified reads to be represented directly.

---

## Route preservation during recovery

A bounded recovery objective can still require source inspection capabilities. Recovery routing should not accidentally collapse an inspection-oriented phase into a route that lacks the tools needed to finish it.

The current implementation contains a route-preservation guard for this class of failure.

## Upstream consideration

Task isolation is the safety property. The exact representation of the binding token can be adapted to Gentle-Pi's preferred controller state model.
