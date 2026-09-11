# SDD Status and Action Context Contract

Shared OpenSpec-style contract for Gentle Pi SDD phases. Use this before acting on a change so orchestration and executors do not guess state, paths, or edit scope.

## Purpose

Any phase that selects, continues, applies, verifies, syncs, or archives an SDD change MUST first produce or consume structured status. The status is the handoff between the parent orchestrator and phase executor.

## Change Selection

- If a change name is provided, use that exact change after confirming it exists in the selected artifact store.
- If no change name is provided, infer only when the active change is unambiguous from session state or there is exactly one active change.
- If multiple active changes match or the active change is unclear, ask the user to choose. Do not guess.
- If no active changes exist, report that no SDD change is active and suggest starting one.

## Native Engine

- For file-backed `openspec` or `both` sessions with an `openspec/` directory, use Gentle Pi's local SDD status engine as the artifact-state authority. It resolves the local artifact graph without consulting RDD authority or receipts.
- For non-authoritative stores (`engram`, `none`, and `both` without an `openspec/` directory), do not treat disk status output as authoritative; follow Engine Authority by Store below.
- Runtime-attempt authority is different from artifact dispatch: normal runtime-bearing OpenSpec and Engram continuations MUST bracket external execution with `gentle-ai sdd-attempt acquire|settle --cwd <repo> --change <change>`. Their bounded result contains only `proceed`, `blocked`, or `complete` plus an opaque continuation token when required, and MAY carry `settle_obligation` on a `proceed`. The Git-common-dir immutable chain remains the sole authority for ordinals, cumulative attempt/line budgets, runtime evidence, and atomic bound remediation.
- A phase actor launched BY a parent that already holds a `proceed`-state acquire for that exact work unit is a distinct call/process, not a fresh continuation: it MUST NOT `acquire` again blind. Colliding with its own parent's active attempt is not a genuine `blocked: active_attempt` (#2291). It authenticates as that SAME attempt by passing the parent's returned token on its own `acquire --token <token>` call: a token matching the ledger's live active attempt returns `proceed` with that same token and zero mutation, while a non-matching token gets the ordinary `blocked: active_attempt` naming the real active token.
- Apply the Bounded Planning Routing contract below: a blocked apply dependency is not a blanket veto on planning. Non-planning phases must still obey their own dependency gates.
- `nextRecommended` is a bounded machine token for routing, not human prose. Route only by `nextRecommended` and dependency states. Human-readable explanation belongs in `blockedReasons`, not `nextRecommended`.
- If the binary is unavailable, fall back to this prompt contract and the manual status schema below. Manual fallback status MUST stay shape-compatible with the native status JSON even when values are reconstructed manually.

## Bounded Planning Routing

For authoritative native status, route only by the bounded `nextRecommended` token and dependency states; never infer a route from prose. Keep human diagnostics in `blockedReasons`, not in `nextRecommended`, and report them without discarding them to enable a route.

| `nextRecommended` | Planning route |
| --- | --- |
| `propose` | `sdd-proposal` |
| `spec` | `sdd-spec` |
| `design` | `sdd-design` |
| `tasks` | `sdd-tasks` |
| `sdd-propose` | `sdd-proposal` |
| `sdd-spec` | `sdd-spec` |
| `sdd-design` | `sdd-design` |
| `sdd-tasks` | `sdd-tasks` |

The unprefixed tokens come from the native Gentle AI v2 status contract; the `sdd-*` tokens come from Gentle Pi's local resolver. Both forms authorize the same bounded planning routes.

These planning routes remain runnable when missing planning artifacts leave `dependencies.apply: blocked`; do not require apply readiness to produce those artifacts. This is a planning-only exception, not permission to run apply or another blocked non-planning phase.

Before any planning launch, stop for ambiguous change selection, unresolved session preflight, or unsafe action context. Carry `actionContext` and prove planned writes are within the authoritative workspace or allowed edit roots; workspace-planning without allowed edit roots remains read-only. Planning does not bypass the init guard, pre-proposal gate, or phase approval requirements.

## Bounded Execution Routing

Execution routes accept the native Gentle AI v2 tokens and Gentle Pi's local `sdd-*` tokens without rewriting status:

