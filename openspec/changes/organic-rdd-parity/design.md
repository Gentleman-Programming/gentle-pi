# Design: Organic RDD Parity

## Technical Approach

Two chained slices. **Track A** restores non-work-routing hunks from `archive/work-routing-wip` as one behavior-preserving commit. **Track B** adds five parity behaviors as additive, capability-gated code: new boolean columns on `NATIVE_CLI_CONTRACTS`, new optional decoder keys, one kill-switch consultation, one Pi-owned consent latch, and passthrough rendering. Every shipped row stays `false`, so runtime behavior against pinned v2.1.11 is byte-identical until PI-2.

Parity source of truth (read this phase): `gentle-ai/internal/cli/review_mode.go`, `internal/reviewtransaction/rdd_mode.go`, `internal/cli/review_facade.go:30-58, 955-1058, 2681-2703`.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| 1 | Capability shape | 4 new boolean columns `mode`, `riskEvidence`, `hint`, `delivery` on every existing row of `NATIVE_CLI_CONTRACTS` (`lib/native-review-cli.ts:353-362`), all `false` incl. `"2.1.11"`. No new version key. | New version row; separate table | `NativeCliCapability` is `keyof` the row, so columns extend the type automatically; `verifyVersion` already throws `VERSION_INCOMPATIBLE` on a `false` column. Future row policy: PI-2 adds one new semver key with the four columns `true` **and** bumps the triple pin in the same commit — never one without the other. |
| 2 | Consent latch owner | Pi-owned clone-local latch, new `lib/review-consent-latch.ts`, at `<git-common-dir>/gentle-pi/review-consent/asked.json`, exact bytes `{"schema":"gentle-pi.review-consent-asked/v1"}\n`, mode 0600, one-way, set only on accept. Common dir via `resolveRepositoryAuthorityV1` + `assertManagedStorePathV1` (`lib/review-repository.ts`). | Writing gentle-ai's private `rdd-mode/asked.json`; session-only memory | gentle-ai exposes no CLI to set its latch and its own latch stays unset headless by design. Writing another product's private authority store is a boundary violation. Scope, direction and asymmetry match `RDDConsentAsked`/`RecordRDDConsentAsked` exactly (per clone, accept-only, never committed, never inherited). |
| 3 | Consent question timing | Ask **after** native START returns, **before** `actor_binding` is emitted; only when `lenses_required === true` (tier ≥ 1). | Ask before START | `risk_evidence` is computed by START and exists nowhere else (no read-only risk command). Tier 0 must stay silent — parity with `authorizeReviewStart`'s `RiskLow` early return. Cost: a declined lineage stays resumable for the *same* candidate bytes; a changed candidate reports `unrelated` and starts fresh, so decline stays scoped to the work unit. |
| 4 | Consent UI | `ctx.ui.confirm(title, body)`: boolean maps 1:1 onto exactly two options. Title `Run the review now?`. Body: headline, `Why: <risk_evidence verbatim>`, value line, explicit `Yes = run the review now / No = not now, just this once`, then the permanent-disable line `To turn reviews off for good, run /gentle:review-mode disable`. | Free-text prompt; 3-option menu | The envelope is genuinely two-option, so `confirm` is faithful. The disable path stays a trailing sentence, never a third answer — parity with `reviewConsentOffPath`. `true` → latch + proceed; `false` → declined envelope, nothing persisted; **throws** → review runs, latch untouched, unreadable-answer notice surfaced. |
| 5 | Headless | No UI → review runs, latch NOT consumed, `consent_notice` always in the START envelope plus `context?.ui.notify(..., "info")`. Never blocks. | Fail closed like RESET/REPAIR | Mirrors `reviewConsentSkippedNotice`: an unanswerable question is never a silent yes and never a stop. |
| 6 | Native stderr notice | `execute()` gains an operation-scoped tolerated-stderr allowlist; START passes the frozen `REVIEW_CONSENT_NOTICES` set only when the version row has `mode: true` (version already returned by `verifyVersion`). Exact string match, no prefix/regex. | Broad stderr tolerance | Headless gentle-ai writes the skipped notice to stderr; today's `execute` rejects any stderr as `UNEXPECTED_STDERR`, which would break START at PI-2. Gating on `mode` keeps 2.1.11 byte-identical; unknown text still fails closed. |
| 7 | Kill switch | New optional `NativeReviewCli.reviewMode?()` → `["review","mode","status","--cwd",cwd,"--json"]`, `verifyVersion(["mode"])`, decodes `gentle-ai.review-mode/v1`. Consulted once at the top of the ORDINARY START branch, before `targetStatus`. `effective === "off"` → non-failure `status: "skipped"` envelope; Pi never enables. | Consulting on every operation; caching | Native already rejects start/mutate while off (`AuthorizeRDDOperation`); Pi duplicating it elsewhere would re-derive policy. Capability absent → helper returns `undefined` → today's path unchanged. Any other error → existing `nativeOperationFailure`. |
| 8 | Tier & evidence | `mapNativeStartResult` passes `risk_tier`, `risk_evidence`, `hint` straight through; zero Pi-side derivation. | Re-deriving phrasing Pi-side | Proposal constraint; the phrases are gentle-ai's single phrasing source (`reviewConsentEvidencePhrases`). |
| 9 | Delivery | `delivery` optional on the validate decoder; when present it must equal `disabled/unmanaged`, and then the alternate discriminator applies: `result: invalidated`, `allowed: false`, `action: "repository-policy"`, **exit 0**. Gate branch returns early with `status: "skipped"`, `outcome: "review-disabled-unmanaged-delivery"`, before the maintainer-exception check. | Reusing the strict table | The strict table expects `explicit-maintainer-action` + exit 1 for `invalidated`, so the honest native emission would decode as a failure. No authorization is ever minted (allow-only path untouched). |

