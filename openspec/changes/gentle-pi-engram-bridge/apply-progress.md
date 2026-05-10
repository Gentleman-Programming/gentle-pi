# Apply Progress: gentle-pi-engram-bridge

## Mode

Strict TDD (`npm --prefix packages/coding-agent run test`). Delivery mode: `size:exception` accepted by launch prompt.

## Completed Tasks

- [x] 1.1 RED config-shape tests for `.mcp.json` and `.pi/mcp.json`, including secret redaction assertions.
- [x] 1.2 GREEN typed Engram bridge config discovery with sanitized evidence.
- [x] 1.3 REFACTOR memory types with `unreachable`, config evidence, and canonical operations.
- [x] 2.1 RED tool alias normalization table for direct, prefixed, dotted, and MCP proxy names.
- [x] 2.2 GREEN tool normalization and required operation checks.
- [x] 2.3 RED state matrix for available/configured/unreachable/unavailable/unknown.
- [x] 2.4 GREEN `deriveEngramBridgeState` policy blocking false `available` claims.
- [x] 2.5 REFACTOR bridge predicates, constants, and deterministic sorting.
- [x] 3.1 RED prompt/regression assertions for truthful degraded wording.
- [x] 3.2 GREEN identity-memory and session-service bridge integration.
- [x] 3.3 REFACTOR removed broad `.pi/settings.json` substring evidence path from runtime config detection.
- [x] 4.1 Full coding-agent test suite run.
- [x] 4.2 `npm run check` quality gate run.
- [x] 4.3 No sample config added; task completed as not needed because runtime behavior is covered without adding config artifacts.
- [x] Judgment Day follow-up: blocked non-Engram suffix tools from creating callable Engram availability and added `server.name: "engram"` metadata config detection.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | 18/18 baseline focused tests passed | Failing import for missing `engram-bridge.ts` | 13/13 bridge regression tests passed | `.mcp.json` command + `.pi/mcp.json` URL fixtures, secret assertions | Sanitized evidence only |
| 1.2 | `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Unit | N/A (new file) | Config tests failed until module existed | 13/13 bridge regression tests passed | Project MCP and Pi MCP shapes | Extracted JSON/type guards |
| 1.3 | `packages/coding-agent/src/core/gentle-pi/types.ts` | Type/unit | 18/18 baseline focused tests passed | State assertions required `unreachable` | 13/13 bridge regression tests passed | Capability now carries evidence + operations | Const-object status extension |
| 2.1 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | 18/18 baseline focused tests passed | Alias table failed before normalizer | 13/13 bridge regression tests passed | Direct, `engram_`, `engram.`, `mcp__engram__`, `mcp_engram_` | Table-driven assertions |
| 2.2 | `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Unit | N/A (new logic) | Alias table required missing operations | 13/13 bridge regression tests passed | Required ops vs missing get-observation | Shared prefix stripping |
| 2.3 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | 18/18 baseline focused tests passed | State matrix failed before derivation policy | 13/13 bridge regression tests passed | Configured, unreachable, unavailable, unknown | Matrix kept pure function coverage |
| 2.4 | `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Unit | N/A (new logic) | Available/missing-required assertions failed | 13/13 bridge regression tests passed | Required operations present vs absent | Deterministic operation sorting |
| 2.5 | `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Unit | N/A (new file) | Covered by previous RED cases | 13/13 bridge regression tests passed | Duplicate evidence/tool paths covered by unique sorting | Extracted predicates/constants |
| 3.1 | `packages/coding-agent/test/system-prompt.test.ts`, regression suite | Integration/unit | 18/18 baseline focused tests passed | Prompt assertions added for degraded configured/unreachable wording | 25/25 focused identity + prompt tests passed | Configured and unreachable prompt cases | Kept assertions user-visible, not implementation-detail based |
| 3.2 | `packages/coding-agent/src/core/gentle-pi/identity-memory.ts`, `packages/coding-agent/src/core/agent-session-services.ts` | Integration | 18/18 baseline focused tests passed | Regression prompt/state tests required bridge evidence | 25/25 focused identity + prompt tests passed | Active tools + config evidence combinations | Identity delegates bridge logic |
| 3.3 | Session service config detection | Integration | 18/18 baseline focused tests passed | Regression asserts `.pi/settings.json` is not broad evidence | 13/13 bridge regression tests passed | Structured MCP evidence only | Removed substring scan path |
| 4.1 | Full suite | Integration | Focused tests green | N/A verification task | 119 files / 1216 tests passed, 6 files / 44 skipped | Focused + full suite | None |
| 4.2 | Quality gate | Static | Focused/full tests green | N/A verification task | `npm run check` passed | Biome + tsgo + browser/web checks | Biome formatted touched files |
| 4.3 | Config artifact decision | Review/security | N/A | N/A optional task | No sample config added | Secret-safe behavior covered by fixtures | Avoided unnecessary config artifact |
| JD-1 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | 25/25 focused bridge + prompt tests passed | Added failing negative suffix and server-name metadata regressions | 15/15 bridge regression tests passed; 27/27 focused bridge + prompt tests passed | Multiple non-Engram suffix forms plus object metadata config shape | Removed generic suffix matching; kept exact direct and explicit Engram prefixes only |

## Test Summary

- Focused baseline before modifications: `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts test/system-prompt.test.ts` → 18/18 passed.
- RED evidence: focused bridge regression test failed because `engram-bridge.ts` did not exist yet.
- Focused bridge tests: 13/13 passed.
- Focused identity + prompt tests: 25/25 passed.
- Judgment Day focused bridge tests after fix: 15/15 passed.
- Judgment Day focused bridge + prompt tests after fix: 27/27 passed.
- Judgment Day full coding-agent suite reruns: blocked by unrelated `test/footer-data-provider.test.ts` watcher timeouts; bridge regression file passed in both full-suite runs.
- Full coding-agent suite: 119 files / 1216 tests passed, 6 files / 44 skipped.
- Quality gate: `npm run check` passed.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Created | Typed Engram config discovery, tool alias normalization, and state derivation. |
| `packages/coding-agent/src/core/gentle-pi/types.ts` | Modified | Added `unreachable`, bridge evidence, and canonical operation fields. |
| `packages/coding-agent/src/core/gentle-pi/identity-memory.ts` | Modified | Delegates Engram detection to the bridge and renders truthful configured/unreachable/degraded wording. |
| `packages/coding-agent/src/core/agent-session-services.ts` | Modified | Discovers bridge config evidence from approved MCP locations and passes it into Gentle Pi services. |
| `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Modified | Added config, alias, state, and degraded prompt regressions. |
| `packages/coding-agent/test/system-prompt.test.ts` | Modified | Added full-prompt assertions for configured/unreachable degraded memory wording. |
| `openspec/changes/gentle-pi-engram-bridge/tasks.md` | Modified | Marked all apply tasks complete. |
| `openspec/changes/gentle-pi-engram-bridge/apply-progress.md` | Created | Recorded strict TDD evidence and verification results. |
| `packages/coding-agent/src/core/gentle-pi/engram-bridge.ts` | Modified | Judgment Day follow-up: server object `name` metadata now counts as config evidence; arbitrary suffix-only tool names no longer normalize as Engram tools. |
| `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Modified | Added regressions for non-Engram suffix tool names and `name: "engram"` server metadata. |

## Deviations

- No `.pi/mcp.json` sample config was added. The task was optional and no sample was needed to implement or verify runtime behavior.

## Issues Found

- `npm run check` applied Biome formatting changes automatically; the command completed successfully afterward.
