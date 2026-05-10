# Verification Report: gentle-pi-identity-memory

## Change

- Change: `gentle-pi-identity-memory`
- Project: `gentle-pi`
- Mode: `openspec`
- Strict TDD: active
- Verdict: **PASS**

## Completeness

| Area | Result | Evidence |
|---|---:|---|
| Tasks complete | ✅ | `tasks.md` and `apply-progress.md` mark 25/25 tasks complete. |
| Artifacts read | ✅ | Read proposal, exploration, spec, design, tasks, apply-progress, implementation, tests, `.pi` assets, docs. |
| Runtime identity in normal interactive runs | ✅ | `AgentSession._rebuildSystemPrompt()` renders `gentlePiIdentityPrompt` regardless of `PI_GENTLE_PI_PHASE`; focused regression passes. |
| Primary Gentle Pi identity in dist runtime | ✅ | `buildSystemPrompt()` now starts with Gentle Pi when the identity prompt is present, and `packages/coding-agent/dist` was rebuilt. |
| Package startup on read-only npm globals | ✅ | User-scoped npm packages install/update under the writable agent package store and resolve existing `$NPM_CONFIG_PREFIX`/`~/.npm-global` packages before install. |
| Engram status detection | ✅ | `detectGentlePiMemoryCapability()` distinguishes `available`, `configured`, `unavailable`, and `unknown`. |
| Memory protocol gating | ✅ | Prompt instructs Engram save/search only for `available`; degraded language for configured/unavailable/unknown. |
| Native SDD agents/chains | ✅ | `.pi/agents` exist and `.pi/chains/*.chain.md` now use documented saved chain-file syntax: YAML frontmatter plus `## agent-name` step sections with config lines before task text. |
| Package notes alignment | ⚠️ | Notes match package roles, but `.pi/settings.json` does not use Pi package settings shape for installed project packages. |

## Command Evidence

| Command | Result |
|---|---|
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ 1 file, 8 tests passed |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ 6 files, 38 tests passed |
| `npm --prefix packages/coding-agent run test` | ✅ 119 files passed, 6 skipped; 1,207 tests passed, 44 skipped |
| `npm run check` | ✅ Biome/tsgo/browser smoke/web-ui checks passed; no fixes applied |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Follow-up verification: 1 file, 8 tests passed after saved-chain syntax fix |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Follow-up verification: 6 files, 38 tests passed |
| `npm run check` | ✅ Follow-up verification: Biome/tsgo/browser smoke/web-ui checks passed; Biome fixed 1 file |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Follow-up final focused run: 1 file, 8 tests passed |
| `npm run check` | ✅ Final verification after report updates: Biome/tsgo/browser smoke/web-ui checks passed; no fixes applied |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Final focused run after check: 1 file, 8 tests passed |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Re-run after chain syntax fix: 1 file, 8 tests passed |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Re-run after chain syntax fix: 6 files, 38 tests passed |
| `npm run check` | ✅ Re-run after chain syntax fix: Biome/tsgo/browser smoke/web-ui checks passed; no fixes applied |
| `npm --prefix packages/coding-agent run test` | ⚠️ First re-run: 1 transient failure in `test/footer-data-provider.test.ts`; 1,206 passed, 44 skipped |
| `npm --prefix packages/coding-agent run test -- test/footer-data-provider.test.ts` | ✅ Transient failure isolated: 1 file, 8 tests passed on direct re-run |
| `npm --prefix packages/coding-agent run test` | ✅ Final full suite re-run: 119 files passed, 6 skipped; 1,207 tests passed, 44 skipped |
| `npm --prefix packages/coding-agent run test -- test/package-manager.test.ts` | ✅ Runtime package regression: 1 file, 100 tests passed |
| `npm --prefix packages/coding-agent run test -- test/system-prompt.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` | ✅ Runtime identity regression: 2 files, 18 tests passed |
| `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts test/package-manager.test.ts test/system-prompt.test.ts` | ✅ Focused Gentle Pi/package regressions: 8 files, 148 tests passed |
| `npm --prefix packages/coding-agent run test` | ✅ Runtime follow-up full suite: 119 files passed, 6 skipped; 1,209 tests passed, 44 skipped |
| `npm run check` | ✅ Runtime follow-up final check passed; second re-run had no fixes applied |
| `npm run build` | ✅ Dist rebuilt after source changes |
| `node packages/coding-agent/dist/cli.js --help` | ✅ Built CLI help starts successfully without package-install crash on help path |

