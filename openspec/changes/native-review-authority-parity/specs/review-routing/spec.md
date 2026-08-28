# Delta for Review Routing

## ADDED Requirements

### Requirement: Supported native lifecycle adapter

New ordinary Pi `START`, `FINALIZE`, and `VALIDATE` operations, plus native `bind-sdd`, bound-change SDD status, and read-only ordinary `STATUS`, MUST invoke the installed gentle-ai contract through strict argument arrays, an explicit working directory, and operation-specific typed inputs. The adapter MUST validate successful JSON against operation-specific schemas before mapping it to the existing Pi envelopes. It MUST NOT interpolate shell text, read or interpret native authority files, or implement status through mutation or legacy fallback.

#### Scenario: Successful supported delegation

- GIVEN a compatible gentle-ai 2.1.0 binary and valid typed inputs
- WHEN Pi performs `START`, `FINALIZE`, `VALIDATE`, read-only `STATUS`, `bind-sdd`, or exact bound-change SDD status
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
- THEN it MUST block binding readiness, preserve the committed-or-ambiguous outcome, avoid automatic semantic retry, and require exact replay or supported recovery

#### Scenario: Ordinary native STATUS is read-only

- GIVEN Pi requests general ordinary native `STATUS`
- WHEN gentle-ai returns a schema-valid read-only ordinary status result
- THEN Pi MUST relay that result without creating a lineage, binding, approval, receipt, or delivery authorization

#### Scenario: Complete mixed inventory is read-only

- GIVEN a decision requires complete claimant inventory across native, compact-v2, and graph-v1 authority
- WHEN native STATUS returns claimant evidence or a typed error
- THEN Pi MUST relay that evidence or error without claiming absence, cleanliness, or a selected winner through local inference

#### Scenario: STATUS is non-mutating

- GIVEN ordinary native STATUS or complete mixed inventory is requested
- WHEN Pi handles the request
- THEN it MUST not invoke `start`, `finalize`, or another mutating command as a probe, MUST not parse native authority files, and MUST not mutate a legacy store

#### Scenario: Non-zero or malformed native result

- GIVEN a supported native process exits non-zero or returns malformed, incomplete, or incompatible JSON
- WHEN Pi handles the operation
- THEN it MUST return a typed blocked/error result and MUST NOT mutate, bind, infer, or represent successful review evidence

#### Scenario: Process unavailable, timeout, or execution failure

- GIVEN the binary is missing, non-executable, incompatible, times out, or cannot be started
- WHEN Pi requests a supported native mutation or validation
- THEN the operation MUST fail closed without legacy mutation, authority copying, binding, or delivery authorization

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
- THEN it MUST reject the request before the native process call and MUST create no native lineage, fallback authority, approval, receipt, binding, or delivery authorization

#### Scenario: Native policy result is authoritative

- GIVEN native `START` returns a schema-valid result with its policy binding
- WHEN Pi maps the result
- THEN Pi MUST expose only the decoded native policy evidence and MUST NOT reconstruct, substitute, or compare it against a Pi-side policy hash

### Requirement: Native validation provides review evidence only

Pi MUST relay schema-valid native validation evidence for the exact review target. Pi MUST NOT register, infer, or mint lifecycle delivery authorization from that evidence. Commit, push, PR, and release decisions always follow ordinary repository policy.

#### Scenario: Exact review evidence

- GIVEN native validation returns evidence for an exact review target
- WHEN Pi maps the result
- THEN Pi MUST preserve that review evidence without creating delivery authorization

#### Scenario: Successful child process is insufficient

- GIVEN a child process exits successfully or actor output maps successfully
- WHEN native validation has not returned an allow result
- THEN Pi MUST NOT represent the outcome as native review evidence

#### Scenario: Cross-worktree or current-candidate mismatch

- GIVEN validation evidence belongs to another worktree or a different current candidate
- WHEN Pi rederives the review target
- THEN Pi MUST relay a review mismatch without changing ordinary delivery policy

### Requirement: Native review evidence relay uses exact targets

Pi MUST preserve existing public review envelopes while treating native review evidence and native errors as authoritative for review only. Pi MUST not reconstruct native state from Pi-side artifacts, and it MUST never mint delivery authorization. Ordinary delivery always follows repository policy.

#### Scenario: Same-lineage review evidence

- GIVEN schema-valid native approval and a matching receipt/target
- WHEN Pi relays the review result
- THEN Pi MUST expose the review evidence with zero actors and no delivery authorization

#### Scenario: Changed scope

- GIVEN the live target differs from the native receipt or authority revision
- WHEN Pi relays the review result
- THEN Pi MUST return a review scope-change result without governing ordinary delivery
