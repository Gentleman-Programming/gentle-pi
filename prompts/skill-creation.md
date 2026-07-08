---
description: Create or update an LLM-first skill
argument-hint: "<skill idea or name>"
---
Create or update an LLM-first skill for: $ARGUMENTS

Use the `gentle-ai-skill-creator` skill if it is available. If the skill is not auto-loaded, read `skills/skill-creator/SKILL.md` and `docs/skill-style-guide.md` when present before editing.

## Process

1. Clarify the reusable behavior, target runtime, trigger phrases, and non-goals if they are not obvious.
2. Inspect existing skills first; update an existing skill instead of creating a duplicate.
3. Create or update `skills/{kebab-name}/SKILL.md` with valid one-line frontmatter description and concise runtime instructions.
4. Put templates, schemas, or examples under `assets/`; put longer supporting docs under `references/`.
5. If the skill is part of `gentle-pi`, update `scripts/verify-package-files.mjs`.
6. Refresh the registry with `/skill-registry:refresh` when available, or tell the user to refresh/reload.

## Report

Return the files changed, the selected trigger phrases, any supporting files, and whether registry/package verification remains to run.
