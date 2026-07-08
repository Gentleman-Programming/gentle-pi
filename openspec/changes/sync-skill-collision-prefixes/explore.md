# Exploration — sync-skill-collision-prefixes

## Problem

On 2026-07-07 a skill-name collision fix was applied DIRECTLY to the installed package copy (~/.pi/agent/npm/node_modules/gentle-pi/skills), renaming 6 skills' frontmatter `name:` to gentle-ai-prefixed forms: `gentle-ai-branch-pr`, `gentle-ai-chained-pr`, `gentle-ai-issue-creation`, `gentle-ai-judgment-day`, `gentle-ai-skill-creator`, `gentle-ai-skill-improver`. The collision: when both gentle-ai and gentle-pi provide skills to the same Pi runtime, identical names clash.

The repo at /home/gentleman/work/gentle-pi still uses the ORIGINAL names for all 12 skills. Version tags match (0.11.3 installed == repo) but content differs — the next `npm update`/reinstall silently REVERTS the collision fix. This is a live regression trap.

## Verified facts (2026-07-08 audit)

- Installed copy: 6/12 skills carry gentle-ai-* prefixes; other 6 keep original names (cognitive-doc-design, comment-writer, gentle-ai, release, skill-registry, work-unit-commits).
- Repo tree is git-clean with original names; no generator produces the prefixed names.
- The skill registry extension (extensions/skill-registry.ts) writes .atl/skill-registry.md from frontmatter — renames propagate automatically on regeneration.

## Open questions for proposal

1. Which name-referencing surfaces exist in the repo? Scan for references to the 6 original names in: assets/orchestrator.md, assets/sdd-orchestrator-workflow.md, assets/agents/*.md, assets/chains/*.md, prompts/*.md, docs/, other skills' bodies (cross-references), extensions/*.ts (string literals), tests/.
2. Directory names: do skill DIRECTORY names need to match frontmatter `name:` for Pi's loader, or is frontmatter authoritative? (Installed fix renamed only frontmatter.)
3. Should the un-prefixed 6 also be prefixed for consistency, or is collision-only scope correct? (Installed fix chose collision-only.)

## Constraints

- Strict TDD (pnpm test); small diff expected; must match the installed hotfix EXACTLY so the next release is a no-op for already-patched installs.
