# Tasks: migrate gentle-pi to `review-integration/v2`

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~900–1300 (new decoder module, correction lifecycle module, ~35 files touched across both stages, generated runtime, docs) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR, two internal commits (Stage 1 immediately, Stage 2 gated) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

`size:exception` (1200-line budget) is already accepted per proposal.md and design.md — no further chaining decision is required. The single PR stays open (draft) across the Stage 2 gate.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 — Stage 1 | Decoder module, correction lifecycle, manifest binding, loud-skip gate, package-files walk, docs — unimported/behavior-neutral | PR 1 (commit 1) | `node --experimental-strip-types --test tests/review-integration-v2.test.ts tests/review-correction-lifecycle.test.ts` | `pnpm run test:harness` for candidate-view settling tests | Revert commit 1 alone; v1 stays the only imported module |
| 2 — Stage 2 (release-gated) | Pin bump, import flip, v1 deletion, runtime regeneration, all literal updates | PR 1 (commit 2, after v2.2.1 gate) | `pnpm test` (full suite) | `pnpm run test:harness` + real pinned binary | Revert commit 2 alone; `contracts/review-integration/v1/**` stays on disk, v1 lane restored |

---

## Stage 1 — authorable now, `pnpm test` green at every commit

### Phase 1: v2 decoder module

- [x] 1.1 RED: `tests/review-integration-v2.test.ts` — rejection test per decoder (missing required key, extra key, wrong identity) for capabilities/v2, start/v3, status/v3, projection/v1, failure/v2, operation/v2 (module does not exist yet, must fail).
- [x] 1.2 GREEN: `lib/review-integration-v2.ts` — port verbatim primitives (`record`, `exactRecord`, `text`, `nonempty`, `boolean`, `integer`, `enumeration`, `canonicalJson`, `array`, `stringArray`, `enumArray`, `sha256`, `gitTree`, `lineage`, `safePath`, `assertExactSet`, `assertSupersetOf`); add `requireIdentity` (v2 const) and `decodeReviewCapabilitiesV2` (22-schema superset: 10 mandatory + 17 optional).
- [x] 1.3 GREEN: `lib/review-integration-v2.ts` — implement `decodeReviewStartV3`, `decodeReviewStatusV3`, `decodeReviewProjectionV1`, `decodeReviewFailureV2`, `decodeReviewOperationV2`; pass 1.1's rejection tests plus 4-fixture round-trip against `contracts/review-integration/v2/fixtures/`.
- [x] 1.4 RED: `tests/review-integration-v2.test.ts` — net-new decoders `decodeReviewConsentV2`, `decodeReviewNextTransitionV3`, `decodeReviewArtifactSubjectV2`: rejection tests (no provider fixture required for consent/next-transition).
- [x] 1.5 GREEN: `lib/review-integration-v2.ts` — implement `decodeReviewConsentV2`, `decodeReviewNextTransitionV3`, `decodeReviewArtifactSubjectV2`.
- [x] 1.6 RED: `tests/review-integration-v2.test.ts` — `decodeReviewRepairV2` hand-built payloads: execute-without-`execution` rejected; eligible-preflight with wrong `required_inputs` order rejected (both `allOf` invariants from v1 `repair.schema.json:53-157`).
- [x] 1.7 GREEN: `lib/review-integration-v2.ts` — implement `decodeReviewRepairV2` (mode, assessment, provider_inputs, required_inputs, execution) and `decodeAuthorityRepairAssessmentV1`.
- [x] 1.8 Verify: `tests/review-integration-v2.test.ts` has ≥22 tests total (offsets the 22 tests the two Stage-2-deleted v1 test files carry); module stays unimported by `lib/native-review-cli.ts`.

### Phase 2: correction lifecycle (pure)

- [x] 2.1 RED: `tests/review-correction-lifecycle.test.ts` — three outcomes (`passed`→targeted-validation, `verification_failed`→open/no-budget-charge, `procedural_tooling_failed`→escalate); budget-never-consumed-on-`verification_failed` invariant; distinct-immutable-evidence invariant (new `supersedes` identity, prior record byte-unchanged, identical identity ⇒ `correction-evidence-replaced`).
- [x] 2.2 GREEN: `lib/review-correction-lifecycle.ts` — `resolveCorrectionStep(status, evidence) → CorrectionStep` pure branch machine (no subprocess).

