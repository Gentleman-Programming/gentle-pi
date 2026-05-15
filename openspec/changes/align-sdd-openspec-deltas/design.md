# Design: Align SDD OpenSpec delta handling

## Decision Summary

Port the accepted `gentle-ai` OpenSpec convention into `gentle-pi`, then harden it with native validation/sync/archive tests where feasible. `gentle-pi` should not install or shell out to external OpenSpec; OpenSpec-compatible behavior is part of the harness contract.

## Architecture

### Artifact model

Use the same split as `gentle-ai`:

```text
openspec/specs/{domain}/spec.md                         # canonical source of truth
openspec/changes/{change}/specs/{domain}/spec.md        # active change spec
openspec/changes/archive/YYYY-MM-DD-{change}/            # completed audit trail
```

Mode boundaries:

| Mode       | Behavior                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `openspec` | Write and merge file-backed artifacts only.                                                       |
| `both` / `hybrid`   | Write file-backed artifacts and save Engram phase artifacts. Canonical merge remains file-backed. |
| `engram`   | Working memory only. Archive records observation IDs; no canonical merge layer.                   |
| `none`     | Inline result only; no persisted artifacts.                                                       |

### Prompt assets

Update `assets/agents/sdd-spec.md` to include the key rules from `gentle-ai/internal/assets/skills/sdd-spec/SKILL.md`:

- read proposal capabilities first;
- write `openspec/changes/{change}/specs/{domain}/spec.md`;
- if canonical spec exists, use `ADDED/MODIFIED/REMOVED` sections;
- if canonical spec does not exist, write a full domain spec;
- for `MODIFIED`, copy the entire requirement block and all scenarios before editing.

Update `assets/agents/sdd-archive.md` to include the key rules from `gentle-ai/internal/assets/skills/sdd-archive/SKILL.md`:

- reject/archive-block if verify report has CRITICAL issues;
- sync deltas before moving archive;
- preserve unrelated requirements;
- warn on destructive removals;
- move active change to dated archive;
- write archive report.

### Native helpers and tests

`gentle-ai` is mostly prompt-driven. `gentle-pi` should add a small native validation/sync layer or focused test helpers so this behavior is not only prose.

Candidate TypeScript modules:

```text
lib/openspec-deltas.ts
lib/openspec-archive.ts
```

Minimal exported operations:

- `parseRequirementBlocks(markdown)`
- `parseDeltaSpec(markdown)`
- `applyDeltaSpec(canonicalMarkdown, deltaMarkdown)`
- `detectActiveDomainCollisions(changeName, domain, cwd)`
- `archiveChange(changeName, cwd, options)`

This can start as internal testable logic without exposing a Pi command. Phase agents can still perform file edits, but tests should encode the merge contract.

### Asset freshness

Keep non-destructive install behavior by default, but surface drift:

- `/gentle-ai:status` should report stale `.pi/agents/sdd-*.md` or `.pi/chains/sdd-*.chain.md`.
- Preflight notification can say assets are installed but stale.
- Force refresh remains explicit via `/gentle-ai:install-sdd --force`.

Avoid silently overwriting `.pi` because users may customize project agents.

## Tradeoffs

| Decision                    | Chosen                                 | Alternative                             | Rationale                                                                                      |
| --------------------------- | -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| External OpenSpec CLI       | Do not install                         | Add dependency / shell out              | User explicitly wants OpenSpec behavior bundled in `gentle-pi`.                                |
| Engram canonical specs      | Do not add                             | Add `sdd/canonical/{domain}/spec` topic | User accepted Engram as working memory only; canonical evolution belongs to file-backed modes. |
| Prompt-only vs native merge | Add native tests/helpers incrementally | Keep prompt-only                        | Reduces silent data loss in MODIFIED/REMOVED merges.                                           |
| `.pi` asset drift           | Warn + explicit refresh                | Auto-overwrite                          | Preserves local customizations and reviewability.                                              |

## Validation Strategy

- Unit-test parser/apply behavior with markdown fixtures:
  - new full spec copied to canonical;
  - ADDED appends requirement;
  - MODIFIED replaces full requirement block;
  - REMOVED deletes requirement;
  - unrelated requirements preserved;
  - missing MODIFIED target fails;
  - duplicate operation conflicts fail or warn.
- Runtime-harness test status/preflight drift warning.
- Fixture test for active change collision detection.
- Fixture/migration test for legacy `openspec/changes/{change}/spec.md` warning.

## Migration Plan

1. Add/port prompt rules and docs first.
2. Add native parser/apply tests with fixtures.
3. Add status/preflight drift warning.
4. Migrate current `gentle-pi` example `gentle-models-effort` from flat `spec.md` to `specs/{domain}/spec.md` or explicitly mark it as legacy.
5. Optionally archive this change after verify passes to create canonical `openspec/specs/sdd-openspec/spec.md`.

## Risks

- Parser scope creep: full Markdown parsing is hard. Keep parser constrained to OpenSpec heading conventions.
- Historical artifacts may not conform. Treat them as legacy and warn, not as fatal for unrelated work.
- Native helpers and agent prompt behavior can diverge. Keep fixtures close to prompt examples.
