# Semantic continuation checkpoints

Markers:

- `WATCHDOG_SUCCESS_EVIDENCE_V1`
- `WATCHDOG_SEMANTIC_CHECKPOINT_V1`
- `SEMANTIC_CONTINUATION_V1`
- `SEMANTIC_RESUME_CHECKPOINT_V1`
- `WATCHDOG_SEMANTIC_CARRY_FORWARD_V1`

## Why raw activity was not enough

An early resume checkpoint could preserve that a file had been read or a command had run without reliably preserving the fact learned from it.

For example:

```text
weak continuation:
"file X was read"

useful continuation:
"file X establishes boundary N; test Y passed; fact Z remains unresolved"
```

The worker would rationally re-read the file if only the first form survived.

## Successful tool evidence

The watchdog now receives clipped successful tool results as evidence, not only error results.

That allows the supervisor to distinguish:

- already established facts;
- successful validations;
- unresolved facts.

## Semantic checkpoint fields

The watchdog can maintain:

- `verified_facts`
- `validated_operations`
- `relevant_files`
- `unresolved_facts`
- `continuation_objective`

The continuation objective should represent the smallest useful next action from the current progress point rather than restating the original discovery task.

## Carry-forward

Each new watchdog review receives the previous semantic checkpoint.

The supervisor returns a complete updated checkpoint:

```text
previous facts A+B
        +
new evidence C
        |
        v
updated facts A+B+C
```

Previous facts should be removed only when newer supplied evidence specifically contradicts them or makes them stale.

## Safety

The semantic checkpoint is grounded only in:

- supplied successful evidence; or
- the previous same-phase semantic checkpoint.

It should not invent facts that are absent from both.
