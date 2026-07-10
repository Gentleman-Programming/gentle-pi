# Delta for Review Transaction

## MODIFIED Requirements

### Requirement: Complete immutable snapshot

`SnapshotV1` MUST persist `base_tree`, full `complete_snapshot_tree`, exact `review_projection` (`complete` or resolved `intended-commit`), `initial_review_tree`, immutable canonical genesis paths, route, ordered lenses, and policy hash without index/worktree mutation. The genesis paths MUST be bound to snapshot identity and MUST NOT expand. Unsupported projections fail closed.
(Previously: snapshot identity did not bind an immutable canonical genesis path set.)

#### Scenario: Mixed working state

- GIVEN supported changes and ignored paths
- WHEN a transaction snapshot is created
- THEN complete content, projected review tree, and canonical genesis paths MUST be exact while the real index remains unchanged

### Requirement: One-shot ordinary transaction

Ordinary MUST run selected 0/1/4 lenses in one discovery operation, controller-check deterministic evidence, permit one inferential refuter batch, freeze only accepted blocking finding IDs, and escalate insufficient evidence. It MAY permit at most one correction batch, which MUST address exactly the frozen accepted blocking IDs and touch only immutable genesis paths.
(Previously: ordinary bounded review/refutation/fix batches without genesis-path and exact frozen-ID correction binding.)

#### Scenario: Bounded ordinary work

- GIVEN any finding count
- WHEN ordinary runs
- THEN discovery occurs once and refuter and correction batches are at most one each

#### Scenario: Out-of-scope correction

- GIVEN frozen accepted blocking IDs and canonical genesis paths
- WHEN a correction omits or adds an ID, or touches a non-genesis path
- THEN the transaction MUST reject it before append and preserve authority

### Requirement: Terminal scoped validation

The authoritative ledger MUST retain immutable canonical ID-sorted identity/claim/evidence rows bound by its hash. After the one correction, one validator MUST consume proof that the original acceptance tests pass and exact per-frozen-ID correction regression proof for every frozen accepted blocking ID. Ordinary validation MUST be non-discovery: it MAY verify only that proof and original-criterion regressions; it MUST NOT review fix-touched lines, inspect the correction diff for new findings, run scoped re-review, alter claims, add blocking work, launch actors, or repeat. A detected original-criterion regression MUST reject, revert, or escalate. No-correction runs no validator; both paths run one final verification to `approved | escalated`.
(Previously: ordinary validation could examine correction lines/diff while validating frozen IDs.)

#### Scenario: Fixed candidate

- GIVEN one correction exactly bound to frozen IDs and genesis paths
- WHEN targeted validation advances
- THEN one validator and one final verification MUST consume original acceptance-test proof and exact per-frozen-ID correction regression proof without new discovery or fix-line review

#### Scenario: Unfixed or failed candidate

- GIVEN no correction, failed validation/verification, or an original-criterion regression
- WHEN reduced
- THEN no-correction uses zero validators and failure MUST reject, revert, or escalate

## Acceptance Criteria

- Automated tests MUST prove immutable genesis paths, one discovery, exact frozen-ID/path correction binding, and targeted validation evidence.
- Automated tests MUST prove original-criterion regression cannot approve and existing retry, resume, receipt, gate, bundle, graph-v1, and Judgment Day behavior remains compatible.
