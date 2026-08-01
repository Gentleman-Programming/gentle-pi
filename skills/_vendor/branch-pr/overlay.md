# Overlay: branch-pr

Pi-specific delta applied on top of `skills/_vendor/branch-pr/SKILL.md` to
produce `skills/branch-pr/SKILL.md`. The one required delta re-applies the
existing skill-collision-prefix fix (`tests/skill-collision-prefixes.test.ts`):
gentle-pi's own skill loader needs the `gentle-ai-` prefix on this
frontmatter `name` to avoid colliding with other loaded skills; the vendored
body keeps the provider's own unprefixed name. Do not hand-edit the vendored
file above; edit this file instead.

<!-- overlay:block -->
<!-- overlay:anchor -->
name: branch-pr
<!-- overlay:replace -->
name: gentle-ai-branch-pr
<!-- overlay:end -->
