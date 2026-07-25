```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:7a86b89c0658f78194569b20dc0c1823f87e41811fb432334e86908642922e62
verdict: fail
blockers: 1
critical_findings: 1
requirements: 7/8
scenarios: 11/16
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:80005da3ae3b87b6d93b928e46ea4261344d0d97a5617bf2d0b8813234d9e8e6
build_command: pnpm run check:transaction-runner
build_exit_code: 0
build_output_hash: sha256:a1d1f698ad0c723810e89cdb9fd4c5a9cfd5f64e1d7fa06c3696a5fed754677d
```

## Verification Report

**Change**: organic-rdd-parity
**Version**: N/A (two spec deltas: `organic-review-parity` NEW, `review-routing` ADDED)
**Mode**: Strict TDD
**Branch**: `feat/organic-rdd-parity` @ 10fbd05e (working tree clean; Batch 3 was committed)
**Artifact store**: hybrid

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 19 |
| Tasks complete | 19 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Tests**: 829 passed / 0 failed / 10 skipped (pre-existing)
```text
$ pnpm test
ℹ tests 839
ℹ suites 0
ℹ pass 829
ℹ fail 0
ℹ cancelled 0
ℹ skipped 10
ℹ todo 0
ℹ duration_ms 23787.413453
$ node --experimental-strip-types tests/runtime-harness.mjs
EXIT=0
```

**Package pins**: exit 0
```text
$ node scripts/verify-package-files.mjs
gentle-pi package resource check passed (84 files; 19 exact byte-identical v2.1.11 contract artifacts).
```

**Generated-runtime drift**: exit 0
```text
$ pnpm run check:transaction-runner
$ node scripts/build-git-commit-transaction-runner.mjs --check
commit transaction runtime matches TypeScript sources (4 modules)
```

**Dev-binary journey** (non-gating): exit 0, 5/5 pass against `/home/gentleman/.local/bin/gentle-ai` (`dev-organic-d6c73ff4`)
```text
$ GENTLE_AI_DEV_BINARY=/home/gentleman/.local/bin/gentle-ai pnpm run test:dev-binary
✔ dev-binary: gentle:review-mode round-trips status, disable, and enable against the real binary
✔ dev-binary: an empty candidate stays silent (no consent notice) and surfaces the real hint verbatim
✔ dev-binary: a high-risk change carries real risk_evidence and drives the consent envelope through a fake UI seam
✔ dev-binary: declining the fake-UI consent prompt withholds actor_binding for this work unit only
✔ dev-binary: VALIDATE via lineage auto-discovery decodes the real disabled/unmanaged delivery envelope
ℹ pass 5   ℹ fail 0
```
No allowance for the un-rebuilt binary was needed: no journey assertion depends on gentle-ai's post-29b5161d tier-1 `risk_evidence` behaviour. The tier-2 test drives its own high-risk candidate and reads whatever evidence array the binary emits; the tier-0 test asserts silence plus a verbatim hint. Both hold on the pre-fix binary.

