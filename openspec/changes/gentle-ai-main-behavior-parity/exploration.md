# Exploration: gentle-ai-main-behavior-parity

## Supersession Notice (reconciled 2026-08-01)

This exploration is **retained as historical audit evidence**. Its baseline freeze, commit/issue matrix, maintainer decision summary, and #256 reconciliation remain authoritative and were re-verified.

Its **implementation-ownership conclusions are superseded** by `/home/gentleman/work/gentle-ai-pi-release-artifact-plan.md` (decisions D1–D12, §9, §11.C). The audit was correct about *what upstream changed*; it was wrong about *who implements it*. Both records are kept so a later reader can distinguish "we never knew" from "we knew and it was wrong."

| Section | Status | Reason it was superseded |
| --- | --- | --- |
| Audit Contract, Audit Counts, Method, Current State | **Authoritative** | Frozen, reproducible evidence. Unchanged. |
| Exhaustive Post-Baseline Commit Matrix | **Authoritative** | The dispositions per commit still hold. |
| Linked Thread and Maintainer Decision Summary | **Authoritative** | Maintainer scope decisions unchanged. |
| Umbrella #256 reconciliation tables | **Authoritative as evidence**; track dispositions re-owned | Completed/stale Pi records still stand. The "Implement now" verdicts on carry-forward tracks are re-owned below. |
| Tracks 1–2 (capture, admission recovery) | **Authoritative** | This is exactly Wave 1 / #2028 scope (D8). |
| **Tracks 3–7 (broad implement-now recommendation)** | **SUPERSEDED** | See the per-track table under "Verified Implement-Now Tracks". Wave 1 owns only what a release artifact cannot resolve. |
| **Recommendation ("Implement Tracks 1–7")** | **SUPERSEDED** | Replaced by the narrowed #2028-only recommendation recorded there. |
| **One-PR Workload Forecast (single 10,000-line PR)** | **SUPERSEDED** | Replaced by `auto-chain` W1→W2→W3 work units inside the Pi repository-local tracker (D6). |
| **Deferred Provider Pin Item** | **SUPERSEDED** | The pin, sync, install, mirrors, and lock belong to the consumer foundation change `consume-gentle-ai-release-artifacts` (D12), not Wave 1. |
| Risks | **Authoritative with two corrections** | The single-PR risk and the Wave-owned-pin risk are void; the rest stand. |
| Ready for Proposal | **SUPERSEDED** | Replaced by the reconciled closing statement. |

**Root cause of the error:** the audit treated "Gentle AI changed it" as "Gentle Pi must implement it." Three later findings corrected that:

1. Recurring hand-transcribed parity is being replaced by a provider-declared signed release artifact, so pin/mirror/fixture ownership moved to a dedicated consumer foundation change.
2. Git branches and PR parentage cannot cross repositories, so one 10,000-line cross-cutting PR was never a valid delivery shape.
3. #1819/#1915 are provider algorithms. Reconstructing their topology or authority graphs in TypeScript would create competing authority.

## Audit Contract

This exploration audits user-visible and lifecycle behavior, not source-file parity. The target experience is:

> Gentle Pi running in Pi behaves equivalently to Gentle AI running in OpenCode wherever Pi's host APIs permit, while provider-owned authority remains provider-owned.

The audit is frozen and reproducible:

| Item | Frozen value | Verification |
| --- | --- | --- |
| Audit freeze | `2026-07-31T22:27:01Z` | UTC wall clock captured immediately after fetching `Gentleman-Programming/gentle-ai` `main`. |
| Gentle Pi baseline | `5fe1beaab59d46e561ee8846a02ce67707dea7f1` | Clean `gentle-pi` worktree; merge commit for PR #260. |
| Gentle Pi provider pin | Gentle AI `v2.2.3` | `lib/gentle-ai-binary.ts`, installer/integrity assets, and PR #260 establish the package-local pin. |
| Verified Gentle AI baseline | `919ea3daf2afd8287bb42d86f8d979a9741b4b9e` | Annotated `v2.2.3` dereferences exactly to this commit; it is an ancestor of frozen `main`. No baseline adjustment is justified. |
| Frozen Gentle AI `main` | `74c565dc21891a0042d7a99b13ead3449055e794` | GitHub `main` and fetched `origin/main` agreed. Commit timestamp: `2026-07-31T22:26:07Z`. |
| Compared range | `919ea3daf2afd8287bb42d86f8d979a9741b4b9e..74c565dc21891a0042d7a99b13ead3449055e794` | 11 commits; 56 files; 2,049 additions and 295 deletions upstream. |
| Latest complete release in range | `v2.2.4` → `fdecaf570a20b042da36d0b0b6e0a21ee5fed182` | Published `2026-07-31T17:40:54Z`; it contains only the #2050 change and does **not** contain the later nine `main` commits. |
| RDD state during audit | global `off`, effective `off`, source `global` | Read-only `gentle-ai review mode status --json`; implementation and verification must preserve `disabled/unmanaged`. |

### Audit Counts

- Gentle AI commits after the verified baseline: **11**.
- Unique linked Gentle AI issues in that range: **6** — #2050, #2028, #1819, #1915, #2074, and #910.
- Merged Gentle AI PRs in that range: **1** — #2103. The remaining fixes were committed directly to `main` and closed with maintainer evidence comments.
- Provider-owned Gentle AI friction corpus at the baseline: **43 core journeys**, **5 damaged-store journeys**, and **12 real-world journeys**. None of the 11 audited commits modifies `bench/`, so the repaired issue flows currently have no new canonical benchmark pin. This is an upstream observation only and creates no Gentle Pi implementation scope.
- Post-baseline commit dispositions: **3 implement-now**, **3 provider-owned/no-action**, **3 host-specific/no-action**, **1 test-only/no-action**, and **1 merge-only/no-action**.
- Gentle Pi reconciliation scope: umbrella #256, seven child/related issue records (#196, #232, #242, #252, #254, #255, #259), and merged PRs #257, #258, and #260.

### Method and Evidence Rules

1. Resolved both repository roots and verified both CodeGraph indexes before structural exploration.
2. Used CodeGraph first for Gentle Pi entry points, native adapters, controller routing, lifecycle gates, SDD assets, skill registry, and tests.
3. Fetched Gentle AI `main` once, froze `74c565dc`, and inspected its Git history and source objects read-only without moving the Gentle AI worktree from `v2.2.3`.
4. Enumerated every commit in the frozen range, mapped each commit to an issue/PR, and read the complete issue and PR bodies/comments/reviews for the linked range.
5. Read umbrella gentle-pi #256, the completed child issues, related still-open administrative records, and merged PRs #257/#258/#260.
6. Treated maintainer statements and merged source as authoritative. CodeRabbit and Copilot comments are informational only and do not create implementation scope.
7. Classified behavior by user/lifecycle outcome. Provider algorithms are not copied into TypeScript merely because the upstream diff is large.

