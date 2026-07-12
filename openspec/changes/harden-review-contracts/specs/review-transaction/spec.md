# Delta for Review Transaction

## ADDED Requirements

### Requirement: Authority-derived validator handoff

The validator request MUST be constructed by native code from frozen correction IDs, exact hash-bound canonical rows, frozen ledger hash, original acceptance evidence, and correction-regression evidence. Caller payloads and validator output MUST NOT redefine IDs, rows, paths, evidence purpose, findings, follow-ups with authority, or correction rounds. The generated request and returned evidence MUST be runtime-validated against the same frozen contract before terminal reduction.

#### Scenario: Exact bounded handoff

- GIVEN an approved ordinary review with frozen correction authority
- WHEN the bounded correction validator request is generated
- THEN it MUST contain only native-derived IDs, rows, ledger identity, paths, and required evidence
- AND the request MUST be validated before dispatch

#### Scenario: Tampered validator evidence

- GIVEN a validator response that adds or substitutes an ID, row, path, purpose, finding, follow-up authority, or repair round
- WHEN the response is validated
- THEN it MUST fail closed and escalate
- AND it MUST NOT mutate the ledger or authorize further work

### Requirement: Loaded-runtime identity binding

Compact authority mutation and validation MUST require a stable loaded-runtime contract/version/schema identity compatible with the authority/store context. An incompatible identity MUST fail closed with an explicit mismatch. Graph-v1 read-only inspection, export, receipt validation, and existing legacy quarantine behavior MUST remain available without a new mutation requirement.

#### Scenario: Compatible compact runtime

- GIVEN compact-v2 authority and a compatible loaded runtime identity
- WHEN mutation or validation is requested
- THEN the operation MAY proceed under existing authority and budget rules

#### Scenario: Incompatible compact runtime

- GIVEN compact-v2 authority and a mismatched loaded runtime contract identity
- WHEN mutation or validation is requested
- THEN the operation MUST fail closed with an identity-mismatch error
- AND no authority mutation or terminal approval MUST occur

#### Scenario: Graph-v1 read-only compatibility

- GIVEN graph-v1 authority and a read-only inspection, export, receipt, or gate-validation request
- WHEN the request is handled
- THEN existing read-only compatibility MUST remain operational
- AND graph-v1 mutation MUST remain rejected

### Requirement: Strict transient transaction evidence

All transient transaction evidence objects, including findings, refuter batches, correction forecasts, targeted checks, follow-ups, and final verification evidence, MUST be validated for exact nested shape and recursively unknown keys separately from persisted-record compatibility validation.

#### Scenario: Persisted compatibility is isolated

- GIVEN a readable persisted graph-v1 or compact-v2 record and a malformed transient operation payload
- WHEN the operation is processed
- THEN only the transient payload MUST be rejected
- AND persisted compatibility rules MUST NOT be rewritten or broadened

## Acceptance Criteria

- Tests prove operation and nested evidence rejection occurs before reducer or store mutation.
- Tests prove validator requests are native-derived and response tampering cannot widen scope.
- Tests prove compatible compact-v2 flow, incompatible runtime failure, and graph-v1 read-only compatibility.
- One facade-to-store integration test covers start, finalize, bounded correction handoff, targeted validation, and terminal reporting.