**Coverage**: ➖ Not available (no coverage tool configured in `package.json`).

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Capability-gated activation | Pinned 2.1.11 stays inert | `native-review-capability-contract.test.ts` > "the pinned 2.1.11 row explicitly reports all four organic-parity capabilities false"; "every shipped NATIVE_CLI_CONTRACTS row reports the organic-parity capability columns false"; `native-review-parity.test.ts` > "reviewMode requires the mode capability and fails closed for a version without it"; "START tolerates the exact review-consent-skipped stderr line only when the mode capability is true" (2.1.11 half) | ✅ COMPLIANT |
| Capability-gated activation | Future capable version activates parity | `native-review-parity.test.ts` overlay `CAPABLE_VERSION 9.9.9` (all four columns true) driving "reviewMode status uses the exact fixed argv…", "native START decodes optional riskEvidence … and hint only when present", "native VALIDATE decodes the disabled/unmanaged delivery alternate discriminator at exit 0" | ✅ COMPLIANT |
| Kill-switch consultation | Disabled by prior decision | `native-review-parity.test.ts` > "kill-switch: effective off returns a non-failure skipped envelope and never calls native start" (asserts `status: skipped`, `outcome: review-mode-disabled`, `mutation_performed: false`, `startCalls === 0`) | ✅ COMPLIANT |
| Kill-switch consultation | Command-only re-enable | No test drives "automation never toggles enable". Static proof is exact: only two `reviewMode()` call sites exist in `extensions/gentle-ai.ts` — L3849 with a hardcoded `STATUS` operation inside `resolveReviewModeGate`, and L5996 inside the `gentle:review-mode` command handler. Adjacent runtime evidence: the kill-switch-off test proves the gate mutates nothing. | ⚠️ PARTIAL |
| Kill-switch command surface | Status query | `native-review-parity.test.ts` > "gentle:review-mode command reports status, disables, and enables through explicit user invocation" (asserts the notice reports `off`; no mutation) | ✅ COMPLIANT |
| Kill-switch command surface | Explicit disable | Gating coverage is client-layer only: "reviewMode enable and disable pass --scope clone and mutate without a timeout" (argv + decoded `effective: off`). No gating test drives `disable` through the registered command handler. Full round trip is covered only by the **non-gating** devtest. | ⚠️ PARTIAL |
| Kill-switch command surface | Explicit enable (recovery path) | Same as above (argv + decoded `effective: on`); handler-level coverage only in the non-gating devtest. | ⚠️ PARTIAL |
| Native two-option consent | First-time accept | `native-review-parity.test.ts` > "consent: accepting the prompt records the latch and proceeds with actor_binding"; `review-consent-latch.test.ts` > "recording the latch is one-way … exact canonical bytes at mode 0600" | ✅ COMPLIANT |
| Native two-option consent | Decline is scoped | `native-review-parity.test.ts` > "consent: declining persists nothing, applies only to this work unit, and withholds actor_binding" | ✅ COMPLIANT |
| Native two-option consent | Existing latch skips the prompt | `native-review-parity.test.ts` > "consent: an existing latch skips the prompt and proceeds with actor_binding" (latch wins even when `confirm()` would decline) | ✅ COMPLIANT |
| Headless consent semantics | Headless invocation | `native-review-parity.test.ts` > "consent: headless never blocks, always surfaces a notice, and leaves the latch untouched" (asserts `actor_binding` present, `consent_notice` string, matching `notify(..., "info")`, latch still false) | ✅ COMPLIANT |
| Empty-candidate hint surfaced | Empty candidate with hint | `native-review-parity.test.ts` > "mapNativeStartResult surfaces the empty-candidate hint verbatim and omits risk_evidence when the native result carries none"; devtest tier-0 silence test | ✅ COMPLIANT |
| Verbatim tier reflection | Tier passthrough | `native-review-parity.test.ts` > "mapNativeStartResult passes risk_evidence through verbatim … alongside the unmodified risk_tier passthrough" (asserts `risk_tier === "high"` from native `riskLevel`, no recomputation) | ✅ COMPLIANT |
| Verbatim tier reflection | Missing tier fails closed | No test drives a native START body that omits `risk_level`. Structural proof: `risk_level` is a **required** key of the START `exactObject` (`lib/native-review-cli.ts:958`), so an omission raises `SCHEMA_INCOMPATIBLE` before mapping; `mapNativeStartResult` has no fallback (`risk_tier: result.riskLevel`, L4122). Adjacent runtime evidence: "mapNativeStartResult never fabricates risk_evidence or hint when the native result omits both". | ⚠️ PARTIAL |
| Disabled/unmanaged delivery as success | Disabled delivery (`delivery: disabled`) | `native-review-parity.test.ts` > "native VALIDATE rejects a split disabled-only or unmanaged-only delivery value" — asserts the exact spec value **fails closed** with `SCHEMA_INCOMPATIBLE` | ❌ FAILING (vs. spec text as written) |
| Disabled/unmanaged delivery as success | Unmanaged delivery (`delivery: unmanaged`) | Same test, same assertion | ❌ FAILING (vs. spec text as written) |

