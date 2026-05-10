# Tasks: Gentle Pi Identity Memory

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650-950 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 Identity+memory core -> PR 2 Native subagents/chains -> PR 3 Docs+regressions |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Identity/persona + truthful Engram detector wiring | PR 1 | `gentle-pi/*`, session services, system prompt contract |
| 2 | Native `.pi/agents` + `.pi/chains` SDD assets | PR 2 | Project orchestration and allowlist boundaries |
| 3 | Package docs + regression hardening | PR 3 | Harness docs and faux-provider regression coverage |

## Phase 1: Foundation (Identity + Capability Contracts)

- [x] 1.1 RED: Add unit tests for `GentlePiMemoryCapability` states/evidence in `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` (available/configured/unavailable/unknown).
- [x] 1.2 GREEN: Extend `packages/coding-agent/src/core/gentle-pi/types.ts` with identity profile, memory capability, and package recommendation contracts.
- [x] 1.3 GREEN: Create `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` with Engram-first detector, truthful memory protocol renderer, and fallback semantics.
- [x] 1.4 REFACTOR: Simplify detector helpers/evidence normalization in `identity-memory.ts` without changing assertions.

## Phase 2: Core Wiring (Session + Prompt Composition)

- [x] 2.1 RED: Add failing assertions in `packages/coding-agent/test/system-prompt.test.ts` for Gentle Pi self-description, no generic portability, and memory-status-bound language.
- [x] 2.2 GREEN: Update `packages/coding-agent/src/core/agent-session-services.ts` to create identity/memory services from cwd/resource-loader/env/config signals.
- [x] 2.3 GREEN: Update `packages/coding-agent/src/core/agent-session.ts` to recompute capability from active tools and pass `gentlePiIdentityPrompt` into prompt build path.
- [x] 2.4 GREEN: Update `packages/coding-agent/src/core/system-prompt.ts` to append `gentlePiIdentityPrompt` before project context/skills in default and custom prompt flows.
- [x] 2.5 REFACTOR: Reduce duplicated prompt-assembly branches while preserving all RED/GREEN checks.

## Phase 3: Native SDD Subagents + Package Guidance

- [x] 3.1 RED: Add config/shape regression checks for project assets in `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` (`.pi/agents` and `.pi/chains` presence/required fields).
- [x] 3.2 GREEN: Create `.pi/agents/sdd-{explore,proposal,spec,design,tasks,apply,verify,archive}.md` with phase scope, tool allowlists, and no nested subagent delegation rule.
- [x] 3.3 GREEN: Create `.pi/chains/sdd-full.chain.md`, `.pi/chains/sdd-plan.chain.md`, `.pi/chains/sdd-verify.chain.md` using documented `pi-subagents` saved chain syntax with YAML frontmatter, `## agent-name` sections, step config lines, and parent-controlled fork/background semantics.
- [x] 3.4 GREEN: Update `.pi/settings.json` with install/config notes for `pi-subagents`, optional `pi-intercom` and `pi-mcp-adapter`, and memory packages as evaluated non-default.
- [x] 3.5 REFACTOR: Normalize agent/chain naming and shared wording to minimize maintenance drift.

## Phase 4: Regression, Docs, and Verification

- [x] 4.1 RED: Add principle-based persona regressions (Spanish voseo/direct tone, no exact-phrase coupling, no false Engram claims) in `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` using faux provider/harness.
- [x] 4.2 GREEN: Update `GENTLE_PI_HARNESSES.md` with identity-memory behavior, degraded mode semantics, and native subagent execution contract.
- [x] 4.3 REFACTOR: Tighten test fixtures/messages for readability without changing behavioral coverage.
- [x] 4.4 VERIFY: Run `npm --prefix packages/coding-agent run test` and `npm run check`; fix all failures before phase close.

## Runtime Failure Follow-up

- [x] 5.1 RED: Add package-manager regression for already-installed user-prefix packages when npm global root points at a read-only Nix store.
- [x] 5.2 GREEN: Install user-scoped npm packages into Pi's writable agent package store and resolve existing `$NPM_CONFIG_PREFIX`/`~/.npm-global` packages before attempting install.
- [x] 5.3 RED: Add prompt regression that normal Gentle Pi runs use Gentle Pi as the primary identity instead of the generic assistant intro.
- [x] 5.4 GREEN: Strengthen the identity/memory prompt and rebuild `packages/coding-agent/dist`.
- [x] 5.5 VERIFY: Re-run focused identity/package tests, focused Gentle Pi regressions, full coding-agent suite, `npm run check`, and `npm run build`.
