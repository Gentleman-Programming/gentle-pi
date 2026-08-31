# Apply Progress: Complete Native Review Lifecycle

**Mode**: Strict TDD
**Delivery**: `exception-ok` / accepted `size:exception`
**Completed**: Tasks 1.1–3.3

## Implementation Summary

- Removed the discarded `ordinary-follow-up` graph transition, reducer input, reducer branch, and top-level state collection.
- Kept ordinary late observations only as ID-sorted, action-free `validation_evidence.follow_ups` records.
- Replaced ordinary fix-line validation with a proof-only request: frozen rows plus original acceptance proof, exactly one passed regression proof per frozen ID, original-criterion regressions, and inert follow-ups. Internal `fix_record` retains the Git-derived diff/candidate binding.
- Updated the validator, canonical contract, delegation guide, harness skill, and README while retaining Judgment Day's separate fix-diff scoped re-judgment language.
- Preserved graph/CAS, retry/resume, receipts/gates, bundles, routing, and the live v0.13/v0.14 forced-sync migration fixtures.

## TDD Cycle Evidence

| Task | Test file / layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 1.1 | `tests/review-{graph-schema,transaction}.test.ts` / unit | 31 focused tests passing | Replaced transition acceptance with rejection and inert-evidence cases; 2 failures | 15/15 focused tests passing | Rejected transition and two sorted follow-ups | Removed discarded transition behavior |
| 1.2 | `tests/review-{graph-schema,transaction}.test.ts` / unit | 15/15 | Existing RED from 1.1 | 15/15 focused tests passing | Schema rejection plus state-inert evidence | Removed schema/reducer/top-level state branch |
| 1.3 | Focused lifecycle suites / unit | 15/15 | Obsolete additive transition assertions removed | 45/45 focused tests passing | N/A: removal-only cleanup | No compatibility adapter retained |
| 2.1 | `tests/review-{snapshot,policy-ordinary,transaction,controller}.test.ts` / unit | Focused suites passing | Genesis/correction scope and proof-boundary cases added before final policy shape | 45/45 focused tests passing | Nested-root capture, documentation-like paths, out-of-scope correction, and exact IDs | Kept historical optional-on-read fields only |
| 2.2 | `tests/review-policy-ordinary.test.ts`, `tests/review-controller.test.ts` / unit | 45/45 | Request tests asserted absent diff/candidate fields and embedded proof | 45/45 focused tests passing | Valid, malformed, changed request, and controller-file inputs | Centralized proof normalization in ordinary policy |
| 2.3 | `tests/review-policy-ordinary.test.ts` / unit | 45/45 | Failed acceptance, regression, duplicate/missing proof paths covered | 45/45 focused tests passing | Fixed vs no-fix, missing/duplicate/failed per-ID proof, and original-criterion escalation | Preserved one-validator/one-final-verification counters |
| 3.1 | `tests/review-ledger-contract.test.ts` / contract | Contract baseline passing | Added five-surface positive/negative drift guards; 4 failures | Contract checks pass in 45/45 focused suite | Ordinary negative clauses and Judgment Day positive clauses | Kept Judgment Day clauses isolated |
| 3.2 | `tests/review-ledger-contract.test.ts` / contract | Contract RED captured | 4 contract failures | 45/45 focused tests passing | All five ordinary surfaces plus separate Judgment Day judge checks | Replaced ordinary wording without changing Judgment Day |
| 3.3 | Full unit + harness / regression | Focused suites and harness passing | N/A: regression measurement task | `pnpm test`: 424/424 passing | Unit, graph/CAS, bundles, gates, routing, Judgment Day, forced-sync fixtures | No unrelated fixtures removed |

## Work Unit Evidence

| Unit | Focused test command and result | Runtime harness | Rollback boundary |
|---|---|---|---|
| 1 — Inert evidence | `node --experimental-strip-types --test tests/review-graph-schema.test.ts tests/review-transaction.test.ts` — 15/15 passing | N/A: graph/policy/store unit boundary has no Pi runtime path | `lib/review-graph-schema.ts`, `lib/review-transaction.ts`, paired tests |
| 2 — Targeted proof and contracts | `node --experimental-strip-types --test tests/review-controller.test.ts tests/review-policy-ordinary.test.ts tests/review-transaction.test.ts tests/review-graph-schema.test.ts tests/review-ledger-contract.test.ts` — 45/45 passing | `pnpm run test:harness` — passed | `lib/review-{snapshot,policy-ordinary,transaction}.ts`, `extensions/gentle-ai.ts`, ordinary contract surfaces, paired tests |

## Final Regression and Measurement

- `pnpm test` — passed: 424/424 tests; runtime harness passed at the original implementation measurement.
- `git diff --check` — passed with no whitespace errors.
- `git diff --numstat` — 480 additions, 35 deletions across tracked implementation files at measurement time (515 authored changed lines; accepted `size:exception`).
- Explicit cleanup: removed the ordinary follow-up schema/reducer/top-level-state path and its acceptance assertion; replaced ordinary fix-diff/fix-line/re-review wording with targeted proof consumption. Judgment Day fix-diff scoped re-judgment and v0.13/v0.14 forced-sync fixtures remain unchanged.