## Data Flow

    gentle_review START (ordinary)
      │ 1 reviewMode status ──off──▶ skipped envelope (no mutation, exit 0)
      │ 2 targetStatus (unchanged)
      │ 3 native start ──▶ risk_tier | risk_evidence | hint  (verbatim)
      │     stderr consent notice ──(mode:true)──▶ consent_notice
      │ 4 lenses_required?
      │     no ──▶ envelope (silent tier 0)
      │     yes ─▶ latch set? ──▶ envelope
      │             no UI  ──▶ review runs + notice, latch untouched
      │             confirm ──true──▶ record latch ──▶ envelope + actor_binding
      │                     └─false─▶ declined envelope (no actor_binding)
    GATE validate ──▶ delivery: disabled/unmanaged ──▶ skipped envelope, exit 0

## File Changes

| File | Action | Description |
|---|---|---|
| `lib/native-review-cli.ts` | Modify | 4 capability columns (all `false`); `NATIVE_REVIEW_OPERATION.MODE`; `NativeReviewModeRequest/Result/Status`; `reviewMode?()` on `NativeReviewCli` + `NativeReviewCliV214`; `NativeStartResult.riskEvidence/.hint` + optional decoder keys; `NativeValidateResult.delivery` + alternate discriminator; `REVIEW_CONSENT_NOTICES` + tolerated-stderr in `execute`/`start` |
| `runtime/native-review-cli.mjs` | Modify (generated) | Regenerate with `pnpm build:transaction-runner`; `check:transaction-runner` fails on drift |
| `lib/review-consent-latch.ts` | Create | Clone-local Pi consent latch (read/record, one-way, 0600) |
| `extensions/gentle-ai.ts` | Modify | `resolveReviewModeGate` (before `targetStatus`, ~4727); `requestReviewConsent` (after `start`, ~4773); `mapNativeStartResult` +evidence/hint; `mapNativeValidateResult` +delivery and gate early return (~5141); `pi.registerCommand("gentle:review-mode")` between `gentle:doctor` and `gentle:status` (~5842) with `status|disable|enable`, all user-initiated |
| `tests/native-review-capability-contract.test.ts` | Create | Gating: every shipped row has the 4 keys `false`/absent; no new version key |
| `tests/native-review-parity.test.ts` | Create | Gating: fake-`ExecFileAdapter` unit coverage of all decisions above |
| `tests/devbinary/native-review-parity.devtest.ts` | Create | Non-gating dev-binary capture journey |
| `package.json` | Modify | `"test:dev-binary": "node --experimental-strip-types --test tests/devbinary/*.devtest.ts"` |
| `extensions/gentle-ai.ts`, `tests/package-manifest.test.ts`, `README.md`, `.github/workflows/publish.yml`, `skills/**` | Modify | **Track A only** — recovery |
| `lib/gentle-ai-binary.ts`, `scripts/*.mjs`, `contracts/**` | Unchanged | Frozen until PI-2 |

