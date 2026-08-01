# Overlay: skill-improver

Pi-specific deltas applied on top of `skills/_vendor/skill-improver/SKILL.md`
to produce `skills/skill-improver/SKILL.md`: the skill-collision-prefix fix
on `name` (same rationale as `branch-pr`/`chained-pr`), plus gentle-pi's own
simplified skill-style-guide fallback chain, `.atl/skill-registry.md`
availability wording, and `/skill-registry:refresh` slash-command
convention (gentle-pi has no `references/skill-style-guide.md` bundled local
copy and no `gentle-ai skill-registry refresh` CLI verb). Do not hand-edit
the vendored file above; edit this file instead.

<!-- overlay:block -->
<!-- overlay:anchor -->
name: skill-improver
<!-- overlay:replace -->
name: gentle-ai-skill-improver
<!-- overlay:end -->
<!-- overlay:block -->
<!-- overlay:anchor -->
Use this skill when asked to audit, refactor, normalize, or improve existing `SKILL.md` files. Use `skill-creator` instead when creating a brand-new skill from a reusable pattern.
<!-- overlay:replace -->
Use this skill when auditing, refactoring, normalizing, or improving existing `SKILL.md` files. Use `gentle-ai-skill-creator` when creating a brand-new skill from a reusable pattern.
<!-- overlay:end -->
<!-- overlay:block -->
<!-- overlay:anchor -->
- Treat `docs/skill-style-guide.md` as the normative style contract when it exists.
- For installed global skills, use `references/skill-style-guide.md` as the bundled local copy when `docs/skill-style-guide.md` is unavailable.
<!-- overlay:replace -->
- Read `docs/skill-style-guide.md` first and treat it as the normative style contract.
<!-- overlay:end -->
<!-- overlay:block -->
<!-- overlay:anchor -->
- Use `.atl/skill-registry.md` as an index of skill names, triggers, scopes, and exact paths; do not expect generated summaries.
<!-- overlay:replace -->
- Use `.atl/skill-registry.md` as an index of skill names, triggers, scopes, and exact paths when available.
<!-- overlay:end -->
<!-- overlay:block -->
<!-- overlay:anchor -->
1. Read `docs/skill-style-guide.md`; if unavailable, read `references/skill-style-guide.md`; if neither exists, enforce the core LLM-first structure: frontmatter, Activation Contract, Hard Rules, Decision Gates, Execution Steps, Output Contract, References.
<!-- overlay:replace -->
1. Read `docs/skill-style-guide.md`.
<!-- overlay:end -->
<!-- overlay:block -->
<!-- overlay:anchor -->
5. In apply mode, edit only safe issues, preserve content, create supporting files when needed, then rerun or request `gentle-ai skill-registry refresh`.
<!-- overlay:replace -->
5. In apply mode, edit only safe issues, preserve content, create supporting files when needed, then refresh or request `/skill-registry:refresh`.
<!-- overlay:end -->
<!-- overlay:block -->
<!-- overlay:anchor -->
- `docs/skill-style-guide.md` — normative LLM-first skill style guide for this repo.
- `references/skill-style-guide.md` — bundled local copy for installed global skills when the repo doc is unavailable.
<!-- overlay:replace -->
- `docs/skill-style-guide.md` — normative LLM-first skill style guide.
- `skills/skill-registry/SKILL.md` — registry refresh and indexing contract.
<!-- overlay:end -->
