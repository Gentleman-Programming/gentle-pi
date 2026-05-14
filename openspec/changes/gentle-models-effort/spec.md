# Spec: Per-agent model and effort assignment

## Requirement: backward-compatible routing config

The package MUST accept existing `.pi/gentle-ai/models.json` entries where an agent maps directly to a model string.

### Scenario: existing string config loads

- Given `.pi/gentle-ai/models.json` contains `{ "sdd-apply": "openai/gpt-5" }`
- When `/gentle:models` opens
- Then `sdd-apply` shows model `openai/gpt-5`
- And effort is treated as inherited/unset

## Requirement: persisted model plus effort config

The package MUST be able to persist an agent assignment with optional `model` and optional `thinking` fields.

### Scenario: user saves model and effort

- Given the user assigns `sdd-design` model `anthropic/claude-sonnet-4` and effort `high`
- When the user saves
- Then `.pi/gentle-ai/models.json` contains an object entry for `sdd-design`
- And the entry includes `model: "anthropic/claude-sonnet-4"`
- And the entry includes `thinking: "high"`

### Scenario: inherited values are omitted

- Given an agent has no custom model and no custom effort
- When config is saved
- Then the agent entry is omitted from `.pi/gentle-ai/models.json`

## Requirement: project and user agent files receive frontmatter updates

The package MUST apply saved model and effort assignments to discovered project/user agent markdown files.

### Scenario: project agent gets frontmatter fields

- Given `.pi/agents/sdd-apply.md` has YAML frontmatter
- When config sets `model` and `thinking` for `sdd-apply`
- Then the frontmatter contains exactly one `model:` line with the configured model
- And exactly one `thinking:` line with the configured effort

### Scenario: project agent inherits effort

- Given a project agent file currently has `thinking: high`
- When config clears effort for that agent
- Then the `thinking:` frontmatter line is removed

## Requirement: builtin agents receive settings overrides

The package MUST apply saved model and effort assignments for builtin agents through `.pi/settings.json`.

### Scenario: builtin agent gets effort override

- Given `worker` is a builtin agent
- When config sets `thinking: high` for `worker`
- Then `.pi/settings.json` contains `subagents.agentOverrides.worker.thinking = "high"`

### Scenario: builtin agent inherits effort

- Given `.pi/settings.json` contains `subagents.agentOverrides.worker.thinking`
- When config clears effort for `worker`
- Then that `thinking` property is removed
- And empty override containers are removed when no fields remain

## Requirement: UI supports effort selection

The `/gentle:models` modal MUST allow changing effort per agent and for all agents.

### Scenario: list shows both values

- Given an agent has model and effort assignments
- When the agent list renders
- Then the row shows both model and effort in a readable compact label

### Scenario: effort picker supports inherit

- Given the user chooses effort for an agent
- When the user selects inherited effort
- Then the draft removes the agent's explicit `thinking` value without changing the model value

## Requirement: tests and documentation

The implementation MUST update runtime tests and README documentation.

### Scenario: harness validates command behavior

- Given the runtime harness executes `/gentle:models` with a fake saved config
- When the command finishes
- Then the harness asserts the config file, agent frontmatter, and settings override contain the expected model/effort values

### Scenario: docs describe saved shape

- Given README documents `/gentle:models`
- Then it explains model plus effort assignment and the `.pi/gentle-ai/models.json` object shape
