<!--
This file mirrors gentle-ai's own review-integration documentation. It is
written only by scripts/sync-gentle-ai-release.mjs and MUST NOT be hand-edited
(see openspec/changes/consume-gentle-ai-release-artifacts/design.md D6).

Bootstrap-evidence notice: this copy was materialized from a local, unsigned
`--bootstrap-archive` sync run (development/bootstrap evidence class) because
gentle-ai has not yet published a signed release under the
`gentle-ai.release-artifact` contract this mirror is sourced from. It proves
the mirror-writing and lock-reconciliation mechanism only and carries no
release, pin, or final-acceptance evidence. Re-run
`node scripts/sync-gentle-ai-release.mjs --write` against a live signed
release to replace it with real `release`-class content once one is
published.
-->

# Review Integration Contract (provider mirror)

This is a provider-mirrored copy of gentle-ai's review-integration contract
documentation, checked in for offline reference alongside the byte-identical
`contracts/review-integration/{v1,v2}/**` schemas and fixtures. gentle-pi's
own consumer-facing guide lives at [`../review-integration.md`](../review-integration.md)
and is authored separately; the two are not the same document and are not
kept byte-identical to each other.

Once gentle-ai publishes the first signed `gentle-ai.release-artifact`
release, this file is replaced verbatim by the sync script with the
provider's real published documentation for the pinned version.
