# Architecture notes

## Controller model

The workflow uses an ephemeral worker controlled by a persistent phase router.

Conceptually:

```text
user objective
    |
    v
phase router
    |
    +--> bounded worker phase
    |       |
    |       +--> project tools
    |       +--> tests / diagnostics
    |       +--> mem_save
    |       `--> phase_complete
    |
    +--> watchdog review
    |       `--> external supervisor
    |
    +--> recovery / reroute
    |
    +--> persistent resume state
    |
    `--> final evidence validation
```

The important controller state is split into concerns:

- **CycleState**: task identity, original objective, active phase, route, persisted memory IDs, phase result and recovery history.
- **WatchdogState**: tool calls, turns, review counters, context pressure, recent events and the semantic checkpoint.
- **WatchdogDecision**: advisory/terminal decision plus factual continuation information.
- **WatchdogRecovery**: bounded recovery strategy and evidence snapshot.
- **ResumeCheckpoint**: compact cross-session continuation state for the same objective.

## Design principle

A model may interpret evidence, but controller invariants should decide whether a destructive action is allowed.

Examples:

- SOFT watchdog pressure does not independently authorize worker abortion.
- A stale review cannot abort a worker that progressed after the review snapshot.
- A prior task's recovery evidence is rejected for a different active task.
- After a valid Engram ACK, a bounded grace window protects the mandatory `phase_complete` transition.

## Ephemeral contexts, persistent task progress

A fresh worker context is not necessarily a fresh engineering task.

The resume mechanism therefore uses:

- a **new task ID** for the new execution context;
- a controller-side fingerprint of the original objective;
- prior evidence only when the objective binding matches.

This preserves task isolation without forcing repeated discovery after interruption.