## Deviations

None — implementation matches the revised proposal, delta specs, and design.

## Authorized Correction Batch

**Authority**: focused remediation; one `exception-ok` / `size:exception` batch only
**Failed evidence revision**: `sha256:dd40551aac887c9e36fb3285b04563455ccdfa46560186340bf20579005c8d24`
**Frozen correction IDs**: `VER-001`, `VER-002`, `VER-003`, `VER-004`

- `VER-001`: `normalizeFollowUps` now rejects every non-inert/unknown field before normalization. RED coverage proves rejection of requested-path, correction-ID, and action keys, while accepted follow-ups remain ID-sorted inert records.
- `VER-002`: Added independent omitted-ID and extra-ID correction tests using only in-genesis paths, so path validation cannot short-circuit frozen-ID validation.
- `VER-003`: Added missing, duplicate, and failed per-ID correction-regression-proof tests. The prior broad Git-root/state triangulation claim is narrowed to the permutations actually asserted; the mixed staged/unstaged intended-commit scenario is now explicitly covered below.
- `VER-004`: The existing staged/unstaged intended-commit snapshot test now asserts its canonical genesis path (`tracked.txt`) while retaining the pre-existing complete-snapshot and index-preservation assertions.

### TDD Cycle Evidence — Correction Batch

| Correction | Test file / layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| VER-001 | `tests/review-policy-ordinary.test.ts` / unit | 16/16 focused baseline | `node --experimental-strip-types --test tests/review-policy-ordinary.test.ts` — 11/12 passed; new action-bearing rejection test failed as expected | `node --experimental-strip-types --test tests/review-policy-ordinary.test.ts tests/review-snapshot.test.ts` — 19/19 passed | Requested-path, correction-ID, action-key rejection; two accepted sorted inert records | Added pre-normalization runtime key guard only |
| VER-002 | `tests/review-policy-ordinary.test.ts` / unit | 16/16 focused baseline | New independent omitted-ID and extra-ID assertions added before focused execution | 19/19 focused tests passed | Omitted and extra IDs use valid genesis paths | None needed |
| VER-003 | `tests/review-policy-ordinary.test.ts` / unit | 16/16 focused baseline | New missing, duplicate, and failed proof assertions added before focused execution | 19/19 focused tests passed | Three distinct exact-proof failures | None needed |
| VER-004 | `tests/review-snapshot.test.ts` / unit | 16/16 focused baseline | Added canonical genesis assertion to the existing staged/unstaged intended-commit scenario | 19/19 focused tests passed | Complete snapshot retains later scope while canonical genesis remains the intended tracked path | None needed |

### Work Unit Evidence — Correction Batch

| Evidence | Exact result |
|---|---|
| Focused RED | `node --experimental-strip-types --test tests/review-policy-ordinary.test.ts` — exit 1, 11/12 passed, one expected missing action-bearing-field rejection |
| Focused GREEN | `node --experimental-strip-types --test tests/review-policy-ordinary.test.ts tests/review-snapshot.test.ts` — exit 0, 19/19 passed |
| Runtime harness | N/A for the focused correction: no controller/runtime boundary changed. `pnpm test` includes `pnpm run test:harness` and passed. |
| Full regression | `pnpm test` — exit 0, 427/427 unit/contract tests passed; runtime harness passed |
| Rollback boundary | `lib/review-policy-ordinary.ts`, `tests/review-policy-ordinary.test.ts`, `tests/review-snapshot.test.ts`, and this correction-batch evidence |

```json
{"schema":"gentle-ai.remediation-result/v1","lineage_id":"complete-native-review-lifecycle","generation":1,"mode":"openspec","fix_batch":["VER-001","VER-002","VER-003","VER-004"],"failed_evidence_revision":"sha256:dd40551aac887c9e36fb3285b04563455ccdfa46560186340bf20579005c8d24","status":"success"}
```
```json
{"schema":"gentle-ai.remediation-evidence/v1","lineage_id":"complete-native-review-lifecycle","generation":1,"mode":"openspec","fix_batch":["VER-001","VER-002","VER-003","VER-004"],"failed_evidence_revision":"sha256:dd40551aac887c9e36fb3285b04563455ccdfa46560186340bf20579005c8d24","red_command":"node --experimental-strip-types --test tests/review-policy-ordinary.test.ts","red_result":"exit 1; 11/12 passed; expected action-bearing follow-up rejection failure","focused_green_command":"node --experimental-strip-types --test tests/review-policy-ordinary.test.ts tests/review-snapshot.test.ts","focused_green_result":"exit 0; 19/19 passed","full_command":"pnpm test","full_result":"exit 0; 427/427 passed; runtime harness passed"}
```
