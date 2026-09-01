# Watchdog behaviour evidence

The live validation run demonstrated the intended asynchronous safety barriers.

## SOFT decisions remained advisory

Observed repeatedly:

```text
WATCHDOG_REVIEW_END ... -> blocked
WATCHDOG_SOFT_ADVISORY_IGNORED
```

The worker continued running because context pressure was still SOFT.

## Stale decisions were invalidated

While Qwen was reviewing watchdog state, the worker continued making tool calls.

Observed:

```text
WATCHDOG_STALE_REVIEW_PRE_ABORT_INVALIDATED
```

after additional reads, edits, tests and persistence activity.

The stale non-continue decision did not destroy the progressing worker.

## Semantic carry-forward was active

Observed repeatedly:

```text
WATCHDOG_SEMANTIC_CHECKPOINT_SAVED
```

Later reviews explicitly referred to facts present in the previous semantic checkpoint, including already completed validations.

## Final hard-threshold transition

Once a valid Engram ACK existed and the phase was waiting for its mandatory final action, the termination-grace barrier protected the worker long enough to call `phase_complete`.

This sequence ended with accepted final evidence and `AUTO DONE`.
