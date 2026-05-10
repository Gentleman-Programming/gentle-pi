# Proposal: Gentle Pi Agent

## Intent

Build the definitive Gentle Pi Agent: a Pi-specific coding-agent runtime profile with native harnesses for controlled autonomy, continuity, safety, delivery, and verification. Not a generic ecosystem.

## Scope

### In Scope
- Implement all 16 harnesses in `packages/coding-agent`: orchestrator, sdd-init, DAG, artifact store, OpenSpec, Strict TDD, skill registry, isolation, result contracts, review workload, delivery/chain strategy, apply-progress, model routing, permissions, backup/rollback.
- Use OpenSpec as the first-class artifact contract.
- Enforce Strict TDD where Vitest/faux-provider harnesses cover behavior.
- Accept `exception-ok` delivery for a large PR while still forecasting review workload.

### Out of Scope
- Generic ecosystem portability or multi-runtime APIs.
- Expanding beyond `packages/coding-agent` unless runtime docs/config require it.
- Repo-level `npm test`, dev, or build.

## Capabilities

### New Capabilities
- `gentle-pi-context-harness`: sdd-init, artifact store, OpenSpec continuity, project standards.
- `gentle-pi-process-harness`: orchestrator, phase DAG, isolated phase execution, result envelopes, apply-progress.
- `gentle-pi-quality-harness`: Strict TDD, verification evidence, skill-registry standards injection.
- `gentle-pi-delivery-harness`: 400-line forecast, `exception-ok`, delivery/chain strategy outputs.
- `gentle-pi-safety-harness`: command permissions, destructive-action gates, backup and rollback checkpoints.
- `gentle-pi-model-routing`: phase-aware model/provider policy inside the Pi runtime.

### Modified Capabilities
- None; no existing `openspec/specs/` capabilities are present.

## Approach

Use the recommended core-native profile. Add focused modules around `AgentSession`, runtime, services, model resolver, resource/skill loading, system prompt, and tools. Enforce runtime contracts, not prompt convention.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/coding-agent/src/main.ts` | Modified | Profile/policy wiring. |
| `packages/coding-agent/src/core/agent-session*.ts` | Modified | Dispatch, isolation, progress, contracts. |
| `packages/coding-agent/src/core/model-*` | Modified | Phase routing. |
| `packages/coding-agent/src/core/resource-loader.ts`, `skills.ts`, `system-prompt.ts` | Modified | Standards injection. |
| `packages/coding-agent/src/core/tools/*.ts` | Modified | Security gates. |
| `packages/coding-agent/test/**` | Modified | Faux-provider TDD coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Core coupling grows | Med | Focused modules and typed boundaries. |
| Safety gates block valid workflows | Med | Test allow/deny cases and preserve explicit approvals. |
| Huge PR review burden | High | `exception-ok`; still emit forecast/rollback notes. |

## Rollback Plan

Revert profile modules plus touched wiring/tests. OpenSpec artifacts are additive, so rollback keeps proposal history. Runtime config mutations require checkpoint restore paths.

## Dependencies

- Existing Vitest/faux-provider coding-agent harness.
- `openspec/config.yaml` Strict TDD and quality gates.

## Success Criteria

- [ ] All 16 harness concepts are represented in runtime behavior or explicit policy outputs.
- [ ] Strict TDD evidence exists for covered behavior; final gate is `npm run check`.
- [ ] Proposal/spec/design/tasks/verify artifacts remain contract-aligned.
- [ ] Runtime remains Pi-specialized and centered on `packages/coding-agent`.
