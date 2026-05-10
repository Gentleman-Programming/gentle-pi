# Tasks: Gentle Pi Agent

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1200-1700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation + policy + unit tests → PR 2 orchestration + routing + integration tests → PR 3 safety/rollback + docs + check gate |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add Gentle Pi core contracts/store and default-on profile wiring | PR 1 | Includes RED/GREEN/REFACTOR unit tests for context + standards injection |
| 2 | Add orchestrator DAG isolation, envelopes, and model routing | PR 2 | Includes RED/GREEN/REFACTOR integration harness coverage |
| 3 | Add command policy, checkpoints, delivery notes, and final docs/gates | PR 3 | Includes RED/GREEN/REFACTOR safety + rollback regressions and final `npm run check` |

## Phase 1: Foundation & Context Harness

- [x] 1.1 RED: Add failing tests for OpenSpec init/continuity and missing-config blocker in `packages/coding-agent/test/suite/regressions/gentle-pi-agent-context.test.ts`.
- [x] 1.2 GREEN: Create `src/core/gentle-pi/types.ts` and `src/core/gentle-pi/openspec-store.ts` with path resolution, artifact read-before-write, and blocker envelope reasons.
- [x] 1.3 REFACTOR: Create `src/core/gentle-pi/project-standards.ts`; normalize compact standards injection contract and remove duplication from session setup.
- [x] 1.4 GREEN: Wire default-on Gentle Pi profile in `src/main.ts` and `src/core/agent-session-services.ts` for this private fork unless explicitly disabled.

## Phase 2: Process Harness & Model Routing

- [x] 2.1 RED: Add failing DAG/order/envelope/progress tests in `packages/coding-agent/test/suite/regressions/gentle-pi-agent-process.test.ts`.
- [x] 2.2 GREEN: Create `src/core/gentle-pi/orchestrator.ts` for phase dependency checks, isolated phase bundles, apply-progress emission, and envelope validation.
- [x] 2.3 RED: Add failing routing-policy tests in `packages/coding-agent/test/suite/regressions/gentle-pi-agent-routing.test.ts`.
- [x] 2.4 GREEN: Create `src/core/gentle-pi/model-routing.ts` and update `src/core/model-*` wiring for deterministic per-phase routes and blocked missing-policy behavior.
- [x] 2.5 REFACTOR: Update `src/core/system-prompt.ts` and runtime composition to inject standards only for Gentle phases and keep non-Gentle flows unchanged.

## Phase 3: Safety Harness, Delivery Guard, and Strict TDD Evidence

- [x] 3.1 RED: Add failing safety/rollback tests in `packages/coding-agent/test/suite/regressions/gentle-pi-agent-safety.test.ts` for allow/deny/confirm and pre-mutation checkpoints.
- [x] 3.2 GREEN: Create `src/core/gentle-pi/security-policy.ts` and `src/core/gentle-pi/backup.ts`; enforce destructive command gates and checkpoint metadata.
- [x] 3.3 GREEN: Update `src/core/tools/bash.ts` and `src/core/agent-session.ts` to honor pre-exec policy hooks and checkpoint hooks without inlining orchestration logic.
- [x] 3.4 REFACTOR: Add delivery exception notes + rollback boundaries into apply/verify outputs, preserving `exception-ok` semantics with explicit risk statements.
- [x] 3.5 VERIFY: Run `npm --prefix packages/coding-agent run test` for RED→GREEN proof artifacts, then run `npm run check` and fix all findings.

## Phase 4: Artifact and Documentation Alignment

- [x] 4.1 Update OpenSpec task execution marks and ensure result envelope fields map to spec scenarios across context/process/quality/delivery/safety/routing.
- [x] 4.2 Add/update coding-agent docs/comments that explain Gentle Pi default-on profile behavior, policy boundaries, and rollback workflow.

## Phase 5: Final Verify Runtime Gap Fixes

- [x] 5.1 RED/GREEN: Wire phase-aware model routing into production initial model resolution and runtime service configuration.
- [x] 5.2 RED/GREEN: Add a runtime-visible delivery guard for high-risk apply without an explicit strategy decision.
- [x] 5.3 RED/GREEN: Wire rollback checkpoint hooks before mutating bash runtime execution.

## Phase 6: Integrated Runtime Coverage Warning Fix

- [x] 6.1 RED/GREEN/TRIANGULATE: Add integrated Gentle Pi runtime-flow coverage for default-on services, standards injection, phase route thinking, and direct bash policy/checkpoint behavior using the local faux-provider harness.

## Phase 7: Round 1 Judgment Day Fixes

- [x] 7.1 RED/GREEN/TRIANGULATE: Block active Gentle Pi phase runtime when OpenSpec config or standards are missing/invalid, while preserving non-phase diagnostics.
- [x] 7.2 RED/GREEN/TRIANGULATE: Harden command policy against argument, shell separator, environment-prefix, and shell-wrapper bypasses without broad data-string false positives.
- [x] 7.3 RED/GREEN: Stop checkpoint creation from defaulting missing phases to `apply`; keep global deny/confirm safety for non-phase sessions.
- [x] 7.4 GREEN: Restore browser smoke coverage to inspect a current web-ui source bundle plus dist artifacts.
- [x] 7.5 GREEN: Revert unrelated `package-lock.json` churn; no lockfile changes remain.

## Phase 8: Round 2 Judgment Day Fixes

- [x] 8.1 RED/GREEN/TRIANGULATE: Harden command policy normalization for npm global options, shell `&` separators, and git global/path-separator destructive variants.
- [x] 8.2 RED/GREEN: Block active Gentle Pi phase runtime when OpenSpec config is YAML-valid but standards-incomplete, including missing registry compact rules.
- [x] 8.3 VERIFY: Run focused Gentle Pi regressions, root `npm run check`, and relevant coding-agent suite evidence.

## Phase 9: Round 3 Judgment Day Fixes

- [x] 9.1 RED/GREEN/TRIANGULATE: Harden destructive git normalization for `reset --hard=...`, `clean --force`/`-fd` option variants, and checkout current-tree path separator variants.
- [x] 9.2 VERIFY: Run focused safety regression, focused Gentle Pi regressions, and root `npm run check`.

## Phase 10: Final Judgment Day Findings

- [x] 10.1 GREEN: Revert unrelated AI generated/model/test churn from the Gentle Pi diff while preserving the intended Gentle Pi runtime changes.
- [x] 10.2 GREEN: Guard local Ollama stream tests at collection time when `gpt-oss:20b` cannot be listed or pulled, so setup cannot leave `llm` undefined.
- [x] 10.3 GREEN: Add top-level Pi runtime package entries for `pi-subagents`, `pi-intercom`, and `pi-mcp-adapter` while preserving Gentle Pi metadata.
- [x] 10.4 GREEN: Exclude local `auth.json` through `.git/info/exclude` without reading or committing secrets.
- [x] 10.5 VERIFY: Run focused Ollama AI test selection, focused Gentle Pi regressions, and root `npm run check`.
