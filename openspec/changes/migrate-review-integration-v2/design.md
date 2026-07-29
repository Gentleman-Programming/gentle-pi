# Design: migrate gentle-pi to `review-integration/v2`

## Technical Approach

`lib/review-integration-v2.ts` succeeds `-v1.ts` as the single strict decoder. `lib/native-review-cli.ts`
swaps the contract constant and grows the surface each call site needs, and gains one net-new negotiated
`review repair` site. A new pure `lib/review-correction-lifecycle.ts` holds the evidence-first branch
machine. `lib/review-candidate-view.ts` binds to the provider manifest and compares field-wise. The v1
lib, its generated runtime, and both v1 test files die in the same commit as the switchover.

The sequencing is driven by one hard external fact established below: **the currently pinned binary
cannot speak contract v2 at all**, so the switchover is not "fixture-testable now".

## Architecture Decisions

### Decision: the pinned binary rejects v2 — the switchover is release-gated, not fixture-gated

Verified against the pinned package-local executable (`.gentle-ai/v2.2.0/gentle-ai`):

```
review capabilities --contract gentle-ai.review-integration/v2
  → {"schema":"gentle-ai.review-integration.failure/v1","code":"unsupported_contract"}
review capabilities --contract gentle-ai.review-integration/v1
  → {"schema":"gentle-ai.review-integration.capabilities/v1.4","protocol":{"major":1,"minor":4}}
```

Contract v2 **and** protocol v1.5 exist only in unreleased gentle-ai `main`. v2.2.0 advertises v1.4.

**Choice**: split the work by *external dependency*, not by "bulk vs. pin". Stage 1 is everything that
never touches contract identity and is green at every commit today. Stage 2 is a **single atomic commit**
containing the pin bump *and* the contract switchover *and* the v1 deletion *and* the runtime
regeneration, authored only after gentle-ai v2.2.1 publishes. No commit in the branch is ever red.

**Why this consequence is unavoidable.** Every negotiated operation routes through
`NativeReviewCliV216.negotiated()` (`lib/native-review-cli.ts:1586-1601`), which always calls
`capabilities()` (`:1562-1584`) first. Flip `REVIEW_INTEGRATION_CONTRACT` and *every* negotiated call
against v2.2.0 dies at capabilities. `tests/native-review-parity-runtime.test.ts` spawns that binary for
real, including a hand-built invocation that hardcodes the v1 contract at `:167`
(`["review","status","--contract","gentle-ai.review-integration/v1","--cwd",…,"--next-transition"]`), and
drives the real controller through `createGentleAiExtension` (`:11`). `tests/gentle-ai-binary.test.ts`
resolves and executes the same pinned binary.

**Alternatives considered**

| Option | Why rejected |
|---|---|
| Pin first, switch over in a later commit | v2.2.1 does not exist yet, so the pin cannot move earlier in wall-clock time. Worse, it assumes v2.2.1 still serves contract v1; if it does not, the intermediate commit is red. Atomic Stage 2 is immune to that unknown. |
| Quarantine the binary suites for a bounded window | Requires a `skip` that the change itself is trying to abolish (see the loud-skip decision). A quarantine is only survivable with an expiry that *fails* — e.g. `GENTLE_PI_BINARY_QUARANTINE_UNTIL` compared against the clock, throwing after the date. That machinery is net-new, untested, and exists solely to tolerate a red window that atomic Stage 2 removes entirely. Rejected. |
| Author Stage 2 against a locally built gentle-ai `main` binary | Digests cannot be pinned from an unpublished build; `scripts/verify-package-files.mjs:158-167` hard-fails prepack on any non-SHA-256 digest, by design. |

**Rationale**: the only true blocker is the published release. Making Stage 2 atomic converts a
multi-commit red window into a single commit that is red *only in the author's working tree*, never on
the branch. The one PR stays open (draft) across the gate; that is the honest cost, and it is cheaper
than inventing quarantine infrastructure.

**If v2.2.1 slips**: Stage 1 is behavior-neutral (the new module is unimported until Stage 2) and
independently revertible. It does not satisfy the change's success criteria on its own — `sdd-verify`
must fail the change until Stage 2 lands.

### Decision: primitives copied verbatim; identity helpers reshaped; five decoders are net-new

| Verbatim | Reshaped | Deleted |
|---|---|---|
| `record` `exactRecord` `text` `nonempty` `boolean` `integer` `enumeration` `canonicalJson` `array` `stringArray` `enumArray` `sha256` `gitTree` `lineage` `safePath` `assertExactSet` `assertSupersetOf` | `requireIdentity` (v2 constant); capabilities decoder (major 2, minor ≥ 0, 22 schemas, 10 mandatory + 17 optional) | `requireVersionedIdentity`; `SCHEMA_SUCCESSORS_FROM_MINOR_3` |