**Compliance summary**: 11/16 COMPLIANT, 3 PARTIAL, 2 FAILING.

The requirement *intent* behind the two FAILING scenarios — "a native disabled/unmanaged delivery renders as a successful non-delivery outcome at exit 0, never a failure" — **is** fully proven at three layers: `native-review-parity.test.ts` > "native VALIDATE decodes the disabled/unmanaged delivery alternate discriminator at exit 0"; `review-controller-native-routing.test.ts` > "native VALIDATE delivery disabled/unmanaged renders as a successful skipped envelope before the maintainer-exception check, minting no authorization"; and the dev-binary VALIDATE journey against the real binary. Only the spec's literal wire values are wrong.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| Capability-gated activation | ✅ Implemented | `ORGANIC_PARITY_DARK = { mode: false, riskEvidence: false, hint: false, delivery: false }` spread into all 8 shipped rows (`lib/native-review-cli.ts:422-432`) and mirrored in the generated `runtime/native-review-cli.mjs:423`. |
| Kill-switch consultation | ✅ Implemented | `resolveReviewModeGate` (L3841-3855) returns `undefined` when `reviewMode` is absent, swallows `VERSION_INCOMPATIBLE` as capability-absent, rethrows everything else. Called at L4839, before `targetStatus` (L4866) and `start` (L4882). |
| Kill-switch command surface | ✅ Implemented | `pi.registerCommand("gentle:review-mode")` L5983; validates `status\|disable\|enable`, rejects unknown sub-actions with a warning notice, degrades to an info notice when the capability is dark. |
| Native two-option consent | ✅ Implemented | `requestReviewConsent` L4466-4497 called at L4894, gated on `result.lensesRequired && result.riskEvidence !== undefined`, before `actor_binding` is assembled at L4911. |
| Headless consent semantics | ✅ Implemented | `context?.hasUI !== true` → `notify(..., "info")` + `consentNotice`, `proceed: true`, latch untouched (L4480-4483). `confirm()` throwing takes the same non-blocking path (L4487-4489). |
| Empty-candidate hint surfaced | ✅ Implemented | `mapNativeStartResult` L4135 `...(result.hint === undefined ? {} : { hint: result.hint })`. |
| Verbatim tier reflection | ✅ Implemented | L4122 `risk_tier: result.riskLevel` — no derivation anywhere in the file. |
| Disabled/unmanaged delivery as success | ✅ Implemented (spec text stale) | Decoder L1032-1035 + gate early return L5281-5283. |

### DARK Invariant

| Check | Result | Evidence |
|---|---|---|
| All four capability keys false on every shipped row | ✅ | 8/8 rows spread `ORGANIC_PARITY_DARK`; standing gating test in `pnpm test`. |
| No new shipped version key | ✅ | `assert.deepEqual(Object.keys(NATIVE_CLI_CONTRACTS), ["2.1.4"…"2.1.11"])`. |
| `lib/gentle-ai-binary.ts` byte-unchanged vs main | ✅ | `git diff main -- <path>` empty. |
| `scripts/gentle-ai-installer.mjs` byte-unchanged vs main | ✅ | empty. |
| `scripts/verify-package-files.mjs` byte-unchanged vs main | ✅ | empty. |
| `contracts/review-integration/v1/**` byte-unchanged vs main | ✅ | empty. |
| Generated runtime mirrors the dark rows | ✅ | `runtime/native-review-cli.mjs:423`; `check:transaction-runner` reports no drift. |

Note on the escape hatch: `setNativeCliContractForTesting` (`lib/native-review-cli.ts:441`) is an exported overlay consulted **before** the frozen table in `resolvedNativeCliContract` (L446). It is referenced only from the two test files and requires an explicit call, so it cannot flip a shipped row at runtime — but it is a public export on a production module. See SUGGESTION 1.

### Zero-Work-Routing-Vocabulary Invariant