| `nextRecommended` | Execution route |
| --- | --- |
| `apply` | `sdd-apply` |
| `sdd-apply` | `sdd-apply` |
| `verify` | `sdd-verify` |
| `sdd-verify` | `sdd-verify` |
| `archive` | `sdd-archive` |
| `sdd-archive` | `sdd-archive` |
| `sdd-sync` | `sdd-sync` |
| `remediate` | `sdd-apply` |

Native `remediate` maps to the mutating `sdd-apply` executor, never to the independent `sdd-verify` executor. It authorizes only the fail-closed Native Remediation Mode defined by `sdd-apply`, with the provider's exact remediation state, failed-evidence revision, phase instructions, and runtime-attempt binding.

For ordinary non-planning phases, stop when that phase's dependency is `blocked`. The `remediate` route is the only dependency-blocked exception: it repairs the failed verification that keeps `dependencies.verify` blocked, and it proceeds only when the Native Remediation Mode validates every required field. To prevent unrelated blockers from authorizing mutation, remediation requires the sole blocker to equal `remediationState.reason`; `applyState` and `dependencies.apply` must be `all_done`, while `dependencies.verify` must be `blocked`. When `nextRecommended` is `blocked` or `resolve-blockers`, report `blockedReasons` and stop. Unknown tokens do not authorize a launch. Non-empty `blockedReasons` forbid ordinary apply, sync, and archive work; `verify` or `sdd-verify` may run only when the verify dependency permits it, while `remediate` may run only through the validated remediation mode. This alias table does not bypass preflight, selection, action-context, or runtime-attempt authority. The non-authoritative `resolve-via-engram` store carve-out remains separate and does not bypass those gates.

## Status Schema

Return status as markdown with these fields, or equivalent JSON when the host supports it:

```yaml
schemaName: spec-driven
changeName: <change-name>
artifactStore: openspec | engram | both | none
planningHome:
  root: <project-or-openspec-root>
  changesDir: <openspec/changes or memory topic prefix>
changeRoot: <openspec/changes/<change> or memory topic prefix>
artifactPaths:
  proposal: [<path-or-topic>]
  specs: [<path-or-topic>]
  design: [<path-or-topic>]
  tasks: [<path-or-topic>]
  applyProgress: [<path-or-topic>]
  verifyReport: [<path-or-topic>]
  syncReport: [<path-or-topic>]
contextFiles:
  proposal: [<concrete readable files/topics>]
  specs: [<concrete readable files/topics>]
  design: [<concrete readable files/topics>]
  tasks: [<concrete readable files/topics>]
  applyProgress: [<concrete readable files/topics>]
  verifyReport: [<concrete readable files/topics>]
  syncReport: [<concrete readable files/topics>]
artifacts:
  proposal: missing | done | partial
  specs: missing | done | partial
  design: missing | done | partial
  tasks: missing | done | partial
  applyProgress: missing | done | partial
  verifyReport: missing | done | partial
  syncReport: missing | done | partial
taskProgress: # implementation-owned plus malformed unresolved rows
  total: 0
  complete: 0
  remaining: 0
  unchecked: []
deferredParentActions:
  total: 0
  complete: 0
  remaining: 0
  unchecked: []
taskArtifactErrors: []
applyState: blocked | all_done | ready | not_applicable
dependencies:
  apply: blocked | ready | all_done | not_applicable
  verify: blocked | ready | all_done | not_applicable
  sync: blocked | ready | all_done | not_applicable
  archive: blocked | ready | all_done | not_applicable
actionContext:
  mode: repo-local | workspace-planning
  workspaceRoot: <absolute path>
  allowedEditRoots: [<absolute paths>]
  warnings: []
nextRecommended: <bounded-machine-token>
isNonAuthoritative: false  # boolean; true when the native engine is not authoritative for the store
```

## Task Ownership

New task checkboxes end with the terminal marker `<!-- sdd-owner: implementation -->`. An unmarked legacy checkbox is implementation-owned. Supported legacy non-implementation rows are informational only. Any line containing `sdd-owner` that is unsupported, duplicated, or non-terminal is malformed: add its exact line to `taskArtifactErrors` and `blockedReasons`, and count it as unresolved implementation work even when checked. `taskProgress` reports implementation work.