**Alternatives rejected**: a shared `lib/contract-decoding.ts`; an in-place rewrite of `-v1.ts`.
Extraction during a rewrite is exactly where `exactRecord`'s exact-key discipline dies, and one shared
helper can later be relaxed for one caller and weaken both lanes. `exactRecord` keeps
`allowAdditional = false`, its required-key loop, and its allowed-set rejection unchanged; every decoder
passes explicit required/optional lists. `requireVersionedIdentity` goes because every v2 payload pins one
`const` schema. `assertSupersetOf` stays for operations/schemas (the v2.2.0 lesson: exact-match rejected a
compatible minor); `assertExactSet` for gates, projections, mandatory features.

#### Export surface of `lib/review-integration-v2.ts`

```ts
export const REVIEW_INTEGRATION_CONTRACT = "gentle-ai.review-integration/v2";
export const REVIEW_INTEGRATION_OPERATION = { …, REPAIR: "review.repair" } as const;
// retained enums/unions, identity-neutral: REVIEW_AUTHORITY_APPLICABILITY, REVIEW_REPLAYABILITY,
// REVIEW_MUTATION_OUTCOME, REVIEW_PROJECTION, REVIEW_PROJECTION_KIND, REVIEW_AUTHORITY_VERSION,
// REVIEW_START_STATE (widened), REVIEW_STATUS_ACTION_DISPOSITION

export function decodeReviewCapabilitiesV2(value: unknown, verifiedExecutableDigest: string): ReviewCapabilitiesV2;
export function decodeReviewStartV3(value: unknown): ReviewStartV3;
export function decodeReviewConsentV2(value: unknown): ReviewConsentV2;              // net-new
export function decodeReviewStatusV3(value: unknown): ReviewStatusV3;
export function decodeReviewNextTransitionV3(value: unknown): ReviewNextTransitionV3; // net-new
export function decodeReviewArtifactSubjectV2(value: unknown): ReviewArtifactSubjectV2; // net-new
export function decodeReviewProjectionV1(value: unknown): ReviewProjectionDescriptorV1; // identity stays /v1
export function decodeReviewFailureV2(value: unknown): ReviewFailureV2;
export function decodeReviewOperationV2(value: unknown): ReviewOperationV2;
export function decodeReviewRepairV2(value: unknown): ReviewRepairV2;                 // net-new
export function decodeAuthorityRepairAssessmentV1(value: unknown): AuthorityRepairAssessmentV1; // net-new

export type ReviewCapabilitiesV2, ReviewStartV3, ReviewConsentV2, ReviewStatusV3,
  ReviewNextTransitionV3, ReviewCollectInputV3, ReviewArtifactSubjectV2, ChangedPathEntry,
  ReviewProjectionDescriptorV1, ReviewFailureV2, ReviewOperationV2, ReviewRepairV2,
  AuthorityRepairAssessmentV1, ReviewIntegrationOperation, ReviewStartState, …;
```

`decodeReviewProjectionV1` keeps its v1 name because the v2 capabilities schema list itself still
advertises `gentle-ai.review-integration.projection/v1`
(`contracts/review-integration/v2/fixtures/capabilities.fixture.json:36`). Renaming it would be the same
kind of lie the module rename is meant to remove.

#### Correction: `repair/v2` and `admitted-result/v2` are **not** free

The prior revision claimed both were "v1 shapes — reuse the v1 field logic". That was wrong. `-v1.ts`
exports six `decodeReview*V1` functions (capabilities `:548`, start `:638`, projection `:687`, status
`:706`, failure `:812`, operation `:836`); `native-review-cli.ts:11-15` imports five of them. **None**
decodes repair, consent, artifact-subject, or admitted-result. `repair` exists in `-v1.ts` only as an
optional *status* key accepted and discarded at `:710`; `admitted-result` appears nowhere in `lib/`.

`contracts/review-integration/v2/schemas/repair.schema.json` `$ref`s v1 schema *fragments* — that is JSON
Schema reuse, not TypeScript reuse. The decoder is net-new and non-trivial:
`mode` (`preflight|execute`), `assessment` (→ `authority-repair-assessment.schema.json`, itself
undecoded in Pi today), `provider_inputs` (7 required keys, all `const`-pinned), `required_inputs`
(cardinality varies by mode and assessment status), `execution` (10 required keys), plus the two
conditional `allOf` invariants at v1 `repair.schema.json:53-157` (execute ⇒ `execution` present,
`provider_inputs` absent, `required_inputs` empty; eligible preflight ⇒ `provider_inputs` present and
`required_inputs` exactly `["actor","reason","maintainer_authorization"]` in order).

**`admitted-result/v2` gets a schema-list entry, not a decoder.** Distinguish two costs: appearing in the
22-entry `REQUIRED_SCHEMAS` superset list is a string literal (free); a decoder is code. Pi has no call
site that consumes a provider-admitted reviewer result, so adding `decodeReviewAdmittedResultV2` would
ship dead strict-decoding surface. If a consuming call site appears, it is a separate change.

Net-new decoder budget: **consent/v2, next-transition/v3, artifact-subject/v2, repair/v2,
authority-repair-assessment/v1** — five, of which repair + assessment are the largest.

### Decision: manifest-bound descriptor, compared field-wise

