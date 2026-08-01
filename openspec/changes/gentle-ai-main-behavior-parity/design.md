# Design: Gentle AI Main Behavior Parity — Wave 1 (#2028 Pi-Host Behavior)

> **Size note.** The phase default is an 800-word design. This document is longer because the task
> requires eight resolved decisions plus a threat matrix plus W1/W2/W3 slicing boundaries, and
> because the sibling `consume-gentle-ai-release-artifacts/design.md` establishes the
> dense-table convention this repository actually uses. Content is tabular, not prose-padded.

## Technical Approach

Pi already validates every capture-slot binding field — `extensions/gentle-ai.ts:4895`
(`providerReviewerProjection`) checks lineage, authority revision, target, base/candidate tree,
changed-path manifest hash, lens, order, and subject hash against fresh STATUS collect inputs, then
throws `manifest-input-divergence`. It just throws that work away: `finalize()`
(`lib/native-review-cli.ts:2149-2195`) stages `lensResults` into `resultFiles` and never passes
them to argv, and `captureResult()` (`:2287`) has no production caller.

Wave 1 therefore adds **no new authority** — it extracts the existing validator into one reusable
slot derivation, inserts a **status-mediated capture phase at the front of the FINALIZE controller
operation**, and routes capture failures through fresh STATUS. Everything provider-owned stays
opaque: argument tokens are forwarded verbatim, manifests are forwarded losslessly, and the
diagnostic channel is an allowlist that returns `undefined` for anything it does not fully prove.

## Architecture Decisions

### Decision 1 — Capture is FINALIZE-time and status-mediated, not host-hook-time

