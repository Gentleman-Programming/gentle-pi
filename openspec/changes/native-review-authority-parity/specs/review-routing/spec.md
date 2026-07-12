# Delta for Review Routing

## ADDED Requirements

### Requirement: Supported native lifecycle adapter

New ordinary Pi `START`, `FINALIZE`, and `VALIDATE` operations, plus native `bind-sdd` and bound-change SDD status, MUST invoke the installed gentle-ai 2.1.0 contract through strict argument arrays, an explicit working directory, and operation-specific typed inputs. The adapter MUST validate successful JSON against operation-specific schemas before mapping it to the existing Pi envelopes. It MUST NOT interpolate shell text, read or interpret native authority files, or implement unsupported status through mutation or legacy fallback.

#### Scenario: Successful supported delegation

- GIVEN a compatible gentle-ai 2.1.0 binary and valid typed inputs
- WHEN Pi performs `START`, `FINALIZE`, `VALIDATE`, `bind-sdd`, or exact bound-change SDD status
- THEN it MUST invoke only the corresponding supported native operation and map only schema-valid fields into the existing envelope

#### Scenario: Bind request preconditions

- GIVEN canonical cwd, change, lineage, or expected binding revision is malformed or mismatched
- WHEN Pi prepares a `bind-sdd` request
- THEN it MUST reject the request before any native call

#### Scenario: Bind result identity validation

- GIVEN `bind-sdd` exits zero
- WHEN Pi decodes its result
- THEN it MUST strictly validate result schema and identity consistency, treating repository, authority, receipt, and path identities as native-owned result evidence

#### Scenario: Ambiguous bind result

- GIVEN a zero-exit bind result is malformed or has inconsistent echoed identities
- WHEN Pi handles the result
- THEN it MUST block authorization and readiness, preserve the committed-or-ambiguous outcome, avoid automatic semantic retry, and require exact replay or supported recovery

#### Scenario: Ordinary native status is unsupported

- GIVEN Pi requests general ordinary native `STATUS`
- WHEN gentle-ai 2.1.0 provides no read-only ordinary status contract
- THEN Pi MUST return the typed fail-closed result `native-status-unsupported`, MUST state that an upstream read-only native status contract is required, and MUST make no native process call, authority-file read, binding, approval, receipt, or authorization

#### Scenario: Complete mixed inventory is unsupported

- GIVEN a decision requires complete claimant inventory across native, compact-v2, and graph-v1 authority
- WHEN Pi cannot obtain a complete read-only native inventory
- THEN Pi MUST return `native-status-unsupported` rather than claim absence, cleanliness, or a selected winner, and MUST perform no mutation or fallback

#### Scenario: Unsupported status is non-mutating

- GIVEN ordinary native status or complete mixed inventory is unsupported
- WHEN Pi handles the request
- THEN it MUST not invoke `start`, `finalize`, or another mutating command as a probe, MUST not parse native authority files, and MUST not mutate a legacy store

#### Scenario: Future native extension

- GIVEN a future gentle-ai release provides a versioned, read-only, machine-readable status and claimant-inventory contract
- WHEN Pi adds a compatible adapter decoder
- THEN it MAY replace `native-status-unsupported` only after explicit versioned schema validation; the current 2.1.0 path MUST remain fail closed

#### Scenario: Non-zero or malformed native result

- GIVEN a supported native process exits non-zero or returns malformed, incomplete, or incompatible JSON
- WHEN Pi handles the operation
- THEN it MUST return a typed blocked/error result and MUST NOT authorize, mutate, bind, or infer success

#### Scenario: Process unavailable, timeout, or execution failure

- GIVEN the binary is missing, non-executable, incompatible, times out, or cannot be started
- WHEN Pi requests a supported native mutation or validation
- THEN the operation MUST fail closed without legacy mutation, authority copying, binding, or one-shot authorization

#### Scenario: Ambiguous completed process