## Apply State

- `blocked`: required apply artifacts are missing, task selection is ambiguous, malformed ownership markers exist, or action context makes edits unsafe.
- `all_done`: tasks artifact exists and every implementation task is checked `[x]`.
- `ready`: tasks artifact exists, at least one implementation task remains unchecked, and edit scope is safe.
- `not_applicable`: emitted for non-authoritative stores (see Engine Authority by Store). This is NOT a blocker.

## Dependency States

- `apply` is `ready` only when specs, design, and tasks are available and task progress is not all done.
- `verify` is ready after implementation completion when tasks are complete or apply-progress exists. RDD authority and receipts never gate the apply -> verify -> sync -> archive route. Unchecked implementation tasks remain CRITICAL blockers for full archive readiness.
- `sync` is `ready` only when verify-report exists and has no unresolved `FAIL`, `BLOCKED`, `CRITICAL`, or verification blockers. `engram`/`none` modes may mark sync `not_applicable`.
- `archive` is `ready` only when verify-report exists, sync is complete or not applicable, and implementation tasks are complete. CRITICAL verification issues have no override. Explicit recorded exceptions are limited to non-critical partial archives or stale-checkbox reconciliation when apply-progress/verify-report prove completion.
- `not_applicable`: emitted for non-authoritative stores (engram, none, and both when no `openspec/` directory exists) when `nextRecommended: "resolve-via-engram"` is active. `not_applicable` is NOT a gate failure — readiness must be resolved from Engram instead of from these fields.

## Action Context Guard

The orchestrator MUST carry `actionContext` into any phase launch.

- If `mode: workspace-planning` and `allowedEditRoots` is empty, stop before editing, verifying implementation ownership, syncing specs, or archiving. Treat linked repos and folders as read-only planning context.
- If `allowedEditRoots` is present, only edit or move files within those roots.
- If a phase cannot prove a file is inside the authoritative workspace or allowed edit roots, stop and ask for clarification.

## Engine Authority by Store

- `openspec` and `both` (when `openspec/` directory exists): the local SDD status engine resolves artifact state from disk and is authoritative. Phase executors must obey it.
- `engram`, `none`, and `both` (when `openspec/` directory does NOT exist): the local engine cannot read Engram artifacts. It returns `nextRecommended: "resolve-via-engram"` and empty `blockedReasons`. This output is **non-authoritative**. The orchestrator must resolve readiness directly from Engram using the Engram memory tools injected by the memory provider on the change topic keys (`sdd/{change-name}/proposal`, `sdd/{change-name}/spec`, etc.) instead of relying on the engine's dependency states. The `artifactStore` field still reflects the real chosen store value (e.g. `"both"`) and must not be rewritten.

## Native Runtime Attempt Authority

The compact SDD runtime attempt authority is separate from artifact dispatch and status. It is artifact-store agnostic: the same acquire/settle discipline applies to `openspec`, `engram`, `both`, and `none` stores. Its payload MUST NOT be embedded in the SDD v1 status schema above; status reports artifact state only, never attempt tokens or attempt counters. No OpenSpec or Engram attempt ledger may be created or mirrored by Pi.

Before every runtime-bearing `sdd-apply`, `sdd-verify`, or remediation launch, the orchestrator MUST acquire a bounded attempt from the provider compact CLI; after the external run completes it MUST settle. The acquire and settle request IDs are distinct; an operation's own request ID is reused only for idempotent replay of that exact operation. Continuation routes only from the provider-returned `proceed|blocked|complete` — launch only on `proceed`, stop on `blocked` or `complete`. `reset` is never automatic and requires an explicit maintainer scope decision.

For the exact compact acquire/settle shapes and the full field semantics, see the `Native Runtime Attempt Authority` section of the lazy-loaded `SDD Orchestrator Workflow` contract. Do not look up `assets/...` paths at runtime; those are package source paths before installation.

## Status Output

Every command or agent that acts on a change MUST show or consume status before doing phase work:

- active change selection and how it was resolved;
- artifact statuses and paths/topics used as context;
- task progress and unchecked task list when tasks exist;
- next recommended action;
- any `actionContext` or edit-root warnings.
