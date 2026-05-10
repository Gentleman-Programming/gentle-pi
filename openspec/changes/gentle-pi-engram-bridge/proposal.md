# Proposal: Gentle Pi Engram Bridge

## Intent

Connect Gentle Pi to Engram when a real MCP/tool bridge is available. Runtime memory claims must be evidence-backed: use Engram when callable, report configured/unreachable accurately, and preserve degraded mode when absent.

## Scope

### In Scope
- Capability detection: `available`, `configured`, `unreachable`, `unavailable`.
- MCP config discovery: `.mcp.json`, `.pi/mcp.json`, or Pi-owned config.
- Tool mapping for `mem_search`, `mem_context`, `mem_get_observation`, `mem_save`, `mem_save_prompt`, `mem_session_summary`, plus `engram_*`, `engram.*`, and MCP direct/proxy forms.
- Adapter routing through detected callable tools; no committed secrets.
- Self-description and memory protocol updates with no false availability claims.
- Tests for configured/available/unreachable/unavailable and no false claims.

### Out of Scope
- Replacing Engram with Pi memory package or generic memory ecosystem.
- Generic MCP marketplace support beyond the Engram bridge path.
- Committing credentials, tokens, or user memory data.

## Capabilities

### New Capabilities
- `gentle-pi-engram-bridge`: Engram bridge detection, config scope, memory tool mapping, truthful runtime protocol, and tests.

### Modified Capabilities
- None; no archived main specs exist yet. Integrates active `gentle-pi-identity-memory` artifacts.

## Approach

Extend the identity-memory harness with a narrow Engram bridge adapter. Detect config separately from callable tools, normalize names into typed operations, and expose evidence-backed status to prompts. Config may declare endpoints/commands but MUST use env references or local user config for secrets.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` | Modified | States, evidence, prompt text. |
| `packages/coding-agent/src/core/gentle-pi/*engram*` | New | Adapter/types. |
| `packages/coding-agent/src/core/agent-session*.ts` | Modified | Pass active MCP/tool surface. |
| `.mcp.json`, `.pi/mcp.json`, `.pi/settings.json` | New/Modified | Bridge config, no secrets. |
| `packages/coding-agent/test/suite/regressions/` | Modified | Faux-provider regressions. |
| `GENTLE_PI_HARNESSES.md`, SDD agent docs | Modified | Runtime-aligned protocol/setup. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Config mistaken for usable memory | Med | Separate `configured` from `available`; require callable probe. |
| Bridge names vary | Med | Normalize direct, prefixed, and proxy names. |
| Secret leakage | Low | Env-only references; no committed values. |

## Rollback Plan

Revert adapter, config, prompt/protocol, docs, and tests. No data migration is introduced.

## Dependencies

- Existing `gentle-pi-identity-memory` and faux-provider harness.
- MCP tool bridge when present; absent bridge remains degraded.

## Success Criteria

- [ ] Engram is used only when callable tools are detected.
- [ ] Configured and unreachable bridges do not produce availability claims.
- [ ] Memory tool names map consistently across direct/prefixed/proxy MCP forms.
- [ ] Self-description and SDD subagent protocol describe memory truthfully.
- [ ] Strict TDD TypeScript tests cover available/configured/unreachable/unavailable and no false claims.
- [ ] No secrets are committed.