Ran `rg -i 'work[-_ ]?rout|work[-_]?(capabilit|start|route|advance|reconcile|transition|status)|workRun|connectorSessionRef'` over **all 20** files the branch touches (not just the 5 Track A paths). ✅ HOLDS.

Every match is one of:
- `openspec/changes/organic-rdd-parity/{exploration,proposal,design,tasks}.md` — planning prose that *describes* the exclusion.
- `README.md:59` "Work routing discipline" — a pre-existing delegation-policy table row, present verbatim on `main` and **not** in the branch diff for that file.

Zero matches in any source, runtime, contract, or test file.

### Track A Recovery Claims (independently re-verified)

| Task | Claim | Independent check | Result |
|---|---|---|---|
| 1.1 | `README.md`, `.github/workflows/publish.yml`, `skills/**` byte-identical to archive | `git diff archive/work-routing-wip HEAD -- <path>` empty for all three | ✅ |
| 1.2 | Zero recoverable non-work-routing hunks in `extensions/gentle-ai.ts` | Every new top-level declaration in the archive diff is work-routing (`normalWorkOutcome`, `PersistableWorkRoutingState`, `workRoutingPersistenceAvailable/SessionBinding/EntryMatches`, `readPersistedWorkRoutingState`, `persistWorkRoutingMarker`, `journalPayloadForState`, `sameWorkRoutingState`, `persistenceFailureState`); the remaining hunks are the imports and the handler bodies that consume them | ✅ claim holds |
| 1.3 | `tests/package-manifest.test.ts` recovered minus 12 work-routing lines | `git diff --shortstat archive/work-routing-wip HEAD -- <path>` → exactly `12 deletions(-)`; the new test `"npm publication is bound to the exact package tag and triggering commit"` is present | ✅ |
| 1.4 | Zero-leak gate | Re-run above, widened to all 20 touched files | ✅ |
| 1.5 | Gates green, diff limited | `pnpm test` exit 0; `verify-package-files.mjs` exit 0; branch diff touches 4 of the 5 Track A paths (`extensions/gentle-ai.ts` carries Track B only, per 1.2) | ✅ |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| #1 Four dark boolean columns, no new version key | ✅ Yes | |
| #2 Pi-owned clone-local latch, 0600, one-way | ✅ Yes | `lib/review-consent-latch.ts`; `resolveRepositoryAuthorityV1` + `assertManagedStorePathV1`; `mkdirSync(mode 0o700)` + `writeFileSync(mode 0o600)` + explicit `chmodSync(0o600)`; recorded only on accept. |
| #3 Ask after START, before `actor_binding`, only when `lenses_required` | ✅ Yes | Call order L4839 gate → L4866 targetStatus → L4882 start → L4894 consent → L4911 actor_binding. Additionally gated on `riskEvidence !== undefined`, which is what makes consent capability-dark today. |
| #4 `ctx.ui.confirm` two-option; accept/decline/throw semantics | ✅ Yes | `reviewConsentBody` L4444 emits Why / value / answers / off-path lines. |
| #5 Headless never blocks, notice always | ✅ Yes | |
| #6 Tolerated stderr: exact-match, START-only, `mode:true`-only | ✅ Yes | `execute(..., toleratedStderr = [])` L904; membership test L918; only `start()` passes a non-empty list, and only when `resolvedNativeCliContract(version)?.mode === true` (L948). |
| #7 `reviewMode?()` optional, STATUS-only consultation, Pi never enables | ✅ Yes | Plus an in-scope addition beyond the design's file table: `NativeReviewCliV216.reviewMode` delegates to `this.legacy.reviewMode` (L1634), which is what makes the kill switch reachable through the production default. |
| #8 Tier/evidence/hint straight through, zero Pi derivation | ✅ Yes | |
| #9 `delivery` keyed alternate discriminator, early return before maintainer exception | ✅ Yes | L1032-1035 enforces the keyed pairing; L5281-5283 returns before L5284's maintainer-exception branch. |

### Cross-Repo Design Findings — encoding check