## Current State

Gentle Pi is clean at `5fe1bea` and correctly pins Gentle AI `v2.2.3`/`919ea3da`. PR #257 delivered bounded native/Git process handling, consent-lineage compatibility, candidate-view capacity diagnostics, and runtime failure preservation. PR #258 delivered focused reviews, actor-consumable large frozen scopes, and candidate-root FINALIZE behavior. PR #260 pinned and fully validated the `v2.2.3` package-local provider.

The canonical friction benchmark lives in the Gentle AI repository and is provider-owned. Its frozen corpus predates all six audited issue fixes, but this consumer workflow must neither modify it nor propose an upstream PR. Gentle Pi recurring evidence belongs only in Gentle Pi tests, dev-binary journeys, and package-local fixtures; provider-owned and wrong-host behavior remains no-action context until consumed through a qualifying immutable release.

That baseline is real but not behavior-complete. Two classes of work remain:

1. **New post-`v2.2.3` behavior**: accepted correction-plan requests and bounded reviewer-admission recovery.
2. **Merged carry-forward behavior already recorded by umbrella #256**: native SDD attempt authority, provider-defect handoff, repository-aware issue/privacy behavior, content-aware skill registry freshness, and delegated Key Learnings capture.

The current Pi review path also exposes a prerequisite defect that becomes unavoidable when adopting #2028:

- `extensions/gentle-ai.ts:5541-5549` gives `NativeReviewCliV216.finalize()` raw `lensResults`.
- `lib/native-review-cli.ts:2151-2158` stages those documents and computes `resultFiles`.
- `lib/native-review-cli.ts:2159-2174` never uses `resultFiles`; negotiated FINALIZE accepts only `--captured-results=true` or `--result-artifact-file`.
- `NativeReviewCliV216.captureResult()` exists at `lib/native-review-cli.ts:2287-2309`, but CodeGraph finds no production caller; current callers are tests.
- Pi's `subagent_run` hook injects a frozen candidate view before reviewer dispatch, but no production hook captures the returned reviewer document. Consequently, Pi can run actors yet drop their documents before native admission.

This is a user-experience gap, not file drift: OpenCode's managed plugin captures each reviewer result into provider authority; Pi currently does not.

## Exhaustive Post-Baseline Commit Matrix

| Commit | Issue / PR | Expected Gentle AI / OpenCode behavior | Current Gentle Pi behavior and concrete evidence | Disposition | Required Pi work |
| --- | --- | --- | --- | --- | --- |
| `e08f323b591f392d34113c9e72d10c8bcf2dba45` `fix(review): expose accepted correction findings` | Issue #2050; PR #2103 | Negotiated STATUS exposes an immutable `gentle-ai.review-correction-plan-request/v1` containing the exact accepted severe findings, lineage, authority revision, target, correction budget, and content hash. It remains available both before the forecast and at `stop/corrected_candidate_unavailable` until candidate content changes. Reading it consumes no correction authority. | `ReviewNextTransitionV3` has only `execute` and `collect`; `decodeReviewNextTransitionV3()` strictly rejects the new top-level `correction_request` (`lib/review-integration-v2.ts:327-332`, `1081-1121`). Pi instructions tell the user to change candidate content but cannot surface accepted claims safely. | **IMPLEMENT NOW — adapter + instruction + tests** | Add strict request types/decoder/hash validation, bind the request to status authority/target/budget, expose it losslessly to correction planning, retain it on the post-forecast stop, and reject malformed/mismatched requests before any edit. |
| `fdecaf570a20b042da36d0b0b6e0a21ee5fed182` `Merge pull request #2103` | PR #2103, closes #2050; tag target for `v2.2.4` | Merge metadata only; same behavior as `e08f323b`. | No additional behavior beyond the first parent. | **NO ACTION — merge-only** | Do not count or implement the behavior twice. |
| `37a18c3c8ed512b33ed938d93a53b0d3bdf4b88b` `fix(review): surface safe admission diagnostics` | Issue #2028 | Native admission retains fail-closed validation but emits bounded, privacy-safe typed diagnostics for invalid finding locations and unproven candidate causality. Diagnostics carry only safe code, finding ID, bounded repository-relative location, and reason. | Pi has no production `captureResult()` call, and no parser/validator for `admission_diagnostic`. A native rejection therefore cannot become an actionable Pi retry contract. | **IMPLEMENT NOW — adapter + tests** | Capture results natively, decode only the safe diagnostic allowlist, reject unsafe/malformed details, preserve opaque provider failures, and surface a correction instruction without leaking raw native prose. |
| `51a154632a36d12617a872ee2e24aca0464a4d2f` `fix(opencode): bound reviewer admission recovery` | Issue #2028 | The OpenCode plugin grants at most one corrected relaunch for the exact session/binding when a safe diagnostic exists. Generic, malformed, unavailable, or exhausted admission failures terminate. Successful capture and session disposal reclaim recovery state. The same result is never blindly replayed. | Pi has only pre-dispatch candidate injection (`extensions/gentle-ai.ts:6266-6282`) and no result-capture/recovery transaction. FINALIZE stages then drops lens documents. There is no exact-slot recovery counter or post-failure STATUS proof. | **IMPLEMENT NOW — Pi host equivalent + tests** | Capture each lens document through provider-issued tokens, refresh STATUS after rejection, permit one parent-driven relaunch only when the same lineage/target/revision/subject/lens/order slot is reoffered, clear state on success/session shutdown, and return terminal outcomes otherwise. |
| `a3788b99046551040d2be0767447e40b6f20b190` `fix(review): discover corrected current-changes delivery` | Issue #1819 | Selector-free pre-push receipt discovery accepts only the exact one-commit corrected current-changes delivery proven by `compactSquashedFixDelivery`; wrong candidate, path drift, extra commits, and non-squashed history remain denied. | Pi delegates pre-push validation to the package-local provider through `NativeReviewCli.validate()` and exact gate-target rederivation. The topology algorithm lives in provider `AssessCompactGateTarget`/`EvaluateCompactGate`, not Pi. | **PROVIDER-OWNED / NO ACTION** | Consume through the deferred stable pin and add released-binary gate proof; do not duplicate compact receipt discovery in TypeScript. |
| `0727a4df1c8023f5791dac5fc2b2bc546fa0b261` `fix(review): accept completed retry successor lifecycle` | Issue #1915 | A provider-created `retry-final-verification` successor may legitimately evolve from `validating` to terminal `approved`/`escalated` without being misclassified as frozen-authority drift. | Pi already decodes retry-final-verification status/incident bindings (`lib/review-integration-v2.ts:348-356`, `1248-1257`) and delegates whole-inventory validity to native STATUS/gates. | **PROVIDER-OWNED / NO ACTION** | Pin and prove that the released provider no longer reports false authority corruption. No Pi state machine should be added. |
| `e768dad70a72ac47f47577400aa935fd2d159fa1` `fix(review): validate retry successor evidence bindings` | Issue #1915 | Legitimate terminal lifecycle is accepted only with exact record-backed revision, target, outcome, and evidence-digest evolution; policy, snapshots, generation, correction accounting, and budget remain frozen. | Same provider-owned boundary as `0727a4df`; Pi transports status and exact authorization inputs but does not validate provider authority graphs. | **PROVIDER-OWNED / NO ACTION** | Released-binary inventory/gate proof only. Do not reproduce the Go graph invariant. |
| `3981066e8c9b0142b1161a8ce17b39287f64821f` `fix(engram): use Claude user registry` | Issue #2074 | Gentle AI installation for **Claude Code** writes user-scope Engram MCP registration into supported `~/.claude.json`, preserving unrelated data and bridging a managed legacy command. | Gentle Pi runs inside Pi and neither installs nor configures Claude Code's MCP registry. Pi's Engram tools are supplied by an independent Pi package/provider. | **HOST-SPECIFIC / NO ACTION** | None. Mirroring Claude configuration in Pi would be wrong-host behavior. |
| `2d2159d728e48c29bacd2aa3bee753df57ba736f` `fix(engram): retire legacy Claude config safely` | Issue #2074 | Exact managed `~/.claude/mcp/engram.json` files are migrated/removed safely; unmanaged shapes are preserved; rollback, uninstall, sync, and symlink-safe cleanup remain lossless. | Pi owns no Claude user or legacy MCP files. | **HOST-SPECIFIC / NO ACTION** | None. Preserve host separation. |
| `e1906c7655d51f4c063414bf37ec887223f0b507` `fix(windows): resolve PowerShell hosts predictably` | Issue #910 | Gentle AI's Windows installer/upgrade, Engram, GGA, PATH, and `.ps1` paths prefer `pwsh`, then `powershell.exe`, then `powershell`, while preserving lookup/launch diagnostics. The maintainer explicitly kept Scoop/PATH shadowing out of scope. | Gentle Pi's runtime adapter invokes the package-local Gentle AI executable directly and does not run Gentle AI's installer/upgrade/Engram/GGA PowerShell workflows. Gentle Pi's own binary installer is Node-based. | **PROVIDER INSTALLER / NO ACTION** | Consume incidentally when a future provider binary is pinned; no Pi PowerShell resolver or duplicate fallback ladder. |
| `74c565dc21891a0042d7a99b13ead3449055e794` `test(e2e): validate Claude user MCP registry` | Issue #2074 context; no PR | Strengthens upstream E2E evidence that Claude uses `~/.claude.json` and legacy Context7/Engram files are absent. It changes no runtime behavior. | No corresponding Pi/Claude path exists. | **TEST-ONLY / NO ACTION** | None. Do not copy an irrelevant host E2E test. |

