# Archive Report — sync-skill-collision-prefixes

**Archived**: 2026-07-08. **Commit**: 6fada863 on branch feat/sync-skill-collision-prefixes.

## What shipped

Upstreamed the 2026-07-07 installed-copy hotfix into the repo: six skills' frontmatter names renamed to their gentle-ai-prefixed forms (gentle-ai-branch-pr, gentle-ai-chained-pr, gentle-ai-issue-creation, gentle-ai-judgment-day, gentle-ai-skill-creator, gentle-ai-skill-improver), byte-identical to the patched installed copies so the next release is a no-op for already-patched installs. All in-repo name references synced (orchestrator routing table, README, prompts/skill-creation.md, skill-improver cross-reference); directory names and the KNOWN_AGENTS identifier namespace intentionally untouched (documented divergence). New regression test `tests/skill-collision-prefixes.test.ts` reuses the loader's own frontmatter parser (`__testing.parseFrontmatter`) — 6 prefixed assertions + 6 unprefixed guards.

## Verification

- Strict TDD: RED confirmed (6/12 failing against unprefixed names) before edits; 12/12 after; full suite 216/216, exit 0.
- sdd-verify: PASS — 0 CRITICAL, 0 WARNING, 0 SUGGESTION; all six checks run first-hand including byte-identity diffs against the installed copies.
- Judgment-day: APPROVED round 1 — judge A CLEAN; judge B one Low cosmetic nit (README table padding, fixed by the orchestrator before commit, suite re-verified green).

## Coordination

This change merges FIRST: `skills/judgment-day/SKILL.md` line 2 (frontmatter) is owned here; the body is owned by `port-review-ledger-contract`.

## Follow-ups

None. The pre-existing bare-name identifiers in lib/review-triggers.ts (KNOWN_AGENTS namespace, mirrors gentle-ai's triggers.go) are intentionally out of scope and documented in the design.
