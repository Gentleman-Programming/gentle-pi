# el Gentleman

`gentle-pi` is an opinionated Pi package for controlled autonomy: explicit el Gentleman identity, SDD/OpenSpec workflow, strict TDD guidance, subagent-ready phase assets, review workload discipline, and a senior-architect persona.

It does not include persistent memory. Install a separate memory package, such as a future Engram package, when you want long-term recall.

## Install

```bash
pi install npm:gentle-pi
```

For local development from this repo:

```bash
pi install ./pi-packages/gentle-ai
```

## What it loads

- `extensions/gentle-ai.ts` — injects the parent-session Gentle AI orchestrator, auto-installs SDD assets non-destructively, registers `/gentle-ai:*` commands, and blocks high-risk shell commands.
- `extensions/sdd-init.ts` — registers `/sdd-init` to bootstrap `openspec/config.yaml`.
- `extensions/skill-registry.ts` — registers `/skill-registry:refresh` and maintains `.atl/skill-registry.md` from compact skill rules.
- `skills/gentle-ai` — compact rules for Gentle AI orchestration.
- `skills/branch-pr`, `skills/chained-pr`, `skills/work-unit-commits`, `skills/judgment-day`, `skills/cognitive-doc-design`, `skills/comment-writer`, and `skills/issue-creation` — foundation skills ported from Gentle-AI.
- `prompts/` — reusable prompt templates with Gentle-prefixed names (`/gcl`, `/gis`, `/gpr`, `/gwr`) to avoid collisions with project prompts.
- `assets/orchestrator.md` — parent-session SDD orchestration contract adapted from Gentle-AI.
- `assets/support` — strict TDD apply/verify support files copied to `.pi/gentle-ai/support/`.
- `assets/agents` and `assets/chains` — SDD assets auto-installed into projects that use `pi-subagents`.

## First run

After installing, open Pi and start working. The package auto-installs SDD subagent assets into the current project when the session starts, without overwriting existing files.

Useful diagnostics/recovery commands:

```text
/gentle-ai:status
/sdd-init
/gentle-ai:install-sdd --force
```

`/gentle-ai:install-sdd` is a recovery command. The normal path is automatic. It copies SDD agents to `.pi/agents/` and chains to `.pi/chains/`; existing files are skipped unless `--force` is passed.

## Optional companion packages

Recommended with this package:

```bash
pi install npm:pi-subagents
pi install npm:pi-intercom
```

- `pi-subagents` runs the installed SDD agents and chains.
- `pi-intercom` lets child agents ask the parent for decisions while running.

Persistent memory should remain separate; this package intentionally does not configure Engram or any other memory backend.

## Design principles

- Concepts before code.
- Artifacts over floating context.
- Strict TDD when tests exist, including evidence in apply and compliance checks in verify.
- One orchestrator, focused subagents.
- Review workload is a first-class constraint.
- Safety policy blocks destructive actions unless the user explicitly approves a safer path.
