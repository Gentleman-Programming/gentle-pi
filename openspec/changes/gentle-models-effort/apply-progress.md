# Apply Progress: gentle-models-effort

Date: 2026-05-14

## Scope implemented

- `extensions/gentle-ai.ts`
  - Added routing config entry type `{ model?, thinking? }`.
  - Added backward-compatible parser for legacy string config.
  - Persisted config as object entries only when non-empty.
  - Applied both `model` and `thinking` to:
    - project/user agent frontmatter (`model:`, `thinking:`),
    - builtin agents via `.pi/settings.json` overrides.
  - Extended `/gentle:models` modal:
    - row labels now show model + effort,
    - `e` opens effort picker,
    - `i` resets both model and effort to inherit,
    - custom model flow preserves existing `thinking`.
- `tests/runtime-harness.mjs`
  - Added RED/GREEN harness scenario for `/gentle:models` save flow.
  - Added legacy string-config startup application assertion (TRIANGULATE).
  - Added builtin worker fixture under temp `pi-subagents` path to validate settings overrides.
- `README.md`
  - Updated `/gentle:models` docs to model + effort assignment.
  - Added config object example and legacy compatibility note.

## TDD evidence

### RED

Command:

```bash
pnpm test
```

Failure observed before implementation (from harness assertion):

```text
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /model: openai\/gpt-5/
...
'model: [object Object]'
```

This proved model-only code path could not handle object config with effort.

### GREEN

Command:

```bash
pnpm test
```

Result after implementation:

- unit tests passed,
- runtime harness passed.

### TRIANGULATE

Extended harness to assert legacy string config still applies on startup:

- preloaded `.pi/gentle-ai/models.json` with `{ "sdd-apply": "openai/gpt-5" }`,
- ran gentle-ai `session_start` hook,
- asserted `model: openai/gpt-5` is applied and `thinking:` is absent.

Re-ran `pnpm test` successfully.

### REFACTOR

- Consolidated config parsing via `normalizeRoutingEntry`.
- Replaced model-only frontmatter updater with routing-aware updater.
- Kept existing command/API names to minimize integration churn.

## Verify blocker fix: custom model preserves unsaved effort

Problem found during SDD verify:

- Choosing a custom model returned only `{ type: "custom", agent }` from `SddModelPanel`.
- `handleModelsCommand` then updated the outer saved/read config instead of the panel's current unsaved draft.
- Effort selections made in the modal before choosing the custom model could be dropped.

Fix implemented:

- Custom model results now include the current draft config: `{ type: "custom", agent, config }`.
- `handleModelsCommand` clones `result.config` before applying the custom model, preserving unsaved `thinking` selections.
- `SddModelPanel` now clones initial config entries to avoid mutating shared entry objects while editing drafts.
- Runtime harness simulates: set all efforts to `medium`, choose custom model before saving, reopen panel, save, and assert `sdd-apply` persists both `model: "custom/provider-model"` and `thinking: "medium"`.

### RED for blocker

Command:

```bash
pnpm test
```

Failure observed after adding focused custom-model preservation coverage and before the fix:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  {
+   model: 'openai/gpt-5',
-   model: 'custom/provider-model',
    thinking: 'high'
  }
```

This proved the custom-model flow was not carrying the in-modal draft forward correctly.

### GREEN for blocker

Command:

```bash
pnpm test
```

Result: unit tests and runtime harness passed.

### Package validation

Command:

```bash
pnpm run prepack
```

Result:

```text
gentle-pi package resource check passed (12 files).
```

## Notes

- Pre-existing dirty state was preserved:
  - `README.md` already modified before this flow,
  - `context.md` already untracked.
- Engram memory tools are unavailable in this runtime (`Engram is unavailable`).
