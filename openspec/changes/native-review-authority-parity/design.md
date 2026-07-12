# Delegate the safe native review subset to gentle-ai 2.1.0

## Decision

Pi will use one injected `execFile` boundary for the gentle-ai 2.1.0 operations that have a safe native contract: ordinary `review start`, `review finalize`, `review validate`, `review bind-sdd`, and `sdd-status` for one exact bound OpenSpec change.

Pi will not simulate the native contracts that 2.1.0 does not provide. General ordinary native `STATUS`, public inspection that requires a complete native/Pi claimant inventory, and any routing decision that requires proving native-authority absence return the typed outcome `native-status-unsupported`. Those paths make no native process call, read no native file, and perform no fallback mutation.

Existing Pi compact-v2 and graph-v1 ordinary authority remains read-only, exportable, and gate-compatible where it is already supported. Explicit Judgment Day remains graph-v1. Native successful results are never mirrored into either Pi store.

Native ordinary `START` does not accept Pi's legacy `policyHash`. Its typed request has optional `policyPath`; omission delegates policy selection to the native bounded default. A custom policy is accepted only from the canonical repository-local policy directory `<repository-root>/.gentle-ai/policies/`, after pre-call containment, regular-file, and no-symlink validation. Native result/store state is the sole authority for the policy actually bound to the lineage. The compact-v2 route keeps its existing `policyHash` contract and storage semantics.

## Supported and unsupported capability boundary

| Capability | gentle-ai 2.1.0 route | Pi behavior |
| --- | --- | --- |
| New ordinary start | `gentle-ai review start` | Supported through the native client |
| Ordinary finalize | `gentle-ai review finalize` | Supported through the native client |
| Lifecycle gate | `gentle-ai review validate` | Supported; only an exact allow can authorize |
| OpenSpec binding | `gentle-ai review bind-sdd` | Supported after native approval |
| Exact bound change readiness | `gentle-ai sdd-status <change> --cwd <repo> --json --instructions` | Supported only as bound SDD readiness |
| General ordinary status | None | `native-status-unsupported` |
| Complete native/compact-v2/graph-v1 inventory | None | `native-status-unsupported` |

`review finalize` is mutating and is never used as a status probe. `review validate` is gate evidence, not general status. Bound `sdd-status` proves readiness only for its selected OpenSpec change; it is not claimant discovery.

Commit-pinned evidence: installed gentle-ai 2.1.0 reports VCS revision `d7a29b88b3cf1b4a76fe42a02f918bfa21578cc7`. At that exact commit, `internal/cli/sdd_status.go` defines `RunSDDStatus`, calls `sddstatus.ParseCommandArgs` and `sddstatus.Resolve`, and emits JSON when `parsed.JSON` is true. `internal/cli/review_facade.go` defines `RunReviewBindSDD`; its tests accept `--expected-binding-revision=` for the first bind and verify the resulting binding feeds selected SDD status. This evidence supports only exact bound-change readiness, not general review inventory.

The required upstream follow-up is a versioned, non-mutating JSON command that distinguishes no claimant, one validated claimant, malformed authority, and mixed authority while returning lineage, state, authority revision, and receipt identity. Pi must not replace `native-status-unsupported` until that command and a version-specific decoder exist.

## Architecture and data flow

```text
Pi gentle_review / gentle:sdd-status / lifecycle bash gate
                         |
                         v
extensions/gentle-ai.ts: explicit route selection and public envelope mapping
       |                  |                         |
       |                  |                         +--> explicit Judgment Day -> graph-v1
       |                  +--> known Pi ordinary -> existing read/gate; mutation rejected
       |
       +--> supported new ordinary operation
                         |
                         v
lib/native-review-cli.ts: version capability + argv + strict decoder
                         |
                         v
Injected ExecFileAdapter(file, arguments, cwd, timeout, maxBuffer)
                         |
                         v
                 gentle-ai 2.1.0 authority
```

The native client owns no authority state. Native Go remains the only owner of ordinary canonicalization, target snapshots, risk, lenses, correction budget, causal classification, revisions, CAS, receipts, bindings, and gate revalidation.

