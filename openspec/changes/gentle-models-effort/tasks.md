# Tasks: gentle-models-effort

## Review workload forecast

- Expected touched implementation files: `extensions/gentle-ai.ts`, `tests/runtime-harness.mjs`, `README.md`.
- Expected changed lines: under 400 excluding SDD artifacts.
- Delivery strategy: single PR/work unit is OK. No chained PR needed unless implementation uncovers broader Pi API changes.

## Implementation tasks

### 1. RED: add harness coverage

- Extend `tests/runtime-harness.mjs` fake UI/context so `/gentle:models` can return a saved config.
- Create a temp project agent file and execute the command.
- Assert expected model+thinking config is written/applied.
- Run `pnpm test` and record failing evidence.

Expected evidence:

```text
RED: pnpm test fails because `/gentle:models` cannot yet accept/apply effort config.
```

### 2. Normalize routing config

- Replace `AgentModelConfig` with `AgentRoutingConfig`.
- Add allowed `ThinkingEffort` values.
- Update `readModelConfig` to parse:
  - legacy string entries as `{ model }`;
  - object entries with optional non-empty `model` and valid `thinking`.
- Update `writeModelConfig` to omit empty entries and persist object entries.
- Keep function names if desired for compatibility, but prefer routing names where touched.

### 3. Apply routing to files and settings

- Generalize `updateFrontmatterModel` to update both `model:` and `thinking:`.
- Generalize builtin override writer to set/delete both `model` and `thinking`.
- Update `applyModelConfig` and `describeModelConfig` to handle model+effort.

### 4. Extend the modal draft/UI

- Change `SddModelPanel` draft type to routing config.
- Add effort options: inherit, off, minimal, low, medium, high, xhigh.
- Add `mode: "effort"` and `effortCursor`.
- Add `e` shortcut in agent list to open effort picker for selected agent/all agents.
- Keep `enter` for model picker, `c` for custom model, and make `i` inherit/reset both model and effort.
- Render rows with both model and effort.

### 5. Handle custom model flow

- Update custom model path to change only `entry.model`, preserving existing `entry.thinking`.
- For `all agents`, set model for all agents while preserving existing effort values.
- Reopen the modal with the updated routing config.

### 6. GREEN/TRIANGULATE validation

- Run `pnpm test`.
- If only new-object shape is covered, add/extend a legacy string config test and rerun.
- Record final evidence.

Expected evidence:

```text
GREEN: pnpm test passes after model+effort implementation.
TRIANGULATE: legacy string config remains supported.
```

### 7. Docs update

- Update README `/gentle:models` section to say model and effort assignment.
- Add saved config example with object entries.
- Mention that effort maps to Pi/subagent `thinking` and model-specific support is handled by Pi runtime.

## Acceptance checklist

- [x] Existing string-only config loads without data loss.
- [x] New object config persists model and effort.
- [x] Project/user agent frontmatter gets deterministic `model:` and `thinking:` updates.
- [x] Builtin agents get `.pi/settings.json` overrides for both fields.
- [x] Modal supports per-agent and all-agent effort selection.
- [x] `pnpm test` passes.
- [x] README reflects the new behavior.
