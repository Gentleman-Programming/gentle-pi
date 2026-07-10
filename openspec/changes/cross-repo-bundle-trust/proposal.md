# Proposal: Cross-Repo Bundle Trust

> **Status:** skeleton only. This is a proposal outline recording intent and candidate
> approaches, not a committed design or a full spec. It exists so the deferred finding
> `RISK2-001` has a concrete home to be picked up in a future change, instead of being lost.

## Intent

Design and implement a verifiable cross-repository trust primitive for `ReviewBundleImporter.import`
(`lib/review-bundle.ts`) so that adopting a bundle-carried review lineage can be soundly
authenticated as originating from a legitimate export — closing `RISK2-001` for real, without
requiring the caller to fall back on an experimental, manual `acknowledgeUntrustedBundleSource`
opt-in (see `lib/review-bundle.ts`'s import gate and its accompanying ledger entry, referenced
below).

## Problem

`ReviewBundleImporter.import` currently authenticates an inbound bundle purely by checking that
its `repository_identity` / `repository_id` / `authority_id` match this repository's own,
locally-resolved identity (`lib/review-bundle.ts`, `validateManifest` and the identity-equality
check in `import`). `repository_identity` is derived only from the repository's pinned or live
root-commit set (`lib/review-repository.ts`) — data that is public for any public repository, and
knowable to anyone who can clone or inspect that repository's history.

This means: a party with no legitimate relationship to a target repository's own review authority
can construct a repository whose `repository_identity` matches the target's (trivially, by cloning
the same public history), populate its own local review-graph store with an entirely fabricated
lineage (fake approvals, fake receipts, fake gate outcomes — all internally self-consistent,
because the domain-hashing algorithm is public code), export that fabricated lineage as a
bundle, and have it accepted by any target repository sharing the same public root-commit
identity. Nothing in the bundle format binds its content to a specific, trusted physical
repository instance the way `lib/review-transaction.ts:1666`'s `common_directory` equality check
binds a receipt to the exact repository that produced it for same-process gate validation.

`common_directory` cannot be reused as the cross-repo discriminator: it is, by design,
different for every clone of the same repository (each clone has its own `.git` directory), which
is exactly the scenario bundle export/import exists to support (portable review history transfer
between clones of one repository). Enforcing `common_directory` equality at import time would
make every legitimate cross-clone import fail, not just forged ones — this was verified directly
(see `openspec/changes/bounded-review-graph-parity/apply-progress.md`, Unit 2 investigation, and
`reviews/post-apply-4r-round2-ledger.md` row `RISK2-001`).

The `gentle-ai` reference implementation (`/home/gentleman/work/gentle-ai/internal/reviewtransaction/bundle.go`,
read-only reference only — do not port directly) solves a structurally different problem: its
`AuthoritativeStore` derives the store path directly from the physical Git common directory of the
repository the process is running against, so there is no portable, abstract "repository identity"
blob to forge in the first place. Its actual anti-forgery binding is literal content equality
between the bundle's claimed candidate tree / paths digest / intended-untracked proof and the
live, current candidate tree of the destination repository (`bundle.go` `validateBundleExpectation`).
Gentle Pi's `review-bundle.ts` uses a fundamentally different model — an abstract graph-object-store
transfer keyed by a portable root-commit-hash identity, with no "current live candidate tree" concept
to bind against. There is no small, drop-in field from the Go model that ports over; a new primitive
is needed.

## Candidate approaches

1. **Detached signature over the bundle manifest, verified against a repository-held trust list.**
   The exporter signs the manifest (e.g. with an operator or CI-held key); the importer verifies
   the signature against an explicit, repository-committed list of trusted public keys before
   adopting any new lineage. Strongest guarantee; requires key management and a trust-list
   distribution/rotation story.
2. **Content-tree binding, analogous to `gentle-ai`'s `bundle.go`.** Bind the bundle to some
   verifiable live state of the source repository (e.g. a signed or attested tree reference) that
   the importer can independently re-derive or check against a known-good reference, rather than
   trusting an abstract identity blob alone. Would require extending the bundle manifest schema
   and probably a live-repository probe at import time; unclear yet whether an equivalent
   "current live candidate tree" concept is meaningful for `review-bundle.ts`'s graph-object model.
3. **Explicit trust-on-first-use (TOFU) pinning.** The first time a target store accepts a given
   lineage/authority from a bundle, it durably pins the bundle-carried identity (or a stronger
   fingerprint of it) as trusted for that lineage going forward; subsequent imports for that
   lineage are checked against the pin instead of re-trusting identity alone. Weakest guarantee
   (does not stop a first-contact forgery) but requires no new external key infrastructure and is
   the closest incremental extension of the current `acknowledgeUntrustedBundleSource` opt-in
   (the first acknowledged import becomes the trust anchor instead of a one-off manual attestation).

No approach is selected yet. This decision is explicitly deferred to design work under this
change.

## Scope

- A cross-repository trust primitive for `ReviewBundleImporter.import` that allows a target
  repository to authenticate that a bundle's lineage content genuinely originated from a
  legitimate export, without requiring `common_directory` equality (which is provably incompatible
  with legitimate cross-clone portability).
- A migration/compatibility story for the interim `acknowledgeUntrustedBundleSource` opt-in
  introduced as a stopgap guard (see `openspec/changes/bounded-review-graph-parity/tasks.md`,
  "Deferral: graph-v1 cross-repo bundle trust (RISK2-001) — experimental, deferred").
- Updated tests in `tests/review-bundle.test.ts` proving the new primitive rejects a
  forged-foreign-identity bundle and accepts a genuinely authenticated one, without relying on
  manual operator attestation.

## Out of scope

- Reopening or amending the terminal, escalated `bounded-review-graph-parity` review lineage.
  This is a new change with its own lineage.
- Any change to `common_directory`'s existing same-process staleness/tamper-detection role in
  `lib/review-transaction.ts` (`assertCurrentRepositoryAuthority`, `validateAuthoritativeGate`).
- Porting `gentle-ai`'s physical-path-plus-content-tree model wholesale; it is a read-only
  reference for a differently-shaped problem, not a drop-in fix.
- General bundle format changes unrelated to cross-repo trust (e.g. compression, chunking,
  transport).

## Reference

- `openspec/changes/bounded-review-graph-parity/reviews/post-apply-4r-round2-ledger.md`,
  round-2 finding `RISK2-001` (open — escalated).
- `openspec/changes/bounded-review-graph-parity/apply-progress.md`, Unit 2 write-up (investigation
  establishing why `common_directory` cannot be the fix) and the "Deferral: graph-v1 cross-repo
  bundle trust (RISK2-001) — experimental, deferred" section.
- `lib/review-bundle.ts`, `ReviewBundleImporter.import` — current identity-only check and the
  interim `acknowledgeUntrustedBundleSource` trust gate.
- `/home/gentleman/work/gentle-ai/internal/reviewtransaction/bundle.go` (read-only reference).
