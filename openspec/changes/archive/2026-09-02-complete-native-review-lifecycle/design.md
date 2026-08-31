# Design: Complete Native Review Lifecycle

## Technical Approach

Keep graph-v1/CAS, exact append idempotency, resume, receipts, gates, and bundles intact. For new ordinary lineages, bind canonical repository-relative `genesis_paths` into snapshot identity. The controller derives `initial_review_tree..candidate_tree` correction paths and diff with Git, then rejects before append unless paths stay within genesis and corrected IDs exactly match accepted frozen blocking IDs.

Ordinary validation is proof consumption, not review. Its request contains exact frozen IDs/rows and ledger hash, original acceptance evidence, one correction-regression record per ID, original-criterion regressions, and inert follow-up records. It contains no correction diff, diff hash, candidate tree, changed-line scope, or discovery authority. The internal `fix_record` retains the Git-derived diff and candidate binding as transaction authority.

Follow-ups exist only inside ordinary `validation_evidence`; they create no transition and never affect phase, counters, resolutions, candidate tree, approval, delivery, or receipts. Judgment Day remains separate and retains its fix-diff/scoped re-judgment contract unchanged.

## Architecture Decisions

| Decision | Choice | Tradeoff |
|---|---|---|
| Compatibility | Add optional-on-read, required-on-new-lineage graph-v1 fields; no schema generation or migration. | Historical records are less type-uniform, but deployed replay/bundles remain valid. |
| Correction authority | Derive paths/diff from Git and store them internally; never trust caller paths or expose the diff to the ordinary validator. | Adds Git work, but prevents scope expansion and hidden second discovery. |
| Follow-ups | Store ID-sorted, action-free records in `ValidationEvidenceV1.follow_ups`. | They remain auditable but intentionally cannot influence outcomes. |
| Cleanup | Remove only newly added transition/fix-line assertions; preserve meaningful compatibility evidence. | A narrower diff requires precise drift guards rather than broad fixture deletion. |

## Data Flow

`snapshot + genesis paths → one discovery/freeze → Git-derived correction binding → targeted proof request + inert follow-ups → one final verification → existing receipt/gates`

## Cleanup File Matrix

| File | Change |
|---|---|
| `lib/review-snapshot.ts` | Add identity-bound genesis paths and authoritative correction capture. |
| `lib/review-policy-ordinary.ts` | Require exact proof-bearing validator request; omit fix diff/candidate fields; reject missing/duplicate/failed per-ID proof and original-criterion regressions. |
| `lib/review-transaction.ts` | Persist genesis, internal correction binding, and validation evidence; remove `OrdinaryFollowUpInput`, reducer handling, and top-level `follow_ups`. |
| `lib/review-graph-schema.ts` | Do not add `ordinary-follow-up`. |
| `extensions/gentle-ai.ts` | Derive correction evidence internally and confine targeted validation input through existing `input`/`inputPath` handling. |
| `assets/agents/review-validator.md` | Replace scoped/fix-line review with exact acceptance/regression-proof consumption and inert follow-ups. |
| `skills/_shared/review-ledger-contract.md` | Make the targeted ordinary boundary canonical; leave Judgment Day wording intact. |
| `assets/orchestrator-delegation.md` | Replace ordinary “scoped validator”/fix-diff routing language with targeted proof validation. |
| `skills/gentle-ai/SKILL.md` | Mirror the ordinary proof contract without changing Judgment Day. |
| `README.md` | Update the additional ordinary contract surface found by drift-guard evidence. |
| `tests/review-ledger-contract.test.ts` | Require the new clauses and forbid ordinary fix-line/diff/re-review language while retaining Judgment Day clauses. |
| `tests/review-{snapshot,policy-ordinary,transaction,controller,graph-schema,bundle}.test.ts` | Keep lifecycle/compatibility coverage; remove only new follow-up-transition tests and ordinary request assertions that expose fix diff. |
| `tests/package-manifest.test.ts`, `tests/fixtures/v0.13/**`, `tests/fixtures/v0.14/**`, `assets/migrations/**` | Preserve unchanged: forced-sync tests prove live historical consumers. |

## Testing Strategy

1. Snapshot RED tests prove canonical genesis identity, authoritative Git correction scope, and pre-append rejection without index/worktree mutation.
2. Policy/transaction/controller RED tests prove exact evidence per frozen ID, inert follow-ups inside validation evidence, no `ordinary-follow-up`, no validator diff/candidate fields, one validator maximum, and original-criterion escalation.
3. Contract drift tests cover all five ordinary production surfaces, including `README.md`, and separately preserve Judgment Day fix-diff language.
4. Regression tests preserve graph replay/CAS, retry/resume, receipts/gates, bundle round-trip, route/lens policy, and package forced-sync migrations.

## Threat Matrix

| Boundary | Applicability | Safe/failure behavior and RED test |
|---|---|---|
| Documentation-like paths | Applicable | Canonicalize `requirements.txt`, `CMakeLists.txt`, executable MDX, and `README.sh`; reject path expansion; test each. |
| Git repository selection | Applicable | Resolve nested/relative/absolute cwd to one root; fail closed outside/unresolved metadata; test each selector. |
| Commit state | Applicable | Staged, mixed `commit -a`-like, and empty-index states produce exact trees without mutation; test each. |
| Push state | N/A | No push or ref-resolution change. |
| PR commands | N/A | No PR command composition. |

## Migration / Open Questions

No migration, feature flag, or open question. Historical graph-v1 and published migration fixtures remain unchanged.