## TDD Compliance

| Check | Result | Details |
|---|---:|---|
| TDD Evidence reported | ✅ | `apply-progress.md` contains a TDD Cycle Evidence table. |
| All tasks have tests/evidence | ✅ | 25/25 rows list test files or verification/doc evidence. |
| RED confirmed | ✅ | Referenced test files exist and focused tests pass now. Historical RED failures cannot be re-executed without changing code. |
| GREEN confirmed | ✅ | Focused identity-memory, focused Gentle Pi regressions, final full coding-agent suite re-run, and check all pass. |
| Triangulation adequate | ✅ | Detector states, prompt paths, and saved `.pi/chains` syntax are triangulated; full/plan/verify chain files are parsed for expected `## sdd-*` step sequences and direct slash-command lines are rejected. |
| Safety net for modified files | ✅ | Existing Gentle Pi and system-prompt baselines ran per apply-progress and passed during verify. |

**TDD Compliance**: 6/6 checks passed.

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---:|---:|---|
| Unit | 16 | 3 | Vitest |
| Integration/session | 2 | 1 | Vitest + faux harness |
| Config shape | 2 | 1 | Vitest static file checks |
| E2E | 0 | 0 | Not used |
| **Total focused** | **18 plus package-manager coverage** | **3** | |

## Changed File Coverage

Coverage analysis skipped — no cached SDD testing-capabilities artifact or configured coverage command was found during verification.

## Assertion Quality

