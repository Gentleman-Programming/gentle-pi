# SDD OpenSpec Specification

## Purpose

Defines how `gentle-pi` SDD maintains OpenSpec-compatible file-backed specs without requiring the external OpenSpec CLI/package.

## Requirements

### Requirement: File-backed canonical spec store

In `openspec` and `both` / `hybrid` artifact modes, the system MUST treat `openspec/specs/{domain}/spec.md` as the canonical source of truth for accepted behavior.

#### Scenario: canonical specs are file backed

- GIVEN artifact mode is `openspec` or `both` / `hybrid`
- WHEN a change is archived
- THEN accepted behavior is represented in `openspec/specs/{domain}/spec.md`
- AND the archived change remains an audit trail under `openspec/changes/archive/`

#### Scenario: engram mode has no canonical merge

- GIVEN artifact mode is `engram`
- WHEN SDD artifacts are produced or archived
- THEN the system MUST NOT create or require `sdd/canonical/{domain}/spec` topics
- AND the archive report records observation IDs as traceability instead of merging canonical specs

### Requirement: Change specs use domain subdirectories

For file-backed modes, `sdd-spec` MUST write specs under `openspec/changes/{change}/specs/{domain}/spec.md`.

#### Scenario: new change writes domain spec

- GIVEN a change named `align-sdd-openspec-deltas`
- AND the affected domain is `sdd-openspec`
- WHEN `sdd-spec` writes the artifact
- THEN the artifact path is `openspec/changes/align-sdd-openspec-deltas/specs/sdd-openspec/spec.md`

#### Scenario: legacy flat spec detected

- GIVEN `openspec/changes/{change}/spec.md` exists
- WHEN archive or verification inspects file-backed specs
- THEN the system MUST warn that the change uses a legacy flat spec format
- AND MUST NOT silently skip canonical merge without reporting the issue

### Requirement: Delta requirements update canonical specs

When a canonical spec already exists for a domain, file-backed change specs MUST describe changes using requirement operation sections.

#### Scenario: added requirement appended

- GIVEN `openspec/specs/{domain}/spec.md` exists
- AND a change spec contains `## ADDED Requirements`
- WHEN archive syncs the change
- THEN each added requirement is appended to the canonical spec

#### Scenario: modified requirement replaces full block

- GIVEN a canonical spec contains `### Requirement: Existing Behavior`
- AND a change spec contains that requirement under `## MODIFIED Requirements`
- WHEN archive syncs the change
- THEN the entire canonical requirement block is replaced with the modified block
- AND unrelated requirements remain unchanged

#### Scenario: removed requirement deleted

- GIVEN a canonical spec contains `### Requirement: Deprecated Behavior`
- AND a change spec contains that requirement under `## REMOVED Requirements`
- WHEN archive syncs the change
- THEN the canonical requirement block is removed
- AND unrelated requirements remain unchanged

### Requirement: Modified requirements preserve scenarios

When writing `## MODIFIED Requirements`, `sdd-spec` MUST instruct executors to copy the full existing requirement block, including all scenarios, before editing it.

#### Scenario: scenario preservation during modification

- GIVEN a canonical requirement has three scenarios
- WHEN a change modifies one behavior in that requirement
- THEN the modified delta includes all still-valid scenarios
- AND archive does not lose scenarios that were not directly changed

### Requirement: Cross-change collision warning

When writing or verifying file-backed change specs, the system SHOULD warn if another active change touches the same domain spec.

#### Scenario: active change collision detected

- GIVEN `openspec/changes/change-a/specs/sdd-openspec/spec.md` exists
- AND `openspec/changes/change-b/specs/sdd-openspec/spec.md` exists
- WHEN `sdd-spec`, `sdd-verify`, or `sdd-archive` inspects `change-b`
- THEN it warns that another active change touches the same canonical domain
- AND recommends resolving archive order or rebasing the delta before merge

### Requirement: Destructive merge guard

Archive MUST warn before destructive merges that remove requirements or replace large canonical blocks.

#### Scenario: destructive removal requires warning

- GIVEN a change spec contains `## REMOVED Requirements`
- WHEN archive prepares to sync it
- THEN archive reports the removed requirement names
- AND asks for explicit confirmation if the removal is broad or ambiguous

### Requirement: Installed SDD asset freshness is visible

The SDD preflight or status flow MUST surface when installed `.pi` SDD assets differ from packaged `assets`.

#### Scenario: stale installed asset detected

- GIVEN `.pi/agents/sdd-spec.md` differs from `assets/agents/sdd-spec.md`
- WHEN SDD preflight or `/gentle-ai:status` runs
- THEN the user sees a warning that installed SDD assets are stale
- AND receives the safe refresh command or next action
