# Proposal: Gentle Pi Identity Memory

## Intent

Make the running Pi agent identify and behave like Gentle Pi: a Pi-specific Gentle AI harness with accurate memory awareness and native SDD delegation. Today it can answer like a generic coding assistant, falsely say it lacks Engram, and treat SDD agents as prompt conventions instead of Pi-native subagents.

## Scope

### In Scope
- Identity/persona harness for `packages/coding-agent` runtime profile.
- Engram bridge/harness or capability-detection path that exposes memory availability without hardcoded false claims.
- Self-description: Pi is a coding-agent harness with Gentle Pi runtime capabilities, not generic Gentle AI portability.
- Memory protocol behavior: detect, describe, and use available Engram-style persistence only when actually wired.
- Native SDD orchestration on `pi-subagents`: project agents/chains, `/run`, `/chain`, `/parallel`, forked context, async/background work, tool allowlists, worktrees, and intercom where useful.
- Evaluate fitting Pi packages: `pi-intercom`, `pi-mcp-adapter`, Pi memory extensions as fallback/reference, and `pi-web-access` for researchers.
- Tests for persona tone, Engram availability, no false claims, and system prompt contents.

### Out of Scope
- Generic multi-memory ecosystem support.
- Portable Gentle AI framework APIs outside Pi.
- Replacing Engram as the desired primary memory target without a later explicit decision.
- Expanding beyond `packages/coding-agent` except docs/tests needed to match runtime behavior.

## Capabilities

### New Capabilities
- `gentle-pi-identity-memory`: persona, self-description, Engram-first memory capability detection, and native SDD subagent orchestration contract.

### Modified Capabilities
- None; no archived main `openspec/specs/` capabilities exist yet.

## Approach

Add typed Gentle Pi identity/memory/delegation services beside `core/gentle-pi/*`. Compose a compact identity block into `system-prompt.ts`, backed by runtime capability detection. Model SDD phases as first-class `pi-subagents` project agents/chains while keeping Engram first. Evaluate companions only when they strengthen this Pi-specific runtime.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/coding-agent/src/core/gentle-pi/*` | New/Modified | Identity, memory, delegation, and self-description contracts. |
| `packages/coding-agent/src/core/system-prompt.ts` | Modified | Inject Gentle Pi persona/memory prompt contents. |
| `packages/coding-agent/src/core/agent-session-services.ts` | Modified | Wire detected identity/memory services into session creation. |
| `.pi/agents/**/*.md` | New | Project-local SDD phase agents using `pi-subagents` conventions. |
| `.pi/chains/**/*.chain.md` | New | Project-local SDD orchestration chains for ordered/parallel phases. |
| `packages/coding-agent/test/suite/regressions/` | New | Faux-provider regressions for persona, delegation, Engram claims, and prompt contents. |
| `GENTLE_PI_HARNESSES.md` | Modified | Operational docs aligned with implemented identity/memory harness. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Persona becomes prompt-only theater | Med | Back it with typed services and prompt-content tests. |
| False Engram claims persist | Med | Capability detector returns explicit available/unavailable states. |
| Subagents over-expand scope | Med | Limit integration to SDD delegation and Engram bridge needs. |
| Tone over-constrains answers | Low | Test principles, not exact prose. |

## Rollback Plan

Revert identity/memory/delegation wiring, `.pi` agent/chain files, prompt injection, tests, and doc update. Existing Gentle Pi harness modules remain intact; no migration or persisted data mutation is required.

## Dependencies

- Existing Gentle Pi runtime profile and faux-provider test harness.
- Engram bridge availability, or a detector that can safely report unavailable.
- Installed `pi-subagents`; install note: global NPM prefix was needed when Nix store global install failed.
- Package evaluation inputs: `pi-intercom`, `pi-mcp-adapter`, Pi memory extensions, and `pi-web-access`.

## Success Criteria

- [ ] Agent self-description is accurate and Pi/Gentle-specific.
- [ ] Spanish prompts receive natural Rioplatense/direct technical style where applicable.
- [ ] Agent never claims Engram is absent/present without detected evidence.
- [ ] SDD phase agents/orchestration use native `pi-subagents` project agents/chains instead of only internal prompt/runtime conventions.
- [ ] Companion Pi packages are evaluated with Engram kept as primary memory unless explicitly changed later.
- [ ] System prompt contains identity, memory protocol, and harness-awareness contract.
- [ ] Coding-agent regression tests cover persona, Engram availability, no false claims, and prompt contents.
