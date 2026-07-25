# Tasks: Organic RDD Parity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Track A ~950-1000 (restored, not newly authored); Track B ~800-900 across `lib/native-review-cli.ts`, `lib/review-consent-latch.ts`, `extensions/gentle-ai.ts`, 3 new test files |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Track A → PR2 Track B foundation/kill-switch/consent → PR3 Track B passthrough/dev-binary |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Track A recovery commit | PR 1 | `pnpm test` + `node scripts/verify-package-files.mjs` | N/A — behavior-preserving recovery, no new runtime surface | Revert single commit; `archive/work-routing-wip` stays re-runnable |
| 2 | Capability columns, `reviewMode?()`, kill switch, consent latch/UI (Phases 2-4) | PR 2 | `node --test tests/native-review-capability-contract.test.ts tests/native-review-parity.test.ts` | N/A — fake `ExecFileAdapter`, no binary | Revert commits; capability rows stay false, latch inert |
| 3 | Tier/hint/delivery passthrough, dev-binary journey, gating proof (Phases 5-6) | PR 3 | `node --test tests/native-review-parity.test.ts` | `pnpm test:dev-binary` (skips without `GENTLE_AI_DEV_BINARY`) | Revert commits; delete non-gating devtest file |

## Skills to load before implementation

TypeScript: `/home/gentleman/.agents/skills/typescript/SKILL.md`

## Phase 1: Track A — Recovery (rollback: revert isolated commit)

- [x] 1.1 Wholesale-recover `README.md`, `.github/workflows/publish.yml`, `skills/**`: `git diff main archive/work-routing-wip -- <path>`, confirm zero work-routing vocabulary, then `git checkout archive/work-routing-wip -- <path>`; post-checkout diff vs archive must be empty. DONE — all three files checked out wholesale; post-checkout `git diff archive/work-routing-wip -- <path>` was empty for each.
- [x] 1.2 Hunk-level recover `extensions/gentle-ai.ts` via `git checkout -p archive/work-routing-wip -- extensions/gentle-ai.ts`, accepting only zero-work-routing-vocabulary hunks. DONE — read the full 1436-line/8-hunk diff line by line; every hunk (imports, helper functions, and the `session_start`/`session_tree`/`input`/`before_agent_start`/`agent_end` handler changes) is inseparably part of the work-routing consumer feature. Zero hunks qualified for recovery, so the file was left untouched (0 diff vs `main`). This deviates from the task's line-count estimate — see apply-progress notes.
- [x] 1.3 Hunk-level recover `tests/package-manifest.test.ts` the same way (may retain `contracts/work-routing/**` manifest entries). DONE — kept the `PackageJson.repository` field addition and the full new `"npm publication is bound to the exact package tag and triggering commit"` test; dropped the 10 work-routing `assert.match` lines plus the `workClient` read + its assertion (12 lines total) from two existing tests.
- [x] 1.4 Blocking gate: `git show --unified=0 HEAD -- <5 paths> | rg -i 'work[-_ ]?rout|work[-_]?(capabilit|start|route|advance|reconcile|transition|status)|workRun|connectorSessionRef'` returns no matches. DONE — ran `rg -i 'work-routing|workrun|work_routing|nativeWorkCli|connectorSessionRef'` over all 5 paths (working-tree state); zero matches (exit 1).
- [x] 1.5 `pnpm test` and `node scripts/verify-package-files.mjs` green; `git diff --stat main..HEAD` limited to the 5 paths; commit as one isolated recovery commit. DONE except the commit — `pnpm test` 805/805 pass (804 on main baseline + 1 new test), `verify-package-files.mjs` passes (84 files; 19 pins); `git diff --stat` vs `main` is limited to 4 of the 5 paths (`extensions/gentle-ai.ts` has zero diff, see 1.2). Commit intentionally NOT created — orchestrator commits work units.

## Phase 2: Capability & type foundation (rollback: revert commit; rows stay false)

