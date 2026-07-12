# SDD Status and Action Context Contract

Shared OpenSpec-style contract for Gentle Pi SDD phases. Use this before acting on a change so orchestration and executors do not guess state, paths, or edit scope.

## Purpose

Any phase that selects, continues, applies, verifies, syncs, or archives an SDD change MUST first produce or consume structured status. The status is the handoff between the parent orchestrator and phase executor.

## Change Selection

- If a change name is provided, use that exact change after confirming it exists in the selected artifact store.
- If no change name is provided, infer only when the active change is unambiguous from session state or there is exactly one active change.
- If multiple active changes match or the active change is unclear, ask the user to choose. Do not guess.
- If no active changes exist, report that no SDD change is active and suggest starting one.

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
nextRecommended: <command-or-action>
isNonAuthoritative: false  # boolean; true when the native engine is not authoritative for the store
```

## Task Ownership

Each checkbox may end with one terminal marker: `<!-- sdd-owner: implementation -->` or `<!-- sdd-owner: parent -->`. An unmarked legacy checkbox is implementation-owned. Any line containing `sdd-owner` that is unsupported, duplicated, or non-terminal is malformed: add its exact line to `taskArtifactErrors` and `blockedReasons`, and count it as unresolved implementation work even when checked. `taskProgress` reports implementation work; `deferredParentActions` reports valid parent actions separately.

## Apply State

- `blocked`: required apply artifacts are missing, task selection is ambiguous, malformed ownership markers exist, or action context makes edits unsafe.
- `all_done`: tasks artifact exists and every implementation task is checked `[x]`.
- `ready`: tasks artifact exists, at least one implementation task remains unchecked, and edit scope is safe.
- `not_applicable`: emitted for non-authoritative stores (see Engine Authority by Store). This is NOT a blocker.

## Dependency States

- `apply` is `ready` only when specs, design, and tasks are available and task progress is not all done.
- `verify` is ready only after implementation completion and authoritative parent review approval. Without that approval, the route is `parent-lifecycle`; missing receipt requires the parent to explicitly start bounded review and invalid authority fails closed. Unchecked implementation tasks remain CRITICAL blockers for full archive readiness.
- `sync` is `ready` only when verify-report exists and has no unresolved `FAIL`, `BLOCKED`, `CRITICAL`, or verification blockers. `engram`/`none` modes may mark sync `not_applicable`.
- `archive` is `ready` only when verify-report exists, sync is complete or not applicable, implementation tasks are complete, and explicit deferred mandatory parent actions are reconciled at their native lifecycle boundaries. CRITICAL verification issues have no override. Explicit recorded exceptions are limited to non-critical partial archives or stale-checkbox reconciliation when apply-progress/verify-report prove completion.
- `not_applicable`: emitted for non-authoritative stores (engram, none, and both when no `openspec/` directory exists) when `nextRecommended: "resolve-via-engram"` is active. `not_applicable` is NOT a gate failure — readiness must be resolved from Engram instead of from these fields.

## Action Context Guard

The orchestrator MUST carry `actionContext` into any phase launch.

- If `mode: workspace-planning` and `allowedEditRoots` is empty, stop before editing, verifying implementation ownership, syncing specs, or archiving. Treat linked repos and folders as read-only planning context.
- If `allowedEditRoots` is present, only edit or move files within those roots.
- If a phase cannot prove a file is inside the authoritative workspace or allowed edit roots, stop and ask for clarification.

## Engine Authority by Store

- `openspec` and `both` (when `openspec/` directory exists): the native status engine resolves artifact state from disk and is authoritative. Phase executors must obey it.
- `engram`, `none`, and `both` (when `openspec/` directory does NOT exist): the native status engine cannot read Engram artifacts. It returns `nextRecommended: "resolve-via-engram"` and empty `blockedReasons`. This output is **non-authoritative**. The orchestrator must resolve readiness directly from Engram using the Engram memory tools injected by the memory provider on the change topic keys (`sdd/{change-name}/proposal`, `sdd/{change-name}/spec`, etc.) instead of relying on the engine's dependency states. The `artifactStore` field still reflects the real chosen store value (e.g. `"both"`) and must not be rewritten.

## Status Output

Every command or agent that acts on a change MUST show or consume status before doing phase work:

- active change selection and how it was resolved;
- artifact statuses and paths/topics used as context;
- task progress and unchecked task list when tasks exist;
- next recommended action;
- any `actionContext` or edit-root warnings.