### Linked Thread and Maintainer Decision Summary

- **#2050 / PR #2103**: Maintainers accepted a provider-owned, read-only correction request rather than exposing raw reviewer output. PR #2103 was merged with `size:exception`. CodeRabbit/Copilot comments arrived as informational comments on the merged head; there was no follow-up commit in the frozen range. They are not parity scope by themselves.
- **#2028**: Maintainer diagnosis explicitly preserved strict admission and required typed location errors, safe diagnostics, bounded recovery, and tests. The closing maintainer comment binds the fix to `37a18c3c` + `51a15463`: one exact-binding recovery, session cleanup, and terminal generic/exhausted refusals.
- **#1819**: A prior maintainer closure was corrected after a valid current-main reproduction. The final approved scope is deliberately narrow: exact one-commit corrected current-changes delivery only; wrong-candidate, extra-commit, path-drift, and non-squashed controls remain fail-closed.
- **#1915**: The accepted fix does not weaken frozen authority. Only expected terminal lifecycle/evidence fields may evolve; record-backed evidence, frozen metadata, correction accounting, generation, and budget remain exact.
- **#2074**: Scope is Claude Code **user scope**. Workspace-scope behavior is explicitly separate, and unmanaged legacy configurations must not be deleted.
- **#910**: Scope is shared PowerShell host resolution for supported Gentle AI Windows workflows. Scoop/PATH shadowing was explicitly ruled separate.

## Umbrella #256 and Gentle Pi Baseline Reconciliation

### Completed or Administratively Stale Pi Records

| Pi record | Current tracker state | Merged evidence | Reconciliation |
| --- | --- | --- | --- |
| #254 native status output limit | Closed | PR #257 / merge `4cf80701` | Complete; do not recreate. |
| #196 candidate-view `ENOBUFS` | Open | PR #257 adds explicit bounded candidate Git buffer and diagnostics | Behavior complete; tracker is administratively stale. Do not duplicate implementation. |
| #252 opaque/short candidate materialization timeout | Open | PR #257 adds bounded timeout override and sanitized timeout/output-limit categories | Behavior complete for #256 scope; tracker is administratively stale. |
| #255 fresh consent without lineage | Open | PR #257 accepts optional provider lineage and validates returned/prebound lineage | Behavior complete; tracker is administratively stale. |
| #232 INSPECT runtime diagnostics | Open | PR #257 preserves version/status diagnostics and package-local recovery guidance | Behavior complete for the reported cases; tracker is administratively stale. |
| #242 focused/large frozen scopes | Closed | PR #258 / merge `3d4a3627` | Complete; includes actor-consumable bounded scope and candidate-root FINALIZE. |
| #259 `v2.2.3` pin | Closed | PR #260 / merge `5fe1beaa` | Complete baseline pin; current-main pin is a new deferred item, not a duplicate. |

### Carry-Forward #256 Track Dispositions

