# Proposal: Sync Skill Collision Prefixes

## Intent (Problem Statement)

On 2026-07-07 a skill-name collision was hotfixed **directly in the installed package copy**, renaming 6 skills' frontmatter `name:` to `gentle-ai-`-prefixed forms so gentle-ai and gentle-pi skills stop clashing in the same Pi runtime. The repo still ships the ORIGINAL names, so the next `npm update`/reinstall silently REVERTS the fix — a live regression trap. This change upstreams the hotfix so the next release is a no-op for already-patched installs.

## Scope

### In Scope
- Rename frontmatter `name:` in the 6 collision skills to the EXACT installed values: `gentle-ai-branch-pr`, `gentle-ai-chained-pr`, `gentle-ai-issue-creation`, `gentle-ai-judgment-day`, `gentle-ai-skill-creator`, `gentle-ai-skill-improver`.
- Update in-repo **skill-name references**: `assets/orchestrator.md` routing table, `README.md` catalog/prose, `prompts/skill-creation.md`, and the `skill-improver` → `skill-creator` cross-ref.
- Add a regression test (`pnpm test`) asserting the 6 frontmatter names.

### Out of Scope
- The other 6 skills stay unprefixed (collision-only, matches hotfix).
- Skill **directory** renames — frontmatter is authoritative (`deriveSkillName`); dirs unchanged, so `scripts/verify-package-files.mjs` paths stay valid.
- `lib/review-triggers.ts` / `tests/review-triggers.test.ts` `judgment-day` — a separate agent-identifier set that mirrors `triggers.go`; owned by the parallel change.

## Capabilities

### New Capabilities
- `skill-collision-naming`: collision-prone package skills MUST carry the `gentle-ai-` prefix in frontmatter; enforced by regression test.

### Modified Capabilities
- None.

## Approach

Edit 6 frontmatter `name:` lines to match the installed hotfix byte-for-byte, then sync each prose/routing reference the scan found. Add a test that reads the 6 `SKILL.md` frontmatter and asserts the prefixed names. No directory moves, no loader/runtime logic changes.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `skills/{branch-pr,chained-pr,issue-creation,judgment-day,skill-creator,skill-improver}/SKILL.md` | Modified | Frontmatter `name:` prefixed |
| `assets/orchestrator.md`, `README.md`, `prompts/skill-creation.md` | Modified | Name references synced |
| `tests/` | New | Regression test for the 6 names |

## Coordination Boundary

Parallel change `port-review-ledger-contract` edits `skills/judgment-day` **content** and the review-ledger/trigger contract. This change owns ONLY frontmatter `name:` fields and skill-name references — it does NOT touch judgment-day body content or `review-triggers` agent identifiers.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Missed reference leaves a dangling original name | Low | Scan-driven list; regression test |
| Overlap edit with parallel judgment-day change | Med | Boundary above; frontmatter-only here |
| `judgment-day` agent-identifier vs skill-name divergence | Med | Left to parallel change; documented |

## Rollback Plan

Revert the change commit; frontmatter and references return to original names. No data or state migration involved.

## Dependencies

- Coordinate merge order with `port-review-ledger-contract` on `skills/judgment-day`.

## Success Criteria

- [ ] 6 skills' frontmatter `name:` match the installed hotfix exactly.
- [ ] All scanned in-repo skill-name references updated; no original name remains for the 6.
- [ ] `pnpm test` passes, including the new frontmatter-name regression test.
- [ ] A fresh install/reinstall no longer reverts the collision fix.
