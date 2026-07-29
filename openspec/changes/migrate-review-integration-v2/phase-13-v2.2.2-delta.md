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

- [x] 13.0 Gate check: confirm the v2.2.2 release is published with its 4 tarballs +
      `checksums.txt` + `checksums.txt.minisig`. STOP if it is not.
- [x] 13.1 Re-mirror `docs/review-integration.md` from the `v2.2.2` tag. The only
      change is one word — "review-driven development" became "receipt-driven
      development" — but it moves the file's sha256, and the file is byte-pinned.
- [x] 13.2 Update the `docs/review-integration.md` digest in
      `scripts/verify-package-files.mjs` `contractHashes`. Compute it from the tag
      (`git show v2.2.2:docs/review-integration.md | sha256sum`), never from Pi's
      local copy — the point is to prove the copy matches upstream.
- [x] 13.3 ~~Re-mirror `skills/_shared/review-ledger-contract.md`~~ **WRONG PREMISE, do
      not do this.** Pi's `skills/_shared/review-ledger-contract.md` is NOT a mirror of
      gentle-ai's `internal/assets/skills/_shared/review-ledger-contract.md`. They share
      a filename and nothing else: Pi's is 88 lines of Pi-owned contract (trust boundary,
      the Pi-owned `review-publication-gate` module, graph-v1 mutation rules), gentle-ai's
      is a 40-line orchestrator snippet. Overwriting Pi's with gentle-ai's destroyed 23 of
      the 25 content assertions in `tests/review-ledger-contract.test.ts:90`, which is how
      the mistake surfaced. The file's presence in `requiredPaths` means "must ship", not
      "is mirrored" — always diff the two before calling something a mirror.
      The upstream archive-under-`disabled/unmanaged` change therefore does NOT flow into
      Pi through this file. Whether Pi needs the same relaxation is task 13.13.
- [x] 13.4 `scripts/gentle-ai-installer.mjs` — `RELEASE_BASE_URL` → `.../v2.2.2/`,
      `INSTALLER_VERSION = "2.2.2"`, and the 4 `asset()` rows: filenames plus
      `sha256` from the signed `checksums.txt` and `binarySha256` computed from each
      extracted executable. 12 literals.
- [x] 13.5 `lib/gentle-ai-binary.ts` — `GENTLE_AI_VERSION = "2.2.2"`.
- [x] 13.6 `lib/native-review-cli.ts` — add the `NATIVE_CLI_CONTRACTS["2.2.2"]` row.
      Ground it against the released binary rather than copying blind: check what
      v2.2.2 advertises on the lane Pi speaks before deciding whether `riskEvidence`
      and `hint` stay dark.
- [x] 13.7 `scripts/verify-package-files.mjs` — version labels and pin assertions
      `2.2.1` → `2.2.2`.
- [x] 13.8 `tests/gentle-ai-installer.test.ts` — `EXPECTED_ASSETS` table, 12 digest
      literals, and every `.gentle-ai/v2.2.X/` path assertion.
- [x] 13.9 `tests/package-manifest.test.ts` — version-pin regexes → `2\.2\.2`.
- [x] 13.10 `tests/native-review-capability-contract.test.ts` — a `"2.2.2"` row test
      and the `no shipped version key was added beyond the pin bump` guard's expected
      key list.
- [x] 13.11 Regenerate `runtime/*.mjs` with
      `node scripts/build-git-commit-transaction-runner.mjs --write`. Never hand-edit.
- [~] 13.12 Terminology, INVESTIGATED — the occurrences are not comments, they are
      assertions on strings gentle-ai emits, and the string DID change:
      `v2.2.1: "review-driven development: on (decided by global)"` became
      `v2.2.2: "receipt-driven development: on (decided by global)"`.
      - `tests/devbinary/native-review-parity.devtest.ts:186,189,192,195` assert the OLD
        wording against the real binary and are therefore broken against v2.2.2. They did
        not surface because `pnpm run test:dev-binary` reports 5 tests / 0 pass / 0 fail —
        all five SELF-SKIP. This is a THIRD instance of the self-skip pattern and Phase 4's
        gate does not cover it (that gate covered the two suites under `tests/`).
      - `tests/native-review-parity.test.ts:172,190,447,462` carry the old wording inside
        MOCK responses, so they stay self-consistently green while describing output the
        real binary no longer produces. Fidelity rot, not a failure.
      Remaining work: update all eight, and extend the loud-skip gate to the devbinary
      suite so this class of rot cannot hide again.
- [~] 13.13 Archive deadlock, INVESTIGATED — Pi DOES have its own version, and separately
      a pre-existing decode bug:
      - `lib/native-review-cli.ts:1265` gates `ready` on `reviewGateResult === "allow"`
        with no relaxation, so with the kill switch off `ready` can never become true —
        the same deadlock gentle-ai fixed upstream in `2c18fa10`.
      - `lib/native-review-cli.ts:1246` decodes with
        `exactObject(body.reviewGate, ["result", "reason"])` — no optional `delivery` key.
        gentle-ai's status struct carries `Delivery` with `json:"delivery,omitempty"`
        (`internal/sddstatus/status.go:193`), emitted when the kill switch is off. Under
        exact-key discipline Pi REJECTS that payload.
      Both are PRE-EXISTING, not caused by this pin: `delivery` has been in the struct
      since `09e4b14c` (2026-07-27) and is present in v2.2.0, v2.2.1, and v2.2.2. Pi
      handles `delivery` in the VALIDATE path (`:1143`) but not in the sdd-status path.
      Fires when: kill switch off + a real SDD change + `sdd-status` called.
- [x] 13.14 Verify: `pnpm test` green, `node scripts/verify-package-files.mjs`
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
