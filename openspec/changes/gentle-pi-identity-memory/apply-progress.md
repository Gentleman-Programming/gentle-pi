# Apply Progress: Gentle Pi Identity Memory

## Status

- Change: `gentle-pi-identity-memory`
- Mode: Strict TDD
- Delivery: `size:exception` accepted by maintainer
- Completed: 25/25 tasks
- Follow-up: fixed SDD verify failure by converting `.pi/chains/*.chain.md` from direct slash-command prose to documented `pi-subagents` saved chain syntax.
- Runtime follow-up: fixed package auto-install crash against read-only npm global roots, strengthened Gentle Pi as the primary runtime identity, and rebuilt `packages/coding-agent/dist`.

## Completed Tasks

- [x] 1.1 RED memory capability tests
- [x] 1.2 typed identity/memory/package contracts
- [x] 1.3 Engram detector and prompt renderer
- [x] 1.4 detector helper refactor
- [x] 2.1 RED system prompt assertions
- [x] 2.2 session service creation of identity/memory services
- [x] 2.3 active-tool recomputation in AgentSession
- [x] 2.4 prompt composition for default/custom prompts
- [x] 2.5 prompt-assembly refactor through shared append parts
- [x] 3.1 RED `.pi` asset shape checks
- [x] 3.2 SDD phase agent definitions
- [x] 3.3 SDD chain definitions
- [x] 3.4 `.pi/settings.json` package notes
- [x] 3.5 normalized agent/chain wording
- [x] 4.1 persona and false-claim regressions
- [x] 4.2 harness docs update
- [x] 4.3 fixture/readability refactor
- [x] 4.4 verification commands
- [x] 5.1 RED package-manager regression for user-prefix packages with read-only npm global root
- [x] 5.2 writable user npm package store and user-prefix resolution
- [x] 5.3 RED primary Gentle Pi identity prompt regression
- [x] 5.4 strengthened identity/memory prompt and rebuilt dist runtime
- [x] 5.5 verification commands for package install, identity, full suite, check, and build

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | N/A (new behavior) | ✅ Failed on missing `identity-memory.js` | ✅ 8/8 focused passed | ✅ available/configured/unavailable/unknown + config-file signal | ✅ Evidence normalization kept deterministic |
| 1.2 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | ✅ existing Gentle Pi baselines 12/12 | ✅ Tests imported missing contracts through service API | ✅ Types added in `gentle-pi/types.ts` | ✅ Package recommendation/profile contracts exercised by prompt and settings assertions | ✅ Const-object status/fallback contracts |
| 1.3 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | ✅ existing Gentle Pi baselines 12/12 | ✅ Detector/prompt tests failed before implementation | ✅ Detector and renderer passed focused tests | ✅ Callable tool, configured signal, unavailable, unknown, and config file paths | ✅ Extracted helpers for tool matching/config evidence |
| 1.4 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Unit | ✅ focused identity tests passing | ✅ Existing assertions guarded behavior | ✅ Focused tests stayed green | ✅ Order/evidence and phrasing covered distinct paths | ✅ Removed misleading prohibited phrasing |
| 2.1 | `packages/coding-agent/test/system-prompt.test.ts` | Unit | ✅ system prompt baseline 7/7 | ✅ 2 prompt tests failed before option support | ✅ system prompt 9/9 passed | ✅ default and custom prompt paths | ✅ Shared append part path |
| 2.2 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Integration | ✅ Gentle Pi context/runtime baselines 12/12 | ✅ Normal runtime/service assertions failed before wiring | ✅ services create identity/memory when enabled | ✅ enabled and disabled service paths | ✅ Non-fatal config signal detector |
| 2.3 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Integration | ✅ focused baselines passing | ✅ normal interactive session lacked identity prompt | ✅ AgentSession prompt includes identity without `PI_GENTLE_PI_PHASE` | ✅ unavailable active-tool path and disabled non-Gentle path | ✅ Render delegated to identity service |
| 2.4 | `packages/coding-agent/test/system-prompt.test.ts` | Unit | ✅ system prompt baseline 7/7 | ✅ identity prompt absent in default/custom prompts | ✅ identity prompt inserted before project context | ✅ default and custom prompt branches | ✅ One append array handles identity, append prompt, and phase standards |
| 2.5 | `packages/coding-agent/test/system-prompt.test.ts` | Unit | ✅ system prompt 9/9 | ✅ Regression assertions guarded order | ✅ system prompt 9/9 after refactor | ✅ context-before-skills and custom prompt coverage | ✅ No duplicated identity append logic |
| 3.1 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Config | N/A (new assets) | ✅ `.pi` files missing before creation | ✅ asset shape assertions passed | ✅ agents and chains validated separately | ✅ Shared naming `sdd-*` |
| 3.2 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Config | N/A (new assets) | ✅ agent presence checks failed before files | ✅ eight phase agents created | ✅ all phases checked for tools/context/no child delegation | ✅ Common concise wording |
| 3.3 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Config | N/A (new assets) | ✅ chain checks failed before files | ✅ three chain files created | ✅ saved chain frontmatter, step names, outputs, reads, and progress covered | ✅ Normalized chain names |
| 3.4 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Config | N/A (new asset) | ✅ config-signal assertion failed before settings | ✅ settings file created with Engram package notes | ✅ installed vs optional package paths | ✅ Memory extensions kept non-default |
| 3.5 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Config | ✅ asset tests passing | ✅ shape assertions guarded drift | ✅ focused tests stayed green | ✅ all agent/chain files rechecked | ✅ Shared phase wording tightened |
| 4.1 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Regression | ✅ Gentle Pi focused regressions 38/38 | ✅ persona/self-description assertions failed before prompt renderer | ✅ identity memory focused tests passed | ✅ Spanish/Rioplatense, concise/direct, no false Engram claims | ✅ Principle assertions avoid exact response prose |
| 4.2 | `GENTLE_PI_HARNESSES.md` + regression tests | Docs | ✅ docs read before edit | ✅ doc behavior covered by implementation tests first | ✅ docs updated after green implementation | ✅ available/configured/unavailable/unknown semantics documented | ✅ Package notes match runtime defaults |
| 4.3 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Regression | ✅ focused tests passing | ✅ existing assertions protected behavior | ✅ focused tests stayed green after cleanup | ✅ env restoration and project-root fixture | ✅ Formatted by `npm run check` |
| 4.4 | Full suite/check | Verification | ✅ focused regressions 38/38 | ✅ Verification task required command evidence | ✅ full coding-agent suite and check passed | ✅ focused re-run after check 17/17 | ✅ No further code changes after final focused run |
| verify-fix | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Config | ✅ 8/8 baseline passed before edit | ✅ Saved-chain syntax assertions failed on `/chain`/`/run` files | ✅ 8/8 focused identity-memory tests passed | ✅ Three chain files cover full, plan, and verify workflows with expected `## sdd-*` steps | ✅ `npm run check` formatted test file and passed |
| 5.1 | `packages/coding-agent/test/package-manager.test.ts` | Unit | ✅ package-manager baseline covered install/update behavior | ✅ New read-only-root/user-prefix test failed because startup attempted `npm install -g pi-subagents@0.24.0` | ✅ package-manager 100/100 passed | ✅ Existing user install/update tests updated to writable prefix behavior | ✅ Install-path helpers kept package discovery focused |
| 5.2 | `packages/coding-agent/test/package-manager.test.ts` | Unit | ✅ package-manager tests passing | ✅ Existing `-g` expectation failed until implementation changed | ✅ User packages install/update with `--prefix <agentDir>/npm` and resolve `$NPM_CONFIG_PREFIX`/`~/.npm-global` first | ✅ Existing npmCommand, update, and package resource discovery paths covered | ✅ Preserved non-npm/git/local behavior |
| 5.3 | `packages/coding-agent/test/system-prompt.test.ts` | Unit | ✅ system-prompt baseline passing | ✅ Primary identity assertion failed on generic assistant intro | ✅ system-prompt 10/10 passed | ✅ Gentle and non-Gentle intro paths covered separately | ✅ Conditional intro keeps non-Gentle default unchanged |
| 5.4 | `packages/coding-agent/test/suite/regressions/gentle-pi-identity-memory.test.ts` | Regression | ✅ identity-memory baseline passing | ✅ Prompt-strength assertions failed before renderer update | ✅ identity-memory 8/8 passed | ✅ Self-description, senior architect, Rioplatense, and Engram-first prompt language checked | ✅ Rebuilt dist contains strengthened prompt text |
| 5.5 | Full suite/check/build | Verification | ✅ focused tests passing | ✅ Verification task required command evidence | ✅ full coding-agent suite, check, and build passed | ✅ dist inspection confirmed Gentle Pi prompt in built files | ✅ no commits made |

