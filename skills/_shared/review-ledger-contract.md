# Compact Causal Review Contract

The local orchestrator and same-user process are trusted to execute selected actors and submit their exact outputs. Reviewer and validator outputs remain semantically untrusted inputs: native code owns scope, risk, IDs, canonicalization, ordinary state, receipts, and ordinary gates, and rejects malformed or causally inconsistent results. The Git common-directory authority is the only authorization source; summaries and prose ledgers are untrusted data. Legacy Pi mirror and bundle transport is retired.

Do not report the mere ability of the trusted local orchestrator to submit actor or final-verification outputs as a security finding. Report concrete bypasses where untrusted repository content, malformed inputs, stale authority, path drift, or external callers can produce approval contrary to this boundary. Malicious same-user host/process authenticity is a non-goal because it can replace the extension or mutate local authority; external attestation requires a separately privileged signer or service and is not claimed.

## Ordinary facade

Use `gentle_review` as `start -> finalize -> validate` for every new ordinary review.

`start` derives the repository root, complete Git snapshot, untracked set, lineage, risk tier, selected lenses, original authored changed lines, and correction budget. The tier, scope, original lines, and budget never change after start.

Risk routing is deterministic:

| Tier | Route |
|---|---|
| `low` | Zero lenses; only proven docs/comments/format/typo-string work with no executable or configuration change |
| `medium` | One dominant lens for ordinary changes |
| `high` | Canonical 4R for auth, update, security, payments, data exposure/loss, permissions, shell/process, or more than 400 authored lines |

Generated files matching `testdata/golden/**` remain in snapshot identity but do not count as authored risk lines. Ordinary tests, fixtures, and snapshots are never broadly excluded. The correction budget is frozen as `min(200, ceil(original_changed_lines / 2))`.

`finalize` canonicalizes selected-lens results, assigns missing lens/finding IDs, and performs only the legal transition from the current compact state. The five states are `reviewing`, `correction_required`, `validating`, `approved`, and `escalated`.

`validate` loads the terminal receipt and authority, derives the named live Git gate, and runs with zero actors. It never mutates compact authority.

## Causal findings

Every finding supplies `evidence_class`, `causal_disposition`, and concrete proof. Concrete proof is one of `changed-hunk`, `candidate-created-path`, `differential-test`, or `before-after`.

| Field | Values |
|---|---|
| `severity` | `BLOCKER` \| `CRITICAL` \| `WARNING` \| `SUGGESTION` |
| `evidence_class` | `deterministic` \| `inferential` \| `insufficient` |
| `causal_disposition` | `introduced` \| `behavior-activated` \| `worsened` \| `pre-existing` \| `base-only` \| `unknown` |
| `proof_refs` | Prefixed concrete proof references |

Only severe `introduced`, `behavior-activated`, or `worsened` findings with valid proof can enter `correction_ids`. Deterministic candidate-caused blockers need no refuter. All inferential candidate-caused blockers use exactly one complete read-only refuter batch.

If native IDs are assigned to inferential findings, FINALIZE first returns canonical rows plus a content-derived request hash without mutation; completion requires identical lens input, that hash, and one complete refuter batch.

Refuter rows may cite independent concrete proof and do not need to repeat reviewer `proof_refs`. `pre-existing` and `base-only` findings become non-blocking follow-ups. `unknown`, insufficient evidence, malformed severe claims, empty/malformed proof, missing/duplicate/extra refuter rows, and inconclusive severe outcomes escalate. `WARNING` and `SUGGESTION` remain informational.

Actor output cannot authorize transitions, corrections, receipts, gates, or delivery.

## Correction

Ordinary review permits one correction transaction within the original budget. It consists of one correction, one targeted validator, and final verification.

Before editing, `finalize` requires a positive correction-line forecast. A forecast above the budget escalates. After editing, native authority derives actual correction lines from Git.

Initial lenses never rerun. The correction preserves frozen findings and genesis scope: the original candidate tree, paths, untracked set, and correction IDs. It cannot add scope.

