# Apply Progress: Simplify 4R into a Bounded Review Transaction

## Status

- Mode: Strict TDD
- Delivery strategy: `exception-ok`
- Chain strategy: `size-exception`
- Maintainer exception: approved `size:exception`
- Tasks: 21/21 complete
- Judgment Day APPLY Round 2: final scoped re-judgment approved before verification remediation; no new review/Judgment Day run
- Verification remediation: all five CRITICAL blockers fixed under Strict TDD
- Delivery/publication: not performed
- Version mutation: none (`package.json` remains `0.14.0`)

## Completed Work

1. Captured complete tracked and non-ignored untracked state through a temporary Git index without changing the real index or worktree; bound complete and intended-commit projections.
2. Added canonical V1 state, frozen-ledger, receipt, budget, counter, journal, child-claim, and gate schemas with private atomic Git-directory storage.
3. Added disjoint ordinary and Judgment Day reducers with structural ceilings and terminal verification.
4. Replaced lifecycle diff advice with start-only routing and exact receipt-only typed gates; dangerous-command safety remains independent.
5. Replaced obsolete actor/orchestrator/skill/docs contracts, added a scoped validator, and added hash-proven v0.14 managed-asset migration.
6. Applied JD-APP-001..010 corrective fixes: runtime receipt bridge and shell fail-closed detection, reducer-bound persistence, real Git target resolution, durable isolated root snapshots, fail-closed row normalization, no-fix terminality, snapshot-derived routing, completable journal/atomic child claims, scoped Judgment Day re-judgment contracts, and removal of stale lifecycle/post-SDD directives.
7. Applied the final Round 2 corrections only for JD-APP-001, JD-APP-003, and JD-APP-010: unbounded linear lifecycle detection, exact destination-ref create/update semantics, and receipt-only README lifecycle guidance.
8. Remediated the five final verification blockers only: explicit mode-bound non-trivial Judgment Day snapshots, actual-index pre-commit binding, exact remote push destination resolution, journaled replay-stable lineage start, and Judgment Day skill metadata restored from `1.5` to `1.4`.

## TDD Cycle Evidence