- GIVEN a supported native mutation may have committed but its output is lost or ambiguous
- WHEN Pi recovers the operation
- THEN it MUST replay the exact operation or use an explicit supported native recovery path and MUST NOT start a duplicate lineage

### Requirement: Native START policy binding

Native ordinary `START` MUST use the native bounded policy when no policy file is explicitly provided. A custom policy MAY be supplied only as `policyPath`, which MUST be a canonical existing safe file path explicitly validated before the native call and passed to `gentle-ai review start` as the single value following `--policy`. The native result MUST remain authoritative for the actual policy binding. Pi MUST NOT interpolate shell text or map the legacy Pi `policyHash` field to `--policy`.

#### Scenario: Native START uses the bounded default policy

- GIVEN a new ordinary native `START` request with no explicit `policyPath` and no legacy policy mapping
- WHEN Pi invokes `gentle-ai review start`
- THEN it MUST omit `--policy`, allowing native `START` to bind its native bounded default policy, and MUST preserve the policy binding reported by the native result

#### Scenario: Native START accepts a safe custom policy path

- GIVEN `policyPath` is explicitly supplied as a canonical existing regular file within the permitted repository-safe policy location
- WHEN Pi prepares native `START`
- THEN it MUST pass `--policy` and the complete `policyPath` as one argument-array value, without shell interpolation, and MUST let native `START` own the resulting policy binding

#### Scenario: Legacy policy hash is rejected on the native route

- GIVEN a native ordinary `START` request supplies legacy Pi `policyHash` without a separately supported policy-path mapping
- WHEN Pi resolves the native route
- THEN it MUST return a typed malformed or unsupported rejection before the native process call and MUST never pass the hash as a path or silently ignore it

#### Scenario: Missing, outside, or symlinked policy path fails closed

- GIVEN an explicitly supplied `policyPath` is missing, non-regular, outside the permitted safe location, or resolves through a symlink
- WHEN Pi prepares native `START`
- THEN it MUST reject the request before the native process call and MUST create no native lineage, fallback authority, approval, receipt, binding, or authorization

#### Scenario: Native policy result is authoritative

- GIVEN native `START` returns a schema-valid result with its policy binding
- WHEN Pi maps the result
- THEN Pi MUST expose only the decoded native policy evidence and MUST NOT reconstruct, substitute, or compare it against a Pi-side policy hash

### Requirement: Native validation controls lifecycle authorization

Pi MUST register its exact one-shot lifecycle command authorization only after schema-valid native validation allows the exact gate and typed target. Bash-time execution MUST reload and rederive the target and receipt evidence; mismatch, replay, stale evidence, or changed target MUST fail closed.

#### Scenario: Exact one-shot authorization

- GIVEN native validation allows an exact gate and target
- WHEN Pi registers and executes the lifecycle command
- THEN exactly one typed authorization MUST be registered and execution MUST revalidate the same target and receipt evidence

#### Scenario: Successful child process is insufficient

- GIVEN a child process exits successfully or actor output maps successfully
- WHEN native validation has not returned an allow result
- THEN Pi MUST NOT register lifecycle authorization

#### Scenario: Cross-worktree or current-candidate mismatch

- GIVEN validation evidence belongs to another worktree or a different current candidate
- WHEN Pi rederives the execution target
- THEN execution MUST fail closed

### Requirement: Native receipt gate composition

All lifecycle gates MUST use typed exact targets and native receipt validation, with zero actors. Pi MUST preserve the existing public envelopes while treating native authority and native errors as authoritative; it MUST not reconstruct native state from Pi-side artifacts.

#### Scenario: Same-lineage gate

- GIVEN a schema-valid native approval and matching receipt/target
- WHEN the requested gate is validated
- THEN Pi MUST allow through the existing envelope with zero actors

#### Scenario: Changed scope

- GIVEN the live target differs from the native receipt or authority revision
- WHEN the gate is validated
- THEN Pi MUST return a blocked scope-change result