| #256 track | Current canonical evidence | Pi status | Disposition |
| --- | --- | --- | --- |
| Large-repository reviewability | Pi PRs #257/#258 | Complete | No action. |
| Candidate-scoped decline delivery | Gentle AI #2045 remains open; current Pi accepts `disabled/unmanaged` only | No merged canonical fix after the freeze baseline | **Excluded from implementation**. Do not invent a candidate-decline discriminator/tree. |
| Native SDD attempt authority | Gentle AI commit `121d5a6a` (`feat(sdd): compact runtime attempt orchestration`) is inside `v2.2.3`; `sdd-attempt acquire/settle` and the orchestrator contract are merged | Pi has only `sddStatus`/`bindSdd`; no acquire/settle adapter or orchestration. Grep finds no production `sdd-attempt` use. | **Implement now**. |
| Reviewer/validator recovery | Post-baseline #2028 is now merged; prebaseline `354c5b50` keeps inconclusive validation provider-owned | Reviewer capture/retry is missing; targeted-validation admission remains provider-owned | **Implement reviewer capture/recovery now; no duplicate validator algorithm**. |
| Consent-first provider-defect handoff | `0d49f29d` + merge `afc8e7f6` are in `v2.2.3` and all OpenCode SDD orchestrator variants carry the mandatory two-choice handoff | Pi's `assets/sdd-orchestrator-workflow.md` has no provider-defect handoff | **Implement instruction/test parity now**. |
| Repository-aware issue workflow and privacy | `4efdb83b`/PR #1779 and `adabbd0e`/PR #1981 are in `v2.2.3` | Pi's `skills/issue-creation/SKILL.md` hard-codes another repository's policies/Discussions URL and has no mandatory privacy review | **Implement skill/test parity now**. |
| Skill registry freshness | `8c1b9e51`/PR #2019 hashes file content bytes and bumps cache schema | Pi fingerprint uses only path, mtime, and size (`extensions/skill-registry.ts:251-263`) | **Implement now**. |
| Delegated Key Learnings | `c7e2ad4d`/PR #1707 adds the closing contract to SDD and generic delegations | Pi phase/generic delegation assets do not require the closing section | **Implement centrally now**. |
| Stable provider repin | `v2.2.4` stops at `fdecaf57`; frozen current main has nine later commits | No stable release contains the whole frozen audit target | **Defer only this pin and final released-binary validation**. |

## Verified Implement-Now Tracks

> **Partially superseded.** The tracks below were written when Wave 1 was assumed to own every audited gap. Tracks 1–2 survive as Wave 1 scope. Tracks 3–7 are re-owned or deferred. The track bodies are preserved verbatim as research input for their new owners; do not read them as Wave 1 authority.

| Track | Original verdict | Reconciled owner | Reason |
| --- | --- | --- | --- |
| 1 — Native reviewer result capture | Implement now | **Wave 1 (W1)** | #2028 Pi-host behavior. A release artifact cannot supply it. |
| 2 — Privacy-safe admission recovery | Implement now | **Wave 1 (W2)** | #2028 Pi-host behavior. A release artifact cannot supply it. |
| 3 — Accepted correction-plan request projection | Implement now | **Deferred to a dedicated #2050 SDD change** | #2050 is outside this Wave. The frozen schema/emitter mismatch it depends on is a release-acceptance risk, not Wave 1 scope. |
| 4 — Native SDD attempt authority | Implement now | **Deferred to a dedicated #256 carry-forward SDD change** | Umbrella carry-forward track, not post-baseline Wave 1 behavior. |
| 5 — Provider-defect and repository issue safety | Implement now | **Deferred to a dedicated #256 carry-forward SDD change** | Same. |
| 6 — Skill freshness and delegated learnings | Implement now | **Deferred to a dedicated #256 carry-forward SDD change** | Same. |
| 7 — Pi-owned recurring parity journeys | Implement now | **Split** | The generic immutable-evidence harness and package fixtures move to the consumer foundation (P3). Wave 1 keeps only the #2028 host journeys and the #1819/#1915/#2074/#910 issue-specific assertions that run on top of that harness (W3). |

### Track 1 — Native Reviewer Result Capture

**Goal:** make Pi-delivered lens output reach provider admission before FINALIZE.

Required behavior:

1. Use the exact provider-issued `review.capture-result` collect arguments/tokens from fresh STATUS.
2. Capture each selected lens exactly once against lineage, target, revision, repository context, subject hash, lens, and order.
3. Validate each returned `gentle-ai.review-result-artifact/v2` manifest.
4. FINALIZE only through `capturedResults: true` or exact admitted artifact manifests; never use retired `--result` transport.
5. If STATUS discovers that capture committed despite lost output, continue without rerunning the lens.
6. Preserve candidate-root execution and cleanup from PR #258.

Likely seams:

- `extensions/gentle-ai.ts`
- `lib/native-review-cli.ts`
- `runtime/native-review-cli.mjs`
- `tests/review-controller-native-recovery.test.ts`
- `tests/review-controller-native-routing.test.ts`
- `tests/native-review-cli.test.ts`

### Track 2 — Privacy-Safe, Status-Mediated Admission Recovery

**Depends on:** Track 1.

Required behavior:

1. Decode only the merged safe diagnostics: `invalid_finding_location` and `candidate_causality_unproven`, with strict ID/location/reason bounds.
2. Never relay arbitrary native diagnostic prose or candidate contents.
3. Query fresh STATUS after capture failure.
4. Authorize at most one corrected parent-driven lens relaunch only when STATUS reoffers the exact same bound slot.
5. Never replay rejected bytes; the corrected reviewer result must be newly produced.
6. Clear recovery state on successful capture and `session_shutdown`.
7. Return terminal `unavailable`/`exhausted` outcomes for unsafe, missing, malformed, mismatched, or second-failure diagnostics.

Likely seams:

- `extensions/gentle-ai.ts`
- `lib/native-review-cli.ts`
- `tests/review-controller-native-recovery.test.ts`
- `tests/review-controller-native-routing.test.ts`

### Track 3 — Accepted Correction-Plan Request Projection — SUPERSEDED (deferred, #2050)

> Not Wave 1 scope. Preserved as research input for the later dedicated #2050 change.

**Depends on:** Tracks 1 and 2 producing admitted findings.

Required behavior:

1. Add a strict typed correction-request decoder.
2. Recompute/verify its canonical hash and require canonical ordered `fix_finding_ids` matching findings.
3. Bind lineage, expected revision, target, and budget to current compact STATUS.
4. Permit only severe accepted candidate-caused findings with concrete evidence and supported evidence/causality classes.
5. Expose the same request at `collect/correction_plan_required` and `stop/corrected_candidate_unavailable`.
6. Update Pi instructions so the model plans only from provider-accepted findings and never raw lens output.

Likely seams:

- `lib/review-integration-v2.ts`
- `runtime/review-integration-v2.mjs`
- `extensions/gentle-ai.ts`
- `tests/review-integration-v2.test.ts`
- `tests/review-controller-native-routing.test.ts`
- `tests/review-correction-lifecycle.test.ts`