### Route precedence

1. An explicit `judgment-day` mode uses the existing graph-v1 workflow. It never reaches the native ordinary client.
2. An explicitly identified Pi compact-v2 or graph-v1 lineage uses the existing compatible reader/export/gate. Ordinary `START`, `FINALIZE`, and `ADVANCE` return `legacy-read-only` without native or Pi mutation.
3. Ambiguous or malformed Pi claimants remain blocked. Pi may inspect its own stores, but it must not label that inventory complete across native authority.
4. A new ordinary `START` or `FINALIZE` with no selected Pi lineage invokes exactly one matching native method. A native failure never enters a legacy mutation branch.
5. `VALIDATE` derives the exact Pi lifecycle command target first, then calls native validation for the corresponding gate. Only an exit-zero, strictly decoded allow can register authorization.
6. General ordinary `STATUS` with no known Pi authority returns `native-status-unsupported` before process execution. `INSPECT` or any other request that asks for a complete mixed-authority answer returns the same outcome; it may include clearly labelled Pi-local diagnostics but cannot report `clean`, absence, or a winning authority.
7. Exact OpenSpec SDD readiness calls native `sdd-status` only when the caller supplies one selected change and the operation is explicitly the bound-change readiness path.

Native `start` is relied on for its own content-derived lineage/CAS behavior; Pi does not first probe native authority. Lost or ambiguous mutation output requires replay of the exact same operation or an explicit native recovery path. Pi never chooses another lineage because output was lost.

## Typed native process boundary

### Files and symbols

Create `lib/native-review-cli.ts` with these exported symbols:

- `NATIVE_REVIEW_OPERATION` and const-derived `NativeReviewOperation`;
- `NATIVE_REVIEW_ERROR_CODE` and const-derived `NativeReviewErrorCode`;
- `NATIVE_CLI_CONTRACTS`, an immutable version-to-capability table;
- flat `ExecFileRequest`, `ExecFileResult`, and `ExecFileAdapter` interfaces;
- `createNodeExecFileAdapter()` for production;
- flat request/result interfaces for start, finalize, validate, bind, and bound SDD status; `NativeStartRequest` is `{ cwd: string; lineageId?: string; policyPath?: string; focus?: string }` and contains no `policyHash`;
- `NativeReviewCliError`, carrying typed process phase, launch certainty, and mutation ambiguity;
- `NativeReviewCliV210`, the only 2.1.0 argv builder and response decoder;
- `createNativeReviewCli()` for production construction.

Use const objects before extracting string value types. Parse all external data from `unknown`; use no `any` and no inline nested interface shapes.

```ts
const NATIVE_REVIEW_OPERATION = {
  VERSION: "version",
  START: "review/start",
  FINALIZE: "review/finalize",
  VALIDATE: "review/validate",
  BIND_SDD: "review/bind-sdd",
  SDD_STATUS: "sdd-status",
} as const;

interface ExecFileRequest {
  file: string;
  arguments: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

type ExecFileAdapter = (request: ExecFileRequest) => Promise<ExecFileResult>;
```

The production adapter wraps `node:child_process.execFile` with `shell: false`, UTF-8, `windowsHide: true`, a default 30-second timeout, and a 1 MiB stdout/stderr ceiling. It receives an executable and argv separately and never builds a shell string. Spawn exceptions are normalized into `NativeReviewCliError`; callers never parse stderr text to authorize or choose a fallback.

### Version and capability detection

Capability detection is non-mutating and deterministic:

1. On the first supported native call in a client instance, execute `gentle-ai version` through the same adapter.
2. Normalize only the final line ending (`\r\n` to `\n`) and require exact stdout `gentle-ai 2.1.0\n`, exit zero, and whitespace-only stderr.
3. Resolve capabilities from `NATIVE_CLI_CONTRACTS["2.1.0"]`; do not infer support from help text, filesystem layout, error messages, or semver ranges.
4. The 2.1.0 entry enables `start`, `finalize`, `validate`, `bindSdd`, and bound `sddStatus`, while explicitly disabling general `status` and claimant `inventory`.
5. Cache only the immutable version/capability result for that client instance. This cache is dependency metadata, never authority evidence.
6. A missing, development, older, newer, suffixed, malformed, or stderr-producing version result is `version-incompatible` or the matching process error and authorizes nothing.

