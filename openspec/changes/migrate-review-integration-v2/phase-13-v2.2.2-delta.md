# Phase 13 [RELEASE-GATED]: v2.2.2 re-pin delta

Staged separately because Phases 1–12 were authored against v2.2.1 and four agents
were concurrently editing `tasks.md` when this was written. **Fold this into
`tasks.md` as Phase 13 once those land.**

## Why this phase exists

gentle-ai v2.2.2 was tagged at `09c2d8b6` while Stage 1 was in progress. The mirror
guard was run against the tag and fired on three paths:

```
git diff --name-status v2.2.1..v2.2.2 -- contracts/ docs/review-integration.md internal/assets/skills/
M	docs/review-integration.md
M	internal/assets/skills/_shared/review-ledger-contract.md
M	internal/assets/skills/sdd-archive/SKILL.md
```

**`contracts/` did NOT change.** All 9 v2 schemas and 4 fixtures are byte-identical
between v2.2.1 and v2.2.2, so the Phase 1 decoder module and every fixture
round-trip test remain valid untouched. That is the whole reason Stage 1 was allowed
to proceed rather than wait.

Note on the guard itself: comparing against `origin/main` is WRONG and will miss
this. The work sat as an unpushed local commit plus uncommitted files for a while.
Compare against the tag, or against local `main`.

## Gate

`.gentle-ai/v2.2.2/gentle-ai review capabilities --contract gentle-ai.review-integration/v2`
returns a capabilities envelope with protocol major 2 — not `unsupported_contract`.
Blocked until the v2.2.2 release publishes its assets; the tag alone is not enough,
because the archive and binary digests cannot be pinned without the tarballs.

## Tasks

- [ ] 13.0 Gate check: confirm the v2.2.2 release is published with its 4 tarballs +
      `checksums.txt` + `checksums.txt.minisig`. STOP if it is not.
- [ ] 13.1 Re-mirror `docs/review-integration.md` from the `v2.2.2` tag. The only
      change is one word — "review-driven development" became "receipt-driven
      development" — but it moves the file's sha256, and the file is byte-pinned.
- [ ] 13.2 Update the `docs/review-integration.md` digest in
      `scripts/verify-package-files.mjs` `contractHashes`. Compute it from the tag
      (`git show v2.2.2:docs/review-integration.md | sha256sum`), never from Pi's
      local copy — the point is to prove the copy matches upstream.
- [ ] 13.3 Re-mirror `skills/_shared/review-ledger-contract.md` from the tag. This
      one is NOT cosmetic: archive may now close under
      `reviewGate.delivery: disabled/unmanaged` while the kill switch is off. The
      rationale upstream is a deadlock fix — demanding a terminal receipt while the
      kill switch is off demands one `review start` is refused from producing. An
      explicit review artifact that failed still blocks, and `allow` is never
      manufactured.
- [ ] 13.4 `scripts/gentle-ai-installer.mjs` — `RELEASE_BASE_URL` → `.../v2.2.2/`,
      `INSTALLER_VERSION = "2.2.2"`, and the 4 `asset()` rows: filenames plus
      `sha256` from the signed `checksums.txt` and `binarySha256` computed from each
      extracted executable. 12 literals.
- [ ] 13.5 `lib/gentle-ai-binary.ts` — `GENTLE_AI_VERSION = "2.2.2"`.
- [ ] 13.6 `lib/native-review-cli.ts` — add the `NATIVE_CLI_CONTRACTS["2.2.2"]` row.
      Ground it against the released binary rather than copying blind: check what
      v2.2.2 advertises on the lane Pi speaks before deciding whether `riskEvidence`
      and `hint` stay dark.
- [ ] 13.7 `scripts/verify-package-files.mjs` — version labels and pin assertions
      `2.2.1` → `2.2.2`.
- [ ] 13.8 `tests/gentle-ai-installer.test.ts` — `EXPECTED_ASSETS` table, 12 digest
      literals, and every `.gentle-ai/v2.2.X/` path assertion.
- [ ] 13.9 `tests/package-manifest.test.ts` — version-pin regexes → `2\.2\.2`.
- [ ] 13.10 `tests/native-review-capability-contract.test.ts` — a `"2.2.2"` row test
      and the `no shipped version key was added beyond the pin bump` guard's expected
      key list.
- [ ] 13.11 Regenerate `runtime/*.mjs` with
      `node scripts/build-git-commit-transaction-runner.mjs --write`. Never hand-edit.
- [ ] 13.12 Terminology: 15 occurrences of "review-driven" across 5 Pi files
      (`extensions/gentle-ai.ts`, `tests/review-controller-native-routing.test.ts`,
      `tests/native-review-parity.test.ts`,
      `tests/devbinary/native-review-parity.devtest.ts`,
      `docs/review-integration.md`). The doc one arrives via 13.1 — do not hand-edit
      it. Decide deliberately whether the other four follow upstream's rename or stay
      as historical references; comments describing a past verification are true
      statements and changing them makes them false.
- [ ] 13.13 Investigate whether Pi has its own version of the archive deadlock.
      `lib/native-review-cli.ts` is the only file in `lib/` or `extensions/`
      mentioning `reviewGate`. Pi does NOT mirror `skills/sdd-archive/SKILL.md` and
      neither that file nor Pi's `review-ledger-contract.md` currently contains the
      `reviewGate.result: allow` demand, so this may be a no-op — confirm rather than
      assume.
- [ ] 13.14 Verify: `pnpm test` green, `node scripts/verify-package-files.mjs`
      exit 0, `pnpm run check:transaction-runner` green, and the installed
      `.gentle-ai/v2.2.2/gentle-ai --version` reports `2.2.2`.

## Do NOT do

- Do not re-mirror `contracts/review-integration/**`. It did not change, and touching
  it would invalidate Phase 1's verified fixture round-trips for no reason.
- Do not edit `docs/review-integration.md` by hand for the terminology change. It is
  a byte-identical mirror; hand-editing it desynchronizes it from upstream even when
  the resulting text looks right.

## Provenance discipline, carried from the v2.2.1 pin

Every digest gets verified rather than copied:

- archive `sha256` values checked with `sha256sum -c` against the release's
  `checksums.txt`
- `binarySha256` values computed from the executables extracted from those verified
  archives
- contract-artifact digests recomputed from the git tag, not from Pi's local copy

The v2.2.1 pin commit `17251280` is the worked example; its message records the
recipe.