| Finding | Encoded? | Exact evidence |
|---|---|---|
| Tolerated-stderr allowlist: exact-match, START-only, mode-gated | ✅ Yes | `const toleratedNotice = result.stderr.trim().length > 0 && toleratedStderr.includes(result.stderr.trim());` (L918) — set membership, no prefix/regex. Only `start()` supplies a non-empty list (L948-949), and only under `mode === true`. Negative coverage: prefixed, extra-line, and one-char-truncated stderr all still raise `UNEXPECTED_STDERR`. |
| Post-START consent | ✅ Yes | `requestReviewConsent` invoked at L4894, strictly after `nativeReviewCli.start()` (L4882) and strictly before `actorBinding` is computed (L4911). `risk_evidence` only exists after START, matching the finding's rationale. |
| Delivery-keyed discriminator | ✅ Yes | `delivery` present ⇒ `enumString(body.delivery, ["disabled/unmanaged"])` **and** `gateResult === "invalidated" && allowed === false && action === "repository-policy" && exitCode === 0`, else throw. `delivery` absent ⇒ the pre-existing strict `{allow: continue, scope-changed: create-new-lineage, invalidated: explicit-maintainer-action, escalated: stop}` table with exit 1 is unchanged (L1036-1038). |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | ⚠️ | No "TDD Cycle Evidence" table in apply-progress; per-task RED→GREEN prose lives in `tasks.md` instead. |
| All tasks have tests | ✅ | 11/11 RED→GREEN tasks name a concrete test file; all files exist. |
| RED confirmed (explicitly recorded) | ⚠️ | 4/11: 2.1 (`actual: undefined`), 2.2 (`VERSION_INCOMPATIBLE`/missing-export), 5.1 (`actual: undefined` after stashing), 5.2 (`details.status undefined` after stashing). Tasks 3.1, 3.2, 4.1-4.4 assert RED→GREEN without recording the observed failure. |
| GREEN confirmed (tests pass) | ✅ | 11/11 — independently re-executed: 839-test suite, 0 failures. |
| Triangulation adequate | ✅ | Negative/fail-closed twins exist for every new decode path: scalar `risk_evidence`, split `disabled`/`unmanaged`, absent-`delivery` strict pairing, near-miss/prefixed/extra-line stderr, discriminator mismatch, dark-capability `VERSION_INCOMPATIBLE`. |
| Safety Net for modified files | ✅ | `native-review-parity` (26), `review-controller-native-routing` (150), `native-review-cli`, `native-review-capability-contract` re-run together after the corrective decode fixes; zero regressions. Baseline `main` 804 → 839 tests. |

**TDD Compliance**: 4/6 checks fully passed, 2 partial (evidence format, RED recording).

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit (fake `ExecFileAdapter`, no fs/git) | 15 | 2 | `node:test` |
| Integration (real temp git repo + full extension wiring) | 19 | 3 | `node:test` + `node:child_process` |
| E2E (real `gentle-ai` subprocess) | 5 | 1 | `node:test`, **non-gating** (outside the `tests/*.test.ts` glob) |
| **Total new** | **39** | **6** | |

The 5 E2E tests are deliberately excluded from `pnpm test` and skip unless `GENTLE_AI_DEV_BINARY` names an existing absolute path — correct per the design's Testing Strategy, but it means the disable/enable command round trip has no gating coverage (see WARNING 2).

### Changed File Coverage

Coverage analysis skipped — no coverage tool configured in `package.json`.

### Assertion Quality

Audited all 4 new/changed test files (39 new tests, 0 tautologies, 0 ghost loops, 0 orphan-empty assertions, 0 mock-heavy files — the suite uses hand-built fakes, not a mocking framework).

| File | Line | Assertion | Issue | Severity |
|---|---|---|---|---|
| `tests/native-review-parity.test.ts` | 547-556 | test titled "…reports status, **disables, and enables** through explicit user invocation" but the body only invokes `handler("status", …)` | Title over-claims; disable/enable never exercised through the handler | WARNING |
| `tests/native-review-parity.test.ts` | 565 | `assert.equal(notices.length, 1)` | Count-only; the notice text is never asserted | SUGGESTION |
| `tests/native-review-parity.test.ts` | 432 | `assert.ok(result.result)` | Truthiness-only companion to a `notEqual` status check | SUGGESTION |