## Track A Recovery Procedure

Per file, in order; never `git merge`/`cherry-pick` the archive branch.

| Path | Mode | Procedure | Proof |
|---|---|---|---|
| `README.md`, `.github/workflows/publish.yml`, `skills/**` | Wholesale | `git diff main archive/work-routing-wip -- <path>` → read; if no work-routing vocabulary, `git checkout archive/work-routing-wip -- <path>` | Post-checkout `git diff archive/work-routing-wip -- <path>` is empty |
| `extensions/gentle-ai.ts` | Hunk-level | `git diff main archive/work-routing-wip -- <path>` → `git checkout -p archive/work-routing-wip -- <path>`, accept only hunks with zero work-routing vocabulary | Residual `git diff archive/work-routing-wip -- <path>` contains **only** work-routing hunks |
| `tests/package-manifest.test.ts` | Hunk-level | Same as above (may carry `contracts/work-routing/**` manifest entries) | Same |

Zero-leak gate (blocking, whole recovery commit): `git show --unified=0 HEAD -- <recovered paths> \| rg -i 'work[-_ ]?rout\|work[-_]?(capabilit\|start\|route\|advance\|reconcile\|transition\|status)\|workRun\|connectorSessionRef'` returns no matches, plus `pnpm test` green and `git diff --stat main..HEAD` limited to the five paths.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Gating unit | Capability rows `false`; no new version key | `tests/native-review-capability-contract.test.ts` |
| Gating unit | Mode-off skip, mode-absent legacy path, consent accept/decline/headless/throw, latch asymmetry, tier+evidence verbatim, hint surfaced, delivery exit-0, stderr tolerance only under `mode: true` | `tests/native-review-parity.test.ts` with a fake `ExecFileAdapter` and a fake absolute `executable`; no binary needed |
| Non-gating journey | Real dev binary emits the exact strings Pi decodes | `tests/devbinary/*.devtest.ts` — outside the `tests/*.test.ts` glob, so `pnpm test` cannot pick it up. Skips unless `GENTLE_AI_DEV_BINARY` names an existing absolute path; injects it through `new NativeReviewCliV214(createNodeExecFileAdapter(), <path>)` and captures `review mode status`, `review start`, and a disabled gate, asserting the captured bytes against Pi's decoders and frozen notice constants. Shipped pins are never read or written. |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — no file classification changes; tiering stays native | — | — |
| Git repository selection | Applicable — the latch resolves a Git common dir | `resolveRepositoryAuthorityV1` + `assertManagedStorePathV1`; worktrees of one clone share one latch; unresolvable/shallow repo → no latch write, review proceeds | Latch path is the common dir for a linked worktree; unresolvable repo does not block START |
| Commit state | N/A — no index/worktree mutation | — | — |
| Push state | N/A — no ref resolution changes | — | — |
| PR commands | N/A — no PR automation | — | — |
| Subprocess argument composition | Applicable — new `review mode` invocation | Fixed argv array, `shell: false`, no interpolation beyond `cwd`; `enable`/`disable` reachable only from `/gentle:review-mode` | Argv assertion on the fake adapter; no automation path reaches `enable` |
| Process stderr trust | Applicable — new tolerated-stderr path | Exact-match frozen allowlist, START only, `mode: true` only | Near-miss/prefixed/extra-line stderr still raises `UNEXPECTED_STDERR` |

## Migration / Rollout

No data migration. Dark on arrival: with pinned 2.1.11 every new column is `false`, `reviewMode` throws `VERSION_INCOMPATIBLE`, the new decoder keys are absent, and stderr tolerance is disabled. PI-2 adds the new version row and the triple pin in one commit. Rollback: Track A → revert the single recovery commit (`archive/work-routing-wip` stays the permanent source, re-runnable); Track B → revert the additive commits; the only persisted artifact is the Pi latch file, which is inert once the code is gone.

## Open Questions

- [ ] None blocking. Watch item for PI-2: the tolerated-stderr allowlist and the `disabled/unmanaged` discriminator are frozen against the dev binary; if the shipped release changes either string, START fails closed (correct, but the pin-bump PR must re-capture both via `pnpm test:dev-binary`).