| Task | Test file / gate | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/review-snapshot.test.ts` | Integration | Existing focused baseline 137/137 | Missing `lib/review-snapshot.ts` failed | 3/3 pass | Complete vs intended projection; ignored/untracked and unresolved cases | Temp-index helper and immutable result naming; 3/3 pass |
| 1.2 | `tests/review-snapshot.test.ts` | Integration | 137/137 | Snapshot API absent | 3/3 pass | Real-index bytes and worktree status checked across projections | Focused suite green |
| 2.1 | `tests/review-transaction.test.ts` | Unit/integration | 137/137 | Missing `lib/review-transaction.ts` failed | 8/8 pass | Replay/restart, pending, tamper, lock, write fault, Git-dir modes, child replay | Canonical helpers and atomic-write seams; 8/8 pass |
| 2.2 | `tests/review-transaction.test.ts` | Unit/integration | 137/137 | V1 schemas/store absent | 8/8 pass | Receipt projection and state/HEAD hashes independently changed | Focused suite green |
| 2.3 | `tests/review-transaction.test.ts` | Integration | 137/137 | Injected pre-HEAD fault had no implementation | 8/8 pass | Lock plus fsync-adjacent fault; prior revision and integrity mismatch paths | Orphan cleanup and durable file helpers; 8/8 pass |
| 3.1 | `tests/review-policy-ordinary.test.ts` | Unit | Store tests green | Missing ordinary reducer failed | 6/6 pass | 0/1/4 routes, fix/no-fix, invalid output, regression, terminal failure | Pure reducer helpers; 6/6 pass |
| 3.2 | `tests/review-policy-ordinary.test.ts` | Unit | Store tests green | Ordinary transitions absent | 6/6 pass | Second refuter/fix/validator/final edges rejected | Claims immutable and resolutions separated; combined reducer/store 14/14 pass |
| 4.1 | `tests/review-policy-judgment-day.test.ts` | Unit | Ordinary/store tests green | Missing Judgment Day reducer failed | 5/5 pass | Clean, two-round approval, round-two survivor, wrong mode | Focused suite green |
| 4.2 | `tests/review-policy-judgment-day.test.ts` | Unit | Ordinary/store tests green | Judgment Day transitions absent | 5/5 pass | Two fixes/two re-judgments and no-third-round edge | Disjoint phase helpers; combined policy/store 19/19 pass |
| 5.1 | `tests/review-{triggers,gate}.test.ts`, `tests/gentle-ai.test.ts` | Unit/integration | 137/137 | Missing gate exports plus five lifecycle classification failures | 40/40 pass | Exact commit/push/PR/release, scope change, unresolved/delete/ordering, replay, safety precedence | Removed ambient diff advice and dead collection path; 40/40 pass |
| 5.2 | Same as 5.1 | Unit/integration | 137/137 | Start-only and typed controller behavior absent | 40/40 pass | Stable push updates and parent-target child replay with changed budget | Const-tagged unions and shared gate result path; 40/40 pass |
| 6.1 | Contract/package/preflight tests and runtime harness | Contract/integration | 137/137 | 18 expected contract/migration failures | 85/85 pass; runtime harness pass | Ownership, routing preservation, user override, no delivery, exact actor authority | Contract matrix simplified; gates remain green |
| 6.2 | `tests/review-ledger-contract.test.ts`, `tests/package-manifest.test.ts` | Contract | 137/137 | Old sweeps/refuters/shared iteration still present | Contract/package focused gates pass | Lens, refuter, validator, fix, judge, orchestrator, skill, chain, README parity | Obsolete clauses removed; focused suite green |
| 6.3 | `tests/sdd-preflight.test.ts`, package verifier | Integration | Existing migration tests green | v0.14 evidence/fixture missing | Migration tests pass; 49-file verifier pass | Untouched v0.13/v0.14, routing preservation, edited override preservation | Multi-version legacy hash sets; focused suite green |
| 7.1 | Focused review, full test, package gates | Verification | All work-unit tests green | Earlier RED evidence retained above | 67/67 focused; 331/331 full Node tests; runtime harness and 49-file verifier pass | Focused then broad gates | No post-gate code change |
| 7.2 | Scenario/JD trace below | Verification | All gates green | Each invariant had a prior focused RED path | Every scenario and JD-DES-001..007 mapped to passing evidence | Negative/forbidden paths included | No delivery/version mutation confirmed |
| 8.1 | `tests/review-snapshot.test.ts` | Real Git integration | Verification-remediation baseline 43/43 | Real non-trivial snapshot remained `standard`; Judgment Day creation rejected it | Explicit `judgment-day` capture skips ordinary classification and starts successfully; focused green | Ordinary non-trivial capture still classifies; mode mismatch remains fail closed | Shared const-derived review mode across snapshot and transaction; focused green |
| 8.2 | `tests/review-gate.test.ts` | Real Git integration | Verification-remediation baseline 43/43 | Approved tree returned `allow` after the index staged a different tree | Gate compares the supplied target with `git write-tree`; focused green | Matching staged tree allows; drifted staged tree denies | Exact staged-tree check stays inside intended-commit inspection; focused green |
| 8.3 | `tests/review-gate.test.ts` | Real Git/remote integration | Verification-remediation baseline 43/43 | Normal `refs/heads/main -> refs/heads/main` update denied against the local source ref | Remote destination lookup allows exact-old same-name update and absent-old create; focused green | Drifted old, create-over-existing, missing remote, reversed order, and bad new identity deny | Replaced local destination lookup with one exact remote-ref resolver; focused green |
| 8.4 | `tests/review-transaction.test.ts`, dependent runtime/gate fixtures | Filesystem/restart integration | Verification-remediation baseline 43/43 | Start returned an unjournaled state; restart replay threw lineage-already-exists | Revision 0 contains completed `start` request/result evidence and exact restart replay returns it; focused green | Changed request under the same key and another key for the lineage reject; later/pending journals remain stable | Added a flat canonical start result and reused authoritative locking/revision publication; focused green |
| 8.5 | `tests/package-manifest.test.ts` | Contract/package | Verification-remediation baseline 43/43 | Contract asserted `1.4` and observed forbidden `1.5` | Skill metadata restored to `1.4`; focused green | Package remains `0.14.0`; package and diff-hygiene gates pass | No migration/version contract changed |

## Test Summary

- Initial apply focused gate: `node --experimental-strip-types --test tests/review-*.test.ts` — 67/67 passed.
- Latest remediation focused gate: all review/runtime files — 83/83 passed; five affected files — 54/54 passed.
- Current required runner: `pnpm test` — 341/341 Node tests passed; runtime harness passed.
- Package gate: `node scripts/verify-package-files.mjs` — 49 required files passed.
- Test cases: 43 new standalone/dynamic behavior tests plus rewritten contract and lifecycle matrices.
- Layers: unit, Git/filesystem integration, package/runtime integration; no E2E layer configured.
- Approval safety net: 137/137 pre-existing focused tests before modifications.
- Quality commands: no separate lint, formatter, typecheck, build, or coverage command is configured.

## Judgment Day APPLY Round 1 — TDD Cycle Evidence

Safety net before corrective production edits: `node --experimental-strip-types --test tests/review-*.test.ts tests/gentle-ai.test.ts` — 74/74 passed.

| Finding | Test file / layer | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| JD-APP-001 | `tests/gentle-ai.test.ts`, `tests/review-gate.test.ts` / runtime integration | Receipt-backed allow plus compound/wrapper cases written before runtime bridge; corrective suite failed | Direct approved receipt allows; raw/compound/wrapper forms block | Direct, missing receipt, `&&`, `env`, `command`, `sh -c`, and dangerous-safety precedence | Shared lifecycle inspection and gate adapter; focused green |
| JD-APP-002 | `tests/review-transaction.test.ts` / unit-integration | Reducer transition API and absence of generic mutation written before implementation; missing export failed | Only exact reducer transitions persist; generic method absent | Replay, pending completion, terminal state, and lock/fault paths | Private completed-operation primitive behind reducer/gate APIs |
| JD-APP-003 | `tests/review-gate.test.ts` / real Git integration | Real ref/object/peel/tree fixtures written before repository resolver | Commit, push, PR, and release relationships allow only when exact | Nonexistent object, mismatched commit/tree, deletion, unstable order, and changed scope | Shared Git relationship helpers |
| JD-APP-004 | `tests/review-snapshot.test.ts` / real Git integration | Repository-root, isolated-object, GC, and cleanup tests failed on missing snapshot exports | Nested-cwd complete capture survives live GC outside live objects | Complete/intended projections, ignored/untracked paths, GC, and terminal cleanup | Durable snapshot metadata/object-store interface |
| JD-APP-005 | `tests/review-{transaction,policy-ordinary}.test.ts` / unit | Malformed severe/info and unselected-lens cases written before normalization/enforcement | Severe rows normalize open/inferential and unselected lenses reject | Severe vs warning semantics and zero/one/four-lens routes | Central canonical row normalization |
| JD-APP-006 | `tests/review-policy-ordinary.test.ts` / unit | Explicit no-fix and zero-budget scenarios failed on missing transition export | Both paths reach one final verification and terminal escalation | Maintainer decline and immutable zero-fix budget | Shared escalation-reason transition |
| JD-APP-007 | `tests/review-snapshot.test.ts`, `tests/review-transaction.test.ts` / integration | Caller-route override case written before derived evidence binding | Snapshot derives route/lenses; state creation verifies/consumes it | Nested root, executable standard route, and caller override attempt | One route derivation point in snapshot capture |
| JD-APP-008 | `tests/review-{transaction,gate}.test.ts` / filesystem fault integration | Pending completion and pre-HEAD child publication fault cases written before APIs | Completion/replay survives restart; claim and journal publish together | Restart, changed completion input replay, lock, and pre-rename fault | Child claims moved into authoritative parent revision |
| JD-APP-009 | `tests/review-ledger-contract.test.ts` / contract | Named judges/skill/prompt missing scoped mode clauses failed | Initial discovery and scoped re-judgment are explicit separate modes | Both judges, skill, Judge Prompt, and Scoped Re-Judgment Prompt | Shared exact contract clauses |
| JD-APP-010 | `tests/review-ledger-contract.test.ts`, `tests/orchestrator-budget.test.ts` / contract | Managed surfaces retained fresh lifecycle/post-SDD directives | Receipt-only zero-actor lifecycle and no post-SDD pass enforced | Orchestrator core/lazy, SDD workflow, worker, harness skill, README, release skill, historical disposition test | Historical fixture lines explicitly classified superseded |

Corrective verification:

- Focused: `node --experimental-strip-types --test tests/review-*.test.ts tests/gentle-ai.test.ts` — 80/80 passed.
- Full: `pnpm test` — 337/337 Node tests passed; runtime harness passed.
- Package: `node scripts/verify-package-files.mjs` — 49 files passed.
- Diff hygiene: `git diff --check` — passed.

## Judgment Day APPLY Round 2 — TDD Cycle Evidence

Safety net before Round 2 edits: `node --experimental-strip-types --test tests/gentle-ai.test.ts tests/review-gate.test.ts tests/review-ledger-contract.test.ts` — 28/28 passed.

| Finding | Test file / layer | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| JD-APP-001 | `tests/gentle-ai.test.ts` / runtime integration | Pre-implementation batch failed because backslash-newline lifecycle input returned no block; 8,192-character direct/wrapped cases were written in the same RED batch | Continuation and long direct/wrapped lifecycle forms block before execution | Compound, `env`, `command`, `sh -c`, continuation, long direct, and long wrapped forms | Replaced the 256-character regex window with one linear scan using constant token space |
| JD-APP-003 | `tests/review-gate.test.ts` / real Git integration | Drifted destination update returned `allow`; create-over-existing was written in the same RED batch | Exact-old update and absent-old create semantics pass | Existing exact update + absent create allow; drifted update + existing create deny | Centralized fail-closed destination-ref resolution |
| JD-APP-010 | `tests/review-ledger-contract.test.ts` / contract | Two README/managed-contract checks rejected the retained fresh-context lens instruction | Receipt-only zero-actor README wording passes | Managed union and README parity both reject the obsolete phrase | Added the semantic obsolete-contract fragment once |

Round 2 verification:

- Focused: `node --experimental-strip-types --test tests/review-*.test.ts tests/gentle-ai.test.ts` — 80/80 passed.
- Full: `pnpm test` — 337/337 Node tests passed; runtime harness passed.
- Package: `node scripts/verify-package-files.mjs` — 49 files passed.
- Diff hygiene: `git diff --check` — passed.
- Final scoped re-judgment was approved before this verification remediation; no commit, delivery, publication, or version mutation was performed.

## Verification Remediation — TDD Cycle Evidence

Safety net before remediation edits: `node --experimental-strip-types --test tests/review-snapshot.test.ts tests/review-transaction.test.ts tests/review-gate.test.ts tests/package-manifest.test.ts` — 43/43 passed.

The first remediation RED run reproduced all five CRITICAL findings: 47/54 passed and 7 failed, comprising the five new blocker probes plus two existing journal assertions that now required the start entry.

| Finding | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| CRITICAL-1 | Real non-trivial Judgment Day capture failed at state creation | Explicit mode-bound capture starts Judgment Day without ordinary classification | Ordinary capture still derives its route; mode mismatch rejects | Shared const-derived mode; focused 54/54 |
| CRITICAL-2 | Stale approved tree returned `allow` after staged-tree drift | Intended-commit inspection binds `git write-tree` | Matching index allows; drifted index denies | Kept staged-tree resolution in the exact target inspector; focused 54/54 |
| CRITICAL-3 | Same-name remote update returned `deny` | Exact remote destination old ref permits the normal update | Exact-old update and absent create allow; drift/create/order/remote failures deny | Removed obsolete local destination-ref resolver; focused 54/54 |
| CRITICAL-4 | Start journal was empty and replay returned lineage-already-exists | Start persists completed request/result evidence at revision 0 and replays across restart | Changed request and alternate key reject; later and pending operations remain stable | Flat start result avoids recursive journal state; focused 54/54 |
| CRITICAL-5 | Skill metadata test observed forbidden `1.5` | Metadata restored to `1.4` | Package version remains `0.14.0` and migration contract is unchanged | No additional version surface introduced |

Remediation verification:

- Focused TDD loop: `node --experimental-strip-types --test tests/review-snapshot.test.ts tests/review-transaction.test.ts tests/review-gate.test.ts tests/package-manifest.test.ts tests/gentle-ai.test.ts` — 54/54 passed.
- Final focused review/runtime gate: `node --experimental-strip-types --test tests/review-*.test.ts tests/gentle-ai.test.ts` — 83/83 passed.
- Judgment Day reducer fixture check after test-helper refactor: `node --experimental-strip-types --test tests/review-policy-judgment-day.test.ts` — 5/5 passed.
- Full: `pnpm test` — 341/341 Node tests passed; runtime harness passed.
- Package: `node scripts/verify-package-files.mjs` — 49 files passed.
- Diff hygiene: `git diff --check` — passed.
- No review/Judgment Day, commit, delivery, publication, package-version, or migration-version action was performed.

## Review Transaction Scenario Trace

| Scenario | Passing evidence |
|---|---|
| Mixed working state | `complete snapshot captures tracked and non-ignored untracked content without mutating index or worktree`; intended projection companion test |
| Failed or tampered state | `state and HEAD tampering fail closed`; `lock and fsync-adjacent faults preserve the prior authoritative revision` |
| Genuine scope change | `parent and target claim one deterministic child whose budget cannot refresh`; changed exact gate target test |
| Logical controller authority | Contract parity tests plus receipt/state binding in `validateReviewGate` tests |
| Cross-mode request | Ordinary wrong-mode and Judgment Day ordinary-mode rejection tests |
| Bounded ordinary work | `ordinary discovery runs the selected zero, one, or four lenses exactly once`; one-refuter/fix test |
| Fixed candidate | One scoped validator/final verification ordinary test |
| Unfixed or failed candidate | No-finding zero-validator test; inconclusive and failed final verification tests |
| Round exhaustion | `findings surviving round two escalate and expose no third-round edge` |
| Unchanged target | Exact intended commit gate allow/replay test |
| Incident after approval | Contract parity forbids delivery/reset; terminal reducers expose no reopen transition |

## Review Routing Scenario Trace

| Scenario | Passing evidence |
|---|---|
| Objectively trivial snapshot | `objectively trivial documentation diff requests zero lenses` |
| Ambiguous executable or configuration snapshot | Executable/configuration ambiguity standard-route tests |
| Ordinary non-trivial snapshot | Dominant-lens standard routing test |
| 399 and 400 line boundaries | Dedicated 399 and 400 tests |
| 401 line boundary | Dedicated 401 full-4R test |
| Hot path | Non-trivial hot-path full-4R test |
| Objectively trivial hot-path edit | Trivial hot-path documentation test |
| Pre-delivery validation | Current staged-tree commit binding plus exact remote same-name update/create tests |
| Same-lineage gate | Exact allow/restart replay test with zero actors |
| Changed scope | Deterministic child and non-refreshing budget gate test |
| Dangerous command | Runtime and composition tests prove safety denial wins |
| Validation completes without delivery | Runtime/package no-delivery assertions and unchanged package version |

## Review Orchestration Scenario Trace

| Scenario | Passing evidence |
|---|---|
| Precision limits | 0/1/4 exactly-once reducer test and contract matrix |
| Frozen terminal rows | Frozen canonical row hash/tamper test; immutable ledger assertion after validation |
| Authoritative persistence | Journaled lineage start, atomic Git-dir store, restart replay, and state/HEAD integrity tests |
| Evidence routing | Deterministic controller result plus inferential refuter tests |
| Inferential batch | One complete-list refuter counter test |
| Fail-closed result | Missing/inconclusive/unknown output escalation tests |
| Fix path | One fix, exact validator request, one final verification test |
| No-fix or failure | Zero-validator no-fix and failed-verification escalation tests |
| Judgment Day | Real non-trivial capture-to-start plus exactly two initial judges and zero refuters tests |
| Judgment Day limit | Two scoped rounds and no-third-round test |
| SDD completion | Contract/runtime tests assert no extra review/Judgment Day pass |
| Scope or incident | Deterministic child claim; parent remains terminal; no counter reset |
| Verification stop | Terminal state and package/runtime no-delivery tests |

## JD-DES Trace

| Finding | Passing evidence |
|---|---|
| JD-DES-001 | Journaled lineage start plus persisted reducer request/result replay, restart, key mismatch, and pending-operation tests |
| JD-DES-002 | Receipt body/envelope preimage test proves hash excludes `receipt_hash` |
| JD-DES-003 | Frozen canonical rows plus exact validator ID/row/fix-diff request and altered-claim rejection |
| JD-DES-004 | Actor-output authority clauses and receipt-to-authoritative-state binding; same-user attestation remains explicitly out of scope |
| JD-DES-005 | Parent+target deterministic child claim and replayed-budget preservation tests |
| JD-DES-006 | Actual staged-tree commit, exact remote ordered push create/update, PR base/head, release tag/object/commit/tree, and fail-closed form tests |
| JD-DES-007 | Snapshot, state, receipt, and gate tests bind exact `review_projection`, `initial_review_tree`, and final candidate |

## Files Changed

### Runtime and library

- `extensions/gentle-ai.ts`
- `lib/review-snapshot.ts`
- `lib/review-transaction.ts`
- `lib/review-policy-ordinary.ts`
- `lib/review-policy-judgment-day.ts`
- `lib/review-triggers.ts`
- `lib/sdd-preflight.ts`

### Contracts, assets, and docs

- `README.md`
- `assets/orchestrator.md`
- `assets/orchestrator-delegation.md`
- `assets/chains/4r-review.chain.md`
- `assets/agents/review-risk.md`
- `assets/agents/review-resilience.md`
- `assets/agents/review-readability.md`
- `assets/agents/review-reliability.md`
- `assets/agents/review-refuter.md`
- `assets/agents/review-validator.md`
- `assets/agents/jd-judge-a.md`
- `assets/agents/jd-judge-b.md`
- `assets/agents/jd-fix-agent.md`
- `skills/_shared/review-ledger-contract.md`
- `skills/gentle-ai/SKILL.md`
- `skills/judgment-day/SKILL.md`
- `skills/judgment-day/references/prompts-and-formats.md`
- `assets/migrations/managed-assets-v0.14.json`
- `scripts/verify-package-files.mjs`

### Tests and evidence

- `tests/review-snapshot.test.ts`
- `tests/review-transaction.test.ts`
- `tests/review-policy-ordinary.test.ts`
- `tests/review-policy-judgment-day.test.ts`
- `tests/review-test-fixtures.ts`
- `tests/review-triggers.test.ts`
- `tests/review-gate.test.ts`
- `tests/review-ledger-contract.test.ts`
- `tests/gentle-ai.test.ts`
- `tests/orchestrator-budget.test.ts`
- `tests/sdd-preflight.test.ts`
- `tests/package-manifest.test.ts`
- `tests/runtime-harness.mjs`
- `tests/fixtures/v0.14/assets/agents/review-risk.md`
- `openspec/changes/simplify-4r-bounded-review-transaction/tasks.md`
- `openspec/changes/simplify-4r-bounded-review-transaction/apply-progress.md`

## Deviations and Risks

- No scope deviation. The push target now binds an exact remote identity so destination old/absent semantics can be resolved without conflating the local source ref; same-user coherent store/config rewrites remain outside the stated local-integrity trust boundary.
- Runtime raw lifecycle commands fail closed until a controller supplies an approved receipt and fully resolved typed target; dangerous-command safety is evaluated first.
- Canonical OpenSpec deltas remain active and are not merged into `openspec/specs/` during apply; that belongs to archive.
- `.codegraph/` and the pre-existing untracked change artifacts were not modified as product deliverables.