Everything else asserts concrete values, exact argv arrays, exact canonical bytes, exact file mode, or a specific typed error code. `review-consent-latch.test.ts:40-41` avoids self-reference by pinning the schema constant to a string literal alongside the byte comparison — good practice.

### Quality Metrics

**Linter**: ➖ Not available (no lint script).
**Type Checker**: ➖ Not available as a standalone script; `node --experimental-strip-types` erases types without checking them. Type errors in the changed files would not surface in `pnpm test`.

### Issues Found

**CRITICAL**

1. **`review-routing` spec asserts a wire shape the implementation provably rejects.** `openspec/changes/organic-rdd-parity/specs/review-routing/spec.md` requirement "Disabled/unmanaged delivery as success" states *"When the native result reports `delivery: disabled` or `delivery: unmanaged`"*, with two scenarios whose GIVEN clauses name those exact values. The implementation accepts only the single literal `disabled/unmanaged` (`lib/native-review-cli.ts:1032`) and a passing test — "native VALIDATE rejects a split disabled-only or unmanaged-only delivery value" — asserts that both spec-named values raise `SCHEMA_INCOMPATIBLE`. The **code is correct**: gentle-ai's `RDDDeliveryDisabledUnmanaged = "disabled/unmanaged"` (`internal/reviewtransaction/rdd_mode.go:124`) is a single literal, confirmed by the dev-binary journey, and design Decision #9 already had it right. The **spec text is stale** and would be frozen into the permanent capability by archive, misleading PI-2. Remediation is a one-line spec amendment collapsing the two scenarios into one keyed on `delivery: disabled/unmanaged` — **zero code change**. This is the only blocker.

**WARNING**

1. **`review-routing` › "Missing tier fails closed" has no covering test.** Fail-closed behaviour is structurally guaranteed (`risk_level` is a required `exactObject` key, `mapNativeStartResult` has no fallback) but never runtime-proven. One RED test driving a START body without `risk_level` and asserting `SCHEMA_INCOMPATIBLE` closes it.
2. **`gentle:review-mode disable`/`enable` have no gating coverage through the command handler.** The only gating test invokes `status`; the full round trip lives exclusively in the non-gating devtest, which is skipped in CI unless `GENTLE_AI_DEV_BINARY` is set. Two spec scenarios therefore depend on an opt-in suite. The test title also over-claims (see Assertion Quality).
3. **"Command-only re-enable" is proven statically, not at runtime.** No test asserts that no automated path calls `reviewMode({operation: "enable"})`. The static proof is exact and small (two call sites), but a grep-style guard test would make the invariant regression-proof.
4. **Strict-TDD RED evidence is unrecorded for 7 of 11 RED→GREEN tasks** (3.1, 3.2, 4.1-4.4). GREEN is independently verified for all of them; only the observed-failure record is missing.
5. **Two previously-committed decode assumptions were corrected in the final commit** (`risk_evidence` scalar → `readonly string[]`; `delivery` two-value union → single literal). Both were wrong against gentle-ai's Go source and would have thrown `SCHEMA_INCOMPATIBLE` on every real capability-true START carrying evidence. They are now correct and tested, but they touch code shipped in 16ad601a — reviewer attention warranted.
6. **`apply-progress` reports "16 tasks" while `tasks.md` contains 19** (5+3+2+4+2+3). Its own breakdown ("5 Phase 1 + 9 Phase 2-4 + 2 Phase 5 + 3 Phase 6") sums to 19. Cosmetic arithmetic error in the artifact; all 19 are checked and verified.

**SUGGESTION**