`NativeCandidateProjectionDescriptor` gains `manifest?: readonly ChangedPathEntry[]`. Source it from
`next_transition.collect.inputs[]` where `capture_operation === "review.capture-result"`
(`contracts/review-integration/v2/schemas/status.schema.json:77`). A new `deriveChangedPathManifest` runs
one `git diff --raw -z --no-ext-diff --find-renames=100% <base> <candidate>` and yields
`{path, status, old_mode, new_mode, deleted, type_changed, mode_only}`; `mode_only` is
`old_sha === new_sha && old_mode !== new_mode`. Comparison is key-by-key over the union of paths and
replaces the `JSON.stringify` path equality at `lib/review-candidate-view.ts:688`, which it subsumes.
`deriveChangedScope` is untouched.

**Declared deviation from the review-orchestration spec.** The spec's field-wise list names
`intended_untracked`. Pi handles it as a **structural subset check** (every entry must be a member of the
manifest path set and must never be `deleted`), **not** as a derived field-wise comparison. Rationale:
`intended_untracked` is provider-only knowledge — an untracked path's "intendedness" is a decision the
provider recorded at START, and no Git command Pi can run reproduces it. Deriving it would mean inventing
a value and then comparing the invention against the provider's truth, which is worse than not comparing.
This is a deliberate deviation, not an omission; `sdd-verify` should read it as such.

