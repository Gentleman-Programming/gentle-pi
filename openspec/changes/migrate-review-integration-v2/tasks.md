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

- [ ] 3.1 RED: `tests/review-candidate-view.test.ts` — `deriveChangedPathManifest` shape and all six failure modes: `manifest-path-set-drift`, `manifest-mode-drift`, `manifest-status-drift`, `manifest-intended-untracked-not-subset`, `manifest-input-divergence`, `manifest-subject-drift`.
- [ ] 3.2 GREEN: `lib/review-candidate-view.ts` — add `ChangedPathEntry`, optional `manifest?: readonly ChangedPathEntry[]` on `NativeCandidateProjectionDescriptor`, `deriveChangedPathManifest` (`git diff --raw -z --no-ext-diff --find-renames=100% <base> <candidate>`), field-wise comparison replacing the `JSON.stringify` check at `:688`; `intended_untracked` handled as structural subset check (documented deviation from spec's field-wise list), never a derived comparison.
- [ ] 3.3 Threat-matrix RED test (Documentation-like paths): mode-only `100644→100755` divergence rejected even though sorted paths match — `tests/review-candidate-view.test.ts`.
- [ ] 3.4 Threat-matrix RED test (Git repository selection): manifest/projection from a different root rejected — `tests/review-candidate-view.test.ts`.
- [ ] 3.5 Threat-matrix RED test (Commit state): staged vs. workspace projection-kind mismatch rejected — `tests/review-candidate-view.test.ts`.
- [ ] 3.6 GREEN (integration): `pnpm run test:harness` settling test — contributor edit between START and dispatch diverges `candidate_tree`; dispatch fails closed, no substituted view.
- [ ] 3.7 GREEN (integration): `pnpm run test:harness` settling test — review dispatch grants lens agents no shell/Bash tool, candidate reachable only via `Read`.

### Phase 4: loud-skip gate

- [ ] 4.1 RED: `tests/support/native-binary-gate.test.ts` — `requireNativeBinary()` throws when `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` and the binary is unresolved or its digest is unpinned; otherwise returns a printed skip reason.
- [ ] 4.2 GREEN: `tests/support/native-binary-gate.ts` — implement `requireNativeBinary()`.
- [ ] 4.3 `tests/native-review-parity-runtime.test.ts:30` — replace the `resolvedBinary === undefined ? baseTest.skip : baseTest` ternary with `requireNativeBinary()`.
- [ ] 4.4 `tests/gentle-ai-binary.test.ts:23` — replace the `releaseDigestsPinned && existsSync(...)` ternary with `requireNativeBinary()`.
- [ ] 4.5 `.github/workflows/ci.yml` — export `GENTLE_PI_REQUIRE_NATIVE_BINARY=1`.
- [ ] 4.6 Verify: `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` with the binary removed (temp package root) → both suites FAIL, not skip.
- [ ] 4.7 Verify: with the binary installed, both suites still run for real (12 tests, 12 pass, 0 skipped); overall baseline skip count stays 1 (`tests/review-repository.test.ts:52`, Windows-only).

### Phase 5: package-files reconciliation

- [ ] 5.1 RED: fixture-driven test for `scripts/verify-package-files.mjs` — an unlisted `contracts/**` file fails; a `runtime/*.mjs` absent from `sources` fails; a `sources` entry absent from `requiredPaths` fails.
- [ ] 5.2 GREEN: `scripts/verify-package-files.mjs` — `contracts/` ↔ `contractHashes` walk (`unlisted-on-disk` / `listed-but-missing`, `docs/review-integration.md` stays outside the walk root); `sources` ↔ `runtime/*.mjs` ↔ `requiredPaths` three-way walk; add the 13 v2 `contractHashes` entries (9 schemas + 4 fixtures); reword the `:150` drift message to name both lanes.

### Phase 6: docs

- [ ] 6.1 `docs/native-authority-architecture.md`, `README.md`, `skills/gentle-ai/SKILL.md`, `skills/_shared/review-ledger-contract.md` — v2 vocabulary; disambiguate Pi's internal "compact-v2" from provider v2. Do not touch `docs/review-integration.md` (hash-pinned, mirrored).

### Phase 7: Stage 1 close-out

- [ ] 7.1 Verify: `pnpm test` green, no behavior change (`lib/review-integration-v2.ts` still unimported by `lib/native-review-cli.ts`), decoder test count ≥22, baseline `854 tests / 853 pass / 0 fail / 1 skip` unchanged.

---

## Stage 2 — RELEASE-GATED: gentle-ai v2.2.1 published AND pinned

**Do not start any task below until:**
`.gentle-ai/v2.2.1/gentle-ai review capabilities --contract gentle-ai.review-integration/v2` returns a capabilities envelope (protocol major 2) — not `unsupported_contract`.

All tasks in Phases 8–12 land in one atomic commit (per design.md's atomicity decision, driven by the generated-runtime coupling in `tests/native-review-parity-runtime.test.ts:13-14`, not by provider constraint — v2.2.1 may still serve v1).

### Phase 8 [RELEASE-GATED]: pin bump

- [ ] 8.0 Gate check: run the capabilities probe above; STOP if it fails.
- [ ] 8.1 `scripts/gentle-ai-installer.mjs:22,26` — `RELEASE_BASE_URL` → `.../v2.2.1/`, `INSTALLER_VERSION = "2.2.1"`.
- [ ] 8.2 `scripts/gentle-ai-installer.mjs:47-52` — `GENTLE_AI_RELEASE_ASSETS`: 4 targets × (`name`, `sha256` from signed `checksums.txt`, `binarySha256` computed from extracted executables) = 12 literals.
- [ ] 8.3 `lib/gentle-ai-binary.ts:8` — `GENTLE_AI_VERSION = "2.2.1"`.
- [ ] 8.4 `lib/native-review-cli.ts:540-541` — add `NATIVE_CLI_CONTRACTS["2.2.1"]` row (copy `"2.2.0"` column).
- [ ] 8.5 `scripts/verify-package-files.mjs:182` — both `2.2.0` literals → `2.2.1`.
- [ ] 8.6 `tests/gentle-ai-installer.test.ts:25-28` — update EXPECTED asset table (12 digest literals).
- [ ] 8.7 `tests/package-manifest.test.ts:277-278` — regexes → `2\.2\.1`.

### Phase 9 [RELEASE-GATED]: import flip, six `--contract` sites, v1 deletion

- [ ] 9.1 Delete `lib/review-integration-v1.ts`, `runtime/review-integration-v1.mjs`, `tests/review-integration-v1.test.ts`, `tests/native-review-integration-v1.test.ts`.
- [ ] 9.2 `lib/native-review-cli.ts` — import flip to `./review-integration-v2.ts`; capabilities `:1570` (`decodeReviewCapabilitiesV2` + `packageVersion === GENTLE_AI_VERSION` assertion); start `:1623` (discriminate `consent/v2` via `action: "consent_required"` before decode, raise `NativeReviewConsentRequiredError`, widen `NativeStartResult["state"]`); finalize `:1687` (surface `validation_request`/`escalation`); validate `:1714` and bind-sdd `:1733` (constant only); status `:1756` (add `--next-transition`, required `decodeReviewRepairV2`, decode `next_transition`, add `authority_target_identity`/`validation_request`/`final_verification_retry`); failure envelope `:1552` (`decodeReviewFailureV2`).
- [ ] 9.3 `lib/native-review-cli.ts` — add negotiated `repair(request)` method (`preflight` then `execute`, inputs from preflight's `provider_inputs`); `repairLegacyAlias` (`:1379`) stays unchanged, no `--contract`.
- [ ] 9.4 `lib/native-review-cli.ts` — add `captureEvidence({cwd, lineageId, outcome, evidenceDocument})` via the existing 0o600 tmpfile staging discipline (`:1104-1122`), decoding `gentle-ai.review-verification-evidence/v2`.
- [ ] 9.5 `lib/native-review-cli.ts` — half-upgraded-install failures: capabilities-decode-failure rewrap naming `GENTLE_AI_VERSION`; `verifyVersion` message names expected/found version.
- [ ] 9.6 `extensions/gentle-ai.ts` — descriptor source at `L5067`/`L5068`/`L5281` (pre-commit gate keeps explicit `status.projection` fallback), lifecycle wiring to `resolveCorrectionStep`/`captureEvidence`, v1 contract literal → v2.
- [ ] 9.7 `scripts/build-git-commit-transaction-runner.mjs:9` — `sources[1]` `"review-integration-v1"` → `"review-integration-v2"`.
- [ ] 9.8 Regenerate `runtime/*.mjs` via `pnpm run check:transaction-runner -- --write` (never hand-edit).
- [ ] 9.9 `scripts/verify-package-files.mjs:46,51` — `requiredPaths` `lib/`+`runtime/` entries v1 → v2.
- [ ] 9.10 `scripts/test-packed-runner.mjs:60-61` — `--contract` argv v1 → v2; accepted-schema list `capabilities/v1`,`capabilities/v1.1` → `capabilities/v2`; `capabilities.contract` equality literal.
- [ ] 9.11 `tests/package-manifest.test.ts:207-208,219` — `packedRunner` reference and v1 contract literal → v2.

### Phase 10 [RELEASE-GATED]: test-file literal updates (same commit)

- [ ] 10.1 `tests/native-review-parity-runtime.test.ts` — `:32` digest source, `:167` real-binary argv v1→v2, parsed shape `status/v1`→`status/v3`.
- [ ] 10.2 `tests/native-review-parity.test.ts` — `:19` type import, `:303`/`:312` fixture literals.
- [ ] 10.3 `tests/review-controller-native-routing.test.ts` — `:26` type import, `:310`/`:339` fixture literals.
- [ ] 10.4 `tests/review-controller-workspace-root.test.ts` — `:11` type import, `:119`/`:147` fixture literals.
- [ ] 10.5 `tests/native-review-cli.test.ts` — `:679` comment reference.
- [ ] 10.6 `tests/devbinary/native-review-parity.devtest.ts` — 6 v1 references → v2.

### Phase 11 [RELEASE-GATED]: net-new Stage 2 behavior — TDD within the gated commit

- [ ] 11.1 RED: unit test — `repairLegacyAlias` argv carries no `--contract`; negotiated `repair` argv does (`lib/native-review-cli.ts`).
- [ ] 11.2 RED: `pnpm run test:harness` — unimplemented `next_transition.execute.operation` (e.g. `dispose-result`) raises typed `unsupported-transition-operation` naming the operation; Pi never synthesizes an invocation.
- [ ] 11.3 GREEN: implement the typed refusal in `lib/native-review-cli.ts` status handling (folds into 9.2/9.6); confirm 11.1 and 11.2 pass.
- [ ] 11.4 GREEN (integration): `pnpm run test:harness` — the three settling tests (no shell/Bash on dispatch; contributor edit fails closed; mode-only/type-change manifest divergence rejected) now exercised against the real pinned v2.2.1 binary.

### Phase 12 [RELEASE-GATED]: verification

- [ ] 12.1 Verify: `pnpm test` green — parity + binary suites run for real, 12/12 pass, 0 unexpected skips.
- [ ] 12.2 Verify: `pnpm run check:transaction-runner` green.
- [ ] 12.3 Verify: `node scripts/verify-package-files.mjs` green.
- [ ] 12.4 Verify: `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` with the binary removed (temp package root) → both suites FAIL, not skip.
- [ ] 12.5 Verify: final test count — 22 v1 tests deleted, offset by ≥22 Stage-1 v2 decoder tests; skip count stays 1 (Windows-only); explicitly report any deviation.
