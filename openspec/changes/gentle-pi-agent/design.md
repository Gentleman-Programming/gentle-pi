# Design: Gentle Pi Agent

## Technical Approach

Add a Pi-specific Gentle runtime profile inside `packages/coding-agent`, using existing `main.ts` → `createAgentSessionServices()` → `createAgentSessionRuntime()` → `AgentSession` seams. The profile is native behavior: OpenSpec artifacts, phase DAG checks, result envelopes, strict TDD policy, delivery guardrails, model routing, command policy, and rollback checkpoints are typed services used by runtime composition, not generic prompt text. No delta specs exist yet, so this design maps to the proposal and exploration artifacts.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Runtime profile | Create `src/core/gentle-pi/*` modules and wire them from `main.ts`/services | Extension-only orchestration | Keeps invariants enforceable while avoiding more `AgentSession` bulk. |
| Artifact store | OpenSpec-first adapter over `openspec/changes/{change}/` | Engram/hybrid abstraction | Project mode is `openspec`; portability is explicitly out of scope. |
| Phase execution | Controller builds isolated phase input bundles and validates result envelopes | Single long prompt/session | Matches harness isolation and prevents phase context bleed. |
| Safety | Policy layer wraps bash operations and mutation checkpoints | Prompt warnings | Existing tool hooks can be bypassed by model behavior; command execution needs runtime checks. |
| Tests | Vitest RED tests using suite harness/faux provider | Real provider or repo-level tests | Existing local harness gives deterministic Strict TDD without paid/network APIs. |

## Data Flow

```txt
CLI/main
  -> GentlePiProfile.fromProject(cwd)
  -> OrchestratorController
  -> PhaseDag + OpenSpecStore + ProjectStandards
  -> isolated phase prompt/runtime profile
  -> ResultEnvelopeValidator
  -> OpenSpec artifacts / apply-progress / verify report

Tool call -> GentleCommandPolicy -> bash/edit/write -> BackupCheckpoint -> session/artifact update
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/coding-agent/src/core/gentle-pi/types.ts` | Create | Harness contracts: phases, DAG state, artifact keys, result envelope, delivery strategy. |
| `packages/coding-agent/src/core/gentle-pi/openspec-store.ts` | Create | Read/write `openspec/config.yaml` and change artifacts with continuity checks. |
| `packages/coding-agent/src/core/gentle-pi/orchestrator.ts` | Create | Pi SDD controller: preconditions, isolated phase inputs, apply-progress merge. |
| `packages/coding-agent/src/core/gentle-pi/project-standards.ts` | Create | Compile config/registry/testing capabilities into compact Project Standards. |
| `packages/coding-agent/src/core/gentle-pi/model-routing.ts` | Create | Phase-aware model selection policy over existing model resolver/registry. |
| `packages/coding-agent/src/core/gentle-pi/security-policy.ts` | Create | Command allow/deny policy and destructive git/npm guard decisions. |
| `packages/coding-agent/src/core/gentle-pi/backup.ts` | Create | Pre-mutation checkpoint and rollback metadata for config/runtime artifacts. |
| `packages/coding-agent/src/main.ts` | Modify | Resolve Gentle Pi profile and pass policy/services into runtime composition. |
| `packages/coding-agent/src/core/agent-session-services.ts` | Modify | Carry optional Gentle Pi services/diagnostics with cwd-bound services. |
| `packages/coding-agent/src/core/agent-session.ts` | Modify | Use injected command policy/checkpoint hooks without embedding orchestration logic. |
| `packages/coding-agent/src/core/tools/bash.ts` | Modify | Add optional pre-exec policy hook to `BashToolOptions`. |
| `packages/coding-agent/src/core/system-prompt.ts` | Modify | Append compact Project Standards for Gentle phase runs only. |
| `packages/coding-agent/test/suite/regressions/gentle-pi-agent-*.test.ts` | Create | Contract, DAG, artifact, routing, safety, rollback, and TDD policy regressions. |

## Interfaces / Contracts

```ts
type GentlePiPhase = "explore" | "proposal" | "spec" | "design" | "tasks" | "apply" | "verify" | "archive";
interface GentlePiResultEnvelope { status: "success" | "partial" | "blocked"; artifacts: string[]; next_recommended: string; risks: string; }
interface GentleCommandDecision { action: "allow" | "deny" | "confirm"; reason: string; checkpoint?: boolean; }
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | DAG preconditions, OpenSpec paths, result validation, delivery forecast, command policy | New Vitest tests under `test/suite/regressions/`, written RED first. |
| Integration | Orchestrator phase dispatch, Project Standards injection, model routing | Use `test/suite/harness.ts`, faux provider responses, in-memory settings/auth. |
| E2E | None | No E2E capability declared; do not add repo-level tests. |

## Migration / Rollout

No data migration required. Roll out behind Pi-specific Gentle profile detection/flag; default runtime remains unchanged until profile is active. Verification uses `npm --prefix packages/coding-agent run test` during TDD and final `npm run check` after code changes.

## Open Questions

- [ ] Exact CLI activation shape for the Gentle Pi profile is not specified; default to explicit internal flag/profile wiring during tasks.
