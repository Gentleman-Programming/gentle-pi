# Proposal: Organic RDD Parity

## Intent

Pi drives `gentle-ai` without a TTY, so gentle-ai's organic RDD behaviors never reach the user: the review kill switch is invisible, consent is never asked, risk tiers get re-derived Pi-side instead of reflected, and `delivery: disabled/unmanaged` plus empty-candidate hints render as failures. The archived `archive/work-routing-wip` branch also holds ~956 lines of unrelated, never-released work. Close both gaps: recover the unrelated work, then reach behavioral parity behind the existing capability gate.

## Scope

### In Scope

- **Track A (recovery)**: isolated commit restoring only non-work-routing hunks from `archive/work-routing-wip` (`extensions/gentle-ai.ts`, `tests/package-manifest.test.ts`, `README.md`, `.github/workflows/publish.yml`, `skills/`). Zero work-routing content.
- **Track B (parity)**, additive and capability-gated:
  1. kill switch — `review mode status` consulted before review flows; never re-enabled unbidden;
  2. native consent UI — Pi asks the two-option question itself via `ctx.ui.confirm`; accept persists, decline is per work unit, `risk_evidence` is the Why; permanent disable stays a deliberate command;
  3. proportional tiers reflected verbatim from the start result, never re-derived Pi-side;
  4. `delivery: disabled/unmanaged` rendered as choice-not-failure, exit-0 preserved;
  5. empty-candidate `hint` surfaced.
- Types/capability keys (`mode`, `riskEvidence`, `hint`, `delivery`) added as new `NativeCliCapability` columns, `false`/absent on every shipped row.
- Dev-binary journey tests via `NativeReviewCliV214`'s `executable` override, in a non-gating target.

### Out of Scope

- Triple pin bump (`lib/gentle-ai-binary.ts`, `scripts/gentle-ai-installer.mjs`, `scripts/verify-package-files.mjs`) — deferred to PI-2 after the gentle-ai release.
- Truing any capability row to `true`; `NATIVE_CLI_CONTRACTS` gains no new version row here.
- `contracts/review-integration/v1/**` byte changes.
- Backlog closure for the archived WIP.

## Capabilities

### New Capabilities

- `organic-review-parity`: kill-switch consultation, native consent semantics, `risk_evidence` presentation, empty-candidate hint, and the capability-gating contract for all four.

### Modified Capabilities

- `review-routing`: tier comes from the native start result instead of Pi-side derivation; `delivery: disabled/unmanaged` is a successful non-delivery outcome, not a failure.

Track A introduces no spec-level change (behavior-preserving recovery).

## Approach

Exploration recommendation, accepted: two-track sequencing. Track A lands first as its own reviewable slice on a clean base. Track B then adds parity as pure additive code, dark until a future pin bump flips the capability row. Dev-binary validation is confined to tests so `verify-package-files.mjs` keeps failing closed honestly.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/native-review-cli.ts` | Modified | New capability keys; `mode`/`risk_evidence`/`hint`/`delivery` types |
| `extensions/gentle-ai.ts` | Modified | Kill-switch command, consent prompt, delivery/hint rendering; Track A recovery |
| `tests/native-review-parity-runtime.test.ts` | Modified | Dev-binary journey coverage (non-gating) |
| `tests/package-manifest.test.ts`, `README.md`, `.github/workflows/publish.yml`, `skills/` | Modified | Track A recovery only |
| `lib/gentle-ai-binary.ts`, `scripts/*.mjs`, `contracts/**` | Unchanged | Explicitly frozen until PI-2 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Work-routing hunks leak into Track A | Med | Re-run `git diff main archive/work-routing-wip -- <path>` per file at apply; grep recovery commit for work-routing symbols |
| Provisional version leaks into shipped pins | Med | Dev binary injected only via constructor `executable` override in tests; pin files listed as unchanged in success criteria |
| New parity tests silently skip in CI pre-pin | High | Dev-binary tests run in a separate non-gating target; gating suite asserts capability keys are `false`/absent |
| Recon line numbers drifted (~20 lines in `verify-package-files.mjs`) | Med | Treat recon anchors as approximate; locate by symbol, not line |
| Two slices exceed 400-line review budget | Med | Track A and Track B ship as chained PRs |

## Rollback Plan

Track A: revert the single recovery commit — `archive/work-routing-wip` remains the permanent source of truth, so recovery is re-runnable at any time. Track B: revert the additive commits; since no shipped capability row is `true` and no pin moved, reverting restores exactly the pre-change runtime behavior with no persisted state to unwind.

## Dependencies

- A gentle-ai release exposing `mode`, `risk_evidence`, `hint`, `delivery` — required only for PI-2, not for this change.

## Success Criteria

- [ ] `pnpm test` passes.
- [ ] `GENTLE_AI_VERSION`, `INSTALLER_VERSION`, `RELEASE_BASE_URL`, the sha256 asset table, and `contracts/review-integration/v1/**` are byte-identical to `main`.
- [ ] `NATIVE_CLI_CONTRACTS` gains no new version key; every shipped row has `mode`/`riskEvidence`/`hint`/`delivery` `false` or absent.
- [ ] Tests prove: review flows consult `review mode status` first; no path enables review without an explicit command; consent asks two options with `risk_evidence` as the Why; accept persists, decline is scoped to the work unit; tier is rendered verbatim from the start result; `delivery: disabled/unmanaged` yields exit 0 and non-failure text; empty-candidate `hint` is surfaced.
- [ ] Track A diff against `archive/work-routing-wip` for recovered paths is empty and contains no work-routing symbols.
- [ ] Dev-binary journey tests live in a non-gating target and skip cleanly when the binary is absent.