A future native release requires a new explicit capability-table entry and new decoder fixtures. It must not inherit the 2.1.0 decoders through permissive semver matching.

Unit tests inject `ExecFileAdapter`; they do not need or execute a live native binary. Version tests enqueue fake `version` results, assert the exact argv, and then enqueue operation fixtures. This tests capability selection without PATH, installation, or native stores.

### Exact argv construction

Each public client method emits one operation and an explicit `cwd`:

| Client method | Argument array after executable |
| --- | --- |
| `start(request)` | `["review", "start", "--cwd", cwd, ...optionalLineage, ...optionalPolicyPath, ...optionalFocus]` |
| `finalize(request)` | `["review", "finalize", "--cwd", cwd, ...optionalLineage, ...orderedResultFiles, ...optionalRefuter, ...optionalCorrectionLines, ...optionalValidation, ...optionalEvidence, ...optionalFailed]` |
| `validate(request)` | `["review", "validate", "--gate", gate, "--cwd", cwd, ...optionalLineage, ...typedGateFlags]` |
| `bindSdd(request)` | `["review", "bind-sdd", "--cwd", cwd, "--change", change, "--lineage", lineage, "--expected-binding-revision=<revision>"]` |
| `sddStatus(request)` | `["sdd-status", change, "--cwd", cwd, "--json", "--instructions"]` |

Optional flags are emitted only from validated typed fields. Values remain individual argv elements even when they contain spaces or metacharacters. For native `START`, omitted `policyPath` emits no `--policy`; an accepted custom path emits exactly `"--policy", canonicalPolicyPath`, where the complete canonical path is one argv value. No hash is converted into a path. The expected binding revision intentionally uses one `--expected-binding-revision=<revision>` element so the first bind can represent the native empty string as `--expected-binding-revision=` rather than omitting CAS.

### Native START policy-path boundary

The controller validates policy input before version probing or any native adapter call. This is a request-safety boundary, not policy authority.

1. Parse native ordinary START with an exact route-specific input shape. `policyHash` is forbidden even when `policyPath` is also present; reject it as `native-start-legacy-policy-hash-unsupported` rather than ignoring it.
2. When `policyPath` is absent, call `start({ cwd, ... })` without `--policy`. Native `START` selects and persists its bounded default policy.
3. When `policyPath` is present, require a non-empty string. Resolve a relative value against the canonical repository root; absolute values are accepted only when they remain inside the same allowed directory.
4. Define the only custom-policy scope as `<canonical-repository-root>/.gentle-ai/policies/`. The scope itself must be a real directory reached without a symlink. The candidate must be a strict descendant of that directory, not the directory itself.
5. Walk every existing component from `.gentle-ai` through the leaf with `lstat`; reject any symbolic link. Require the leaf to exist and be a regular file. Compute `realpath` and require it to equal the normalized candidate and remain inside the canonical scope using path-component-aware `relative` checks. This rejects missing files, directories, devices, FIFOs, outside paths, `..` escapes, and symlinked components.
6. Pass the resulting canonical absolute path to `NativeReviewCli.start`. The client also accepts only `policyPath`; it never exposes a `policyHash` compatibility alias.

Pre-call failures return a typed blocked envelope with `mutation_performed: false`, `mutation_outcome: "none"`, and a stable reason such as `legacy-policy-hash-unsupported`, `policy-path-outside-scope`, `policy-path-symlink`, or `policy-path-not-regular`. Tests assert zero adapter calls, including zero version calls. Because the native CLI accepts a path rather than an open file descriptor, a filesystem race cannot be eliminated by Pi; native policy loading and native store/result binding remain authoritative, and any post-launch failure follows the existing committed-or-ambiguous rules.