**Current-main contract risk:** the frozen Gentle AI schema lists short lens values (`risk`, `resilience`, `readability`, `reliability`), while the Go emitter copies `Finding.Lens`, whose constants are `review-risk`, `review-resilience`, `review-readability`, and `review-reliability`. This mismatch was independently verified from frozen source. Pi can implement the runtime envelope defensively now, but the deferred release pin MUST reject a release whose published schema and emitted request remain inconsistent.

### Track 4 — Native SDD Attempt Authority — SUPERSEDED (deferred, #256 carry-forward)

> Not Wave 1 scope. Preserved as research input for the later dedicated carry-forward change.

**Independent after shared native-adapter groundwork.**

Required behavior:

1. Add package-local typed `sdd-attempt acquire` and `settle` adapter operations.
2. Before every runtime-bearing `sdd-apply`, `sdd-verify`, or remediation actor/harness launch, acquire with one idempotent request ID, work unit, evidence goal, max attempts, and the **10,000 changed-line operational ceiling**.
3. Launch only on `state: proceed`; `blocked` and `complete` stop launches.
4. Settle after execution with a distinct request ID, opaque token, outcome, evidence revision, diagnosis, harness disposition, cleanup evidence, and process evidence.
5. Route only from provider `proceed`/`blocked`/`complete`.
6. Never persist caller-authored attempt counters in prompts, Pi state, OpenSpec, or Engram.
7. Never call legacy `reset` automatically. With RDD globally off, settle must remain compatible with `disabled/unmanaged` and must not manufacture a review obligation.

Likely seams:

- `lib/native-review-cli.ts`
- `runtime/native-review-cli.mjs`
- `extensions/gentle-ai.ts`
- `assets/sdd-orchestrator-workflow.md`
- `assets/agents/sdd-apply.md`
- `assets/agents/sdd-verify.md`
- `assets/chains/sdd-full.chain.md`
- `tests/native-review-cli.test.ts`
- `tests/sdd-status.test.ts`
- `tests/sdd-preflight.test.ts`
- new focused SDD-attempt controller tests if no existing file is a coherent home

### Track 5 — Provider-Defect and Repository Issue Safety — SUPERSEDED (deferred, #256 carry-forward)

> Not Wave 1 scope. Preserved as research input for the later dedicated carry-forward change.

Required behavior:

1. Add the orchestrator-owned two-choice handoff: report the apparent Gentle AI defect or stop here.
2. Ask first in the active conversation language; create no GitHub side effect without explicit consent.
3. Never offer to switch into, inspect, modify, or repair the Gentle AI source repository from a blocked consumer workflow.
4. Preserve consumer state and stop after reporting.
5. Resume only after an installed released fix and fresh native status.
6. Replace Pi's repository-specific issue skill with repository discovery for issue support, templates/forms, labels, blank issue policy, Discussions routing, and open/closed duplicate search.
7. Run a mandatory final privacy scan replacing private project names, usernames, hostnames, home paths, credentials, and internal endpoints with explicit placeholders.

Likely seams:

- `assets/sdd-orchestrator-workflow.md`
- `assets/orchestrator.md` and/or its lazy delegation detail
- `skills/issue-creation/SKILL.md`
- package manifest/resource verification
- focused artifact/contract tests plus `tests/artifact-language.test.ts`

### Track 6 — Skill Freshness and Delegated Learnings — SUPERSEDED (deferred, #256 carry-forward)

> Not Wave 1 scope. Preserved as research input for the later dedicated carry-forward change.

Required behavior:

1. Include each `SKILL.md` content digest in the cache fingerprint and bump the cache schema so metadata-only cache entries invalidate once.
2. Preserve project-over-user precedence, deterministic input ordering, file deletion detection, unreadable-file handling, and watcher shutdown behavior.
3. Add one central SDD/generic delegation closing contract requiring `## Key Learnings` with 1–5 numbered standalone facts, each at least 20 characters and four words.
4. Do not apply the generic learning closeout to native review-lens payloads or Judgment Day verdict artifacts.

Likely seams:

- `extensions/skill-registry.ts`
- `tests/skill-registry.test.ts`
- `assets/sdd-orchestrator-workflow.md`
- `assets/orchestrator-delegation.md`
- SDD agent prompt injection or phase assets
- package/resource contract tests

### Track 7 — Pi-Owned Recurring Parity Journeys — SUPERSEDED IN PART (split)

> The generic evidence harness, package fixtures, and dev-binary plumbing described below are **consumer-foundation (P3)** scope, not Wave 1. Wave 1 (W3) keeps only the issue-specific assertions layered on that harness: #2028 host journeys, #1819/#1915 immutable-release evidence consumption, and the explicit #2074/#910 no-action dispositions. The "sole deferred pin" framing in row 7 of the journey rules is void.

**Depends on:** Tracks 1–4 for Pi-host journeys and package-local provider routing.

The user explicitly requires repaired issue flows to have recurring evidence without crossing the consumer boundary. This track adds only Gentle Pi-owned tests, dev-binary journeys, and package fixtures:

| Issue | Durable journey evidence | Required assertions | Placement |
| --- | --- | --- | --- |
| #2050 accepted correction findings | Pi decoder/projection fixtures plus a package-local dev-binary journey | Require the exact immutable request, canonical hash, lineage/revision/target/budget bindings, stable projection across repeated STATUS, `collect/correction_plan_required` before forecast, and `stop/corrected_candidate_unavailable` after forecast. Pi must never reconstruct findings or consume correction authority by reading the request. | Gentle Pi unit/controller tests now; `tests/devbinary/native-review-parity.devtest.ts` against the qualifying release. |
| #2028 safe admission and bounded recovery | Pi native-adapter fixtures plus a Pi-host one-relaunch journey | Decode only allowlisted code/finding/location/reason; emit no raw native prose, private path, or rejected payload; relaunch with newly produced corrected bytes; permit one exact-slot relaunch; prove mismatch, missing diagnostic, second failure, success, and session shutdown are terminal or reclaim state as specified. | Gentle Pi native/controller tests now; package-local dev-binary journey at the final pin. |
| #1819 corrected current-changes delivery | Package-local provider gate journey | Exact one-commit squashed corrected delivery passes selector-free pre-push discovery with a valid base relationship; wrong candidate, path drift, extra commit, and non-squashed delivery remain denied. Pi only transports the native result and must not reproduce the topology algorithm. | Gentle Pi dev-binary/package fixture; execution bundled with the final pin. |
| #1915 completed retry successor | Package-local status/gate journey | A completed `retry-final-verification` successor remains complete and authoritative for approved and escalated outcomes; Pi surfaces the native status without false corruption or a local authority graph. | Gentle Pi dev-binary/package fixture; execution bundled with the final pin. |
| #2074 Claude user registry | No Pi journey | Claude user-registry installation and legacy cleanup have no Pi host surface. | **HOST-SPECIFIC / NO ACTION**. |
| #910 PowerShell host fallback | No Pi journey | Gentle AI installer/upgrade/Engram/GGA PowerShell resolution has no Pi runtime surface. | **PROVIDER INSTALLER / NO ACTION**. |

