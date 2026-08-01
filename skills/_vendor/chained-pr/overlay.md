# Overlay: chained-pr

Pi-specific delta applied on top of `skills/_vendor/chained-pr/SKILL.md` to
produce `skills/chained-pr/SKILL.md`. Same rationale as `branch-pr`: the
skill-collision-prefix fix requires the `gentle-ai-` prefix on this
frontmatter `name` in gentle-pi's own loader, while the vendored body keeps
the provider's unprefixed name. Do not hand-edit the vendored file above;
edit this file instead.

<!-- overlay:block -->
<!-- overlay:anchor -->
name: chained-pr
<!-- overlay:replace -->
name: gentle-ai-chained-pr
<!-- overlay:end -->