Finalize inputs are staged in one mode-`0700` temporary directory as mode-`0600` JSON files: one result file per selected lens in native order, one refuter batch file, one targeted validation file, and one final evidence file as applicable. Cleanup runs in `finally` after success, denial, timeout, cancellation, or decode failure. No shell utility is used. Receipt and binding paths returned by native remain opaque and are never opened by Pi.

### Strict decoders

Every decoder:

- starts from `unknown` and accepts exactly one JSON object;
- rejects empty output, trailing JSON, extra keys, missing keys, wrong scalar types, unsafe integers, and unknown enums;
- validates nested arrays and objects recursively;
- validates operation/schema discriminators before any mapping;
- validates request-known identity echoes, such as selected change and lineage, against the exact request;
- validates bind result-only repository, authority, receipt, and path identities from the returned native evidence and its internal gate context, without requiring or consulting a Pi-side approval cache;
- never treats process exit alone as success.

Pinned success contracts are:

- `review start`: exact pinned 2.1.0 result fields for `operation: "review/start"`, `lineage_id`, `state: "reviewing"`, `risk_level`, canonical selected lenses, non-negative `changed_files`/`changed_lines`, and non-negative `correction_budget`; policy binding is native-owned and Pi neither reconstructs nor compares it to caller data. If the pinned native schema exposes policy evidence, the version-specific decoder may map only that decoded evidence; otherwise it remains store-owned and opaque rather than being fabricated;
- `review finalize`: exact `operation: "review/finalize"`, `lineage_id`, compact ordinary `state`, `action`, native `store_revision`, and optional opaque `receipt_path`;
- `review validate`: `schema: "gentle-ai.review-gate-result/v1"`, `result`, `allowed`, `action`, `reason`, and the complete 2.1.0 `GateContext`; require `allowed === (result === "allow")`;
- `review bind-sdd`: the pinned 2.1.0 binding schema and exact returned repository/change/path/lineage/authority/receipt identities, including returned binding revision and gate context;
- `sdd-status`: `schemaName: "gentle-ai.sdd-status"`, `schemaVersion: 1`, exact selected `changeName`, `artifactStore: "openspec"`, and all documented top-level/nested status fields. Readiness requires a schema-valid bound review gate allow and no `resolve-review` blocker.

Checked-in fixtures in `tests/fixtures/native-review-cli/v2.1.0/` are the source for decoder tests. One field-at-a-time mutations prove rejection of missing, extra, wrong-type, wrong-enum, identity-mismatched, and inconsistent allow fields. Production code must not loosen a decoder merely to accept an unversioned native change.

`review validate` may emit a schema-valid deny body and exit non-zero. The client may attach the decoded deny body to a typed blocked result for diagnostics, but only exit zero plus a valid `allowed: true` body is authorizing.

### Process error semantics

`NativeReviewCliError` uses const-derived codes: `unavailable`, `timeout`, `non-zero`, `signal`, `unexpected-stderr`, `output-limit`, `empty-output`, `malformed-json`, `schema-incompatible`, `identity-mismatch`, and `version-incompatible`.

It also records:

- operation;
- whether launch was attempted;
- whether the operation is mutating;
- `mutationOutcome: "none" | "unknown"`;
- bounded exit/signal/stderr diagnostics.

Pre-launch validation failures report `mutationOutcome: "none"`. Timeout, signal, output overflow, or lost/malformed successful output after a mutating launch report `mutationOutcome: "unknown"` and `next_action: "replay-exact-native-operation"`. For `bind-sdd`, this committed-or-ambiguous rule also applies when an exit-zero result fails strict schema or post-call identity validation: the native call already occurred and may have committed, so Pi blocks readiness and authorization and does not claim zero mutation. Pi must not claim `lineage_created: false` after an ambiguous launch. No error creates local authority, binding, receipt, approval, or authorization.

## Controller integration and public envelopes

### `extensions/gentle-ai.ts` symbols

Refactor without splitting authority logic across two controllers:

- add `GentleAiRuntimeDependencies` with `nativeReviewCli` or a `nativeReviewCliFactory`;
- add `createGentleAiExtension(dependencies)`; keep the default export as the production wrapper so package loading remains compatible;
- make `executeReviewControllerOperation` asynchronous and inject `NativeReviewCliV210`;
- add pure `resolveReviewAuthorityRoute`, `nativeStatusUnsupported`, `mapNativeStartResult`, `mapNativeFinalizeResult`, `mapNativeValidateResult`, and `mapNativeBindingResult` helpers; `mapNativeBindingResult` consumes only a strictly decoded native result and does not consult a controller approval cache;
- extend `PendingReviewAuthorization` with native gate, lineage, authority revision, and context fingerprint fields for lifecycle commands only; do not reuse or extend it as bind-SDD approval state;
- make `gateLifecycleCommand` and `ReviewGateEvaluator` asynchronous so bash-time native revalidation occurs before allow;
- keep all new pure helpers available through `__testing` only where existing test style requires it.

The public outer envelope remains `{ operation, ... }`. Native values are nested under `result` or `binding`; Pi maps names but does not synthesize missing native state. `risk_level` maps to existing `risk_tier`, and `changed_lines` maps to `original_changed_lines`. A finalize receipt path remains opaque. The native start mapper never echoes `policyPath`, never emits a caller-supplied `policyHash`, and never synthesizes policy identity; only version-pinned native policy evidence may be exposed.

The `gentle_review` public input description and prompt guidance distinguish routes explicitly: new native ordinary START uses a JSON string such as `{"mode":"ordinary"}` or `{"mode":"ordinary","policyPath":".gentle-ai/policies/team.json"}`; `policyHash` is documented only for the legacy compact contract. Controller parsing remains route-specific so preserving compact compatibility cannot accidentally widen native input.

The unsupported result is stable and typed:

```json
{
  "operation": "status",
  "status": "blocked",
  "outcome": "native-status-unsupported",
  "mutation_performed": false,
  "inventory_complete": false,
  "next_action": "require-upstream-read-only-native-status-inventory",
  "evidence": {
    "native_contract": "gentle-ai/2.1.0",
    "general_status": "unsupported",
    "claimant_inventory": "unsupported"
  }
}
```

Unsupported status is returned before version probing or any native process invocation. If Pi-local claimant diagnostics are included, they are nested as incomplete diagnostics and cannot change `inventory_complete: false` or the blocked outcome.

## Binding and exact bound SDD status

Binding is a direct call to the native authority owner, not a post-finalize composition in Pi and not a new Pi authority store. The boundary is deliberately asymmetric:

1. **Before the call, Pi validates only request-known data.** It canonicalizes the request cwd, validates the selected change and repository-confined OpenSpec location, validates the requested lineage, and validates the explicitly supplied expected binding revision. Malformed input or a mismatch among those request-known values is rejected before version probing or `bind-sdd`; tests must observe zero native bind calls.
2. **The native request remains the pinned CLI contract.** It contains only `--cwd`, `--change`, `--lineage`, and `--expected-binding-revision=<revision>`. The first bind sends the explicit empty revision. Pi must not add repository ID, authority revision, receipt hash/path, approved-finalize data, or any other unsupported field to the client request or argv.
3. **Native bind owns approval and authority validation.** Native code decides whether the canonical repository and lineage are approved, whether the native receipt is valid, and whether binding CAS permits the association. Pi does not pre-authorize this decision from finalize output and does not keep a controller approval cache.
4. **After the call, Pi strictly decodes native-owned evidence.** It validates the exact binding schema, selected change and lineage echoes, repository identity, canonical OpenSpec path, authority revision, receipt identity, binding revision, and the consistency of their gate context. Repository, authority, receipt, and path identities are result-only evidence; they are not fields that Pi can require from the caller as proof of approval.
5. **A valid result is returned without mirroring.** Pi stores no approval or binding mirror and returns the observed native binding revision for an exact replay.
6. **Pre-call and post-call failures have different call-count semantics.** A request-known validation failure proves no native bind call. Once native bind is invoked, malformed output or any result identity mismatch is committed-or-ambiguous: the bind-call counter has incremented, readiness and authorization remain blocked, and Pi cannot claim that no native mutation occurred.
7. **Recovery preserves semantics.** A stale or native-rejected CAS remains blocked. Lost output, malformed output, and post-call identity mismatch permit only exact-operation replay with the same cwd, change, lineage, and expected revision, or an explicit supported native recovery path. Pi must not retry with different semantics, guess a revision, fall back to Pi authority, copy records, start/finalize another lineage, or infer readiness.

