# Delta for Review Transaction

## ADDED Requirements

### Requirement: Legacy and native authority compatibility

Existing Pi compact-v2 and graph-v1 ordinary authority MUST remain readable, receipt-compatible, gate-compatible, and exportable where previously supported, but MUST reject ordinary lifecycle mutation. Judgment Day MUST remain graph-v1 and retain its existing explicit mutation workflow. Pi MUST not migrate, translate, repair, or fabricate legacy authority.

#### Scenario: Legacy compact policy hash remains compatible

- GIVEN an existing legacy compact-v2 route that accepts Pi `policyHash`
- WHEN that route processes its established operation
- THEN it MAY retain its existing `policyHash` behavior, but that legacy behavior MUST NOT be reused by or silently applied to the native `START` route

#### Scenario: Existing legacy authority read and gate

- GIVEN an existing compact-v2 or graph-v1 ordinary lineage with a valid receipt
- WHEN Pi reads status or validates a compatible gate
- THEN it MUST preserve the existing read/gate-compatible behavior without rewriting the authority

#### Scenario: Legacy mutation rejection

- GIVEN an existing compact-v2 or graph-v1 ordinary lineage
- WHEN Pi receives an ordinary mutation request
- THEN it MUST return a typed rejection and MUST not mutate or convert the lineage

#### Scenario: Judgment Day compatibility

- GIVEN an explicit Judgment Day request for a graph-v1 lineage
- WHEN Pi executes the Judgment Day workflow
- THEN it MUST continue using graph-v1 authority and its existing mutation rules

### Requirement: Unsupported native status and complete inventory fail closed

Under gentle-ai 2.1.0, general native ordinary `STATUS` and any decision requiring complete inventory across native, compact-v2, and graph-v1 claimants MUST return the typed result `native-status-unsupported` and tell the operator that an upstream read-only native status/inventory contract is required. Pi MUST neither parse native authority or receipt files, invoke a mutating native command as a probe, infer native absence from Pi artifacts, choose a claimant, nor use legacy mutation fallback. Unsupported status MUST preserve all existing authority and create no binding, approval, receipt, lineage, or authorization.

#### Scenario: General native status unsupported

- GIVEN a request for ordinary native status without an exact bound OpenSpec SDD status context
- WHEN Pi handles the request under gentle-ai 2.1.0
- THEN it MUST return `native-status-unsupported` with follow-up-required evidence and MUST not mutate or claim readiness

#### Scenario: Complete mixed inventory unsupported

- GIVEN a request to prove the presence or absence of all native, compact-v2, and graph-v1 claimants
- WHEN no supported read-only native inventory contract is available
- THEN Pi MUST return `native-status-unsupported`, MUST identify the upstream contract requirement, and MUST not report a false clean or selected authority

#### Scenario: Unsupported status leaves state unchanged

- GIVEN unsupported native status or mixed inventory is requested
- WHEN the operation completes
- THEN no native process probe, native-file parse, legacy mutation, binding, approval, receipt creation, or lifecycle authorization MUST occur

#### Scenario: Future-compatible status extension

- GIVEN a future versioned gentle-ai release exposes validated read-only status and claimant inventory
- WHEN Pi receives a supported decoder for that contract
- THEN it MAY implement those operations, while gentle-ai 2.1.0 MUST continue returning `native-status-unsupported`

### Requirement: Exactly one native ordinary lifecycle

New ordinary Pi reviews MUST use native authority as the sole mutation authority. A native successful result MUST not be mirrored into Pi compact-v2 or graph-v1 storage, and a failed or ambiguous native operation MUST not trigger legacy mutation or a second review.

#### Scenario: New ordinary review

- GIVEN no existing legacy claimant and a compatible native binary
- WHEN Pi starts ordinary review
- THEN exactly one native lineage MUST be created or resumed and no competing Pi authority MUST be written

#### Scenario: Native failure does not fall back

- GIVEN native start, finalize, validation, or binding returns non-zero, malformed JSON, timeout, or process failure
- WHEN Pi handles the result
- THEN it MUST fail closed without creating fallback authority, approval, receipt, binding, or authorization

### Requirement: Native and legacy mode isolation

Mode/budget MUST remain immutable, counters MUST remain monotonic, and Judgment Day MUST remain unreachable from ordinary native or legacy mutation routing. Mixed authority and unsupported mode transitions MUST be typed rejections that preserve all existing authority.

#### Scenario: Cross-mode request

- GIVEN an ordinary lineage
- WHEN a Judgment Day operation is requested through ordinary routing
- THEN rejection MUST preserve state and counters

#### Scenario: Native/legacy cross-mode or cross-authority request

- GIVEN an ordinary request identifies incompatible authority modes
- WHEN the request is processed
- THEN it MUST fail closed without copying or changing any authority
