# Engram ACK to phase completion

Markers:

- `WATCHDOG_TERMINATION_GRACE_V1`
- `WATCHDOG_TERMINATION_GRACE_LOG_ONCE_V1`

## Required phase protocol

The worker contract requires:

```text
mem_save
   |
   v
real Engram ACK
   |
   v
phase_complete
```

`phase_complete` is the mandatory final action.

## Failure observed before the change

A real execution reached:

```text
mem_save OK
ENGRAM_SAVE_ACK
context reached HARD threshold
watchdog recovery started
worker aborted
```

The engineering work and persistence had succeeded, but the controller destroyed the worker before it could perform the required terminal action.

## Change

If:

- `last_memory_ack` belongs to the active phase; and
- the active phase does not yet have its `phase_result`;

the watchdog enters a bounded termination grace window.

During that window it does not start destructive watchdog recovery.

The implementation used a 90-second bound so that a genuinely hung worker eventually returns to normal watchdog authority.

## Validation

The next real execution produced:

```text
ENGRAM_SAVE_ACK
WATCHDOG_TERMINATION_GRACE
phase_complete
PHASE_COMPLETE_END OK
WORKER_AGENT_END
EVIDENCE_VALIDATION_END -> accepted
AUTO DONE
```

The interval from ACK to `phase_complete` was approximately 28 seconds, demonstrating why a very short grace period would have been unsafe.

## Logging cleanup

The watchdog polls frequently. Initially, the grace event was emitted on every poll.

`WATCHDOG_TERMINATION_GRACE_LOG_ONCE_V1` changes this to log only the transition into grace while preserving the underlying state behaviour.