Change `lib/sdd-status.ts` by replacing callback-only authority readiness for the new native path with flat data:

- retain `SddReviewAuthorityOverlay` for existing legacy recovery compatibility;
- add `NativeReviewReadinessOverlay` with `expected`, `ready`, `lineageId`, `bindingRevision`, and `reason`;
- add `nativeReviewReadiness?: NativeReviewReadinessOverlay` to `ResolveSddStatusOptions`;
- update `withRecoveryBlock` and `resolveSddStatus` to apply the native overlay as data, never as a process callback.

`extensions/gentle-ai.ts:resolveControllerSddStatus` becomes asynchronous for an exact OpenSpec change. It invokes `NativeReviewCliV210.sddStatus`, maps only decoded bound readiness into `NativeReviewReadinessOverlay`, then calls local `resolveSddStatus`. Local proposal/spec/design/task/collision/verification rules still apply. Native failure, missing/stale binding, changed authority, wrong change/path, non-allow gate, or malformed status adds `resolve-review:` to `blockedReasons` and selects `resolve-review`.

Engram/none status remains non-authoritative and does not invoke native OpenSpec status. Bound SDD status never services general `gentle_review STATUS` or claimant inventory.

## Exact one-shot lifecycle authorization

Preserve the current `PendingReviewAuthorization` map and dangerous-command ordering, with native evidence added:

1. `deriveReviewGateTarget` parses the exact lifecycle command and derives its typed target.
2. `NativeReviewCliV210.validate` validates the corresponding gate, cwd, lineage, and gate-specific target evidence.
3. Only exit-zero plus strict `allow` registers one authorization keyed by `reviewAuthorizationKey(command, resolvedCwd)`.
4. The entry stores the Pi target hash and a canonical fingerprint of native gate context, including lineage and authority/store revision; a receipt path alone is insufficient.
5. `gateLifecycleCommand` consumes the entry before any awaited revalidation, re-parses the command, rederives cwd/target, and rejects command, worktree, target, or context mismatch.
6. It performs one second native `review validate` for the same gate/lineage at bash time. The fresh context fingerprint must equal the registered fingerprint before execution is allowed.
7. Replay finds no entry and fails closed. Native timeout, deny, schema failure, changed context, or cancellation after consumption remains blocked and does not restore the authorization.
8. `enforceReviewGateAndCommandSafety` continues to run dangerous-command safety first. Native review approval cannot override it.

Version success, child-process success, actor output, start/finalize results, binding, or SDD readiness never registers an authorization.

## Exact implementation files and tests

| File | Symbols/changes | Tests |
| --- | --- | --- |
| `lib/native-review-cli.ts` | New process adapter, capability matrix, `NativeReviewCliV210`, `NativeStartRequest.policyPath?` argv with no hash alias, four-field bind request/argv, strict result-only decoders, finalize staging, typed errors | `tests/native-review-cli.test.ts`; fixtures under `tests/fixtures/native-review-cli/v2.1.0/` |
| `extensions/gentle-ai.ts` | `createGentleAiExtension`, async `executeReviewControllerOperation`, route-specific native START parsing, repository-local policy-path validation, public description/mappers, asymmetric bind precondition/result handling without an approval cache, async `gateLifecycleCommand`, native authorization evidence, async `resolveControllerSddStatus` | `tests/review-controller-native-routing.test.ts`, `tests/review-controller.test.ts`, `tests/gentle-ai.test.ts` |
| `lib/sdd-status.ts` | `NativeReviewReadinessOverlay`, data-only readiness merge while preserving `SddReviewAuthorityOverlay` | `tests/sdd-status.test.ts` |
| Existing compact/graph modules | No format or mutation changes; exercised as compatibility fixtures | Existing `tests/review-compact-gate.test.ts`, `tests/review-transaction.test.ts`, and graph/receipt suites |

