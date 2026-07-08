# Delta for Skill Naming

## Purpose

Define the naming contract for gentle-pi's shipped skills so the repo matches the already-installed collision hotfix, and stays a no-op on the next release for already-patched installs.

## ADDED Requirements

### Requirement: Collision Skill Frontmatter Prefixing

The system MUST use `gentle-ai-`-prefixed `name:` values in the frontmatter of the 6 collision-prone skills, matching the installed hotfix exactly:
`gentle-ai-branch-pr`, `gentle-ai-chained-pr`, `gentle-ai-issue-creation`, `gentle-ai-judgment-day`, `gentle-ai-skill-creator`, `gentle-ai-skill-improver`.

#### Scenario: Frontmatter matches installed hotfix

- GIVEN the repo's `skills/{branch-pr,chained-pr,issue-creation,judgment-day,skill-creator,skill-improver}/SKILL.md` files
- WHEN their frontmatter `name:` field is read
- THEN each value equals the corresponding `gentle-ai-`-prefixed name installed at `~/.pi/agent/npm/node_modules/gentle-pi/skills`

#### Scenario: Reinstall is a no-op for patched installs

- GIVEN an install already patched with the 6 prefixed names
- WHEN the package is updated/reinstalled from this repo
- THEN the installed frontmatter names are unchanged (no reversion to original names)

### Requirement: Non-Collision Skills Remain Unprefixed

The system MUST NOT prefix the frontmatter `name:` of the other 6 skills: `cognitive-doc-design`, `comment-writer`, `gentle-ai`, `release`, `skill-registry`, `work-unit-commits`.

#### Scenario: Unprefixed names preserved

- GIVEN the 6 non-collision skills' `SKILL.md` files
- WHEN their frontmatter `name:` field is read
- THEN each value matches its original, unprefixed name

### Requirement: In-Repo Skill-Name Reference Consistency

The system MUST use the new prefixed names in every in-repo reference to the 6 renamed skills, including `assets/orchestrator.md` routing table (lines 286-287), `README.md` catalog/prose, `prompts/skill-creation.md` (line 7), and the `skills/skill-improver/SKILL.md` cross-reference to `skill-creator` (line 12).

#### Scenario: Orchestrator routing table updated

- GIVEN `assets/orchestrator.md`
- WHEN the routing table entries at lines 286-287 are read
- THEN they reference the prefixed skill names, not the original ones

#### Scenario: README and skill-creation prompt updated

- GIVEN `README.md` and `prompts/skill-creation.md`
- WHEN their skill-name references are read
- THEN they use the prefixed names (`prompts/skill-creation.md` line 7 included)

#### Scenario: skill-improver cross-reference updated

- GIVEN `skills/skill-improver/SKILL.md` line 12
- WHEN its reference to the `skill-creator` skill is read
- THEN it uses `gentle-ai-skill-creator`

#### Scenario: No dangling original name remains

- GIVEN the full repo tree
- WHEN searched for the 6 original (unprefixed) skill names outside directory paths
- THEN no in-repo reference to an original name remains

### Requirement: Skill Directory Names Unchanged

The system MUST NOT rename the 6 skills' directories; frontmatter `name:` remains the authoritative identifier per `deriveSkillName`.

#### Scenario: Directories keep original paths

- GIVEN the 6 renamed skills
- WHEN their directory paths under `skills/` are read
- THEN each directory name is unchanged, and `scripts/verify-package-files.mjs` paths remain valid

### Requirement: KNOWN_AGENTS Identifier Namespace Untouched

The system MUST leave `lib/review-triggers.ts`'s `KNOWN_AGENTS` identifier namespace unmodified by this change. Its divergence from the `judgment-day` skill name is a documented, separately-owned concern.

#### Scenario: review-triggers untouched

- GIVEN `lib/review-triggers.ts` and `tests/review-triggers.test.ts`
- WHEN this change is applied
- THEN neither file is modified

### Requirement: Frontmatter-Name Regression Test

The system MUST include a `pnpm test` regression test that asserts the 6 collision skills' frontmatter `name:` values are the prefixed forms.

#### Scenario: Test fails on reversion

- GIVEN the new regression test
- WHEN any of the 6 skills' frontmatter `name:` reverts to its original unprefixed value
- THEN `pnpm test` fails

#### Scenario: Test passes on correct state

- GIVEN the 6 skills correctly carry prefixed names
- WHEN `pnpm test` runs
- THEN the regression test passes
