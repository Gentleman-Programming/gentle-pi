status: passed

executive_summary:

- Re-verified `gentle-models-effort` after the custom-model preservation fix.
- The prior BLOCKER is fixed: custom model selection now carries the modal's current draft config forward, preserving unsaved `thinking` effort selections.
- Acceptance criteria from the proposal/spec/tasks remain satisfied by code inspection and runtime harness coverage.
- Required validation commands pass: `pnpm test` and `pnpm run prepack`.

validation_evidence:

- Code inspection: `extensions/gentle-ai.ts`
  - `ModelPanelResult` custom branch includes `config: AgentModelConfig`.
  - `SddModelPanel` clones initial entries with `cloneModelConfig(initialConfig)`.
  - Custom exits from both the agent list shortcut and model picker return `{ type: "custom", agent, config: this.draft }`.
  - `handleModelsCommand` uses `config = cloneModelConfig(result.config)` before applying custom input, then merges only `model`, preserving existing `thinking` values.
- Coverage inspection: `tests/runtime-harness.mjs`
  - Simulates selecting all-agent effort `medium`, choosing a custom model before saving, reopening the panel, saving, and asserting persisted config includes both `model: "custom/provider-model"` and `thinking: "medium"` for `sdd-apply`.
  - Retains legacy string-config startup assertion.
  - Retains model+thinking save/application assertions for project agent frontmatter and builtin `.pi/settings.json` override.
- Command: `pnpm test` — PASS
  - Node test suite: 8 passed.
  - Runtime harness completed successfully.
- Command: `pnpm run prepack` — PASS
  - Re-ran `pnpm test` successfully.
  - Package resource check passed: `gentle-pi package resource check passed (12 files).`

findings_blockers:

- No blockers found.
- Prior BLOCKER resolved: unsaved effort is preserved through the custom-model flow.

acceptance_check:

- Existing string-only config loads without data loss: PASS.
- New object config persists model and effort: PASS.
- Project/user agent frontmatter receives deterministic `model:` and `thinking:` updates: PASS.
- Clearing/inheriting effort removes `thinking:` from frontmatter by code path: PASS.
- Builtin agents receive `.pi/settings.json` model and thinking overrides: PASS.
- Builtin inherited values prune empty override containers by code path: PASS.
- Modal supports per-agent/all-agent effort selection and readable model+effort rows: PASS.
- Custom model path changes model while preserving unsaved effort: PASS.
- README documents model+effort behavior and object config shape: PASS.
- `pnpm test` passes: PASS.

risks:

- No manual Pi TUI smoke test was run; validation relies on runtime harness plus code inspection.
- Review workload remains higher than forecast in raw diff stats because `README.md` contains substantial pre-existing/unrelated documentation drift. Feature-relevant README content is present, but final review should decide whether to include unrelated doc changes.
- Existing non-blocking UI footgun remains: pressing `e` while cursor is on Continue/Back targets all agents due to fallback to `SET_ALL_AGENTS`.
- `updateBuiltinModelOverride` still writes `.pi/settings.json` and increments update counts even when no effective change occurred; functionally safe but can inflate notifications/touch settings.

next_recommended:

- Proceed to archive/merge readiness if the parent accepts the noted review-workload and manual-smoke-test risks.
- Optional before merge: run a manual `/gentle:models` TUI smoke test for `e`, `c`, `i`, and save interactions.
- Review README diff separately to exclude or intentionally accept unrelated documentation changes.

skill_resolution: injected