Focused test cases:

- exact `version`, start/finalize/validate/bind/status argv arrays and cwd, including native default START with no `--policy` and custom START with one canonical path value after `--policy`;
- `NativeStartRequest` accepts `policyPath?` and has no `policyHash`; type-level and runtime tests prevent a legacy hash from reaching the native client;
- controller rejects native `policyHash` before version probing, even when combined with `policyPath`, while the legacy compact route retains its existing hash contract;
- repository-local policy scope tests cover relative and absolute in-scope files, spaces/metacharacters as one argv value, missing paths, scope root, directories, devices where supported, `..`/absolute escapes, symlink leaf, symlink ancestor, and canonical-path mismatch, with zero adapter calls for every rejection;
- native start mapping proves policy binding is native result/store-owned: no input hash/path is treated as evidence, and only a pinned decoded native policy field may be exposed;
- no `shell` option or command-string interpolation;
- exact 2.1.0 capability selection and rejection of dev/older/newer/suffixed output;
- strict success fixtures and one-field decoder mutations;
- unavailable, spawn error, timeout, signal, non-zero, stderr-on-success, output overflow, empty output, malformed/trailing JSON, and cancellation;
- ambiguous mutation reports exact replay and never `lineage_created: false`;
- finalize temporary file order, modes, content, and cleanup on every exit path;
- general native `STATUS` and complete mixed inventory return `native-status-unsupported` with zero adapter calls and zero local mutation;
- known compact-v2/graph-v1 reads and gates still work; their ordinary mutation is rejected;
- explicit Judgment Day remains graph-v1 and makes zero native calls;
- native failure makes zero compact/graph fallback writes;
- bind pre-call validation covers only canonical cwd/change/lineage/expected revision and proves zero native calls on malformed or request-known mismatch;
- native bind owns approved repository/lineage/receipt validation; controller input and the native client request contain no cached approval, repository, authority, receipt, or path fields;
- strict post-call decoding validates selected change plus returned repository/authority/receipt/path identities; mismatch increments the bind-call count, is committed-or-ambiguous, blocks readiness/authorization, and permits only exact replay or supported recovery;
- exact bound SDD readiness overlays local status; missing/stale/changed binding blocks;
- native allow registers once; deny/error/malformed/version mismatch registers none;
- bash-time revalidation, context mismatch, worktree mismatch, candidate change, and replay all fail closed;
- dangerous-command safety remains independently first.

All default tests use fake `ExecFileAdapter` queues and Node temporary directories. They do not execute a live `gentle-ai`, inspect native common-dir files, depend on `/bin/sh`, or mutate real native authority. An opt-in integration test may exist only behind an explicit pinned-binary environment variable and is not part of unit-test acceptance.

## Strict TDD sequence

1. **RED:** adapter/version/argv/error tests, including omitted-policy argv and one-value canonical `policyPath` argv. **GREEN:** `createNodeExecFileAdapter`, capability table, `NativeStartRequest.policyPath?`, and client shell without any hash alias.
2. **RED:** strict fixture and mutation tests for all five supported operations. **GREEN:** 2.1.0 decoders.
3. **RED:** finalize staging, file-mode, ordering, and cleanup tests. **GREEN:** serializers and temporary lifecycle.
4. **RED:** routing tests for native ordinary, native default/custom policy behavior, typed pre-call rejection of `policyHash` and unsafe paths, known legacy hash compatibility/read-only behavior, unsupported status/inventory, no probes/fallback, and Judgment Day isolation. **GREEN:** async injected controller routing plus repository-local no-symlink policy-path validation.
5. **RED:** public description/input and envelope tests, including route-specific policy fields, absence of fabricated policy/state, and absence of authorization. **GREEN:** public mapping and pure result/error mappers.
6. **RED:** separate bind tests into (a) malformed or request-known cwd/change/lineage/expected-revision mismatch with zero native calls, and (b) malformed or identity-mismatched post-call results where `bindCalls` increments and the outcome is committed-or-ambiguous; also cover empty first bind, observed CAS exact replay, stale/native rejection, no approval cache or unsupported request fields, and exact bound SDD status. **GREEN:** implement the asymmetric bind authority boundary and data overlay without Pi-side approval composition.
7. **RED:** one-shot registration, consume-before-await, second native validation, replay, stale context, changed target/worktree, and safety precedence. **GREEN:** native authorization evidence.
8. **TRIANGULATE:** run unchanged compact-v2, graph-v1, Judgment Day, receipt/gate, SDD dispatcher, release-fast-path, and issue #118 seam tests.
9. **REFACTOR:** remove only proven duplication, then run the repository test command (`pnpm test`). Record RED/GREEN evidence; production behavior is not written before its focused failing test.

