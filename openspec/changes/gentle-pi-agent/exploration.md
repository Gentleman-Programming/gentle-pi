## Exploration: gentle-pi-agent

### Current State
`packages/coding-agent` already has a reusable runtime split we can specialize instead of rebuilding: CLI entry (`src/cli.ts`) boots `main.ts`, which creates cwd-bound services (`createAgentSessionServices`), then session runtime (`createAgentSessionRuntime`), then mode (`interactive`/`print`/`rpc`). The operational core is `AgentSession` (`src/core/agent-session.ts`): tool registry, system-prompt synthesis, model lifecycle, extension hooks, queueing (`steer`/`followUp`), compaction, retry, and persistence through `SessionManager`.

Model/provider resolution is centralized in `src/core/model-resolver.ts` + `src/core/model-registry.ts` and is already policy-friendly (provider defaults, scoped models, fallback behavior, auth checks). Tool permission surface already exists via `--tools` / `--no-tools` / `--no-builtin-tools` (`src/cli/args.ts`) and `_allowedToolNames` filtering in `AgentSession._refreshToolRegistry()`.

Testing capability is strong and aligned with Strict TDD: Vitest unit/integration-style tests with local faux provider and harness (`packages/coding-agent/test/suite/harness.ts`, `test/test-harness.ts`, many `agent-session-*` tests). This is the exact path to implement Gentle harnesses safely.

### Affected Areas
- `packages/coding-agent/src/main.ts` — runtime composition seam; best entry to inject SDD orchestration mode and delivery policy inputs.
- `packages/coding-agent/src/core/agent-session.ts` — execution loop, tool registry, queueing, extension bridge; primary seam for phase contracts, apply-progress, and guardrails.
- `packages/coding-agent/src/core/agent-session-runtime.ts` — session switch/fork/import lifecycle; seam for sub-agent isolation boundaries and rollback checkpoints.
- `packages/coding-agent/src/core/agent-session-services.ts` — cwd-scoped dependency assembly; seam for sdd-init calibration outputs.
- `packages/coding-agent/src/core/model-resolver.ts` — model routing by phase and provider/model policy.
- `packages/coding-agent/src/core/model-registry.ts` — provider registration/auth resolution; seam for security policy and explicit provider controls.
- `packages/coding-agent/src/core/resource-loader.ts` + `src/core/skills.ts` — skill discovery/loading; seam for compact skill-registry injection behavior.
- `packages/coding-agent/src/core/system-prompt.ts` — contract/policy injection into model instructions per phase.
- `packages/coding-agent/src/core/tools/*.ts` (especially `bash.ts`) — command execution + restrictions; seam for permission/security harness.
- `packages/coding-agent/test/suite/harness.ts` + `packages/coding-agent/test/test-harness.ts` — canonical harness/faux-provider test infrastructure.
- `packages/coding-agent/test/agent-session-dynamic-tools.test.ts` + `test/model-resolver.test.ts` — existing coverage patterns to extend for dynamic tools and model routing.
- `openspec/config.yaml` — already declares `strict_tdd: true` and test/verify commands; should remain source-of-truth policy input.

### Approaches
1. **Extension-first harnessing (thin orchestration over existing runtime)** — add Gentle harnesses mostly as extensions/config overlays around current `AgentSession`/resource loader.
   - Pros: Lower initial code churn; reuses mature extension hooks and dynamic tool model.
   - Cons: Core guarantees (phase DAG contracts, strict result envelopes, safety policy) remain partially “convention” unless enforced in core.
   - Effort: Medium.

2. **Core-native Gentle runtime profile (recommended)** — add a first-class “Gentle Pi Agent profile” inside `packages/coding-agent` that enforces harness contracts in runtime core.
   - Pros: Strong invariants by default; easier to guarantee all 16 harnesses (DAG, artifacts, strict TDD, review guards, security, rollback).
   - Cons: Higher up-front design and refactor effort; touches core orchestration seams.
   - Effort: High.

### Recommendation
Use **Core-native Gentle runtime profile**. The project direction is explicitly non-generic and Pi-specialized, and the requested behavior (hard DAG contracts, strict result contract, delivery/chain policy, permission guardrails, rollback semantics) should be enforced by runtime, not left to prompt discipline.

Implementation mapping for all harnesses:
- **1 SDD Orchestrator**: add orchestrator controller at runtime layer (new core module), using `main.ts` composition.
- **2 sdd-init**: implement project calibration service using `resource-loader`, `settings-manager`, and `openspec/config.yaml` discovery.
- **3 Phase DAG**: explicit phase graph + precondition checks before dispatch.
- **4 Artifact Store**: unify OpenSpec file persistence adapter first; optional memory adapter later.
- **5 OpenSpec grammar**: use `openspec/changes/{change}/` artifact schema as enforced IO contracts.
- **6 Strict TDD**: enforce red/green evidence gates in apply/verify commands when testing capability is true.
- **7 Skill Registry**: compile large skill context into compact “Project Standards” payload at orchestrator boundary.
- **8 Sub-Agent Isolation**: isolate phase execution context (input bundle + allowed capabilities), no shared mutable prompt context.
- **9 Result Contract**: phase responses MUST emit `status/executive_summary/artifacts/next_recommended/risks/skill_resolution`.
- **10 Review Workload**: compute 400-line risk forecast during tasks, block/require policy decision before apply.
- **11 Delivery Strategy**: honor `exception-ok`/`auto-chain`/etc as explicit runtime gate input.
- **12 Chain Strategy**: enforce branch geometry planning output (stacked vs feature-chain) when forecast is high.
- **13 Apply-Progress**: persist incremental apply state artifact and merge on continuation.
- **14 Model Routing**: phase→model policy map built on `model-resolver`/`model-registry`.
- **15 Permission/Security**: add command policy layer ahead of `bash` execution + git destructive-action confirmations.
- **16 Backup/Rollback**: pre-mutation checkpoint manager for config/runtime artifacts with explicit rollback API.

### Risks
- `AgentSession` is already large and central; adding orchestration concerns directly can increase coupling unless split into new core modules.
- Extension flexibility may conflict with strict harness invariants if policy precedence is not explicit.
- Security harness must avoid false positives that block legitimate dev workflows, while still blocking dangerous commands.
- Delivery guardrails need deterministic diff-size forecasting to avoid noisy “risk high” decisions.

### Ready for Proposal
Yes — enough runtime seams and test strategy are identified to draft a complete proposal/spec/design/tasks package before implementation.