**Failure modes** (all `CandidateViewError`, all before any native mutation): `manifest-path-set-drift`,
`manifest-mode-drift` (mode-only or type change — today's check accepts these), `manifest-status-drift`,
`manifest-intended-untracked-not-subset`, `manifest-input-divergence` (two capture inputs disagree on
`base_tree`/`candidate_tree`/manifest digest), `manifest-subject-drift`
(`artifact_subject.base_tree`/`candidate_tree` ≠ the input's). Reviewer dispatch **requires** the
manifest; only the pre-commit gate path (`extensions/gentle-ai.ts:5281`, where no reviewer sees the
candidate) may fall back to `status.projection`, and that fallback is explicit, never silent.
`artifact_subject.changed_path_manifest_sha256` is cross-checked across inputs but not recomputed — the
provider's canonicalization is unspecified in the mirrored contract.

### Decision: correction lifecycle as a pure module, with distinct immutable evidence per attempt

Pi does not route from `next_transition` today; it drives its own start→dispatch→finalize flow. Rather
than grow `extensions/gentle-ai.ts` (5000+ lines), the branch machine is a pure
`resolveCorrectionStep(status, evidence) → CorrectionStep` in `lib/review-correction-lifecycle.ts`,
unit-testable with no subprocess. The client gains one method,
`captureEvidence({cwd, lineageId, outcome, evidenceDocument})`, staged through the same 0o600 tmpfile
discipline `finalize` uses (`lib/native-review-cli.ts:1104-1122`), decoded against
`gentle-ai.review-verification-evidence/v2`.

| Outcome | Step | Rule |
|---|---|---|
| `passed` | re-query STATUS, expect `external.run_targeted_validation` + `validation_request`, run validator, FINALIZE `--validation` | only `passed` unlocks targeted validation |
| `verification_failed` | return actionable "change candidate, re-capture" | transaction stays open; no attempt, changed-line charge, or budget consumed; never auto-retry |
| `procedural_tooling_failed` | terminal escalation | no reviewer, correction, or validator afterwards; one blocked human decision |

**Distinct immutable evidence directory** (spec requirement, previously uncovered). The provider owns the
evidence directory; Pi's obligations are three, and all three are testable without the provider:

1. `captureEvidence` stages through a fresh `mkdtemp` per invocation and **never** accepts a
   caller-supplied output path — the staging path cannot be reused across attempts by construction.
2. `resolveCorrectionStep` on `verification_failed` returns a step carrying the *previous* attempt's
   `evidenceIdentity` in a `supersedes` field and requires a **new** capture; it never returns a step that
   re-submits the same candidate bytes or reuses the prior identity.
3. After a second capture, Pi asserts the provider returned a **different** `evidence_identity` and that
   the first evidence record is still resolvable and byte-unchanged. A provider that returns the same
   identity, or whose first record has changed, is a `correction-evidence-replaced` hard failure.

Evidence-first: capture precedes any targeted-validation request. **Alternative rejected**: inlining the
branches beside the existing `validationAttempt`/`correctionForecast` conditionals — untestable without
spawning the binary, and the single-correction invariant would be enforced by control flow instead of
data.

### Decision: negotiated `review repair` is a new call site; `repair-legacy-alias` stays unnegotiated

The spec requires repair to pass the v2 contract identifier. Pi's only repair-shaped invocation today is
`repairLegacyAlias` (`lib/native-review-cli.ts:1371-1391`), whose argv at `:1379-1387` carries **no**
`--contract` and whose response decodes via `decodeNativeMaintenanceResult`, not `repair/v2`. These are
two different operations and must not be conflated.

**Choice**: add a negotiated `repair(request)` method on `NativeReviewCliV216` invoking
`["review","repair","--contract",REVIEW_INTEGRATION_CONTRACT,"--cwd",cwd,"--mode",mode,…]` and decoding
`repair/v2`. `review.repair` is advertised in the v2 operation list
(`contracts/review-integration/v2/fixtures/capabilities.fixture.json:21`). `repairLegacyAlias` keeps its
current unnegotiated argv, and a test asserts it carries **no** `--contract`.

**Alternatives considered**: (a) add `--contract v2` to `repair-legacy-alias` — rejected: it is not in the
v2 advertised operation list, and pairing a contract identifier with an unadvertised operation invites the
provider to reject the whole invocation; (b) drop `repairLegacyAlias` — out of scope, and it is the only
recovery path for the historical alias class.

### Decision: v2.2.1 maintenance operations stay legacy-gated, `dispose-result` stays unsupported

The four maintenance CLIs — `abandon` (`:1303`), `quarantine-legacy` (`:1323`), `reconcile-authority`
(`:1355`), `repair-legacy-alias` (`:1379`) — are absent from the v2 advertised operation list. They are
gated by the legacy `NATIVE_CLI_CONTRACTS` table (`:511-541`) via `verifyVersion` (`:1032-1048`), which
rejects any version key it does not know (`:1045-1046`).

| Spec obligation | Design response |
|---|---|
| Fresh interactive approval | `maintainerAuthorization` is computed only after a fresh approval through `lib/review-consent-latch.ts`; the existing exact-binding assertions (`:1375-1376`) stay unchanged. No cached or inferred approval. |
| Shell-free exact argv | Already satisfied: fixed `execFile` array, no shell, `isCanonicalProcessString` on every interpolated value (`:1372-1374`). |
| Audit record only from a valid response envelope | Already satisfied: `decodeNativeMaintenanceResult` runs *before* the non-zero-exit throw (`:1388-1389`), so a partial failure still preserves a decoded record. |
| Repair inputs derived from fresh native inventory | The negotiated `repair` call runs `--mode preflight` first; `repository_binding`, `lineage_id`, `expected_revision`, `cause`, `disposition` are read from that response's `provider_inputs` and passed straight back to `--mode execute`. Pi-side constants (`NATIVE_REVIEW_LEGACY_ALIAS_REPAIR`, `:222`) are used **only** to reject a provider response that disagrees, never as a source. |
| `dispose-result` unsupported | Not implemented, no argv, no decoder. Generalized: if a provider `next_transition.execute.operation` names an operation Pi does not implement, Pi raises typed `unsupported-transition-operation` naming the operation and stops — it never synthesizes an invocation. |

`NATIVE_CLI_CONTRACTS` gains a `"2.2.1"` row in Stage 2 (same commit as the pin), copying the `"2.2.0"`
column values; without it every maintenance operation fails version verification.

### Decision: half-upgraded install fails hard, naming the expected pinned version

Today `verifyVersion` throws `"native gentle-ai lacks required capabilities"` (`:1046`) and the negotiated
path throws `"package-local native executable identity could not be verified"` (`:1525`) — neither names
a version. `decodeReviewCapabilitiesV1` decodes `package.version` (`:569`) and never checks it.

**Choice**: three edits, all naming `GENTLE_AI_VERSION`, which `native-review-cli.ts` already imports
(`:8`).

1. `NativeReviewCliV216.capabilities()` asserts `capabilities.packageVersion === GENTLE_AI_VERSION` after
   decoding and throws `expected gentle-ai v{GENTLE_AI_VERSION}, provider reported v{observed}`.
2. Any capabilities *decode* failure is rewrapped with `expected gentle-ai v{GENTLE_AI_VERSION}; the
   installed runtime is incompatible — reinstall gentle-pi`. This is the `.gentle-ai/` half-upgrade path:
   an older runtime answers `unsupported_contract` for v2 and the message must say which version is wanted.
3. `verifyVersion`'s message gains `expected v{GENTLE_AI_VERSION}, found v{observed ?? "unparseable"}`.

The assertion lives in the client, not the decoder, so `lib/review-integration-v2.ts` stays a pure
contract decoder with no dependency on the pin. `lib/gentle-ai-binary.ts:14` already names the version for
the *missing*-binary case; this closes the *wrong*-binary case.

### Decision: `verify-package-files.mjs` reconciles against `contractHashes` and against `sources`

Two lists exist and they are not interchangeable. `requiredPaths`
(`scripts/verify-package-files.mjs:10-76`) is a hand-maintained existence list covering assets, skills,
prompts, `lib/`, `runtime/`, and scripts. `contractHashes` (`:78-126`) is a path→sha256 map, and `:128`
pushes its keys into `requiredPaths`. Nothing walks the filesystem, so a **new** file under `contracts/`
is invisible to both.

**Choice**: two reconciliations, both before the existing hash loop at `:144`.

1. **`contracts/` ↔ `contractHashes`.** Walk `contracts/` recursively (files only) and require the walked
   set to equal `Object.keys(contractHashes)` restricted to `contracts/`, reporting `unlisted-on-disk` and
   `listed-but-missing` as separate lists. `contractHashes` is the reconciliation target;
   `requiredPaths` is not, because it is a strict superset spanning non-contract assets.
   `docs/review-integration.md` (`:125`) stays in `contractHashes` but outside the walk root.
2. **`sources` ↔ `runtime/*.mjs` ↔ `requiredPaths`.** Three-way: the generator's `sources` array
   (`scripts/build-git-commit-transaction-runner.mjs:9-14`) must equal the `.mjs` basenames on disk in
   `runtime/`, which must equal the `runtime/` entries in `requiredPaths` (`:48-51`). Deliberately **not**
   a `lib/` ↔ `runtime/` pairing: most `lib/` modules (`review-candidate-view.ts`,
   `review-consent-latch.ts`, `review-correction-lifecycle.ts`, …) are intentionally unpaired, so a
   `lib/`-driven walk would false-positive on Stage 1's unimported `review-integration-v2.ts`. This walk
   is what makes an orphaned `runtime/review-integration-v1.mjs` impossible to survive Stage 2.

Stage 1 adds the 13 `contracts/review-integration/v2/**` entries (9 schemas + 4 fixtures) to
`contractHashes`; v1 entries stay (v2 schemas `$ref` into them). The drift message at `:150` is reworded
to name both lanes rather than "review-integration/v1 … v2.2.0".

### Decision: the generated runtime must exist before the flip — so the flip is one step

`runtime/*.mjs` are generated, never hand-edited; `pnpm run check:transaction-runner` gates prepack via
`verify-package-files.mjs:169-178`. The generator's `sources[1]` is the literal `"review-integration-v1"`
(`scripts/build-git-commit-transaction-runner.mjs:9-14`) and it emits `runtime/<name>.mjs` by rewriting
`.ts` import specifiers to `.mjs` (`:25-27`).

Consequence: the moment `lib/native-review-cli.ts` imports `./review-integration-v2.ts`, the generated
`runtime/native-review-cli.mjs` imports `./review-integration-v2.mjs` — which does not exist until
`sources[1]` changes. And `tests/native-review-parity-runtime.test.ts:13-14` imports **both**
`lib/native-review-cli.ts` and `runtime/native-review-cli.mjs` and compares them, so a stale runtime is an
immediate test failure, not just a `--check` failure.

**Choice**: the import flip, `sources[1]`, the `runtime --write` regeneration, the v1 deletions, and the
`requiredPaths` `lib/`+`runtime/` entry swaps are **one indivisible step**. The previous plan's steps 3
and 6 are merged. This is folded into the single atomic Stage 2 commit.

### Decision: loud skips — the risk is conditional, not currently active

Corrected from the prior revision. Today `tests/native-review-parity-runtime.test.ts` and
`tests/gentle-ai-binary.test.ts` run for real: **12 tests, 12 pass, 0 skipped**, because `pnpm install`'s
postinstall (`scripts/install-gentle-ai.mjs`) installs the pinned binary and the v2.2.0 digests are real.
The suite's single skip is `a Windows drive-letter Git common directory resolves repository authority`
(`tests/review-repository.test.ts:52`, `skip: process.platform !== "win32"`) — platform-gated and
unrelated to the binary.

The self-skip risk is therefore **conditional**: it fires on a fresh clone, an offline install, a
`GENTLE_PI_SKIP_GENTLE_AI_INSTALL=1` environment, or any CI runner where the postinstall did not complete.
In those conditions `resolvedBinary === undefined ? baseTest.skip : baseTest`
(`tests/native-review-parity-runtime.test.ts:30`) and
`releaseDigestsPinned && existsSync(repoRuntimeBinary) ? test : test.skip`
(`tests/gentle-ai-binary.test.ts:23`) silently drop 12 tests to green.

**Choice**: one shared `requireNativeBinary()` in a new `tests/support/native-binary-gate.ts`. When
`GENTLE_PI_REQUIRE_NATIVE_BINARY=1` (set in CI and in the release workflow) an unresolvable binary or
unpinned digest **throws**; otherwise it returns a skip reason that is printed, so a local skip is visible
and a CI skip is impossible. The Windows drive-letter skip is untouched — the post-change baseline still
has exactly **1 skip**, and a claim of zero skips would be wrong.

## Data Flow

    STATUS --next-transition ─→ collect.inputs[] ─→ descriptor{subject, base, candidate, manifest}
              │                                            │
              │                                     candidate-view field-wise check
              ↓                                            ↓
    correction forecast ─→ capture-evidence(--outcome) ─→ resolveCorrectionStep
                                                           ├ passed → targeted validation → FINALIZE
                                                           ├ verification_failed → open; NEW evidence
                                                           │                       identity, prior kept
                                                           └ procedural_tooling_failed → escalate

## File Changes

### Stage 1 — no external dependency, green at every commit

| File | Action | Description |
|---|---|---|
| `lib/review-integration-v2.ts` | Create | v2 decoders, identity, exact-key discipline; unimported until Stage 2 |
| `tests/review-integration-v2.test.ts` | Create | rejection test per decoder; 4 fixture round-trips; 22-schema superset |
| `lib/review-correction-lifecycle.ts` | Create | pure three-branch step resolver |
| `tests/review-correction-lifecycle.test.ts` | Create | 3 outcomes, budget invariant, distinct-evidence invariant |
| `tests/support/native-binary-gate.ts` | Create | `requireNativeBinary()` shared loud-skip gate |
| `lib/review-candidate-view.ts` | Modify | `deriveChangedPathManifest`, optional `manifest` on the descriptor, field-wise check replacing `:688` |
| `scripts/verify-package-files.mjs` | Modify | `contracts/` ↔ `contractHashes` walk; `sources` ↔ `runtime/` ↔ `requiredPaths` walk; +13 v2 hashes; reworded drift message `:150` |
| `tests/native-review-parity-runtime.test.ts` | Modify | replace the `:30` skip ternary with `requireNativeBinary()` |
| `tests/gentle-ai-binary.test.ts` | Modify | replace the `:23` skip ternary with `requireNativeBinary()` |
| `.github/workflows/ci.yml` | Modify | export `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` |
| `docs/native-authority-architecture.md`, `README.md`, `skills/gentle-ai/SKILL.md`, `skills/_shared/review-ledger-contract.md` | Modify | v2 vocabulary; disambiguate Pi's internal "compact-v2" |

`docs/review-integration.md` is **not** edited: it is hash-pinned at
`scripts/verify-package-files.mjs:125` and is a mirrored artifact.

### Stage 2 — one atomic commit, after gentle-ai v2.2.1 publishes

| File | Action | Description |
|---|---|---|
| `lib/review-integration-v1.ts`, `runtime/review-integration-v1.mjs`, `tests/review-integration-v1.test.ts`, `tests/native-review-integration-v1.test.ts` | Delete | same commit |
| `lib/native-review-cli.ts` | Modify | import flip; six existing `--contract` sites; net-new negotiated `repair`; `captureEvidence`; typed transition/consent; version-naming failures; `NATIVE_CLI_CONTRACTS["2.2.1"]` row |
| `scripts/build-git-commit-transaction-runner.mjs` | Modify | `sources[1]` → `"review-integration-v2"` |
| `runtime/*.mjs` | Regenerate | `--write` only; never hand-edited |
| `extensions/gentle-ai.ts` | Modify | descriptor source (L5067/5068/5281), lifecycle wiring, v1 literal |
| `scripts/verify-package-files.mjs` | Modify | `requiredPaths` `lib/`+`runtime/` v1→v2 entries (`:46`, `:51`); version literals `:182` |
| `scripts/test-packed-runner.mjs` | Modify | **previously unlisted.** `:60` argv `--contract` v1→v2; `:61` accepted-schema list `capabilities/v1`,`capabilities/v1.1` → `capabilities/v2`, and the `capabilities.contract` equality literal |
| `tests/package-manifest.test.ts` | Modify | `:219` packed-runner regex; `:277-278` version regexes |
| `tests/native-review-parity-runtime.test.ts` | Modify | `:167` real-binary argv v1→v2 **and** the parsed shape `status/v1`→`status/v3`; `:32` digest source |
| `tests/native-review-parity.test.ts` | Modify | `:19` type import, `:303`/`:312` fixture literals |
| `tests/review-controller-native-routing.test.ts` | Modify | `:26` type import, `:310`/`:339` fixture literals |
| `tests/review-controller-workspace-root.test.ts` | Modify | `:11` type import, `:119`/`:147` fixture literals |
| `tests/native-review-cli.test.ts` | Modify | `:679` comment reference |
| `tests/devbinary/native-review-parity.devtest.ts` | Modify | 6 v1 references |
| `scripts/gentle-ai-installer.mjs` | Modify | pin surface — see below |
| `lib/gentle-ai-binary.ts` | Modify | `:8` `GENTLE_AI_VERSION = "2.2.1"` |
| `tests/gentle-ai-installer.test.ts` | Modify | `:25-28` EXPECTED asset table |

### Pin / digest surface (Stage 2, previously reduced to "the pin commit only")

| Location | Change |
|---|---|
| `scripts/gentle-ai-installer.mjs:22` | `RELEASE_BASE_URL` → `…/releases/download/v2.2.1/` |
| `scripts/gentle-ai-installer.mjs:26` | `INSTALLER_VERSION = "2.2.1"` |
| `scripts/gentle-ai-installer.mjs:47-52` | `GENTLE_AI_RELEASE_ASSETS`: 4 targets × (`name`, `sha256`, `binarySha256`) = 12 literals. Archive `sha256` from the minisign-signed `checksums.txt`; `binarySha256` computed from each extracted executable. |
| `scripts/gentle-ai-installer.mjs:41-46` | Windows rows stay absent unless v2.2.1 publishes signed Windows assets; the comment's version reference updates. |
| `scripts/gentle-ai-installer.mjs:35` | `GENTLE_AI_PENDING_DIGEST` sentinel is **not** used. `verify-package-files.mjs:158-167` hard-fails prepack on any non-SHA-256 digest, so the commit must carry real digests. |
| `lib/gentle-ai-binary.ts:8` | `GENTLE_AI_VERSION = "2.2.1"` |
| `lib/native-review-cli.ts:540-541` | new `NATIVE_CLI_CONTRACTS["2.2.1"]` row |
| `scripts/verify-package-files.mjs:182` | both literal `2.2.0` assertions → `2.2.1` |
| `tests/package-manifest.test.ts:277-278` | regexes → `2\.2\.1` |
| `tests/gentle-ai-installer.test.ts:25-28` | independent duplicate of the 12 digest literals |

### The `--contract` call sites — beyond the constant

| Site | Line | Additional change |
|---|---|---|
| capabilities | 1570 | `decodeReviewCapabilitiesV2`; digest cache unchanged; **new** `packageVersion === GENTLE_AI_VERSION` assertion |
| start | 1623 | START may return `consent/v2` instead of `start/v3` — discriminate on `action: "consent_required"` **before** decoding and raise typed `NativeReviewConsentRequiredError`; typed `artifact_subjects`; conditional `repository_context`/`changed_path_manifest`; `NativeStartResult["state"]` widens by `correction_required`, `validating`. Pi stays headless: **no** `--consent relay` |
| finalize | 1687 | finalize result gains optional `validation_request` (⇒ `state: correction_required`) and `escalation`; surface the request to the lifecycle |
| validate | 1714 | constant only |
| bind-sdd | 1733 | constant only |
| status | 1756 | add `--next-transition` (precondition for the collect-input binding); `repair` now **required** and typed via `decodeReviewRepairV2`; `next_transition` decoded into a value instead of validated-and-discarded; new optional `authority_target_identity`, `validation_request`, `final_verification_retry` |
| **repair** (net-new) | — | `["review","repair","--contract",…,"--cwd",cwd,"--mode",mode]`; `preflight` then `execute`; inputs from the preflight's `provider_inputs` |
| `repair-legacy-alias` | 1379 | **unchanged, deliberately no `--contract`**; asserted by test |
| failure envelope | 1552 | `decodeReviewFailureV2` (adds `progress_identity`, `cause`) |

## Interfaces / Contracts

```ts
// lib/review-candidate-view.ts
export interface ChangedPathEntry {
  readonly path: string;
  readonly status: "A" | "M" | "D" | "R" | "C" | "T";
  readonly oldMode: string | undefined;
  readonly newMode: string | undefined;
  readonly deleted: boolean;
  readonly typeChanged: boolean;
  readonly modeOnly: boolean;
}

// lib/review-correction-lifecycle.ts
export type CorrectionStep =
  | { kind: "run-targeted-validation"; request: TargetedValidationRequest }
  | { kind: "await-changed-candidate"; supersedes: string; actionable: string }
  | { kind: "escalate"; reason: string };

export function resolveCorrectionStep(
  status: ReviewStatusV3,
  evidence: { outcome: "passed" | "verification_failed" | "procedural_tooling_failed"; identity: string },
): CorrectionStep;
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | one rejection test per decoder before implementation (missing required, extra key, wrong identity); all 4 v2 fixtures round-trip; 22-schema superset | `node:test` + `assertRequired`/`assertAdditionalProperty` helpers ported from the v1 test |
| Unit | `repair/v2`: both `allOf` invariants — execute-without-`execution` rejected; eligible-preflight with wrong `required_inputs` order rejected | hand-built payloads validated against the mirrored schema (**no** provider fixture exists for repair) |
| Unit | `resolveCorrectionStep` × 3 outcomes; budget never consumed on `verification_failed` | pure, no spawn |
| Unit | distinct immutable evidence: a second `verification_failed` capture yields a different `evidence_identity`, `supersedes` names the first, the first record is byte-unchanged; identical identity ⇒ `correction-evidence-replaced` | stubbed client, pure assertions |
| Unit | half-upgraded install: a capabilities envelope reporting a different `package.version`, and an `unsupported_contract` failure body, both produce a message containing `v{GENTLE_AI_VERSION}` | stubbed adapter |
| Unit | `repair-legacy-alias` argv contains no `--contract`; negotiated `repair` argv does | argv capture |
| Integration | the three settling tests: no shell/Bash on dispatch; contributor edit between START and dispatch fails closed; mode-only/type-change manifest divergence rejected | `pnpm run test:harness` with a temp repo |
| Integration | `verify-package-files.mjs` fails on an unlisted `contracts/**` file, on a `runtime/*.mjs` absent from `sources`, and on a `sources` entry absent from `requiredPaths` | temp fixture file |
| Integration | unimplemented `next_transition.execute.operation` (e.g. `dispose-result`) raises `unsupported-transition-operation` naming it | stubbed status payload |
| Runtime | parity + binary suites — **12 tests run for real today, 12 pass, 0 skipped**. They are not Phase-B-only. Stage 1 keeps them green (contract untouched, loud-skip gate is a no-op when the binary is present); Stage 2 flips their v1 literals and must land them green in the same commit as the pin | `pnpm test` against the installed pinned binary |
| Runtime | with `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` and the binary removed, both suites **fail** instead of skipping | CI env + temp package root |

Baseline `854 tests / 853 pass / 0 fail / 1 skip` must not lose tests: the two deleted v1 test files are
replaced by `tests/review-integration-v2.test.ts` in Stage 1, before Stage 2 deletes them. The surviving
skip is the Windows drive-letter test and stays.

## Threat Matrix

| Boundary | Applicability | Design response | RED test |
|---|---|---|---|
| Documentation-like paths | Applicable — manifest `new_mode` 100755 and `type_changed` reach reviewers | mode/type carried and compared field-wise; never normalized | mode-only `100644→100755` divergence rejected |
| Git repository selection | Applicable — descriptor binds a contributor root | `realpathSync` + `resolveProjection` root equality kept; manifest never widens scope | projection from a different root rejected |
| Commit state | Applicable — `staged` vs `workspace`, `committed_only` | projection kind still from `status.projection.projection`; collect input carries none | staged/workspace mismatch rejected |
| Push state | N/A — no push automation in this change | | |
| PR commands | N/A — no PR automation in this change | | |
| Subprocess argument composition | Applicable — six existing `--contract` sites, net-new `repair`, `capture-evidence`, and four unnegotiated maintenance CLIs | closed `--outcome` and `--mode` domains; arrays only, no shell string; evidence via 0o600 tmpfile; `isCanonicalProcessString` on every interpolated value; unimplemented transition operations refused, never synthesized | unknown `--outcome` rejected before spawn; `repair-legacy-alias` argv asserted `--contract`-free; unimplemented `execute.operation` refused |

## Migration / Rollout

### Stage 1 — authorable now, no external dependency, `pnpm test` green at every commit

1. `lib/review-integration-v2.ts` + `tests/review-integration-v2.test.ts`. v1 still present and still the
   only imported module; both compile. Green.
2. `deriveChangedPathManifest` + field-wise comparison behind the optional `manifest` field. Green.
3. `lib/review-correction-lifecycle.ts` + its unit tests (pure; no client wiring yet). Green.
4. `scripts/verify-package-files.mjs`: both reconciliations + the 13 v2 `contractHashes` entries. Green.
5. `tests/support/native-binary-gate.ts` + both suite call sites + CI env var. Green (the binary is
   installed; the gate is a no-op).
6. Docs, README, skills — disambiguate Pi's internal "compact-v2". Green.

**Gate: gentle-ai v2.2.1 published**, advertising `gentle-ai.review-integration/v2` and protocol major 2.
Nothing below can be authored, let alone made green, before this. Verify with
`.gentle-ai/v2.2.1/gentle-ai review capabilities --contract gentle-ai.review-integration/v2`.

### Stage 2 — one atomic commit

Pin bump (all rows of the pin/digest table) **+** client import flip **+** all six `--contract` sites
**+** net-new negotiated `repair` **+** `captureEvidence` and lifecycle wiring **+** descriptor sourcing
in `extensions/gentle-ai.ts` **+** `sources[1]` **+** `runtime --write` **+** v1 lib/runtime/test deletion
**+** every v1 literal in `scripts/test-packed-runner.mjs` and the six test files. `pnpm test` green,
`pnpm run check:transaction-runner` green, `node scripts/verify-package-files.mjs` green.

**No quarantine window, no deliberately-red suite.** The tree is red only inside the author's working
directory during Stage 2; no commit on the branch is red, so there is no skip to make permanent and no
expiry mechanism to maintain. The cost is that the single PR remains in draft across the gate — accepted,
because the alternative is inventing quarantine infrastructure whose only purpose is to tolerate a window
this ordering removes.

Delivery unchanged: one PR on `feat/organic-rdd-parity`, accepted `size:exception`, 1200-line review
budget. Rollback: revert the merge commit; `contracts/review-integration/v1/**` stays on disk throughout,
so reverting restores a compiling v1 lane with no contract re-mirroring. Stage 1 is separately revertible
and behavior-neutral.

## Open Questions

- [ ] Does gentle-ai v2.2.1 still serve contract v1? If yes, Stage 2 *could* be split into pin-then-switch;
  the atomic design does not depend on the answer, so this is an optimization, not a blocker.
- [ ] `review capture-evidence` response envelope is not in the mirrored v2 schema set — decoding against
  `verification-evidence/v2` is inference until verified against the real v2.2.1 binary in Stage 2.
- [ ] No `repair/v2` fixture is mirrored (`contracts/review-integration/v2/fixtures/` holds capabilities,
  start, status, consent only). Repair decoder tests use hand-built payloads; a provider-issued fixture
  should be requested upstream.
- [ ] `changed_path_manifest_sha256` canonicalization is unspecified; recomputation deferred to a
  cross-input consistency check only.
- [ ] Does the v2.2.1 `next_transition` ever name `dispose-result`? If so, the typed refusal becomes a
  user-visible blocked decision and needs a message design, not just an error code.