## Rollout, review lineage, and rollback

### Rollout

Ship one coherent native boundary with issue #118. There is no feature flag that reactivates Pi ordinary mutation. A diagnostic disable switch may block native operations, but its disabled behavior must remain fail closed. Runtime support is pinned to the explicit 2.1.0 capability entry.

### Current approved Pi lineage

The current approved Pi lineage cannot be passed to native `review bind-sdd`. Native binding requires native-approved authority and its native receipt; the Pi receipt is a different immutable authority format. It must remain historical and read/gate-compatible. It must not be copied, translated, imported, mirrored, or relabelled as native.

Implementation expands the candidate tree beyond that Pi receipt's immutable target. After implementation and independent verification, the final expanded tree receives exactly **one fresh scope-changed native ordinary review**. This is the first native review of the expanded target, not a duplicate review of the unchanged approved Pi target. The old Pi approval remains read-only history, and no reset or migration is authorized.

### Rollback

Rollback is code-only:

- revert native routing, adapter, decoder, policy-path validation, public native START input mapping, binding composition, and native SDD overlay as one coherent native integration;
- leave all native lineages, receipts, and bindings untouched;
- never translate native records into Pi stores;
- retain `native-status-unsupported` wherever native absence cannot be proven;
- do not resume legacy mutation or reinterpret a native policy path/hash for a candidate that may already have native authority; native records retain their native-bound policy and remain untouched;
- preserve legacy reads/gates, graph-v1 Judgment Day, one-shot command safety, and dangerous-command protection.

## Verification checklist

- [ ] Supported operations have one exact native argv path and no legacy fallback.
- [ ] Native START omits `--policy` by default and accepts only `NativeStartRequest.policyPath?`; native-route `policyHash` is rejected before any version or operation call.
- [ ] Custom policies are canonical regular non-symlink files strictly under `<repository-root>/.gentle-ai/policies/` and are passed as one argv value.
- [ ] Native result/store remains the sole owner of policy binding; Pi does not derive policy evidence from request input.
- [ ] Legacy compact routing retains its established `policyHash` contract without leaking it into native routing.
- [ ] General native status and complete mixed inventory return `native-status-unsupported` without invoking the adapter.
- [ ] Version/capability and operation tests require no live native binary.
- [ ] Strict decoders reject malformed, extra, inconsistent, or identity-mismatched output.
- [ ] Process uncertainty authorizes nothing and never starts a replacement lineage.
- [ ] First bind sends an explicit empty revision; retries use only an observed revision.
- [ ] Bind pre-call validation uses only request-known cwd/change/lineage/expected revision and malformed or mismatched input makes zero native calls.
- [ ] Native bind owns approved repository/lineage/receipt authority; Pi adds no approval cache and no unsupported CLI request fields.
- [ ] Strict post-call repository/authority/receipt/path/change validation treats mismatch as committed-or-ambiguous: the call occurred, readiness/authorization stay blocked, and only exact replay or supported recovery is allowed.
- [ ] Bound SDD status is not exposed as general review status or inventory.
- [ ] Existing Pi ordinary authority remains read/gate-compatible and mutation-rejecting.
- [ ] Judgment Day remains graph-v1.
- [ ] Lifecycle authorization is exact, one-shot, consumed before revalidation, and rederived at bash time.
- [ ] The final expanded candidate receives one fresh scope-changed native ordinary review after implementation.