| Option | Tradeoff | Decision |
|---|---|---|
| Bind capture to a Pi post-tool hook (OpenCode's `tool.execute.after` analogue) | Pi exposes `tool_call` (pre-dispatch, `extensions/gentle-ai.ts:6272`) and `session_shutdown` only. No result-observing sibling exists; adding one is host work outside Wave 1 — and it would still need the STATUS proof. | **Rejected** |
| Recompose `review capture-result` argv from decoded fields | Creates a second argv authority that drifts from the provider contract. | **Rejected** |
| Capture at FINALIZE entry, bound to a fresh `targetStatus` slot, forwarding provider tokens verbatim | Same exact-slot/one-capture semantics as the OpenCode plugin without a host hook; the controller already holds `lens_results[]` there (`:5544`). | **Chosen** |

New pure module `lib/review-result-capture.ts` owns `deriveCaptureSlots(status)`;
`providerReviewerProjection` is refactored to call it so **exactly one** validator exists.

```typescript
const CAPTURE_SLOT_ARGUMENT = {
  LINEAGE: "lineage", EXPECTED_REVISION: "expected-revision", TARGET: "target",
  LENS: "lens", ORDER: "order", SUBJECT_HASH: "subject-hash",
} as const;

interface CaptureSlot {
  readonly slotKey: string;            // canonical join of the six fields below
  readonly lineageId: string;
  readonly authorityRevision: string;
  readonly targetIdentity: string;
  readonly lens: ReviewLens;
  readonly selectedOrder: number;
  readonly subjectHash: string;
  readonly argumentTokens: readonly string[];  // provider-issued, forwarded byte-identical
}
```

Post-capture, the admitted manifest must re-match `subjectHash`, and `lens` when present. `schema`
and `admissionDecision` are already forced by `decodeNativeAdmittedResultManifest`.

**Lens ↔ slot bijection.** Each `lens_results[]` entry maps to exactly one slot in
`outstanding slots ∪ recorded admitted/committed slots for this lineage`. A missing lens, an extra
lens, or a duplicate is fail-closed **before** any capture runs. Capture executes in ascending
`selectedOrder`.

### Decision 2 — Diagnostics are an allowlist whose default is opaque

`decodeSafeAdmissionDiagnostic(value: unknown): SafeAdmissionDiagnostic | undefined` returns
`undefined` for anything it cannot fully prove. Nothing partial, sanitized, or coerced ever escapes.

```typescript
const ADMISSION_DIAGNOSTIC_CODE = {
  INVALID_FINDING_LOCATION: "invalid_finding_location",
  CANDIDATE_CAUSALITY_UNPROVEN: "candidate_causality_unproven",
} as const;
type AdmissionDiagnosticCode = (typeof ADMISSION_DIAGNOSTIC_CODE)[keyof typeof ADMISSION_DIAGNOSTIC_CODE];

interface SafeAdmissionDiagnostic {
  readonly code: AdmissionDiagnosticCode;
  readonly findingId: string;
  readonly reason: string;
  readonly location?: string;
}
```

| Field | Bound | Rejected |
|---|---|---|
| record shape | exact-record (the `exactRecord` discipline of `lib/review-integration-v2.ts:781`) | any unknown key |
| `code` | exactly one of the two allowlisted values | unknown/absent code |
| `findingId` | `/^[A-Za-z0-9._-]{1,64}$/` | anything else |
| `location` | repository-relative, ≤256 chars, printable ASCII | leading `/`, `~`, `..`, `\`, NUL/control chars, absolute or home path |
| `reason` | trimmed printable ASCII, ≤120 chars | prose containing newlines, control chars, or over-length text |

Alternative rejected: **denylist / sanitize-then-forward.** A wrong default there leaks user data
into an issue report — the stated risk. Allowlist + exact-record + `undefined`-on-anything-else is
the only fail-closed default. The raw provider failure envelope keeps flowing through the existing
opaque `nativeOperationFailure` path (`:4687`), unchanged, and never through the diagnostic field.
A rejected diagnostic is terminal `unavailable`; it is never a retry instruction.

### Decision 3 — One relaunch, granted by slot key, unreplayable by digest

State is a `Map<string, CaptureSlotRecord>` created beside `correctionEvidenceByLineage`
(`:6113`) and threaded into `executeReviewControllerOperation` as a parameter — the same
injection pattern the existing fake-adapter tests already use.

```typescript
const CAPTURE_SLOT_STATE = {
  ADMITTED: "admitted", COMMITTED: "committed", RELAUNCH_GRANTED: "relaunch-granted",
} as const;

interface CaptureSlotRecord {
  readonly slotKey: string;
  readonly lineageId: string;
  readonly state: (typeof CAPTURE_SLOT_STATE)[keyof typeof CAPTURE_SLOT_STATE];
  readonly rejectedDocumentHashes: ReadonlySet<string>;   // sha256 of every rejected submission
  readonly manifest?: NativeReviewAdmittedResultManifest;
}
```

Failure sequence, in order, each step terminal on failure:

1. Decode the diagnostic. `undefined` → terminal `unavailable`.
2. Re-query target-scoped fresh STATUS; re-derive slots.
3. Require the **identical `slotKey`** (all six fields) to be reoffered. Mismatch → terminal `unavailable`.
4. A record already in `RELAUNCH_GRANTED` → terminal `exhausted`.
5. Otherwise record `sha256(rejectedDocument)`, set `RELAUNCH_GRANTED`, and return
   `{ status: "blocked", outcome: "capture-relaunch-required", lens, admission_diagnostic, relaunch_slot }`.

The controller **does not** launch the reviewer. The parent orchestrator authors the corrected
session and re-enters FINALIZE — that is what "parent-driven" means on this host.

**Unreplayability**: on re-entry, `sha256(document)` is recomputed and any hash present in
`rejectedDocumentHashes` is refused as terminal `exhausted`. Alternative rejected: retain the
rejected bytes for comparison — that widens the privacy surface across turns for no gain; a
non-reversible digest is sufficient.

**Bounding**: `state` is a closed union, the grant is one-shot per slot key, and exhaustion is
terminal. There is no loop and no counter to reset.

### Decision 4 — Committed-capture proof is slot consumption under unchanged authority

The lost-output class is exactly `nativeMutationRequiresStatus(error) === true` (`:4753`): unknown
mutation outcome, `next_action: review.status`, or `replayability: status_required`.

Recovery queries target-scoped fresh STATUS once. **Proof of commitment**: the slot is no longer
offered as a `review.capture-result` collect input for that lens/order *while* `authority.lineageId`
and `authority.revision` are unchanged — the provider consumed it. This is the only Pi-observable
proof that requires zero provider-topology reconstruction.

| Outcome | Action |
|---|---|
| Proof present | mark `COMMITTED`; **no** recapture, **no** lens rerun |
| Proof absent | follow only the provider-declared action via the existing `reconcileNativeMutationFailure` (`:4766`); no generic replay, no second capture |

Ambiguous STATUS is treated as *not proven* — fails closed.

**Transport consequence.** A `COMMITTED` slot yields no manifest, so FINALIZE transport is selected
per run: **every** slot returned a manifest carrying `path` → `resultArtifactFiles` in ascending
`selectedOrder`; otherwise (any `COMMITTED` slot, or any manifest carrying `reference`) →
`capturedResults: true`, letting the provider discover its own admitted manifests. Never both.
Retired `--result` is never emitted.

### Decision 5 — Cleanup, and why stale authority is structurally impossible

| Trigger | Cleared |
|---|---|
| all slots for a lineage admitted/committed | that lineage's records |
| FINALIZE terminal (beside existing `cleanupTerminal`, `:5566`) | all records for the lineage |
| `session_shutdown` (beside `cleanupAllPendingReviewConsents`, `:6116`) | the whole map |

A stale grant cannot be reused because `slotKey` embeds `authorityRevision` **and** `subjectHash`: a
new authority revision or a new candidate produces a different key. Grants are never consulted
without a fresh STATUS reoffer of the identical key **within the same call**.

### Decision 6 — Evidence is consumed, never reconstructed

Wave 1 defines no pin, mirror, lock, archive format, or acquisition path. It consumes the
foundation's `tests/evidence/**` harness (P3; plan §12 ledger shape, S vs R classes) through a thin
assertion layer in a new `tests/native-review-parity-issue-evidence.test.ts`.

```typescript
interface ProviderBehaviorAssertion {
  readonly issue: "1819" | "1915";
  readonly evidenceClass: "development/bootstrap" | "live/signed-release";
  readonly expectedOutcome: "allow" | "deny" | "approved" | "escalated";
}

type AssertionResult =
  | { readonly status: "pass" }
  | { readonly status: "blocked"; readonly missingDependency: string }
  | { readonly status: "unsupported"; readonly capability: string };
```

**Absence blocks, and that is asserted.** No `test.skip`, no `t.skip()`, no conditional early
return. When evidence is absent the test asserts `status === "blocked"` **and** fails the
requirement check naming `consume-gentle-ai-release-artifacts`. `development/bootstrap` results are
asserted to be non-accepting.

**Zero-reconstruction guard**: a static assertion over `lib/` and `extensions/` proves Wave 1
introduced no delivery-topology or authority-graph symbols (squash/path-drift/receipt-discovery/
evidence-digest-evolution identifiers). "No local reconstruction" becomes a test, not a claim.

### Decision 7 — #2074 / #910 no-action is asserted as absence

| Option | Tradeoff | Decision |
|---|---|---|
| Document the disposition in prose only | The stated risk is a *false coverage claim*; prose cannot fail. | **Rejected** |
| Add a fixture proving nothing happens | Manufactures the exact false coverage the spec forbids. | **Rejected** |
| Assert the surface does not exist | Fails loudly the moment someone adds a Claude/PowerShell surface or a fake fixture. | **Chosen** |

- **#2074**: assert `lib/`, `extensions/`, `scripts/`, and the packaged file manifest contain no
  `~/.claude.json`, `.claude/mcp/`, or Claude user-registry write path.
- **#910**: assert no `pwsh` → `powershell.exe` → `powershell` fallback ladder exists; Windows
  resolution stays the single existing Node path.
- **Both**: assert the Wave 1 coverage enumeration lists them with disposition `no-action` and that
  the fixture/journey set contains **no** entry for either issue.

### Decision 8 — Every seam is a pure function plus an injected adapter

W1/W2 depend on nothing the foundation owns. Slot derivation and diagnostic decoding are pure
functions over `ReviewStatusV3`; the capture phase runs against a fake `NativeReviewCli` already
injected by `tests/review-controller-native-*.test.ts`; the record map is a parameter-injected
`Map`, disposable per test. Only W3's `live/signed-release` lane waits on P3 and release R; its
`development/bootstrap` lane runs immediately against fakes and is asserted non-accepting.

## Data Flow

```text
FINALIZE(review_result.lens_results[])
   │
   ├─1 targetStatus(cwd = candidate root, lineage)        ← fresh STATUS
   │      └─ deriveCaptureSlots(status)                   ← the single six-field validator
   ├─2 bijection: lens_results ↔ (outstanding ∪ recorded) slots, exactly once each
   ├─3 per slot, ascending selectedOrder:
   │      captureResult(argumentTokens verbatim, document)
   │        ├─ admitted → manifest (subjectHash / lens re-checked) → ADMITTED
   │        ├─ rejected → decodeSafeAdmissionDiagnostic
   │        │               └─ fresh STATUS → same slotKey?
   │        │                    ├─ yes & grant unused → blocked: capture-relaunch-required
   │        │                    └─ no | unsafe | used → unavailable | exhausted (terminal)
   │        └─ lost     → fresh STATUS → slot consumed under same authority?
   │                        ├─ yes → COMMITTED (no recapture, no lens rerun)
   │                        └─ no  → provider-declared action only
   ├─4 transport: all manifests carry path ? resultArtifactFiles[] : capturedResults: true
   └─5 finalize(...) → cleanupTerminal + clear records
```

## File Changes

| File | Action | Description |
|---|---|---|
| `lib/review-result-capture.ts` | Create | `CaptureSlot`, `deriveCaptureSlots`, slot-key derivation, `decodeSafeAdmissionDiagnostic`, `CaptureSlotRecord` bookkeeping. Pure, no I/O. |
| `runtime/review-result-capture.mjs` | Create | Generated runtime mirror (repo convention: every review `lib/*.ts` has a `runtime/*.mjs`). |
| `extensions/gentle-ai.ts` | Modify | FINALIZE capture phase, relaunch/lost-output routing, record-map wiring, `session_shutdown` clear; `providerReviewerProjection` refactored onto `deriveCaptureSlots`. |
| `lib/native-review-cli.ts`, `runtime/native-review-cli.mjs` | Modify | Delete the dead `lensResults` → `resultFiles` staging: it writes reviewer documents to a tmp file no argv consumes. Keep `capturedResults` / `resultArtifactFiles` only. |
| `tests/review-result-capture.test.ts` | Create | Slot derivation and diagnostic-allowlist units. |
| `tests/review-controller-native-recovery.test.ts` | Modify | Lost output, one relaunch, exhaustion, cleanup, shutdown. |
| `tests/review-controller-native-routing.test.ts` | Modify | Transport selection and terminal routing. |
| `tests/native-review-cli.test.ts` | Modify | Exact argv and manifest contract. |
| `tests/native-review-parity-issue-evidence.test.ts` | Create | #1819/#1915 evidence assertions, #2074/#910 absence assertions, RDD `disabled/unmanaged`. |

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit | Slot derivation (each of the six fields mismatching independently), duplicate lens/order/subject, diagnostic allowlist bounds, digest unreplayability | `node:test` over pure functions with frozen STATUS fixtures |
| Controller | Capture-once, bijection failures, relaunch grant, second-failure exhaustion, lost-output commit proof, transport selection, cleanup, shutdown | fake `NativeReviewCli` injected into `executeReviewControllerOperation` |
| Contract | Exact `review capture-result` argv, manifest re-binding, no `--result` ever emitted | `tests/native-review-cli.test.ts` with a fake exec adapter |
| Evidence (W3) | #1819/#1915 transport + outcome, absent-evidence `blocked`, bootstrap non-acceptance, #2074/#910 absence, zero-reconstruction guard | foundation harness (`tests/evidence/**`); bootstrap lane now, live signed lane at R |

Strict TDD is active (`openspec/config.yaml: strict_tdd: true`). Every scenario ships RED first.
No test may invoke a mutable provider checkout or start RDD.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | **Applicable** — the admitted manifest carries a provider-owned `path` forwarded to FINALIZE as `--result-artifact-file` | The locator is opaque provider data returned to the same provider that issued it. Pi never opens, stats, classifies, or executes it. | A locator containing `..`, an absolute path, or an executable-looking name is forwarded byte-identical while Pi performs zero filesystem access; a manifest carrying both `path` and `reference` is refused |
| Git repository selection | **Applicable** — capture runs at the candidate root; `captureResult` refuses `--cwd` when tokens carry `--repository-context` (`lib/native-review-cli.ts:2291`) | Reuse the PR #258 candidate-root discipline. Never `git -C`, never ambient cwd. | Tokens carrying repository context plus an explicit cwd are rejected; capture cwd equals `candidateView.root` |
| Commit state | **N/A** — capture reads no index or worktree; the candidate is a frozen tree | — | — |
| Push state | **N/A** — Wave 1 performs no push or ref resolution | — | — |
| PR commands | **N/A** — Wave 1 adds no PR automation | — | — |
| Subprocess invocation *(added row)* | **Applicable** — `gentle-ai review capture-result` | Provider tokens forwarded verbatim as discrete argv elements; no shell; fixed executable via `verifiedExecutable`; existing bounded timeout/buffer in `invoke()`. Pi appends only `--input <tmpfile>`. | A token containing shell metacharacters stays one argv element and is never composed into a shell string; empty or non-string tokens are refused; the tmp file is mode `0600` and removed on both success and failure |
| Privacy egress *(added row)* | **Applicable** — admission-failure decoding is the leak surface | Allowlist decoder returning `undefined` outside its exact shape; the raw envelope keeps its existing opaque path | Unknown code, extra key, absolute path, `..`, `~`, control characters, over-length reason, and raw prose each yield `undefined` plus a terminal outcome, and the raw envelope never reaches the diagnostic field |

## Migration / Rollout

No migration, no feature flag, no data change. Chained delivery inside the Gentle Pi
repository-local tracker (`chain_strategy: feature-branch-chain`, `delivery_strategy: exception-ok`):

| Unit | Scope | Depends on | Rollback boundary |
|---|---|---|---|
| **W1** | `deriveCaptureSlots` + `providerReviewerProjection` refactor + FINALIZE capture phase + bijection + transport selection + dead-staging deletion + their tests | none (fakes only) | Delete the capture phase and restore the prior FINALIZE argument mapping; the provider is untouched |
| **W2** | `decodeSafeAdmissionDiagnostic` + record map + one-relaunch grant + digest unreplayability + lost-output reconciliation + cleanup/shutdown wiring + terminal outcomes + their tests | W1's `CaptureSlot` type only | Delete diagnostics and record state; W1 capture remains valid standalone |
| **W3** | Issue-evidence assertion layer, #1819/#1915 transport assertions, #2074/#910 absence assertions, RDD `disabled/unmanaged`, zero-reconstruction guard | foundation P3 harness (live lane also needs R) | Delete the Wave evidence test file; the generic harness is untouched |

**RDD standing constraint.** No unit may start, recover, retry, reset, reclaim, or manufacture
receipt-driven review authority. Delivery evidence stays `disabled/unmanaged`. The three current
failures in `tests/native-review-parity-runtime.test.ts` are expected RDD-off environment state:
Wave 1 must neither "fix" nor mask them, and must not treat them as a regression signal.

## Open Questions

- [ ] Does frozen-main STATUS expose an explicit admitted-result record, or is slot consumption
      under unchanged authority the only commit proof? v2.2.3 has no such field. The design fails
      closed (ambiguous STATUS ⇒ not proven); confirm at the foundation's pin gate.
- [ ] The exact envelope key carrying `admission_diagnostic` is not present in pinned v2.2.3
      (#2028 landed after). W2 decodes defensively against the frozen-main shape; the pin gate must
      confirm the key before W3 live acceptance.
