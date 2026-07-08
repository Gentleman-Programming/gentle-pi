# Delta for Orchestrator Injection

## ADDED Requirements

### Requirement: Always-On Injection Byte Budget

The always-on orchestrator injection (`assets/orchestrator.md`, as returned by `getOrchestratorPrompt`) MUST NOT exceed a fixed byte budget. The exact numeric threshold is owned by design; this requirement only mandates that a budget exists and is enforced by an automated test.

#### Scenario: Core file within budget

- GIVEN the built `assets/orchestrator.md` after the split
- WHEN a test reads its size via `Buffer.byteLength` or `fs.statSync().size`
- THEN the size MUST be less than or equal to the design-defined budget
- AND the test MUST fail CI if the budget is exceeded

#### Scenario: Budget regression caught

- GIVEN a future edit that adds content directly to `assets/orchestrator.md`
- WHEN the edit pushes the file over the budget
- THEN `pnpm test` MUST fail before merge

### Requirement: Lazy Sections Reachable via In-Core Pointers

Every section moved out of the always-on core MUST remain reachable from the core via an in-core pointer using the existing path-substitution pattern (e.g. `{{GENTLE_PI_SDD_WORKFLOW_PATH}}`-style placeholder resolved by `getOrchestratorPrompt`).

#### Scenario: Pointer present for each relocated section

- GIVEN the disposition table marks a section as "Lazy" or "Split"
- WHEN the core file is inspected after the split
- THEN the core MUST contain a placeholder or explicit path reference resolving to the lazy file holding that section's content

#### Scenario: No orphaned lazy file

- GIVEN a new lazy reference file is created
- WHEN the core is searched for a pointer to that file
- THEN at least one reachable reference MUST exist; a lazy file with zero pointers is a spec violation

### Requirement: No Normative Content Loss

No normative rule present in the pre-diet `assets/orchestrator.md` MAY be dropped during the split. The union of (new core content + all referenced lazy files) MUST contain every normative section from a frozen pre-diet fixture.

#### Scenario: Union test passes

- GIVEN a frozen fixture capturing the pre-diet `assets/orchestrator.md` normative sections
- WHEN a migration test computes the union of the new core and all lazy files
- THEN every normative section from the fixture MUST be present in that union

#### Scenario: Missing section fails the test

- GIVEN a normative section from the fixture is absent from both the core and every lazy file
- WHEN the union test runs
- THEN the test MUST fail, identifying the missing section

### Requirement: Cache and Path Substitution Integrity

`getOrchestratorPrompt`'s existing cache and path-substitution behavior MUST keep working after new lazy-file placeholders are added.

#### Scenario: All placeholders substituted

- GIVEN `assets/orchestrator.md` contains one or more `{{...PATH}}` placeholders for new lazy files
- WHEN `getOrchestratorPrompt` is called
- THEN the returned string MUST NOT contain any literal `{{` substring

#### Scenario: Cache still memoizes

- GIVEN `getOrchestratorPrompt` is called twice in the same process
- WHEN the second call executes
- THEN it MUST return the cached value without re-reading the file from disk

### Requirement: No Double-Delivery of On-Demand Content

Content relocated to on-demand lazy files MUST NOT also be injected always-on. Lazy files are read on-demand by the orchestrator's own trigger logic, not appended into the always-on prompt string.

#### Scenario: Lazy file content absent from always-on output

- GIVEN a section was moved to a new lazy reference file
- WHEN the string returned by `getOrchestratorPrompt` is inspected
- THEN it MUST NOT contain the full relocated body — only the pointer/summary that resolves to the lazy file's path

### Requirement: Existing Content Assertions Repointed, Not Deleted

Existing tests that assert `assets/orchestrator.md` content (e.g. `tests/gentle-ai.test.ts:40`, which asserts the presence of `review-risk`, `review-reliability`, `review-resilience`, `review-readability`) MUST be repointed to whichever file (core or lazy) now holds that content. The assertions MUST NOT be deleted or weakened.

#### Scenario: Review-lens assertion still passes

- GIVEN the 4R/review-lens content moves to a core summary or a lazy review reference file
- WHEN `tests/gentle-ai.test.ts:40` runs after the split
- THEN it MUST still assert all four review lens names are present in whichever file now carries them

#### Scenario: Assertion not silently removed

- GIVEN a pre-existing content assertion targeting `assets/orchestrator.md`
- WHEN the split is applied
- THEN the assertion MUST still exist in the test suite (repointed if needed), not deleted

### Requirement: Measured Before/After Size Recorded

The before and after byte sizes (and derived approximate token counts) of the always-on injection MUST be measured and recorded in the design or verification artifact, with the measurement method stated.

#### Scenario: Before/after bytes recorded

- GIVEN the pre-diet and post-diet versions of `assets/orchestrator.md`
- WHEN the change is verified
- THEN the artifact MUST record both byte counts, the delta, and the method used (e.g. `Buffer.byteLength`, tokens ≈ bytes/4)

### Requirement: Coordinated Relocation of Externally-Owned Content

Sections whose CONTENT is owned by a parallel change (`persona-single-channel` for Identity Contract/Language Boundary; `port-review-ledger-contract` for 4R/Review Lens content) MUST be relocated verbatim as delivered by those changes. This change MUST NOT alter that content — only its placement (core vs. lazy file).

#### Scenario: Persona content relocated unmodified

- GIVEN `persona-single-channel` has landed and deduped Identity Contract/Language Boundary content
- WHEN this change places that content in the core or a lazy file
- THEN the text MUST match what `persona-single-channel` delivered, byte-for-byte in substance (formatting-only placement changes allowed)

#### Scenario: Review ledger content relocated unmodified

- GIVEN `port-review-ledger-contract` has landed and defined the 4R/Review Lens content
- WHEN this change places that content in the core or a lazy file
- THEN the text MUST match what `port-review-ledger-contract` delivered, not a rewritten version