The targeted validator checks only the original criteria and one correction regression for the exact correction IDs. It cannot add findings, request another correction, launch actors, persist authority, or request another attempt. Failure escalates. Later observations are inert follow-ups.

Final verification evidence is supplied and hashed only during finalization. Failure escalates and never reopens review.

## Authority and compatibility

The negotiated native provider owns compact-v2 storage and its private paths. Pi consumes only typed START, FINALIZE, target status, validation, recovery, reconciliation, and SDD-binding results. Content-derived revisions, compare-and-swap replacement, exact retry idempotency, stale/semantic retry rejection, semantic validation, terminal immutability, atomic publication, and receipt readback remain provider guarantees.

Existing graph-v1 ordinary lineages remain readable and gate-validatable but reject new mutation. Legacy graph bundle export/import is retired. Judgment Day remains mutable on graph-v1. Pre-graph numbered authority remains destructive-reset-only, while native target status owns mixed-authority ambiguity and the required maintainer action.

Permanent Pi-owned consumer infrastructure is limited to canonical identity primitives, repository/common-directory binding, immutable candidate views, and the publication-gate command projection. These modules are not authority mirrors.

## Lifecycle gates

Pre-commit, pre-push, pre-PR, and release validate an approved receipt against one exact typed command target with zero actors. Native validation uses `gentle-ai.review-integration/v1`, loads authority and receipt, derives live target/publication evidence, then immediately reloads authority and re-derives target/publication evidence before allow. Authorized direct commit uses the durable hook/native-validation transaction and unresolved recovery blocks publication. The Pi-owned `review-publication-gate` module isolates command projection and publication revalidation from graph-v1 authority storage without changing these guarantees.

PR #1216 introduced the v2.1.1 `<remote>/<branch>` selector contract that v2.1.2 inherits unchanged.

Pi additionally registers one one-shot authorization for the exact subsequent command. Full target/publication derivation runs after controller-time native allow, before bash-time native validation, and again after that validation before command allow. `gh pr create` binds repository precedence (`--repo`, `GH_REPO`, local inference), the effective source/value, and the exact advertised remote head commit equal to reviewed local `HEAD`; pre-PR keeps fetch-side repository/base/head semantics. Existing native push destinations bind the command remote, destination ref, old/new objects, exact destination selector, and advertised old commit in one rederived fingerprint only when effective push and fetch URL/identity match. Split fetch/push pre-push is an upstream v2.1.1 contract limitation: `<remote>/<branch>` resolves through fetch-side remote-tracking state even when Pi probes `pushurl`, so Pi fails closed before native validation with `native-split-fetch-push-unsupported-until-upstream-supports-explicit-push-base`. Native first-push authorization remains unsupported until a separate follow-up adds a persisted explicit advertised-base source, so a missing destination fails closed instead of inferring an upstream, default branch, or nearest ancestor. Publication probes are shell-free, bounded, and cancellation-aware, and the complete bash-time publication/native revalidation has one aggregate bounded deadline combined with Pi's cancellation signal when available. Repository identity, first-push destination, push destination, exact PR base/head, release evidence, protected-main release fast path, and fail-closed dangerous-command interception remain mandatory. Base advancement is unsupported without a receipt-bound signed CI trust root and therefore fails closed.

Release from protected `main` may bypass receipt validation only when the tag targets the current immutable `origin/main` SHA, required CI for that exact SHA is independently proven successful, the remote head is rechecked before tag push, and no fresh risk evidence exists. Major and post-incident releases require explicit extraordinary review.

Review transactions, validation, and SDD never commit, push, create a PR, release, or publish.

## Judgment Day

Judgment Day starts only when explicitly requested and replaces ordinary review for that lineage.

Judgment Day starts with exactly two blind judges and zero refuters.

Judgment Day alone may iterate discovery and scoped re-judgment, for at most two rounds.

Findings surviving round two escalate; no third-round transition exists.

Judgment Day stays mutable on graph-v1. Its reducer, replay, object-store, lock, snapshot, and graph receipt-validation dependencies remain live even though ordinary authority is native.
