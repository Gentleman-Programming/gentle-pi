# Delta for session-persona

## Purpose

Single-source identity/persona/language injection for a Pi parent session, replacing the duplicated Identity Contract and Language Boundary content currently split between the `gentle-ai.ts` wrapper and `orchestrator.md`.

## ADDED Requirements

### Requirement: Single Canonical Identity/Persona/Language Channel

Identity, persona, and language-boundary content MUST appear exactly once within gentle-pi's always-on parent-session injection. The wrapper block built by `buildGentlePrompt` in `gentle-ai.ts` MUST be the canonical home, because it carries the runtime `Current persona mode:` line. `orchestrator.md`'s Identity Contract section MUST reduce to a single-line pointer referencing the canonical block. Within `orchestrator.md`'s Language Boundary section, only the duplicated portion (LB1 — the user-facing language/persona-mode rule) MUST reduce to a single-line pointer referencing the canonical block; the unique delegation/artifact rules (LB2-LB5 — subagent-English delegation, artifact-English, public-comment target language, and exceptions) are retained verbatim, because they exist nowhere else in the injection and deleting them would be content loss.

#### Scenario: Parent session receives single-source injection

- GIVEN a Pi parent session starts and gentle-ai.ts builds the system prompt
- WHEN the wrapper and orchestrator.md are concatenated
- THEN identity/persona/language rules appear exactly once across the combined text
- AND orchestrator.md contains a pointer line instead of duplicate rule text

#### Scenario: Identity Contract pointer preserves discoverability

- GIVEN a developer reads orchestrator.md
- WHEN they reach the former Identity Contract section
- THEN they find a one-line pointer to the canonical wrapper block
- AND no normative identity rule remains duplicated there

#### Scenario: Language Boundary retains unique rules behind a pointer for the duplicated portion

- GIVEN a developer reads orchestrator.md
- WHEN they reach the Language Boundary section
- THEN the duplicated LB1 rule is replaced by a one-line pointer to the canonical wrapper block
- AND the unique LB2-LB5 delegation/artifact rules remain verbatim, and are not duplicated elsewhere

### Requirement: Union Reconciliation With Zero Rule Loss

Reconciliation of the wrapper and orchestrator.md pre-change copies MUST be a union: every normative rule present in EITHER copy MUST survive in the canonical block. This MUST be enforced by an automated migration test whose fixtures are frozen verbatim from the pre-change wrapper and orchestrator.md text.

#### Scenario: Migration test validates the union

- GIVEN fixtures frozen verbatim from the pre-change wrapper and orchestrator.md
- WHEN the migration test runs under `pnpm test`
- THEN every normative rule extracted from both fixtures is present in the post-change canonical block
- AND the test fails if any rule is missing

#### Scenario: Frozen fixtures remain immutable

- GIVEN the frozen fixtures exist in the test suite
- WHEN the canonical block is edited later
- THEN the fixtures MUST NOT be edited to force the test to pass
- AND only the canonical block or extraction logic may change

### Requirement: Persona Constant Selection Keeps Working

The Gentleman/Neutral persona selection (`GENTLEMAN_PERSONA_PROMPT` / `NEUTRAL_PERSONA_PROMPT`, chosen via `persona.json`) MUST keep working unchanged after the dedup.

#### Scenario: Gentleman persona selected

- GIVEN persona.json selects the Gentleman persona
- WHEN the injection is built
- THEN GENTLEMAN_PERSONA_PROMPT content appears once in the canonical block
- AND persona-selection logic is unchanged

#### Scenario: Neutral persona selected

- GIVEN persona.json selects the Neutral persona
- WHEN the injection is built
- THEN NEUTRAL_PERSONA_PROMPT content appears once in the canonical block
- AND no Gentleman-only rule leaks into the neutral output

### Requirement: Named/SDD Subagent Branches Unaffected

The injection branch used for named or SDD subagent sessions MUST NOT be altered by this change.

#### Scenario: SDD subagent launch unaffected

- GIVEN an SDD phase subagent is launched
- WHEN gentle-ai.ts builds its system prompt
- THEN the subagent branch produces the same content as before the change
- AND no pointer or canonical-block reference is injected into that branch

### Requirement: Cross-Tool Ownership Contract Documented

A written cross-tool ownership contract MUST exist in the change directory stating that gentle-pi owns Pi-session identity/persona/language content, and that slimming gentle-ai's `APPEND_SYSTEM.md` persona section is a follow-up owned by the gentle-ai repo.

#### Scenario: Ownership contract artifact exists

- GIVEN the change is applied
- WHEN a reviewer inspects the change directory
- THEN a written artifact states gentle-pi's ownership of Pi-session identity
- AND the artifact records the gentle-ai APPEND_SYSTEM slimming as an out-of-scope, documented follow-up

### Requirement: Measured Byte Delta Recorded

Measured before/after byte counts for the affected injection channels, together with the measurement method, MUST be recorded in the change artifacts.

#### Scenario: Byte measurement recorded with method

- GIVEN the dedup is applied to the wrapper and orchestrator.md
- WHEN before/after byte counts are captured
- THEN the change artifacts record the before size, after size, and the measurement method used
- AND the recorded delta matches the assertion in the migration test

## Acceptance Criteria

- [ ] Identity/persona/language rules appear exactly once in gentle-pi's injection; orchestrator.md's Identity Contract reduces to a pointer; orchestrator.md's Language Boundary LB1 (duplicated) reduces to a pointer while LB2-LB5 (unique) remain verbatim.
- [ ] Frozen-fixture migration test proves the union (zero rules lost) under `pnpm test`.
- [ ] Persona constant selection (Gentleman/Neutral) verified unchanged.
- [ ] Named/SDD subagent injection branch verified unchanged.
- [ ] Cross-tool ownership contract exists as a written artifact in the change directory.
- [ ] Before/after byte counts and measurement method are recorded.