Journey rules:

1. Create or modify files only in Gentle Pi. Do not modify, vendor, fork, or propose changes to the canonical Gentle AI benchmark.
2. Every Pi journey fixture must prove its premise before invoking the package-local binary, and every interesting non-blocking answer must use an assertion so regressions fail loudly instead of producing false success.
3. Older package-local binaries that lack a required capability must skip or report `unsupported`; absence must never be recorded as a passing zero-cost flow.
4. The #2028 host relaunch is Pi behavior and must be proven through Pi fake-adapter tests before the qualifying binary exists, then through `pnpm test:dev-binary` at the final pin.
5. #1819 and #1915 remain provider-owned algorithms. Pi journey code may prove package-local transport and rendering, but must not recreate or mutate native authority.
6. #2074 and #910 remain explicit no-action dispositions. Claiming Pi journey coverage for them would be false.
7. Dev-binary execution requiring the new provider behavior remains bundled with the sole deferred provider pin and immutable released-binary validation item; journey definitions and fake/package fixtures are implement-now Pi work.

Likely seams:

- `tests/native-review-parity.test.ts`
- `tests/native-review-parity-runtime.test.ts`
- Gentle Pi `tests/devbinary/native-review-parity.devtest.ts`
- Gentle Pi package/runtime journey fixtures needed to bind the qualifying package-local binary

## Explicit No-Action / Provider-Owned / Host-Difference Dispositions

### Provider-Owned, Consumed by Pin

- Corrected current-changes receipt discovery: `a3788b99` / #1819.
- Completed retry-final-verification successor lifecycle and evidence binding: `0727a4df` + `e768dad7` / #1915.
- Immutable path admission, nested-cwd target status, directory-evidence rejection, targeted-validation admission, and authority graph validity already recorded in #256.
- Inconclusive targeted validation remains a native admission decision. Pi must route STATUS and preserve the typed result, not reproduce the provider's correction-attempt accounting.

### Pi Host Has No Equivalent Surface

- Claude Code user registry migration and legacy cleanup: `3981066e`, `2d2159d7`, `74c565dc` / #2074.
- Gentle AI's Windows installer/upgrade/GGA/Engram PowerShell host resolution: `e1906c76` / #910.

### Metadata/Test-Only

- Merge commit `fdecaf57` adds no behavior beyond `e08f323b`.
- `74c565dc` is test-only and does not create an additional runtime requirement.

## Excluded Open/Unmerged Context

No implementation task may be derived from these items at the frozen revision. They can inform risk only.

| Issue(s) | Frozen reason for exclusion |
| --- | --- |
| #2045 candidate-decline tree/delivery | Open; no canonical merged discriminator/tree contract. Candidate decline must remain distinct from global `disabled/unmanaged`. |
| #1892 historical repair edge | Open; no merged canonical fix in the 11-commit range. |
| #2014 content-mismatched recovery quarantine | Open; no merged canonical fix. |
| #2069 disabled review mode stale SDD binding | Open; no merged canonical fix. Verification must keep RDD off but must not speculate on this fix. |
| #1921 correction-required workspace recovery | Open; no merged canonical fix. |
| #1925 in-budget compact correction dead-end | Open; no merged canonical fix. |
| #2106 reviewer-task native binding injection | Open after the freeze range; no merged behavior. |
| #2114, #2116, #2117, #2107 SDD-attempt/task regressions | Open. Implement only the currently merged acquire/settle contract; do not guess their eventual fixes. |
| #2088, #2085, #2090, #2091, #2092, #2093 and similar recovery/admission reports | Open or not canonically merged into frozen `main`; list as final-pin risks only. |
| Any screenshot-only item | Excluded unless its canonical fix is one of the frozen merged commits above. A screenshot is not merge evidence. |

## Affected Areas

- `extensions/gentle-ai.ts` — review capture/recovery orchestration, correction-request projection, SDD attempt routing, session cleanup, and generated prompt guidance.
- `lib/native-review-cli.ts` — package-local capture, correction, and SDD-attempt adapters.
- `runtime/native-review-cli.mjs` — generated runtime parity for the TypeScript adapter.
- `lib/review-integration-v2.ts` — strict correction-request and transition decoding.
- `runtime/review-integration-v2.mjs` — generated decoder runtime parity.
- `assets/sdd-orchestrator-workflow.md` — SDD attempt authority and provider-defect handoff.
- `assets/agents/sdd-apply.md`, `assets/agents/sdd-verify.md`, `assets/chains/sdd-full.chain.md` — attempt-ledger launch/settle semantics and delegated closing behavior.
- `skills/issue-creation/SKILL.md` — repository-aware issue and privacy behavior.
- `extensions/skill-registry.ts` — content-aware fingerprints.
- `tests/review-integration-v2.test.ts` — correction-request schema/binding acceptance and rejection.
- `tests/review-controller-native-recovery.test.ts` — capture, loss-of-output, exact-slot recovery, and exhaustion.
- `tests/review-controller-native-routing.test.ts` — controller projection and fail-closed routing.
- `tests/native-review-cli.test.ts` — exact argv/response contracts.
- `tests/sdd-status.test.ts`, `tests/sdd-preflight.test.ts`, `tests/sdd-agent-tools.test.ts` — native SDD attempt orchestration.
- `tests/skill-registry.test.ts` — metadata-preserving content invalidation and watcher behavior.
- `tests/artifact-language.test.ts`, package manifest/resource tests, and runtime harness — shipped instruction/runtime parity.
- `tests/devbinary/native-review-parity.devtest.ts` — non-gating Pi-host journeys for capture, correction projection, bounded recovery, and package-local provider behavior.
- `tests/native-review-parity.test.ts`, `tests/native-review-parity-runtime.test.ts`, and package fixtures — recurring Pi-owned contract and released-binary evidence for provider-owned #1819/#1915 behavior.

## Approaches

1. **Thin Pi adapters plus Pi-owned behavior and journey evidence** — consume native authority, adapt host lifecycle seams, reproduce OpenCode outcomes without copying Go state machines, and pin repaired issue flows through Gentle Pi tests, dev-binary journeys, and package fixtures only.
   - Pros: preserves one provider authority; keeps the change inside one Gentle Pi PR; works with Pi host APIs; allows most work before the release pin; keeps provider defects visible; supports strict fail-closed tests and recurring package-local evidence.
   - Cons: requires careful capture/recovery orchestration and generated-runtime synchronization; live released-binary proof waits for the next complete stable release; canonical provider benchmark gaps remain outside this consumer change.
   - Effort: High.