| File | Line | Assertion | Issue | Severity |
|---|---:|---|---|---|
| `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | 177-206 | chain checks parse saved-chain steps and reject direct `/run`, `/chain`, and `/parallel` command lines | Follow-up fix covers the previous assertion gap and validates documented saved chain syntax. | PASS |

**Assertion quality**: 0 CRITICAL, 0 WARNING.

## Spec Compliance Matrix

| Requirement / Scenario | Status | Evidence |
|---|---:|---|
| Truthful identity and self-description / accurate runtime context | ✅ PASS | Identity prompt states Gentle Pi, Pi-specific coding-agent harness, SDD/OpenSpec, subagents, and runtime-detected memory bounds. Tests pass. |
| Runtime startup package install safety | ✅ PASS | User-scoped npm package installs no longer use ambient `npm install -g`; read-only Nix global roots do not receive writes. |
| Persona and style / Spanish style behavior | ✅ PASS | Persona prompt includes direct concise tone and Rioplatense voseo; regression asserts principle-based prompt behavior. |
| Persona and style / principle-based verification | ✅ PASS | Tests avoid exact assistant response phrase coupling. |
| No false Engram claims / available path | ✅ PASS | Callable Engram tools produce `available` with evidence and Engram save/search instructions. |
| No false Engram claims / unknown or unavailable path | ✅ PASS | Unknown/unavailable produce degraded language and no available-persistence claim. |
| Engram-first with safe fallback / degraded mode | ✅ PASS | Configured/unavailable/unknown states tell the model not to claim usable persistent memory and use session/OpenSpec fallback. |
| Native SDD subagent orchestration / project-local assets exist | ✅ PASS | Eight `.pi/agents/sdd-*.md` files and three `.pi/chains/*.chain.md` files exist. |
| Native SDD subagent orchestration / native phase execution path | ✅ PASS | `.pi/chains/*.chain.md` use frontmatter plus `## sdd-*` step sections with immediate config lines and task text. Regression tests reject direct slash-command chain format. |
| Supervisor intercom and capability decision path / intercom useful | ✅ PASS | Package notes and prompt recommend `pi-intercom` only for supervisor decisions/progress and keep it optional. |
| Supervisor intercom and capability decision path / memory guardrail | ✅ PASS | Engram remains primary; Pi memory extensions are non-default references only. |
| Pi-specific quality gates / faux-provider regression enforcement | ✅ PASS | Focused regression suite uses coding-agent Vitest/faux harness and passed. |

## Correctness Table

| Verification target | Result | Notes |
|---|---:|---|
| Normal interactive runs get Gentle Pi identity/persona | ✅ | `gentlePiIdentityPrompt` is not phase-gated; only `gentlePiPhaseStandards` is phase-gated. |
| Normal interactive prompt starts from Gentle Pi identity | ✅ | The default prompt intro switches to Gentle Pi when `gentlePiIdentityPrompt` is present, avoiding the generic assistant primary identity. |
| Runtime package auto-install avoids read-only global prefix | ✅ | User packages install to `<agentDir>/npm`; existing `$NPM_CONFIG_PREFIX`/`~/.npm-global` installs are resolved first. |
| Self-description mentions harnesses/subagents/OpenSpec/memory truthfully | ✅ | Identity prompt does so with runtime-detection caveat. |
| Engram detection supports available/configured/unavailable/unknown | ✅ | Direct source inspection and tests confirm all states. |
| Memory protocol conditional on capability | ✅ | Save/recall instructions only appear in `available`. |
| `.pi/agents` map phases to project agents | ✅ | All phase agents have frontmatter, allowlisted tools, `inheritProjectContext: true`, and no nested subagent delegation instruction. |
| `.pi/chains` map phases to native saved chain patterns | ✅ | Chain files now follow documented saved chain-file syntax and preserve full, planning, apply/verify/archive workflows. |
| Installed package notes align with package docs | ⚠️ | Roles and versions align with npm metadata, but `.pi/settings.json` uses custom `gentlePi.packages.installed` metadata rather than Pi's documented top-level `packages` install list. |

## Design Coherence

| Design decision | Status | Notes |
|---|---:|---|
| Typed identity service instead of prompt-only edit | ✅ | Implemented in `identity-memory.ts` and typed in `types.ts`. |
| Runtime memory detection with four statuses | ✅ | Implemented and tested. |
| Prompt assembly before project context/skills | ✅ | `buildSystemPrompt()` appends identity before project context and skills. |
| Native subagents using `.pi/agents` and `.pi/chains` | ✅ | Agent files align; chain files now use native saved chain syntax per `pi-subagents` docs. |
| Optional intercom/MCP companions | ✅ | Reflected in prompt/docs/settings as optional companions, not memory replacements. |

## Issues

### CRITICAL

None.

### WARNING

1. **Package “installed” notes remain metadata, not Pi package install configuration.**
   - File: `.pi/settings.json`
   - Evidence: `packages/coding-agent/docs/packages.md` documents project packages under top-level `packages`; current file stores custom metadata under `gentlePi.packages.installed`.
   - Impact: The notes are useful documentation/config signal, but they do not cause Pi to install/load `pi-subagents`, `pi-intercom`, or `pi-mcp-adapter` as project packages. This is now safer because top-level user package installs no longer write to read-only global npm roots.

### SUGGESTION

- Consider converting `.pi/settings.json` package notes into Pi's documented top-level package install shape in a separate follow-up if runtime package auto-install is required.

## Final Verdict

**PASS WITH WARNINGS** — runtime follow-up passes package-manager regressions, focused identity-memory tests, focused Gentle Pi regressions, final full coding-agent suite, `npm run check`, and `npm run build`. Built dist now contains the Gentle Pi identity prompt. Remaining warning: `.pi/settings.json` package notes are documentation/config-signal metadata, not Pi's runtime auto-install package shape.