1. `setNativeCliContractForTesting` is a public export on a production module, consulted before the frozen table. Consider gating it behind an env guard or moving it to a test-only entry point before PI-2 flips any row true.
2. `execute()` compares `result.stderr.trim()` against the allowlist. Trimming is pragmatic (process stderr always ends in `\n`) but the code comment claims "byte-exact"; align the comment with the behaviour.
3. Add a type-check script — `node --experimental-strip-types` erases types without checking them, so no gate in this change would catch a type error.
4. Assert notice *text*, not just count, in "gentle:review-mode command reports unavailability without throwing when the capability is dark".

### Batch-3 Risk Assessment (blocks this change vs. PI-2 checklist)

| Risk | Blocks this change? | Assessment |
|---|---|---|
| **Parity fields reachable only through `NativeReviewCliV214`, not the production default `V216`** | ❌ No — belongs in PI-2 | Independently confirmed. `createNativeReviewCli()` returns `NativeReviewCliV216` unless an explicit `adapter` is passed (a test-injection seam, `lib/native-review-cli.ts:1665-1668`). `V216.start()`/`.validate()` route through the negotiated `review-integration/v1` contract (L1493-1497, L1571-1575), and `lib/review-integration-v1.ts` carries **no** `risk_evidence`, `hint`, or `delivery` key — so 3 of the 4 capabilities cannot surface in production even if their columns were flipped. `mode` is the exception: `V216.reviewMode` delegates to the legacy client (L1634), so the kill switch *is* production-reachable. Harmless today because every column is false, but this is a **hard PI-2 prerequisite**: flipping `riskEvidence`/`hint`/`delivery` true requires extending the frozen `contracts/review-integration/v1` contract (currently byte-pinned) or routing those operations through V214. Must be the first line of PI-2's checklist. |
| **`disabled/unmanaged` VALIDATE envelope unreachable via explicit-lineage VALIDATE** | ❌ No — belongs in PI-2 | gentle-ai emits it only through lineage auto-discovery; Pi's `gentle_review` VALIDATE always binds an explicit `lineageId`. Pre-existing property of the VALIDATE contract, not introduced here. The mapping and early return are correctly proven by a synthetic-fixture controller test, and the decode is proven against the real binary via the one path gentle-ai actually uses. PI-2 must decide whether to add a no-lineage VALIDATE variant or accept the branch as permanently defensive. |
| **Two corrected wire shapes touching previously-committed code** | ❌ No | Both corrections are right against ground truth, covered by positive and fail-closed tests, and change no shipped capability row. Downgraded to WARNING 5 (reviewer attention). |
| **`V216.reviewMode` delegation added beyond the design's file table** | ❌ No | This is a *fix*, not a risk: without it the kill switch would be dead code behind the production default. Coherent with the existing `reviewStatus`/`sddStatus`/`reclaim` delegation pattern. Recommend the design's File Changes table be updated to name it. |

None of the four risks blocks this change. All four are correctly scoped by the DARK invariant: with all shipped rows false, no organic-parity code path can execute against pinned v2.1.11. Risks 1 and 2 are genuine PI-2 blockers and should be carried into PI-2's checklist verbatim.

### Verdict

**FAIL** — one CRITICAL: the `review-routing` spec text names wire values (`delivery: disabled`, `delivery: unmanaged`) that the implementation provably rejects and that a passing test asserts must fail closed; archiving would freeze a contradicted contract. Everything else is green — all 19 tasks verified with independent evidence, all four gates exit 0 (`pnpm test` 829/829, `verify-package-files.mjs`, `check:transaction-runner`, 5/5 dev-binary), the DARK invariant holds across all 8 shipped rows and all four byte-pinned paths, and the zero-work-routing-vocabulary invariant holds across all 20 touched files. The blocker is a one-line spec amendment with **zero code change**; re-verify after the edit, then archive.

---

## Addendum — 2026-07-25 Scoped Re-verification (CRITICAL resolved)

**Scope**: Re-verify only the single CRITICAL blocker from the FAIL verdict above (stale `delivery: disabled` / `delivery: unmanaged` wire values in the `review-routing` spec). All other gates and invariants from the prior full verify PASSED and were not re-run.

