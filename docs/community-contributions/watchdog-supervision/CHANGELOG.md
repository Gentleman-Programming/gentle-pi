# Changelog

## Experimental hardening set — 2026-08

### Recovery and isolation

- `TASK_SCOPED_RECOVERY_EVIDENCE_V1`
- `RECOVERY_READ_PATH_V1`
- recovery route preservation for inspection-oriented work

### Watchdog safety

- `WATCHDOG_REVIEW_PROGRESS_GUARD_V1`
- `WATCHDOG_STALE_REVIEW_GUARD_V1`
- `WATCHDOG_STRUCTURAL_ESCALATION_V1`
- `WATCHDOG_SOFT_REVIEW_ADVISORY_V1`
- `WATCHDOG_SOFT_DECISION_BARRIER_V1`
- `WATCHDOG_STALE_REVIEW_PRE_ABORT_V1`

### Persistent continuation

- `PERSISTENT_RESUME_CHECKPOINT_V1`
- `WATCHDOG_SUCCESS_EVIDENCE_V1`
- `WATCHDOG_SEMANTIC_CHECKPOINT_V1`
- `SEMANTIC_CONTINUATION_V1`
- `SEMANTIC_RESUME_CHECKPOINT_V1`
- `WATCHDOG_SEMANTIC_CARRY_FORWARD_V1`

### Phase finalization

- `WATCHDOG_TERMINATION_GRACE_V1`
- `WATCHDOG_TERMINATION_GRACE_LOG_ONCE_V1`

### Routing

- `PROJECT_PROFILE_BASELINE_V1`

## Note

This changelog describes the local experimental branch used for validation. Before upstream submission, each group should be compared with current Gentle-Pi main and split into reviewable commits.
