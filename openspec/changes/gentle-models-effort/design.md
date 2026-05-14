# Design: `/gentle:models` effort support

## Current flow

- `AgentModelConfig = Record<string, string>` stores agent -> model only.
- `readModelConfig` accepts only string values from `.pi/gentle-ai/models.json`.
- `SddModelPanel` holds a draft map and lets users pick a model or custom model per agent/all agents.
- `applyModelConfig` writes `model:` into project/user agent frontmatter, or `.pi/settings.json` `subagents.agentOverrides.<name>.model` for builtin agents.
- Startup reapplies saved model config after SDD asset installation.

## Proposed data model

Use an internal normalized object shape while accepting legacy strings:

```ts
type ThinkingEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
interface AgentRoutingEntry {
  model?: string;
  thinking?: ThinkingEffort;
}
type AgentRoutingConfig = Record<string, AgentRoutingEntry>;
type RawAgentRoutingConfig = Record<string, string | AgentRoutingEntry>;
```

Persist only non-empty object entries in the new format:

```json
{
  "sdd-design": {
    "model": "anthropic/claude-sonnet-4",
    "thinking": "high"
  },
  "sdd-archive": {
    "model": "openai/gpt-5-mini"
  }
}
```

Legacy string input `{ "sdd-apply": "openai/gpt-5" }` normalizes to `{ "sdd-apply": { "model": "openai/gpt-5" } }` and should be rewritten in object form only after the user saves.

## Effort values

Use Pi/subagent's existing `thinking` field, not `reasoning_effort`, because subagent agent files and overrides already document `thinking: high`. Allowed UI values should be:

- inherit/unset;
- off;
- minimal;
- low;
- medium;
- high;
- xhigh.

Pi/model compatibility remains the runtime's responsibility. The selector should not hide levels based on the selected model because `/gentle:models` is configuring agents, not making a single provider call.

## Frontmatter application

Replace `updateFrontmatterModel` with a generic helper that updates both keys:

```ts
function updateFrontmatterRouting(content, entry) {
  remove lines starting with `model:` or `thinking:`;
  insert configured fields near `description:`;
}
```

Keep output deterministic, with `model` before `thinking`.

## Builtin settings application

Rename/extend `updateBuiltinModelOverride` to update routing fields:

- read `.pi/settings.json`;
- locate `settings.subagents.agentOverrides[name]`;
- set/delete `model` and `thinking` independently;
- prune empty override, `agentOverrides`, and `subagents` objects.

## UI design

Minimal keyboard extension:

- Agent list rows display: `<agent>  model=<value>  effort=<value>`.
- Existing `enter` keeps opening the model picker.
- Add `e` to open an effort picker for selected agent/all agents.
- Add `i` to inherit both model and effort for selected agent/all agents, preserving current shortcut semantics as a quick reset.
- Keep `c` as custom model only.
- Model picker behavior stays unchanged.
- Effort picker is a small list, no search needed.

This avoids a larger multi-column UI rewrite and keeps the current overlay component.

## Tests

Extend `tests/runtime-harness.mjs` rather than adding brittle direct imports. The harness can:

1. create a temp workspace with `.pi/agents/sdd-apply.md` frontmatter;
2. run the `/gentle:models` command using a fake `ui.custom()` result with a `save` routing config;
3. assert:
   - `.pi/gentle-ai/models.json` writes object entries;
   - `.pi/agents/sdd-apply.md` has `model:` and `thinking:`;
   - `.pi/settings.json` for builtin `worker` has `model` and `thinking` overrides.

Add a second case for legacy string config if feasible without overfitting.

## Documentation

Update README model assignment section:

- title/copy should say model and effort assignment;
- recommended table may include effort guidance;
- saved config example should show object shape.

## Tradeoffs

- Chosen: object config with backward-compatible parser. This is more explicit and extensible than encoding `model@effort` in a string.
- Chosen: `e` shortcut instead of embedding effort picker into the model picker. This keeps scope small and avoids confusing model search with effort values.
- Not chosen: model-specific effort filtering. It would require deeper integration with model metadata and can drift from Pi runtime behavior.

## Validation strategy

Strict TDD is active with `pnpm test`.

- RED: add failing harness assertions for model+effort save/application.
- GREEN: implement parser, writer, frontmatter/settings application, and UI draft support.
- TRIANGULATE: add legacy string config coverage if the first test only covers new object shape.
- REFACTOR: rename model-only helpers/types to routing helpers and keep behavior deterministic.