## Test Summary

- Total tests written/updated: 13 assertion groups across 3 test files; focused identity file has 8 tests and package-manager has 100 tests.
- Total tests passing: 1,209 coding-agent tests passed; 44 skipped.
- Layers used: Unit, integration/session, config-shape regression.
- Approval tests: Existing Gentle Pi baselines used as safety net; no pure refactor-only task.
- Pure functions created: detector, config-signal detector, identity prompt renderer, package/profile constants.
- Follow-up coverage: identity-memory regression now rejects direct `/run`, `/chain`, and `/parallel` command lines in saved `.chain.md` files and parses `## sdd-*` saved-chain steps.

## Commands Run

- `npm --prefix packages/coding-agent run test -- test/system-prompt.test.ts` → 7/7 baseline passed.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts` → 12/12 baseline passed.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` → RED failed on missing implementation.
- `npm --prefix packages/coding-agent run test -- test/system-prompt.test.ts` → RED failed on missing prompt option.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts test/system-prompt.test.ts` → 17/17 passed.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` → 38/38 passed.
- `npm --prefix packages/coding-agent run test` → 119 files passed, 6 skipped; 1,207 tests passed, 44 skipped.
- `npm run check` → passed; Biome fixed 1 file.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts test/system-prompt.test.ts` → 17/17 passed after check.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` → baseline 8/8 passed before verify-fix edits.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` → RED failed on invalid saved chain syntax (`/chain`/`/run`).
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` → GREEN 8/8 passed after rewriting saved chains.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` → 38/38 passed.
- `npm run check` → passed; Biome fixed 1 file.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` → 8/8 passed after check.
- `npm run check` → passed; no fixes applied after OpenSpec report updates.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-identity-memory.test.ts` → final 8/8 passed.
- `npm --prefix packages/coding-agent run test -- test/package-manager.test.ts` → RED failed on global `npm install -g` behavior and user-prefix detection.
- `npm --prefix packages/coding-agent run test -- test/package-manager.test.ts` → GREEN 100/100 passed after writable user npm prefix fix.
- `npm --prefix packages/coding-agent run test -- test/system-prompt.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` → RED failed on generic primary intro and missing strengthened identity language.
- `npm --prefix packages/coding-agent run test -- test/system-prompt.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts` → GREEN 18/18 passed after prompt strengthening.
- `npm --prefix packages/coding-agent run test -- test/suite/regressions/gentle-pi-agent-context.test.ts test/suite/regressions/gentle-pi-agent-runtime-flow.test.ts test/suite/regressions/gentle-pi-agent-safety.test.ts test/suite/regressions/gentle-pi-agent-routing.test.ts test/suite/regressions/gentle-pi-agent-process.test.ts test/suite/regressions/gentle-pi-identity-memory.test.ts test/package-manager.test.ts test/system-prompt.test.ts` → 8 files, 148 tests passed.
- `npm --prefix packages/coding-agent run test` → 119 files passed, 6 skipped; 1,209 tests passed, 44 skipped.
- `npm run check` → passed; Biome fixed 1 file.
- `npm run check` → passed; no fixes applied.
- `npm run build` → passed; rebuilt coding-agent dist and dependent packages.
- `node packages/coding-agent/dist/cli.js --help` → passed; built CLI starts without package-install crash on help path.

## Deviations

Runtime package behavior intentionally changed for user-scoped npm packages: Pi now installs them into its writable agent package store instead of invoking `npm install -g` against the ambient global prefix. Existing packages under `$NPM_CONFIG_PREFIX` or `~/.npm-global` are still resolved before install.

## Issues

None.
