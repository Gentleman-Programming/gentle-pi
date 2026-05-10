# Tasks: Gentle Pi Engram Bridge

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 260-390 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (size exception accepted) |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Implement bridge + prompt integration + tests | PR 1 | Single slice; strict TDD evidence in tasks |

## Phase 1: Foundation (Bridge Contracts + Safe Config)

- [x] 1.1 **RED** Add failing unit tests in `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` for config-shape discovery from `.mcp.json` and `.pi/mcp.json`, asserting no secret/token value is captured.
- [x] 1.2 **GREEN** Create `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` with typed config-shape detection (approved paths only) and sanitized evidence output.
- [x] 1.3 **REFACTOR** Update `packages/coding-agent/src/core/gentle-pi/types.ts` with `UNREACHABLE`, bridge evidence, and canonical operation types; remove duplicate literals.

## Phase 2: Core Implementation (State Derivation + Tool Mapping)

- [x] 2.1 **RED** Add failing table tests for direct/prefixed/proxy tool names mapping to canonical ops (`mem_search`, `mem_context`, `mem_get_observation`, `mem_save`, `mem_save_prompt`, `mem_session_summary`).
- [x] 2.2 **GREEN** Implement tool normalization + required-operation checks in `engram-bridge.ts` (direct, `engram_*`, `engram.*`, `mcp__engram__*`, `mcp_engram_*`).
- [x] 2.3 **RED** Add failing state-matrix tests for `available/configured/unreachable/unavailable/unknown` using config evidence + inspected/uninspected tool surfaces.
- [x] 2.4 **GREEN** Implement `deriveEngramBridgeState` policy in `engram-bridge.ts` to satisfy the matrix and block false `available` claims.
- [x] 2.5 **REFACTOR** Extract shared predicates/aliases in `engram-bridge.ts` for readability and deterministic test fixtures.

## Phase 3: Integration (Identity Memory + Session Wiring)

- [x] 3.1 **RED** Add failing integration assertions in `packages/coding-agent/test/system-prompt.test.ts` and regression suite for truthful non-availability wording in configured/unreachable/unavailable/unknown states.
- [x] 3.2 **GREEN** Integrate bridge module into `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` and `packages/coding-agent/src/core/agent-session-services.ts` so prompt derivation uses bridge evidence + active tool names.
- [x] 3.3 **REFACTOR** Narrow/remove broad `.pi/settings.json` substring evidence path in session services; keep only structured bridge evidence contract.

## Phase 4: Verification + Safe Sample Config

- [x] 4.1 Run strict TDD verification loop with `npm --prefix packages/coding-agent run test` after each RED→GREEN cycle; keep failing-first evidence in commit history notes.
- [x] 4.2 Run quality gate `npm run check` and fix all reported issues in touched files.
- [x] 4.3 Optionally add/update `.pi/mcp.json` sample only if it contains env references/placeholders (no literal secrets/tokens) and aligns with approved Engram bridge shape. (No sample config added; not needed for runtime behavior.)
