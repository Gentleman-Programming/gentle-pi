## Exploration: organic-rdd-parity

Discard the never-released work-routing WIP and reach behavioral parity with gentle-ai's organic RDD, capability-gated on the pinned version.

### Current State

**Archive confirmed on disk.** `archive/work-routing-wip` exists as a real local branch; `main` is clean at its own ref. `contracts/` on main contains only `contracts/review-integration/v1/**` — no `contracts/work-routing/` — consistent with the WIP being fully archived out.

**Triple version pin confirmed exactly** (one line-number correction vs. prior recon):

- `lib/gentle-ai-binary.ts:8` — `GENTLE_AI_VERSION = "2.1.11"`
- `scripts/gentle-ai-installer.mjs:22,26` — `RELEASE_BASE_URL`/`INSTALLER_VERSION = "2.1.11"` + per-platform sha256 asset table (41-46)
- `scripts/verify-package-files.mjs:154-159` (not 174-177 as reconned) — cross-checks both pin strings match AND that `contracts/review-integration/v1` bytes are byte-identical to the gentle-ai v2.1.11 contract.

**Capability-gating mechanism** (the exact extension point this change must use): `lib/native-review-cli.ts:353-362` defines `NATIVE_CLI_CONTRACTS`, a frozen semver → boolean-capability-record map. `NativeReviewCliV214.verifyVersion()` execs `gentle-ai version`, looks up the contract row, and throws `VERSION_INCOMPATIBLE` if any requested capability is `false`/absent. New parity keys (kill-switch `mode`, `risk_evidence`, `hint`, `delivery`) slot in as new boolean columns on a new version row.

**Native consent UI primitive already exists**: `ctx.ui.confirm(title, body): Promise<boolean>`, used 4× in `extensions/gentle-ai.ts` (guarded-command confirm at line 727, others at 1992/2542/3991), gated on `ctx.hasUI` and failing closed when no UI is attached.

**Test seam for local-binary journeys**: `tests/native-review-parity-runtime.test.ts` resolves the real binary via `resolveGentleAiBinary`, wraps `node:test` in a skip-if-unavailable guard, builds a fake `ExtensionAPI`, calls `createGentleAiExtension`, and drives the registered `gentle_review` tool directly. `NativeReviewCliV214`'s constructor already accepts an `executable` override — the clean injection point to point a new journey test at the local dev binary (`dev-organic-d6c73ff4`).

**No partial implementation exists** for any of the five target behaviors (kill switch, consent semantics, evidence-driven tiers, disabled/unmanaged delivery, recovery hint) — confirmed via grep of `native-review-cli.ts`; this is purely additive surface.

### Affected Areas

- `lib/native-review-cli.ts` — new capability-table row, interface/type extensions for mode/risk_evidence/hint/delivery
- `lib/gentle-ai-binary.ts`, `scripts/gentle-ai-installer.mjs`, `scripts/verify-package-files.mjs` — triple pin bump, must move together (fails closed by design)
- `extensions/gentle-ai.ts` — kill-switch command near `gentle:status`/`gentle:doctor` (5697-5843), consent via `ctx.ui.confirm`, delivery/hint rendering in the review-lifecycle/gate flow
- `contracts/review-integration/v1/**` — canonical contract copy, byte-identity enforced by CI
- `tests/native-review-parity-runtime.test.ts`, `tests/native-review-integration-v1.test.ts` — new/extended journey tests
- `tests/package-manifest.test.ts`, `README.md`, `.github/workflows/publish.yml`, `skills/` — unrelated-hunk recovery targets (exact diffs re-verified at apply time via `git diff main archive/work-routing-wip`)

### Approaches

1. **Two-track sequencing** — recover unrelated hunks as an isolated commit first, then build parity behind the capability gate on a clean base.
   - Pros: reviewable, low-risk recovery separate from new-feature scope; matches the 400-line budget guard naturally
   - Cons: needs careful manual hunk separation
   - Effort: Medium

2. **Single combined change, skip recovery** — treat "discard WIP" as done and scope recovery out entirely.
   - Pros: simplest scope
   - Cons: risks silently losing ~956 unrelated lines; contradicts the stated goal unless re-confirmed with the user
   - Effort: Low (but defers real cost)

3. **Speculative capability-table row validated against the local dev binary** — build/test against the dev binary before the real release ships.
   - Pros: unblocks full TDD immediately
   - Cons: must never leak the provisional version into shipped `NATIVE_CLI_CONTRACTS` or the pin files, since `verify-package-files.mjs` is designed to fail closed on exactly that drift
   - Effort: Medium

### Recommendation

Approach 1 + Approach 3's dev-binary technique: recover unrelated hunks as an isolated commit first, then build the five parity behaviors as pure additive capability-gated code on a clean base, using the dev binary via `NativeReviewCliV214`'s `executable` override seam purely for RED/GREEN test-writing — never touching the shipped pin files or `NATIVE_CLI_CONTRACTS` until the real gentle-ai release ships.

### Risks

- The claimed ~956/391 line split in `extensions/gentle-ai.ts`'s archived diff was not independently re-verified this phase — run `git diff main archive/work-routing-wip -- extensions/gentle-ai.ts` before apply.
- `verify-package-files.mjs` pin-check line numbers drifted ~20 lines from prior recon — treat recon line numbers as approximate pointers, not exact anchors.
- No gentle-ai release with the new capabilities has shipped; the real pin bump cannot happen until it does — dev-binary validation must stay isolated from shipped contract/pin files.
- The existing skip-if-binary-unavailable test pattern means a naive new parity test will silently skip in CI pre-pin — needs an explicit decision on whether pre-pin dev-binary tests run in a separate, non-gating target.

### Ready for Proposal

Yes.
