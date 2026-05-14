# Change: gentle-models-effort

## Problem

`/gentle:models` currently lets users assign a model per discovered agent, but it cannot assign the agent reasoning/thinking effort in the same flow. Users who route SDD/custom/builtin subagents to stronger or cheaper models still need to edit agent frontmatter or `.pi/settings.json` manually to tune effort.

## Goals

- Extend `/gentle:models` so each agent can store both `model` and `thinking` effort.
- Preserve existing string-only `.pi/gentle-ai/models.json` files.
- Apply effort consistently to:
  - project/user agent frontmatter via `thinking:`;
  - builtin agents via `.pi/settings.json` `subagents.agentOverrides.<agent>.thinking`.
- Keep the UI compact and keyboard-driven, with bulk assignment support.
- Document the new saved config shape and recommended effort usage.

## Non-goals

- Do not change Pi's global `/model` selector.
- Do not validate model-specific supported thinking levels beyond Pi's own runtime behavior.
- Do not add provider/model catalog editing.
- Do not change subagent discovery precedence.

## Impact

Primary code lives in `extensions/gentle-ai.ts`. Tests should extend the runtime harness to exercise the command path. README documentation should update the model assignment section.

## Review workload

Expected small-to-medium change, likely 3 files touched plus these SDD artifacts. Estimated diff should remain under 400 changed lines, so one PR is appropriate.