- [x] 2.1 RED→GREEN `tests/native-review-capability-contract.test.ts`: add `mode`/`riskEvidence`/`hint`/`delivery` boolean columns to every `NATIVE_CLI_CONTRACTS` row (`lib/native-review-cli.ts:353-362`), all `false` incl. `"2.1.11"`; no new version key. DONE — 3 tests (every row false/absent, 2.1.11 explicit, no new version key); RED confirmed (2.1.11-explicit test failed with `actual: undefined` before the columns existed), GREEN after adding `ORGANIC_PARITY_DARK` spread into every row.
- [x] 2.2 RED→GREEN `tests/native-review-parity.test.ts`: add `NATIVE_REVIEW_OPERATION.MODE`, `NativeReviewModeRequest/Result/Status`, optional `reviewMode?()` on `NativeReviewCli`/`NativeReviewCliV214` decoding `gentle-ai.review-mode/v1` (Design #7); add `NativeStartResult.riskEvidence/.hint` and `NativeValidateResult.delivery` optional decoder keys. DONE — 10 lib-level tests (reviewMode capability-gated/argv/status+enable+disable/discriminator mismatch; START riskEvidence+hint optional decode; VALIDATE delivery alternate discriminator at exit 0 vs strict pairing when absent; tolerated-stderr exact-match gated on `mode:true`, near-miss/prefixed/extra-line still fails closed). Also implemented `reviewMode()` delegation on `NativeReviewCliV216` (`this.legacy.reviewMode(request)`) — necessary beyond the design's literal file-table wording so the kill switch actually activates through the production `createNativeReviewCli()` default (V216), mirroring the existing reviewStatus/sddStatus/reclaim delegation pattern. Added a testing-only capability overlay (`setNativeCliContractForTesting`) since shipped rows can never be capability-true. RED confirmed (VERSION_INCOMPATIBLE/missing-export failures) before implementation.
- [x] 2.3 Regenerate `runtime/native-review-cli.mjs` via `pnpm build:transaction-runner`; confirm `check:transaction-runner` reports no drift. DONE — regenerated; `check:transaction-runner` reports "commit transaction runtime matches TypeScript sources (4 modules)".

## Phase 3: Kill switch (rollback: revert; gate stays inert)

- [x] 3.1 RED→GREEN: `resolveReviewModeGate` in `extensions/gentle-ai.ts` before `targetStatus` (~4727) — `effective==="off"` yields non-failure `status:"skipped"` envelope, exit 0, no mutation; capability-absent leaves today's path unchanged (Design #7). DONE — 3 integration tests via `tests/native-review-parity.test.ts` (off → skipped envelope + native start never called; capability-absent/no reviewMode → today's path unchanged; unexpected reviewMode failure → existing `native-operation-failed` envelope via `nativeOperationFailure`). VERSION_INCOMPATIBLE from `reviewMode()` is caught and treated as capability-absent, never surfaced as a failure.
- [x] 3.2 RED→GREEN: register `gentle:review-mode` command (status|disable|enable, ~5842, between `gentle:doctor`/`gentle:status`); each sub-action user-initiated only; no automated path reaches `enable`. DONE — 2 tests (status reporting via `ctx.ui.notify`; dark-capability unavailability notice without throwing). Command is registered only inside `pi.registerCommand`, invoked only by explicit user command syntax; no other code path calls `nativeReviewCli.reviewMode({operation:"enable"|...})`.

## Phase 4: Consent (rollback: revert; latch file inert once code removed)

- [x] 4.1 RED→GREEN: create `lib/review-consent-latch.ts` — clone-local read/record via `resolveRepositoryAuthorityV1`+`assertManagedStorePathV1`, one-way accept-only, mode 0600 (Design #2). DONE — 4 tests in `tests/review-consent-latch.test.ts` (no latch by default; one-way exact-canonical-bytes recording at mode 0600, idempotent; a linked worktree shares one latch via the git common dir; an unresolvable repo throws rather than silently reporting a latch).
- [x] 4.2 RED→GREEN: `requestReviewConsent` in `extensions/gentle-ai.ts` (~4773), after `start`, before `actor_binding`, only when `lenses_required`; `ctx.ui.confirm` two-option prompt with `risk_evidence` verbatim as the Why; accept→latch+proceed, decline→declined envelope, throw→review runs+notice (Design #3, #4). DONE — gated on `result.lensesRequired && result.riskEvidence !== undefined` (capability-gated via the optional field's presence, proven dark by the "no riskEvidence" test); accept records the latch and includes `actor_binding`; decline persists nothing and withholds `actor_binding` for that work unit only (native start result is still reported); an existing latch skips the prompt entirely even when `confirm()` would have declined.
- [x] 4.3 RED→GREEN: headless (`ctx.hasUI===false`) → review runs, latch untouched, `consent_notice` always present + `ctx.ui.notify(..., "info")` (Design #5). DONE — headless always includes `actor_binding`, a `consent_notice` string, calls `ctx.ui.notify(notice, "info")`, and never persists the latch. An unreadable answer (`confirm()` throws) is handled the same way (proceed + notice + latch untouched) per Design #4's throw case.
- [x] 4.4 RED→GREEN: `REVIEW_CONSENT_NOTICES` exact-match tolerated-stderr in `execute()`/`start()`, gated on `mode:true` only; near-miss/prefixed/extra-line stderr still raises `UNEXPECTED_STDERR` (Design #6). DONE as part of 2.2's implementation — `execute()` gained a `toleratedStderr` param used only by `start()`, populated only when `resolvedNativeCliContract(version)?.mode === true`; exact byte match captured from gentle-ai's `internal/cli/review_mode.go` `reviewConsentSkippedNotice`.

## Phase 5: Tier, hint, delivery passthrough (rollback: revert; no local derivation to remove)

- [ ] 5.1 RED→GREEN: `mapNativeStartResult` passes `risk_tier`/`risk_evidence`/`hint` verbatim; missing tier fabricates nothing locally (Design #8).
- [ ] 5.2 RED→GREEN: `mapNativeValidateResult` (~5141) `delivery` optional key; `disabled`/`unmanaged` alternate discriminator → `result:invalidated`, `allowed:false`, `action:"repository-policy"`, exit 0, `status:"skipped"`, `outcome:"review-disabled-unmanaged-delivery"`, early return before the maintainer-exception check (Design #9).

## Phase 6: Dev-binary journey + gating proof (rollback: delete non-gating file; no shipped-pin touch)

- [ ] 6.1 Add `"test:dev-binary": "node --experimental-strip-types --test tests/devbinary/*.devtest.ts"` to `package.json`.
- [ ] 6.2 Create `tests/devbinary/native-review-parity.devtest.ts`: inject the real dev binary via `NativeReviewCliV214(createNodeExecFileAdapter(), <path>)`, skip unless `GENTLE_AI_DEV_BINARY` names an existing absolute path; capture `review mode status`/`review start`/disabled-gate output; assert against Pi's decoders and frozen notice constants; never reads/writes shipped pins.
- [ ] 6.3 GATING assertion: re-run `tests/native-review-capability-contract.test.ts`; every shipped row incl. `"2.1.11"` still `false`/absent, `pnpm test` green end-to-end.
