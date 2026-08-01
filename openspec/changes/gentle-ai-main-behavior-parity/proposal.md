# Proposal: Gentle AI Main Behavior Parity — Wave 1 (#2028 Pi-Host Behavior)

## Intent

**Problem.** Pi runs review lenses but drops their documents before native admission. `NativeReviewCliV216.captureResult()` has no production caller; FINALIZE stages `resultFiles` then ignores them. OpenCode's managed plugin captures each reviewer result into provider authority; Pi does not. Reviewer work is therefore silently lost.

**Why now.** The release-artifact foundation supplies trusted provider data and evidence, but it cannot supply host behavior. Capture, admission, bounded recovery, and cleanup are Pi's own responsibility and remain broken until implemented here.

**Success.** Pi reproduces the OpenCode outcome for Gentle AI #2028 without copying provider authority.

## Scope

### In Scope — #2028 Pi-host behavior only

- Capture each provider-issued reviewer result against the exact fresh STATUS slot and manifest.
- Validate lineage, target, authority revision, repository context, subject hash, lens, and order.
- Decode only privacy-safe allowlisted diagnostics with bounded fields.
- Query fresh STATUS after a capture or admission failure.
- Permit at most one same-slot, parent-driven, newly authored relaunch; never replay rejected bytes.
- Recover when output was lost but fresh STATUS proves the capture committed.
- Clear capture and recovery state on success and on session shutdown.
- Terminate malformed, unsafe, mismatched, unavailable, or exhausted cases without weakening native authority.
- Consume immutable-release evidence for #1819/#1915 through the foundation's generic harness; assert transport and outcomes only.
- Record #2074 and #910 as explicit no-action, wrong-host dispositions.

### Out of Scope

- **Owned by `consume-gentle-ai-release-artifacts`:** version pin, install, sync, generators, drift gates, mirrors, lock, bump automation, and the generic immutable-evidence harness.
- **Provider-owned:** #1819 corrected-delivery topology and receipt discovery; #1915 retry-successor authority and evidence-graph validation. Pi must never reconstruct these in TypeScript.
- **Deferred to dedicated changes:** #2050 and the umbrella #256 carry-forward tracks.
- **Already landed outside every tracker:** PR #262 (authoritative version pin) and PR #263 (additive-tolerant gates and projections). Not Wave 1 work.
- Starting, enabling, recovering, or requiring RDD.

## Capabilities

### New Capabilities

- `provider-behavior-parity`: immutable-release evidence consumption for #1819/#1915 plus explicit #2074/#910 no-action boundaries.

### Modified Capabilities

- `review-orchestration`: exact-slot capture and one status-mediated corrected relaunch.
- `review-transaction`: safe native result admission, lost-output reconciliation, RDD-disabled delivery.

## Approach

Thin native adapters plus Pi orchestration. Strict TDD: failing contract and controller tests first, fake adapters for host behavior, immutable-release evidence for provider outcomes. Preserve opaque provider failures.

**Delivery.** `delivery_strategy: exception-ok`, `chain_strategy: feature-branch-chain`, repository-local to Gentle Pi. Work is organized as **auto-chained** units inside the Pi tracker:

| Unit | Deliverable |
|---|---|
| W1 | Exact result capture and admission |
| W2 | Allowlisted diagnostics, one exact-slot relaunch, lost-output recovery, cleanup |
| W3 | #1819/#1915 evidence consumption, #2074/#910 and RDD no-action assertions |

Each unit ships its own tests and rollback boundary. An over-budget slice records an accepted `size:exception` rather than blocking; it never authorizes one oversized PR.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `extensions/gentle-ai.ts` | Modified | Capture, recovery, cleanup, routing |
| `lib/native-review-cli.ts`, `runtime/native-review-cli.mjs` | Modified | Native contract and runtime mirror |
| `tests/review-controller-native-*.test.ts` | Modified | #2028 host behavior |
| `tests/native-review-parity*.test.ts` | Modified | Issue-specific evidence assertions |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pi lacks OpenCode's `tool.execute.after` hook | Medium | Bind capture and relaunch to fresh STATUS slots, not host hooks |
| Foundation interfaces slip or change | Medium | W1/W2 proceed against fakes; only W3 waits on the harness and release |
| Qualifying evidence absent at verification | High | Verification **blocks**. It must not pass and must not self-skip |
| Scope creep back toward Tracks 3–7 | Medium | Superseded tracks are recorded in `exploration.md` with owners |

## Rollback Plan

Revert the Wave 1 chain in reverse order (W3 → W2 → W1). Each unit is independently revertible. Provider authority, the version pin, and the release foundation are untouched by any revert.

## Dependencies

- **Blocking:** `consume-gentle-ai-release-artifacts` (`/home/gentleman/work/gentle-pi-worktrees/release-parity`) for the generic immutable-evidence harness and pinned provider — required by W3 only.
- Cross-plan consistency gate passes before any apply.
- RDD remains globally and effectively disabled.

## Success Criteria

- [ ] #2028 capture, admission, bounded recovery, and cleanup are exact-bound, one-shot, privacy-safe, and contract-tested.
- [ ] #1819/#1915 pass through immutable-release evidence with zero local topology or authority reconstruction.
- [ ] Absent qualifying evidence blocks verification instead of passing or self-skipping.
- [ ] #2074/#910 remain explicit no-action with no false fixture or coverage claim.
- [ ] `pnpm test` passes; delivery evidence reports `disabled/unmanaged`.
- [ ] No cross-repository child PR exists; no Wave 1 unit claims PR #262 or #263.
