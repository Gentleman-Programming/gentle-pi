# Persistent resume

Marker:

- `PERSISTENT_RESUME_CHECKPOINT_V1`

## Problem

Closing or interrupting Pi during a valid task could cause a later run of the same objective to repeat discovery, file reads and validation that had already been performed.

That wastes context and can itself trigger watchdog pressure.

## Design

A compact `ResumeCheckpoint` is created from the previous cycle when:

- the previous cycle is not already completed; and
- the normalized original-objective fingerprint matches the incoming objective.

The new execution always receives a **new task ID**.

The checkpoint can carry:

- completed phases;
- prior memory IDs;
- verified reads;
- successful evidence;
- diagnostics;
- actions to avoid repeating;
- operations that should not be reacquired merely for confidence;
- the next unresolved action.

## Safety properties

- The previous task ID is never reused as the active task.
- Resume evidence is accepted only for the same objective binding.
- The checkpoint is treated as evidence, not as an engineering conclusion.
- Fresh reads/tests remain allowed when a specific missing fact requires them or when post-modification validation is necessary.

## Known limitation

The current implementation is optimized for resuming the most recent persisted cycle state. A future design could archive checkpoints keyed by objective fingerprint rather than relying on a single latest-state file.
