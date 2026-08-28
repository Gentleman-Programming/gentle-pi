# SDD Orchestration Specification

## Purpose

Define the narrow ownership boundary between implementation work performed by `sdd-apply` and mandatory post-apply review evidence performed by the parent/orchestrator. This prevents completed implementation from being reported as a false apply failure while keeping review evidence non-deciding and commit, push, PR, and release delivery under ordinary repository policy.

## Requirements

### Requirement: Deterministic task ownership

SDD task artifacts MUST mark each task checkbox as either implementation-owned or parent/orchestrator-owned work using one explicit, deterministic ownership marker. The marker MUST distinguish implementation work from post-apply bounded-review evidence and ordinary repository-delivery handoff actions; this change MUST NOT introduce a broader task taxonomy or ownership hierarchy.

An absent marker MUST default to implementation-owned. A present but malformed or unsupported marker MUST fail closed visibly: the task MUST remain visible as unresolved work or an explicit task-artifact error and MUST NOT be silently excluded from apply accounting.

#### Scenario: Legacy task file defaults safely

- GIVEN a legacy SDD task artifact contains unchecked implementation checkboxes without ownership markers
- WHEN ownership is interpreted for apply completion
- THEN each unmarked checkbox MUST be treated as implementation-owned
- AND an unchecked task MUST continue to block implementation completion
- AND the task MUST NOT be silently skipped

#### Scenario: Malformed ownership marker is visible

- GIVEN an SDD task artifact contains a checkbox with a malformed or unsupported ownership marker
- WHEN the task artifact is parsed
- THEN parsing or status MUST report a visible fail-closed error or unresolved task
- AND the malformed task MUST NOT be excluded from implementation accounting
- AND the system MUST NOT claim implementation completion from that task

### Requirement: Apply is limited to implementation-owned work

`sdd-apply` MUST execute and report only implementation-owned tasks. It MUST determine completion from implementation-owned tasks, and MUST NOT start bounded-review, refutation, correction, or validation actors; mint or approve review receipts; or execute commit, push, PR, release, or other ordinary repository-delivery actions.

#### Scenario: Completed implementation with pending parent actions

- GIVEN implementation-owned tasks are complete
- AND parent/orchestrator-owned post-apply bounded-review evidence or ordinary repository-delivery handoff checkboxes remain unchecked
- WHEN `sdd-apply` runs or reports progress
- THEN `sdd-apply` MUST report implementation work complete
- AND MUST NOT run review actors, mint or approve a receipt, or execute an ordinary repository-delivery action
- AND MUST leave the parent-owned actions visible as pending

#### Scenario: Exact false-failure reproduced by this change

- GIVEN an SDD task file contains completed implementation checkboxes and unchecked parent-owned tasks for recording bounded-review evidence and handing delivery to ordinary repository policy
- AND the parent-owned tasks cannot be executed by `sdd-apply`
- WHEN native status evaluates whether apply is complete
- THEN native status MUST report implementation progress complete rather than false-failing because those parent-owned tasks are unchecked
- AND it MUST report the pending parent-owned actions separately
- AND the next route MUST be parent bounded review, not another `sdd-apply` continuation

### Requirement: Native status separates progress from lifecycle routing

Native SDD status MUST compute implementation completion using implementation-owned checkboxes only. It MUST separately report unresolved parent/orchestrator-owned actions as visible pending lifecycle routing. When all implementation-owned tasks are complete, the next route MUST be parent bounded review (or the existing parent-owned lifecycle route), not another apply operation.

#### Scenario: Status routes after implementation completion

- GIVEN all implementation-owned tasks are complete
- AND at least one parent/orchestrator-owned lifecycle action is pending
- WHEN native SDD status is requested
- THEN status MUST report implementation completion separately from pending parent actions
- AND pending parent actions MUST remain visible and unresolved
- AND status MUST recommend parent bounded review rather than `sdd-apply`

#### Scenario: Status still blocks on implementation work

- GIVEN at least one implementation-owned checkbox is unchecked or unresolved
- WHEN native SDD status is requested
- THEN status MUST report implementation incomplete
- AND status MUST route back to implementation work
- AND pending parent-owned actions MUST NOT be treated as completed

### Requirement: Parent owns mandatory review evidence and delivery handoff

Bounded review evidence MUST remain mandatory and parent/orchestrator-owned. Separating implementation completion from review evidence MUST NOT imply review approval, receipt validity, delivery authorization, commit, push, PR publication, or release. Review receipts and status are non-deciding evidence; commit, push, PR, and release follow ordinary repository policy.

#### Scenario: Parent executes deferred review evidence

- GIVEN native status reports implementation complete with pending parent-owned review-evidence or delivery-handoff actions
- WHEN the parent/orchestrator continues the workflow
- THEN the parent/orchestrator MUST start or reuse bounded review to record content-bound review evidence
- AND MUST hand commit, push, PR, and release delivery to ordinary repository policy rather than a review receipt or gate
- AND `sdd-apply` MUST NOT be used as a substitute for those actions
