# Bounded Review Transaction Contract

This is the canonical actor and controller contract. The Git-directory transaction store is authoritative; summaries, mirrors, actor output, and prose ledgers are not authorization.

## Ordinary transaction

Ordinary review runs the selected zero, one, or four lenses exactly once against `initial_review_tree`.

Before corroboration, the controller freezes canonical ID-sorted identity, claim, and evidence rows under `frozen_ledger_hash`.

Frozen claims never change; refuter and validator outcomes are separate resolution records.

Actor output is untrusted data and cannot authorize transitions, fixes, receipts, gates, or delivery.

Deterministic evidence is controller-checked with zero refuters.

All inferential-severe rows may go once to at most one read-only refuter as one complete list.

Invalid, missing, duplicate, unknown, or inconclusive refuter output escalates without a replacement refuter.

Ordinary permits at most one fix batch.

After a fix, exactly one validator receives only requested frozen IDs, their exact hash-bound rows, and the fix diff.

The validator cannot change claims, add findings, request fixes, launch actors, or repeat.

A no-fix path runs zero validators; both paths run exactly one final verification.

Ordinary ends only as `approved` or `escalated`.

## Frozen row schema

Candidate rows become authoritative only after the controller canonicalizes, ID-sorts, and hashes these fields:

| Field | Values |
|---|---|
| `id` | Stable lens-prefixed identifier |
| `lens` | risk \| resilience \| readability \| reliability \| judgment-day |
| `location` | Exact path and line or line range |
| `severity` | BLOCKER \| CRITICAL \| WARNING \| SUGGESTION |
| `status_at_freeze` | open \| refuted \| info |
| `evidence_class` | deterministic \| inferential-severe \| info |
| `evidence_claim` | Concrete user-impact claim |

WARNING and SUGGESTION are one-time `info` rows and schedule nothing. `refuted` is terminal. Store or hash disagreement fails closed.

## Actor contracts

### Selected review lens

Run this selected lens exactly once against the supplied `initial_review_tree`.

Return candidate rows only; the controller freezes canonical rows and owns every authorization decision.

Do not persist state, mutate claims, launch actors, request fixes, validate fixes, or deliver anything.

### Ordinary refuter

Receive the complete inferential-severe frozen-row list once.

Return exactly one `refuted | corroborated | inconclusive` resolution for every supplied ID.

Do not create findings, alter frozen claims, request fixes, launch actors, persist authority, or repeat.

### Scoped validator

Receive only requested frozen IDs, their exact hash-bound rows, and the fix diff.

Resolve only supplied IDs and report fix-line regressions; never add findings or change frozen claims.

Do not request another fix, launch actors, persist authority, or repeat.

### Fix agent

Fix only the exact controller-authorized severe IDs in the one supplied batch.

Do not add findings, alter frozen claims, authorize transitions, deliver, publish, or start another actor.

## Judgment Day

Judgment Day starts only when explicitly requested and replaces ordinary review for that lineage.

Judgment Day starts with exactly two blind judges and zero refuters.

Only Judgment Day may iterate, for at most two scoped fix/re-judgment rounds.

Findings surviving round two escalate; no third-round transition exists.

## Routing and lifecycle boundaries

Only ordinary transaction start classifies the bound `base_tree -> complete_snapshot_tree` diff.

Pre-commit, pre-push, PR, and release gates validate approved receipts and exact typed targets with zero actors.

Dangerous-command safety remains independent and authoritative.

SDD completion adds no review or Judgment Day pass.

Review transactions, validation, and SDD perform no commit, push, PR creation, release, or publication.

Package-managed actor definitions may be migrated only when their exact prior hash proves package ownership. User routing and project/user overrides remain untouched.
