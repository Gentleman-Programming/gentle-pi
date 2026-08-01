# Delta for Review Orchestration

## ADDED Requirements

### Requirement: Exact-slot reviewer result capture

The Pi controller MUST capture each selected reviewer document exactly once using the provider-issued `review.capture-result` inputs from fresh STATUS. Each capture MUST bind lineage, target, authority revision, repository context, artifact subject hash, lens, and ordered slot. The controller MUST validate the `gentle-ai.review-result-artifact/v2` manifest and MUST finalize only with `capturedResults: true` or exact admitted manifests; retired `--result` transport MUST NOT be used.

#### Scenario: Admitted reviewer result

- GIVEN STATUS offers a capture token for a selected lens and exact slot
- WHEN the reviewer document is captured and its manifest matches the binding
- THEN the controller records one admitted result and FINALIZE receives only the admitted transport

#### Scenario: Lost output after committed capture

- GIVEN capture output is lost or unknown after the request is sent
- WHEN fresh STATUS proves that the exact capture slot committed
- THEN the controller continues with that result without rerunning the lens or replaying submitted bytes

### Requirement: Status-mediated corrected relaunch

After a capture or admission failure, the controller MUST query fresh STATUS before choosing recovery or termination. It MAY authorize at most one parent-driven corrected relaunch only when a safe diagnostic is returned and STATUS reoffers the same lineage, target, authority revision, subject hash, lens, and order slot. The relaunch MUST produce a newly authored result; rejected bytes MUST NOT be replayed. Unsafe, missing, malformed, mismatched, unavailable, or second-failure cases MUST terminate as `unavailable` or `exhausted`.

#### Scenario: One exact-slot relaunch

- GIVEN fresh STATUS reoffers the identical slot with an allowlisted diagnostic
- WHEN the parent launches a corrected reviewer session
- THEN exactly one newly produced document is captured and no second relaunch is available

#### Scenario: Recovery binding mismatch

- GIVEN a failure is followed by a different lineage, target, revision, subject, lens, or order
- WHEN recovery is evaluated
- THEN no relaunch occurs and the controller returns a terminal unavailable outcome

#### Scenario: Cleanup after success or shutdown

- GIVEN capture/recovery completes or `session_shutdown` is received
- WHEN the controller releases the candidate-root session
- THEN recovery counters and capture state are cleared and no stale relaunch remains

## MODIFIED Requirements

### Requirement: Precision-gated ledger

Ordinary MUST run 0/1/4 initial lenses once against `initial_review_tree`. Before corroboration, the authoritative store MUST freeze canonical ID-sorted rows containing immutable identity, claim, and evidence fields and bind them by `frozen_ledger_hash`. A single status-mediated admission-recovery relaunch MAY produce one new document for one exact frozen slot under the capture and recovery requirements above; it MUST NOT mutate frozen claims, add discovery work, or authorize speculation. `refuted` remains terminal; WARNING/SUGGESTION is one-time `info`. Summaries and actor output are inert; only controller APIs MAY authorize, and store-integrity mismatch fails closed.
(Previously: ordinary lens dispatch had no Pi-side capture and admission-recovery exception.)

#### Scenario: Precision limits

- GIVEN an ordinary 0/1/4 route
- WHEN initial discovery runs
- THEN each initial lens runs once, speculation is rejected, and only one exact-slot admission relaunch may follow a safe STATUS-mediated failure

#### Scenario: Frozen terminal rows

- GIVEN frozen canonical rows
- WHEN orchestration runs
- THEN claims/evidence stay immutable and terminal/info rows schedule nothing

#### Scenario: Authoritative persistence

- GIVEN summary/store disagreement
- WHEN authority is checked
- THEN the store prevails or integrity failure closes the gate

## Acceptance Criteria

Every scenario MUST have strict-TDD contract coverage: its test MUST fail before the behavior exists, pass after the change, and be included in `pnpm test` without invoking a mutable provider checkout.
