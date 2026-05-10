# el Gentleman

`gentle-pi` installs **el Gentleman** into Pi: a controlled-development harness with a senior architect persona, SDD/OpenSpec phase discipline, strict TDD evidence, subagent orchestration, and review-workload protection.

Install it when you want Pi to stop behaving like a generic chatbot and start acting like a disciplined development harness.

## Quick start

```bash
pi install npm:gentle-pi
```

Recommended companion packages:

```bash
pi install npm:pi-subagents
pi install npm:pi-intercom
```

Then start Pi in your project:

```bash
pi
```

On session start, `gentle-pi` automatically installs SDD assets into the project without overwriting local edits.

## What you get

| Capability | What it does |
|---|---|
| el Gentleman identity | Answers as a Pi-specific harness, not a generic assistant. |
| SDD/OpenSpec routing | Small work stays inline, context-heavy work delegates, large/risky work uses SDD artifacts. |
| SDD phase agents | Installs `sdd-init`, `sdd-explore`, `sdd-proposal`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, and `sdd-archive`. |
| Strict TDD support | Preserves RED → GREEN → TRIANGULATE → REFACTOR evidence and verify-time compliance checks. |
| Review workload guard | Forecasts large diffs and recommends chained PRs or explicit `size:exception`. |
| Model assignment UI | Opens a modal to assign Pi models to project, user, and built-in agents, with SDD agents shown first. |
| Foundation skills | Adds PR, issue, chained-PR, comment, docs, work-unit, and Judgment Day skills. |
| Safety policy | Blocks destructive shell actions unless there is explicit user approval. |

## Core commands

```text
/gentle-ai:status          Show package, SDD asset, OpenSpec, and model config status.
/gentleman:models          Open the per-agent model assignment modal.
/gentle-ai:models          Compatibility alias that points to /gentleman:models.
/sdd-init                  Bootstrap or refresh openspec/config.yaml.
/gentle-ai:install-sdd     Reinstall SDD assets without overwriting local files.
/gentle-ai:install-sdd --force
                           Force-refresh installed SDD assets.
```

## Assign models to agents

Run:

```text
/gentleman:models
```

This opens a modal similar to Gentle-AI's model picker. It discovers Pi subagents from project, user, and built-in sources, with SDD agents sorted first:

```text
Assign Models to Agents

Current assignments:

▸ Set all agents       mixed
  sdd-init             inherit
  sdd-explore          openai-codex/gpt-5.5
  sdd-proposal         openai-codex/gpt-5.5
  sdd-spec             anthropic/claude-sonnet-4
  sdd-design           anthropic/claude-sonnet-4
  sdd-tasks            anthropic/claude-sonnet-4
  sdd-apply            anthropic/claude-sonnet-4
  sdd-verify           google/gemini-3-pro
  sdd-archive          inherit
  delegate             inherit
  my-custom-agent      anthropic/claude-sonnet-4

Continue
← Back

j/k: navigate • enter: change model / confirm • i: inherit • c: custom • ctrl+s: save • esc: back
```

Model choices come from Pi itself via the active model registry. The modal also supports custom model IDs for advanced setups.

The modal covers:

- project agents from `.pi/agents/` and `.agents/`;
- user agents from `~/.pi/agent/agents/` and `~/.agents/`;
- built-in `pi-subagents` agents.

Small recommendation in English:

| Agent kind | Recommended model shape |
|---|---|
| Exploration, proposal, archive | Fast and cheap is usually enough. |
| Spec, design, tasks | Strong reasoning model, because these phases shape the implementation. |
| Apply | Strong coding model with good tool-use reliability. |
| Verify / review agents | Strongest fresh-context model you can afford; verification benefits from independence. |
| Tiny utility agents | Inherit the active/default model unless they become a bottleneck. |

Saved config:

```text
.pi/gentle-ai/models.json
```

Applied configuration:

```text
.pi/agents/*.md                 # project/user markdown agents
.pi/settings.json               # project overrides for built-in pi-subagents agents
```

Use `Inherit active/default model` to remove an agent override.

## Installed project files

`gentle-pi` installs these project-local assets on session start:

```text
.pi/agents/sdd-*.md
.pi/chains/sdd-*.chain.md
.pi/gentle-ai/support/strict-tdd.md
.pi/gentle-ai/support/strict-tdd-verify.md
```

Existing files are skipped. Your local edits remain unless you explicitly run:

```text
/gentle-ai:install-sdd --force
```

## Package contents

| Path | Purpose |
|---|---|
| `extensions/gentle-ai.ts` | Injects el Gentleman, installs assets, provides commands, applies model config, blocks unsafe shell commands. |
| `extensions/sdd-init.ts` | Registers `/sdd-init` for OpenSpec project initialization. |
| `extensions/skill-registry.ts` | Registers `/skill-registry:refresh` and maintains `.atl/skill-registry.md`. |
| `assets/orchestrator.md` | Parent-session orchestration contract. |
| `assets/agents/` | SDD phase agents copied into `.pi/agents/`. |
| `assets/chains/` | SDD chains copied into `.pi/chains/`. |
| `assets/support/` | Strict TDD apply/verify support docs. |
| `skills/` | el Gentleman and foundation skills. |
| `prompts/` | Gentle-prefixed prompt templates: `/gcl`, `/gis`, `/gpr`, `/gwr`. |

## Foundation skills

Included skills:

- `gentle-ai` — el Gentleman harness discipline.
- `branch-pr` — issue-first PR creation.
- `chained-pr` — split oversized PRs into reviewable chains.
- `work-unit-commits` — commit by deliverable work unit.
- `judgment-day` — blind dual review and re-judgment flow.
- `cognitive-doc-design` — documentation that reduces reviewer load.
- `comment-writer` — concise collaboration comments.
- `issue-creation` — issue-first GitHub workflow.

## Memory is separate

This package intentionally does **not** configure persistent memory.

Use a separate memory package, for example:

```bash
pi install npm:gentle-engram
```

el Gentleman may mention memory only when a memory package or callable memory tool is actually active.

## Local development

From this repo:

```bash
pi install ./pi-packages/gentle-ai
```

Validate before publishing:

```bash
node --experimental-strip-types --check pi-packages/gentle-ai/extensions/gentle-ai.ts
cd pi-packages/gentle-ai
npm pack --dry-run
```

## Design principles

- Concepts before code.
- Artifacts over floating chat context.
- Strict TDD evidence when tests exist.
- One parent orchestrator, focused subagents.
- Review workload is a first-class constraint.
- Human control beats agent momentum.
