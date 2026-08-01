# Tasks: Gentle AI Main Behavior Parity — Wave 1 (#2028 Pi-Host Behavior)

> **Size note.** This exceeds the default word budget for the same reason `design.md` does:
> three independently revertible work units, eight resolved decisions, and every applicable
> threat-matrix row each need their own RED-before-GREEN pair. Content stays tabular/checklist,
> never prose-padded.

**Tracker independence.** This tracker (W1/W2/W3, all inside this repository) is **independent**
of the `consume-gentle-ai-release-artifacts` foundation tracker
(`/home/gentleman/work/gentle-pi-worktrees/release-parity`). W1 and W2 depend on nothing that
tracker owns — pure functions, an injected fake `NativeReviewCli`, and a parameter-injected
`Map`. **W3 is the only unit that depends on it** (its evidence harness `tests/evidence/**`, and
for live-lane acceptance, release **R**).

**Design correction (file list).** `design.md` lists `runtime/review-result-capture.mjs` as a
file to create, generalizing "every review `lib/*.ts` has a `runtime/*.mjs`". Verified against
`scripts/build-git-commit-transaction-runner.mjs`: only 4 of 30 `lib/*.ts` files have a generated
mirror (`gentle-ai-binary`, `review-integration-v2`, `native-review-cli`, `git-commit-transaction`)
— the transitive dependency closure of the standalone git-commit-transaction hook runner, not a
general rule. `extensions/gentle-ai.ts` imports `lib/*.ts` directly. **No mirror is created for
`lib/review-result-capture.ts`.** `lib/native-review-cli.ts` IS one of the 4 tracked sources, so
editing it (W1) requires regenerating its mirror and running `check:transaction-runner`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | W1 ~900-1000, W2 ~700-800, W3 ~350-450 (additions+deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Tracker → W1 → W2 → W3 |
| Delivery strategy | exception-ok |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

`exception-ok` means the maintainer has already accepted oversized units; no additional
ask-before-apply gate is required. Each unit still ships as its own PR against the tracker/prior
branch (feature-branch-chain), never squashed into one.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| W1 | Exact-slot capture, admission, transport, dead-staging removal | PR 1 (base: tracker branch) | `node --experimental-strip-types --test tests/review-result-capture.test.ts tests/review-controller-native-routing.test.ts tests/native-review-cli.test.ts` | `pnpm run test:harness` — FINALIZE capture-phase changes extension dispatch | Revert capture phase, transport selection, dead-staging deletion, `providerReviewerProjection` refactor; FINALIZE reverts to prior mapping; provider untouched; revert `runtime/native-review-cli.mjs` in the same commit |
| W2 | Allowlisted diagnostics, one-shot relaunch, lost-output recovery, cleanup | PR 2 (base: W1 branch) | `node --experimental-strip-types --test tests/review-result-capture.test.ts tests/review-controller-native-recovery.test.ts` | `pnpm run test:harness` — relaunch/cleanup wiring shares W1's controller entry points | Revert diagnostics decoder, record map, relaunch/lost-output/cleanup wiring; W1 capture-only behavior remains valid standalone |
| W3 | #1819/#1915 evidence consumption, #2074/#910 + RDD no-action assertions | PR 3 (base: W2 branch) | `node --experimental-strip-types --test tests/native-review-parity-issue-evidence.test.ts` | N/A — no new extension dispatch path added, only an assertion test file | Delete `tests/native-review-parity-issue-evidence.test.ts`; nothing else depends on it; foundation harness untouched |

## W1: Exact-slot capture, admission, transport (fakes only, no foundation dependency)

- [ ] W1.1 RED `tests/review-result-capture.test.ts` (new): `deriveCaptureSlots` — each of lineage/target/authority-revision/repository-context/subject-hash/lens/order mismatching independently rejects; duplicate lens, order, or subject hash rejects; canonical `slotKey` join of the six fields; ascending `selectedOrder`.
- [ ] W1.2 GREEN `lib/review-result-capture.ts` (new): `CaptureSlot`, `CAPTURE_SLOT_ARGUMENT` const, `deriveCaptureSlots(status)` — pure, extracted from `providerReviewerProjection`.
- [ ] W1.3 Refactor `extensions/gentle-ai.ts:4895` (`providerReviewerProjection`): call `deriveCaptureSlots` so exactly one validator exists; keep existing manifest/intended-untracked mapping behavior-preserving.
- [ ] W1.4 RED `tests/review-controller-native-routing.test.ts`: lens↔slot bijection — a missing lens, an extra lens, or a duplicate fails closed before any capture runs.
- [ ] W1.5 GREEN `extensions/gentle-ai.ts`: FINALIZE capture-phase entry — fresh `targetStatus`, `deriveCaptureSlots`, bijection check against outstanding ∪ recorded slots, ascending-order execution loop.
- [ ] W1.6 RED (threat: Git repository selection + Subprocess invocation) `tests/review-controller-native-routing.test.ts` + `tests/native-review-cli.test.ts`: capture cwd equals `candidateView.root`; tokens carrying `--repository-context` plus an explicit cwd rejected; argument tokens stay discrete argv elements verbatim, never composed into a shell string; empty/non-string tokens refused.
- [ ] W1.7 GREEN: wire the capture phase to `lib/native-review-cli.ts` `captureResult()` (`:2287`) with `candidateView.root` and verbatim `argumentTokens`; no shell, fixed executable, existing bounded timeout/buffer in `invoke()`.
- [ ] W1.8 RED (threat: Documentation-like paths) `tests/native-review-cli.test.ts`: an admitted-manifest `path` containing `..`, an absolute path, or an executable-looking name is forwarded byte-identical with zero Pi-side filesystem access; a manifest carrying both `path` and `reference` is refused.
- [ ] W1.9 GREEN: confirm `decodeNativeAdmittedResultManifest`'s exactly-one-locator rule is exercised end-to-end from capture through FINALIZE transport; no filesystem access added.
- [ ] W1.10 RED `tests/review-controller-native-routing.test.ts`: transport selection — every slot's manifest carries `path` ⇒ `resultArtifactFiles[]` in ascending `selectedOrder`; any manifest carries `reference` or any slot is `COMMITTED` ⇒ `capturedResults: true`; retired `--result` is never emitted.
- [ ] W1.11 GREEN `extensions/gentle-ai.ts`: FINALIZE per-run transport selection (Decision 4).
- [ ] W1.12 RED `tests/native-review-cli.test.ts`: `finalize()` no longer stages `lensResults` into `resultFiles`; `NativeFinalizeRequest` drops `resultFiles`/`lensResults`; no reviewer-document tmp file is written that argv never consumes.
- [ ] W1.13 GREEN `lib/native-review-cli.ts` (`:2149-2195`, `:408-422`): delete the dead staging and the two fields; regenerate `runtime/native-review-cli.mjs` via `node scripts/build-git-commit-transaction-runner.mjs --write`; verify with `pnpm run check:transaction-runner`.
- [ ] W1.14 Verify: `pnpm test` — W1 scope green; only the 3 pre-existing RDD-off failures in `tests/native-review-parity-runtime.test.ts` remain, unchanged (expected environment state, not a regression).

## W2: Diagnostics, one-shot relaunch, lost-output recovery, cleanup (depends on W1's `CaptureSlot`)

- [ ] W2.1 RED (threat: Privacy egress) `tests/review-result-capture.test.ts`: `decodeSafeAdmissionDiagnostic` — unknown code, extra key, absolute/private location, `..`/`~`/control characters, over-length reason, and raw prose each yield `undefined`; exact-record shape enforced.
- [ ] W2.2 GREEN `lib/review-result-capture.ts`: `ADMISSION_DIAGNOSTIC_CODE`, `SafeAdmissionDiagnostic`, `decodeSafeAdmissionDiagnostic` (allowlist, `exactRecord` discipline per `lib/review-integration-v2.ts:781`).
- [ ] W2.3 RED `tests/review-controller-native-recovery.test.ts`: one relaunch per `slotKey` — identical 6-field STATUS reoffer plus a safe diagnostic ⇒ `blocked: capture-relaunch-required`; a record already `RELAUNCH_GRANTED` ⇒ terminal `exhausted`; any of the 6 fields mismatched, or the diagnostic is `undefined` ⇒ terminal `unavailable`.
- [ ] W2.4 GREEN `extensions/gentle-ai.ts` + `lib/review-result-capture.ts`: `CAPTURE_SLOT_STATE`, `CaptureSlotRecord`, `Map<string, CaptureSlotRecord>` parameter-injected beside `correctionEvidenceByLineage` (`:6113`); relaunch routing per Decision 3's five-step sequence.
- [ ] W2.5 RED `tests/review-controller-native-recovery.test.ts`: unreplayability — a recomputed `sha256(document)` present in `rejectedDocumentHashes` refuses reuse as terminal `exhausted` on re-entry.
- [ ] W2.6 GREEN: record `sha256(rejectedDocument)` on grant; check membership before any relaunch capture runs.
- [ ] W2.7 RED `tests/review-controller-native-recovery.test.ts`: lost output — `nativeMutationRequiresStatus(error) === true` (`:4753`) triggers one fresh target-scoped STATUS query; slot no longer offered under unchanged `authority.lineageId`/`revision` ⇒ `COMMITTED` (no recapture, no lens rerun); proof absent ⇒ only `reconcileNativeMutationFailure`'s (`:4766`) declared action; ambiguous STATUS ⇒ not proven, fails closed.
- [ ] W2.8 GREEN: wire the lost-output branch into the FINALIZE capture phase (Decision 4).
- [ ] W2.9 RED `tests/review-controller-native-recovery.test.ts`: cleanup — all-slots-admitted/committed clears that lineage's records; FINALIZE terminal (beside `cleanupTerminal`, `:5566`) clears all records for the lineage; `session_shutdown` (beside `cleanupAllPendingReviewConsents`, `:4625`) clears the whole map; a stale grant cannot be reused because `slotKey` embeds `authorityRevision` and `subjectHash`.
- [ ] W2.10 GREEN `extensions/gentle-ai.ts`: wire the three cleanup triggers; add the slotKey-composition property assertion.
- [ ] W2.11 Verify: `pnpm test` — W2 scope green; confirm no RDD start/recover/retry/reset/reclaim call was introduced by W1 or W2 code.

## W3: Issue evidence + no-action assertions (depends on foundation P3 harness; live lane also needs release R)

- [ ] W3.1 RED `tests/native-review-parity-issue-evidence.test.ts` (new): #1819/#1915 `development/bootstrap` lane against fakes — result labelled `development/bootstrap` and asserted non-accepting, never final acceptance.
- [ ] W3.2 GREEN: implement the bootstrap-lane assertion (`ProviderBehaviorAssertion`/`AssertionResult` types), pure, fakes only.
- [ ] W3.3 RED same file: absent-evidence pure check — the evaluator called with no evidence returns `{ status: "blocked", missingDependency: "consume-gentle-ai-release-artifacts" }`.
- [ ] W3.4 GREEN: implement the pure blocked-check.
- [ ] W3.5 Ship the acceptance-gate test (expected-failing today, by design): #1819/#1915 final-acceptance test against the real foundation harness (`tests/evidence/**`, absent in this repo today) — it MUST fail now, no `test.skip`, no early return, no self-skip. This is the correct fail-closed state (proposal Risk "Qualifying evidence absent at verification"), not a bug; it turns green only once `consume-gentle-ai-release-artifacts` ships and the pin gate confirms both open questions.
- [ ] W3.6 RED same file: zero-reconstruction static guard — a static scan of `lib/` and `extensions/` proves Wave 1 introduced no delivery-topology or authority-graph symbols (squash/path-drift/receipt-discovery/evidence-digest-evolution identifiers).
- [ ] W3.7 GREEN: implement the guard; confirm it passes against the W1/W2 diff.
- [ ] W3.8 RED same file: #2074/#910 absence — no `~/.claude.json`, `.claude/mcp/`, or Claude-user-registry write path in `lib/`, `extensions/`, `scripts/`, or the packaged file manifest; no `pwsh` → `powershell.exe` → `powershell` fallback ladder; no fixture/journey names either issue; the Wave 1 coverage enumeration lists both as `no-action`, never as a passing fixture/journey/covered assertion.
- [ ] W3.9 GREEN: implement all absence and coverage-enumeration assertions — expected to already pass, since the surfaces genuinely do not exist.
- [ ] W3.10 RED+GREEN same file: RDD boundary — `gentle-ai review mode status` reports global/effective `off` before and after the file's run; delivery evidence reports `disabled/unmanaged`.
- [ ] W3.11 Verify: `pnpm test` — new file wired in; confirm task W3.5's acceptance-gate test is the only intentionally-failing test Wave 1 adds, and it is not silenced, skipped, or masked.

## Standing Constraint (all units)

No task may start, recover, retry, reset, or reclaim RDD authority. The 3 existing failures in
`tests/native-review-parity-runtime.test.ts` are expected RDD-off environment state; do not "fix"
or treat them as a regression signal in any of W1/W2/W3.
