# Design: Sync Skill Collision Prefixes

## Technical Approach

Upstream the 2026-07-07 installed-copy hotfix into the repo so a fresh
`npm update`/reinstall stops reverting it. Three mechanical edit sets, no runtime
logic changes: (1) rename the 6 collision skills' frontmatter `name:` to the
byte-exact installed values, (2) sync in-repo skill-*name* references (not paths),
(3) add a node:test regression that reuses the registry's own frontmatter parser.
Directories are NOT renamed — frontmatter is authoritative via
`deriveSkillName` (extensions/skill-registry.ts:166-169), so path references and
`scripts/verify-package-files.mjs` stay valid.

## Architecture Decisions

### Decision: Prefix literal names in-repo vs generator-at-install

**Choice**: Commit the literal `gentle-ai-` names into the 6 `SKILL.md` files.
**Alternatives considered**: A generator/postinstall hook that derives prefixes at
install time.
**Rationale**: The installed hotfix already hard-codes literals; matching them
byte-for-byte makes the next release a **no-op** for patched installs. A generator
adds a runtime code path, install-order risk, and a new divergence source to fix a
6-line static rename — cost far exceeds benefit for a collision-only set. Literals
are also greppable and testable.

### Decision: Reuse `__testing.parseFrontmatter` vs a minimal reader

**Choice**: Import `__testing.parseFrontmatter` from `extensions/skill-registry.ts`
(exported at line 527) in the new test, matching the pattern in
`tests/skill-registry.test.ts:7`.
**Alternatives considered**: A hand-rolled minimal frontmatter reader in the test.
**Rationale**: The registry parser is exactly what the Pi loader uses to derive
skill names; asserting against it proves the collision fix holds *as the runtime
sees it*. A second parser could drift and pass while the loader disagrees.

### Decision: Scope orchestrator.md edit to the routing table only

**Choice**: Edit `assets/orchestrator.md:286-287` (routing table). Leave
`:308` (`judgment-day` in the 4R Review Triggers section) unchanged.
**Alternatives considered**: Rename `:308` too.
**Rationale**: Line 308 documents the review-trigger **agent identifier** namespace
that mirrors `lib/review-triggers.ts` / `triggers.go` — explicitly out of scope
(proposal §Out of Scope) and owned by `port-review-ledger-contract`. Renaming it
alone would desync prose from the code identifier.

## File Changes

| File | Action | Change |
|------|--------|--------|
| `skills/branch-pr/SKILL.md:2` | Modify | `name: branch-pr` → `gentle-ai-branch-pr` |
| `skills/chained-pr/SKILL.md:2` | Modify | `name: chained-pr` → `gentle-ai-chained-pr` |
| `skills/issue-creation/SKILL.md:2` | Modify | `name: issue-creation` → `gentle-ai-issue-creation` |
| `skills/judgment-day/SKILL.md:2` | Modify | `name: judgment-day` → `gentle-ai-judgment-day` (frontmatter only; body owned by parallel change) |
| `skills/skill-creator/SKILL.md:2` | Modify | `name: skill-creator` → `gentle-ai-skill-creator` (line 62 `name: {skill-name}` is a body template — DO NOT touch) |
| `skills/skill-improver/SKILL.md:2` | Modify | `name: skill-improver` → `gentle-ai-skill-improver` |
| `assets/orchestrator.md:286` | Modify | `` `branch-pr` `` → `` `gentle-ai-branch-pr` `` |
| `assets/orchestrator.md:287` | Modify | `` `chained-pr` `` → `` `gentle-ai-chained-pr` `` |
| `README.md:58` | Modify | `skill-creator`/`skill-improver` → prefixed |
| `README.md:314` | Modify | `skill-creator`, `skill-improver` → prefixed (`/skill-creation` prompt name unchanged) |
| `README.md:316` | Modify | `judgment-day`, `skill-creator`, `skill-improver` → prefixed (`cognitive-doc-design`, `comment-writer` unchanged) |
| `README.md:416` | Modify | `skill-creator` → `gentle-ai-skill-creator` |
| `README.md:433,434,436,439,440,441` | Modify | catalog: `branch-pr`, `chained-pr`, `judgment-day`, `issue-creation`, `skill-creator`, `skill-improver` → prefixed |
| `prompts/skill-creation.md:7` | Modify | name `` `skill-creator` `` → `` `gentle-ai-skill-creator` `` ONLY; keep path `` `skills/skill-creator/SKILL.md` `` |
| `skills/skill-improver/SKILL.md:12` | Modify | cross-ref `` `skill-creator` `` → `` `gentle-ai-skill-creator` `` |
| `tests/skill-collision-prefixes.test.ts` | Create | Regression test (below) |

**Explicitly NOT changed** (out of scope, verified): `scripts/verify-package-files.mjs:38-47`
(directory paths, dirs unchanged), `lib/review-triggers.ts:69,157` and
`tests/review-triggers.test.ts:154,211` (agent identifiers mirroring `triggers.go`),
`assets/orchestrator.md:308` (trigger identifier). No matches in `assets/agents/**`,
`assets/chains/**`, `docs/**`, `assets/sdd-orchestrator-workflow.md` (grep-verified).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | 6 frontmatter names carry `gentle-ai-` prefix | New `tests/skill-collision-prefixes.test.ts`: read each `skills/<dir>/SKILL.md`, run `__testing.parseFrontmatter`, assert exact expected name from a `Record<dir, expectedName>` map |
| Guard | Un-prefixed 6 stay bare | Assert `skill-registry`, `release`, `work-unit-commits`, `gentle-ai`, `comment-writer`, `cognitive-doc-design` have NO `gentle-ai-` prefix — locks collision-only scope |

`node --experimental-strip-types --test tests/*.test.ts` auto-discovers the new
file (package.json:38) — no manifest change needed.

## Migration / Rollout

No data migration. Already-patched installs: next release is a **no-op** (names
already match). Fresh installs/reinstalls: now ship correct prefixed names instead
of reverting. Rollback = revert the commit; names return to originals.

## Open Questions

- [ ] Confirm merge ordering with `port-review-ledger-contract` on
  `skills/judgment-day/SKILL.md` (this change: line 2 frontmatter only; that change:
  body). Independent lines, but coordinate to avoid a rebase conflict.