**Branch**: `feat/organic-rdd-parity` @ `52379898` (docs(sdd): align the delivery spec with the single wire literal; working tree clean).

### 1. Spec text confirmed corrected

`openspec/changes/organic-rdd-parity/specs/review-routing/spec.md`, requirement "Disabled/unmanaged delivery as success" (lines 21-35):

- Names the single literal exactly: *"When the native result reports the single literal `delivery: \"disabled/unmanaged\"` (the only value gentle-ai emits)... Any other delivery value MUST fail closed as schema-incompatible."*
- Scenario "Disabled/unmanaged delivery" (25-29) is keyed on `delivery: "disabled/unmanaged"` only.
- New scenario "Unknown delivery value fails closed" (31-35) explicitly requires fail-closed schema-incompatible decoding for any other value.
- No remaining reference to the rejected two-value form (`delivery: disabled` / `delivery: unmanaged` as separate values) anywhere in the file.

CRITICAL finding #1 is resolved by spec text alone; the finding always held the implementation to be correct.

### 2. Implementation/test agreement re-confirmed

`lib/native-review-cli.ts:1032`:
```ts
const delivery = body.delivery === undefined ? undefined : (enumString(body.delivery, ["disabled/unmanaged"]) as NativeValidateResult["delivery"]);
```
Accepts exactly the one-element enum `["disabled/unmanaged"]`.

`tests/native-review-parity.test.ts:186-199`, test *"native VALIDATE rejects a split disabled-only or unmanaged-only delivery value: the wire literal is always the combined string"*:
```ts
for (const delivery of ["disabled", "unmanaged"]) {
    ...
    await assert.rejects(
        () => new NativeReviewCliV213(queue.adapter).validate({ cwd: "/repo", gate: "pre-commit" }),
        (error: unknown) => error instanceof NativeReviewCliError && error.code === NATIVE_REVIEW_ERROR_CODE.SCHEMA_INCOMPATIBLE,
        `delivery ${JSON.stringify(delivery)} must still fail closed`,
    );
}
```
Both `"disabled"` and `"unmanaged"` (split values) assert `SCHEMA_INCOMPATIBLE`, matching the spec's new "Unknown delivery value fails closed" scenario. The positive scenario is covered by the adjacent test *"native VALIDATE decodes the disabled/unmanaged delivery alternate discriminator at exit 0"* (lines 166-184), which asserts `result.delivery === "disabled/unmanaged"` at exit 0.

### 3. Targeted test run

```text
$ node --experimental-strip-types --test tests/native-review-parity.test.ts
...
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1310.6946
```
26/26 pass, 0 fail. Delivery-related tests pass:
`✔ native VALIDATE decodes the disabled/unmanaged delivery alternate discriminator at exit 0`
`✔ native VALIDATE rejects a split disabled-only or unmanaged-only delivery value: the wire literal is always the combined string`
`✔ native VALIDATE without delivery keeps the strict exit-code/action pairing unchanged`

### 4. Updated Verdict

**PASS-WITH-NOTES.**

The sole CRITICAL is resolved by a one-line, zero-code-change spec amendment: the `review-routing` requirement now names the single literal `"disabled/unmanaged"`, includes an explicit fail-closed scenario for any other value, and no longer references the rejected two-value form. Implementation and tests were already correct and remain unchanged and passing (26/26 in the targeted file, 0 regressions). Combined with the prior full verify (19/19 tasks, 829/829 tests, all four gates exit 0, DARK invariant and zero-work-routing-vocabulary invariant both holding), this change is now clear to archive.

The 5 prior WARNINGs are unaffected by this scoped fix and remain open as non-blocking follow-ups (not re-verified in this pass, carried forward as-is): missing-tier fail-closed test coverage; `gentle:review-mode disable/enable` gating coverage only via the non-gating devtest; static-only proof for "command-only re-enable"; unrecorded RED evidence for 7/11 TDD tasks; reviewer-attention note on two corrected decode assumptions touching previously-committed code. None are CRITICAL and none block archive.