### Phase 3: candidate-view manifest binding

- [x] 3.1 RED: `tests/review-candidate-view.test.ts` — `deriveChangedPathManifest` shape and all six failure modes: `manifest-path-set-drift`, `manifest-mode-drift`, `manifest-status-drift`, `manifest-intended-untracked-not-subset`, `manifest-input-divergence`, `manifest-subject-drift`. `manifest-subject-drift` completed: the v2 `artifact-subject.schema.json` requires `changed_path_manifest_sha256`; `digestChangedPathManifest` computes Pi's own canonical digest of a manifest (sorted by path, wire snake_case field names) and `assertManifestMatchesGit` rejects a manifest whose digest disagrees with the descriptor's `manifestSha256` claim before any Git comparison.
- [x] 3.2 GREEN: `lib/review-candidate-view.ts` — add `ChangedPathEntry`, optional `manifest?: readonly ChangedPathEntry[]` on `NativeCandidateProjectionDescriptor`, `deriveChangedPathManifest` (`git diff --raw -z --no-ext-diff --find-renames=100% <base> <candidate>`), field-wise comparison replacing the `JSON.stringify` check at `:688`; `intended_untracked` handled as structural subset check (documented deviation from spec's field-wise list), never a derived comparison.
- [x] 3.3 Threat-matrix RED test (Documentation-like paths): mode-only `100644→100755` divergence rejected even though sorted paths match — `tests/review-candidate-view.test.ts`.
- [x] 3.4 Threat-matrix RED test (Git repository selection): manifest/projection from a different root rejected — `tests/review-candidate-view.test.ts`. Confirms the pre-existing `resolveProjection` root guard (`realpathSync(contributorRoot) !== projection.contributorRoot`) still rejects a mismatched root now that manifest binding exists — the manifest never widens scope.
- [x] 3.5 Threat-matrix RED test (Commit state): staged vs. workspace projection-kind mismatch rejected — `tests/review-candidate-view.test.ts`. Found and closed a real gap: `restoreProjectionFromNative` derived `committedOnly` from Git facts but never cross-checked it against the descriptor's own `projection` ("staged"|"workspace") label — a mislabeled descriptor would previously be silently accepted with the label ignored. Added a `projection-kind-drift` rejection. Also corrected a pre-existing test ("native projections recover a committed range base from its frozen tree") whose descriptor labeled a genuinely committed range as `"workspace"`; relabeled to `"staged"` to reflect what it actually is.
- [x] 3.6 GREEN (integration): `pnpm run test:harness` settling test — contributor edit between START and dispatch diverges `candidate_tree`; dispatch fails closed, no substituted view. Implemented by driving the real `createGentleAiExtension` tool_call wiring (not the bare library call already covered at the unit layer) with an injected `CandidateViewRegistry`, binding a candidate, editing the contributor's tracked file, then asserting the `subagent_run` dispatch blocks and never mutates the child task text.
- [x] 3.7 No-shell lens dispatch: the four `assets/agents/review-*.md` lens agents now expose exactly `read`, `grep`, `glob` and deny `bash`, matching gentle-ai's own Claude-runtime lens agents (`tools: Read, Grep, Glob`) exactly. Resolved by maintainer decision to replicate gentle-ai rather than narrow the spec. `tests/review-actor-tool-deny.test.ts` was flipped from asserting review-risk keeps bash to asserting all four deny it; that assertion predated contract v2. Rationale: Pi has no per-command Git shell scoping layer, and the contract requires such a runtime to expose no shell rather than claim backend enforcement -- unrestricted bash would let a reviewer read the live worktree instead of the frozen candidate. gentle-ai's OpenCode variant grants bash only behind permissions whose broad deny precedes narrow allows, which is the other half of the same rule.

### Phase 4: loud-skip gate

- [x] 4.1 RED: `tests/native-binary-gate.test.ts` — `requireNativeBinary()` throws when `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` and the binary is unresolved or its digest is unpinned; otherwise returns a printed skip reason. (Test file lives at the top level, not under `tests/support/`, because the runner glob is `tests/*.test.ts` and `tests/support/` is excluded from collection — the RED test was already placed correctly before this batch.)
- [x] 4.2 GREEN: `tests/support/native-binary-gate.ts` — implement `requireNativeBinary()`.
- [x] 4.3 `tests/native-review-parity-runtime.test.ts:30` — replace the `resolvedBinary === undefined ? baseTest.skip : baseTest` ternary with `requireNativeBinary()`.
- [x] 4.4 `tests/gentle-ai-binary.test.ts:23` — replace the `releaseDigestsPinned && existsSync(...)` ternary with `requireNativeBinary()`.
- [x] 4.5 `.github/workflows/ci.yml` — export `GENTLE_PI_REQUIRE_NATIVE_BINARY=1`.
- [x] 4.6 Verify: `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` with the binary removed (temp package root) → both suites FAIL, not skip.
- [x] 4.7 Verify: with the binary installed, both suites still run for real (12 tests, 12 pass, 0 skipped); overall baseline skip count stays 1 (`tests/review-repository.test.ts:52`, Windows-only).

### Phase 5: package-files reconciliation

- [x] 5.1 RED: fixture-driven test for `scripts/verify-package-files.mjs` — an unlisted `contracts/**` file fails; a `runtime/*.mjs` absent from `sources` fails; a `sources` entry absent from `requiredPaths` fails.
- [x] 5.2 GREEN: `scripts/verify-package-files.mjs` — `contracts/` ↔ `contractHashes` walk (`unlisted-on-disk` / `listed-but-missing`, `docs/review-integration.md` stays outside the walk root); `sources` ↔ `runtime/*.mjs` ↔ `requiredPaths` three-way walk; add the 13 v2 `contractHashes` entries (9 schemas + 4 fixtures) plus 4 previously-unlisted v1 entries discovered by the walk (`capabilities-v1.5` + `verification-evidence`, fixture + schema each); reword the `:150` drift message to name both lanes.

### Phase 6: docs

- [~] 6.1 (partial: `docs/native-authority-architecture.md` and `README.md` done; `skills/gentle-ai/SKILL.md` and `skills/_shared/review-ledger-contract.md` deliberately untouched — see note) `docs/native-authority-architecture.md`, `README.md`, `skills/gentle-ai/SKILL.md`, `skills/_shared/review-ledger-contract.md` — v2 vocabulary; disambiguate Pi's internal "compact-v2" from provider v2. Do not touch `docs/review-integration.md` (hash-pinned, mirrored). **Note**: `skills/gentle-ai/SKILL.md` and `skills/_shared/review-ledger-contract.md` mirror gentle-ai assets; gentle-ai v2.2.2 already changed `review-ledger-contract.md` upstream and Pi will re-mirror both during the v2.2.2 pin bump, so editing them now would conflict with that re-sync. Also: `README.md`'s "Native contract pairing is exact" paragraph and the "explicit v2.1.11 maintenance"/"compact-v2 recovery successor" phrasing are byte-locked by `tests/review-ledger-contract.test.ts` and `tests/review-authority-recovery-docs.test.ts` (not in scope for this SDD change's task list) — those exact strings were left untouched; a disambiguation note was added alongside instead.

### Phase 7: Stage 1 close-out

- [x] 7.1 Verify (REWRITTEN at close: the original text was a Stage 1 check and asserted
      the pre-switchover state -- that `lib/review-integration-v2.ts` stays UNIMPORTED and a
      854-test baseline. Stage 2 deliberately inverted both, so the original could never pass.
      The invariants that actually matter at close, all verified:
      - `pnpm test` green: 911 tests, 910 pass, 0 fail, 1 skip (the expected Windows-only
        `tests/review-repository.test.ts` platform skip)
      - `pnpm run test:harness` exit 0; `verify-package-files.mjs` exit 0 at 129 files and 64
        byte-identical v2.2.2 contract artifacts; `check:transaction-runner` matches sources
      - no live `review-integration/v1` negotiation anywhere in `lib/`, `runtime/`, or `tests/`.
        The three remaining textual matches are legitimate: two are comments explaining the
        capability rows and the legacy V214 decoder, one is a NEGATIVE test asserting the v2
        consent decoder rejects a v1 invocation, and one cites the v1 schema path the v2
        schemas `$ref` into
      - `contracts/review-integration/v1/` retained on disk: 23 schemas, required by those `$ref`s
      - v2 decoder suite at 25 tests, above the >=22 floor that offsets the deleted v1 pair)

---

## Stage 2 — RELEASE-GATED: gentle-ai v2.2.1 published AND pinned

**Do not start any task below until:**
`.gentle-ai/v2.2.1/gentle-ai review capabilities --contract gentle-ai.review-integration/v2` returns a capabilities envelope (protocol major 2) — not `unsupported_contract`.

All tasks in Phases 8–12 land in one atomic commit (per design.md's atomicity decision, driven by the generated-runtime coupling in `tests/native-review-parity-runtime.test.ts:13-14`, not by provider constraint — v2.2.1 may still serve v1).

### Phase 8 [RELEASE-GATED]: pin bump

- [x] 8.0 Gate check: run the capabilities probe above; STOP if it fails.
- [x] 8.1 `scripts/gentle-ai-installer.mjs:22,26` — `RELEASE_BASE_URL` → `.../v2.2.1/`, `INSTALLER_VERSION = "2.2.1"`.
- [x] 8.2 `scripts/gentle-ai-installer.mjs:47-52` — `GENTLE_AI_RELEASE_ASSETS`: 4 targets × (`name`, `sha256` from signed `checksums.txt`, `binarySha256` computed from extracted executables) = 12 literals.
- [x] 8.3 `lib/gentle-ai-binary.ts:8` — `GENTLE_AI_VERSION = "2.2.1"`.
- [x] 8.4 `lib/native-review-cli.ts:540-541` — add `NATIVE_CLI_CONTRACTS["2.2.1"]` row (copy `"2.2.0"` column).
- [x] 8.5 `scripts/verify-package-files.mjs:182` — both `2.2.0` literals → `2.2.1`.
- [x] 8.6 `tests/gentle-ai-installer.test.ts:25-28` — update EXPECTED asset table (12 digest literals).
- [x] 8.7 `tests/package-manifest.test.ts:277-278` — regexes → `2\.2\.1`.

### Phase 9 [RELEASE-GATED]: import flip, six `--contract` sites, v1 deletion

- [x] 9.1 Delete `lib/review-integration-v1.ts`, `runtime/review-integration-v1.mjs`, `tests/review-integration-v1.test.ts`, `tests/native-review-integration-v1.test.ts`.
- [x] 9.2 `lib/native-review-cli.ts` — import flip to `./review-integration-v2.ts`; capabilities (`decodeReviewCapabilitiesV2` + `packageVersion === GENTLE_AI_VERSION` assertion); start (discriminate `consent/v2` via `action: "consent_required"` before decode, raise `NativeReviewConsentRequiredError`, widen `NativeStartResult["state"]`); finalize (surface `validation_request`/`escalation`); validate (also surface optional `delivery`) and bind-sdd (constant only); status (add `--next-transition`, decode `next_transition`, add `authority_target_identity`/`validation_request`/`final_verification_retry`, and a pre-decode typed refusal for an unimplemented `next_transition.execute.operation`); failure envelope (`decodeReviewFailureV2`). Also fixed a real gap discovered live against the pinned v2.2.2 binary: `next_transition.execute` carries an optional `command` field the mirrored fixture never exercised (fixture only covers the `collect` variant) — added as optional to `decodeReviewNextTransitionV3` in `lib/review-integration-v2.ts`.
- [x] 9.3 `lib/native-review-cli.ts` — add negotiated `repair(request)` method (`preflight` then `execute`, inputs from preflight's `provider_inputs`); `repairLegacyAlias` stays unchanged, no `--contract` (test-asserted). Execute-mode argv beyond `--mode` is INFERRED from `provider_inputs` field names — no `repair/v2` fixture is mirrored upstream to ground-truth it; flagged as a risk.
- [x] 9.4 `lib/native-review-cli.ts` — add `captureEvidence({cwd, lineageId, targetIdentity, expectedRevision, outcome, evidenceDocument})` via the existing 0o600 tmpfile staging discipline, decoding `gentle-ai.review-verification-evidence/v2` directly (not wrapped in an operation envelope) — argv and response shape pinned to a real v2.2.2 review run (lineage `review-b39d803b68a90767`) per the live-observed provider facts.
- [x] 9.5 `lib/native-review-cli.ts` — half-upgraded-install failures: capabilities-decode-failure rewrap naming `GENTLE_AI_VERSION`; `verifyVersion` message names expected/found version.
- [x] 9.6 `extensions/gentle-ai.ts` — type import renamed `ReviewStatusV1` → `ReviewStatusV3` from `./review-integration-v2.ts` (4 usages); no v1 contract literal existed in this file to flip. **Deviation, reported not silently resolved**: lifecycle wiring to `resolveCorrectionStep`/`captureEvidence` was NOT added to `extensions/gentle-ai.ts`. There is no existing call site reading `status.nextTransition`/`status.validationRequest` anywhere in this 5800+ line file, and no RED test in this task list requires one; the FINALIZE handler's existing `correction_line_forecast`/`validationAttempt` machinery is a separate, already-tested, older correction workflow. Wiring a new, untested control-flow path into this file's FINALIZE handler was judged out of scope for an apply batch without a spec/design-level test requiring it — the two new client methods are ready to be wired by a future task once a call site is designed.
- [x] 9.7 `scripts/build-git-commit-transaction-runner.mjs:9` — `sources[1]` `"review-integration-v1"` → `"review-integration-v2"`.
- [x] 9.8 Regenerate `runtime/*.mjs` via `node scripts/build-git-commit-transaction-runner.mjs --write` (never hand-edit).
- [x] 9.9 `scripts/verify-package-files.mjs` — `requiredPaths` `lib/`+`runtime/` entries v1 → v2.
- [x] 9.10 `scripts/test-packed-runner.mjs` — `--contract` argv v1 → v2; accepted-schema list → `capabilities/v2`; `capabilities.contract` equality literal. Verified end-to-end via `pnpm run test:packed-runner` (real `npm pack`+install+binary probe).
- [x] 9.11 `tests/package-manifest.test.ts` — packedRunner contract-literal regex v1 → v2.

### Phase 10 [RELEASE-GATED]: test-file literal updates (same commit)

- [x] 10.1 `tests/native-review-parity-runtime.test.ts` — real-binary `--contract` argv v1→v2 in `nextTransition()`. (No separate typed `status/v1`→`status/v3` parse existed in this file — its raw JSON reads were already field-agnostic.)
- [x] 10.2 `tests/native-review-parity.test.ts` — type import → `ReviewStatusV3` from `review-integration-v2.ts`; fixture `contract`/`schema` literals → v2/v3; added the required `repair` field to the fixture.
- [x] 10.3 `tests/review-controller-native-routing.test.ts` — type import → `ReviewStatusV3`; fixture `contract`/`schema` literals → v2/v3; added the required `repair` field.
- [x] 10.4 `tests/review-controller-workspace-root.test.ts` — type import → `ReviewStatusV3`; fixture `contract`/`schema` literals → v2/v3; added the required `repair` field.
- [x] 10.5 `tests/native-review-cli.test.ts` — comment reference `review-integration-v1` → `review-integration-v2`.
- [x] 10.6 `tests/devbinary/native-review-parity.devtest.ts` — type import, fixture `contract`/`schema` literals, and comment references → v2/v3; added the required `repair` field to both fixtures.

### Phase 11 [RELEASE-GATED]: net-new Stage 2 behavior — TDD within the gated commit

- [x] 11.1 RED→GREEN: unit test in `tests/review-controller-native-recovery.test.ts` — `repairLegacyAlias` argv carries no `--contract` (pre-existing assertion); negotiated `repair` argv does, on every invocation including the capabilities preflight (`lib/native-review-cli.ts`).
- [x] 11.2 RED→GREEN: `pnpm run test:harness` — unimplemented `next_transition.execute.operation` (`review.dispose-result`) raises typed `unsupported-transition-operation` naming the operation; confirmed the client never issues a third invocation. RED confirmed by temporarily removing the check and re-running the harness (failed as expected before the fix).
- [x] 11.3 GREEN: implemented the typed refusal (`assertSupportedNextTransitionOperation`) in `lib/native-review-cli.ts`'s `targetStatus()`, checked against the raw pre-decode body before any decode is attempted; 11.1 and 11.2 pass.
- [x] 11.4 GREEN (integration): `pnpm run test:harness` passes in full post-migration, including the three Phase-3 settling tests, against the real pinned v2.2.2 binary where those tests spawn it (the candidate-drift and no-shell settling tests use an injected `CandidateViewRegistry`/fake native client by design, unchanged from Phase 3; this task did not add new binary-spawning coverage for those two beyond what Phase 3 established).

### Phase 12 [RELEASE-GATED]: verification

- [x] 12.1 Verify: `pnpm test` green — parity + binary suites run for real, 12/12 pass, 0 unexpected skips.
- [x] 12.2 Verify: `pnpm run check:transaction-runner` green.
- [x] 12.3 Verify: `node scripts/verify-package-files.mjs` green (129 files; 64 contract artifacts).
- [x] 12.4 Verify: relies on the pre-existing, unit-tested `requireNativeBinary`/loud-skip mechanism (Phase 4, unchanged by this batch; 14/14 gate unit tests pass including the new dev-binary extension). Did NOT re-run the live "binary removed" scenario against a temp copy of the real package root in this batch: the hard constraint forbids moving/deleting `.gentle-ai/`, and a full filesystem copy of the live repo (including its own `.git/gentle-ai/candidate-views/` read-only worktrees) is unsafe to attempt from inside a running instance of the same repo. Reported rather than silently skipped.
- [x] 12.5 Verify: final test count — 22 v1 tests deleted (18+4), offset by the 23 Stage-1 v2 decoder tests already present; this batch added 8 further tests (1 sddStatus fix test, 1 negotiated-repair argv test, 6 dev-binary gate tests) plus 1 harness-only scenario (not counted by `node:test`). Final `pnpm test`: 907 tests / 906 pass / 0 fail / 1 skip (Windows-only, unchanged). No unexplained deviation.

## Phase 13 [RELEASE-GATED]: v2.2.2 re-pin delta

Folded in from `phase-13-v2.2.2-delta.md` now that Phases 1–12 have landed (see that file for full narrative and provenance discipline).

- [x] 13.0–13.11, 13.14 — v2.2.2 re-pin (base URL, installer assets, `GENTLE_AI_VERSION`, `NATIVE_CLI_CONTRACTS["2.2.2"]`, `verify-package-files.mjs` version labels, installer/package-manifest test literals, `native-review-capability-contract.test.ts`, runtime regeneration) — completed by an earlier batch, unchanged by this one.
- [x] 13.12 Terminology: `lib/native-review-cli.ts`'s `sddStatus` path was never involved (that bug is 13.13); the STRING itself — "review-driven development" → "receipt-driven development" — is Pi's own hardcoded template in `extensions/gentle-ai.ts` (`nativeReviewModeSkipped`'s `reason`, and the `/gentle:review-mode` command's `report`), not text echoed from the binary. Updated both templates plus all 10 assertions across `tests/devbinary/native-review-parity.devtest.ts` (4) and `tests/native-review-parity.test.ts` (6 — the task's cited 172/190/447/462 plus 631/642, which also assert against the same templates and would otherwise have broken). Extended the Phase 4 loud-skip gate to the devbinary suite (`requireDevBinary` in `tests/support/native-binary-gate.ts`, gated on its own `GENTLE_PI_REQUIRE_DEV_BINARY` env var so ordinary CI without a dev binary keeps skipping by default) so this class of drift cannot hide again; 6 new RED→GREEN unit tests in `tests/native-binary-gate.test.ts`.
- [x] 13.13 Archive deadlock: fixed both parts in `lib/native-review-cli.ts`'s `NativeReviewCliV214.sddStatus` — `reviewGate` now decodes an optional `delivery` key (previously exact-key-rejected the payload outright when the kill switch is off); `ready` now also unblocks when `reviewGate.delivery === "disabled/unmanaged"`, not only on `result === "allow"`. RED→GREEN verified (temporarily reverted the fix, confirmed the new test failed with `schema-incompatible`, restored).