2. **Pin `v2.2.4` first and patch only resulting failures** — consume the currently published release before adapting Pi.
   - Pros: small immediate dependency update.
   - Cons: `v2.2.4` ends at `fdecaf57` and omits nine frozen `main` commits; it would not satisfy current-main parity, would hide known adapter gaps, and violates the requested deferral.
   - Effort: Low initially, high rework.

3. **Copy upstream provider/OpenCode implementation into Pi** — port Go authority/gate logic and the OpenCode plugin literally.
   - Pros: superficial file similarity.
   - Cons: creates competing authority, duplicates provider algorithms, imports wrong-host APIs, increases drift, and weakens the package-local trust boundary.
   - Effort: Very high and architecturally incorrect.

## Recommendation

> **SUPERSEDED.** The original text is preserved immediately below for audit, followed by the reconciled recommendation that now governs this change.

**Original (superseded):** "Use **Approach 1**. Implement Tracks 1–7 entirely in Gentle Pi as thin adapters, Pi-native lifecycle behavior, instructions, tests, dev-binary journeys, and package fixtures. Keep native gate/authority algorithms and canonical provider benchmark gaps provider-owned/no-action. Defer only the provider pin and final immutable package-local released-binary validation until a stable tag contains the required frozen-main behavior."

**Reconciled recommendation.** Keep Approach 1's architectural principle — thin Pi adapters, never copied provider algorithms — but narrow the delivery scope to **#2028 Pi-host behavior only**, split into W1 → W2 → W3 work units inside the Gentle Pi repository-local tracker.

Wave 1 implements only what a release artifact cannot resolve:

- capture each provider-issued reviewer result against the exact fresh STATUS slot and manifest;
- validate lineage, target, authority revision, repository context, subject hash, lens, and order;
- decode only privacy-safe allowlisted diagnostics with bounded fields;
- query fresh STATUS after a capture or admission failure;
- permit at most one same-slot, parent-driven, newly authored relaunch;
- never replay rejected bytes;
- recover when output was lost but fresh STATUS proves the capture committed;
- clear capture and recovery state on success and session shutdown; and
- terminate malformed, unsafe, mismatched, unavailable, or exhausted cases without weakening native authority.

Wave 1 does **not** own the version pin, install, sync, generators, drift gates, mirrors, lock, bump automation, or the generic immutable-evidence harness. Those belong to `consume-gentle-ai-release-artifacts`.

## Strict TDD and Verification Contract

Strict TDD is active from `openspec/config.yaml`. Every work unit must record RED → GREEN → TRIANGULATE → REFACTOR evidence in `apply-progress.md`, and tests must ship with the behavior they prove.

### Required RED Evidence

| Track | RED that must fail before production edits | Required controls |
| --- | --- | --- |
| 1 result capture | A production-flow test proves lens documents never call `captureResult()` and FINALIZE receives neither admitted manifests nor `--captured-results=true`. | Exact token binding, one capture per lens, no retired `--result`, committed-capture discovery after lost output. |
| 2 admission recovery | Safe diagnostic input currently yields only generic failure/no bounded recovery. | Unsafe path/control chars, malformed JSON, unknown reason/code, different STATUS slot, second failure, success cleanup, session shutdown. |
| 3 correction request | Current strict decoder rejects valid `correction_request`. | Hash mismatch, duplicate/out-of-order IDs, lineage/revision/target/budget mismatch, unsupported lens/severity/evidence/causality, illegal reason/kind pairing. |
| 4 SDD attempts | Runtime-bearing phase launch currently occurs without acquire/settle authority. | `proceed`, `blocked`, `complete`, distinct IDs, idempotent replay, ceiling enforcement, no automatic reset, no caller counters. |
| 5 defect/issues | Existing Pi artifacts accept repository-specific assumptions and omit provider-defect/privacy gates. | Missing discovery, late discovery, duplicate search, disabled blank issues, unknown label, Discussions disabled, privacy placeholders, no-consent no-side-effect. |
| 6 skill/learnings | Same-size/same-mtime content edit currently returns a cache hit; delegated phase output has no required learning closeout. | Add/delete/order independence, unreadable file, project precedence, watcher shutdown, SDD/generic inclusion and review/JD exclusion. |
| 7 Pi recurring journeys | Pi-host behavior lacks package-local end-to-end pins for the repaired flows it consumes. | #2050 pre/post-forecast request projection; #2028 diagnostic privacy, fresh recapture, exact-slot one-relaunch/exhaustion/cleanup; #1819 exact delivery plus denial controls through the package-local provider; #1915 approved/escalated retry completion transport; explicit #2074/#910 no-action dispositions. |

### Focused GREEN Commands

Use the smallest relevant set during each cycle, then run the combined focused set:

```text
node --experimental-strip-types --test \
  tests/review-integration-v2.test.ts \
  tests/native-review-cli.test.ts \
  tests/review-controller-native-recovery.test.ts \
  tests/review-controller-native-routing.test.ts \
  tests/review-correction-lifecycle.test.ts

node --experimental-strip-types --test \
  tests/sdd-status.test.ts \
  tests/sdd-preflight.test.ts \
  tests/sdd-agent-tools.test.ts

node --experimental-strip-types --test \
  tests/skill-registry.test.ts \
  tests/artifact-language.test.ts \
  tests/package-manifest.test.ts \
  tests/verify-package-files.test.ts
```

`pnpm test:dev-binary` executions that require new provider behavior are non-gating during implementation. They require a qualifying package-local released binary and belong to the deferred final pin validation; they must not be substituted with a mutable `main` build.

### Full Verification

1. Before tests, run read-only `gentle-ai review mode status --json` and require global/effective `off`.
2. Never invoke, recover, retry, or enable RDD. In particular, do not call review START, recovery, retry-final-verification, reset, reclaim, or mode enable.
3. Review-controller behavior tests use fake adapters and disposable fixture state. SDD-attempt tests may use a disposable native SDD runtime ledger because it is not RDD; they must not create review authority. Current verification must not drive review START/recover/retry dev-binary journeys.
4. Run:

```text
pnpm test
node scripts/verify-package-files.mjs
pnpm run check:transaction-runner
pnpm run test:packed-runner
git diff --check
```

5. Re-run read-only review mode status and prove it is still global/effective `off`.
6. Delivery evidence must report `disabled/unmanaged`; no receipt or approval may be fabricated.
7. CodeRabbit is informational only. Repository tests/package verification are the gate.
8. Final real released-binary journeys for #2050, #2028, #1819, and #1915 are deferred with the provider pin. They must use only Gentle Pi's package-local dev-binary/package fixtures; no source checkout or mutable `main` binary substitutes for that evidence. #2074 and #910 remain no-action host differences.

## One-PR Workload Forecast — SUPERSEDED

> **This forecast is void as a delivery plan.** It sized Tracks 1–7 as one Gentle Pi `size:exception` PR. Wave 1 now covers only Tracks 1–2 plus the #2028/#1819/#1915 assertion slice of Track 7, delivered as chained `auto-chain` work units W1 → W2 → W3. The per-unit line estimates below remain useful research input for the changes that inherited each track; the totals, the single-PR shape, and the "hard operational stop at 10,000" PR framing do not apply.
>
> The 10,000-line figure is a **planning ceiling for the whole initiative**, never permission for a 10,000-line PR. `sdd-tasks` must produce a fresh forecast for W1–W3 against the normal 400-line review budget.

**Original forecast (superseded), preserved for audit:**

The user has selected exactly one Gentle Pi PR with maintainer-approved `size:exception` (`delivery_strategy: exception-ok`). Work must remain entirely in Gentle Pi and still be split into reviewable, independently revertible commits with tests beside behavior.

| Work unit | Forecast changed lines |
| --- | ---: |
| Native result capture and manifest transport | 650–1,100 |
| Admission diagnostic validation and exact-slot recovery | 450–850 |
| Correction-request decoder/projection/instructions | 350–700 |
| Native SDD attempt adapter/orchestration | 700–1,200 |
| Provider-defect + issue/privacy contracts | 350–700 |
| Skill fingerprint + delegated learnings | 250–500 |
| Pi host parity dev-binary journeys | 300–650 |
| Generated runtime, package verification, and integration/harness adjustments | 700–1,400 |
| **Forecast total for the Gentle Pi PR** | **3,750–7,100** |
| Contingency ceiling | **8,500 expected; hard operational stop at 10,000** |

The 10,000-line native operational ledger ceiling applies to this one Gentle Pi implementation objective and PR. If measured changed lines would exceed it, stop and redesign scope; do not reset, silently open another objective, or move work into an upstream repository.

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

Recommended work-unit commit story:

1. Capture native reviewer artifacts with tests.
2. Bound admission recovery with tests.
3. Project accepted correction requests with tests.
4. Adopt native SDD attempt authority with tests.
5. Align provider-defect and issue/privacy behavior with tests.
6. Make skill freshness content-aware and close delegated learnings with tests.
7. Add Pi-owned contract, dev-binary, and package-local parity journeys.
8. Regenerate/package only the artifacts implied by those work units and run full verification.

## Deferred Provider Pin Item — SUPERSEDED

> **The "sole deferred item" claim is void.** Pinning, capability/schema/fixture/documentation/archive/executable/SumDB pins, package mirror regeneration, and released-binary validation are owned by the consumer foundation change `consume-gentle-ai-release-artifacts` (units P1–P4), not deferred inside Wave 1. Wave 1 depends on that foundation; it does not carry the pin.
>
> Three further items previously folded under "one deferred pin" are now separate, explicitly deferred SDD changes: **#2050** correction-plan projection, the **#256 carry-forward** tracks, and any later Wave. The frozen correction-request schema/emitter mismatch remains a **release-acceptance risk** evaluated by the foundation, not Wave 1 implementation scope.

**Original text (superseded), preserved for audit:**

Exactly one implementation item is deferred:

> Pin the first stable Gentle AI release whose immutable tag contains the required frozen-main behaviors, update exact capability/schema/fixture/documentation/archive/executable/SumDB pins, regenerate package mirrors, and run final package-local released-binary validation.

`v2.2.4` is not sufficient for the complete target because it dereferences to `fdecaf57` and excludes `37a18c3c..74c565dc`. The eventual version must not be guessed. The pin gate must also reconcile the correction-request schema/emitter mismatch before acceptance and execute the new Pi-owned dev-binary/package journeys against the immutable package-local binary. Journey authoring is implement-now Pi work, not a second deferred item; only execution against the qualifying release waits for the pin.

## Risks

- **Re-owned:** the frozen correction-request schema/emitter mismatch is real, but it is a **release-acceptance risk** evaluated by the release-artifact foundation, not Wave 1 adapter scope. Wave 1 builds no correction-request decoder.
- **Re-owned:** the open SDD-attempt regressions belong to the deferred #256 carry-forward change. Wave 1 implements no acquire/settle adapter.
- Pi lacks OpenCode's exact `tool.execute.after` hook. Capturing actor output during Pi FINALIZE is behaviorally viable, but the design must preserve the same exact-slot, one-relaunch, and committed-capture semantics.
- Four Pi issue records remain open despite merged behavior in PR #257. Future planning can duplicate work unless the proposal/tasks carry this reconciliation explicitly.
- Full verification with RDD globally off intentionally cannot prove live review mutations. Fake-adapter contract tests must be strong, and the real provider journey remains part of the deferred pin.
- The canonical Gentle AI benchmark lacks new pins for the audited fixes, but that is provider-owned/no-action context. This consumer change must not hide a second implementation stream or propose upstream work.
- Claude user-registry migration and Windows PowerShell fallback have no Pi surface. Those issue flows remain explicit host/provider no-action dispositions rather than false Pi journey coverage.
- **Void:** the "single PR well above the 400-line budget" risk no longer applies. Wave 1 delivers chained `auto-chain` work units W1 → W2 → W3, each a bounded, independently revertible review unit with its tests. `sdd-tasks` must forecast against the normal 400-line budget.
- **New:** Wave 1 depends on the release-artifact foundation. If `consume-gentle-ai-release-artifacts` slips or changes its interfaces, W3 evidence consumption blocks. W1/W2 host behavior can still proceed against fakes and bootstrap seams.
- Current Gentle AI `main` may advance after the freeze. This change targets only `74c565dc`; later commits require a new explicit audit.

## Ready for Proposal

> **SUPERSEDED.** Original: "**Yes.** ... The proposal must produce one `size:exception` Gentle Pi PR and must not modify or propose modifying Gentle AI." The audit conclusion holds; the delivery instruction does not.

**Reconciled.** The audit evidence is sufficient and remains verified. The proposal it now supports is narrower: **#2028 Pi-host behavior only**, delivered as `auto-chain` work units W1 → W2 → W3 in the Gentle Pi repository-local tracker, depending on the release-artifact foundation for pin, install, mirrors, lock, and the generic immutable-evidence harness. The no-second-repository instruction is void — Gentle AI provider work exists, but it lives in its own change (`publish-gentle-ai-release-artifacts`) with its own repository-local tracker and no cross-repository child PR. RDD remains globally and effectively disabled throughout.
